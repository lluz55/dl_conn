package auth

import (
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
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token parameter required", http.StatusBadRequest)
		return
	}

	if !h.tokens.Consume(token) {
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	sessionID := h.sessions.CreateSession()
	h.sessions.SetSessionCookie(w, sessionID)

	redirect := r.URL.Query().Get("redirect")
	if redirect == "" {
		redirect = "/"
	}
	if !strings.HasPrefix(redirect, "/") {
		redirect = "/"
	}
	// prevent open redirect
	if strings.Contains(redirect, "//") && !strings.HasPrefix(redirect, "//") {
		redirect = "/"
	}
	_ = url.PathEscape(redirect)

	http.Redirect(w, r, redirect, http.StatusFound)
}
