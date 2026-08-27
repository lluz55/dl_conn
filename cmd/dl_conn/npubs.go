package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"dl_conn/internal/config"
	"dl_conn/internal/nostr"
	"github.com/spf13/cobra"
)

type npubsAddOptions struct {
	jsonOutput bool
	noReload   bool
	pid        int
	configPath string
}

type npubsAddResult struct {
	Npub      string `json:"npub"`
	HexPub    string `json:"hex_pub,omitempty"`
	Status    string `json:"status"`
	TotalList int    `json:"total_authorized_npubs"`
}

func newNpubsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "npubs",
		Short: "Manage the authorized npub allowlist",
	}

	cmd.AddCommand(newNpubsAddCmd())
	return cmd
}

func newNpubsAddCmd() *cobra.Command {
	var opts npubsAddOptions

	cmd := &cobra.Command{
		Use:   "add <npub>",
		Short: "Add a new npub to the authorized allowlist",
		Long: `Add a Nostr public key (npub) to the authorized allowlist in config.yaml.

The command edits the YAML file in-place preserving comments, validates the
result, and writes atomically (temp → fsync → rename).  By default it also
sends SIGHUP to the running dl_conn daemon to reload the list without restart.

Exit codes:
  0  success (added or already present)
  1  error (invalid npub, write failure, config invalid)
`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if opts.configPath == "" {
				opts.configPath = configPath // inherited from root
			}
			return runNpubsAdd(args[0], opts, cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}

	cmd.Flags().BoolVar(&opts.jsonOutput, "json", false, "output result as JSON")
	cmd.Flags().BoolVar(&opts.noReload, "no-reload", false, "skip sending SIGHUP to the daemon")
	cmd.Flags().IntVar(&opts.pid, "pid", 0, "PID of the daemon to signal (default: systemd unit, else the running dl_conn process)")
	cmd.Flags().StringVar(&opts.configPath, "config", "", "path to config file (default: --config from root)")

	return cmd
}

func runNpubsAdd(npub string, opts npubsAddOptions, w io.Writer, ew io.Writer) error {
	// Decode to get hex for the result, normalising the npub in the process.
	hexPub, err := nostr.DecodeNpub(npub)
	if err != nil {
		return fmt.Errorf("invalid npub %q: %w", npub, err)
	}

	added, err := config.AddAuthorizedNpub(opts.configPath, npub)
	if err != nil {
		// Surface read-only / permission errors with the NixOS hint.
		if os.IsPermission(err) {
			return fmt.Errorf("%w\n\nHint: under NixOS the default config lives in /nix/store (read-only).\nSet services.dl-conn.configFile to a path under /var/lib/dl-conn\n(the StateDirectory already has ReadWritePaths configured).", err)
		}
		return err
	}

	// Count entries in the file to report the new total.
	cfg, loadErr := config.Load(opts.configPath)
	total := 0
	if loadErr == nil {
		total = len(cfg.Nostr.AuthorizedNpubs)
	}

	status := "already present"
	if added {
		status = "added"
	}

	if opts.jsonOutput {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(npubsAddResult{
			Npub:      npub,
			HexPub:    hexPub,
			Status:    status,
			TotalList: total,
		})
	}

	fmt.Fprintf(w, "%s: %s (total authorized: %d)\n", status, npub, total)

	// Send SIGHUP to the daemon to hot-reload the allowlist.
	if added && !opts.noReload {
		pid, reloadErr := reloadDaemon(opts.pid)
		if reloadErr != nil {
			fmt.Fprintf(ew, "Warning: could not reload the daemon: %v\n", reloadErr)
			fmt.Fprintf(ew, "The npub is saved; it takes effect on the daemon's next start.\n")
			fmt.Fprintf(ew, "To apply it now: \"systemctl reload dl-conn\" (as a service), or send SIGHUP to the daemon yourself.\n")
		} else {
			fmt.Fprintf(w, "Sent SIGHUP to dl_conn daemon (PID %d) — allowlist reloaded.\n", pid)
		}
	}

	return nil
}

// reloadDaemon signals the running daemon to re-read its allowlist. It looks
// for the daemon in the two places it can plausibly be: the systemd unit
// (how it runs in production, see nixos/module.nix), and a plain process
// started by hand — "nix run .#" during development, which systemd knows
// nothing about. The old version only asked systemd and told the user to run
// "systemctl reload dl-conn" even when the daemon they were actually running
// sat in a terminal next to them.
func reloadDaemon(pidOverride int) (int, error) {
	if pidOverride > 0 {
		return pidOverride, signalPID(pidOverride)
	}

	if pid, err := systemdMainPID(); err == nil {
		return pid, signalPID(pid)
	}

	pids, err := findDaemonProcesses()
	if err != nil {
		return 0, err
	}
	switch len(pids) {
	case 0:
		return 0, errors.New("no running daemon found (not started by systemd, no dl_conn process owned by this user)")
	case 1:
		return pids[0], signalPID(pids[0])
	default:
		return 0, fmt.Errorf("found %d dl_conn processes (%v) — pass --pid to pick one", len(pids), pids)
	}
}

// systemdMainPID asks systemd for the daemon's PID, and fails if the unit
// doesn't exist or isn't running.
func systemdMainPID() (int, error) {
	out, err := exec.Command("systemctl", "show", "-p", "MainPID", "dl-conn").Output()
	if err != nil {
		return 0, fmt.Errorf("systemctl not available or service not found: %w", err)
	}
	pidStr := strings.TrimPrefix(strings.TrimSpace(string(out)), "MainPID=")
	pid, err := strconv.Atoi(pidStr)
	if err != nil || pid <= 0 {
		return 0, fmt.Errorf("service not running (MainPID=%s)", pidStr)
	}
	return pid, nil
}

// findDaemonProcesses scans /proc for daemon processes owned by this user.
// Readlink on /proc/<pid>/exe only succeeds for processes we own, which is
// the ownership check: we never look at, let alone signal, another user's
// process. Other invocations of this same binary (npubs, keygen) share the
// executable, so they're filtered out by their subcommand — signalling one
// of those would kill a CLI that doesn't handle SIGHUP.
func findDaemonProcesses() ([]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, fmt.Errorf("reading /proc: %w", err)
	}
	self := os.Getpid()
	var pids []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == self {
			continue
		}
		exe, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
		if err != nil {
			continue // not ours, or already gone
		}
		// The Nix wrapper renames the real binary, so accept both names.
		if base := filepath.Base(exe); base != "dl_conn" && base != ".dl_conn-wrapped" {
			continue
		}
		if isCLIInvocation(pid) {
			continue
		}
		pids = append(pids, pid)
	}
	return pids, nil
}

// isCLIInvocation reports whether a dl_conn process is one of the one-shot
// subcommands rather than the daemon.
func isCLIInvocation(pid int) bool {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return true // can't tell — don't signal it
	}
	for _, arg := range strings.Split(string(raw), "\x00") {
		switch arg {
		case "npubs", "keygen":
			return true
		}
	}
	return false
}

// signalPID sends SIGHUP to pid after checking it's alive.
func signalPID(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("finding process %d: %w", pid, err)
	}
	// On Linux, FindProcess always succeeds; verify via kill -0.
	if err := proc.Signal(syscall.Signal(0)); err != nil {
		return fmt.Errorf("process %d not alive: %w", pid, err)
	}
	if err := proc.Signal(syscall.SIGHUP); err != nil {
		return fmt.Errorf("sending SIGHUP to PID %d: %w", pid, err)
	}
	return nil
}
func init() {
	rootCmd.AddCommand(newNpubsCmd())
}
