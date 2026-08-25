package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"dl_conn/internal/nostr"

	"github.com/nbd-wtf/go-nostr/nip19"
)

func TestRunKeygen_Default(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{}

	err := runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "Nostr Keypair:") {
		t.Errorf("expected output to contain 'Nostr Keypair:', got: %s", out)
	}
	if !strings.Contains(out, "Private Key (nsec): nsec1") {
		t.Errorf("expected output to contain nsec1, got: %s", out)
	}
	if !strings.Contains(out, "Public Key (npub):  npub1") {
		t.Errorf("expected output to contain npub1, got: %s", out)
	}
}

func TestRunKeygen_JSON(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{jsonOutput: true}

	err := runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	var kp nostr.KeyPair
	if err := json.Unmarshal(buf.Bytes(), &kp); err != nil {
		t.Fatalf("invalid json output: %v, raw: %s", err, buf.String())
	}

	if !strings.HasPrefix(kp.Nsec, "nsec1") {
		t.Errorf("expected nsec1 prefix, got %s", kp.Nsec)
	}
	if !strings.HasPrefix(kp.Npub, "npub1") {
		t.Errorf("expected npub1 prefix, got %s", kp.Npub)
	}
	if len(kp.PrivateKeyHex) != 64 {
		t.Errorf("expected 64-char private key hex, got %d", len(kp.PrivateKeyHex))
	}
	if len(kp.PublicKeyHex) != 64 {
		t.Errorf("expected 64-char public key hex, got %d", len(kp.PublicKeyHex))
	}
}

func TestRunKeygen_NsecOnly(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{nsecOnly: true}

	err := runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	out := strings.TrimSpace(buf.String())
	if !strings.HasPrefix(out, "nsec1") {
		t.Errorf("expected nsec1 prefix, got: %s", out)
	}
	if strings.Contains(out, "\n") {
		t.Errorf("expected single line output, got: %s", out)
	}
}

func TestRunKeygen_NpubOnly(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{npubOnly: true}

	err := runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	out := strings.TrimSpace(buf.String())
	if !strings.HasPrefix(out, "npub1") {
		t.Errorf("expected npub1 prefix, got: %s", out)
	}
	if strings.Contains(out, "\n") {
		t.Errorf("expected single line output, got: %s", out)
	}
}

func TestRunKeygen_PubHexOnly(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{pubHexOnly: true}

	err := runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	out := strings.TrimSpace(buf.String())
	if len(out) != 64 {
		t.Errorf("expected 64-char hex, got %d chars: %s", len(out), out)
	}
}

func TestRunKeygen_SecHexOnly(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{secHexOnly: true}

	err := runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	out := strings.TrimSpace(buf.String())
	if len(out) != 64 {
		t.Errorf("expected 64-char hex, got %d chars: %s", len(out), out)
	}
}

func TestRunKeygen_FromKey_Nsec(t *testing.T) {
	kpGenerated, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	opts := keygenOptions{
		fromKey:    kpGenerated.Nsec,
		jsonOutput: true,
	}

	err = runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	var kpDerived nostr.KeyPair
	if err := json.Unmarshal(buf.Bytes(), &kpDerived); err != nil {
		t.Fatalf("invalid json: %v", err)
	}

	if kpDerived.Nsec != kpGenerated.Nsec {
		t.Errorf("nsec mismatch: got %s, want %s", kpDerived.Nsec, kpGenerated.Nsec)
	}
	if kpDerived.Npub != kpGenerated.Npub {
		t.Errorf("npub mismatch: got %s, want %s", kpDerived.Npub, kpGenerated.Npub)
	}
	if kpDerived.PrivateKeyHex != kpGenerated.PrivateKeyHex {
		t.Errorf("private key hex mismatch: got %s, want %s", kpDerived.PrivateKeyHex, kpGenerated.PrivateKeyHex)
	}
	if kpDerived.PublicKeyHex != kpGenerated.PublicKeyHex {
		t.Errorf("public key hex mismatch: got %s, want %s", kpDerived.PublicKeyHex, kpGenerated.PublicKeyHex)
	}
}

