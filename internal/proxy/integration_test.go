package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/config"
)

// TestZeroTrust_NoAccessWithoutAuth simulates a relay request to a
// protected service without authentication.
func TestIntegration_ZeroTrustBlocksUnauthenticated(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	services := []config.ServiceConfig{
		{ID: "hass", Name: "HA", Prefix: "/hass", Target: "http://127.0.0.1:8123", StripPrefix: true, Websocket: true},
	}
	rt := NewRouter(services, sm)

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("backend should never be reached without auth")
	}))
	defer backend.Close()
	rt.services[0].Target = backend.URL
	rt.rebuildProxy(0)

	// Request without any cookie or bearer token
	req := httptest.NewRequest("GET", "/hass/api/states", nil)
	w := httptest.NewRecorder()
	rt.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
}

// TestIntegration_FullAuthFlow tests the complete flow:
// token issuance → /auth endpoint → cookie set → reverse proxy access.
func TestIntegration_FullAuthFlow(t *testing.T) {
	tm := auth.NewTokenManager(120 * time.Second)
	sm := auth.NewSessionManager(4 * time.Hour)
	ah := auth.NewAuthHandler(tm, sm)

	// Issue a token
	token, _, _ := tm.Issue()

	// Step 1: authenticate via /auth
	req := httptest.NewRequest("GET", "/auth?token="+token+"&redirect=/hass/", nil)
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("auth: status = %d, want %d", w.Code, http.StatusFound)
	}

	// Extract session cookie
	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "dl_conn_session" {
			sessionCookie = c
		}
	}
	if sessionCookie == nil {
		t.Fatal("no session cookie set")
	}

	// Step 2: access protected service with cookie
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend reached"))
	}))
	defer backend.Close()

	services := []config.ServiceConfig{
		{ID: "hass", Name: "HA", Prefix: "/hass", Target: backend.URL, StripPrefix: true, Websocket: true},
	}
	rt := NewRouter(services, sm)
	rt.services[0].Target = backend.URL
	rt.rebuildProxy(0)

	req2 := httptest.NewRequest("GET", "/hass/api/states", nil)
	req2.AddCookie(sessionCookie)
	w2 := httptest.NewRecorder()
	rt.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("proxied request: status = %d, want %d", w2.Code, http.StatusOK)
	}
	if !strings.Contains(w2.Body.String(), "backend reached") {
		t.Errorf("body = %q, want to contain backend response", w2.Body.String())
	}
}
