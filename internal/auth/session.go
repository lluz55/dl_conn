package auth

import (
	"crypto/rand"
	"encoding/base64"
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

// CreateSession creates a new session and returns its ID.
func (sm *SessionManager) CreateSession() string {
	b := make([]byte, 32)
	rand.Read(b)
	id := base64.URLEncoding.EncodeToString(b)

	now := time.Now()
	sm.mu.Lock()
	sm.sessions[id] = &Session{
		ID:        id,
		CreatedAt: now,
		LastSeen:  now,
	}
	sm.mu.Unlock()
	return id
}

// ValidateSession checks if a session cookie is valid and slides its expiration.
// Returns true if valid.
func (sm *SessionManager) ValidateSession(sessionID string) bool {
	if sessionID == "" {
		return false
	}
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
	s.LastSeen = time.Now() // sliding renewal
	return true
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
