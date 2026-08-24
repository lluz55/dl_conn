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

	token, ttl, err := h.tokenIssuer.Issue()
	if err != nil {
		return
	}

	resp := NewResponse(h.tunnelURL, token, ttl, h.services)
	respJSON, err := MarshalResponse(resp)
	if err != nil {
		return
	}

	if err := h.client.PublishResponse(ctx, senderPubHex, string(respJSON)); err != nil {
		// best-effort, log in real deployment
	}
}
