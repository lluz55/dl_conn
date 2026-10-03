package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Default /auth rate limit. Ten requests a second sustained, twenty in a burst:
// comfortably above what a real login flow (a page load, a couple of asset
// requests, one redemption) ever needs, and far below what a token oracle
// needs to be useful.
const (
	defaultRatePerSec     = 10
	defaultRateBurst      = 20
	rateLimiterIdleTTL    = 5 * time.Minute
)

// AuthHandler is the HTTP handler for the /auth endpoint.
type AuthHandler struct {
	tokens   *TokenManager
	sessions *SessionManager
	limiter  *RateLimiter
}

// NewAuthHandler creates a new AuthHandler with the default /auth rate limit.
func NewAuthHandler(tokens *TokenManager, sessions *SessionManager) *AuthHandler {
	return NewAuthHandlerWithRateLimit(tokens, sessions, defaultRatePerSec, defaultRateBurst)
}

// NewAuthHandlerWithRateLimit creates a new AuthHandler bounding how fast one
// client address may reach the token-redemption path.
func NewAuthHandlerWithRateLimit(tokens *TokenManager, sessions *SessionManager, perSec float64, burst int) *AuthHandler {
	return &AuthHandler{
		tokens:   tokens,
		sessions: sessions,
		limiter:  NewRateLimiter(perSec, burst, rateLimiterIdleTTL),
	}
}

// RunCleanup reclaims rate-limit buckets for clients that stopped calling,
// until ctx is done.
func (h *AuthHandler) RunCleanup(ctx context.Context) {
	h.limiter.RunCleanup(ctx)
}

// TokenHeader is the request header a non-browser client uses to present a
// one-time token. It exists so a native app can redeem a token without a
// cookie jar and without a token in a URL — the two things that leak it. Like
// the session cookie it is a bearer credential, so it is only meaningful over
// the tunnel's TLS, and it is never forwarded to a proxied service.
const TokenHeader = "X-Dl-Conn-Token"

// getTokenSunset is the date after which GET /auth?token=… stops being served.
// Advertised in the Sunset response header so anything driving the endpoint
// programmatically can migrate to POST or the token header before the legacy
// path is removed, rather than discovering it as a sudden 404.
const getTokenSunset = "Wed, 01 Jul 2026 00:00:00 GMT"

