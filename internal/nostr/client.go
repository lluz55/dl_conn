package nostr

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
)

const (
	// maxEventAge bounds how old an incoming DM may be before it is treated as
	// a replay rather than a live request.
	maxEventAge = 5 * time.Minute
	// maxEventClockSkew allows for a sender whose clock runs slightly ahead.
	maxEventClockSkew = 1 * time.Minute
	// minResubscribeDelay / maxResubscribeDelay bound the backoff used when a
	// relay subscription drops and has to be re-established.
	minResubscribeDelay = 1 * time.Second
	maxResubscribeDelay = 30 * time.Second
)

// Client manages connections to multiple Nostr relays.
type Client struct {
	sk            string // hex private key
	pool          *nostr.SimplePool
	relays        []string
	authorized    map[string]bool
	authMu        sync.RWMutex // guards authorized reads/writes
	fallbackNip04 bool

	statsMu sync.Mutex
	stats   map[string]*RelayStats
}

// RelayStats records what a single relay subscription has been doing, so a
// daemon that went silently deaf (subscription dropped and never truly
// re-established) can be told apart from one that is connected but simply
// isn't being sent anything.
type RelayStats struct {
	URL             string `json:"url"`
	Subscribed      bool   `json:"subscribed"`
	SubscribeCount  int    `json:"subscribe_count"`
	FailureCount    int    `json:"failure_count"`
	EventCount      int    `json:"event_count"`
	LastError       string `json:"last_error,omitempty"`
	SubscribedSince string `json:"subscribed_since,omitempty"`
	LastEventAt     string `json:"last_event_at,omitempty"`
}

// NewClient creates a new Nostr client.
func NewClient(sk string, relays []string, authorizedNpubs []string, fallbackNip04 bool) (*Client, error) {
	pub, err := nostr.GetPublicKey(sk)
	if err != nil {
		return nil, fmt.Errorf("deriving public key: %w", err)
	}

	authorized := make(map[string]bool)
	for _, n := range authorizedNpubs {
		hexPub, err := DecodeNpub(n)
		if err != nil {
			return nil, fmt.Errorf("decoding authorized npub %q: %w", n, err)
		}
		authorized[hexPub] = true
	}

	if !authorized[pub] {
		authorized[pub] = true
	}

	stats := make(map[string]*RelayStats, len(relays))
	for _, url := range relays {
		stats[url] = &RelayStats{URL: url}
	}

	return &Client{
		sk:            sk,
		pool:          nostr.NewSimplePool(context.Background()),
		relays:        relays,
		authorized:    authorized,
		fallbackNip04: fallbackNip04,
		stats:         stats,
	}, nil
}

// RelayStats returns a snapshot of every relay's subscription state, in the
// configured order.
func (c *Client) RelayStats() []RelayStats {
	c.statsMu.Lock()
	defer c.statsMu.Unlock()
	out := make([]RelayStats, 0, len(c.relays))
	for _, url := range c.relays {
		if s, ok := c.stats[url]; ok {
			out = append(out, *s)
		}
	}
	return out
}

func (c *Client) withStats(url string, fn func(*RelayStats)) {
	c.statsMu.Lock()
	defer c.statsMu.Unlock()
	s, ok := c.stats[url]
	if !ok {
		s = &RelayStats{URL: url}
		c.stats[url] = s
	}
	fn(s)
}

// IsAuthorized checks if the given pubkey hex is in the whitelist.
func (c *Client) IsAuthorized(pubHex string) bool {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.authorized[pubHex]
}

// SetAuthorized replaces the authorized npub list with a new set decoded
// from the given bech32 npubs.  It always re-inserts the host's own
// public key so the daemon never locks itself out.
func (c *Client) SetAuthorized(npubs []string) error {
	c.authMu.Lock()
	defer c.authMu.Unlock()

	newAuth := make(map[string]bool)
	for _, n := range npubs {
		hexPub, err := DecodeNpub(n)
		if err != nil {
			return fmt.Errorf("decoding authorized npub %q: %w", n, err)
		}
		newAuth[hexPub] = true
	}

	// Always keep the host's own pubkey authorized.
	pub, _ := nostr.GetPublicKey(c.sk)
	newAuth[pub] = true

	c.authorized = newAuth
	return nil
}

// AuthorizedCount returns the number of currently authorized public keys.
func (c *Client) AuthorizedCount() int {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return len(c.authorized)
}

// Subscribe listens for encrypted DMs (kind 4 and kind 1059) directed to
// the host's pubkey. Events are delivered via the returned channel.
func (c *Client) Subscribe(ctx context.Context) <-chan *nostr.Event {
	ch := make(chan *nostr.Event, 16)

	go func() {
		defer close(ch)
		c.subscribeRelays(ctx, ch)
	}()

	return ch
}

// subscribeRelays keeps one subscription alive per relay. A relay connection
// that drops (idle timeout, restart, flaky network) used to end that relay's
// goroutine for good: once every relay had dropped, the daemon stayed up but
// deaf, so a later discovery request — e.g. the dashboard's refresh button —
// was published successfully and simply never answered. Each relay therefore
// reconnects with backoff until ctx is cancelled.
func (c *Client) subscribeRelays(ctx context.Context, out chan<- *nostr.Event) {
	pub, _ := nostr.GetPublicKey(c.sk)
	var wg sync.WaitGroup

	for _, relayURL := range c.relays {
		wg.Add(1)
		go func(url string) {
			defer wg.Done()
			backoff := minResubscribeDelay
			for ctx.Err() == nil {
				if c.subscribeOnce(ctx, url, pub, out) {
					// A subscription that actually ran resets the backoff:
					// the next drop is a fresh incident, not an escalation.
					backoff = minResubscribeDelay
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}
				if backoff < maxResubscribeDelay {
					backoff *= 2
				}
			}
		}(relayURL)
	}
	wg.Wait()
}

// subscribeOnce runs a single subscription to completion, returning true if it
// was established at all (as opposed to failing to connect or subscribe).
func (c *Client) subscribeOnce(ctx context.Context, url, pub string, out chan<- *nostr.Event) bool {
	relay, err := c.pool.EnsureRelay(url)
	if err != nil {
		c.withStats(url, func(s *RelayStats) {
			s.Subscribed = false
			s.FailureCount++
			s.LastError = "ensure relay: " + err.Error()
		})
		log.Printf("nostr: relay %s unreachable: %v", url, err)
		return false
	}
	sub, err := relay.Subscribe(ctx, []nostr.Filter{
		{
			Kinds: []int{4, 1059},
			Tags:  nostr.TagMap{"p": []string{pub}},
		},
	})
	if err != nil {
		c.withStats(url, func(s *RelayStats) {
			s.Subscribed = false
			s.FailureCount++
			s.LastError = "subscribe: " + err.Error()
		})
		log.Printf("nostr: subscribe to %s failed: %v", url, err)
		return false
	}
	c.withStats(url, func(s *RelayStats) {
		s.Subscribed = true
		s.SubscribeCount++
		s.LastError = ""
		s.SubscribedSince = time.Now().Format(time.RFC3339)
	})
	log.Printf("nostr: subscribed to %s", url)
	defer func() {
		sub.Unsub()
		c.withStats(url, func(s *RelayStats) { s.Subscribed = false })
		log.Printf("nostr: subscription to %s ended", url)
	}()
	for {
		select {
		case evt, ok := <-sub.Events:
			if !ok {
				return true
			}
			if evt != nil {
				c.withStats(url, func(s *RelayStats) {
					s.EventCount++
					s.LastEventAt = time.Now().Format(time.RFC3339)
				})
				select {
				case out <- evt:
				case <-ctx.Done():
					return true
				}
			}
		case <-sub.Context.Done():
			return true
		case <-ctx.Done():
			return true
		}
	}
}

// PublishResponse encrypts and publishes the response payload to all relays.
func (c *Client) PublishResponse(ctx context.Context, recipientPubHex string, plaintext string) error {
	encrypted, err := EncryptMessage(plaintext, recipientPubHex, c.sk)
	if err != nil {
		return fmt.Errorf("encrypting response: %w", err)
	}

	evt := nostr.Event{
		PubKey:  c.hostPubHex(),
		Kind:    4, // NIP-04 DM, encrypted
		Content: encrypted,
		Tags: nostr.Tags{
			{"p", recipientPubHex},
		},
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
	}

	if err := evt.Sign(c.sk); err != nil {
		return fmt.Errorf("signing event: %w", err)
	}

	results := c.pool.PublishMany(ctx, c.relays, evt)
	errors := 0
	success := 0
	for res := range results {
		if res.Error != nil {
			errors++
		} else {
			success++
		}
	}

	if success == 0 {
		return fmt.Errorf("failed to publish to any relay (%d errors)", errors)
	}
	return nil
}

// hostPubHex returns the host's public key in hex.
func (c *Client) hostPubHex() string {
	pub, _ := nostr.GetPublicKey(c.sk)
	return pub
}

// ParseEvent extracts the plaintext from a received DM event.
func (c *Client) ParseEvent(evt *nostr.Event) (string, string, error) {
	senderPub := evt.PubKey
	if !c.IsAuthorized(senderPub) {
		return "", "", fmt.Errorf("unauthorized sender: %s", senderPub)
	}

	// Relays are untrusted: the PubKey field is just a claim until the
	// signature over it is checked. NIP-44 decryption would also fail for a
	// forged event, but that is an accident of the crypto rather than an
	// authentication step — verify explicitly so the guarantee is stated.
	ok, err := evt.CheckSignature()
	if err != nil {
		return "", "", fmt.Errorf("checking signature: %w", err)
	}
	if !ok {
		return "", "", fmt.Errorf("invalid signature for pubkey %s", senderPub)
	}

	// Reject stale events so a relay cannot replay an old authorized DM to
	// force issuance of a fresh token.
	age := time.Since(evt.CreatedAt.Time())
	if age > maxEventAge || age < -maxEventClockSkew {
		return "", "", fmt.Errorf("event timestamp out of range (age %s)", age)
	}

	plaintext, err := DecryptMessage(evt.Content, senderPub, c.sk)
	if err != nil {
		return "", "", fmt.Errorf("decrypting message: %w", err)
	}

	return senderPub, plaintext, nil
}

// MarshalJSON is a helper to serialize arbitrary data for encryption.
func MarshalJSON(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
