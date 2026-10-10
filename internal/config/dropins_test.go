package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadServicesDir_VariousFormats(t *testing.T) {
	dir := t.TempDir()

	// 1. services list wrapper format
	f1 := filepath.Join(dir, "10-wrapper.yaml")
	body1 := `services:
  - id: "srv-wrap"
    name: "Wrapper Svc"
    prefix: "/wrap"
    target: "http://127.0.0.1:8001"
`
	if err := os.WriteFile(f1, []byte(body1), 0600); err != nil {
		t.Fatal(err)
	}

	// 2. top-level list format
	f2 := filepath.Join(dir, "20-list.yaml")
	body2 := `- id: "srv-list"
  name: "List Svc"
  prefix: "/list"
  target: "http://127.0.0.1:8002"
`
	if err := os.WriteFile(f2, []byte(body2), 0600); err != nil {
		t.Fatal(err)
	}

	// 3. single service format
	f3 := filepath.Join(dir, "30-single.yaml")
	body3 := `id: "srv-single"
name: "Single Svc"
prefix: "/single"
target: "http://127.0.0.1:8003"
`
	if err := os.WriteFile(f3, []byte(body3), 0600); err != nil {
		t.Fatal(err)
	}

	// 4. Ignored files: hidden, backup, non-yaml
	_ = os.WriteFile(filepath.Join(dir, ".hidden.yaml"), []byte("invalid content"), 0600)
	_ = os.WriteFile(filepath.Join(dir, "backup.yaml~"), []byte("invalid content"), 0600)
	_ = os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hello"), 0600)

	svcs, err := LoadServicesDir(dir)
	if err != nil {
		t.Fatalf("LoadServicesDir failed: %v", err)
	}

	if len(svcs) != 3 {
		t.Fatalf("expected 3 services, got %d", len(svcs))
	}
	if svcs[0].ID != "srv-wrap" || svcs[1].ID != "srv-list" || svcs[2].ID != "srv-single" {
		t.Errorf("unexpected services order or IDs: %+v", svcs)
	}
}

func TestMergeServices_OverridesByID(t *testing.T) {
	base := []ServiceConfig{
		{ID: "srv1", Prefix: "/s1", Target: "http://127.0.0.1:8001"},
		{ID: "srv2", Prefix: "/s2", Target: "http://127.0.0.1:8002"},
	}

	dropIns := []ServiceConfig{
		{ID: "srv2", Prefix: "/s2-new", Target: "http://127.0.0.1:9002"}, // overrides srv2
		{ID: "srv3", Prefix: "/s3", Target: "http://127.0.0.1:8003"},     // new service
	}

	merged, err := MergeServices(base, dropIns)
	if err != nil {
		t.Fatalf("MergeServices failed: %v", err)
	}

	if len(merged) != 3 {
		t.Fatalf("expected 3 merged services, got %d", len(merged))
	}
	if merged[1].ID != "srv2" || merged[1].Prefix != "/s2-new" || merged[1].Target != "http://127.0.0.1:9002" {
		t.Errorf("srv2 was not properly overridden: %+v", merged[1])
	}
	if merged[2].ID != "srv3" {
		t.Errorf("srv3 was not appended: %+v", merged[2])
	}
}

func TestMergeServices_ConflictPrefix(t *testing.T) {
	base := []ServiceConfig{
		{ID: "srv1", Prefix: "/same", Target: "http://127.0.0.1:8001"},
	}
	dropIns := []ServiceConfig{
		{ID: "srv2", Prefix: "/same", Target: "http://127.0.0.1:8002"},
	}

	_, err := MergeServices(base, dropIns)
	if err == nil {
		t.Fatal("expected error on duplicate prefix between distinct IDs, got nil")
	}
}

func TestLoadWithServicesDir_AutomaticDetection(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	cfgBody := `nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "npub1placeholder00000000000000000000000000000000000"
services:
  - id: "base"
    prefix: "/base"
    target: "http://127.0.0.1:8000"
`
	if err := os.WriteFile(configPath, []byte(cfgBody), 0600); err != nil {
		t.Fatal(err)
	}

	// Create services.d alongside config.yaml
	dropInDir := filepath.Join(dir, "services.d")
	if err := os.Mkdir(dropInDir, 0700); err != nil {
		t.Fatal(err)
	}
	dropInFile := filepath.Join(dropInDir, "grafana.yaml")
	dropInBody := `id: "grafana"
name: "Grafana"
prefix: "/grafana"
target: "http://127.0.0.1:3000"
websocket: true
`
	if err := os.WriteFile(dropInFile, []byte(dropInBody), 0600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if len(cfg.Services) != 2 {
		t.Fatalf("expected 2 services (1 base + 1 drop-in), got %d", len(cfg.Services))
	}
	if cfg.Services[1].ID != "grafana" || !cfg.Services[1].Websocket {
		t.Errorf("drop-in service not properly loaded: %+v", cfg.Services[1])
	}
	if cfg.ServicesDir != dropInDir {
		t.Errorf("expected ServicesDir = %q, got %q", dropInDir, cfg.ServicesDir)
	}
}

func TestLoadWithServicesDir_ExplicitOverride(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	cfgBody := `nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "npub1placeholder00000000000000000000000000000000000"
services:
  - id: "base"
    prefix: "/base"
    target: "http://127.0.0.1:8000"
`
	if err := os.WriteFile(configPath, []byte(cfgBody), 0600); err != nil {
		t.Fatal(err)
	}

	customDir := t.TempDir()
	dropInFile := filepath.Join(customDir, "custom.yaml")
	dropInBody := `id: "custom"
prefix: "/custom"
target: "http://127.0.0.1:4000"
`
	if err := os.WriteFile(dropInFile, []byte(dropInBody), 0600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadWithServicesDir(configPath, customDir)
	if err != nil {
		t.Fatalf("LoadWithServicesDir failed: %v", err)
	}

	if len(cfg.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(cfg.Services))
	}
	if cfg.Services[1].ID != "custom" {
		t.Errorf("override drop-in not loaded: %+v", cfg.Services[1])
	}
}

func TestLoadDropInFile_CamelCaseFields(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "camel.yaml")
	content := `id: "camel-svc"
name: "Camel Service"
prefix: "/camel"
target: "http://127.0.0.1:9999"
stripPrefix: true
websocket: true
originHost: "127.0.0.1:9999"
launchTokenFile: "/path/to/token"
forwardAuthorization: true
rootPaths:
  - "/locales/"
`
	if err := os.WriteFile(filePath, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}

	svcs, err := loadDropInFile(filePath)
	if err != nil {
		t.Fatalf("loadDropInFile failed: %v", err)
	}
	if len(svcs) != 1 {
		t.Fatalf("expected 1 service, got %d", len(svcs))
	}
	s := svcs[0]
	if !s.StripPrefix {
		t.Errorf("expected StripPrefix=true, got false")
	}
	if s.OriginHost != "127.0.0.1:9999" {
		t.Errorf("expected OriginHost=127.0.0.1:9999, got %q", s.OriginHost)
	}
	if s.LaunchTokenFile != "/path/to/token" {
		t.Errorf("expected LaunchTokenFile=/path/to/token, got %q", s.LaunchTokenFile)
	}
	if !s.ForwardAuthorization {
		t.Errorf("expected ForwardAuthorization=true, got false")
	}
	if len(s.RootPaths) != 1 || s.RootPaths[0] != "/locales/" {
		t.Errorf("expected RootPaths=[/locales/], got %v", s.RootPaths)
	}
}