func TestRunKeygen_FromKey_Hex(t *testing.T) {
	kpGenerated, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	opts := keygenOptions{
		fromKey:    kpGenerated.PrivateKeyHex,
		jsonOutput: true,
	}

	err = runKeygen(opts, &buf, &buf)
	if err != nil {
		t.Fatalf("runKeygen returned error: %v", err)
	}

	var kpDerived nostr.KeyPair
	if err := json.Unmarshal(buf.Bytes(), &kpDerived); err != nil {
		t.Fatalf("invalid json: %v", err)
	}

	if kpDerived.Nsec != kpGenerated.Nsec {
		t.Errorf("nsec mismatch: got %s, want %s", kpDerived.Nsec, kpGenerated.Nsec)
	}
	if kpDerived.Npub != kpGenerated.Npub {
		t.Errorf("npub mismatch: got %s, want %s", kpDerived.Npub, kpGenerated.Npub)
	}
}

func TestRunKeygen_FromKey_Invalid(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{
		fromKey: "invalid_key",
	}

	err := runKeygen(opts, &buf, &buf)
	if err == nil {
		t.Error("expected error for invalid key, got nil")
	}
}

func TestKeygenCmd_Execution(t *testing.T) {
	cmd := newKeygenCmd()
	var buf bytes.Buffer
	cmd.SetOut(&buf)
	cmd.SetErr(&buf)
	cmd.SetArgs([]string{"--json"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("cmd.Execute() failed: %v", err)
	}

	var kp nostr.KeyPair
	if err := json.Unmarshal(buf.Bytes(), &kp); err != nil {
		t.Fatalf("expected valid JSON from cmd execution: %v", err)
	}

	// Verify nsec can be decoded
	_, _, err := nip19.Decode(kp.Nsec)
	if err != nil {
		t.Errorf("invalid nsec generated: %v", err)
	}
}

func TestRunKeygen_QR(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{qr: true}

	if err := runKeygen(opts, &buf, &buf); err != nil {
		t.Fatalf("runKeygen --qr returned error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "private key") {
		t.Errorf("expected safety warning in output, got: %s", out)
	}
	hasBlock := strings.Contains(out, "\u2584") ||
		strings.Contains(out, "\u2580") ||
		strings.Contains(out, "\u2588")
	if !hasBlock {
		t.Errorf("expected QR block glyphs in output, got: %q", out)
	}
	if !strings.Contains(out, "Private Key (nsec): nsec1") {
		t.Errorf("expected written nsec1 in output, got: %s", out)
	}
	if !strings.Contains(out, "Public Key (npub):  npub1") {
		t.Errorf("expected written npub1 in output, got: %s", out)
	}
}

func TestRunKeygen_QR_Npub(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{qr: true, npubOnly: true}

	if err := runKeygen(opts, &buf, &buf); err != nil {
		t.Fatalf("runKeygen --qr --npub returned error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "QR code for your npub (public key):") {
		t.Errorf("expected public key label in output, got: %s", out)
	}
	if !strings.Contains(out, "Private Key (nsec): nsec1") {
		t.Errorf("expected written nsec1 in output, got: %s", out)
	}
	if !strings.Contains(out, "Public Key (npub):  npub1") {
		t.Errorf("expected written npub1 in output, got: %s", out)
	}
}

func TestRunKeygen_QR_Nsec(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{qr: true, nsecOnly: true}

	if err := runKeygen(opts, &buf, &buf); err != nil {
		t.Fatalf("runKeygen --qr --nsec returned error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "QR code for your nsec") {
		t.Errorf("expected nsec QR label in output, got: %s", out)
	}
	if !strings.Contains(out, "Private Key (nsec): nsec1") {
		t.Errorf("expected written nsec1 in output, got: %s", out)
	}
	if !strings.Contains(out, "Public Key (npub):  npub1") {
		t.Errorf("expected written npub1 in output, got: %s", out)
	}
}

func TestRunKeygen_QRJSONConflict(t *testing.T) {
	var buf bytes.Buffer
	opts := keygenOptions{qr: true, jsonOutput: true}

	if err := runKeygen(opts, &buf, &buf); err == nil {
		t.Error("expected error when combining --qr with --json, got nil")
	}
}