// HandleAuth redeems a one-time token and issues a session cookie.
//
// Three ways in, in the order they are read: the X-Dl-Conn-Token header (any
// method), the `token` query parameter (GET/HEAD), and the request body
// (POST, form-encoded or JSON).
//
// The body and header forms exist because a token in a URL is a token in
// browser history, in cloudflared's and the service's access logs, and in the
// Referer of anything the landing page loads. GET stays supported for the one
// release the Sunset header promises, and answers with a Warning so a client
// that ignores Sunset still learns it is on a deprecated path.
//
// On success: GET/HEAD redirect (302) to the redirect target; a form-POST
// submission redirects (303) the same way, so the Set-Cookie on that
// response lands in a first-party context (see IsFormSubmission for the
// why); a fetch() POST answers 200 with the target as JSON because
// following a redirect would hand it the SPA shell.
// On failure: a browser navigating to a stale link is sent to the login page
// carrying where it was headed (see RedirectToLogin), so an expired service
// link ends at "log in and continue" rather than on a raw error page.
// Everything else still gets the machine-readable 400/401.
func (h *AuthHandler) HandleAuth(w http.ResponseWriter, r *http.Request) {
	// Already authenticated in this browser (e.g. a second service link reusing
	// the same one-time token after the first one consumed it): honor the
	// existing session instead of failing on token replay.
	//
	// Deliberately ahead of the rate limiter: this path validates a cookie
	// this daemon issued and mutates nothing, and the SPA re-entering /auth
	// with a live session is normal traffic, not something to throttle.
	if h.sessions.ValidateSession(r) {
		redirect := r.URL.Query().Get("redirect")
		if r.Method == http.MethodPost {
			if _, postRedirect, err := postCredentials(r); err == nil && postRedirect != "" {
				redirect = postRedirect
			}
		}
		h.issue(w, r, redirect, true)
		return
	}

	token, redirect, err := h.readCredentials(r)
	if err != nil {
		log.Printf("auth failed: remote=%s reason=%v", h.sessions.logRequestIP(r), err)
		h.reject(w, r, redirect, http.StatusBadRequest, credentialErrorText(err))
		return
	}

	// The limiter sits here, immediately before the token map is touched:
	// redemption both consumes a token and, on success, mints a session. That
	// is the work an unauthenticated caller can force at will, and it is the
	// reason /auth is rate limited per client address.
	if !h.limiter.Allow(clientKey(r)) {
		log.Printf("auth throttled: remote=%s token_prefix=%s",
			h.sessions.logRequestIP(r), TokenPrefix(token))
		AllowTooManyRequests(w)
		return
	}

	if ok, reason := h.tokens.ConsumeWithReason(token); !ok {
		log.Printf("auth failed: remote=%s reason=%s token_prefix=%s",
			h.sessions.logRequestIP(r), consumeReasonText(reason), TokenPrefix(token))
		// An expired or already-spent token is the ordinary end of a shared
		// link's life, not an attack: the token TTL is minutes while the
		// link outlives it in a bookmark, a chat message, or a second tab.
		// Sending the browser to the login page turns that into a login
		// that resumes the trip, instead of a dead end the user can only
		// escape by finding the SPA themselves.
		// POST as a top-level form submission is a real navigation and gets
		// the same login bounce as GET. fetch() POSTs stay on the machine-
		// readable 401 path.
		if r.Method == http.MethodPost && !IsFormSubmission(r) {
			http.Error(w, "invalid or expired token", http.StatusUnauthorized)
			return
		}
		if IsDocumentNavigation(r) || IsFormSubmission(r) {
			RedirectToLogin(w, r, redirect)
			return
		}
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	sessionID := h.sessions.CreateSession(r)
	h.sessions.SetSessionCookie(w, sessionID)

	h.issue(w, r, redirect, false)
}

// errMissingToken distinguishes "no token anywhere" from "the body was
// unreadable", which need different answers.
var errMissingToken = errors.New("missing token parameter")

// readCredentials extracts the token and the intended destination from a
// request, without ever consulting more than one of them.
func (h *AuthHandler) readCredentials(r *http.Request) (token, redirect string, err error) {
	// The header wins: it is the only form that keeps the secret out of
	// every log line in the chain, so a client that used it meant it.
	if headerToken := r.Header.Get(TokenHeader); headerToken != "" {
		return headerToken, r.URL.Query().Get("redirect"), nil
	}

	switch r.Method {
	case http.MethodPost:
		token, redirect, err = postCredentials(r)
	default:
		token = r.URL.Query().Get("token")
		redirect = r.URL.Query().Get("redirect")
	}
	if err != nil {
		return "", "", err
	}
	if token == "" {
		return "", redirect, errMissingToken
	}
	return token, redirect, nil
}

// reject answers a request that never got as far as a token comparison.
//
// A browser navigating to a broken or stale link is sent to the login page
// with its destination attached, so the trip it was making can be resumed
// after a fresh redemption; a top-level form POST is a navigation too and
// gets the same bounce. A plain POST (fetch/XHR) keeps the machine-readable
// status, because following a redirect would be handed the SPA shell where
// it asked for a status.
func (h *AuthHandler) reject(w http.ResponseWriter, r *http.Request, redirect string, status int, message string) {
	if r.Method != http.MethodPost && IsDocumentNavigation(r) {
		RedirectToLogin(w, r, redirect)
		return
	}
	if r.Method == http.MethodPost && IsFormSubmission(r) {
		RedirectToLogin(w, r, redirect)
		return
	}
	http.Error(w, message, status)
}

// credentialErrorText renders why no token could be read from a request.
func credentialErrorText(err error) string {
	if errors.Is(err, errMissingToken) {
		return "token parameter required"
	}
	return "malformed request"
}

// postCredentials reads the token and redirect from a form-encoded or JSON
// body. The body is read at most once and always size-capped: /auth is
// reachable without any credential, so an unbounded ReadAll here is a free
// memory-exhaustion primitive.
func postCredentials(r *http.Request) (token, redirect string, err error) {
	const maxBody = 8 << 10
	if r.ContentLength > maxBody {
		return "", "", errors.New("request body too large")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		return "", "", fmt.Errorf("reading request body: %w", err)
	}
	ct := r.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(ct)
	switch mediaType {
	case "application/json":
		var payload struct {
			Token    string `json:"token"`
			Redirect string `json:"redirect"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return "", "", fmt.Errorf("decoding JSON body: %w", err)
		}
		return payload.Token, payload.Redirect, nil
	case "", "application/x-www-form-urlencoded":
		form, err := url.ParseQuery(string(body))
		if err != nil {
			return "", "", fmt.Errorf("decoding form body: %w", err)
		}
		return form.Get("token"), form.Get("redirect"), nil
	default:
		return "", "", fmt.Errorf("unsupported content type %q", mediaType)
	}
}

// issue finishes a successful redemption: a redirect for a browser
// navigation, a JSON body for a fetch(). reuse is true when the caller
// already had a valid session and no new token was spent.
func (h *AuthHandler) issue(w http.ResponseWriter, r *http.Request, redirectParam string, reuse bool) {
	// A real browser navigation (GET, HEAD, or a top-level form POST) gets a
	// redirect; the only other POST caller is a fetch() that needs the target
	// as JSON because following a 302 would hand it the SPA shell. 303 on the
	// form-POST path is what makes the Set-Cookie on the response land in a
	// first-party context, which is the only way the SPA on a non-tunnel
	// origin can establish a session in modern Chrome.
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		markDeprecatedGet(w)
		http.Redirect(w, r, SafeRedirect(redirectParam), http.StatusFound)
		return
	}
	if IsFormSubmission(r) {
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, SafeRedirect(redirectParam), http.StatusSeeOther)
		return
	}
	target := SafeRedirect(redirectParam)
	w.Header().Set("Content-Type", "application/json")
	if reuse {
		w.Header().Set("X-Dl-Conn-Session", "reused")
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"redirect": target})
}

// markDeprecatedGet flags the legacy GET form without changing its behavior.
// Warning: 299 is the deprecating agent telling the client this answer is a
// temporary substitute for the POST form, which is the RFC 7234 reading of it.
func markDeprecatedGet(w http.ResponseWriter) {
	w.Header().Set("Sunset", getTokenSunset)
	w.Header().Set("Warning", `299 - "Use POST /auth or the `+TokenHeader+` header; GET with a token query parameter is deprecated"`)
}

// HandleLogout processes POST /auth/logout: revokes the caller's session
// server-side and clears its cookie, so a device can end its own tunnel
// access on demand instead of relying on the idle timeout to eventually
// expire it. Idempotent — a missing or already-invalid session still
// returns success, since the end state (no session) is the same either way.
func (h *AuthHandler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	h.sessions.Invalidate(h.sessions.GetSessionID(r))
	h.sessions.ClearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// SafeRedirect reduces a caller-supplied redirect target to a same-origin path,
// falling back to "/" for anything else.
//
// The dangerous shapes are the ones a browser resolves against a *different*
// origin even though they look path-like: "//evil.com" and "/\evil.com" are
// both protocol-relative once normalized, and an absolute URL carries its own
// host. Parsing the value and requiring an empty Scheme and Host rejects all
// of them without having to enumerate the spellings by hand.
func SafeRedirect(redirect string) string {
	const fallback = "/"

	if redirect == "" {
		return fallback
	}
	// Backslashes are normalized to "/" by browsers, so treat them as such
	// before parsing rather than letting url.Parse keep them in the path.
	if strings.ContainsAny(redirect, `\`) {
		return fallback
	}
	u, err := url.Parse(redirect)
	if err != nil {
		return fallback
	}
	// Scheme or Host set means the target is not same-origin. Host is also
	// non-empty for "//evil.com", which is what the previous check let through.
	if u.Scheme != "" || u.Host != "" || u.Opaque != "" {
		return fallback
	}
	if !strings.HasPrefix(u.Path, "/") {
		return fallback
	}

	out := u.EscapedPath()
	if u.RawQuery != "" {
		out += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		out += "#" + u.EscapedFragment()
	}
	return out
}

// tokenPrefix returns a short, non-sensitive prefix of a token for log correlation
// without leaking the full secret.
func TokenPrefix(token string) string {
	const n = 8
	if len(token) <= n {
		return token
	}
	return token[:n] + "…"
}

// consumeReasonText renders a ConsumeResult as a precise log/diagnosis string.
// Distinguishing "already used" from "expired" matters: a one-time token
// consumed twice (e.g. a duplicated request) looks identical to the client
// as an expiry, but is really a replay of an already-spent token.
func consumeReasonText(reason ConsumeResult) string {
	switch reason {
	case ConsumeUnknown:
		return "unknown token (never issued or already cleaned up)"
	case ConsumeAlreadyUsed:
		return "token already used (one-time token replayed)"
	case ConsumeExpired:
		return "token expired (past TTL)"
	default:
		return "rejected"
	}
}
