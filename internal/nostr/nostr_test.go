package nostr

import (
	"testing"
	"time"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

func TestDecodeNsec_Bech32(t *testing.T) {
	sk := nostr.GeneratePrivateKey()
	nsec, err := nip19.EncodePrivateKey(sk)
	if err != nil {
		t.Fatal(err)
	}

	decoded, err := DecodeNsec(nsec)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != sk {
		t.Errorf("got %s, want %s", decoded, sk)
	}
}

func TestDecodeNsec_Hex(t *testing.T) {
	sk := nostr.GeneratePrivateKey()
	decoded, err := DecodeNsec(sk)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != sk {
		t.Errorf("got %s, want %s", decoded, sk)
	}
}

func TestDecodeNpub_Bech32(t *testing.T) {
	sk := nostr.GeneratePrivateKey()
	pub, err := nostr.GetPublicKey(sk)
	if err != nil {
		t.Fatal(err)
	}
	npub, err := nip19.EncodePublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}

	decoded, err := DecodeNpub(npub)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != pub {
		t.Errorf("got %s, want %s", decoded, pub)
	}
}

func TestDecodeNsec_Invalid(t *testing.T) {
	_, err := DecodeNsec("nsec1invalid")
	if err == nil {
		t.Fatal("expected error for invalid nsec")
	}
}

func TestNIP44_RoundTrip(t *testing.T) {
	senderSk := nostr.GeneratePrivateKey()
	senderPk, _ := nostr.GetPublicKey(senderSk)
	recipientSk := nostr.GeneratePrivateKey()
	recipientPk, _ := nostr.GetPublicKey(recipientSk)

	plaintext := `{"action":"discover_services"}`

	encrypted, err := EncryptMessage(plaintext, recipientPk, senderSk)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	decrypted, err := DecryptMessage(encrypted, senderPk, recipientSk)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}

	if decrypted != plaintext {
		t.Errorf("round-trip mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestNIP44_DecryptionWithWrongKey(t *testing.T) {
	senderSk := nostr.GeneratePrivateKey()
	senderPk, _ := nostr.GetPublicKey(senderSk)
	recipientSk := nostr.GeneratePrivateKey()
	recipientPk, _ := nostr.GetPublicKey(recipientSk)
	otherSk := nostr.GeneratePrivateKey()

	plaintext := `{"action":"discover_services"}`

	encrypted, err := EncryptMessage(plaintext, recipientPk, senderSk)
	if err != nil {
		t.Fatal(err)
	}

	// Decrypt with wrong key should fail
	_, err = DecryptMessage(encrypted, senderPk, otherSk)
	if err == nil {
		t.Fatal("expected error decrypting with wrong key")
	}
}

func TestClient_IsAuthorized(t *testing.T) {
	sk := nostr.GeneratePrivateKey()
	pub, _ := nostr.GetPublicKey(sk)
	npub, _ := nip19.EncodePublicKey(pub)

	c, err := NewClient(sk, []string{"wss://relay.damus.io"}, []string{npub}, false)
	if err != nil {
		t.Fatal(err)
	}

	if !c.IsAuthorized(pub) {
		t.Error("host should be authorized")
	}

	// unauthorized key
	unauthorizedSk := nostr.GeneratePrivateKey()
	unauthorizedPub, _ := nostr.GetPublicKey(unauthorizedSk)
	if c.IsAuthorized(unauthorizedPub) {
		t.Error("unauthorized key should not be authorized")
	}
}

func TestProtocol_MarshalRequest(t *testing.T) {
	req := RequestMessage{Action: ActionDiscoverServices}
	data, err := MarshalRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	req2, err := UnmarshalRequest(data)
	if err != nil {
		t.Fatal(err)
	}
	if req2.Action != ActionDiscoverServices {
		t.Errorf("got %q, want %q", req2.Action, ActionDiscoverServices)
	}
}

func TestProtocol_MarshalResponse(t *testing.T) {
	resp := ResponsePayload{
		Status:          "ok",
		TunnelURL:       "https://abcd.trycloudflare.com",
		AuthToken:       "token123",
		ExpiresInSeconds: 120,
		Services:        []ServiceInfo{{ID: "hass", Name: "HA", Prefix: "/hass", Websocket: true}},
	}
	data, err := MarshalResponse(resp)
	if err != nil {
		t.Fatal(err)
	}
	resp2, err := UnmarshalResponse(data)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.TunnelURL != resp.TunnelURL {
		t.Errorf("got %q, want %q", resp2.TunnelURL, resp.TunnelURL)
	}
	if len(resp2.Services) != 1 || resp2.Services[0].ID != "hass" {
		t.Errorf("services mismatch: %v", resp2.Services)
	}
}

func TestGenerateKeyPair(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair failed: %v", err)
	}

	if len(kp.PrivateKeyHex) != 64 {
		t.Errorf("expected 64-char private key hex, got %d chars: %s", len(kp.PrivateKeyHex), kp.PrivateKeyHex)
	}
	if len(kp.PublicKeyHex) != 64 {
		t.Errorf("expected 64-char public key hex, got %d chars: %s", len(kp.PublicKeyHex), kp.PublicKeyHex)
	}
	if !nostr.IsValid32ByteHex(kp.PrivateKeyHex) {
		t.Errorf("invalid private key hex: %s", kp.PrivateKeyHex)
	}
	if !nostr.IsValid32ByteHex(kp.PublicKeyHex) {
		t.Errorf("invalid public key hex: %s", kp.PublicKeyHex)
	}
	if len(kp.Nsec) == 0 || kp.Nsec[:5] != "nsec1" {
		t.Errorf("expected nsec starting with nsec1, got: %s", kp.Nsec)
	}
	if len(kp.Npub) == 0 || kp.Npub[:5] != "npub1" {
		t.Errorf("expected npub starting with npub1, got: %s", kp.Npub)
	}

	// Verify decoding recovers the original hex
	skDecoded, err := DecodeNsec(kp.Nsec)
	if err != nil || skDecoded != kp.PrivateKeyHex {
		t.Errorf("DecodeNsec mismatch: got %s, want %s (err: %v)", skDecoded, kp.PrivateKeyHex, err)
	}

	pkDecoded, err := DecodeNpub(kp.Npub)
	if err != nil || pkDecoded != kp.PublicKeyHex {
		t.Errorf("DecodeNpub mismatch: got %s, want %s (err: %v)", pkDecoded, kp.PublicKeyHex, err)
	}
}

