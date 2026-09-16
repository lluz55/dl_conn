package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	err := os.WriteFile(path, []byte(minimalValidConfig()), 0600)
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if cfg.Tunnel.ListenPort != 9099 {
		t.Errorf("ListenPort = %d, want 9099", cfg.Tunnel.ListenPort)
	}
	if cfg.Auth.TokenTTL != 120*time.Second {
		t.Errorf("TokenTTL = %v, want 120s", cfg.Auth.TokenTTL)
	}
	if cfg.Auth.SessionTTL != 4*time.Hour {
		t.Errorf("SessionTTL = %v, want 4h", cfg.Auth.SessionTTL)
	}
}

func TestLoad_ServiceHidden(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := `nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "npub1placeholder00000000000000000000000000000000000"
services:
  - id: "frigate"
    prefix: "/frigate"
    target: "http://10.0.66.1:5000"
  - id: "frigate-api"
    prefix: "/api"
    target: "http://10.0.66.1:5000"
    hidden: true
`
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Services[0].Hidden {
		t.Error("frigate: Hidden = true, want false (default)")
	}
	if !cfg.Services[1].Hidden {
		t.Error("frigate-api: Hidden = false, want true")
	}
}

func TestValidate_EmptyAuthorizedNpubs(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Nsec:            "nsec1placeholder",
			Relays:          []string{"wss://relay.damus.io"},
			AuthorizedNpubs: []string{},
		},
		Tunnel: TunnelConfig{ListenPort: 9099},
		Services: []ServiceConfig{
			{ID: "hass", Name: "HA", Prefix: "/hass", Target: "http://10.0.66.1:8123"},
		},
	}
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for empty authorized_npubs")
	}
}

func TestValidate_DynamicDeniedPort(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	data := minimalValidConfig() + "\ndynamicPorts:\n  deniedPorts: [8123, 70000]\n"
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "dynamicPorts.deniedPorts") {
		t.Fatalf("Load() error = %v, want dynamic denied port error", err)
	}
}

func TestValidate_InvalidPort(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Nsec:            "nsec1placeholder",
			Relays:          []string{"wss://relay.damus.io"},
			AuthorizedNpubs: []string{"npub1something"},
		},
		Tunnel: TunnelConfig{ListenPort: 70000},
		Services: []ServiceConfig{
			{ID: "hass", Prefix: "/hass", Target: "http://10.0.66.1:8123"},
		},
	}
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for invalid port")
	}
}

// Validate does not require nsec/nsecFile in the config: a deployment can
// supply the key exclusively via the --nsec/--nsec-file CLI flags (e.g. from
// a systemd secret), which are only resolved later in main, after Load has
// already succeeded. Enforcing it here would make that path unusable.
func TestValidate_NoNsecAllowed(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Relays:          []string{"wss://relay.damus.io"},
			AuthorizedNpubs: []string{"npub1something"},
		},
		Tunnel: TunnelConfig{ListenPort: 9099},
		Services: []ServiceConfig{
			{ID: "hass", Prefix: "/hass", Target: "http://10.0.66.1:8123"},
		},
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("Validate() should not require nsec: %v", err)
	}
}

func TestValidate_InvalidRelayURL(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Nsec:            "nsec1placeholder",
			Relays:          []string{"not-a-url"},
			AuthorizedNpubs: []string{"npub1something"},
		},
		Tunnel: TunnelConfig{ListenPort: 9099},
		Services: []ServiceConfig{
			{ID: "hass", Prefix: "/hass", Target: "http://10.0.66.1:8123"},
		},
	}
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for invalid relay URL")
	}
}

func TestValidate_EmptyServices(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Nsec:            "nsec1placeholder",
			Relays:          []string{"wss://relay.damus.io"},
			AuthorizedNpubs: []string{"npub1something"},
		},
		Tunnel:   TunnelConfig{ListenPort: 9099},
		Services: []ServiceConfig{},
	}
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for empty services")
	}
}

func TestValidate_ServiceInvalidTarget(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Nsec:            "nsec1placeholder",
			Relays:          []string{"wss://relay.damus.io"},
			AuthorizedNpubs: []string{"npub1something"},
		},
		Tunnel: TunnelConfig{ListenPort: 9099},
		Services: []ServiceConfig{
			{ID: "hass", Prefix: "/hass", Target: "not-a-url"},
		},
	}
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for invalid service target")
	}
}

func TestValidate_ServiceMissingPrefixSlash(t *testing.T) {
	c := &Config{
		Nostr: NostrConfig{
			Nsec:            "nsec1placeholder",
			Relays:          []string{"wss://relay.damus.io"},
			AuthorizedNpubs: []string{"npub1something"},
		},
		Tunnel: TunnelConfig{ListenPort: 9099},
		Services: []ServiceConfig{
			{ID: "hass", Prefix: "hass", Target: "http://10.0.66.1:8123"},
		},
	}
	err := c.Validate()
	if err == nil {
		t.Fatal("expected error for prefix without leading slash")
	}
}

