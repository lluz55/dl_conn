package auth

import (
	"crypto/rand"
	"encoding/base64"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

// SessionManager manages in-memory session cookies with sliding expiration.
type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	ttl      time.Duration
}

// Session represents an authenticated user session.
type Session struct {
	ID        string
	CreatedAt time.Time
	LastSeen  time.Time
	// IP is the client address that redeemed the one-time token to create
	// this session (see ClientIP). ValidateSession requires every later
	// request carrying the session cookie to come from the same address, so
	// a copied/leaked cookie alone isn't enough to keep the tunnel-wide
	// access it grants — see docs/okf/concepts/security.md.
	IP string
}

// NewSessionManager creates a SessionManager with the given session TTL.
func NewSessionManager(ttl time.Duration) *SessionManager {
	sm := &SessionManager{
		sessions: make(map[string]*Session),
		ttl:      ttl,
	}
	go sm.cleanupLoop()
	return sm
}

// CreateSession creates a new session bound to r's client address and
// returns its ID.
func (sm *SessionManager) CreateSession(r *http.Request) string {
	b := make([]byte, 32)
	rand.Read(b)
	id := base64.URLEncoding.EncodeToString(b)

	now := time.Now()
	sm.mu.Lock()
	sm.sessions[id] = &Session{
		ID:        id,
		CreatedAt: now,
		LastSeen:  now,
		IP:        ClientIP(r),
	}
	sm.mu.Unlock()
	return id
}

// ValidateSession checks whether r carries a live session cookie for a
// session still within its TTL and originating from the same client address
// it was created from, sliding its expiration forward on success.
func (sm *SessionManager) ValidateSession(r *http.Request) bool {
	sessionID := sm.GetSessionID(r)
	if sessionID == "" {
		return false
	}
	ip := ClientIP(r)

	sm.mu.Lock()
	defer sm.mu.Unlock()

	s, ok := sm.sessions[sessionID]
	if !ok {
		return false
	}
	if time.Since(s.LastSeen) > sm.ttl {
		delete(sm.sessions, sessionID)
		return false
	}
	if s.IP != ip {
		// Not deleted: a stolen cookie shouldn't be able to evict the
		// legitimate session, and a legitimate client whose address
		// genuinely changed (Wi-Fi/cellular handoff, ISP re-IP) just needs
		// to redeem a fresh token rather than losing the session outright.
		log.Printf("session denied: id_prefix=%s bound_ip=%s request_ip=%s reason=ip mismatch",
			tokenPrefix(sessionID), s.IP, ip)
		return false
	}
	s.LastSeen = time.Now() // sliding renewal
	return true
}

// Invalidate removes a session immediately, regardless of TTL. Used by
// /auth/logout so a device holding the session can end its own access
// on demand instead of waiting out the idle timeout.
func (sm *SessionManager) Invalidate(sessionID string) {
	if sessionID == "" {
		return
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	delete(sm.sessions, sessionID)
}

// ClientIP extracts the address of the actual client that reached
// cloudflared, not the tunnel-local connection that reaches dl_conn itself
// (cloudflared always connects to the origin over localhost, so RemoteAddr
// alone is useless for this — every request would look like it came from
// the same machine). Cloudflare's edge sets Cf-Connecting-Ip on every
// request that reaches cloudflared and it cannot be spoofed by the client
// past the edge, which is the only path into dl_conn's HTTP server.
//
// Deliberately not falling back to X-Forwarded-For: unlike Cf-Connecting-Ip
// it's an ordinary header cloudflared just passes through, so anyone talking
// to dl_conn directly (LAN access without going through the tunnel) could
// set it themselves and impersonate any address. RemoteAddr is the only safe
// fallback for that case.
func ClientIP(r *http.Request) string {
	if ip := r.Header.Get("Cf-Connecting-Ip"); ip != "" {
		return ip
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// SetSessionCookie writes a secure session cookie to the response.
func (sm *SessionManager) SetSessionCookie(w http.ResponseWriter, sessionID string) {
	cookie := &http.Cookie{
		Name:     "dl_conn_session",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sm.ttl.Seconds()),
	}
	http.SetCookie(w, cookie)
}

// ClearSessionCookie overwrites the session cookie with an already-expired
// one, so the browser drops it immediately instead of resending an
// invalidated session ID on its next request.
func (sm *SessionManager) ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "dl_conn_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// GetSessionID extracts the session ID from the request cookie or
// Authorization Bearer header.
func (sm *SessionManager) GetSessionID(r *http.Request) string {
	// Check cookie
	cookie, err := r.Cookie("dl_conn_session")
	if err == nil && cookie.Value != "" {
		return cookie.Value
	}
	// Check Authorization header
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:]
	}
	return ""
}

func (sm *SessionManager) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		sm.Cleanup()
	}
}

// Cleanup removes expired sessions.
func (sm *SessionManager) Cleanup() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	now := time.Now()
	for id, s := range sm.sessions {
		if now.Sub(s.LastSeen) > sm.ttl {
			delete(sm.sessions, id)
		}
	}
}
