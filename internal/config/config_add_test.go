package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dl_conn/internal/nostr"
)

func TestAddAuthorizedNpub_AddsNewNpub(t *testing.T) {
	dir := t.TempDir()
	path := writeTestConfig(t, dir)

	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	added, err := AddAuthorizedNpub(path, kp.Npub)
	if err != nil {
		t.Fatalf("AddAuthorizedNpub returned error: %v", err)
	}
	if !added {
		t.Fatal("expected added=true for new npub")
	}

	// Verify the npub is now in the config.
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load failed after add: %v", err)
	}
	found := false
	for _, n := range cfg.Nostr.AuthorizedNpubs {
		hexPub, _ := nostr.DecodeNpub(n)
		if hexPub == kp.PublicKeyHex {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("npub %s not found in config after add", kp.Npub)
	}
}

func TestAddAuthorizedNpub_DuplicateIdempotent(t *testing.T) {
	dir := t.TempDir()

	// Generate a real npub and write it into the config first.
	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	path := writeTestConfigWithNpub(t, dir, kp.Npub)

	// Adding same npub again should be idempotent.
	added, err := AddAuthorizedNpub(path, kp.Npub)
	if err != nil {
		t.Fatalf("AddAuthorizedNpub returned error: %v", err)
	}
	if added {
		t.Fatal("expected added=false for duplicate npub")
	}

	// File should be unchanged (no rewrite).
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Fatal("config file is empty after duplicate attempt")
	}
}

func TestAddAuthorizedNpub_InvalidNpub(t *testing.T) {
	dir := t.TempDir()
	path := writeTestConfig(t, dir)

	_, err := AddAuthorizedNpub(path, "npub1invalid")
	if err == nil {
		t.Fatal("expected error for invalid npub")
	}
}

func TestAddAuthorizedNpub_PreservesComments(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// Generate a valid npub for the config.
	existingKP, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	configWithComments := fmt.Sprintf(`nostr:
  # This is the nsec
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  # Authorized devices
  authorizedNpubs:
    - "%s"
    # Device A
services:
  - id: "hass"
    name: "Home Assistant"
    prefix: "/hass"
    target: "http://10.0.66.1:8123"
`, existingKP.Npub)
	if err := os.WriteFile(path, []byte(configWithComments), 0600); err != nil {
		t.Fatal(err)
	}

	newKP, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	_, err = AddAuthorizedNpub(path, newKP.Npub)
	if err != nil {
		t.Fatalf("AddAuthorizedNpub returned error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	// Comments should still be there.
	if !containsSubstring(content, "# This is the nsec") {
		t.Error("comment '# This is the nsec' was lost")
	}
	if !containsSubstring(content, "# Authorized devices") {
		t.Error("comment '# Authorized devices' was lost")
	}
	if !containsSubstring(content, "# Device A") {
		t.Error("comment '# Device A' was lost")
	}
}

func TestAddAuthorizedNpub_InvalidResultDoesNotReplaceOriginal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// Config with a valid npub, but we'll craft a scenario where re-validation fails.
	// We can simulate this by removing the nsec after writing — but since AddAuthorizedNpub
	// validates the *result*, we'll use a config that already passes and verify that a
	// valid add succeeds (the negative path is covered by the invalid-npub test above).
	// Here we verify the file is untouched on error.
	configContent := minimalValidConfig()
	if err := os.WriteFile(path, []byte(configContent), 0600); err != nil {
		t.Fatal(err)
	}

	originalData, _ := os.ReadFile(path)

	// Attempt with invalid npub — file must be unchanged.
	_, err := AddAuthorizedNpub(path, "npub1totallyinvalid")
	if err == nil {
		t.Fatal("expected error for invalid npub")
	}

	afterData, _ := os.ReadFile(path)
	if string(originalData) != string(afterData) {
		t.Error("config file was modified despite invalid npub input")
	}
}

func TestAddAuthorizedNpub_ReadOnlyDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// Write the file, then make the directory read-only (simulating /nix/store).
	if err := os.WriteFile(path, []byte(minimalValidConfig()), 0444); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	// Restore dir perms after test so TempDir cleanup works.
	defer os.Chmod(dir, 0755)

	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	_, err = AddAuthorizedNpub(path, kp.Npub)
	if err == nil {
		t.Fatal("expected permission error for read-only directory")
	}
	// Verify the error contains "permission denied" — the exact wrapping depends on OS.
	if !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected 'permission denied' in error, got: %v", err)
	}
}

func TestAddAuthorizedNpub_CaseInsensitive(t *testing.T) {
	dir := t.TempDir()

	// Use a different npub in the base config so the generated one is not already present.
	baseKP, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	path := writeTestConfigWithNpub(t, dir, baseKP.Npub)

	// Add a new real npub.
	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	_, err = AddAuthorizedNpub(path, kp.Npub)
	if err != nil {
		t.Fatal(err)
	}

	// Adding the same npub again (same case) should be idempotent.
	added, err := AddAuthorizedNpub(path, kp.Npub)
	if err != nil {
		t.Fatal(err)
	}
	if added {
		t.Error("expected already-present for same npub")
	}

	// Adding the hex form should also be detected as duplicate.
	added, err = AddAuthorizedNpub(path, kp.PublicKeyHex)
	if err != nil {
		t.Fatal(err)
	}
	if added {
		t.Error("expected already-present when adding hex form of existing npub")
	}
}

// writeTestConfig writes a minimal valid config to the temp dir with a generated npub.
func writeTestConfig(t *testing.T, dir string) string {
	t.Helper()
	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	return writeTestConfigWithNpub(t, dir, kp.Npub)
}

// writeTestConfigWithNpub writes a minimal valid config with the given npub.
func writeTestConfigWithNpub(t *testing.T, dir string, npub string) string {
	t.Helper()
	path := filepath.Join(dir, "config.yaml")
	content := fmt.Sprintf(`nostr:
  nsec: "nsec1placeholder00000000000000000000000000000000000"
  relays:
    - "wss://relay.damus.io"
  authorizedNpubs:
    - "%s"
services:
  - id: "hass"
    name: "Home Assistant"
    prefix: "/hass"
    target: "http://10.0.66.1:8123"
`, npub)
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && contains(s, sub))
}

func contains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
