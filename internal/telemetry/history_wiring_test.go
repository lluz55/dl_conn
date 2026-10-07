package telemetry_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/store"
	"dl_conn/internal/telemetry"
)

// TestHostHistory_StoreSatisfiesBothRecorders is the wiring assertion the unit
// tests on each recorder cannot make: that one *store.Store can back both the
// probe history and the tunnel history, so main.go needs a single open
// database rather than two.
func TestHostHistory_StoreSatisfiesBothRecorders(t *testing.T) {
	st, err := store.New(t.TempDir() + "/both.db")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = st.Close() }()

	now := time.Now()
	rec := &dualRecorder{store: st}
	rec.recordHealth(now, map[string]string{"a": store.StatusUp, "b": store.StatusDown})
	rec.recordTunnel(now, "https://a.trycloudflare.com")

	services, err := st.RangeServiceHealth(now.Add(-time.Hour), now.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	if len(services["a"]) != 1 || len(services["b"]) != 1 {
		t.Errorf("both services were recorded: %+v", services)
	}
	tunnel, err := st.RangeTunnelIncarnations(now.Add(-time.Hour), now.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(tunnel) != 1 {
		t.Errorf("incarnations = %d, want 1", len(tunnel))
	}
}

type dualRecorder struct{ store *store.Store }

func (d *dualRecorder) recordHealth(ts time.Time, statuses map[string]string) {
	if err := d.store.RecordServiceHealth(ts, statuses); err != nil {
		panic(err)
	}
}
func (d *dualRecorder) recordTunnel(ts time.Time, url string) {
	if err := d.store.RecordTunnelIncarnation(ts, url); err != nil {
		panic(err)
	}
}

// TestHostHistory_RoundTripThroughTheRoute writes through the recorder and
// reads back through the HTTP route, so the JSON the dashboard receives is
// checked against what actually went in.
func TestHostHistory_RoundTripThroughTheRoute(t *testing.T) {
	st, err := store.New(t.TempDir() + "/rt.db")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = st.Close() }()

	base := time.Now().Add(-2 * time.Hour)
	// 6 rounds, 10 minutes apart; service "a" is down for the middle two.
	for i := 0; i < 6; i++ {
		status := store.StatusUp
		if i == 2 || i == 3 {
			status = store.StatusDown
		}
		if err := st.RecordServiceHealth(base.Add(time.Duration(i)*10*time.Minute), map[string]string{"a": status}); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	if err := st.RecordTunnelIncarnation(base, "https://old.trycloudflare.com"); err != nil {
		t.Fatalf("tunnel: %v", err)
	}
	if err := st.RecordTunnelIncarnation(base.Add(time.Hour), "https://new.trycloudflare.com"); err != nil {
		t.Fatalf("tunnel: %v", err)
	}

	sm := auth.NewSessionManager(time.Hour)
	h := telemetry.NewHandler(nil, sm).WithStore(st)
	mux := http.NewServeMux()
	mux.Handle("/api/host/history", h)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	sessReq := httptest.NewRequest("GET", "/", nil)
	sessReq.RemoteAddr = "127.0.0.1:54321"
	sid := sm.CreateSession(sessReq)

	from := base.Add(-time.Hour).Unix()
	req, _ := http.NewRequest("GET", srv.URL+"/api/host/history?from="+strconv.FormatInt(from, 10), nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d: %s", resp.StatusCode, body)
	}
	var got historyBody
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if n := len(got.Services["a"]); n != 6 {
		t.Errorf("service series has %d points, want 6", n)
	}
	// The window is one hour wide with 720 buckets, so the whole 10-minute
	// spacing stays distinct and the outage must survive the round trip.
	downs := 0
	for _, p := range got.Services["a"] {
		if p.Status == store.StatusDown {
			downs++
		}
	}
	if downs != 2 {
		t.Errorf("got %d down points, want 2 — an outage must not be smoothed away in transit", downs)
	}
	if len(got.Tunnel) != 2 {
		t.Errorf("tunnel incarnations = %d, want 2", len(got.Tunnel))
	}
	if got.Tunnel[0].URL != "https://old.trycloudflare.com" {
		t.Errorf("oldest incarnation = %q", got.Tunnel[0].URL)
	}
	if got.Tunnel[0].EndedAt == nil || got.Tunnel[1].EndedAt != nil {
		t.Error("exactly the current incarnation is open")
	}
}