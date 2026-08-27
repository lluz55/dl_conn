package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/config"
	"dl_conn/internal/health"
	"dl_conn/internal/nostr"
	"dl_conn/internal/proxy"
	"dl_conn/internal/tunnel"

	"github.com/spf13/cobra"
)

var (
	rootCmd = &cobra.Command{
		Use:   "dl_conn",
		Short: "dl_conn — local services via Cloudflare Tunnel + Nostr signaling",
		RunE:  run,
	}

	configPath   string
	nsecOverride string
	nsecFile     string
)

func init() {
	rootCmd.PersistentFlags().StringVar(&configPath, "config", "config.yaml", "path to YAML config file")
	rootCmd.PersistentFlags().StringVar(&nsecOverride, "nsec", "", "override Nostr nsec")
	rootCmd.PersistentFlags().StringVar(&nsecFile, "nsec-file", "", "path to Nostr nsec secret file")
}

func run(cmd *cobra.Command, _ []string) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	log.Printf("Config loaded: %d services, %d relays, %d authorized npubs",
		len(cfg.Services), len(cfg.Nostr.Relays), len(cfg.Nostr.AuthorizedNpubs))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Phase 2: tunnel manager
	tm := tunnel.NewManager(cfg.Tunnel.CloudflaredPath, cfg.Tunnel.ListenPort)
	if err := tm.Start(ctx); err != nil {
		return fmt.Errorf("starting tunnel: %w", err)
	}
	defer func() {
		_ = tm.Shutdown(ctx)
	}()

	urlCh := tm.URL()
	var tunnelURL string

	// Wait for tunnel URL or timeout before starting auth/proxy/nostr
	// so the response payload includes the real URL.
	select {
	case tunnelURL = <-urlCh:
		log.Printf("Tunnel URL: %s", tunnelURL)
	case <-time.After(15 * time.Second):
		log.Println("WARNING: tunnel URL not received within 15s, proceeding without it")
	case <-ctx.Done():
		return nil
	}

	// Phase 4: auth + proxy
	tokenMgr := auth.NewTokenManager(cfg.Auth.TokenTTL)
	sessionMgr := auth.NewSessionManager(cfg.Auth.SessionTTL)
	tokenMgrCleanup(ctx, tokenMgr)
	sessionMgrCleanup(ctx, sessionMgr)

	authHandler := auth.NewAuthHandler(tokenMgr, sessionMgr)

	// Map services for the Nostr response. Hidden services (extra root-level
	// routes a backend's own frontend needs, e.g. Frigate's "/api"/"/ws")
	// are proxied but aren't a distinct thing the user should see or click.
	visibleServices := make([]config.ServiceConfig, 0, len(cfg.Services))
	for _, s := range cfg.Services {
		if !s.Hidden {
			visibleServices = append(visibleServices, s)
		}
	}
	serviceInfos := make([]nostr.ServiceInfo, len(visibleServices))
	for i, s := range visibleServices {
		serviceInfos[i] = nostr.ServiceInfo{
			ID:        s.ID,
			Name:      s.Name,
			Icon:      s.Icon,
			Prefix:    s.Prefix,
			Websocket: s.Websocket,
			Status:    health.StatusUnknown,
		}
	}

	// Phase 3: Nostr signaling
	nsec, err := cfg.GetNsec()
	if err != nil {
		// Try nsec override / file from CLI flags
		if nsecOverride != "" {
			nsec = nsecOverride
		} else if nsecFile != "" {
			nsecBytes, ferr := os.ReadFile(nsecFile)
			if ferr != nil {
				return fmt.Errorf("reading nsec file: %w", ferr)
			}
			nsec = strings.TrimSpace(string(nsecBytes))
		} else {
			return err
		}
	}
	nsecHex, err := nostr.DecodeNsec(nsec)
	if err != nil {
		return fmt.Errorf("decoding nsec: %w", err)
	}

	client, err := nostr.NewClient(nsecHex, cfg.Nostr.Relays, cfg.Nostr.AuthorizedNpubs, cfg.Nostr.FallbackNip04)
	if err != nil {
		return fmt.Errorf("creating nostr client: %w", err)
	}

	// SIGHUP hot-reloads the authorized npub list without restarting the
	// daemon (tunnel URL, relays, and services remain intact).
	hupCh := make(chan os.Signal, 1)
	signal.Notify(hupCh, syscall.SIGHUP)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-hupCh:
				log.Println("Received SIGHUP — reloading authorized npubs...")
				newCfg, err := config.Load(configPath)
				if err != nil {
					log.Printf("SIGHUP reload failed: %v", err)
					continue
				}
				if err := client.SetAuthorized(newCfg.Nostr.AuthorizedNpubs); err != nil {
					log.Printf("SIGHUP SetAuthorized failed: %v", err)
					continue
				}
				log.Printf("Allowlist reloaded: %d authorized npubs (including host)", client.AuthorizedCount())
			}
		}
	}()

	// Health monitor: services are advertised as "unknown" until a probe
	// confirms the local target answers, so the dashboard never shows green
	// for something that was merely configured.
	monitor := health.New(visibleServices)
	go monitor.Run(ctx)

	handler := nostr.NewHandler(client, tokenMgr, tunnelURL, serviceInfos)
	handler.SetStatusFunc(monitor.Status)
	handler.SetProbeAll(monitor.ProbeAll)
	// Don't answer discovery DMs until the tunnel is confirmed reachable —
	// cloudflared printing the ephemeral hostname doesn't mean Cloudflare's
	// edge has finished routing to it yet. Until then, requests just go
	// unanswered, which the frontend already treats as "host offline" and
	// retries/times out on — no protocol change needed for this to work.
	// (The HTTP server below starts concurrently with this wait; by the
	// time the tunnel is actually reachable, :9099 is already listening.)
	go func() {
		if tunnelURL == "" {
			log.Println("No tunnel URL available — enabling discovery responses without a readiness check")
		} else {
			log.Println("Waiting for the tunnel to become reachable through Cloudflare's edge...")
			onAttempt, lastDetail := readinessLogger("main tunnel")
			if tunnel.WaitReady(ctx, tunnelURL+"/_healthz", tunnel.DefaultReadyTimeout, onAttempt) {
				log.Println("Tunnel is reachable — discovery responses enabled")
			} else {
				log.Printf("WARNING: tunnel readiness check timed out after %s (last: %s) — enabling discovery responses anyway", tunnel.DefaultReadyTimeout, *lastDetail)
			}
		}
		handler.Serve(ctx)
	}()

	// HTTP server: serve web + proxy + auth + tunnel target
	router := proxy.NewRouter(cfg.Services, sessionMgr)

	mux := http.NewServeMux()

	// SPA static files. The catch-all pattern also has to let root-absolute
	// sub-resource requests from proxied SPAs through to the router — see
	// proxy.RootFallback.
	webDir := filepath.Join(".", "web")
	fs := securityHeaders(http.FileServer(http.Dir(webDir)))
	mux.Handle("/", proxy.RootFallback(router, fs, http.Dir(webDir)))

	// Auth endpoint
	mux.HandleFunc("/auth", authHandler.HandleAuth)
	mux.Handle("/_static/", http.StripPrefix("/_static/", fs))

	// Service routes through the proxy (Zero-Trust). Each prefix is
	// registered both bare and with a trailing slash: ServeMux only treats
	// the trailing-slash form as a subtree match, but a bare request for
	// e.g. "/ws" (a WebSocket upgrade, which can't follow the 301 ServeMux
	// would otherwise issue to "/ws/") needs the exact pattern too.
	for _, svc := range cfg.Services {
		mux.Handle(svc.Prefix, router)
		mux.Handle(svc.Prefix+"/", router)
	}

	// Health check
	mux.HandleFunc("/_healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	server := &http.Server{
		Addr:         ":" + cfg.PortString(),
		Handler:      loggingMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // unlimited for streaming
		IdleTimeout:  120 * time.Second,
	}

	// Start HTTP server (listens on localhost, cloudflared tunnels to it)
	go func() {
		log.Printf("HTTP server listening on :%s", cfg.PortString())
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")
	_ = server.Shutdown(context.Background())
	return nil
}

