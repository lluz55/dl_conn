package telemetry

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
	"dl_conn/internal/store"
)

// historyHandler wires a handler with a real SQLite history behind it, the way
// main.go does, and returns it with a valid session already created.
func historyHandler(t *testing.T) (*Handler, string) {
	t.Helper()
	st, err := store.New(t.TempDir() + "/telemetry.db")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce() // so the no-params path has something to serve

	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	return NewHandler(collector, sm).WithStore(st), sid
}

func get(t *testing.T, h *Handler, sid, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/host/telemetry"+query, nil)
	if sid != "" {
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sid})
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

// TestHandler_NoParams_StillASingleObject is the compatibility guard: the
// existing web client polls this endpoint with no query and decodes one
// snapshot. A range feature that changed that shape would break every
// deployed dashboard.
func TestHandler_NoParams_StillASingleObject(t *testing.T) {
	h, sid := historyHandler(t)

	rr := get(t, h, sid, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type=%q", got)
	}
	body := strings.TrimSpace(rr.Body.String())
	if strings.HasPrefix(body, "[") {
		t.Fatalf("no-params response is an array: %s", body)
	}
	var snap sensors.Snapshot
	if err := json.Unmarshal([]byte(body), &snap); err != nil {
		t.Fatalf("decode single snapshot: %v, body=%s", err, body)
	}
	if snap.SampledAt.IsZero() {
		t.Error("SampledAt is zero")
	}
}

func TestHandler_Range_InvalidBound_400(t *testing.T) {
	h, sid := historyHandler(t)

	for _, q := range []string{"?from=not-a-number", "?to=2024-13-45", "?from=&to=abc", "?from=1.5"} {
		rr := get(t, h, sid, q)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("%s: status=%d, want 400, body=%s", q, rr.Code, rr.Body.String())
		}
		if got := rr.Header().Get("Content-Type"); got != "application/json" {
			t.Errorf("%s: Content-Type=%q, want application/json", q, got)
		}
		var payload map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
			t.Errorf("%s: error body is not JSON: %v (%s)", q, err, rr.Body.String())
		}
		if payload["error"] == "" {
			t.Errorf("%s: error body has no message: %s", q, rr.Body.String())
		}
	}
}

func TestHandler_Range_ReturnsAscendingArray(t *testing.T) {
	h, sid := historyHandler(t)

	st := h.store
	base := time.Now().Add(-30 * time.Minute).Truncate(time.Second)
	// Inserted newest-first so a response ordered by ts proves the query
	// sorted them rather than echoing insertion order.
	for i, ago := range []time.Duration{20 * time.Minute, 0, 10 * time.Minute} {
		snap := sensors.Snapshot{SampledAt: base.Add(ago), UptimeSec: int64(i + 1)}
		if err := st.Insert(snap); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}

	rr := get(t, h, sid, "?from="+itoa(base.Add(-time.Hour).Unix())+"&to="+itoa(base.Add(time.Hour).Unix()))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	var snaps []sensors.Snapshot
	if err := json.Unmarshal(rr.Body.Bytes(), &snaps); err != nil {
		t.Fatalf("decode array: %v, body=%s", err, rr.Body.String())
	}
	if len(snaps) != 3 {
		t.Fatalf("len=%d, want 3, body=%s", len(snaps), rr.Body.String())
	}
	for i := 1; i < len(snaps); i++ {
		if snaps[i].SampledAt.Unix() < snaps[i-1].SampledAt.Unix() {
			t.Errorf("snaps[%d] (%d) is older than snaps[%d] (%d); want ascending ts",
				i, snaps[i].SampledAt.Unix(), i-1, snaps[i-1].SampledAt.Unix())
		}
	}
}

// TestHandler_Range_EmptyWindow_200 pins that "nothing recorded there" is a
// 200 with [], not a 503 — the 503 belongs to the latest-snapshot path.
func TestHandler_Range_EmptyWindow_200(t *testing.T) {
	h, sid := historyHandler(t)

	rr := get(t, h, sid, "?from=1000&to=2000")
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if got := strings.TrimSpace(rr.Body.String()); got != "[]" {
		t.Errorf("body=%s, want []", got)
	}
}

// TestHandler_Range_SingleBound covers the documented defaults: without "from"
// the window is the last defaultHistoryWindow, without "to" it ends now.
func TestHandler_Range_SingleBound(t *testing.T) {
	h, sid := historyHandler(t)

	// Only "from": an hour ago is inside the default window, two hours ago is not.
	now := time.Now()
	if err := h.store.Insert(sensors.Snapshot{SampledAt: now.Add(-10 * time.Minute), UptimeSec: 1}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.Insert(sensors.Snapshot{SampledAt: now.Add(-2 * time.Hour), UptimeSec: 2}); err != nil {
		t.Fatal(err)
	}

	rr := get(t, h, sid, "?from="+itoa(now.Add(-time.Hour).Unix()))
	if rr.Code != http.StatusOK {
		t.Fatalf("only-from: status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	var snaps []sensors.Snapshot
	if err := json.Unmarshal(rr.Body.Bytes(), &snaps); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snaps) != 1 {
		t.Errorf("only-from returned %d rows, want 1 (default window is %s)", len(snaps), defaultHistoryWindow)
	}

	// Only "to": the default lower bound is one hour back, so a sample 30
	// minutes ago is inside the window.
	rr = get(t, h, sid, "?to="+itoa(now.Unix()))
	if rr.Code != http.StatusOK {
		t.Fatalf("only-to: status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &snaps); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snaps) != 1 {
		t.Errorf("only-to returned %d rows, want 1", len(snaps))
	}
}

func TestHandler_Range_RequiresSession(t *testing.T) {
	h, _ := historyHandler(t)

	// Auth is checked before the bounds are even parsed.
	if rr := get(t, h, "", "?from=abc"); rr.Code != http.StatusUnauthorized {
		t.Errorf("range without a session = %d, want 401", rr.Code)
	}
}

// TestHandler_Range_WithoutStore_501 documents the opt-in: a range request is
// refused loudly rather than answered with the latest reading, which a client
// would draw as a chart with no history.
func TestHandler_Range_WithoutStore_501(t *testing.T) {
	sm := auth.NewSessionManager(time.Hour)
	collector := sensors.NewCollector(time.Second)
	collector.CollectOnce()
	h := NewHandler(collector, sm) // no WithStore
	sid := sm.CreateSession(httptest.NewRequest("GET", "/", nil))

	rr := get(t, h, sid, "?from=1000&to=2000")
	if rr.Code != http.StatusNotImplemented {
		t.Errorf("status=%d, want 501, body=%s", rr.Code, rr.Body.String())
	}
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }
