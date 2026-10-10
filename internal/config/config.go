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
	Relays          []string `mapstructure:"relays"`
	AuthorizedNpubs []string `mapstructure:"authorizedNpubs"`
	FallbackNip04   bool     `mapstructure:"fallbackNip04"`
}

// TunnelConfig holds Cloudflare Tunnel settings.
type TunnelConfig struct {
	ListenPort        int           `mapstructure:"listenPort"`
	CloudflaredPath   string        `mapstructure:"cloudflaredPath"`
	AutoStart         bool          `mapstructure:"autoStart"`
	InactivityTimeout time.Duration `mapstructure:"inactivityTimeout"`
}

// ServiceConfig describes a single proxied service.
type ServiceConfig struct {
	ID   string `mapstructure:"id" yaml:"id"`
	Name string `mapstructure:"name" yaml:"name"`
	Icon string `mapstructure:"icon" yaml:"icon"`
	// Description is optional, free-form text shown under the service's name
	// on the dashboard. Purely cosmetic — never used for routing.
	Description string `mapstructure:"description" yaml:"description"`
	Prefix      string `mapstructure:"prefix" yaml:"prefix"`
	Target      string `mapstructure:"target" yaml:"target"`
	StripPrefix bool   `mapstructure:"stripPrefix" yaml:"stripPrefix"`
	Websocket   bool   `mapstructure:"websocket" yaml:"websocket"`
	// Hidden excludes the service from Nostr discovery and health-status
	// reporting while still proxying it. For a backend whose frontend needs
	// extra root-level routes (e.g. Frigate's own "/api"/"/ws", unaware of
	// its "/frigate" mount prefix), those routes point at the same target
	// but aren't a distinct service the user should see or click into.
	Hidden bool `mapstructure:"hidden" yaml:"hidden"`
	// RootPaths lists sub-resource directories this backend serves from its
	// own root but whose frontend asks for at the wrong place once mounted
	// under Prefix. Frigate's i18next config is the known case: its
	// loadPath is "locales/{{lng}}/{{ns}}.json" — document-relative, so the
	// browser resolves it against whatever SPA route is currently in the
	// address bar ("/frigate/settings/cameras" → "/frigate/settings/locales/…").
	// Declaring "/locales/" lets the router recognize such a request
	// wherever it lands and rewrite it back to the backend's root form.
	// Each entry must start and end with "/".
	RootPaths []string `mapstructure:"rootPaths" yaml:"rootPaths"`
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
	ForwardedFor *bool `mapstructure:"forwardedFor" yaml:"forwardedFor"`
	// OriginHost makes the proxy present this request to the backend as if it
	// had arrived directly at the backend's own address: the Host header is
	// replaced with this authority, and the browser's Origin and
	// Sec-Fetch-Site headers are dropped.
	//
	// This exists for a backend that fences its API on the Host header to
	// defend against DNS rebinding — the DeepSeek Harness (`dsh web`) is the
	// known case: it accepts /api only when Host is loopback (or one of its
	// --trusted-host authorities) and refuses anything whose Origin names a
	// different origin. Behind this proxy the browser sends the public tunnel
	// hostname in both, so every API call and the WebSocket upgrade get 403
	// while the HTML itself loads fine.
	//
	// Naming the backend's own authority here satisfies that fence without
	// pinning the tunnel hostname anywhere, which is what makes it work with
	// the ephemeral trycloudflare.com URLs that change on every restart.
	// Dropping Origin is safe for the same reason the backend accepts its
	// absence: a cross-site request from a malicious page still fails, because
	// reaching this proxy at all requires the dl_conn session cookie, which is
	// SameSite and never attached to such a request.
	//
	// Use "host:port" (or bare "host"); the value must match what the backend
	// considers its own authority. Empty means pass the browser's Host through
	// unchanged, which is the correct default for every ordinary backend.
	OriginHost string `mapstructure:"originHost" yaml:"originHost"`
	// LaunchTokenFile enables an authenticated, server-side browser-session
	// bootstrap for services such as dsh. The file contains the local launch
	// URL printed by the service (including its token). dl_conn reads and
	// redeems it only after its own Zero-Trust session has been validated, so
	// the token never crosses the public tunnel.
	LaunchTokenFile string `mapstructure:"launchTokenFile" yaml:"launchTokenFile"`
	// ForwardAuthorization passes the caller's Authorization header through to
	// this backend instead of stripping it.
	//
	// Stripping is the default because "Authorization: Bearer <sessionID>" is
	// a credential dl_conn itself issued (see auth.SessionManager.GetSessionID):
	// forwarding it verbatim hands a live, tunnel-wide session to whatever
	// process is behind the prefix, which can then replay it against dl_conn's
	// own protected routes. Only a backend that is *supposed* to receive a
	// caller-supplied credential — one behind its own HTTP Basic auth, say —
	// has any business seeing it, and the operator opting in is stating that
	// the backend is trusted with it.
	ForwardAuthorization bool `mapstructure:"forwardAuthorization" yaml:"forwardAuthorization"`
}