func TestValidate_ServiceReservedPrefixCollision(t *testing.T) {
	// Guards the daemon against a panic on duplicate http.ServeMux
	// registration: cmd/dl_conn/main.go always registers "/auth" and
	// "/local/" itself before any configured service prefix, including one
	// merged in from the frontend's custom-services export fragment.
	for _, prefix := range []string{"/auth", "/local", "/local/8080"} {
		t.Run(prefix, func(t *testing.T) {
			s := ServiceConfig{ID: "custom", Prefix: prefix, Target: "http://127.0.0.1:8080"}
			err := s.Validate()
			if err == nil {
				t.Fatalf("Validate() = nil for reserved prefix %q, want error", prefix)
			}
			if !strings.Contains(err.Error(), "reserved") {
				t.Errorf("Validate() error = %v, want it to mention the reserved route", err)
			}
		})
	}
	// A prefix that merely contains a reserved segment as a substring, not as
	// a path component, must not be rejected (e.g. "/authorization").
	for _, prefix := range []string{"/authorization", "/localdev"} {
		t.Run("not reserved: "+prefix, func(t *testing.T) {
			s := ServiceConfig{ID: "custom", Prefix: prefix, Target: "http://127.0.0.1:8080"}
			if err := s.Validate(); err != nil {
				t.Errorf("Validate() = %v, want nil for non-colliding prefix %q", err, prefix)
			}
		})
	}
}

func TestGetNsec_FromNsec(t *testing.T) {
	c := &Config{Nostr: NostrConfig{Nsec: "nsec1abc"}}
	v, err := c.GetNsec()
	if err != nil || v != "nsec1abc" {
		t.Fatalf("got %q, %v; want nsec1abc, nil", v, err)
	}
}

func TestGetNsec_FromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nsec")
	os.WriteFile(path, []byte("  nsec1fromfile  "), 0600)

	c := &Config{Nostr: NostrConfig{Nsec: "", NsecFile: path}}
	v, err := c.GetNsec()
	if err != nil || v != "nsec1fromfile" {
		t.Fatalf("got %q, %v; want nsec1fromfile, nil", v, err)
	}
}

func minimalValidConfig() string {
	return `nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "npub1placeholder00000000000000000000000000000000000"
services:
  - id: "hass"
    name: "Home Assistant"
    prefix: "/hass"
    target: "http://10.0.66.1:8123"
`
}

func TestValidate_ServiceRootPaths(t *testing.T) {
	tests := []struct {
		name      string
		rootPaths []string
		wantErr   bool
	}{
		{"none declared", nil, false},
		{"directory path", []string{"/locales/"}, false},
		{"missing trailing slash", []string{"/locales"}, true},
		{"missing leading slash", []string{"locales/"}, true},
		{"bare root", []string{"/"}, true},
	}
	for _, tt := range tests {
		s := ServiceConfig{ID: "frigate", Prefix: "/frigate", Target: "http://127.0.0.1:5000", RootPaths: tt.rootPaths}
		err := s.Validate()
		if tt.wantErr && err == nil {
			t.Errorf("%s: Validate() = nil, want error", tt.name)
		}
		if !tt.wantErr && err != nil {
			t.Errorf("%s: Validate() = %v, want nil", tt.name, err)
		}
	}
}

func TestLoad_ServiceRootPaths(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := `nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "npub1placeholder00000000000000000000000000000000000"
services:
  - id: "hass"
    prefix: "/hass"
    target: "http://10.0.66.1:8123"
  - id: "frigate"
    prefix: "/frigate"
    target: "http://10.0.66.1:5000"
    rootPaths:
      - "/locales/"
`
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if len(cfg.Services[0].RootPaths) != 0 {
		t.Errorf("hass: RootPaths = %v, want empty", cfg.Services[0].RootPaths)
	}
	if got := cfg.Services[1].RootPaths; len(got) != 1 || got[0] != "/locales/" {
		t.Errorf("frigate: RootPaths = %v, want [/locales/]", got)
	}
}

func TestLoad_ServiceForwardedFor(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := `nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "npub1placeholder00000000000000000000000000000000000"
services:
  - id: "frigate"
    prefix: "/frigate"
    target: "http://10.0.66.1:5000"
  - id: "hass"
    prefix: "/hass"
    target: "http://10.1.1.10:8123"
    forwardedFor: false
  - id: "z2m"
    prefix: "/z2m"
    target: "http://10.1.1.10:8080"
    forwardedFor: true
`
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Services[0].ForwardedFor != nil {
		t.Errorf("frigate: ForwardedFor = %v, want nil (unset)", *cfg.Services[0].ForwardedFor)
	}
	want := []bool{true, false, true}
	for i, w := range want {
		if got := cfg.Services[i].SendsForwardedFor(); got != w {
			t.Errorf("%s: SendsForwardedFor() = %v, want %v", cfg.Services[i].ID, got, w)
		}
	}
}

func TestServiceConfig_ValidateLaunchTokenFile(t *testing.T) {
	base := ServiceConfig{ID: "dsh", Prefix: "/dsh", Target: "http://127.0.0.1:3080"}
	base.LaunchTokenFile = "/run/dsh/web-url"
	if err := base.Validate(); err != nil {
		t.Fatalf("absolute launchTokenFile rejected: %v", err)
	}
	base.LaunchTokenFile = "run/dsh/web-url"
	if err := base.Validate(); err == nil {
		t.Fatal("relative launchTokenFile accepted")
	}
}

func TestServiceConfig_ValidateOriginHost(t *testing.T) {
	tests := []struct {
		name       string
		originHost string
		wantErr    bool
	}{
		{"empty is the ordinary default", "", false},
		{"host:port authority", "127.0.0.1:3080", false},
		{"bare host", "harness.internal", false},
		{"a URL is refused", "http://127.0.0.1:3080", true},
		{"an authority with a path is refused", "127.0.0.1:3080/api", true},
	}
	for _, tt := range tests {
		s := ServiceConfig{ID: "dsh", Prefix: "/dsh", Target: "http://127.0.0.1:3080", OriginHost: tt.originHost}
		err := s.Validate()
		if (err != nil) != tt.wantErr {
			t.Errorf("%s: Validate() error = %v, wantErr = %v", tt.name, err, tt.wantErr)
		}
	}
}
