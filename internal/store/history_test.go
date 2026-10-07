package store

import (
	"testing"
	"time"
)

// newHistoryStore opens a throwaway database for one test.
func newHistoryStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(t.TempDir() + "/history.db")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestRecordServiceHealth_RoundIsWhole(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	if err := s.RecordServiceHealth(base, map[string]string{"a": StatusUp, "b": StatusDown}); err != nil {
		t.Fatalf("RecordServiceHealth: %v", err)
	}
	got, err := s.RangeServiceHealth(base.Add(-time.Hour), base.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d services, want 2: %+v", len(got), got)
	}
	if got["a"][0].Status != StatusUp {
		t.Errorf("a = %q, want %q", got["a"][0].Status, StatusUp)
	}
	if got["b"][0].Status != StatusDown {
		t.Errorf("b = %q, want %q", got["b"][0].Status, StatusDown)
	}
}

// An empty round is a host with nothing configured, not a failure.
func TestRecordServiceHealth_EmptyMapIsNoOp(t *testing.T) {
	s := newHistoryStore(t)
	if err := s.RecordServiceHealth(time.Now(), nil); err != nil {
		t.Fatalf("RecordServiceHealth(nil): %v", err)
	}
	got, err := s.RangeServiceHealth(time.Unix(0, 0), time.Now(), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d services, want 0", len(got))
	}
}