// SendsForwardedFor reports whether X-Forwarded-For should be passed to this
// service. Absent configuration means yes.
func (s *ServiceConfig) SendsForwardedFor() bool {
	return s.ForwardedFor == nil || *s.ForwardedFor
}

// UnmarshalYAML implements custom unmarshaling for ServiceConfig to tolerate
// camelCase, snake_case, and all-lowercase variants for YAML keys in drop-ins.
func (s *ServiceConfig) UnmarshalYAML(value *yaml.Node) error {
	type plain ServiceConfig
	if err := value.Decode((*plain)(s)); err != nil {
		return err
	}

	if value.Kind == yaml.MappingNode {
		for i := 0; i < len(value.Content); i += 2 {
			key := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(value.Content[i].Value, "_", ""), "-", ""))
			val := value.Content[i+1]
			switch key {
			case "stripprefix":
				_ = val.Decode(&s.StripPrefix)
			case "originhost":
				_ = val.Decode(&s.OriginHost)
			case "launchtokenfile":
				_ = val.Decode(&s.LaunchTokenFile)
			case "forwardauthorization":
				_ = val.Decode(&s.ForwardAuthorization)
			case "rootpaths":
				_ = val.Decode(&s.RootPaths)
			case "forwardedfor":
				_ = val.Decode(&s.ForwardedFor)
			case "websocket":
				_ = val.Decode(&s.Websocket)
			case "hidden":
				_ = val.Decode(&s.Hidden)
			case "id":
				_ = val.Decode(&s.ID)
			case "name":
				_ = val.Decode(&s.Name)
			case "icon":
				_ = val.Decode(&s.Icon)
			case "description":
				_ = val.Decode(&s.Description)
			case "prefix":
				_ = val.Decode(&s.Prefix)
			case "target":
				_ = val.Decode(&s.Target)
			}
		}
	}
	return nil
}

// DynamicPortsConfig controls the authenticated /local/<port>/ proxy.
// Ports below 1024, the daemon's own listeners, and SSH are always denied;
// DeniedPorts lets operators add host-specific sensitive ports.
type DynamicPortsConfig struct {
	DeniedPorts []int `mapstructure:"deniedPorts"`
}

// AuthConfig holds token and session TTLs and the edge-hardening knobs that
// bound what an unauthenticated caller can do to the daemon.
type AuthConfig struct {
	TokenTTL   time.Duration `mapstructure:"tokenTTL"`
	SessionTTL time.Duration `mapstructure:"sessionTTL"`
	// RateLimitPerSec and RateLimitBurst bound how fast a single client
	// address may hit /auth. Redeeming a token mints a session and mutates
	// the in-memory session map; without a ceiling, anyone who can reach the
	// tunnel can turn the endpoint into a token-guessing oracle (or simply
	// churn sessions) as fast as the network allows. Zero means default.
	RateLimitPerSec float64 `mapstructure:"rateLimitPerSec"`
	RateLimitBurst  int     `mapstructure:"rateLimitBurst"`
	// LogIPs controls how client addresses are written to the daemon log.
	// nil (absent) means log them anonymized — IPv4 truncated to its network
	// and IPv6 to its /48 — which keeps the log useful for correlating a
	// session's own requests while dropping the personally identifying tail
	// that log shipping (journalctl → Loki/Sentry) would otherwise fan out.
	// Explicit false writes "[redacted]" instead; true also anonymizes, it
	// simply states the intent. See auth.Anonymize.
	LogIPs *bool `mapstructure:"logIPs"`
	// PartitionedCookies adds the CHIPS "Partitioned" attribute to the
	// cookies dl_conn issues, so they are keyed by the top-level site
	// embedding the tunnel in an iframe rather than by the shared public
	// suffix of trycloudflare.com. This matters because every ephemeral
	// tunnel lives under the same registrable domain: an unpartitioned
	// cookie set by one tunnel is offered to every other tunnel a user
	// visits. Browsers ignore the attribute when they don't implement it, so
	// it is safe to set unconditionally — but it is opt-in here to keep
	// older clients (which never send it back) on the plain path until
	// CHIPS support is worth relying on.
	PartitionedCookies bool `mapstructure:"partitionedCookies"`
	// StepUpProtected lists the endpoints that additionally require a
	// step-up proof. Empty (the default) keeps every route protected by the
	// session alone, which is today's behavior.
	StepUpProtected []string `mapstructure:"stepUpProtected"`
}

// LogsIPs reports whether client addresses are anonymized in the daemon log.
// Absent configuration means anonymized, not plaintext.
func (a *AuthConfig) LogsIPs() bool {
	return a.LogIPs == nil || *a.LogIPs
}

// RequiresStepUp reports whether path is in the step-up-protected set. The
// match is exact: the list names concrete daemon routes, and a prefix rule
// would silently protect more than the operator wrote.
func (a *AuthConfig) RequiresStepUp(path string) bool {
	for _, p := range a.StepUpProtected {
		if p == path {
			return true
		}
	}
	return false
}