func TestDeriveKeyPair(t *testing.T) {
	sk := nostr.GeneratePrivateKey()
	nsec, err := nip19.EncodePrivateKey(sk)
	if err != nil {
		t.Fatal(err)
	}

	// Derive from hex
	kpHex, err := DeriveKeyPair(sk)
	if err != nil {
		t.Fatalf("DeriveKeyPair from hex failed: %v", err)
	}
	if kpHex.PrivateKeyHex != sk {
		t.Errorf("expected private key hex %s, got %s", sk, kpHex.PrivateKeyHex)
	}
	if kpHex.Nsec != nsec {
		t.Errorf("expected nsec %s, got %s", nsec, kpHex.Nsec)
	}

	// Derive from nsec
	kpNsec, err := DeriveKeyPair(nsec)
	if err != nil {
		t.Fatalf("DeriveKeyPair from nsec failed: %v", err)
	}
	if kpNsec.PrivateKeyHex != sk {
		t.Errorf("expected private key hex %s, got %s", sk, kpNsec.PrivateKeyHex)
	}
	if kpNsec.PublicKeyHex != kpHex.PublicKeyHex {
		t.Errorf("public key hex mismatch: %s vs %s", kpNsec.PublicKeyHex, kpHex.PublicKeyHex)
	}
	if kpNsec.Npub != kpHex.Npub {
		t.Errorf("npub mismatch: %s vs %s", kpNsec.Npub, kpHex.Npub)
	}

	// Invalid key
	_, err = DeriveKeyPair("invalid_key_string")
	if err == nil {
		t.Error("expected error for invalid key")
	}
}


