package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
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
		{"i18next loadPath template", `loadPath:"/locales/{{lng}}/{{ns}}.json"`, `loadPath:"/frigate/locales/{{lng}}/{{ns}}.json"`},
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

func TestRouter_SetsXIngressPathHeader(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	var gotHeader string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("X-Ingress-Path")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	services := testServices()
	for i := range services {
		if services[i].ID == "frigate" {
			services[i].Target = backend.URL
		}
	}
	rt := NewRouter(services, sm)
	sessionID := sm.CreateSession()

	req := httptest.NewRequest("GET", "/frigate/", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	w := httptest.NewRecorder()
	rt.ServeHTTP(w, req)

	if gotHeader != "/frigate" {
		t.Errorf("X-Ingress-Path = %q, want %q", gotHeader, "/frigate")
	}
}

func testServices() []config.ServiceConfig {
	return []config.ServiceConfig{
		{ID: "hass", Name: "Home Assistant", Prefix: "/hass", Target: "http://127.0.0.1:8123", StripPrefix: true, Websocket: true},
		{ID: "frigate", Name: "Frigate", Prefix: "/frigate", Target: "http://127.0.0.1:5000", StripPrefix: true, Websocket: false},
		{ID: "zigbee2mqtt", Name: "Zigbee2MQTT", Prefix: "/zigbee2mqtt", Target: "http://127.0.0.1:8080", StripPrefix: true, Websocket: false},
	}
}

func TestLiftRootPath(t *testing.T) {
	rootPaths := []string{"/locales/"}
	tests := []struct {
		name string
		path string
		want string
	}{
		{"already at root", "/locales/en/common.json", "/locales/en/common.json"},
		{"one route segment deep", "/settings/locales/en/common.json", "/locales/en/common.json"},
		{"several segments deep", "/settings/cameras/front/locales/en/views/settings.json", "/locales/en/views/settings.json"},
		{"repeated directory name", "/locales/x/locales/en/common.json", "/locales/en/common.json"},
		{"unrelated path untouched", "/api/version", "/api/version"},
		{"no trailing directory match", "/api/locales", "/api/locales"},
	}
	for _, tt := range tests {
		if got := liftRootPath(tt.path, rootPaths); got != tt.want {
			t.Errorf("%s: liftRootPath(%q) = %q, want %q", tt.name, tt.path, got, tt.want)
		}
	}

	if got := liftRootPath("/settings/locales/en/common.json", nil); got != "/settings/locales/en/common.json" {
		t.Errorf("no rootPaths declared: liftRootPath rewrote %q", got)
	}
}

// Frigate asks for its i18next bundles relative to whatever SPA route is in
// the address bar, so the same file arrives at several depths — and at the
// origin root with no Referer when the document itself sits at "/frigate".
// All of them have to reach the backend's own "/locales/…".
func TestRouter_RoutesRootPathsAtAnyDepth(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	var gotPath string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer backend.Close()

	services := testServices()
	for i := range services {
		if services[i].ID == "frigate" {
			services[i].Target = backend.URL
			services[i].RootPaths = []string{"/locales/"}
		}
	}
	rt := NewRouter(services, sm)
	sessionID := sm.CreateSession()

	tests := []struct {
		name    string
		path    string
		referer string
	}{
		{"under the service prefix", "/frigate/locales/en/common.json", ""},
		{"under a nested SPA route", "/frigate/settings/cameras/locales/en/common.json", ""},
		{"at the origin root with a referer", "/locales/en/common.json", "https://tunnel.example/frigate"},
		{"at the origin root without a referer", "/locales/en/common.json", ""},
	}
	for _, tt := range tests {
		gotPath = ""
		req := httptest.NewRequest("GET", tt.path, nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		if tt.referer != "" {
			req.Header.Set("Referer", tt.referer)
		}
		w := httptest.NewRecorder()
		rt.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("%s: GET %q: status = %d, want %d", tt.name, tt.path, w.Code, http.StatusOK)
		}
		if gotPath != "/locales/en/common.json" {
			t.Errorf("%s: GET %q: backend saw %q, want %q", tt.name, tt.path, gotPath, "/locales/en/common.json")
		}
	}
}

// The SPA file server owns "/", so without RootFallback a proxied SPA's
// root-absolute sub-resource requests are answered with its 404 and never
// reach the router at all.
func TestRootFallback(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("from backend"))
	}))
	defer backend.Close()

	services := testServices()
	for i := range services {
		if services[i].ID == "frigate" {
			services[i].Target = backend.URL
			services[i].RootPaths = []string{"/locales/"}
		}
	}
	rt := NewRouter(services, sm)
	static := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("from spa"))
	})
	// dl_conn's own frontend has files the bypass list doesn't name.
	spaFiles := http.FS(fstest.MapFS{"js/qr_scanner.js": &fstest.MapFile{Data: []byte("spa module")}})
	h := RootFallback(rt, static, spaFiles)
	sessionID := sm.CreateSession()

	tests := []struct {
		name    string
		path    string
		referer string
		want    string
	}{
		{"spa shell", "/", "", "from spa"},
		{"spa script", "/app.js", "", "from spa"},
		{"spa shell even with a service referer", "/", "https://tunnel.example/frigate/", "from spa"},
		{"unknown path with no referer", "/nothing-here.json", "", "from spa"},
		{"root-absolute asset with a service referer", "/assets/main.js", "https://tunnel.example/frigate/live", "from backend"},
		{"declared root path with no referer", "/locales/en/common.json", "", "from backend"},
	}
	for _, tt := range tests {
		req := httptest.NewRequest("GET", tt.path, nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		if tt.referer != "" {
			req.Header.Set("Referer", tt.referer)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)

		if got := w.Body.String(); got != tt.want {
			t.Errorf("%s: GET %q (referer %q) = %q, want %q", tt.name, tt.path, tt.referer, got, tt.want)
		}
	}
}

