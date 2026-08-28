package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// The access-log wrapper sits in front of every proxied request, so a
// ResponseWriter it can't hand over kills WebSocket upgrades: Frigate's
// event socket came back as a 502 ("can't switch protocols using
// non-Hijacker ResponseWriter type *main.statusRecorder") for every attempt.
func TestLoggingMiddleware_AllowsWebSocketUpgrade(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(loggingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		defer conn.Close()
		_ = conn.WriteMessage(websocket.TextMessage, []byte("hello"))
	})))
	defer srv.Close()

	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(msg) != "hello" {
		t.Errorf("message = %q, want %q", msg, "hello")
	}
}

// A hijacked connection never goes through WriteHeader, so without the
// recorder noticing the handover the access log would report the upgrade as
// a plain 200.
func TestStatusRecorder_RecordsUpgradeAndUnwraps(t *testing.T) {
	var rec *statusRecorder
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec = &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		if rec.Unwrap() != w {
			t.Error("Unwrap did not return the wrapped ResponseWriter")
		}
		conn, _, err := rec.Hijack()
		if err != nil {
			t.Errorf("Hijack failed: %v", err)
			return
		}
		conn.Close()
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err == nil {
		resp.Body.Close()
	}
	if rec == nil || rec.status != http.StatusSwitchingProtocols {
		t.Errorf("recorded status = %v, want %d", rec, http.StatusSwitchingProtocols)
	}
}
