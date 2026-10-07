package telemetry_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
	"dl_conn/internal/store"
	"dl_conn/internal/telemetry"
)

// newHistoryServer stands up a mux mirroring cmd/dl_conn/main.go: one handler
// mounted at both /api/host/telemetry and /api/host/history, behind the same
// session manager.
func newHistoryServer(t *testing.T) (*httptest.Server, *store.Store, string) {
	t.Helper()
	st, err := store.New(t.TempDir() + "/history.db")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()
	h := telemetry.NewHandler(collector, sm).WithStore(st)

	mux := http.NewServeMux()
	mux.Handle("/api/host/telemetry", h)
	mux.Handle("/api/host/history", h)

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	sessReq := httptest.NewRequest("GET", "/", nil)
	sessReq.RemoteAddr = "127.0.0.1:54321"
	sid := sm.CreateSession(sessReq)
	return srv, st, sid
}

func getWithSession(t *testing.T, url, sid string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

type historyBody struct {
	Services map[string][]struct {
		TS     int64  `json:"ts"`
		Status string `json:"status"`
	} `json:"services"`
	Tunnel []struct {
		StartedAt int64  `json:"started_at"`
		EndedAt   *int64 `json:"ended_at"`
		URL       string `json:"url"`
	} `json:"tunnel"`
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

func TestHostHistory_RequiresSession(t *testing.T) {
	srv, _, _ := newHistoryServer(t)
	from := time.Now().Add(-time.Hour).Unix()
	resp, err := http.Get(srv.URL + "/api/host/history?from=" + itoa(from))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no-session status=%d, want 401 — history is as sensitive as the live chart", resp.StatusCode)
	}
}

func TestHostHistory_ServesBothSeries(t *testing.T) {
	srv, st, sid := newHistoryServer(t)

	now := time.Now()
	for i := 0; i < 4; i++ {
		st_ := store.StatusUp
		if i == 1 {
			st_ = store.StatusDown
		}
		if err := st.RecordServiceHealth(now.Add(time.Duration(i-4)*time.Minute), map[string]string{"frigate": st_}); err != nil {
			t.Fatalf("health insert: %v", err)
		}
	}
	if err := st.RecordTunnelIncarnation(now.Add(-30*time.Minute), "https://aaaa.trycloudflare.com"); err != nil {
		t.Fatalf("tunnel insert: %v", err)
	}
	if err := st.RecordTunnelIncarnation(now, "https://bbbb.trycloudflare.com"); err != nil {
		t.Fatalf("tunnel insert: %v", err)
	}

	from := now.Add(-time.Hour).Unix()
	code, body := getWithSession(t, srv.URL+"/api/host/history?from="+itoa(from), sid)
	if code != http.StatusOK {
		t.Fatalf("status=%d, want 200: %s", code, body)
	}
	var got historyBody
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, body)
	}
	if len(got.Services["frigate"]) == 0 {
		t.Error("services.frigate is empty, want the recorded probe rounds")
	}
	if len(got.Tunnel) != 2 {
		t.Errorf("tunnel has %d incarnations, want 2", len(got.Tunnel))
	}
	if got.Tunnel[0].EndedAt == nil {
		t.Error("the superseded incarnation must be closed")
	}
	if got.Tunnel[len(got.Tunnel)-1].EndedAt != nil {
		t.Error("the current incarnation must be open (null)")
	}
	if got.From != from {
		t.Errorf("from=%d, want the requested %d — the client must be able to tell which window it got", got.From, from)
	}
}

// A history request with no window is refused rather than answered with
// everything ever recorded: that would be an unbounded response to a request
// that never asked for one.
func TestHostHistory_NeedsAWindow(t *testing.T) {
	srv, _, sid := newHistoryServer(t)
	code, body := getWithSession(t, srv.URL+"/api/host/history", sid)
	if code != http.StatusBadRequest {
		t.Errorf("status=%d, want 400 without a window: %s", code, body)
	}
}

