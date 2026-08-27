package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"dl_conn/internal/nostr"
	"github.com/spf13/viper"

	"gopkg.in/yaml.v3"
)

// NostrConfig holds Nostr signaling configuration.
type NostrConfig struct {
	Nsec            string   `mapstructure:"nsec"`
	NsecFile        string   `mapstructure:"nsecFile"`
	Relays            []string `mapstructure:"relays"`
	AuthorizedNpubs   []string `mapstructure:"authorizedNpubs"`
	FallbackNip04     bool      `mapstructure:"fallbackNip04"`
}

// TunnelConfig holds Cloudflare Tunnel settings.
type TunnelConfig struct {
	ListenPort      int    `mapstructure:"listenPort"`
	CloudflaredPath string `mapstructure:"cloudflaredPath"`
	AutoStart       bool   `mapstructure:"autoStart"`
	InactivityTimeout time.Duration `mapstructure:"inactivityTimeout"`
}

// ServiceConfig describes a single proxied service.
type ServiceConfig struct {
	ID          string `mapstructure:"id"`
	Name        string `mapstructure:"name"`
	Icon        string `mapstructure:"icon"`
	Prefix      string `mapstructure:"prefix"`
	Target      string `mapstructure:"target"`
	StripPrefix bool   `mapstructure:"stripPrefix"`
	Websocket   bool   `mapstructure:"websocket"`
	// Hidden excludes the service from Nostr discovery and health-status
	// reporting while still proxying it. For a backend whose frontend needs
	// extra root-level routes (e.g. Frigate's own "/api"/"/ws", unaware of
	// its "/frigate" mount prefix), those routes point at the same target
	// but aren't a distinct service the user should see or click into.
	Hidden bool `mapstructure:"hidden"`
	// RootPaths lists sub-resource directories this backend serves from its
	// own root but whose frontend asks for at the wrong place once mounted
	// under Prefix. Frigate's i18next config is the known case: its
	// loadPath is "locales/{{lng}}/{{ns}}.json" — document-relative, so the
	// browser resolves it against whatever SPA route is currently in the
	// address bar ("/frigate/settings/cameras" → "/frigate/settings/locales/…").
	// Declaring "/locales/" lets the router recognize such a request
	// wherever it lands and rewrite it back to the backend's root form.
	// Each entry must start and end with "/".
	RootPaths []string `mapstructure:"rootPaths"`
	// ForwardedFor controls whether the proxy sends X-Forwarded-For to this
	// backend. Unset means yes, which is what a reverse proxy should do:
	// the header carries the visitor's real IP down the chain (cloudflared
	// → dl_conn → backend). Set it to false for a backend that refuses
	// requests carrying the header unless the proxy is on an allowlist it
	// keeps — Home Assistant answers 400 Bad Request to every request when
	// "use_x_forwarded_for" is on and dl_conn's address isn't in its
	// "trusted_proxies". Suppressing the header is the workaround when the
	// backend's own config is out of reach; the backend then sees every
	// request as coming from dl_conn itself.
	ForwardedFor *bool `mapstructure:"forwardedFor"`
}

// SendsForwardedFor reports whether X-Forwarded-For should be passed to this
// service. Absent configuration means yes.
func (s *ServiceConfig) SendsForwardedFor() bool {
	return s.ForwardedFor == nil || *s.ForwardedFor
}

// AuthConfig holds token and session TTLs.
type AuthConfig struct {
	TokenTTL    time.Duration `mapstructure:"tokenTTL"`
	SessionTTL  time.Duration `mapstructure:"sessionTTL"`
}

// Config is the top-level configuration.
type Config struct {
	Nostr   NostrConfig    `mapstructure:"nostr"`
	Tunnel  TunnelConfig   `mapstructure:"tunnel"`
	Services []ServiceConfig `mapstructure:"services"`
	Auth    AuthConfig     `mapstructure:"auth"`
}

// DefaultRelays contains public Nostr relays used when none are explicitly configured.
var DefaultRelays = []string{
	"wss://relay.damus.io",
	"wss://nos.lol",
	"wss://relay.nostr.band",
	"wss://relay.primal.net",
	"wss://nostr.mom",
	"wss://relay.snort.social",
	"wss://nostr.oxtr.dev",
	"wss://nostr.land",
}

