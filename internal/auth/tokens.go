package auth

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"
)

// TokenManager issues and validates one-time-use tokens with strict TTL.
type TokenManager struct {
	mu      sync.Mutex
	tokens  map[string]tokenEntry
	ttl     time.Duration
}

type tokenEntry struct {
	createdAt time.Time
	used      bool
}

// NewTokenManager creates a TokenManager with the given one-time token TTL.
func NewTokenManager(ttl time.Duration) *TokenManager {
	return &TokenManager{
		tokens: make(map[string]tokenEntry),
		ttl:    ttl,
	}
}

// Issue creates a new cryptographically-secure one-time token.
func (m *TokenManager) Issue() (string, time.Duration, error) {
	b := make([]byte, 32) // 256-bit CSPRNG
	if _, err := rand.Read(b); err != nil {
		return "", 0, err
	}
	token := base64.URLEncoding.EncodeToString(b)

	m.mu.Lock()
	m.tokens[token] = tokenEntry{createdAt: time.Now()}
	m.mu.Unlock()

	return token, m.ttl, nil
}

// Consume validates and marks a token as used. Returns false if the token
// is invalid, expired, or already consumed.
func (m *TokenManager) Consume(token string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, ok := m.tokens[token]
	if !ok {
		return false
	}
	if entry.used {
		return false
	}
	if time.Since(entry.createdAt) > m.ttl {
		delete(m.tokens, token)
		return false
	}
	m.tokens[token] = tokenEntry{
		createdAt: entry.createdAt,
		used:      true,
	}
	return true
}

// Cleanup removes expired tokens.
func (m *TokenManager) Cleanup() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for k, v := range m.tokens {
		if now.Sub(v.createdAt) > m.ttl {
			delete(m.tokens, k)
		}
	}
}