func TestHostHistory_RejectsUnparseableBounds(t *testing.T) {
	srv, _, sid := newHistoryServer(t)
	for _, q := range []string{"?from=abc", "?to=abc", "?points=abc"} {
		code, body := getWithSession(t, srv.URL+"/api/host/history"+q, sid)
		if code != http.StatusBadRequest {
			t.Errorf("%s status=%d, want 400: %s", q, code, body)
		}
	}
}

// An empty window is an answer, not a failure: {} and [] rather than null, so
// a client can tell "nothing recorded" from "the request failed".
func TestHostHistory_EmptyWindowIsEmptyNotNull(t *testing.T) {
	srv, _, sid := newHistoryServer(t)
	from := time.Now().Add(-time.Hour).Unix()
	code, body := getWithSession(t, srv.URL+"/api/host/history?from="+itoa(from), sid)
	if code != http.StatusOK {
		t.Fatalf("status=%d, want 200: %s", code, body)
	}
	if !strings.Contains(string(body), `"services":{}`) {
		t.Errorf("services must encode as {}, got %s", body)
	}
	if !strings.Contains(string(body), `"tunnel":[]`) {
		t.Errorf("tunnel must encode as [], got %s", body)
	}
}

// The two routes are served by one handler, so the telemetry route must keep
// answering the snapshot it always did.
func TestHostHistory_TelemetryRouteUnaffected(t *testing.T) {
	srv, _, sid := newHistoryServer(t)
	code, body := getWithSession(t, srv.URL+"/api/host/telemetry", sid)
	if code != http.StatusOK {
		t.Fatalf("telemetry status=%d, want 200: %s", code, body)
	}
	var snap sensors.Snapshot
	if err := json.Unmarshal(body, &snap); err != nil {
		t.Fatalf("telemetry route must still decode as a snapshot: %v", err)
	}
}

// With no store the history route reports it plainly instead of pretending to
// have no history.
func TestHostHistory_NoStoreIsNotImplemented(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()
	h := telemetry.NewHandler(collector, sm) // no WithStore

	mux := http.NewServeMux()
	mux.Handle("/api/host/history", h)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	sessReq := httptest.NewRequest("GET", "/", nil)
	sessReq.RemoteAddr = "127.0.0.1:54321"
	sid := sm.CreateSession(sessReq)

	from := time.Now().Add(-time.Hour).Unix()
	code, body := getWithSession(t, srv.URL+"/api/host/history?from="+itoa(from), sid)
	if code != http.StatusNotImplemented {
		t.Errorf("status=%d, want 501 without a store: %s", code, body)
	}
}

// Telemetry is opt-in, so the history route must survive a handler built with
// no collector at all — asking for the snapshot then is "no telemetry", not a
// nil-pointer crash.
func TestHostHistory_HistoryWorksWithoutACollector(t *testing.T) {
	st, err := store.New(t.TempDir() + "/nocoll.db")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = st.Close() }()

	sm := auth.NewSessionManager(time.Hour)
	h := telemetry.NewHandler(nil, sm).WithStore(st)
	mux := http.NewServeMux()
	mux.Handle("/api/host/telemetry", h)
	mux.Handle("/api/host/history", h)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	sessReq := httptest.NewRequest("GET", "/", nil)
	sessReq.RemoteAddr = "127.0.0.1:54321"
	sid := sm.CreateSession(sessReq)

	from := time.Now().Add(-time.Hour).Unix()
	if code, body := getWithSession(t, srv.URL+"/api/host/history?from="+itoa(from), sid); code != http.StatusOK {
		t.Errorf("history without a collector status=%d, want 200: %s", code, body)
	}
	if code, _ := getWithSession(t, srv.URL+"/api/host/telemetry", sid); code != http.StatusServiceUnavailable {
		t.Errorf("snapshot without a collector status=%d, want 503", code)
	}
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}