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
// On failure: a browser navigating to a stale link is sent to the login page
// carrying where it was headed (see RedirectToLogin), so an expired service
// link ends at "log in and continue" rather than on a raw error page.
// Everything else still gets the machine-readable 400/401.
func (h *AuthHandler) HandleAuth(w http.ResponseWriter, r *http.Request) {
	// Already authenticated in this browser (e.g. a second service link reusing
	// the same one-time token after the first one consumed it): honor the
	// existing session instead of failing on token replay.
	if h.sessions.ValidateSession(r) {
		h.redirect(w, r)
		return
	}

	// Where this link was trying to go. Kept across the failure paths below
	// so the login page can finish the trip the user actually asked for.
	next := r.URL.Query().Get("redirect")

	token := r.URL.Query().Get("token")
	if token == "" {
		log.Printf("auth failed: remote=%s reason=missing token parameter", r.RemoteAddr)
		if IsDocumentNavigation(r) {
			RedirectToLogin(w, r, next)
			return
		}
		http.Error(w, "token parameter required", http.StatusBadRequest)
		return
	}

	if ok, reason := h.tokens.ConsumeWithReason(token); !ok {
		log.Printf("auth failed: remote=%s reason=%s token_prefix=%s",
			r.RemoteAddr, consumeReasonText(reason), tokenPrefix(token))
		// An expired or already-spent token is the ordinary end of a shared
		// link's life, not an attack: the token TTL is minutes while the
		// link outlives it in a bookmark, a chat message, or a second tab.
		// Sending the browser to the login page turns that into a login
		// that resumes the trip, instead of a dead end the user can only
		// escape by finding the SPA themselves.
		if IsDocumentNavigation(r) {
			RedirectToLogin(w, r, next)
			return
		}
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	sessionID := h.sessions.CreateSession(r)
	h.sessions.SetSessionCookie(w, sessionID)

	h.redirect(w, r)
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

func (h *AuthHandler) redirect(w http.ResponseWriter, r *http.Request) {
	redirect := SafeRedirect(r.URL.Query().Get("redirect"))
	http.Redirect(w, r, redirect, http.StatusFound)
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
