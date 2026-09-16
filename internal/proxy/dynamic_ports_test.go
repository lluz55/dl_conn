package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"dl_conn/internal/auth"
)

func TestDynamicPortProxyRequiresSession(t *testing.T) {
	h := NewDynamicPortProxy(auth.NewSessionManager(time.Hour), 9099, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/local/8080/", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestDynamicPortProxyForwardsToLoopbackAndStripsPrefix(t *testing.T) {
	var gotPath, gotHost, gotSession string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotHost = r.URL.Path, r.Host
		if c, err := r.Cookie("dl_conn_session"); err == nil {
			gotSession = c.Value
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	u, _ := url.Parse(backend.URL)
	port, _ := strconv.Atoi(u.Port())

	sm := auth.NewSessionManager(time.Hour)
	sid := sm.CreateSession(httptest.NewRequest(http.MethodGet, "/", nil))
	h := NewDynamicPortProxy(sm, 9099, nil)
	req := httptest.NewRequest(http.MethodGet, "/local/"+strconv.Itoa(port)+"/api/value", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if gotPath != "/api/value" {
		t.Errorf("upstream path = %q, want /api/value", gotPath)
	}
	if gotHost != "127.0.0.1:"+strconv.Itoa(port) {
		t.Errorf("upstream Host = %q", gotHost)
	}
	if gotSession != "" {
		t.Error("dl_conn session cookie leaked to dynamic upstream")
	}
}

func TestDynamicPortProxyStripsAuthorizationHeader(t *testing.T) {
	// auth.SessionManager.GetSessionID accepts "Authorization: Bearer
	// <sessionID>" as an alternative to the session cookie. Without
	// stripping it, a caller authenticating that way would have dl_conn's
	// own live session ID forwarded verbatim to the arbitrary loopback
	// backend selected by port, which could replay it against dl_conn's
	// protected routes.
	var gotAuthorization string
	sawHeader := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization, sawHeader = r.Header.Get("Authorization"), r.Header.Get("Authorization") != ""
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	u, _ := url.Parse(backend.URL)
	port, _ := strconv.Atoi(u.Port())

	sm := auth.NewSessionManager(time.Hour)
	sid := sm.CreateSession(httptest.NewRequest(http.MethodGet, "/", nil))
	h := NewDynamicPortProxy(sm, 9099, nil)
	req := httptest.NewRequest(http.MethodGet, "/local/"+strconv.Itoa(port)+"/api/value", nil)
	// Authenticate via bearer (not cookie) so ValidateSession accepts the
	// request, then confirm that exact session ID never reaches the backend.
	req.Header.Set("Authorization", "Bearer "+sid)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if sawHeader {
		t.Errorf("Authorization header leaked to dynamic upstream: %q", gotAuthorization)
	}
}

func TestDynamicPortProxyDeniesSensitivePorts(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	sid := sm.CreateSession(httptest.NewRequest(http.MethodGet, "/", nil))
	h := NewDynamicPortProxy(sm, 9099, []int{8123})
	for _, port := range []int{22, 443, 8123, 9099, 9100} {
		t.Run(strconv.Itoa(port), func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/local/"+strconv.Itoa(port)+"/", nil)
			req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusForbidden, w.Body.String())
			}
		})
	}
}

func TestDynamicPortProxyRejectsWebsocketAndMalformedPaths(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	sid := sm.CreateSession(httptest.NewRequest(http.MethodGet, "/", nil))
	h := NewDynamicPortProxy(sm, 9099, nil)
	for _, tc := range []struct {
		path    string
		upgrade bool
		status  int
	}{
		{"/local/nope/", false, http.StatusNotFound},
		{"/local/70000/", false, http.StatusNotFound},
		{"/local/8080", false, http.StatusNotFound},
		{"/local/8080/", true, http.StatusBadRequest},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
		if tc.upgrade {
			req.Header.Set("Upgrade", "websocket")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Errorf("path %q: status = %d, want %d (%s)", tc.path, w.Code, tc.status, strings.TrimSpace(w.Body.String()))
		}
	}
}
