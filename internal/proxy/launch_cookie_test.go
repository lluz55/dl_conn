package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/config"
)

func TestLaunchCookieRootAPIRoutingAndIsolation(t *testing.T) {
	var received string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.Header.Get("Cookie")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	services := []config.ServiceConfig{
		{ID: "dsh", Prefix: "/dsh", Target: backend.URL, StripPrefix: true, LaunchTokenFile: "/unused"},
		{ID: "other", Prefix: "/other", Target: backend.URL, StripPrefix: true},
	}
	sm := auth.NewSessionManager(time.Hour)
	rt := NewRouter(services, sm)
	session := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	name := launchCookieName(&services[0])
	for _, path := range []string{"/api/directoryPicker/list", "/other/api"} {
		req := httptest.NewRequest("POST", path, nil)
		req.Header.Set("Referer", "http://example.com/dsh/")
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: session})
		req.AddCookie(&http.Cookie{Name: name, Value: "signed"})
		req.AddCookie(&http.Cookie{Name: "ordinary", Value: "preserved"})
		w := httptest.NewRecorder()
		rt.ServeHTTP(w, req)
		parsed := &http.Request{Header: http.Header{"Cookie": []string{received}}}
		_, err := parsed.Cookie(name)
		if (err == nil) != (path == "/api/directoryPicker/list") {
			t.Fatalf("credential routing incorrect for %s", path)
		}
		if _, err := parsed.Cookie("ordinary"); err != nil {
			t.Fatal("ordinary cookie lost")
		}
		if w.Code != http.StatusOK {
			t.Fatalf("status %d", w.Code)
		}
	}
}

func TestLegacyPrefixCookieDoesNotSuppressMigrationBootstrap(t *testing.T) {
	svc := &config.ServiceConfig{Target: "http://127.0.0.1:3080"}
	req := httptest.NewRequest(http.MethodGet, "/dsh/", nil)
	req.AddCookie(&http.Cookie{Name: launchCookieName(svc), Value: "legacy"})
	if hasBootstrappedLaunchSession(req, svc) {
		t.Fatal("legacy auth cookie without marker suppressed bootstrap")
	}
	req.AddCookie(&http.Cookie{Name: launchBootstrapCookieName(svc), Value: "1"})
	if !hasBootstrappedLaunchSession(req, svc) {
		t.Fatal("proxy-issued auth cookie and marker did not suppress bootstrap")
	}
}