// The whole point of the strip: an outage that lasted 10 seconds must not be
// averaged away by the healthy samples in the same bucket.
func TestRangeServiceHealth_WorstWinsWithinBucket(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	for i := 0; i < 5; i++ {
		status := StatusUp
		if i == 2 {
			status = StatusDown
		}
		round := map[string]string{"svc": status}
		if err := s.RecordServiceHealth(base.Add(time.Duration(i)*time.Second), round); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	// One bucket across the whole 4-second span, so all five rounds collapse
	// together and the single down sample has to decide the bucket.
	got, err := s.RangeServiceHealth(base.Add(-time.Second), base.Add(10*time.Second), 1)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	series := got["svc"]
	if len(series) != 1 {
		t.Fatalf("got %d points, want 1: %+v", len(series), series)
	}
	if series[0].Status != StatusDown {
		t.Errorf("status = %q, want %q (one down sample must win the bucket)", series[0].Status, StatusDown)
	}
}

// down beats unknown beats up.
func TestRangeServiceHealth_SeverityOrder(t *testing.T) {
	cases := []struct {
		statuses []string
		want     string
	}{
		{[]string{StatusUp, StatusUnknown}, StatusUnknown},
		{[]string{StatusUp, StatusDown}, StatusDown},
		{[]string{StatusUnknown, StatusDown}, StatusDown},
		{[]string{StatusUp}, StatusUp},
	}
	for _, tc := range cases {
		t.Run(tc.want+"/"+tc.statuses[0], func(t *testing.T) {
			s := newHistoryStore(t)
			base := time.Unix(1_700_000_000, 0).UTC()
			for i, st := range tc.statuses {
				if err := s.RecordServiceHealth(base.Add(time.Duration(i)*time.Second), map[string]string{"svc": st}); err != nil {
					t.Fatalf("insert: %v", err)
				}
			}
			got, err := s.RangeServiceHealth(base.Add(-time.Second), base.Add(10*time.Second), 1)
			if err != nil {
				t.Fatalf("RangeServiceHealth: %v", err)
			}
			if got["svc"][0].Status != tc.want {
				t.Errorf("status = %q, want %q", got["svc"][0].Status, tc.want)
			}
		})
	}
}

// A service absent from the window must be absent from the map, not present
// with an empty series: "never probed" is a different claim from "probed up".
func TestRangeServiceHealth_AbsentServiceIsNotAnEmptySeries(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	if err := s.RecordServiceHealth(base, map[string]string{"known": StatusUp}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	got, err := s.RangeServiceHealth(base.Add(-time.Hour), base.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	if _, present := got["never-probed"]; present {
		t.Error("a service with no row in the window must not appear in the result")
	}
	if _, present := got["known"]; !present {
		t.Error("a probed service must appear")
	}
}

func TestRangeServiceHealth_WindowBoundsAreInclusive(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	for _, off := range []time.Duration{-time.Hour, 0, time.Hour} {
		if err := s.RecordServiceHealth(base.Add(off), map[string]string{"svc": StatusUp}); err != nil {
			t.Fatalf("insert %v: %v", off, err)
		}
	}
	got, err := s.RangeServiceHealth(base, base.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	if n := len(got["svc"]); n != 2 {
		t.Errorf("got %d points, want 2 (both bounds inclusive, -1h excluded)", n)
	}
}

func TestRangeServiceHealth_FromAfterToIsEmptyNotError(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	got, err := s.RangeServiceHealth(base.Add(time.Hour), base, 720)
	if err != nil {
		t.Fatalf("from>to must be an empty window, got error: %v", err)
	}
	if got == nil {
		t.Error("result must be non-nil so a JSON caller emits {} and not null")
	}
	if len(got) != 0 {
		t.Errorf("got %d services, want 0", len(got))
	}
}

func TestRecordTunnelIncarnation_OpensThenCloses(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	if err := s.RecordTunnelIncarnation(base, "https://a.trycloudflare.com"); err != nil {
		t.Fatalf("first incarnation: %v", err)
	}
	if err := s.RecordTunnelIncarnation(base.Add(time.Hour), "https://b.trycloudflare.com"); err != nil {
		t.Fatalf("second incarnation: %v", err)
	}
	got, err := s.RangeTunnelIncarnations(base.Add(-time.Hour), base.Add(2*time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d incarnations, want 2: %+v", len(got), got)
	}
	if got[0].EndedAt == nil {
		t.Error("the superseded incarnation must be closed, not left open")
	}
	if *got[0].EndedAt != base.Add(time.Hour).Unix() {
		t.Errorf("ended_at = %d, want %d", *got[0].EndedAt, base.Add(time.Hour).Unix())
	}
	if got[1].EndedAt != nil {
		t.Error("the current incarnation must stay open (nil), not look finished")
	}
	if got[0].URL != "https://a.trycloudflare.com" || got[1].URL != "https://b.trycloudflare.com" {
		t.Errorf("urls = %q, %q", got[0].URL, got[1].URL)
	}
}

func TestCloseOpenTunnelIncarnation(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	if err := s.RecordTunnelIncarnation(base, "https://a.trycloudflare.com"); err != nil {
		t.Fatalf("RecordTunnelIncarnation: %v", err)
	}
	if err := s.CloseOpenTunnelIncarnation(base.Add(time.Minute)); err != nil {
		t.Fatalf("CloseOpenTunnelIncarnation: %v", err)
	}
	got, err := s.RangeTunnelIncarnations(base.Add(-time.Hour), base.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(got) != 1 || got[0].EndedAt == nil {
		t.Fatalf("a clean shutdown must end the incarnation, got %+v", got)
	}
	if *got[0].EndedAt != base.Add(time.Minute).Unix() {
		t.Errorf("ended_at = %d, want %d", *got[0].EndedAt, base.Add(time.Minute).Unix())
	}
}

// An incarnation that started before the window still overlaps it, and must be
// returned whole — truncating it would invent a start time that never happened.
func TestRangeTunnelIncarnations_OverlapIncludesEarlierStart(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	if err := s.RecordTunnelIncarnation(base, "https://a.trycloudflare.com"); err != nil {
		t.Fatalf("RecordTunnelIncarnation: %v", err)
	}
	// Window starts an hour after the incarnation began.
	from := base.Add(time.Hour)
	got, err := s.RangeTunnelIncarnations(from, from.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d incarnations, want 1 (an overlap counts even from before the window)", len(got))
	}
	if got[0].StartedAt != base.Unix() {
		t.Errorf("started_at = %d, want %d — the real start must not be rewritten to the window edge", got[0].StartedAt, base.Unix())
	}
}

func TestRangeTunnelIncarnations_NonOverlappingExcluded(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	if err := s.RecordTunnelIncarnation(base, "https://a.trycloudflare.com"); err != nil {
		t.Fatalf("RecordTunnelIncarnation: %v", err)
	}
	// Close it first: an incarnation that is still open reaches into any
	// future window by definition, so without this the window below would
	// legitimately overlap it and the exclusion could not be observed.
	if err := s.CloseOpenTunnelIncarnation(base.Add(time.Minute)); err != nil {
		t.Fatalf("close: %v", err)
	}
	// Window is entirely after the incarnation ended.
	got, err := s.RangeTunnelIncarnations(base.Add(10*time.Hour), base.Add(11*time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d incarnations, want 0", len(got))
	}
}

func TestRangeTunnelIncarnations_CapKeepsNewestAndOrder(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	const n = 10
	for i := 0; i < n; i++ {
		url := "https://t" + string(rune('a'+i)) + ".trycloudflare.com"
		if err := s.RecordTunnelIncarnation(base.Add(time.Duration(i)*time.Minute), url); err != nil {
			t.Fatalf("incarnation %d: %v", i, err)
		}
	}
	got, err := s.RangeTunnelIncarnations(base.Add(-time.Hour), base.Add(time.Hour), 3)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d incarnations, want 3", len(got))
	}
	// Newest kept, but returned oldest-first.
	for i := 1; i < len(got); i++ {
		if got[i-1].StartedAt > got[i].StartedAt {
			t.Errorf("result must be oldest-first, got %+v", got)
		}
	}
	if got[len(got)-1].URL != "https://t"+string(rune('a'+n-1))+".trycloudflare.com" {
		t.Errorf("the newest incarnation must survive the cap, got %q", got[len(got)-1].URL)
	}
}

func TestRangeTunnelIncarnations_FromAfterToIsEmptyNotError(t *testing.T) {
	s := newHistoryStore(t)
	base := time.Unix(1_700_000_000, 0).UTC()
	got, err := s.RangeTunnelIncarnations(base.Add(time.Hour), base, 720)
	if err != nil {
		t.Fatalf("from>to must be an empty window, got error: %v", err)
	}
	if got == nil {
		t.Error("result must be non-nil so a JSON caller emits [] and not null")
	}
}

func TestPrune_TrimsBothEventHistories(t *testing.T) {
	s := newHistoryStore(t)
	old := time.Now().Add(-48 * time.Hour)
	if err := s.RecordServiceHealth(old, map[string]string{"svc": StatusDown}); err != nil {
		t.Fatalf("health insert: %v", err)
	}
	if err := s.RecordServiceHealth(time.Now(), map[string]string{"svc": StatusUp}); err != nil {
		t.Fatalf("health insert: %v", err)
	}
	if err := s.RecordTunnelIncarnation(old, "https://a.trycloudflare.com"); err != nil {
		t.Fatalf("tunnel insert: %v", err)
	}
	// Close it so it is prunable: an open row is deliberately kept.
	if err := s.CloseOpenTunnelIncarnation(old.Add(time.Minute)); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := s.Prune(24 * time.Hour); err != nil {
		t.Fatalf("Prune: %v", err)
	}
	svc, err := s.RangeServiceHealth(time.Now().Add(-72*time.Hour), time.Now(), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth: %v", err)
	}
	if len(svc["svc"]) != 1 {
		t.Errorf("service health points = %d, want 1 (only the fresh one)", len(svc["svc"]))
	}
	tun, err := s.RangeTunnelIncarnations(time.Now().Add(-72*time.Hour), time.Now(), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(tun) != 0 {
		t.Errorf("incarnations = %d, want 0 (the closed old one must be pruned)", len(tun))
	}
}

// The tunnel currently in use must never be pruned out from under the dashboard,
// however long it has been running.
func TestPrune_KeepsOpenIncarnation(t *testing.T) {
	s := newHistoryStore(t)
	old := time.Now().Add(-48 * time.Hour)
	if err := s.RecordTunnelIncarnation(old, "https://a.trycloudflare.com"); err != nil {
		t.Fatalf("RecordTunnelIncarnation: %v", err)
	}
	if err := s.Prune(24 * time.Hour); err != nil {
		t.Fatalf("Prune: %v", err)
	}
	got, err := s.RangeTunnelIncarnations(old.Add(-time.Hour), time.Now().Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeTunnelIncarnations: %v", err)
	}
	if len(got) != 1 {
		t.Errorf("got %d incarnations, want 1 (the open tunnel must survive pruning)", len(got))
	}
}

// Reopening the same database must not lose the new tables to an older schema.
func TestMigrate_IsIdempotentAcrossOpens(t *testing.T) {
	path := t.TempDir() + "/again.db"
	s, err := New(path)
	if err != nil {
		t.Fatalf("first New: %v", err)
	}
	if err := s.RecordServiceHealth(time.Now(), map[string]string{"svc": StatusUp}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	s2, err := New(path)
	if err != nil {
		t.Fatalf("second New: %v", err)
	}
	defer func() { _ = s2.Close() }()
	got, err := s2.RangeServiceHealth(time.Now().Add(-time.Hour), time.Now().Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeServiceHealth after reopen: %v", err)
	}
	if len(got["svc"]) != 1 {
		t.Errorf("got %d points after reopen, want 1 — the new table must survive a restart", len(got["svc"]))
	}
}