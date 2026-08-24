package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/config"
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

	// Map services for the Nostr response
	serviceInfos := make([]nostr.ServiceInfo, len(cfg.Services))
	for i, s := range cfg.Services {
		serviceInfos[i] = nostr.ServiceInfo{
			ID:        s.ID,
			Name:      s.Name,
			Icon:      s.Icon,
			Prefix:    s.Prefix,
			Websocket: s.Websocket,
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

	handler := nostr.NewHandler(client, tokenMgr, tunnelURL, serviceInfos)
	go handler.Serve(ctx)

	// HTTP server: serve web + proxy + auth + tunnel target
	router := proxy.NewRouter(cfg.Services, sessionMgr)

	mux := http.NewServeMux()

	// SPA static files
	webDir := filepath.Join(".", "web")
	fs := http.FileServer(http.Dir(webDir))
	mux.Handle("/", fs)

	// Auth endpoint
	mux.HandleFunc("/auth", authHandler.HandleAuth)
	mux.Handle("/_static/", http.StripPrefix("/_static/", fs))

	// Proxy (Zero-Trust)
	mux.Handle("/api/", http.StripPrefix("/api", router))
	// Service routes through the proxy
	for _, svc := range cfg.Services {
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

// statusRecorder captures the response status code for logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rec *statusRecorder) WriteHeader(status int) {
	rec.status = status
	rec.ResponseWriter.WriteHeader(status)
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