// Load reads configuration from a YAML file and/or environment variables,
// validates it, and returns a populated Config.
func Load(configPath string) (*Config, error) {
	v := viper.New()

	v.SetEnvPrefix("DL_CONN")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if configPath != "" {
		if _, err := os.Stat(configPath); err != nil {
			return nil, fmt.Errorf("config file not found: %w", err)
		}
		v.SetConfigFile(configPath)
		v.SetConfigType("yaml")
		if err := v.ReadInConfig(); err != nil {
			return nil, fmt.Errorf("reading config: %w", err)
		}
	}

	// defaults
	v.SetDefault("nostr.relays", DefaultRelays)
	v.SetDefault("tunnel.listenPort", 9099)
	v.SetDefault("tunnel.cloudflaredPath", "cloudflared")
	v.SetDefault("tunnel.autoStart", true)
	v.SetDefault("tunnel.inactivityTimeout", "10m")
	v.SetDefault("auth.tokenTTL", "120s")
	v.SetDefault("auth.sessionTTL", "4h")

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("decoding config: %w", err)
	}

	if len(cfg.Nostr.Relays) == 0 {
		cfg.Nostr.Relays = make([]string, len(DefaultRelays))
		copy(cfg.Nostr.Relays, DefaultRelays)
	}

	// re-parse duration from env strings that viper stores as string for time.Duration
	if err := parseDurations(&cfg); err != nil {
		return nil, err
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}


func parseDurations(cfg *Config) error {
	// viper may store durations as raw strings; re-parse if needed
	if cfg.Tunnel.InactivityTimeout == 0 {
		cfg.Tunnel.InactivityTimeout = 10 * time.Minute
	}
	if cfg.Auth.TokenTTL == 0 {
		cfg.Auth.TokenTTL = 120 * time.Second
	}
	if cfg.Auth.SessionTTL == 0 {
		cfg.Auth.SessionTTL = 4 * time.Hour
	}
	return nil
}

// Validate enforces business rules on the configuration.
func (c *Config) Validate() error {
	if c.Tunnel.ListenPort < 1 || c.Tunnel.ListenPort > 65535 {
		return errors.New("tunnel.listenPort must be between 1 and 65535")
	}

	for _, n := range c.Nostr.AuthorizedNpubs {
		if strings.TrimSpace(n) == "" {
			return errors.New("authorized_npubs contains an empty entry")
		}
	}
	if len(c.Nostr.AuthorizedNpubs) == 0 {
		return errors.New("at least one authorized_npub must be configured")
	}

	if len(c.Nostr.Relays) == 0 {
		return errors.New("at least one nostr relay URL must be configured")
	}
	for _, r := range c.Nostr.Relays {
		u, err := url.Parse(r)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return fmt.Errorf("invalid relay URL: %s", r)
		}
	}

	if c.Nostr.Nsec == "" && c.Nostr.NsecFile == "" {
		return errors.New("either nostr.nsec or nostr.nsecFile must be set")
	}

	for _, s := range c.Services {
		if err := s.Validate(); err != nil {
			return fmt.Errorf("service %q: %w", s.ID, err)
		}
	}
	if len(c.Services) == 0 {
		return errors.New("at least one service must be configured")
	}

	return nil
}

func (s *ServiceConfig) Validate() error {
	if s.ID == "" {
		return errors.New("id is required")
	}
	if s.Target == "" {
		return errors.New("target is required")
	}
	u, err := url.Parse(s.Target)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("invalid target URL: %s", s.Target)
	}
	if !strings.HasPrefix(s.Prefix, "/") {
		return fmt.Errorf("prefix must start with /: %s", s.Prefix)
	}
	for _, rp := range s.RootPaths {
		if !strings.HasPrefix(rp, "/") || !strings.HasSuffix(rp, "/") || rp == "/" {
			return fmt.Errorf("rootPath must be a directory path like /locales/: %s", rp)
		}
	}
	return nil
}

// GetNsec resolves the Nostr private key from nsec or nsecFile.
func (c *Config) GetNsec() (string, error) {
	if c.Nostr.Nsec != "" {
		return c.Nostr.Nsec, nil
	}
	if c.Nostr.NsecFile != "" {
		b, err := os.ReadFile(c.Nostr.NsecFile)
		if err != nil {
			return "", fmt.Errorf("reading nsec file: %w", err)
		}
		return strings.TrimSpace(string(b)), nil
	}
	return "", errors.New("no nsec configured")
}