// A sub-resource routed through the root fallback is still a proxied
// request: Zero-Trust applies to it exactly as it does under a prefix.
func TestRootFallback_RequiresSession(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	services := testServices()
	for i := range services {
		if services[i].ID == "frigate" {
			services[i].RootPaths = []string{"/locales/"}
		}
	}
	h := RootFallback(NewRouter(services, sm), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("SPA file server should not answer a service sub-resource")
	}), nil)

	req := httptest.NewRequest("GET", "/locales/en/common.json", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d (Forbidden)", w.Code, http.StatusForbidden)
	}
}

// A proxied SPA served at the bare prefix resolves everything one segment
// too high — Frigate's React Router basename invariant throws outright and
// renders a blank page — so a document request for "/frigate" has to be
// redirected to "/frigate/" before it ever reaches the backend.
func TestRouter_RedirectsBarePrefixForDocuments(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	var reached bool
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.Write([]byte("ok"))
	}))
	defer backend.Close()

	services := testServices()
	for i := range services {
		services[i].Target = backend.URL
	}
	services = append(services, config.ServiceConfig{
		ID: "frigate-ws", Prefix: "/ws", Target: backend.URL, Hidden: true, Websocket: true,
	})
	rt := NewRouter(services, sm)
	sessionID := sm.CreateSession()

	tests := []struct {
		name         string
		method       string
		path         string
		accept       string
		upgrade      string
		wantLocation string
	}{
		{"document navigation", "GET", "/frigate", "text/html,application/xhtml+xml", "", "/frigate/"},
		{"document navigation with query", "GET", "/frigate?camera=front", "text/html", "", "/frigate/?camera=front"},
		{"already has the slash", "GET", "/frigate/", "text/html", "", ""},
		{"deeper path", "GET", "/frigate/live", "text/html", "", ""},
		{"sub-resource fetch", "GET", "/frigate", "application/json", "", ""},
		{"websocket handshake", "GET", "/ws", "*/*", "websocket", ""},
		{"hidden service document", "GET", "/ws", "text/html", "", ""},
		{"non-idempotent method", "POST", "/frigate", "text/html", "", ""},
	}
	for _, tt := range tests {
		reached = false
		req := httptest.NewRequest(tt.method, tt.path, nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		req.Header.Set("Accept", tt.accept)
		if tt.upgrade != "" {
			req.Header.Set("Upgrade", tt.upgrade)
		}
		w := httptest.NewRecorder()
		rt.ServeHTTP(w, req)

		if tt.wantLocation == "" {
			if w.Code == http.StatusFound {
				t.Errorf("%s: %s %q: unexpected redirect to %q", tt.name, tt.method, tt.path, w.Header().Get("Location"))
			}
			if !reached {
				t.Errorf("%s: %s %q: request never reached the backend", tt.name, tt.method, tt.path)
			}
			continue
		}
		if w.Code != http.StatusFound {
			t.Errorf("%s: %s %q: status = %d, want %d", tt.name, tt.method, tt.path, w.Code, http.StatusFound)
		}
		if got := w.Header().Get("Location"); got != tt.wantLocation {
			t.Errorf("%s: %s %q: Location = %q, want %q", tt.name, tt.method, tt.path, got, tt.wantLocation)
		}
		if reached {
			t.Errorf("%s: %s %q: redirected request still hit the backend", tt.name, tt.method, tt.path)
		}
	}
}

