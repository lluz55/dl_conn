package telemetry

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
)

func TestHandler_NoSnapshot_503(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second) // no samples
	h := NewHandler(collector, sm)

	// Create a valid session so we don't 401 first.
	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))

	req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("status=%d, want 503", rr.Code)
	}
}

func TestHandler_NoSession_401(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	h := NewHandler(collector, sm)

	req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401", rr.Code)
	}
}

func TestHandler_BadSession_401(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	h := NewHandler(collector, sm)

	req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: "invalid"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401", rr.Code)
	}
}

func TestHandler_WithSnapshot(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce() // populates Latest with empty Snapshot (no /sys on test)

	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))

	req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	rr := httptest.NewRecorder()
	h := NewHandler(collector, sm)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Content-Type") != "application/json" {
		t.Errorf("Content-Type=%q", rr.Header().Get("Content-Type"))
	}
	var snap sensors.Snapshot
	if err := json.NewDecoder(rr.Body).Decode(&snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if snap.SampledAt.IsZero() {
		t.Error("SampledAt is zero")
	}
}

func TestHandler_PostNotAllowed(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	h := NewHandler(collector, sm)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/api/host/telemetry", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status=%d, want 405", rr.Code)
	}
}

// TestTelemetryCacheAndRateLimit covers the two bounds the endpoint now has:
// within a second, several pollers share one encoding; and one session cannot
// turn it into a busy loop.
func TestTelemetryCacheAndRateLimit(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()
	h := NewHandler(collector, sm)

	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	get := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr
	}

	first := get()
	if first.Code != http.StatusOK {
		t.Fatalf("first poll = %d, want 200", first.Code)
	}
	// The first request pays for the encoding; the ones inside the cache TTL
	// are served the same bytes, so a second poll arriving in the same second
	// must not re-encode.
	second := get()
	if second.Code != http.StatusOK {
		t.Fatalf("second poll = %d, want 200", second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Error("a second poll inside the cache TTL returned a different payload")
	}
	if got := first.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store (a cached reading would freeze the dashboard)", got)
	}

	// Burst is 5; the sixth request inside the same second is over budget.
	var throttled *httptest.ResponseRecorder
	for i := 0; i < 12 && throttled == nil; i++ {
		if rr := get(); rr.Code == http.StatusTooManyRequests {
			throttled = rr
		}
	}
	if throttled == nil {
		t.Fatal("a same-session poll loop was never throttled")
	}
	if got := throttled.Header().Get("Retry-After"); got != "1" {
		t.Errorf("Retry-After = %q, want 1", got)
	}
}

// TestHandler_StepUpRequired walks the gated configuration: a session alone is
// not enough once the operator puts this route in auth.stepUpProtected.
func TestHandler_StepUpRequired(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()
	stepUp := auth.NewStepUpWithSecret([]byte("telemetry-step-up-test-secret-value"))
	h := NewHandler(collector, sm).WithStepUp(stepUp)

	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	get := func(proof string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
		if proof != "" {
			req.Header.Set(auth.StepUpHeader, proof)
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr
	}

	if rr := get(""); rr.Code != http.StatusUnauthorized {
		t.Errorf("without a proof = %d, want 401", rr.Code)
	}
	if rr := get("forged-proof"); rr.Code != http.StatusUnauthorized {
		t.Errorf("with a forged proof = %d, want 401", rr.Code)
	}
	if rr := get(stepUp.Issue(sid, time.Now())); rr.Code != http.StatusOK {
		t.Errorf("with a valid proof = %d, want 200", rr.Code)
	}
}