// TelemetryConfig holds host telemetry collection settings.
type TelemetryConfig struct {
	Enabled         bool `mapstructure:"enabled"`
	IntervalSeconds int  `mapstructure:"intervalSeconds"`
	RetentionDays   int  `mapstructure:"retentionDays"`
	ExposeViaNostr  bool `mapstructure:"exposeViaNostr"`
}

// Config is the top-level configuration.
type Config struct {
	Nostr        NostrConfig        `mapstructure:"nostr"`
	Tunnel       TunnelConfig       `mapstructure:"tunnel"`
	Services     []ServiceConfig    `mapstructure:"services"`
	ServicesDir  string             `mapstructure:"servicesDir"`
	DynamicPorts DynamicPortsConfig `mapstructure:"dynamicPorts"`
	Auth         AuthConfig         `mapstructure:"auth"`
	Telemetry    TelemetryConfig    `mapstructure:"telemetry"`
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
// merges drop-in services from services.d if present, validates it, and returns
// a populated Config.
func Load(configPath string) (*Config, error) {
	return LoadWithServicesDir(configPath, "")
}

// LoadWithServicesDir reads configuration, optionally overriding or scanning
// the drop-in services directory, merges services, validates, and returns Config.
func LoadWithServicesDir(configPath, servicesDirOverride string) (*Config, error) {
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
	v.SetDefault("dynamicPorts.deniedPorts", []int{22})
	v.SetDefault("auth.tokenTTL", "120s")
	v.SetDefault("auth.sessionTTL", "4h")
	v.SetDefault("auth.rateLimitPerSec", 10.0)
	v.SetDefault("auth.rateLimitBurst", 20)
	v.SetDefault("auth.partitionedCookies", false)
	v.SetDefault("telemetry.enabled", true)
	v.SetDefault("telemetry.intervalSeconds", 10)
	v.SetDefault("telemetry.retentionDays", 7)
	v.SetDefault("telemetry.exposeViaNostr", false)

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

	// Load and merge drop-in services if directory exists
	effectiveServicesDir := ResolveServicesDir(configPath, cfg.ServicesDir, servicesDirOverride)
	if effectiveServicesDir != "" {
		dropIns, err := LoadServicesDir(effectiveServicesDir)
		if err != nil {
			return nil, err
		}
		merged, err := MergeServices(cfg.Services, dropIns)
		if err != nil {
			return nil, err
		}
		cfg.Services = merged
		cfg.ServicesDir = effectiveServicesDir
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
	if cfg.Auth.RateLimitPerSec <= 0 {
		cfg.Auth.RateLimitPerSec = 10
	}
	if cfg.Auth.RateLimitBurst <= 0 {
		cfg.Auth.RateLimitBurst = 20
	}
	if cfg.Telemetry.IntervalSeconds == 0 {
		cfg.Telemetry.IntervalSeconds = 10
	}
	if cfg.Telemetry.RetentionDays == 0 {
		cfg.Telemetry.RetentionDays = 7
	}
	return nil
}

// Validate enforces business rules on the configuration.
func (c *Config) Validate() error {
	if c.Tunnel.ListenPort < 1 || c.Tunnel.ListenPort > 65535 {
		return errors.New("tunnel.listenPort must be between 1 and 65535")
	}

	for _, port := range c.DynamicPorts.DeniedPorts {
		if port < 1 || port > 65535 {
			return fmt.Errorf("dynamicPorts.deniedPorts contains invalid port: %d", port)
		}
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

// reservedRoutePrefixes lists the mux patterns cmd/dl_conn/main.go registers
// unconditionally ("/auth", "/auth/logout", "/local/") before any configured
// service prefix. A configured service claiming one of these — including via
// a merged export fragment from the frontend's custom-services feature —
// would collide on http.ServeMux registration and panic the daemon at
// startup, so it is rejected here as a config error instead.
var reservedRoutePrefixes = []string{"/auth", "/local"}

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
	for _, reserved := range reservedRoutePrefixes {
		if s.Prefix == reserved || strings.HasPrefix(s.Prefix, reserved+"/") {
			return fmt.Errorf("prefix %q collides with the daemon's reserved %q route", s.Prefix, reserved)
		}
	}
	for _, rp := range s.RootPaths {
		if !strings.HasPrefix(rp, "/") || !strings.HasSuffix(rp, "/") || rp == "/" {
			return fmt.Errorf("rootPath must be a directory path like /locales/: %s", rp)
		}
	}
	if s.OriginHost != "" {
		// A bare authority only: anything carrying a scheme or a path would
		// silently produce a Host header the backend never matches, which
		// surfaces later as an opaque 403 instead of a config error here.
		if strings.Contains(s.OriginHost, "/") || strings.Contains(s.OriginHost, " ") {
			return fmt.Errorf("originHost must be a bare host[:port] authority, not a URL: %s", s.OriginHost)
		}
	}
	if s.LaunchTokenFile != "" && !filepath.IsAbs(s.LaunchTokenFile) {
		return fmt.Errorf("launchTokenFile must be an absolute path: %s", s.LaunchTokenFile)
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
