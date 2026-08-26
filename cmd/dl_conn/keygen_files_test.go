package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dl_conn/internal/nostr"

	"gopkg.in/yaml.v3"
)

func TestRunKeygenFiles_Default(t *testing.T) {
	dir := t.TempDir()
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		dir:      dir,
		format:   "yaml",
	}

	err := runKeygenFiles(opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runKeygenFiles returned error: %v", err)
	}

	npubPath := filepath.Join(dir, "npub.yaml")
	nsecPath := filepath.Join(dir, "nsec.yaml")

	assertKeyFile(t, npubPath, "npub", "yaml")
	assertKeyFile(t, nsecPath, "nsec", "yaml")

	out := buf.String()
	if !strings.Contains(out, "npub:") {
		t.Errorf("expected 'npub:' in stdout, got: %s", out)
	}
	if !strings.Contains(out, "nsec:") {
		t.Errorf("expected 'nsec:' in stdout, got: %s", out)
	}
}

func TestRunKeygenFiles_JSON(t *testing.T) {
	dir := t.TempDir()
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		dir:    dir,
		format: "json",
	}

	err := runKeygenFiles(opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runKeygenFiles returned error: %v", err)
	}

	npubPath := filepath.Join(dir, "npub.json")
	nsecPath := filepath.Join(dir, "nsec.json")

	assertKeyFile(t, npubPath, "npub", "json")
	assertKeyFile(t, nsecPath, "nsec", "json")
}

func TestRunKeygenFiles_ExplicitPaths(t *testing.T) {
	dir := t.TempDir()
	npubPath := filepath.Join(dir, "my-npub.txt")
	nsecPath := filepath.Join(dir, "my-nsec.txt")
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		npubFile: npubPath,
		nsecFile: nsecPath,
		format:   "json",
	}

	err := runKeygenFiles(opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runKeygenFiles returned error: %v", err)
	}

	assertKeyFile(t, npubPath, "npub", "json")
	assertKeyFile(t, nsecPath, "nsec", "json")
}

func TestRunKeygenFiles_FromKey(t *testing.T) {
	kp, err := nostr.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		fromKey: kp.Nsec,
		dir:     dir,
		format:  "yaml",
	}

	err = runKeygenFiles(opts, &buf, &errBuf)
	if err != nil {
		t.Fatalf("runKeygenFiles returned error: %v", err)
	}

	npubPath := filepath.Join(dir, "npub.yaml")
	nsecPath := filepath.Join(dir, "nsec.yaml")

	npubContent, err := os.ReadFile(npubPath)
	if err != nil {
		t.Fatalf("reading npub file: %v", err)
	}
	var npubEntry keygenFileEntry
	if err := yaml.Unmarshal(npubContent, &npubEntry); err != nil {
		t.Fatalf("unmarshalling npub file: %v", err)
	}
	if npubEntry.Value != kp.Npub {
		t.Errorf("npub mismatch: got %s, want %s", npubEntry.Value, kp.Npub)
	}

	nsecContent, err := os.ReadFile(nsecPath)
	if err != nil {
		t.Fatalf("reading nsec file: %v", err)
	}
	var nsecEntry keygenFileEntry
	if err := yaml.Unmarshal(nsecContent, &nsecEntry); err != nil {
		t.Fatalf("unmarshalling nsec file: %v", err)
	}
	if nsecEntry.Value != kp.Nsec {
		t.Errorf("nsec mismatch: got %s, want %s", nsecEntry.Value, kp.Nsec)
	}
}

func TestRunKeygenFiles_InvalidFormat(t *testing.T) {
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		dir:    t.TempDir(),
		format: "xml",
	}

	err := runKeygenFiles(opts, &buf, &errBuf)
	if err == nil {
		t.Fatal("expected error for invalid format, got nil")
	}
	if !strings.Contains(err.Error(), "invalid format") {
		t.Errorf("expected 'invalid format' error, got: %v", err)
	}
}

