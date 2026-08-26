package health

import (
	"context"
	"net"
	"testing"
	"time"

	"dl_conn/internal/config"
)

func TestStatusStartsUnknown(t *testing.T) {
	m := New([]config.ServiceConfig{{ID: "hass", Target: "http://127.0.0.1:9"}})
	if got := m.Status("hass"); got != StatusUnknown {
		t.Fatalf("status before probe = %q, want %q", got, StatusUnknown)
	}
	if got := m.Status("missing"); got != StatusUnknown {
		t.Fatalf("unknown id = %q, want %q", got, StatusUnknown)
	}
}

func TestProbeMarksListenerUpAndClosedDown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	m := New([]config.ServiceConfig{
		{ID: "up", Target: "http://" + ln.Addr().String()},
		{ID: "down", Target: "http://127.0.0.1:1"},
		{ID: "bogus", Target: "::not a url"},
	})
	m.timeout = 500 * time.Millisecond
	m.probeAll(context.Background())

	if got := m.Status("up"); got != StatusUp {
		t.Errorf("listening target = %q, want %q", got, StatusUp)
	}
	if got := m.Status("down"); got != StatusDown {
		t.Errorf("closed port = %q, want %q", got, StatusDown)
	}
	if got := m.Status("bogus"); got != StatusDown {
		t.Errorf("unparseable target = %q, want %q", got, StatusDown)
	}
}

func TestHostPortDefaults(t *testing.T) {
	cases := map[string]string{
		"http://example.com":       "example.com:80",
		"https://example.com":      "example.com:443",
		"http://127.0.0.1:8123":    "127.0.0.1:8123",
		"ws://localhost":           "localhost:80",
		"wss://localhost":          "localhost:443",
		"":                         "",
	}
	for in, want := range cases {
		if got := hostPort(in); got != want {
			t.Errorf("hostPort(%q) = %q, want %q", in, got, want)
		}
	}
}
