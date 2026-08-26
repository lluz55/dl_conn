package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"dl_conn/internal/config"
	"dl_conn/internal/nostr"
	"github.com/spf13/cobra"
)

type npubsAddOptions struct {
	jsonOutput bool
	noReload   bool
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
		reloadErr := sendSIGHUP()
		if reloadErr != nil {
			fmt.Fprintf(ew, "Warning: could not send SIGHUP to daemon: %v\n", reloadErr)
			fmt.Fprintf(ew, "Run: systemctl reload dl-conn\n")
		} else {
			fmt.Fprintf(w, "Sent SIGHUP to dl_conn daemon — allowlist reloaded.\n")
		}
	}

	return nil
}

// sendSIGHUP finds the dl_conn daemon PID via systemctl and sends SIGHUP.
func sendSIGHUP() error {
	// Try systemctl to get the PID.
	out, err := exec.Command("systemctl", "show", "-p", "MainPID", "dl-conn").Output()
	if err != nil {
		return fmt.Errorf("systemctl not available or service not found: %w", err)
	}

	line := strings.TrimSpace(string(out))
	// Format: "MainPID=12345"
	pidStr := strings.TrimPrefix(line, "MainPID=")
	if pidStr == "0" || pidStr == "" {
		return fmt.Errorf("daemon process not running (PID=%s)", pidStr)
	}

	pid := 0
	if _, err := fmt.Sscanf(pidStr, "%d", &pid); err != nil || pid <= 0 {
		return fmt.Errorf("invalid PID %q", pidStr)
	}

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
