package nostr

import (
	"testing"

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

