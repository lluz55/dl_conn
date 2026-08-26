package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dl_conn/internal/nostr"
)

func TestRunNpubsAdd_AddsNewNpub(t *testing.T) {
	dir := t.TempDir()
	configPath := writeTestNpubsConfig(t, dir)

	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	var buf, errBuf bytes.Buffer
	opts := npubsAddOptions{configPath: configPath, noReload: true}

	err = runNpubsAdd(kp.Npub, opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runNpubsAdd returned error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "added") {
		t.Errorf("expected 'added' in output, got: %s", out)
	}
	if !strings.Contains(out, kp.Npub) {
		t.Errorf("expected npub in output, got: %s", out)
	}
}

func TestRunNpubsAdd_DuplicateNoop(t *testing.T) {
	dir := t.TempDir()

	// Generate a real npub and write it into the config.
	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	configPath := writeTestNpubsConfigWithNpub(t, dir, kp.Npub)

	var buf, errBuf bytes.Buffer
	opts := npubsAddOptions{configPath: configPath, noReload: true}

	err = runNpubsAdd(kp.Npub, opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runNpubsAdd returned error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "already present") {
		t.Errorf("expected 'already present' in output, got: %s", out)
	}
}

func TestRunNpubsAdd_InvalidNpub(t *testing.T) {
	dir := t.TempDir()
	configPath := writeTestNpubsConfig(t, dir)

	var buf, errBuf bytes.Buffer
	opts := npubsAddOptions{configPath: configPath, noReload: true}

	err := runNpubsAdd("npub1invalid", opts, &buf, &errBuf)
	if err == nil {
		t.Fatal("expected error for invalid npub")
	}
}

func TestRunNpubsAdd_JSONOutput(t *testing.T) {
	dir := t.TempDir()
	configPath := writeTestNpubsConfig(t, dir)

	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	var buf, errBuf bytes.Buffer
	opts := npubsAddOptions{configPath: configPath, jsonOutput: true, noReload: true}

	err = runNpubsAdd(kp.Npub, opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runNpubsAdd returned error: %v", err)
	}

	var result npubsAddResult
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON output: %v, raw: %s", err, buf.String())
	}

	if result.Npub != kp.Npub {
		t.Errorf("npub = %s, want %s", result.Npub, kp.Npub)
	}
	if result.Status != "added" {
		t.Errorf("status = %s, want 'added'", result.Status)
	}
	if result.TotalList < 2 {
		t.Errorf("total = %d, want >= 2", result.TotalList)
	}
}

func TestRunNpubsAdd_JSONOutput_Duplicate(t *testing.T) {
	dir := t.TempDir()

	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	configPath := writeTestNpubsConfigWithNpub(t, dir, kp.Npub)

	var buf, errBuf bytes.Buffer
	opts := npubsAddOptions{configPath: configPath, jsonOutput: true, noReload: true}

	err = runNpubsAdd(kp.Npub, opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runNpubsAdd returned error: %v", err)
	}

	var result npubsAddResult
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if result.Status != "already present" {
		t.Errorf("status = %s, want 'already present'", result.Status)
	}
}

func TestNpubsCmd_Execution(t *testing.T) {
	cmd := newNpubsCmd()
	if cmd.Use != "npubs" {
		t.Errorf("expected 'npubs', got %q", cmd.Use)
	}
	// Should have exactly one subcommand: add.
	commands := cmd.Commands()
	if len(commands) != 1 {
		t.Fatalf("expected 1 subcommand (add), got %d", len(commands))
	}
	if commands[0].Use != "add <npub>" {
		t.Errorf("expected subcommand 'add <npub>', got %q", commands[0].Use)
	}
}

func TestNpubsAddCmd_Args(t *testing.T) {
	cmd := newNpubsAddCmd()

	// No args → error.
	cmd.SetArgs([]string{})
	err := cmd.Execute()
	if err == nil {
		t.Error("expected error with no args")
	}

	// Too many args → error.
	cmd.SetArgs([]string{"arg1", "arg2"})
	err = cmd.Execute()
	if err == nil {
		t.Error("expected error with two args")
	}
}

func writeTestNpubsConfig(t *testing.T, dir string) string {
	t.Helper()
	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	return writeTestNpubsConfigWithNpub(t, dir, kp.Npub)
}

func writeTestNpubsConfigWithNpub(t *testing.T, dir string, npub string) string {
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
