package tunnel

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// incarnationRecorder captures the tunnel lifetimes a Manager reports.
type incarnationRecorder struct {
	mu    sync.Mutex
	urls  []string
	times []time.Time
	err   error
}

func (r *incarnationRecorder) RecordTunnelIncarnation(startedAt time.Time, url string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return r.err
	}
	r.urls = append(r.urls, url)
	r.times = append(r.times, startedAt)
	return nil
}

func (r *incarnationRecorder) recorded() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.urls...)
}

// A first URL is one incarnation.
func TestManager_RecordsFirstIncarnation(t *testing.T) {
	rec := &incarnationRecorder{}
	m := NewManager("true", 8080).WithRecorder(rec)
	m.scanOutput(context.Background(), strings.NewReader(
		"INF Starting\nTUNNEL: https://aaaa.trycloudflare.com\n"))

	got := rec.recorded()
	if len(got) != 1 || got[0] != "https://aaaa.trycloudflare.com" {
		t.Fatalf("recorded %v, want exactly one incarnation", got)
	}
}

// A rotation is a new incarnation, and cloudflared reprinting the same URL is
// not — otherwise a banner echoed every few seconds would forge a history of
// a tunnel that never moved.
func TestManager_DistinguishesRotationFromRepeat(t *testing.T) {
	rec := &incarnationRecorder{}
	m := NewManager("true", 8080).WithRecorder(rec)
	m.scanOutput(context.Background(), strings.NewReader(strings.Join([]string{
		"TUNNEL: https://aaaa.trycloudflare.com",
		"TUNNEL: https://aaaa.trycloudflare.com", // same URL reprinted
		"TUNNEL: https://bbbb.trycloudflare.com", // rotated
		"TUNNEL: https://bbbb.trycloudflare.com", // same again
	}, "\n")))

	got := rec.recorded()
	want := []string{"https://aaaa.trycloudflare.com", "https://bbbb.trycloudflare.com"}
	if len(got) != len(want) {
		t.Fatalf("recorded %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("recorded %v, want %v", got, want)
			break
		}
	}
}

// A history write that fails must never stop the tunnel from being published:
// the consumer is waiting on that URL, and a full disk is not a reason to
// leave the dashboard without a tunnel.
func TestManager_RecorderErrorStillPublishesURL(t *testing.T) {
	rec := &incarnationRecorder{err: errors.New("disk full")}
	m := NewManager("true", 8080).WithRecorder(rec)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.scanOutput(ctx, strings.NewReader("TUNNEL: https://aaaa.trycloudflare.com\n"))

	select {
	case got := <-m.URL():
		if got != "https://aaaa.trycloudflare.com" {
			t.Errorf("published %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the URL was never published — a recorder failure blocked the tunnel")
	}
}

func TestManager_WithoutRecorderStillPublishes(t *testing.T) {
	m := NewManager("true", 8080)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.scanOutput(ctx, strings.NewReader("TUNNEL: https://aaaa.trycloudflare.com\n"))

	select {
	case got := <-m.URL():
		if got != "https://aaaa.trycloudflare.com" {
			t.Errorf("published %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the URL was never published")
	}
}

// Lines that carry no URL are not incarnations.
func TestManager_IgnoresOutputWithoutURL(t *testing.T) {
	rec := &incarnationRecorder{}
	m := NewManager("true", 8080).WithRecorder(rec)
	m.scanOutput(context.Background(), strings.NewReader(
		"INF Starting tunnel\nINF Connected to edge\nWRN something\n"))
	if got := rec.recorded(); len(got) != 0 {
		t.Errorf("recorded %v, want none", got)
	}
}