package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"mime"
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
	"dl_conn/internal/sensors"
	"dl_conn/internal/store"
	"dl_conn/internal/telemetry"
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
	// The SPA self-hosts its woff2 subsets (see web/vendor/fonts/); register
	// the type explicitly so the daemon's file server labels them correctly
	// regardless of what the host's /etc/mime.types knows.
	_ = mime.AddExtensionType(".woff2", "font/woff2")

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
	sessionMgr := auth.NewSessionManagerWithOptions(cfg.Auth.SessionTTL, auth.Options{
		AnonymizeLogs: cfg.Auth.LogsIPs(),
		Partitioned:   cfg.Auth.PartitionedCookies,
	})
	tokenMgrCleanup(ctx, tokenMgr)
	sessionMgrCleanup(ctx, sessionMgr)

	authHandler := auth.NewAuthHandlerWithRateLimit(tokenMgr, sessionMgr,
		cfg.Auth.RateLimitPerSec, cfg.Auth.RateLimitBurst)
	// The rate-limit buckets are keyed by client address, which is
	// caller-controlled, so idle ones are reclaimed on a timer.
	authHandler.RunCleanup(ctx)

	// Step-up: a per-process secret that signs short-lived proofs for the
	// session (see auth.StepUp). Nothing is enabled unless the operator
	// names the routes in auth.stepUpProtected.
	stepUp, err := auth.NewStepUp()
	if err != nil {
		return fmt.Errorf("creating step-up verifier: %w", err)
	}

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
			ID:          s.ID,
			Name:        s.Name,
			Icon:        s.Icon,
			Description: s.Description,
			Prefix:      s.Prefix,
			Websocket:   s.Websocket,
			Status:      health.StatusUnknown,
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
			// The file buffer holds the key in the clear; nothing reads it
			// again, so zero it before it becomes garbage.
			clear(nsecBytes)
		} else {
			return err
		}
	}
	nsecHex, err := nostr.DecodeNsec(nsec)
	if err != nil {
		return fmt.Errorf("decoding nsec: %w", err)
	}
	// The decoded key is the one piece of state in this process that must not
	// outlive its use. It is copied into a buffer this function owns, handed
	// to the client constructor, and that buffer is zeroed the moment the
	// constructor returns — including when it returns an error, which is the
	// path a misconfigured key takes and the one a plain early return would
	// have left holding the secret.
	//
	// The nsec strings themselves cannot be zeroed: a Go string is immutable,
	// so the copies held by the config and the CLI flag stay in the heap until
	// the GC collects them. This is a mitigation, not a guarantee — an
	// attacker with ptrace reads the key whenever it is loaded.
	nsecBytes := []byte(nsecHex)
	client, err := newNostrClient(nsecBytes, cfg.Nostr.Relays, cfg.Nostr.AuthorizedNpubs, cfg.Nostr.FallbackNip04)
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

	// Host telemetry collector (opt-in via config, default enabled).
	var telCollector *sensors.Collector
	var telStore *store.Store
	if cfg.Telemetry.Enabled {
		interval := time.Duration(cfg.Telemetry.IntervalSeconds) * time.Second
		telCollector = sensors.NewCollector(interval)
		// Persist to SQLite (without SQLCipher).
		dbPath := filepath.Join(filepath.Dir(configPath), "telemetry.db")
		if s, err := store.New(dbPath); err == nil {
			telStore = s
			defer s.Close()
			telCollector.WithPersist(func(snap sensors.Snapshot) {
				_ = s.Insert(snap)
			})
			// Prune old samples hourly.
			go func() {
				ticker := time.NewTicker(time.Hour)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						_ = s.Prune(time.Duration(cfg.Telemetry.RetentionDays) * 24 * time.Hour)
					}
				}
			}()
		} else {
			log.Printf("telemetry store init failed: %v", err)
		}
		go telCollector.Run(ctx)
	}

	handler := nostr.NewHandler(client, tokenMgr, tunnelURL, serviceInfos)
	handler.SetStatusFunc(monitor.Status)
	handler.SetProbeAll(monitor.ProbeAll)
	if telCollector != nil && cfg.Telemetry.ExposeViaNostr {
		handler.SetTelemetryFunc(func() *nostr.HostTelemetry {
			snap := telCollector.Latest()
			if snap == nil {
				return nil
			}
			ht := &nostr.HostTelemetry{
				SampledAt: snap.SampledAt.Format(time.RFC3339),
				UptimeSec: snap.UptimeSec,
			}
			if snap.CPU != nil {
				ht.CpuTempC = snap.CPU.TempC
				ht.CpuLoad1 = snap.CPU.Load1
				ht.CpuLoad5 = snap.CPU.Load5
				ht.CpuLoad15 = snap.CPU.Load15
				ht.CpuFreqMHz = snap.CPU.FreqMHz
			}
			if snap.Memory != nil {
				ht.RamUsedPct = snap.Memory.UsedPct
				ht.RamUsedMB = snap.Memory.UsedMB
				ht.RamTotalMB = snap.Memory.TotalMB
			}
			if len(snap.Disks) > 0 {
				ht.DiskUsedPct = snap.Disks[0].UsedPct
				ht.DiskUsedMB = snap.Disks[0].UsedMB
				ht.DiskTotalMB = snap.Disks[0].TotalMB
				ht.Mountpoint = snap.Disks[0].Mountpoint
			}
			if snap.GPU != nil {
				ht.GpuTempC = snap.GPU.TempC
				ht.GpuUtilPct = snap.GPU.UtilPct
			}
			if snap.Battery != nil && snap.Battery.Available {
				ht.BattCapacityPct = snap.Battery.CapacityPct
				ht.BattStatus = snap.Battery.Status
			}
			return ht
		})
	}
	_ = telStore

	// Loopback-only diagnostics (see startDiagnostics). Derived from the
	// listen port so it needs no configuration of its own.
	startDiagnostics(ctx, fmt.Sprintf("127.0.0.1:%d", cfg.Tunnel.ListenPort+1), tm, client, handler)

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
			awaitTunnelReady(ctx, "main tunnel", tunnelURL)
		}
		handler.Serve(ctx)
	}()

	// cloudflared restarting mints a new ephemeral hostname and the previous
	// one stops routing at once, so keep consuming the channel: without this
	// the daemon would answer discovery with the first URL forever.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case newURL := <-urlCh:
				if newURL == "" || newURL == handler.TunnelURL() {
					continue
				}
				log.Printf("Tunnel URL rotated to %s — verifying reachability before advertising it", newURL)
				awaitTunnelReady(ctx, "rotated tunnel", newURL)
				handler.SetTunnelURL(newURL)
				log.Printf("Now advertising %s to clients", newURL)
			}
		}
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

	// Auth endpoints
	mux.HandleFunc("/auth", authHandler.HandleAuth)
	mux.HandleFunc("/auth/logout", authHandler.HandleLogout)
	mux.Handle("/_static/", http.StripPrefix("/_static/", fs))

	// Step-up proof endpoint. Registered unconditionally: minting a proof is
	// only meaningful for a caller that already has a session, and a route
	// that appears and disappears with the config would make the frontend
	// guess whether 404 means "not enabled" or "not allowed".
	mux.HandleFunc(auth.StepUpPath, auth.NewStepUpHandler(sessionMgr, stepUp).ServeHTTP)

	// Dynamic loopback services use the same Zero-Trust session as configured
	// services. The handler owns only /local/<port>/ and never accepts a host.
	dynamicProxy := proxy.NewDynamicPortProxy(sessionMgr, cfg.Tunnel.ListenPort, cfg.DynamicPorts.DeniedPorts)
	mux.Handle("/local/", dynamicProxy)

	// Service routes through the proxy (Zero-Trust). Each prefix is
	// registered both bare and with a trailing slash: ServeMux only treats
	// the trailing-slash form as a subtree match, but a bare request for
	// e.g. "/ws" (a WebSocket upgrade, which can't follow the 301 ServeMux
	// would otherwise issue to "/ws/") needs the exact pattern too.
	for _, svc := range cfg.Services {
		mux.Handle(svc.Prefix, router)
		mux.Handle(svc.Prefix+"/", router)
	}

	// Host telemetry (requires session, and a step-up proof when the
	// operator put this route in auth.stepUpProtected)
	if telCollector != nil {
		telHandler := telemetry.NewHandler(telCollector, sessionMgr)
		if cfg.Auth.RequiresStepUp("/api/host/telemetry") {
			telHandler = telHandler.WithStepUp(stepUp)
			log.Println("Telemetry requires a step-up proof (auth.stepUpProtected)")
		}
		telHandler.RunCleanup(ctx)
		mux.Handle("/api/host/telemetry", telHandler)
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

// awaitTunnelReady blocks until Cloudflare's edge routes url to the origin,
// or the readiness budget runs out. Timing out is not fatal: advertising a
// URL that is merely slow to propagate beats advertising one that is
// certainly dead.
func awaitTunnelReady(ctx context.Context, label, url string) {
	log.Printf("%s: waiting for the tunnel to become reachable through Cloudflare's edge...", label)
	onAttempt, lastDetail := readinessLogger(label)
	if tunnel.WaitReady(ctx, url+"/_healthz", tunnel.DefaultReadyTimeout, onAttempt) {
		log.Printf("%s: reachable", label)
		return
	}
	log.Printf("WARNING: %s readiness check timed out after %s (last: %s) — advertising it anyway", label, tunnel.DefaultReadyTimeout, *lastDetail)
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
	"font-src 'self'; " +
	"connect-src 'self' https: wss:; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'none'; " +
	"object-src 'none'"

// hstsValue pins the ephemeral tunnel hostname to HTTPS for two years.
// trycloudflare.com is served over HTTPS only and is covered by the
// includeSubDomains preload list, so a browser that has seen this once will
// refuse to try the origin over plain HTTP even if something in the path
// (a captive portal, a misconfigured LAN shortcut) answers there.
const hstsValue = "max-age=63072000; includeSubDomains"

// permissionsPolicy denies every powerful device API the SPA has no use for.
// camera=(self) stays allowed because the QR scanner calls getUserMedia when
// the user asks to read an nsec from a QR code; everything else is off, so a
// page that ends up loaded on this origin cannot ask for the microphone, the
// user's location, a payment card, or a USB device.
const permissionsPolicy = "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), " +
	"magnetometer=(), gyroscope=(), accelerometer=()"

// securityHeaders wraps the SPA file server with the response headers that
// keep the origin holding the user's key material hard to attack.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", spaCSP)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", permissionsPolicy)
		// HSTS only over HTTPS. Over LAN HTTP the header is ignored by
		// browsers, and sending it anyway would make a browser that has
		// cached it refuse the plain-HTTP origin later — the exact downgrade
		// the header is supposed to prevent, caused by the daemon itself.
		if isHTTPSRequest(r) {
			h.Set("Strict-Transport-Security", hstsValue)
		}
		next.ServeHTTP(w, r)
	})
}

// isHTTPSRequest reports whether the client reached this server over TLS,
// directly or through the tunnel. dl_conn itself is always spoken to over
// loopback by cloudflared, so the connection is never the client's TLS — the
// only evidence is what the edge told us, and X-Forwarded-Proto is set by
// cloudflared rather than by anything a client can reach past the edge.
func isHTTPSRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
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

// newNostrClient builds the signaling client and wipes the buffer holding the
// private key, whatever the outcome.
//
// The decoded key is the one piece of state in this process that must never
// outlive its use, and the nsec string that produced it is still sitting in
// the runtime's heap from the config read. go-nostr keeps the copy it needs;
// this zeroes ours as soon as it has one, so a core dump or a /proc/<pid>/mem
// read taken afterwards finds an empty buffer rather than the key. It is a
// mitigation, not a guarantee — an attacker who can ptrace the process can
// read the key at any point, including while it is legitimately loaded.
func newNostrClient(secret []byte, relays, authorizedNpubs []string, fallbackNip04 bool) (*nostr.Client, error) {
	client, err := nostr.NewClient(string(secret), relays, authorizedNpubs, fallbackNip04)
	clear(secret)
	return client, err
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
