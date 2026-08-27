package tunnel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeTunnelOutput simulates cloudflared output containing an ephemeral URL.
const fakeTunnelOutput = `2024-01-01T00:00:00Z INF Starting tunnel...
2024-01-01T00:00:00Z INF Initial protocol h2mux
2024-01-01T00:00:01Z WRN The provided namespace "default" is not a valid UUID
2024-01-01T00:00:01Z TUNNEL Starting to connect...
2024-01-01T00:00:02Z TUNNEL: https://abcd-1234-5678.trycloudflare.com
2024-01-01T00:00:02Z TUNNEL Connected to edge
`

func TestNewManager_StoresArbitraryTarget(t *testing.T) {
	// NewManager must accept any target URL verbatim — a LAN host for a
	// service's own direct tunnel (ServiceConfig.DirectTunnel), not just
	// dl_conn's own "http://127.0.0.1:<port>".
	m := NewManager("cloudflared", "http://10.0.66.1:5000")
	if m.target != "http://10.0.66.1:5000" {
		t.Errorf("target = %q, want %q", m.target, "http://10.0.66.1:5000")
	}
}

func TestScannerExtractsURL(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		w.Write([]byte(fakeTunnelOutput))
		w.Close()
	}()

	m := &Manager{
		binary:    "cloudflared",
		target:    "http://127.0.0.1:9099",
		notifyURL: make(chan string, 1),
	}

	m.scanOutput(nil, r)

	select {
	case u := <-m.notifyURL:
		if u != "https://abcd-1234-5678.trycloudflare.com" {
			t.Fatalf("got %q, want expected URL", u)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for URL")
	}
}

func TestScannerIgnoresLinesWithoutURL(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		w.Write([]byte("line without url\nanother line\n"))
		w.Close()
	}()

	m := &Manager{
		binary:    "cloudflared",
		target:    "http://127.0.0.1:9099",
		notifyURL: make(chan string, 1),
	}

	m.scanOutput(nil, r)

	select {
	case <-m.notifyURL:
		t.Fatal("should not have received a URL")
	default:
	}
}

func TestRegexDoesNotMatchNonCloudflare(t *testing.T) {
	cases := []string{
		"https://example.com",
		"https://foo.cloudflare.com",
		"http://bar.trycloudflare.com",
	}
	for _, c := range cases {
		if tunnelURLRegex.MatchString(c) {
			t.Errorf("regex should not match %q", c)
		}
	}
}

func TestWaitReady_SucceedsOnFirstGoodResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if !WaitReady(context.Background(), srv.URL, 2*time.Second, nil) {
		t.Fatal("WaitReady = false, want true for a server answering 200")
	}
}

func TestWaitReady_TreatsNon5xxAsReady(t *testing.T) {
	// A 404 still proves Cloudflare's edge is routing to the origin — this
	// isn't checking the origin's own correctness, just reachability.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if !WaitReady(context.Background(), srv.URL, 2*time.Second, nil) {
		t.Fatal("WaitReady = false, want true for a 404 (still a real response)")
	}
}

func TestWaitReady_RetriesUntil5xxClears(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.WriteHeader(http.StatusBadGateway) // simulates Cloudflare's own "not routed yet" page
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	start := time.Now()
	if !WaitReady(context.Background(), srv.URL, 5*time.Second, nil) {
		t.Fatal("WaitReady = false, want true once the 502s clear")
	}
	if calls < 3 {
		t.Errorf("calls = %d, want at least 3 (retried through the 502s)", calls)
	}
	if elapsed := time.Since(start); elapsed < 2*readyPollInterval {
		t.Errorf("elapsed = %v, want at least %v (should have actually retried, not returned instantly)", elapsed, 2*readyPollInterval)
	}
}

func TestWaitReady_TimesOutWhenNeverReachable(t *testing.T) {
	if WaitReady(context.Background(), "http://127.0.0.1:1", 1500*time.Millisecond, nil) {
		t.Fatal("WaitReady = true, want false for an address nothing listens on")
	}
}

func TestWaitReady_RespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	if WaitReady(ctx, "http://127.0.0.1:1", 30*time.Second, nil) {
		t.Fatal("WaitReady = true, want false for an already-cancelled context")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("elapsed = %v, want WaitReady to return promptly on cancellation, not wait out the timeout", elapsed)
	}
}

func TestWaitReady_OnAttemptReceivesDiagnostics(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 2 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	var details []string
	onAttempt := func(elapsed time.Duration, detail string) {
		details = append(details, detail)
	}
	if !WaitReady(context.Background(), srv.URL, 3*time.Second, onAttempt) {
		t.Fatal("WaitReady = false, want true")
	}
	if len(details) < 2 {
		t.Fatalf("onAttempt called %d times, want at least 2", len(details))
	}
	if details[0] != "status 502" {
		t.Errorf("first attempt detail = %q, want %q", details[0], "status 502")
	}
	if last := details[len(details)-1]; last != "status 200" {
		t.Errorf("last attempt detail = %q, want %q", last, "status 200")
	}
}

func TestWaitReady_OnAttemptReportsNetworkErrors(t *testing.T) {
	var details []string
	onAttempt := func(elapsed time.Duration, detail string) {
		details = append(details, detail)
	}
	WaitReady(context.Background(), "http://127.0.0.1:1", 1500*time.Millisecond, onAttempt)
	if len(details) == 0 {
		t.Fatal("onAttempt was never called")
	}
	if !strings.Contains(details[0], "request failed") {
		t.Errorf("detail = %q, want it to mention the connection failure", details[0])
	}
}

func TestShutdownNilCmd(t *testing.T) {
	m := &Manager{}
	err := m.Shutdown(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
