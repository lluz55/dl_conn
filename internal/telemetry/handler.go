package telemetry

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
)

// CacheTTL is how long one serialized snapshot is served to every caller
// before a fresh one is collected. The collector samples on its own interval
// (telemetry.intervalSeconds, 10s by default) and Latest() is a pointer read,
// so the only thing a request actually costs is the JSON encoding — and
// several dashboards polling the same endpoint in the same second were each
// paying for their own identical encoding of the same numbers.
const CacheTTL = time.Second

// pollRate bounds how often one session may ask. One request a second with a
// burst of five covers the SPA's 2s poll plus a page reload, and stops a
// session that has been stolen (or a script the user ran) from turning the
// endpoint into a busy loop.
const (
	pollRatePerSec     = 1
	pollRateBurst      = 5
	rateLimiterIdleTTL = 5 * time.Minute
)

// Handler serves GET /api/host/telemetry behind session auth.
type Handler struct {
	collector *sensors.Collector
	sessions  *auth.SessionManager
	// stepUp, when non-nil, gates the endpoint behind a step-up proof in
	// addition to the session (see auth.stepUp). It is opt-in via
	// auth.stepUpProtected.
	stepUp *auth.StepUp

	mu       sync.Mutex
	cached   []byte
	cachedAt time.Time
	limiter  *auth.RateLimiter
}

func NewHandler(c *sensors.Collector, sm *auth.SessionManager) *Handler {
	return &Handler{
		collector: c,
		sessions:  sm,
		limiter:   auth.NewRateLimiter(pollRatePerSec, pollRateBurst, rateLimiterIdleTTL),
	}
}

// RunCleanup reclaims the rate-limit buckets of sessions that stopped
// polling, until ctx is done.
func (h *Handler) RunCleanup(ctx context.Context) {
	h.limiter.RunCleanup(ctx)
}

// WithStepUp requires a valid step-up proof on every request to this endpoint.
func (h *Handler) WithStepUp(s *auth.StepUp) *Handler {
	h.stepUp = s
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.sessions.ValidateSession(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Checked after the session, because the proof is bound to the session
	// and there is nothing to verify until there is one.
	if h.stepUp != nil && !h.stepUp.Enforce(w, h.sessions.GetSessionID(r), r.Header.Get(auth.StepUpHeader)) {
		return
	}

	sessionID := h.sessions.GetSessionID(r)
	// Keyed on the session rather than the address: a session is what the
	// endpoint's cost is attributable to, and one client may legitimately have
	// more than one session (two devices, two browsers) without either of them
	// eating the other's budget.
	if !h.limiter.Allow(auth.TokenPrefix(sessionID)) {
		log.Printf("telemetry throttled: session_prefix=%s remote=%s",
			auth.TokenPrefix(sessionID), h.sessions.IPForLog(r))
		auth.AllowTooManyRequests(w)
		return
	}

	body, ok := h.snapshot()
	if !ok {
		http.Error(w, "no telemetry yet", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	// The payload is a point-in-time reading; letting a cache keep it would
	// show a stale dashboard to whoever refreshed after another browser did.
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(body)
}

// snapshot returns the encoded snapshot, reusing the previous encoding while it
// is younger than CacheTTL. The second bool reports whether a snapshot exists
// at all.
func (h *Handler) snapshot() ([]byte, bool) {
	now := time.Now()

	h.mu.Lock()
	if h.cached != nil && now.Sub(h.cachedAt) < CacheTTL {
		body := h.cached
		h.mu.Unlock()
		return body, true
	}
	h.mu.Unlock()

	// Encoding happens outside the lock: Latest() is a pointer read and the
	// encoder is pure, so two requests racing here produce byte-identical
	// output and the second writer's result simply overwrites the first.
	snap := h.collector.Latest()
	if snap == nil {
		return nil, false
	}
	body, err := json.Marshal(snap)
	if err != nil {
		return nil, false
	}

	h.mu.Lock()
	h.cached, h.cachedAt = body, now
	h.mu.Unlock()
	return body, true
}
