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
		name     string
		path     string
		referer  string
		wantID   string
		wantMatch bool
	}{
		{"direct hass prefix", "/hass/api/websocket", "", "hass", true},
		{"direct frigate prefix", "/frigate/", "", "frigate", true},
		{"direct zigbee2mqtt prefix", "/zigbee2mqtt", "", "zigbee2mqtt", true},
		{"unknown path, no referer", "/unknown", "", "", false},
		{"root-absolute asset, frigate referer", "/assets/index-Qpl7Np-l.js", "https://tunnel.example/frigate/", "frigate", true},
		{"root-absolute favicon, hass referer", "/favicon.ico", "https://tunnel.example/hass/dashboard", "hass", true},
		{"root-absolute asset, unmatched referer", "/assets/x.js", "https://tunnel.example/unknown", "", false},
		{"root-absolute asset, unparseable referer", "/assets/x.js", "://bad-url", "", false},
	}

	for _, tt := range tests {
		req := httptest.NewRequest("GET", tt.path, nil)
		if tt.referer != "" {
			req.Header.Set("Referer", tt.referer)
		}
		svc := rt.matchService(req)
		if tt.wantMatch {
			if svc == nil {
				t.Errorf("%s: matchService(%q, referer=%q): expected match, got nil", tt.name, tt.path, tt.referer)
			} else if svc.ID != tt.wantID {
				t.Errorf("%s: matchService(%q, referer=%q): got %q, want %q", tt.name, tt.path, tt.referer, svc.ID, tt.wantID)
			}
		} else {
			if svc != nil {
				t.Errorf("%s: matchService(%q, referer=%q): expected nil, got %q", tt.name, tt.path, tt.referer, svc.ID)
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

func TestRewriteAssetPaths(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"double-quoted script src", `<script src="/assets/main-DUVUnF6L.js"></script>`, `<script src="/frigate/assets/main-DUVUnF6L.js"></script>`},
		{"single-quoted", `href='/assets/index-ADwqpRot.css'`, `href='/frigate/assets/index-ADwqpRot.css'`},
		{"backtick template literal", "`/assets/chunk.js`", "`/frigate/assets/chunk.js`"},
		{"css url() unquoted", `background: url(/assets/font.woff2)`, `background: url(/frigate/assets/font.woff2)`},
		{"untouched unrelated text", `see /assets-info page`, `see /assets-info page`},
	}
	for _, tt := range tests {
		got := string(rewriteAssetPaths([]byte(tt.in), "/frigate"))
		if got != tt.want {
			t.Errorf("%s: rewriteAssetPaths(%q) = %q, want %q", tt.name, tt.in, got, tt.want)
		}
	}
}

func TestIsRewritableContentType(t *testing.T) {
	tests := []struct {
		ct   string
		want bool
	}{
		{"text/html; charset=utf-8", true},
		{"text/css", true},
		{"application/javascript", true},
		{"application/manifest+json", true},
		{"application/json", false},
		{"image/svg+xml", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := isRewritableContentType(tt.ct); got != tt.want {
			t.Errorf("isRewritableContentType(%q) = %v, want %v", tt.ct, got, tt.want)
		}
	}
}

func TestRouter_RewritesAssetPathsInProxiedHTML(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/assets/main.js" {
			w.Header().Set("Content-Type", "application/javascript")
			w.Write([]byte("console.log('ok')"))
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<script src="/assets/main.js"></script>`))
	}))
	defer backend.Close()

	services := []config.ServiceConfig{
		{ID: "frigate", Name: "Frigate", Prefix: "/frigate", Target: backend.URL, StripPrefix: true, Websocket: false},
	}
	rt := NewRouter(services, sm)
	sessionID := sm.CreateSession()

	// The HTML entrypoint should come back with the asset path rewritten
	// under the service's prefix.
	req := httptest.NewRequest("GET", "/frigate/", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	w := httptest.NewRecorder()
	rt.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("html request: status = %d, want %d", w.Code, http.StatusOK)
	}
	body := w.Body.String()
	if !strings.Contains(body, `src="/frigate/assets/main.js"`) {
		t.Errorf("body = %q, want rewritten src pointing at /frigate/assets/main.js", body)
	}

	// The rewritten URL must then actually resolve through the proxy.
	req2 := httptest.NewRequest("GET", "/frigate/assets/main.js", nil)
	req2.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	w2 := httptest.NewRecorder()
	rt.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("rewritten asset request: status = %d, want %d", w2.Code, http.StatusOK)
	}
}

func testServices() []config.ServiceConfig {
	return []config.ServiceConfig{
		{ID: "hass", Name: "Home Assistant", Prefix: "/hass", Target: "http://127.0.0.1:8123", StripPrefix: true, Websocket: true},
		{ID: "frigate", Name: "Frigate", Prefix: "/frigate", Target: "http://127.0.0.1:5000", StripPrefix: true, Websocket: false},
		{ID: "zigbee2mqtt", Name: "Zigbee2MQTT", Prefix: "/zigbee2mqtt", Target: "http://127.0.0.1:8080", StripPrefix: true, Websocket: false},
	}
}
