package store

import (
	"testing"
	"time"

	"dl_conn/internal/sensors"
)

// fill inserts one sample every `step` over the window, each tagged with its
// own index in UptimeSec so a returned row can be traced back to the sample it
// came from. Returns the sample times, oldest first.
func fill(t *testing.T, s *Store, from time.Time, n int, step time.Duration) []time.Time {
	t.Helper()
	times := make([]time.Time, 0, n)
	for i := range n {
		ts := from.Add(time.Duration(i) * step)
		times = append(times, ts)
		if err := s.Insert(sensors.Snapshot{SampledAt: ts, UptimeSec: int64(i)}); err != nil {
			t.Fatalf("Insert %d: %v", i, err)
		}
	}
	return times
}

// TestStore_RangeBucketed_CapsRowCount is the regression guard for the defect
// that made the dashboard charts unusable: a whole retention window answered a
// chart with every stored sample (~60k rows, ~25 MB) instead of a bounded
// series. The cap has to hold for a window far denser than the cap.
func TestStore_RangeBucketed_CapsRowCount(t *testing.T) {
	s := newStore(t)
	from := time.Now().Add(-7 * 24 * time.Hour).Truncate(time.Second)
	// 6048 samples at a 10s cadence: what a 7-day window really holds.
	times := fill(t, s, from, 6048, 10*time.Second)
	to := times[len(times)-1]

	for _, maxPoints := range []int{240, 720} {
		snaps, err := s.RangeBucketed(from, to, maxPoints)
		if err != nil {
			t.Fatalf("maxPoints=%d: RangeBucketed: %v", maxPoints, err)
		}
		if len(snaps) > maxPoints {
			t.Errorf("maxPoints=%d: got %d rows, want at most %d", maxPoints, len(snaps), maxPoints)
		}
		if len(snaps) != maxPoints {
			t.Errorf("maxPoints=%d: got %d rows; a window this dense should fill every bucket", maxPoints, len(snaps))
		}
	}
}

// TestStore_RangeBucketed_NewestPerBucket pins the semantics the SQL relies on:
// a bare column next to a single max() aggregate comes from the row holding the
// maximum, so each group yields the *newest* sample inside it — one coherent
// snapshot, not a mix of columns from different rows.
func TestStore_RangeBucketed_NewestPerBucket(t *testing.T) {
	s := newStore(t)
	from := time.Now().Add(-time.Hour).Truncate(time.Second)
	// 60 samples, one per minute: UptimeSec is the index, so the value that
	// comes back names the sample it came from.
	times := fill(t, s, from, 60, time.Minute)
	to := times[len(times)-1]

	const buckets = 6 // 60min / 6 = 10min per bucket
	snaps, err := s.RangeBucketed(from, to, buckets)
	if err != nil {
		t.Fatalf("RangeBucketed: %v", err)
	}
	if len(snaps) != buckets {
		t.Fatalf("got %d rows, want %d buckets", len(snaps), buckets)
	}
	// Each bucket covers 10 samples; the newest is the last of the ten.
	want := []int64{9, 19, 29, 39, 49, 59}
	for i, w := range want {
		if got := snaps[i].UptimeSec; got != w {
			t.Errorf("snaps[%d].UptimeSec=%d, want %d (newest sample of bucket %d)", i, got, w, i)
		}
		if got, want := snaps[i].SampledAt.Unix(), times[w].Unix(); got != want {
			t.Errorf("snaps[%d].SampledAt=%d, want %d", i, got, want)
		}
	}
}

