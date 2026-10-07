package health

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"dl_conn/internal/config"
)

// recordingRecorder captures the rounds a Monitor emits.
type recordingRecorder struct {
	mu     sync.Mutex
	rounds []map[string]string
	err    error
}

func (r *recordingRecorder) RecordServiceHealth(_ time.Time, statuses map[string]string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return r.err
	}
	// Copy: the monitor must hand over a snapshot it no longer mutates.
	cp := make(map[string]string, len(statuses))
	for k, v := range statuses {
		cp[k] = v
	}
	r.rounds = append(r.rounds, cp)
	return nil
}

func (r *recordingRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.rounds)
}

func (r *recordingRecorder) round(i int) map[string]string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rounds[i]
}

// Port 1 on loopback refuses instantly, so every probe here is a real dial
// attempt with a deterministic outcome rather than a stubbed return.
func testServices() []config.ServiceConfig {
	return []config.ServiceConfig{
		{ID: "a", Target: "http://127.0.0.1:1"},
		{ID: "b", Target: "http://127.0.0.1:1"},
	}
}

func TestMonitor_RecorderGetsOneCoherentRoundPerProbe(t *testing.T) {
	rec := &recordingRecorder{}
	m := New(testServices()).WithRecorder(rec)
	m.ProbeAll(context.Background())

	if rec.count() != 1 {
		t.Fatalf("got %d rounds, want exactly 1 per probe cycle", rec.count())
	}
	round := rec.round(0)
	if len(round) != 2 {
		t.Errorf("round has %d services, want 2 — a half round would render as a service that vanished", len(round))
	}
	for _, id := range []string{"a", "b"} {
		if _, ok := round[id]; !ok {
			t.Errorf("round is missing service %q", id)
		}
	}
}

// Every service is recorded on every round, even one that never changes: a
// status-page strip draws a gap for a service that stops reporting, and that
// gap must mean "unprobed" rather than "quietly omitted".
func TestMonitor_RecorderRepeatsUnchangedStatus(t *testing.T) {
	rec := &recordingRecorder{}
	m := New(testServices()).WithRecorder(rec)
	ctx := context.Background()
	m.ProbeAll(ctx)
	m.ProbeAll(ctx)
	m.ProbeAll(ctx)
	if rec.count() != 3 {
		t.Errorf("got %d rounds, want 3", rec.count())
	}
}

func TestMonitor_ProbeAllIsSafeWithoutRecorder(t *testing.T) {
	m := New(testServices())
	m.ProbeAll(context.Background()) // must not panic
	if got := m.Status("a"); got != StatusDown {
		t.Errorf("Status(a) = %q, want %q", got, StatusDown)
	}
}

// A failing history write must not stop probing: the monitor's job is live
// health, and a full disk would otherwise take the dashboard down with it.
func TestMonitor_RecorderErrorDoesNotBreakProbing(t *testing.T) {
	rec := &recordingRecorder{err: errors.New("disk full")}
	m := New(testServices()).WithRecorder(rec)
	m.ProbeAll(context.Background())
	m.ProbeAll(context.Background())
	if got := m.Status("a"); got != StatusDown {
		t.Errorf("Status(a) = %q, want %q — probing must continue after a write failure", got, StatusDown)
	}
}

// The recorded map must be a copy, not the monitor's live map: handing over
// the live one lets a concurrent probe mutate a map a recorder is still
// iterating, which is a data race rather than a cosmetic bug.
func TestMonitor_SnapshotIsIsolatedFromLaterRounds(t *testing.T) {
	m := New(testServices())
	m.ProbeAll(context.Background())

	first := m.snapshot()
	if len(first) != 2 {
		t.Fatalf("snapshot has %d services, want 2", len(first))
	}
	// Mutate the snapshot as a hostile recorder would, then re-read the
	// monitor: the two must not be the same map.
	first["a"] = "tampered"
	delete(first, "b")

	if got := m.Status("a"); got != StatusDown {
		t.Errorf("Status(a) = %q after mutating a snapshot — the monitor handed out its live map", got)
	}
	if got := m.Status("b"); got != StatusDown {
		t.Errorf("Status(b) = %q after deleting it from a snapshot — the monitor handed out its live map", got)
	}
}