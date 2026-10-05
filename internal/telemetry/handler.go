package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
	"dl_conn/internal/store"
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

// defaultHistoryWindow is how far back a range request that carries no "from"
// reaches. A dashboard asking for "the last while" should get a chart, not the
// whole retention window at once.
const defaultHistoryWindow = time.Hour

// maxRangePoints caps how many samples one range request may return, and is
// also the ceiling for the ?points= override. It exists because a chart draws
// a fixed number of pixels across the window: at the default 10s collection
// interval the 7-day window holds ~60k samples, and answering a chart with all
// of them meant ~25 MB of JSON per request, ~200 ms of main-thread parse in
// the browser, and a read that pinned the store's single connection for the
// whole transfer — stalling the very inserts that feed the chart. 720 keeps
// several multiples of what the SPA draws (240) at a payload a phone over a
// tunnel opens instantly.
const maxRangePoints = 720

// Handler serves GET /api/host/telemetry behind session auth.
type Handler struct {
	collector *sensors.Collector
	sessions  *auth.SessionManager
	tokens    *auth.TokenManager
	// stepUp, when non-nil, gates the endpoint behind a step-up proof in
	// addition to the session (see auth.stepUp). It is opt-in via
	// auth.stepUpProtected.
	stepUp *auth.StepUp

	// store, when non-nil, backs the ?from=/?to= history query. It is opt-in
	// via WithStore, exactly like stepUp, because the handler can serve the
	// latest reading straight from the collector without a DB behind it.
	store *store.Store

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

// WithStore gives the handler a SQLite history to answer ?from=/?to= from.
// Without it a range request is refused rather than silently answered with the
// latest reading, which would look like a chart that lost its history.
func (h *Handler) WithStore(s *store.Store) *Handler {
	h.store = s
	return h
}

// WithTokens allows bearer token authentication using one-time tokens issued by
// Nostr discovery (or tokenManager), enabling cross-origin telemetry polling
// and history queries from static clients like GitHub Pages.
func (h *Handler) WithTokens(tm *auth.TokenManager) *Handler {
	h.tokens = tm
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Dl-Conn-StepUp")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.Header().Set("Vary", "Origin")
	}

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	authKey := ""
	if h.sessions != nil && h.sessions.ValidateSession(r) {
		authKey = h.sessions.GetSessionID(r)
	} else if h.tokens != nil {
		bearer := extractBearer(r)
		if bearer != "" && h.tokens.Validate(bearer) {
			authKey = bearer
		}
	}

	if authKey == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Checked after the session/token, because the proof is bound to the credential
	// and there is nothing to verify until there is one.
	if h.stepUp != nil && !h.stepUp.Enforce(w, authKey, r.Header.Get(auth.StepUpHeader)) {
		return
	}

	// Keyed on the credential rather than the address: a session or token is what
	// the endpoint's cost is attributable to, and one client may legitimately have
	// more than one session (two devices, two browsers) without either of them
	// eating the other's budget.
	if !h.limiter.Allow(auth.TokenPrefix(authKey)) {
		logRemote := r.RemoteAddr
		if h.sessions != nil {
			logRemote = h.sessions.IPForLog(r)
		}
		log.Printf("telemetry throttled: auth_prefix=%s remote=%s",
			auth.TokenPrefix(authKey), logRemote)
		auth.AllowTooManyRequests(w)
		return
	}

	// A range request is a different question from a poll — it wants a series
	// rather than the point in time — so it is answered from SQLite and never
	// from the single-snapshot cache. With no ?from= and no ?to= the poll
	// below is served exactly as before.
	from, to, points, wantRange, err := parseRange(r)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if wantRange {
		h.serveRange(w, from, to, points)
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

// parseRange reads the ?from= / ?to= bounds, both Unix seconds to match the
// resolution telemetry_samples.ts is stored with, plus the optional ?points=
// cap on how many samples the answer may hold. The bool reports whether a
// range was asked for at all; with neither bound present the caller keeps the
// original single-snapshot behaviour. ?points= alone does not make it a range
// request — a cap with no window has nothing to bound.
//
// A bound that is present but unparseable is an error rather than a fallback:
// silently answering a chart request with "the latest reading" would look like
// a history that emptied itself.
//
// A missing bound defaults so that a partial request is still bounded: without
// "from" the window is the last defaultHistoryWindow (a whole retention window
// would be an unbounded response for one query), and without "to" the window
// ends now, so an open-ended "from" follows the live edge.
//
// ?points= is clamped rather than rejected: asking for more than the ceiling
// is a client that does not know the cap yet, and the honest answer is the cap
// itself, not a failed request. Only a value that is not an integer at all is
// a 400, matching the other params.
func parseRange(r *http.Request) (from, to time.Time, points int, want bool, err error) {
	query := r.URL.Query()
	rawFrom, rawTo := query.Get("from"), query.Get("to")
	points = maxRangePoints
	if rawPoints := query.Get("points"); rawPoints != "" {
		n, perr := strconv.Atoi(rawPoints)
		if perr != nil {
			return time.Time{}, time.Time{}, 0, true, errors.New(`invalid "points": want an integer`)
		}
		points = n
	}
	if rawFrom == "" && rawTo == "" {
		return time.Time{}, time.Time{}, points, false, nil
	}
	now := time.Now()
	if rawFrom == "" {
		from = now.Add(-defaultHistoryWindow)
	} else if secs, perr := strconv.ParseInt(rawFrom, 10, 64); perr != nil {
		return time.Time{}, time.Time{}, 0, true, errors.New(`invalid "from": want unix seconds`)
	} else {
		from = time.Unix(secs, 0)
	}
	if rawTo == "" {
		to = now
	} else if secs, perr := strconv.ParseInt(rawTo, 10, 64); perr != nil {
		return time.Time{}, time.Time{}, 0, true, errors.New(`invalid "to": want unix seconds`)
	} else {
		to = time.Unix(secs, 0)
	}
	return from, to, clampPoints(points), true, nil
}

// clampPoints folds a requested cap into [1, maxRangePoints].
func clampPoints(n int) int {
	if n < 1 {
		return 1
	}
	if n > maxRangePoints {
		return maxRangePoints
	}
	return n
}

// serveRange writes the samples in [from, to] as a JSON array, oldest first,
// bucketed down to at most `points` samples. An empty window is a 200 with []
// — unlike the latest-snapshot path, "nothing was recorded in that range" is
// an answer, not a missing reading.
func (h *Handler) serveRange(w http.ResponseWriter, from, to time.Time, points int) {
	if h.store == nil {
		writeJSONError(w, http.StatusNotImplemented, "telemetry history is not available")
		return
	}
	snaps, err := h.store.RangeBucketed(from, to, points)
	if err != nil {
		log.Printf("telemetry range query failed: from=%d to=%d points=%d err=%v", from.Unix(), to.Unix(), points, err)
		writeJSONError(w, http.StatusInternalServerError, "telemetry history unavailable")
		return
	}
	body, err := json.Marshal(snaps)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "telemetry history unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(body)
}

// writeJSONError answers with a small JSON body so a client parsing errors as
// JSON never trips over the plain-text form http.Error writes.
func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// extractBearer extracts the token from an "Authorization: Bearer <token>" header.
func extractBearer(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) > 7 && strings.EqualFold(authHeader[:7], "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	return ""
}

