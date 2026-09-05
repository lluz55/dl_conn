package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"time"

	"dl_conn/internal/nostr"
	"dl_conn/internal/tunnel"
)

// diagnosticsReport is the payload served by the local diagnostics endpoint.
type diagnosticsReport struct {
	Now             string             `json:"now"`
	DaemonUptimeSec int64              `json:"daemon_uptime_sec"`
	Tunnel          tunnelDiagnostics  `json:"tunnel"`
	Nostr           nostr.HandlerStats `json:"nostr"`
	Relays          []nostr.RelayStats `json:"relays"`
	AuthorizedNpubs int                `json:"authorized_npubs"`
}

type tunnelDiagnostics struct {
	Running       bool   `json:"running"`
	PID           int    `json:"pid"`
	Starts        int    `json:"starts"`
	StartedAt     string `json:"started_at,omitempty"`
	LastExitErr   string `json:"last_exit_err,omitempty"`
	AdvertisedURL string `json:"advertised_url"`
	LatestURL     string `json:"latest_url"`
	// URLStale is the whole point of this endpoint: cloudflared restarting
	// mints a new hostname while clients keep being told the first one.
	URLStale    bool   `json:"url_stale"`
	Reachable   bool   `json:"advertised_url_reachable"`
	ProbeDetail string `json:"advertised_url_probe"`
}

// startDiagnostics serves a JSON snapshot of the daemon's live state on
// loopback only. It cannot share the main HTTP server: cloudflared reaches
// that server over loopback too, so a RemoteAddr check there would let the
// whole internet in through the tunnel. A separate listener bound to
// 127.0.0.1 is unreachable from the tunnel by construction.
func startDiagnostics(ctx context.Context, addr string, tm *tunnel.Manager, client *nostr.Client, handler *nostr.Handler) {
	started := time.Now()

	mux := http.NewServeMux()
	mux.HandleFunc("/debug", func(w http.ResponseWriter, r *http.Request) {
		st := tm.Status()
		// The advertised URL is the handler's, not the manager's: the
		// manager knows what cloudflared last printed, while only the
		// handler knows what clients are actually being told.
		advertised := handler.TunnelURL()

		probeCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		reachable, detail := false, "no advertised url"
		if advertised != "" {
			reachable, detail = tunnel.Probe(probeCtx, advertised+"/_healthz")
		}

		report := diagnosticsReport{
			Now:             time.Now().Format(time.RFC3339),
			DaemonUptimeSec: int64(time.Since(started).Seconds()),
			Tunnel: tunnelDiagnostics{
				Running:       st.Running,
				PID:           st.PID,
				Starts:        st.Starts,
				LastExitErr:   st.LastExitErr,
				AdvertisedURL: advertised,
				LatestURL:     st.LatestURL,
				URLStale:      st.LatestURL != "" && st.LatestURL != advertised,
				Reachable:     reachable,
				ProbeDetail:   detail,
			},
			Nostr:           handler.Stats(),
			Relays:          client.RelayStats(),
			AuthorizedNpubs: client.AuthorizedCount(),
		}
		if !st.StartedAt.IsZero() {
			report.Tunnel.StartedAt = st.StartedAt.Format(time.RFC3339)
		}

		w.Header().Set("Content-Type", "application/json")
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(report)
	})

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("diagnostics endpoint unavailable on %s: %v", addr, err)
		return
	}
	log.Printf("Diagnostics endpoint on http://%s/debug", addr)

	server := &http.Server{Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		<-ctx.Done()
		_ = server.Close()
	}()
	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("diagnostics server error: %v", err)
		}
	}()
}