// RemoteAddr carries a port, so setting X-Forwarded-For from it produced
// "127.0.0.1:50586, 127.0.0.1" once ReverseProxy appended the client IP of
// its own accord — an unparseable header that Home Assistant rejects with
// 400 Bad Request.
func TestRouter_ForwardedForHasNoPort(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	var gotXFF string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotXFF = r.Header.Get("X-Forwarded-For")
	}))
	defer backend.Close()

	services := testServices()
	for i := range services {
		services[i].Target = backend.URL
	}
	rt := NewRouter(services, sm)
	sessionID := sm.CreateSession()

	tests := []struct {
		name    string
		inbound string
		want    string
	}{
		{"no inbound chain", "", "192.0.2.10"},
		{"inbound chain is preserved", "203.0.113.9", "203.0.113.9, 192.0.2.10"},
	}
	for _, tt := range tests {
		gotXFF = ""
		req := httptest.NewRequest("GET", "/hass/api/states", nil)
		req.RemoteAddr = "192.0.2.10:50586"
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		if tt.inbound != "" {
			req.Header.Set("X-Forwarded-For", tt.inbound)
		}
		rt.ServeHTTP(httptest.NewRecorder(), req)

		if gotXFF != tt.want {
			t.Errorf("%s: X-Forwarded-For = %q, want %q", tt.name, gotXFF, tt.want)
		}
	}
}

// Some backends fail every request that carries X-Forwarded-For from a proxy
// they don't trust (Home Assistant answers 400), so a service can opt out.
func TestRouter_ForwardedForCanBeDisabled(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	var present bool
	var value string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		value, present = r.Header.Get("X-Forwarded-For"), r.Header.Get("X-Forwarded-For") != ""
	}))
	defer backend.Close()

	off, on := false, true
	tests := []struct {
		name         string
		forwardedFor *bool
		want         string
	}{
		{"unset sends the header", nil, "192.0.2.10"},
		{"true sends the header", &on, "192.0.2.10"},
		{"false omits the header", &off, ""},
	}
	for _, tt := range tests {
		services := testServices()
		for i := range services {
			services[i].Target = backend.URL
			if services[i].ID == "hass" {
				services[i].ForwardedFor = tt.forwardedFor
			}
		}
		rt := NewRouter(services, sm)
		sessionID := sm.CreateSession()

		present, value = false, ""
		req := httptest.NewRequest("GET", "/hass/api/states", nil)
		req.RemoteAddr = "192.0.2.10:50586"
		// A client-supplied header must not survive the opt-out either.
		req.Header.Set("X-Forwarded-For", "203.0.113.9")
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		rt.ServeHTTP(httptest.NewRecorder(), req)

		if tt.want == "" {
			if present {
				t.Errorf("%s: backend saw X-Forwarded-For = %q, want it absent", tt.name, value)
			}
			continue
		}
		if want := "203.0.113.9, " + tt.want; value != want {
			t.Errorf("%s: X-Forwarded-For = %q, want %q", tt.name, value, want)
		}
	}
}