// readinessLogger builds a tunnel.WaitReady progress callback for label:
// logs the very first attempt immediately (so a hung wait shows *something*
// right away — DNS failure vs. a real HTTP status look very different) and
// then throttles to roughly every 30s so a long wait doesn't spam the log
// once a second. The returned pointer always holds the most recent detail,
// for the caller to report if WaitReady ultimately times out.
func readinessLogger(label string) (onAttempt func(elapsed time.Duration, detail string), lastDetail *string) {
	var attempts int
	detail := "no attempt made yet"
	lastDetail = &detail
	onAttempt = func(elapsed time.Duration, d string) {
		attempts++
		*lastDetail = d
		if attempts == 1 || attempts%30 == 0 {
			log.Printf("%s: still waiting after %s (%s)", label, elapsed.Round(time.Second), d)
		}
	}
	return onAttempt, lastDetail
}

// spaCSP mirrors the <meta> policy in web/index.html. The meta tag is what
// protects the GitHub Pages copy, which has no way to set headers; this header
// covers the copy served by the daemon and additionally carries frame-ancestors,
// which browsers ignore when it arrives via <meta>.
//
// It is applied only to the SPA. Proxied services (Home Assistant, Frigate)
// ship their own markup and would break under this policy.
const spaCSP = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self'; " +
	"img-src 'self' data: blob:; " +
	"media-src 'self' blob:; " +
	"connect-src 'self' https: wss:; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'none'; " +
	"object-src 'none'"

// securityHeaders wraps the SPA file server with the response headers that
// keep the origin holding the user's key material hard to attack.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", spaCSP)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the response status code for logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rec *statusRecorder) WriteHeader(status int) {
	rec.status = status
	rec.ResponseWriter.WriteHeader(status)
}

// Hijack lets a WebSocket upgrade through. httputil.ReverseProxy takes over
// the raw connection to switch protocols, and a wrapper that only satisfies
// http.ResponseWriter turns every upgrade into "can't switch protocols using
// non-Hijacker ResponseWriter type" — a 502 the browser reports as a failed
// handshake. Recording 101 here also keeps the access log honest: the
// upgrade response is written straight to the connection, never through
// WriteHeader.
func (rec *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := rec.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter %T is not an http.Hijacker", rec.ResponseWriter)
	}
	conn, brw, err := hj.Hijack()
	if err == nil {
		rec.status = http.StatusSwitchingProtocols
	}
	return conn, brw, err
}

// Unwrap exposes the underlying ResponseWriter to http.ResponseController,
// so the capabilities this wrapper doesn't implement itself — flushing above
// all, which is what keeps Frigate's live MJPEG/event streams moving instead
// of sitting in a buffer — keep working through the middleware.
func (rec *statusRecorder) Unwrap() http.ResponseWriter {
	return rec.ResponseWriter
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s remote=%s status=%d duration=%s",
			r.Method, r.URL.Path, r.RemoteAddr, rec.status, time.Since(start))
	})
}

func tokenMgrCleanup(ctx context.Context, tm *auth.TokenManager) {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tm.Cleanup()
			}
		}
	}()
}

func sessionMgrCleanup(ctx context.Context, sm *auth.SessionManager) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sm.Cleanup()
			}
		}
	}()
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
