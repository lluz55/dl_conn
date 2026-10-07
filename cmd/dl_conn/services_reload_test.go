package main

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"dl_conn/internal/config"
)

func TestBuildServiceInfos(t *testing.T) {
	services := []config.ServiceConfig{
		{ID: "s1", Name: "Service 1", Prefix: "/s1", Target: "http://127.0.0.1:8001", Hidden: false},
		{ID: "s2", Name: "Service 2", Prefix: "/s2", Target: "http://127.0.0.1:8002", Hidden: true},
		{ID: "s3", Name: "Service 3", Prefix: "/s3", Target: "http://127.0.0.1:8003", Hidden: false},
	}

	visible, infos := buildServiceInfos(services)
	if len(visible) != 2 {
		t.Fatalf("expected 2 visible services, got %d", len(visible))
	}
	if len(infos) != 2 {
		t.Fatalf("expected 2 service infos, got %d", len(infos))
	}
	if visible[0].ID != "s1" || visible[1].ID != "s3" {
		t.Errorf("unexpected visible services: %+v", visible)
	}
	if infos[0].ID != "s1" || infos[1].ID != "s3" {
		t.Errorf("unexpected service infos: %+v", infos)
	}
}

func TestDirFingerprint(t *testing.T) {
	dir := t.TempDir()

	fp1 := dirFingerprint(dir)
	if fp1 != "" {
		t.Errorf("empty dir should have empty fingerprint, got %q", fp1)
	}

	file := filepath.Join(dir, "service1.yaml")
	if err := os.WriteFile(file, []byte("id: s1\n"), 0600); err != nil {
		t.Fatal(err)
	}

	fp2 := dirFingerprint(dir)
	if fp2 == "" || fp2 == fp1 {
		t.Errorf("fingerprint should change after adding file: %q", fp2)
	}

	// Non-yaml files must be ignored
	_ = os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("foo"), 0600)
	fp3 := dirFingerprint(dir)
	if fp3 != fp2 {
		t.Errorf("fingerprint should not change for non-yaml files: %q vs %q", fp3, fp2)
	}

	// Modifying YAML file changes fingerprint
	time.Sleep(10 * time.Millisecond)
	_ = os.WriteFile(file, []byte("id: s1\nname: updated\n"), 0600)
	fp4 := dirFingerprint(dir)
	if fp4 == fp2 {
		t.Errorf("fingerprint should change after updating YAML file")
	}
}

func TestWatchServicesDir(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var reloads int32
	started := make(chan struct{})
	go func() {
		close(started)
		watchServicesDirWithInterval(ctx, dir, 50*time.Millisecond, func() {
			atomic.AddInt32(&reloads, 1)
		})
	}()

	<-started
	// Give a moment for the watcher to take the initial fingerprint
	time.Sleep(30 * time.Millisecond)

	// Add file to directory
	file := filepath.Join(dir, "service.yaml")
	if err := os.WriteFile(file, []byte("id: test\n"), 0600); err != nil {
		t.Fatal(err)
	}

	// Wait for watcher to trigger
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&reloads) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if atomic.LoadInt32(&reloads) == 0 {
		t.Error("watchServicesDir did not trigger reload after adding service.yaml")
	}
}
