package store

import (
	"testing"
	"time"

	"dl_conn/internal/sensors"
)

func TestStore_InsertAndLatest(t *testing.T) {
	dbPath := t.TempDir() + "/t.db"
	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	snap1 := sensors.Snapshot{
		SampledAt: time.Now().Add(-2 * time.Minute),
		CPU:       &sensors.CPUSnapshot{TempC: floatPtr(45.0), Load1: 0.5},
		Memory:    &sensors.MemorySnapshot{TotalMB: 8000, AvailableMB: 4000, UsedMB: 4000, UsedPct: 50.0},
		UptimeSec: 3600,
	}
	if err := s.Insert(snap1); err != nil {
		t.Fatalf("Insert 1: %v", err)
	}

	snap2 := sensors.Snapshot{
		SampledAt: time.Now(),
		CPU:       &sensors.CPUSnapshot{TempC: floatPtr(60.0), Load1: 1.2},
		Memory:    &sensors.MemorySnapshot{TotalMB: 8000, AvailableMB: 2000, UsedMB: 6000, UsedPct: 75.0},
		UptimeSec: 4000,
	}
	if err := s.Insert(snap2); err != nil {
		t.Fatalf("Insert 2: %v", err)
	}

	latest, err := s.Latest()
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if latest == nil {
		t.Fatal("Latest returned nil")
	}
	if latest.UptimeSec != 4000 {
		t.Errorf("Latest UptimeSec=%d, want 4000", latest.UptimeSec)
	}
	if latest.CPU == nil || latest.CPU.TempC == nil || *latest.CPU.TempC != 60.0 {
		t.Errorf("Latest CPU temp wrong: %+v", latest.CPU)
	}
	if latest.Memory == nil || latest.Memory.UsedPct != 75.0 {
		t.Errorf("Latest memory wrong: %+v", latest.Memory)
	}
}

func TestStore_Latest_Empty(t *testing.T) {
	s, err := New(t.TempDir() + "/empty.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	latest, err := s.Latest()
	if err != nil {
		t.Fatal(err)
	}
	if latest != nil {
		t.Errorf("expected nil, got %+v", latest)
	}
}

func TestStore_Prune(t *testing.T) {
	dbPath := t.TempDir() + "/p.db"
	s, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// Insert old sample.
	old := sensors.Snapshot{SampledAt: time.Now().Add(-2 * time.Hour), UptimeSec: 1}
	if err := s.Insert(old); err != nil {
		t.Fatal(err)
	}
	// Insert recent sample.
	recent := sensors.Snapshot{SampledAt: time.Now(), UptimeSec: 2}
	if err := s.Insert(recent); err != nil {
		t.Fatal(err)
	}

	// Prune anything older than 1h.
	if err := s.Prune(time.Hour); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	latest, err := s.Latest()
	if err != nil {
		t.Fatal(err)
	}
	if latest == nil || latest.UptimeSec != 2 {
		t.Errorf("expected only recent (uptime=2), got %+v", latest)
	}
}

func floatPtr(f float64) *float64 { return &f }
