package tunnel

import (
	"os"
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

func TestShutdownNilCmd(t *testing.T) {
	m := &Manager{}
	err := m.Shutdown(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