// TestStore_RangeBucketed_SmallWindowIsUntouched: below the cap every sample
// still comes back, in the same order and with the same payload as Range —
// bucketing must be invisible to a client asking for a window it can hold.
func TestStore_RangeBucketed_SmallWindowIsUntouched(t *testing.T) {
	s := newStore(t)
	base := time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	times := seed(t, s, base)
	// Deliberately out of insertion order, as the Range tests do.
	if err := s.Insert(sensors.Snapshot{SampledAt: base.Add(-time.Minute), UptimeSec: 0}); err != nil {
		t.Fatal(err)
	}

	snaps, err := s.RangeBucketed(base.Add(-time.Hour), base.Add(time.Hour), 720)
	if err != nil {
		t.Fatalf("RangeBucketed: %v", err)
	}
	if len(snaps) != 4 {
		t.Fatalf("len=%d, want 4 (the window is far below the cap)", len(snaps))
	}
	for i, want := range append([]time.Time{base.Add(-time.Minute)}, times...) {
		if got := snaps[i].SampledAt.Unix(); got != want.Unix() {
			t.Errorf("snaps[%d].SampledAt=%d, want %d (ascending)", i, got, want.Unix())
		}
	}
	// The payload must survive the round trip, not just the count.
	if snaps[3].CPU == nil || snaps[3].CPU.TempC == nil || *snaps[3].CPU.TempC != 42.0 {
		t.Errorf("snaps[3].CPU=%+v, want temp 42", snaps[3].CPU)
	}
}

// TestStore_RangeBucketed_SameTsCollapsesToOne is what makes the grouping safe
// at a 1s bucket: a burst of samples inside one second (a restart, a resumed
// timer) must not produce a bucket whose columns come from different rows.
func TestStore_RangeBucketed_SameTsCollapsesToOne(t *testing.T) {
	s := newStore(t)
	base := time.Now().Add(-time.Hour).Truncate(time.Second)
	for i := range 5 {
		if err := s.Insert(sensors.Snapshot{SampledAt: base, UptimeSec: int64(100 + i)}); err != nil {
			t.Fatal(err)
		}
	}
	snaps, err := s.RangeBucketed(base.Add(-time.Minute), base.Add(time.Minute), 720)
	if err != nil {
		t.Fatalf("RangeBucketed: %v", err)
	}
	if len(snaps) != 1 {
		t.Fatalf("len=%d, want 1: five samples in the same second share one bucket", len(snaps))
	}
	if snaps[0].SampledAt.Unix() != base.Unix() {
		t.Errorf("SampledAt=%d, want %d", snaps[0].SampledAt.Unix(), base.Unix())
	}
}

// TestStore_RangeBucketed_ContractEdges keeps RangeBucketed interchangeable with
// Range where a client can tell: non-nil empty results, a from after to as an
// empty window, and a nonsensical cap degrading to a single point rather than
// dividing by zero.
func TestStore_RangeBucketed_ContractEdges(t *testing.T) {
	s := newStore(t)
	base := time.Now().Add(-time.Hour).Truncate(time.Second)
	times := fill(t, s, base, 10, time.Minute)
	to := times[len(times)-1]

	t.Run("empty window is non-nil", func(t *testing.T) {
		snaps, err := s.RangeBucketed(base.Add(-2*time.Hour), base.Add(-90*time.Minute), 240)
		if err != nil {
			t.Fatalf("RangeBucketed: %v", err)
		}
		if snaps == nil {
			t.Error("snaps is nil; a JSON-encoding caller must see [] not null")
		}
		if len(snaps) != 0 {
			t.Errorf("len=%d, want 0", len(snaps))
		}
	})

	t.Run("from after to is empty, not an error", func(t *testing.T) {
		snaps, err := s.RangeBucketed(to, base, 240)
		if err != nil {
			t.Fatalf("RangeBucketed: %v", err)
		}
		if len(snaps) != 0 {
			t.Errorf("len=%d, want 0", len(snaps))
		}
	})

	t.Run("cap below one degrades to the newest sample", func(t *testing.T) {
		for _, maxPoints := range []int{0, -5} {
			snaps, err := s.RangeBucketed(base, to, maxPoints)
			if err != nil {
				t.Fatalf("maxPoints=%d: RangeBucketed: %v", maxPoints, err)
			}
			if len(snaps) != 1 {
				t.Fatalf("maxPoints=%d: len=%d, want 1", maxPoints, len(snaps))
			}
			if got := snaps[0].UptimeSec; got != 9 {
				t.Errorf("maxPoints=%d: UptimeSec=%d, want 9 (the newest sample)", maxPoints, got)
			}
		}
	})
}
