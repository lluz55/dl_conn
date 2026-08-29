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
