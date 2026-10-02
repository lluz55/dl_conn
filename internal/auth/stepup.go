package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// StepUpWindow is how long one step-up proof stays usable. The proof is
// time-bucketed rather than individually expiring so that verification is a
// constant-time HMAC comparison instead of a lookup: the daemon accepts the
// current bucket and the one before it, which gives a client that just missed
// a boundary a grace period instead of a spurious 401.
const StepUpWindow = 5 * time.Minute

// StepUpHeader is the request header carrying a step-up proof.
const StepUpHeader = "X-Dl-Conn-StepUp"

// StepUpPath is the endpoint that mints step-up proofs for the caller's
// current session.
const StepUpPath = "/api/auth/stepup"

// StepUp mints and verifies the short-lived proofs that gate sensitive
// endpoints behind a fresh confirmation.
//
// The proof is HMAC-SHA256 over the session ID, a server secret held only in
// memory, and a coarse timestamp, so it is bound to one session, unforgeable
// without the secret, and useless in a different session. A stolen session
// cookie alone stops being enough to read a step-up-protected endpoint: the
// attacker also has to reach this daemon to have the proof minted, and the
// proof they get dies with the session it was minted for.
//
// The server secret is generated per process and never persisted, so a restart
// invalidates every outstanding proof — which is the correct behavior, not a
// drawback.
type StepUp struct {
	secret []byte
	ttl    time.Duration
}

// NewStepUp builds a verifier with a fresh random server secret.
func NewStepUp() (*StepUp, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generating step-up secret: %w", err)
	}
	return &StepUp{secret: secret, ttl: StepUpWindow}, nil
}

// NewStepUpWithSecret builds a verifier around an existing secret. Tests use
// it to get a stable verifier; production goes through NewStepUp.
func NewStepUpWithSecret(secret []byte) *StepUp {
	return &StepUp{secret: secret, ttl: StepUpWindow}
}

// bucket is the coarse time slot a proof belongs to. Dividing by the window
// rather than embedding a timestamp is what makes an old proof impossible to
// replay outside its bucket: a captured header from bucket N only verifies
// while the clock is in bucket N or N+1.
func (s *StepUp) bucket(now time.Time) int64 {
	return now.UnixNano() / int64(s.ttl)
}

// proof computes the expected value for one session and bucket.
func (s *StepUp) proof(sessionID string, bucket int64) string {
	mac := hmac.New(sha256.New, s.secret)
	// Length-prefix the session ID implicitly by writing it last with a
	// separator: two different (sessionID, bucket) pairs can never produce the
	// same input string, so one cannot borrow the other's proof.
	fmt.Fprintf(mac, "%d|%s", bucket, sessionID)
	return hex.EncodeToString(mac.Sum(nil))
}

// Issue returns a proof valid for the current window.
func (s *StepUp) Issue(sessionID string, now time.Time) string {
	return s.proof(sessionID, s.bucket(now))
}

// Verify reports whether proof is a valid, in-window step-up for sessionID.
func (s *StepUp) Verify(sessionID, proof string, now time.Time) bool {
	if sessionID == "" || proof == "" {
		return false
	}
	b := s.bucket(now)
	for _, candidate := range []int64{b, b - 1} {
		if hmac.Equal([]byte(s.proof(sessionID, candidate)), []byte(proof)) {
			return true
		}
	}
	return false
}

// Enforce answers 401 unless proof is a valid, in-window step-up for
// sessionID. Callers must have established that r carries that session; this
// is the second, time-bounded check on top of it.
func (s *StepUp) Enforce(w http.ResponseWriter, sessionID, proof string) bool {
	if s.Verify(sessionID, proof, time.Now()) {
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"step-up required"}`))
	return false
}

// StepUpHandler issues step-up proofs to an already-authenticated caller.
type StepUpHandler struct {
	sessions *SessionManager
	stepUp   *StepUp
}

// NewStepUpHandler wires the proof endpoint to a session manager and verifier.
func NewStepUpHandler(sessions *SessionManager, stepUp *StepUp) *StepUpHandler {
	return &StepUpHandler{sessions: sessions, stepUp: stepUp}
}

// ServeHTTP mints a step-up proof for the caller's current session.
//
// POST only: minting is a state-changing act from the browser's point of view
// (it arms a privilege for the next few minutes), and accepting it on a GET
// would let any cross-site <img> arm it using the session cookie attached by
// the browser. SameSite=Lax already blocks the cookie on a cross-site
// subrequest, but the method is the part that makes the intent checkable.
func (h *StepUpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sessionID := h.sessions.GetSessionID(r)
	if sessionID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"header": StepUpHeader,
		"value":  h.stepUp.Issue(sessionID, time.Now()),
		"ttlSec": int(h.stepUp.ttl.Seconds()),
	})
}
