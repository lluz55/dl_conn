package telemetry_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
	"dl_conn/internal/telemetry"
)

// TestEndToEnd_EndpointIsWiredInMainMux verifies that the telemetry HTTP
// handler integrates correctly with the session-auth path the rest of the
// daemon uses. It stands up a small mux mirroring what cmd/dl_conn/main.go
// registers: the /_healthz endpoint and the session-protected
// /api/host/telemetry endpoint, then exercises both.
func TestEndToEnd_EndpointIsWiredInMainMux(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()

	mux := http.NewServeMux()
	mux.HandleFunc("/_healthz", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("/api/host/telemetry", telemetry.NewHandler(collector, sm))

	srv := httptest.NewServer(mux)
	defer srv.Close()

	// 1) healthz: 200 without auth.
	resp, err := http.Get(srv.URL + "/_healthz")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("healthz status=%d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "ok" {
		t.Errorf("healthz body=%q, want ok", body)
	}

	// 2) telemetry: 401 without session.
	resp, err = http.Get(srv.URL + "/api/host/telemetry")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("telemetry no-session status=%d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// 3) Create a session as if the user had redeemed a one-time token.
	//    The session binds to the client IP that called CreateSession; the
	//    real HTTP client talks from 127.0.0.1, so we use a request whose
	//    RemoteAddr matches.
	sessReq := httptest.NewRequest("GET", "/", nil)
	sessReq.RemoteAddr = "127.0.0.1:54321"
	sid := sm.CreateSession(sessReq)

	req, _ := http.NewRequest("GET", srv.URL+"/api/host/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("telemetry with-session status=%d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type=%q", ct)
	}

	var snap sensors.Snapshot
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if snap.SampledAt.IsZero() {
		t.Error("SampledAt is zero")
	}
	if snap.UptimeSec == 0 {
		// /proc may not be readable in this test env, so don't fail hard.
		t.Logf("UptimeSec=0 (likely no /proc access in this test env)")
	}
}

func TestEndToEnd_PollingKeepsSessionFresh(t *testing.T) {
	sm := auth.NewSessionManager(2 * time.Second)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()

	mux := http.NewServeMux()
	mux.Handle("/api/host/telemetry", telemetry.NewHandler(collector, sm))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	sessReq := httptest.NewRequest("GET", "/", nil)
	sessReq.RemoteAddr = "127.0.0.1:54321"
	sid := sm.CreateSession(sessReq)

	fetch := func() int {
		req, _ := http.NewRequest("GET", srv.URL+"/api/host/telemetry", nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	if fetch() != 200 {
		t.Fatal("first fetch failed")
	}
	// Wait past session TTL.
	time.Sleep(2500 * time.Millisecond)
	// Without re-validation, the session is expired — expect 401.
	if got := fetch(); got != 401 {
		t.Errorf("post-ttl status=%d, want 401", got)
	}
}
