package nostr

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
)

// Client manages connections to multiple Nostr relays.
type Client struct {
	sk          string // hex private key
	pool        *nostr.SimplePool
	relays      []string
	authorized  map[string]bool
	fallbackNip04 bool
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

	return &Client{
		sk:            sk,
		pool:          nostr.NewSimplePool(context.Background()),
		relays:        relays,
		authorized:    authorized,
		fallbackNip04: fallbackNip04,
	}, nil
}

// IsAuthorized checks if the given pubkey hex is in the whitelist.
func (c *Client) IsAuthorized(pubHex string) bool {
	return c.authorized[pubHex]
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

// subscribeRelays subscribes on each relay individually.
func (c *Client) subscribeRelays(ctx context.Context, out chan<- *nostr.Event) {
	pub, _ := nostr.GetPublicKey(c.sk)
	var wg sync.WaitGroup

	for _, relayURL := range c.relays {
		wg.Add(1)
		go func(url string) {
			defer wg.Done()
			relay, err := c.pool.EnsureRelay(url)
			if err != nil {
				return
			}
			sub, err := relay.Subscribe(ctx, []nostr.Filter{
				{
					Kinds:   []int{4, 1059},
					Tags:    nostr.TagMap{"p": []string{pub}},
				},
			})
			if err != nil {
				return
			}
			defer sub.Unsub()
			for {
				select {
				case evt := <-sub.Events:
					if evt != nil {
						select {
						case out <- evt:
						case <-ctx.Done():
							return
						}
					}
				case <-sub.Context.Done():
					return
				case <-ctx.Done():
					return
				}
			}
		}(relayURL)
	}
	wg.Wait()
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