// PortString returns the listen port as a string for net.Listen.
func (c *Config) PortString() string {
	return strconv.Itoa(c.Tunnel.ListenPort)
}

// AddAuthorizedNpub appends a new npub to the authorizedNpubs list in the
// YAML config at path. It validates the npub (must be a valid bech32 npub
// decodable by DecodeNpub), normalises case via the decoder, and is
// idempotent: if the npub is already present it returns (false, nil).
//
// The file is edited in-place preserving comments and ordering using
// yaml.v3 Node APIs, then written atomically (temp → fsync → rename).
// Before the rename the result is re-parsed and validated; on failure the
// original file is untouched.
func AddAuthorizedNpub(path, npub string) (bool, error) {
	// Validate + normalise the npub.
	hexPub, err := nostr.DecodeNpub(npub)
	if err != nil {
		return false, fmt.Errorf("invalid npub %q: %w", npub, err)
	}
	normalisedNpub, err := nostr.NpubFromHex(hexPub)
	if err != nil {
		return false, fmt.Errorf("encoding npub: %w", err)
	}

	// Read + parse the YAML as a Node tree.
	data, err := os.ReadFile(path)
	if err != nil {
		return false, fmt.Errorf("reading config: %w", err)
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return false, fmt.Errorf("parsing config: %w", err)
	}

	// Navigate: doc → first mapping → key "nostr" → mapping → key "authorizedNpubs" → sequence.
	root := doc.Content[0] // first (and only) document node
	nozKey, nostrNode := findMapKey(root, "nostr")
	if nozKey == nil {
		return false, fmt.Errorf("config has no 'nostr' key")
	}
	npubKey, listNode := findMapKey(nostrNode, "authorizedNpubs")
	if npubKey == nil {
		return false, fmt.Errorf("config has no 'nostr.authorizedNpubs' key")
	}

	// Check for duplicates (compare hex, not bech32, so case-insensitive).
	for _, item := range listNode.Content {
		existing := strings.TrimSpace(item.Value)
		if existing == "" {
			continue
		}
		existingHex, err := nostr.DecodeNpub(existing)
		if err != nil {
			continue // skip malformed entries
		}
		if existingHex == hexPub {
			return false, nil // already present
		}
	}

	// Append the new npub.
	listNode.Content = append(listNode.Content, &yaml.Node{
		Kind:  yaml.ScalarNode,
		Tag:   "!!str",
		Value: normalisedNpub,
	})

	// Marshal back to bytes.
	newData, err := yaml.Marshal(&doc)
	if err != nil {
		return false, fmt.Errorf("marshalling config: %w", err)
	}

	// Validate the result before writing.
	if err := validateConfigBytes(newData); err != nil {
		return false, fmt.Errorf("resulting config is invalid, aborting: %w", err)
	}

	// Atomic write: temp file in same dir → fsync → rename.
	if err := atomicWrite(path, newData); err != nil {
		return false, err
	}

	return true, nil
}



// findMapKey searches a YAML mapping node for a key with the given name and
// returns both the key node and the value node. Returns (nil, nil) if not found.
func findMapKey(mapping *yaml.Node, key string) (*yaml.Node, *yaml.Node) {
	if mapping.Kind != yaml.MappingNode {
		return nil, nil
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i], mapping.Content[i+1]
		}
	}
	return nil, nil
}

// validateConfigBytes parses the YAML bytes via viper+Config.Validate to
// catch structural errors before overwriting the file.
func validateConfigBytes(data []byte) error {
	tmpFile, err := os.CreateTemp("", "dl-conn-validate-*.yaml")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	_, err = Load(tmpPath)
	return err
}

// atomicWrite writes data to path atomically via temp+fsync+rename, preserving
// the original file's permissions.
func atomicWrite(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmpFile, err := os.CreateTemp(dir, ".dl-conn-*.yaml.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	// Preserve original permissions.
	if info, err := os.Stat(path); err == nil {
		tmpFile.Chmod(info.Mode())
	}

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("fsync temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming temp file: %w", err)
	}
	return nil
}
