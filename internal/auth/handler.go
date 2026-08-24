package auth

import (
	"log"
	"net/http"
	"net/url"
	"strings"
)

// AuthHandler is the HTTP handler for the /auth endpoint.
type AuthHandler struct {
	tokens *TokenManager
	sessions *SessionManager
}

// NewAuthHandler creates a new AuthHandler.
func NewAuthHandler(tokens *TokenManager, sessions *SessionManager) *AuthHandler {
	return &AuthHandler{tokens: tokens, sessions: sessions}
}

// HandleAuth processes GET /auth?token=...&redirect=...
// On success: issues session cookie, redirects (302) to redirect target.
// On failure: returns 401.
func (h *AuthHandler) HandleAuth(w http.ResponseWriter, r *http.Request) {
	// Already authenticated in this browser (e.g. a second service link reusing
	// the same one-time token after the first one consumed it): honor the
	// existing session instead of failing on token replay.
	if h.sessions.ValidateSession(h.sessions.GetSessionID(r)) {
		h.redirect(w, r)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		log.Printf("auth failed: remote=%s reason=missing token parameter", r.RemoteAddr)
		http.Error(w, "token parameter required", http.StatusBadRequest)
		return
	}

	if ok, reason := h.tokens.ConsumeWithReason(token); !ok {
		log.Printf("auth failed: remote=%s reason=%s token_prefix=%s",
			r.RemoteAddr, consumeReasonText(reason), tokenPrefix(token))
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	sessionID := h.sessions.CreateSession()
	h.sessions.SetSessionCookie(w, sessionID)

	h.redirect(w, r)
}

func (h *AuthHandler) redirect(w http.ResponseWriter, r *http.Request) {
	redirect := safeRedirect(r.URL.Query().Get("redirect"))
	http.Redirect(w, r, redirect, http.StatusFound)
}

// safeRedirect reduces a caller-supplied redirect target to a same-origin path,
// falling back to "/" for anything else.
//
// The dangerous shapes are the ones a browser resolves against a *different*
// origin even though they look path-like: "//evil.com" and "/\evil.com" are
// both protocol-relative once normalized, and an absolute URL carries its own
// host. Parsing the value and requiring an empty Scheme and Host rejects all
// of them without having to enumerate the spellings by hand.
func safeRedirect(redirect string) string {
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
func tokenPrefix(token string) string {
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
