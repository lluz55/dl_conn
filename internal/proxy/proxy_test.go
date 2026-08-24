package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/config"
)

func TestRouter_ProtectedRouteWithoutAuth(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	rt := NewRouter(testServices(), sm)

	req := httptest.NewRequest("GET", "/hass/api/states", nil)
	w := httptest.NewRecorder()

	rt.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d (Forbidden)", w.Code, http.StatusForbidden)
	}
}

func TestRouter_WithValidSession(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	// Set up a mock backend
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello from backend"))
	}))
	defer backend.Close()

	// Create router with the mock backend as target
	services := testServices()
	for i := range services {
		if services[i].ID == "hass" {
			services[i].Target = backend.URL
		}
	}
	rt := NewRouter(services, sm)

	// Create a session
	sessionID := sm.CreateSession()

	req := httptest.NewRequest("GET", "/hass/api/states", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	w := httptest.NewRecorder()

	rt.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestRouter_ServiceMatching(t *testing.T) {
	rt := NewRouter(testServices(), nil)

	tests := []struct {
		path     string
		wantID   string
		wantMatch bool
	}{
		{"/hass/api/websocket", "hass", true},
		{"/frigate/", "frigate", true},
		{"/zigbee2mqtt", "zigbee2mqtt", true},
		{"/unknown", "", false},
	}

	for _, tt := range tests {
		svc := rt.matchService(tt.path)
		if tt.wantMatch {
			if svc == nil {
				t.Errorf("matchService(%q): expected match, got nil", tt.path)
			} else if svc.ID != tt.wantID {
				t.Errorf("matchService(%q): got %q, want %q", tt.path, svc.ID, tt.wantID)
			}
		} else {
			if svc != nil {
				t.Errorf("matchService(%q): expected nil, got %q", tt.path, svc.ID)
			}
		}
	}
}

func TestRouter_AuthBypassForAuthEndpoint(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	rt := NewRouter(testServices(), sm)

	req := httptest.NewRequest("GET", "/auth?token=abc&redirect=/hass", nil)
	w := httptest.NewRecorder()

	rt.ServeHTTP(w, req)

	// Should not be 403 — the /auth path is handled by AuthHandler
	if w.Code == http.StatusForbidden {
		t.Error("/auth endpoint should not be blocked by Zero-Trust middleware")
	}
}

func TestRouter_StaticPathBypass(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	rt := NewRouter(testServices(), sm)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	rt.ServeHTTP(w, req)

	if w.Code == http.StatusForbidden {
		t.Error("static root path should not be blocked")
	}
}

func TestRequireAuth_AllowsValidSession(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	rt := NewRouter(testServices(), sm)
	sessionID := sm.CreateSession()

	called := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/protected", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	w := httptest.NewRecorder()

	rt.RequireAuth(handler).ServeHTTP(w, req)

	if !called {
		t.Error("handler should have been called with valid session")
	}
}

func TestRequireAuth_BlocksNoSession(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	rt := NewRouter(testServices(), sm)

	called := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	req := httptest.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()

	rt.RequireAuth(handler).ServeHTTP(w, req)

	if called {
		t.Error("handler should not be called without session")
	}
	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func testServices() []config.ServiceConfig {
	return []config.ServiceConfig{
		{ID: "hass", Name: "Home Assistant", Prefix: "/hass", Target: "http://127.0.0.1:8123", StripPrefix: true, Websocket: true},
		{ID: "frigate", Name: "Frigate", Prefix: "/frigate", Target: "http://127.0.0.1:5000", StripPrefix: true, Websocket: false},
		{ID: "zigbee2mqtt", Name: "Zigbee2MQTT", Prefix: "/zigbee2mqtt", Target: "http://127.0.0.1:8080", StripPrefix: true, Websocket: false},
	}
}