// Home Assistant serves its whole frontend from the origin root
// ("/static/…", "/frontend_latest/…", "/onboarding.html") and sends
// Referrer-Policy: no-referrer, so neither the prefix nor the Referer can
// attribute those requests. The service cookie is what carries them.
func TestRouter_ServiceCookieRouting(t *testing.T) {
	services := []config.ServiceConfig{
		{ID: "hass", Prefix: "/hass", Target: "http://127.0.0.1:8123", StripPrefix: true},
		{ID: "frigate", Prefix: "/frigate", Target: "http://127.0.0.1:5000", StripPrefix: true, RootPaths: []string{"/locales/"}},
		{ID: "frigate-api", Prefix: "/api", Target: "http://127.0.0.1:5000", Hidden: true},
	}
	rt := NewRouter(services, nil)

	tests := []struct {
		name    string
		path    string
		cookie  string
		referer string
		wantID  string
	}{
		{"root-absolute page with no cookie", "/onboarding.html", "", "", ""},
		{"root-absolute page follows the cookie", "/onboarding.html", "hass", "", "hass"},
		{"root-absolute asset follows the cookie", "/static/icons/favicon.ico", "hass", "", "hass"},
		{"own prefix beats the cookie", "/frigate/live", "hass", "", "frigate"},
		{"referer beats the cookie", "/static/x.js", "hass", "https://tunnel.example/frigate/live", "frigate"},
		{"declared root path beats the cookie", "/locales/en/common.json", "hass", "", "frigate"},
		{"hidden route claims /api with no cookie", "/api/version", "", "", "frigate-api"},
		{"cookie beats the hidden route", "/api/onboarding", "hass", "", "hass"},
		{"cookie for the hidden route's owner", "/api/version", "frigate", "", "frigate"},
		{"unknown service in cookie is ignored", "/onboarding.html", "nope", "", ""},
		{"a hidden service is never the browser's service", "/onboarding.html", "frigate-api", "", ""},
	}
	for _, tt := range tests {
		req := httptest.NewRequest("GET", tt.path, nil)
		if tt.cookie != "" {
			req.AddCookie(&http.Cookie{Name: serviceCookieName, Value: tt.cookie})
		}
		if tt.referer != "" {
			req.Header.Set("Referer", tt.referer)
		}
		svc := rt.matchService(req)
		got := ""
		if svc != nil {
			got = svc.ID
		}
		if got != tt.wantID {
			t.Errorf("%s: matchService(%q, cookie=%q) = %q, want %q", tt.name, tt.path, tt.cookie, got, tt.wantID)
		}
	}
}

func TestRouter_SetsServiceCookieOnNavigation(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer backend.Close()

	services := []config.ServiceConfig{
		{ID: "hass", Prefix: "/hass", Target: backend.URL, StripPrefix: true},
		{ID: "frigate-ws", Prefix: "/ws", Target: backend.URL, Hidden: true},
	}
	rt := NewRouter(services, sm)
	sessionID := sm.CreateSession()

	tests := []struct {
		name   string
		path   string
		accept string
		want   string
	}{
		{"navigation to the service", "/hass/lovelace", "text/html", "hass"},
		{"the bare-prefix redirect carries it too", "/hass", "text/html", "hass"},
		{"sub-resource fetch leaves it alone", "/hass/api/states", "application/json", ""},
		{"hidden service is never the browser's service", "/ws", "text/html", ""},
	}
	for _, tt := range tests {
		req := httptest.NewRequest("GET", tt.path, nil)
		req.Header.Set("Accept", tt.accept)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		w := httptest.NewRecorder()
		rt.ServeHTTP(w, req)

		got := ""
		for _, c := range w.Result().Cookies() {
			if c.Name == serviceCookieName {
				got = c.Value
			}
		}
		if got != tt.want {
			t.Errorf("%s: GET %q set %s=%q, want %q", tt.name, tt.path, serviceCookieName, got, tt.want)
		}
	}
}

// The service cookie sends unmatched root-absolute paths to a proxied
// service, so dl_conn's own frontend files have to be claimed first — they
// are not all named by isSPAPath ("/js/…", "/vendor/…", "/config.json").
func TestRootFallback_SPAFilesBeatTheServiceCookie(t *testing.T) {
	sm := auth.NewSessionManager(4 * time.Hour)
	services := []config.ServiceConfig{
		{ID: "hass", Prefix: "/hass", Target: "http://127.0.0.1:8123", StripPrefix: true},
	}
	rt := NewRouter(services, sm)
	static := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("from spa"))
	})
	files := http.FS(fstest.MapFS{
		"js/qr_scanner.js": &fstest.MapFile{Data: []byte("spa module")},
		"config.json":      &fstest.MapFile{Data: []byte("{}")},
	})
	h := RootFallback(rt, static, files)
	sessionID := sm.CreateSession()

	tests := []struct {
		name string
		path string
		want string
	}{
		{"SPA module", "/js/qr_scanner.js", "from spa"},
		{"SPA config", "/config.json", "from spa"},
		{"path the SPA has no file for goes to the service", "/onboarding.html", ""},
	}
	for _, tt := range tests {
		req := httptest.NewRequest("GET", tt.path, nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		req.AddCookie(&http.Cookie{Name: serviceCookieName, Value: "hass"})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)

		if tt.want == "" {
			// Routed to the (unreachable) backend rather than answered by the SPA.
			if got := w.Body.String(); got == "from spa" {
				t.Errorf("%s: GET %q was answered by the SPA, want it routed to the service", tt.name, tt.path)
			}
			continue
		}
		if got := w.Body.String(); got != tt.want {
			t.Errorf("%s: GET %q = %q, want %q", tt.name, tt.path, got, tt.want)
		}
	}
}