func TestRunKeygenFiles_NsecFilePermissions(t *testing.T) {
	dir := t.TempDir()
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		dir:    dir,
		format: "yaml",
	}

	if err := runKeygenFiles(opts, &buf, &errBuf); err != nil {
		t.Fatalf("runKeygenFiles returned error: %v", err)
	}

	nsecPath := filepath.Join(dir, "nsec.yaml")
	info, err := os.Stat(nsecPath)
	if err != nil {
		t.Fatalf("stat nsec file: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("nsec file perms = %o, want 0600", info.Mode().Perm())
	}

	npubPath := filepath.Join(dir, "npub.yaml")
	info, err = os.Stat(npubPath)
	if err != nil {
		t.Fatalf("stat npub file: %v", err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Errorf("npub file perms = %o, want 0644", info.Mode().Perm())
	}
}

func TestRunKeygenFiles_TimestampAndType(t *testing.T) {
	dir := t.TempDir()
	var buf, errBuf bytes.Buffer
	opts := keygenFilesOptions{
		dir:    dir,
		format: "yaml",
	}

	if err := runKeygenFiles(opts, &buf, &errBuf); err != nil {
		t.Fatalf("runKeygenFiles returned error: %v", err)
	}

	npubEntry := readKeyFileEntry(t, filepath.Join(dir, "npub.yaml"), "yaml")
	if npubEntry.Type != "npub" {
		t.Errorf("npub file type = %q, want %q", npubEntry.Type, "npub")
	}
	if npubEntry.Timestamp == "" {
		t.Error("expected non-empty timestamp in npub file")
	}

	nsecEntry := readKeyFileEntry(t, filepath.Join(dir, "nsec.yaml"), "yaml")
	if nsecEntry.Type != "nsec" {
		t.Errorf("nsec file type = %q, want %q", nsecEntry.Type, "nsec")
	}
	if nsecEntry.Timestamp == "" {
		t.Error("expected non-empty timestamp in nsec file")
	}
}

func TestRunKeygenFiles_CmdStructure(t *testing.T) {
	cmd := newKeygenFilesCmd()
	if cmd.Use != "files" {
		t.Errorf("expected Use 'files', got %q", cmd.Use)
	}
	flags := cmd.Flags()
	if flags.Lookup("from-key") == nil {
		t.Error("expected --from-key flag")
	}
		if flags.Lookup("format") == nil {
		t.Error("expected --format flag")
	}
	if flags.Lookup("dir") == nil {
		t.Error("expected --dir flag")
	}
	if flags.Lookup("npub-file") == nil {
		t.Error("expected --npub-file flag")
	}
	if flags.Lookup("nsec-file") == nil {
		t.Error("expected --nsec-file flag")
	}
}

func TestRunKeygenFiles_CmdExecution(t *testing.T) {
	dir := t.TempDir()
	cmd := newKeygenFilesCmd()
	cmd.SetArgs([]string{"--dir", dir, "--format", "json"})
	var buf bytes.Buffer
	cmd.SetOut(&buf)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("cmd.Execute() failed: %v", err)
	}

	npubPath := filepath.Join(dir, "npub.json")
	nsecPath := filepath.Join(dir, "nsec.json")
	if _, err := os.Stat(npubPath); os.IsNotExist(err) {
		t.Errorf("expected npub file at %s", npubPath)
	}
	if _, err := os.Stat(nsecPath); os.IsNotExist(err) {
		t.Errorf("expected nsec file at %s", nsecPath)
	}
}

func TestRunKeygenFiles_RegisteredUnderKeygen(t *testing.T) {
	parent := newKeygenCmd()
	subs := parent.Commands()
	found := false
	for _, sub := range subs {
		if sub.Name() == "files" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'files' subcommand registered under keygen")
	}
}

// --- helpers ---

func assertKeyFile(t *testing.T, path, expectedType, format string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading key file %s: %v", path, err)
	}

	var entry keygenFileEntry
	switch format {
	case "json":
		if err := json.Unmarshal(data, &entry); err != nil {
			t.Fatalf("unmarshalling JSON key file %s: %v", path, err)
		}
	case "yaml":
		if err := yaml.Unmarshal(data, &entry); err != nil {
			t.Fatalf("unmarshalling YAML key file %s: %v", path, err)
		}
	}

	if entry.Type != expectedType {
		t.Errorf("type = %q, want %q", entry.Type, expectedType)
	}
	if entry.Value == "" {
		t.Error("expected non-empty value")
	}
	if entry.Timestamp == "" {
		t.Error("expected non-empty timestamp")
	}
}

func readKeyFileEntry(t *testing.T, path, format string) keygenFileEntry {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading key file %s: %v", path, err)
	}
	var entry keygenFileEntry
	switch format {
	case "json":
		if err := json.Unmarshal(data, &entry); err != nil {
			t.Fatalf("unmarshalling JSON: %v", err)
		}
	case "yaml":
		if err := yaml.Unmarshal(data, &entry); err != nil {
			t.Fatalf("unmarshalling YAML: %v", err)
		}
	}
	return entry
}