// newTestClient builds a Client whose whitelist contains the given pubkey.
func newTestClient(t *testing.T, hostSk string, authorizedPub string) *Client {
	t.Helper()
	npub, err := nip19.EncodePublicKey(authorizedPub)
	if err != nil {
		t.Fatal(err)
	}
	c, err := NewClient(hostSk, []string{"wss://relay.example"}, []string{npub}, false)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// newSignedDM builds a NIP-44 encrypted DM from sender to host, signed.
func newSignedDM(t *testing.T, senderSk, hostPub, plaintext string) *nostr.Event {
	t.Helper()
	ciphertext, err := EncryptMessage(plaintext, hostPub, senderSk)
	if err != nil {
		t.Fatal(err)
	}
	senderPub, err := nostr.GetPublicKey(senderSk)
	if err != nil {
		t.Fatal(err)
	}
	evt := &nostr.Event{
		PubKey:    senderPub,
		Kind:      4,
		Content:   ciphertext,
		Tags:      nostr.Tags{{"p", hostPub}},
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
	}
	if err := evt.Sign(senderSk); err != nil {
		t.Fatal(err)
	}
	return evt
}

func TestParseEvent_AcceptsSignedAuthorizedDM(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()
	hostPub, _ := nostr.GetPublicKey(hostSk)
	senderSk := nostr.GeneratePrivateKey()
	senderPub, _ := nostr.GetPublicKey(senderSk)

	c := newTestClient(t, hostSk, senderPub)
	evt := newSignedDM(t, senderSk, hostPub, `{"action":"discover_services"}`)

	gotPub, plaintext, err := c.ParseEvent(evt)
	if err != nil {
		t.Fatalf("ParseEvent rejected a valid DM: %v", err)
	}
	if gotPub != senderPub {
		t.Errorf("sender = %s, want %s", gotPub, senderPub)
	}
	if plaintext != `{"action":"discover_services"}` {
		t.Errorf("plaintext = %q", plaintext)
	}
}

// A relay is untrusted, so it can hand us an event whose PubKey names an
// authorized sender while the signature does not back that claim.
func TestParseEvent_RejectsForgedSignature(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()
	hostPub, _ := nostr.GetPublicKey(hostSk)
	senderSk := nostr.GeneratePrivateKey()
	senderPub, _ := nostr.GetPublicKey(senderSk)

	c := newTestClient(t, hostSk, senderPub)
	evt := newSignedDM(t, senderSk, hostPub, `{"action":"discover_services"}`)

	// Keep the authorized PubKey, corrupt the signature.
	evt.Sig = "00" + evt.Sig[2:]

	if _, _, err := c.ParseEvent(evt); err == nil {
		t.Fatal("ParseEvent accepted an event with an invalid signature")
	}
}

func TestParseEvent_RejectsStaleEvent(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()
	hostPub, _ := nostr.GetPublicKey(hostSk)
	senderSk := nostr.GeneratePrivateKey()
	senderPub, _ := nostr.GetPublicKey(senderSk)

	c := newTestClient(t, hostSk, senderPub)

	ciphertext, err := EncryptMessage(`{"action":"discover_services"}`, hostPub, senderSk)
	if err != nil {
		t.Fatal(err)
	}
	evt := &nostr.Event{
		PubKey:    senderPub,
		Kind:      4,
		Content:   ciphertext,
		Tags:      nostr.Tags{{"p", hostPub}},
		CreatedAt: nostr.Timestamp(time.Now().Add(-1 * time.Hour).Unix()),
	}
	if err := evt.Sign(senderSk); err != nil {
		t.Fatal(err)
	}

	if _, _, err := c.ParseEvent(evt); err == nil {
		t.Fatal("ParseEvent accepted a replayed hour-old event")
	}
}

func TestParseEvent_RejectsUnauthorizedSender(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()
	hostPub, _ := nostr.GetPublicKey(hostSk)
	authorizedSk := nostr.GeneratePrivateKey()
	authorizedPub, _ := nostr.GetPublicKey(authorizedSk)
	strangerSk := nostr.GeneratePrivateKey()

	c := newTestClient(t, hostSk, authorizedPub)
	evt := newSignedDM(t, strangerSk, hostPub, `{"action":"discover_services"}`)

	if _, _, err := c.ParseEvent(evt); err == nil {
		t.Fatal("ParseEvent accepted a DM from an unauthorized sender")
	}
}

func TestSetAuthorized_ReplacesWhitelist(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()

	oldSk := nostr.GeneratePrivateKey()
	oldPub, _ := nostr.GetPublicKey(oldSk)

	newSk := nostr.GeneratePrivateKey()
	newPub, _ := nostr.GetPublicKey(newSk)
	newNpub, _ := nip19.EncodePublicKey(newPub)

	c := newTestClient(t, hostSk, oldPub)

	// Old key should be authorized.
	if !c.IsAuthorized(oldPub) {
		t.Fatal("old key should be authorized before SetAuthorized")
	}

	// Swap to new key.
	err := c.SetAuthorized([]string{newNpub})
	if err != nil {
		t.Fatalf("SetAuthorized failed: %v", err)
	}

	// New key authorized, old key removed.
	if !c.IsAuthorized(newPub) {
		t.Error("new key should be authorized after SetAuthorized")
	}
	if c.IsAuthorized(oldPub) {
		t.Error("old key should no longer be authorized after SetAuthorized")
	}
}

func TestSetAuthorized_KeepsHostKey(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()
	hostPub, _ := nostr.GetPublicKey(hostSk)

	otherSk := nostr.GeneratePrivateKey()
	otherPub, _ := nostr.GetPublicKey(otherSk)
	otherNpub, _ := nip19.EncodePublicKey(otherPub)

	c := newTestClient(t, hostSk, otherPub)

	// SetAuthorized with only the other key — host key must survive.
	err := c.SetAuthorized([]string{otherNpub})
	if err != nil {
		t.Fatalf("SetAuthorized failed: %v", err)
	}

	if !c.IsAuthorized(hostPub) {
		t.Error("host key must remain authorized after SetAuthorized")
	}
}

func TestSetAuthorized_InvalidNpub(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()
	c := newTestClient(t, hostSk, nostr.GeneratePrivateKey())

	err := c.SetAuthorized([]string{"npub1invalid"})
	if err == nil {
		t.Fatal("expected error for invalid npub in SetAuthorized")
	}
}

func TestSetAuthorized_AuthorizedCount(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()

	a1 := nostr.GeneratePrivateKey()
	p1, _ := nostr.GetPublicKey(a1)
	n1, _ := nip19.EncodePublicKey(p1)

	a2 := nostr.GeneratePrivateKey()
	p2, _ := nostr.GetPublicKey(a2)
	n2, _ := nip19.EncodePublicKey(p2)

	c := newTestClient(t, hostSk, p1)
	if c.AuthorizedCount() != 2 {
		t.Fatalf("initial count = %d, want 2", c.AuthorizedCount())
	}

	err := c.SetAuthorized([]string{n1, n2})
	if err != nil {
		t.Fatal(err)
	}
	// host + 2 npubs = 3
	if c.AuthorizedCount() != 3 {
		t.Fatalf("count after SetAuthorized = %d, want 3", c.AuthorizedCount())
	}
}

func TestSetAuthorized_ConcurrentAccess(t *testing.T) {
	hostSk := nostr.GeneratePrivateKey()

	sk2 := nostr.GeneratePrivateKey()
	pub2, _ := nostr.GetPublicKey(sk2)
	npub2, _ := nip19.EncodePublicKey(pub2)

	sk3 := nostr.GeneratePrivateKey()
	pub3, _ := nostr.GetPublicKey(sk3)
	npub3, _ := nip19.EncodePublicKey(pub3)

	c := newTestClient(t, hostSk, pub2)
	done := make(chan struct{})

	// Concurrent reader.
	go func() {
		for i := 0; i < 1000; i++ {
			c.IsAuthorized(pub2)
		}
		done <- struct{}{}
	}()

	// Concurrent writer.
	go func() {
		for i := 0; i < 100; i++ {
			_ = c.SetAuthorized([]string{npub2, npub3})
		}
		done <- struct{}{}
	}()

	<-done
	<-done

	// Final state: host + npub2 + npub3 = 3.
	if c.AuthorizedCount() != 3 {
		t.Errorf("final count = %d, want 3", c.AuthorizedCount())
	}
}

func TestHandler_ServicesWithStatus(t *testing.T) {
	h := NewHandler(nil, nil, "https://x.trycloudflare.com", []ServiceInfo{
		{ID: "hass", Name: "HA", Status: "unknown"},
		{ID: "frigate", Name: "Frigate", Status: "unknown"},
	})

	// Without a status func the configured values are advertised untouched.
	if got := h.servicesWithStatus()[0].Status; got != "unknown" {
		t.Fatalf("status without lookup = %q, want %q", got, "unknown")
	}

	h.SetStatusFunc(func(id string) string {
		if id == "hass" {
			return "up"
		}
		return "down"
	})
	out := h.servicesWithStatus()
	if out[0].Status != "up" || out[1].Status != "down" {
		t.Fatalf("stamped statuses = %q/%q, want up/down", out[0].Status, out[1].Status)
	}
	// The handler's own slice must not be mutated by a response.
	if h.services[0].Status != "unknown" {
		t.Fatalf("handler slice mutated: %q", h.services[0].Status)
	}
}

func TestResponsePayload_OmitsHostTelemetry(t *testing.T) {
	resp := NewResponse("https://x.trycloudflare.com", "tok", 120*time.Second, []ServiceInfo{
		{ID: "hass", Name: "HA", Prefix: "/hass"},
	})
	data, err := MarshalResponse(resp)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "" && (indexBytes(got, []byte("host_telemetry")) >= 0) {
		t.Errorf("response should omit host_telemetry when nil, got: %s", got)
	}
}

func TestResponsePayload_IncludesHostTelemetry(t *testing.T) {
	temp := 65.0
	cap := 80
	resp := NewResponse("https://x.trycloudflare.com", "tok", 120*time.Second, nil)
	resp.HostTelemetry = &HostTelemetry{
		SampledAt:       "2026-01-01T00:00:00Z",
		CpuTempC:        &temp,
		CpuLoad1:        0.5,
		RamUsedPct:      42.0,
		RamUsedMB:       4000,
		RamTotalMB:      10000,
		BattCapacityPct: &cap,
		BattStatus:      "Discharging",
		UptimeSec:       3600,
	}
	data, err := MarshalResponse(resp)
	if err != nil {
		t.Fatal(err)
	}
	if indexBytes(string(data), []byte(`"host_telemetry"`)) < 0 {
		t.Fatalf("host_telemetry missing from JSON: %s", data)
	}
	if indexBytes(string(data), []byte(`"cpu_temp_c":65`)) < 0 {
		t.Errorf("cpu_temp_c missing or wrong: %s", data)
	}

	// Round trip.
	got, err := UnmarshalResponse(data)
	if err != nil {
		t.Fatal(err)
	}
	if got.HostTelemetry == nil || got.HostTelemetry.CpuTempC == nil || *got.HostTelemetry.CpuTempC != 65.0 {
		t.Errorf("round-trip cpu_temp_c wrong: %+v", got.HostTelemetry)
	}
	if got.HostTelemetry.BattCapacityPct == nil || *got.HostTelemetry.BattCapacityPct != 80 {
		t.Errorf("round-trip batt capacity wrong")
	}
}

func indexBytes(s string, sub []byte) int {
	if len(sub) == 0 {
		return 0
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if s[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

