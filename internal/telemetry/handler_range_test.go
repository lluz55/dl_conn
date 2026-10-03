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

// TestHandler_Range_CapsResponseSize is the regression guard for the chart that
// would not load: the 7-day window is the one the SPA opens with, and at the
// default 10s collection interval it holds ~60k samples. Answering that with
// every row meant ~25 MB per request and a read that pinned the store's single
// connection for the whole transfer. The response must stay bounded whatever
// the window holds.
func TestHandler_Range_CapsResponseSize(t *testing.T) {
	h, sid := historyHandler(t)
	now := time.Now()
	// One row per minute for 7 days: 10081 samples, same order of magnitude
	// as the real 10s cadence without paying for 60k inserts in a unit test.
	const window = 7 * 24 * time.Hour
	base := now.Add(-window).Truncate(time.Second)
	for i := range 10081 {
		if err := h.store.Insert(sensors.Snapshot{SampledAt: base.Add(time.Duration(i) * time.Minute), UptimeSec: int64(i)}); err != nil {
			t.Fatal(err)
		}
	}

	for _, q := range []struct{ query string; want int }{
		{"?from=" + itoa(base.Unix()) + "&to=" + itoa(now.Unix()), maxRangePoints},
		{"?from=" + itoa(base.Unix()) + "&to=" + itoa(now.Unix()) + "&points=240", 240},
		{"?from=" + itoa(base.Unix()) + "&to=" + itoa(now.Unix()) + "&points=1", 1},
	} {
		rr := get(t, h, sid, q.query)
		if rr.Code != http.StatusOK {
			t.Fatalf("%s: status=%d, want 200, body=%s", q.query, rr.Code, rr.Body.String())
		}
		var snaps []sensors.Snapshot
		if err := json.Unmarshal(rr.Body.Bytes(), &snaps); err != nil {
			t.Fatalf("%s: decode: %v", q.query, err)
		}
		if len(snaps) > q.want {
			t.Errorf("%s: got %d samples, want at most %d", q.query, len(snaps), q.want)
		}
		if len(snaps) == 0 {
			t.Errorf("%s: got 0 samples, want a bounded non-empty series", q.query)
		}
		// The bytes are what the browser actually pays: unfiltered, this same
		// window is ~4 MB at one row per minute.
		if rr.Body.Len() > 512*1024 {
			t.Errorf("%s: response is %d bytes, want well under 512 KB", q.query, rr.Body.Len())
		}
	}
}

// TestHandler_Range_PointsParam pins the ?points= contract: an integer asks for
// that many, anything larger than the ceiling is capped rather than refused
// (a client that does not know the cap yet is not making a mistake worth a
// failed request), and a value that is not an integer is a 400 like the
// other params.
func TestHandler_Range_PointsParam(t *testing.T) {
	h, sid := historyHandler(t)
	now := time.Now()
	base := now.Add(-time.Hour).Truncate(time.Second)
	for i := range 60 {
		if err := h.store.Insert(sensors.Snapshot{SampledAt: base.Add(time.Duration(i) * time.Minute), UptimeSec: int64(i)}); err != nil {
			t.Fatal(err)
		}
	}
	span := "?from=" + itoa(base.Unix()) + "&to=" + itoa(now.Unix())

	t.Run("above the ceiling is capped", func(t *testing.T) {
		rr := get(t, h, sid, span+"&points=999999")
		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d, want 200, body=%s", rr.Code, rr.Body.String())
		}
		var snaps []sensors.Snapshot
		if err := json.Unmarshal(rr.Body.Bytes(), &snaps); err != nil {
			t.Fatal(err)
		}
		if len(snaps) > maxRangePoints {
			t.Errorf("got %d samples, want at most %d", len(snaps), maxRangePoints)
		}
	})

	t.Run("nonsense is a 400", func(t *testing.T) {
		for _, q := range []string{"&points=abc", "&points=1.5", "&points="} {
			rr := get(t, h, sid, span+q)
			if q == "&points=" {
				// An empty value is an absent param, not a malformed one.
				if rr.Code != http.StatusOK {
					t.Errorf("%q: status=%d, want 200 (absent param)", q, rr.Code)
				}
				continue
			}
			if rr.Code != http.StatusBadRequest {
				t.Errorf("%q: status=%d, want 400, body=%s", q, rr.Code, rr.Body.String())
			}
		}
	})
}

// TestParseRange_PointsAloneIsNotARange guards the compatibility contract: a
// ?points= with no window has nothing to bound, so the route must still answer
// the single-snapshot poll rather than switching to the array shape.
func TestParseRange_PointsAloneIsNotARange(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/host/telemetry?points=240", nil)
	_, _, _, want, err := parseRange(req)
	if err != nil {
		t.Fatalf("parseRange: %v", err)
	}
	if want {
		t.Error("want=false: ?points= alone must not make it a range request")
	}

	h, sid := historyHandler(t)
	rr := get(t, h, sid, "?points=240")
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%s", rr.Code, rr.Body.String())
	}
	if body := strings.TrimSpace(rr.Body.String()); strings.HasPrefix(body, "[") {
		t.Errorf("body=%s, want a single snapshot object", body)
	}
}
