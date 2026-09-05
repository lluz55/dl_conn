package nostr

import (
	"context"
	"log"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
)

// Handler processes incoming Nostr DM requests and dispatches responses.
type Handler struct {
	client      *Client
	tokenIssuer TokenIssuer
	services    []ServiceInfo

	urlMu     sync.RWMutex
	tunnelURL string

	statusFn    func(id string) string
	probeAllFn  func(context.Context)
	telemetryFn func() *HostTelemetry

	statsMu sync.Mutex
	stats   HandlerStats
}

// HandlerStats records the outcome of every discovery request seen, so a
// request that arrived and was dropped can be told apart from one that never
// arrived at all.
type HandlerStats struct {
	Received          int    `json:"received"`
	Rejected          int    `json:"rejected"`
	Answered          int    `json:"answered"`
	PublishFailed     int    `json:"publish_failed"`
	LastReceivedAt    string `json:"last_received_at,omitempty"`
	LastAnsweredAt    string `json:"last_answered_at,omitempty"`
	LastRejection     string `json:"last_rejection,omitempty"`
	LastAdvertisedURL string `json:"last_advertised_url,omitempty"`
}

// Stats returns a snapshot of the request outcomes seen so far.
func (h *Handler) Stats() HandlerStats {
	h.statsMu.Lock()
	defer h.statsMu.Unlock()
	return h.stats
}

func (h *Handler) recordStats(fn func(*HandlerStats)) {
	h.statsMu.Lock()
	defer h.statsMu.Unlock()
	fn(&h.stats)
}

// reject logs and counts a dropped request. The daemon answers nothing on
// rejection by design (an unauthorized sender learns nothing), which used to
// make every failure mode look identical from the outside: the request simply
// vanished.
func (h *Handler) reject(reason string) {
	h.recordStats(func(s *HandlerStats) {
		s.Rejected++
		s.LastRejection = reason
	})
	log.Printf("nostr: request dropped: %s", reason)
}

// TokenIssuer generates one-time auth tokens.
type TokenIssuer interface {
	Issue() (string, time.Duration, error)
}

// NewHandler creates a Nostr request handler.
func NewHandler(client *Client, issuer TokenIssuer, tunnelURL string, services []ServiceInfo) *Handler {
	return &Handler{
		client:      client,
		tokenIssuer: issuer,
		tunnelURL:   tunnelURL,
		services:    services,
	}
}

// SetTunnelURL replaces the hostname advertised in discovery responses.
// cloudflared mints a new ephemeral hostname on every restart and the
// previous one stops routing immediately, so the URL cannot be frozen at
// construction time.
func (h *Handler) SetTunnelURL(url string) {
	h.urlMu.Lock()
	h.tunnelURL = url
	h.urlMu.Unlock()
}

// TunnelURL returns the hostname currently being advertised.
func (h *Handler) TunnelURL() string {
	h.urlMu.RLock()
	defer h.urlMu.RUnlock()
	return h.tunnelURL
}

// SetStatusFunc installs a health lookup consulted at response time, so every
// discovery reply carries the freshest observed status instead of whatever was
// known when the handler was built.
func (h *Handler) SetStatusFunc(fn func(id string) string) {
	h.statusFn = fn
}

// SetProbeAll installs a function that triggers a fresh health probe of every
// service. When set, each discovery response runs one probe first so the
// caller gets current availability rather than the last cached 30s snapshot.
func (h *Handler) SetProbeAll(fn func(context.Context)) {
	h.probeAllFn = fn
}

// SetTelemetryFunc installs a function that returns the latest host telemetry
// snapshot. When set, discovery responses include host_telemetry.
func (h *Handler) SetTelemetryFunc(fn func() *HostTelemetry) {
	h.telemetryFn = fn
}

// servicesWithStatus copies the advertised services with their current health
// stamped in.
func (h *Handler) servicesWithStatus() []ServiceInfo {
	if h.statusFn == nil {
		return h.services
	}
	out := make([]ServiceInfo, len(h.services))
	copy(out, h.services)
	for i := range out {
		out[i].Status = h.statusFn(out[i].ID)
	}
	return out
}

// Serve subscribes to DM events and processes them.
func (h *Handler) Serve(ctx context.Context) {
	events := h.client.Subscribe(ctx)
	for {
		select {
		case evt, ok := <-events:
			if !ok {
				return
			}
			go h.processEvent(ctx, evt)
		case <-ctx.Done():
			return
		}
	}
}

// processEvent handles a single Nostr DM event.
func (h *Handler) processEvent(ctx context.Context, evt *nostr.Event) {
	h.recordStats(func(s *HandlerStats) {
		s.Received++
		s.LastReceivedAt = time.Now().Format(time.RFC3339)
	})

	senderPubHex, plaintext, err := h.client.ParseEvent(evt)
	if err != nil {
		// Unauthorized sender → no response, no error leaked to the caller.
		h.reject(err.Error())
		return
	}

	req, err := UnmarshalRequest([]byte(plaintext))
	if err != nil {
		h.reject("malformed request from " + senderPubHex + ": " + err.Error())
		return
	}

	if req.Action != ActionDiscoverServices {
		h.reject("unknown action " + req.Action + " from " + senderPubHex)
		return
	}

	// Trigger a fresh probe so the response carries the current status,
	// not the last cached snapshot from the periodic monitor tick. The probe
	// runs synchronously here because (a) it has its own bounded timeout via
	// the monitor’s DialContext, and (b) keeping it sequential avoids racing
	// the Status reads in servicesWithStatus() below.
	if h.probeAllFn != nil {
		probeCtx, probeCancel := context.WithTimeout(ctx, 5*time.Second)
		defer probeCancel()
		h.probeAllFn(probeCtx)
	}

	token, ttl, err := h.tokenIssuer.Issue()
	if err != nil {
		h.reject("issuing token: " + err.Error())
		return
	}

	tunnelURL := h.TunnelURL()
	resp := NewResponse(tunnelURL, token, ttl, h.servicesWithStatus())
	if h.telemetryFn != nil {
		resp.HostTelemetry = h.telemetryFn()
	}
	respJSON, err := MarshalResponse(resp)
	if err != nil {
		h.reject("marshalling response: " + err.Error())
		return
	}

	if err := h.client.PublishResponse(ctx, senderPubHex, string(respJSON)); err != nil {
		h.recordStats(func(s *HandlerStats) { s.PublishFailed++ })
		log.Printf("nostr: publishing response to %s failed: %v", senderPubHex, err)
		return
	}

	h.recordStats(func(s *HandlerStats) {
		s.Answered++
		s.LastAnsweredAt = time.Now().Format(time.RFC3339)
		s.LastAdvertisedURL = tunnelURL
	})
	log.Printf("nostr: answered discovery from %s with url=%s", senderPubHex, tunnelURL)
}
