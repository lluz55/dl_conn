package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"
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
