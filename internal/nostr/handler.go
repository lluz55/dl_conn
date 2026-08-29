package nostr

import (
	"context"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
)

// Handler processes incoming Nostr DM requests and dispatches responses.
type Handler struct {
	client       *Client
	tokenIssuer  TokenIssuer
	tunnelURL    string
	services     []ServiceInfo
	statusFn     func(id string) string
	probeAllFn   func(context.Context)
	telemetryFn  func() *HostTelemetry
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
	senderPubHex, plaintext, err := h.client.ParseEvent(evt)
	if err != nil {
		// Unauthorized sender → silently ignore (no response, no error leaked)
		return
	}

	req, err := UnmarshalRequest([]byte(plaintext))
	if err != nil {
		return
	}

	if req.Action != ActionDiscoverServices {
		// unknown action — silently ignore
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
		return
	}

	resp := NewResponse(h.tunnelURL, token, ttl, h.servicesWithStatus())
	if h.telemetryFn != nil {
		resp.HostTelemetry = h.telemetryFn()
	}
	respJSON, err := MarshalResponse(resp)
	if err != nil {
		return
	}

	if err := h.client.PublishResponse(ctx, senderPubHex, string(respJSON)); err != nil {
		// best-effort, log in real deployment
	}
}
