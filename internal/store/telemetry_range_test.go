package store

import (
	"testing"
	"time"

	"dl_conn/internal/sensors"
)

// seed inserts three samples one minute apart and returns their sample times,
// oldest first, so the range assertions below read against known values.
func seed(t *testing.T, s *Store, base time.Time) []time.Time {
	t.Helper()
	times := []time.Time{base, base.Add(time.Minute), base.Add(2 * time.Minute)}
	for i, ts := range times {
		snap := sensors.Snapshot{
			SampledAt: ts,
			CPU:       &sensors.CPUSnapshot{TempC: floatPtr(40.0 + float64(i))},
			UptimeSec: int64(i + 1),
		}
		if err := s.Insert(snap); err != nil {
			t.Fatalf("Insert %d: %v", i, err)
		}
	}
	return times
}

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(t.TempDir() + "/range.db")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestStore_Range_Ascending(t *testing.T) {
	s := newStore(t)
	// Deliberately inserted out of order to prove the ordering is the query's,
	// not the insertion order's.
	base := time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	times := seed(t, s, base)
	if err := s.Insert(sensors.Snapshot{SampledAt: base.Add(-time.Minute), UptimeSec: 0}); err != nil {
		t.Fatal(err)
	}

	snaps, err := s.Range(base.Add(-time.Hour), base.Add(time.Hour))
	if err != nil {
		t.Fatalf("Range: %v", err)
	}
	if len(snaps) != 4 {
		t.Fatalf("len=%d, want 4 (three seeded + the out-of-order one)", len(snaps))
	}
	for i, want := range append([]time.Time{base.Add(-time.Minute)}, times...) {
		if got := snaps[i].SampledAt.Unix(); got != want.Unix() {
			t.Errorf("snaps[%d].SampledAt=%d, want %d (results must be ascending by ts)", i, got, want.Unix())
		}
	}
	// The payload must survive the round trip, not just the ordering: the
	// seeded samples are at index 1..3, each one degree warmer than the last.
	if snaps[3].CPU == nil || snaps[3].CPU.TempC == nil || *snaps[3].CPU.TempC != 42.0 {
		t.Errorf("snaps[3].CPU=%+v, want temp 42", snaps[3].CPU)
	}
}

func TestStore_Range_Bounds(t *testing.T) {
	s := newStore(t)
	base := time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	times := seed(t, s, base)

	// Both bounds are inclusive, so the window times[1]..times[2] returns two.
	snaps, err := s.Range(times[1], times[2])
	if err != nil {
		t.Fatalf("Range: %v", err)
	}
	if len(snaps) != 2 {
		t.Fatalf("len=%d, want 2 (bounds are inclusive)", len(snaps))
	}

	// A window that excludes the first sample.
	snaps, err = s.Range(times[1].Add(time.Second), times[2])
	if err != nil {
		t.Fatalf("Range: %v", err)
	}
	if len(snaps) != 1 || snaps[0].SampledAt.Unix() != times[2].Unix() {
		t.Errorf("exclusive lower bound returned %d rows (first ts=%v)", len(snaps), snaps[0].SampledAt.Unix())
	}

	// A window entirely before the data, and one entirely after it.
	if snaps, err = s.Range(base.Add(-2*time.Hour), base.Add(-time.Hour)); err != nil || len(snaps) != 0 {
		t.Errorf("window before the data: len=%d err=%v, want 0 rows", len(snaps), err)
	}
	if snaps, err = s.Range(base.Add(time.Hour), base.Add(2*time.Hour)); err != nil || len(snaps) != 0 {
		t.Errorf("window after the data: len=%d err=%v, want 0 rows", len(snaps), err)
	}
}

// TestStore_Range_EmptyIsNotNil pins the [] and not null contract: the handler
// marshals this slice straight to the client.
func TestStore_Range_EmptyIsNotNil(t *testing.T) {
	s := newStore(t)

	snaps, err := s.Range(time.Now().Add(-time.Hour), time.Now())
	if err != nil {
		t.Fatalf("Range on an empty table: %v", err)
	}
	if snaps == nil {
		t.Fatal("Range returned nil for an empty table; it must return an empty slice")
	}
	if len(snaps) != 0 {
		t.Errorf("len=%d, want 0", len(snaps))
	}
}

func TestStore_Range_FromAfterTo(t *testing.T) {
	s := newStore(t)
	base := time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	seed(t, s, base)

	// An inverted window is an empty answer, not a failed request.
	snaps, err := s.Range(base.Add(time.Hour), base)
	if err != nil {
		t.Fatalf("inverted window returned an error: %v", err)
	}
	if snaps == nil {
		t.Fatal("inverted window returned nil, want an empty slice")
	}
	if len(snaps) != 0 {
		t.Errorf("len=%d, want 0", len(snaps))
	}
}
