package telemetry

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
)

func TestIntegration_FullSessionFlow(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()

	// Simulate the proxy.NewRouter session path: create a session, then call
	// the telemetry handler with that cookie. Verify the JSON contains the
	// expected fields.
	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))

	h := NewHandler(collector, sm)
	req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{`"sampled_at"`, `"uptime_s"`} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q: %s", want, body)
		}
	}
}

func TestIntegration_BearerHeader(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()

	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))

	h := NewHandler(collector, sm)
	req := httptest.NewRequest("GET", "/api/host/telemetry", nil)
	req.Header.Set("Authorization", "Bearer "+sid)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status=%d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}
