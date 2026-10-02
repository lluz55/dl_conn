package auth

import (
	"context"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimiter is a per-key token bucket. Keys are client addresses for /auth
// and session IDs for the telemetry endpoint — anything an attacker can
// rotate cheaply should never be the key, and anything a legitimate caller
// must not be able to exhaust the map over should be.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	perSec  rate.Limit
	burst   int
	// idleTTL is how long a bucket survives without being touched. Buckets
	// are one small allocation per distinct key, and the key space (client
	// addresses) is attacker-controlled, so they have to be reclaimable or a
	// distributed scan of source addresses is a slow memory leak.
	idleTTL time.Duration
}

type bucket struct {
	lim    *rate.Limiter
	seenAt time.Time
}

func NewRateLimiter(perSec float64, burst int, idleTTL time.Duration) *RateLimiter {
	if perSec <= 0 {
		perSec = 10
	}
	if burst <= 0 {
		burst = 20
	}
	if idleTTL <= 0 {
		idleTTL = 5 * time.Minute
	}
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		perSec:  rate.Limit(perSec),
		burst:   burst,
		idleTTL: idleTTL,
	}
}

// Allow reports whether key may proceed under its own bucket.
func (rl *RateLimiter) Allow(key string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{lim: rate.NewLimiter(rl.perSec, rl.burst)}
		rl.buckets[key] = b
	}
	b.seenAt = now
	return b.lim.Allow()
}

// Cleanup drops buckets untouched for longer than idleTTL. The janitor runs
// far less often than the TTL so that a burst of new keys costs one map walk,
// not one walk per key.
func (rl *RateLimiter) Cleanup() {
	cutoff := time.Now().Add(-rl.idleTTL)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for k, b := range rl.buckets {
		if b.seenAt.Before(cutoff) {
			delete(rl.buckets, k)
		}
	}
}

// RunCleanup reclaims idle buckets until ctx is done. Callers wire this once
// at startup rather than per handler, so the janitor is a single goroutine per
// limiter instead of one per request path.
func (rl *RateLimiter) RunCleanup(ctx context.Context) {
	ticker := time.NewTicker(rl.idleTTL)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rl.Cleanup()
		}
	}
}

// AllowTooManyRequests answers a throttled request. Retry-After is part of the
// contract 429 carries: a client that is being throttled on purpose can wait
// instead of retrying into the same limit.
func AllowTooManyRequests(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "1")
	http.Error(w, "too many requests", http.StatusTooManyRequests)
}

// clientKey identifies the caller for rate limiting. ClientIP is used rather
// than RemoteAddr for the same reason sessions bind to it: cloudflared
// connects over loopback, so RemoteAddr alone would put every caller in the
// world behind one shared bucket.
func clientKey(r *http.Request) string {
	return ClientIP(r)
}
