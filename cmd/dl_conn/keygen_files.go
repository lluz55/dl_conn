package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"dl_conn/internal/nostr"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// keygenFileEntry is the structured content written to each key file.
// It carries the key value, its type (npub/nsec), and when it was generated.
type keygenFileEntry struct {
	Type      string `json:"type" yaml:"type"`
	Value     string `json:"value" yaml:"value"`
	Timestamp string `json:"timestamp" yaml:"timestamp"`
}

type keygenFilesOptions struct {
	fromKey  string
	npubFile string
	nsecFile string
	dir      string
	format   string
}

func newKeygenFilesCmd() *cobra.Command {
	var opts keygenFilesOptions

	cmd := &cobra.Command{
		Use:   "files",
		Short: "Generate a keypair and write npub and nsec to separate files",
		Long: `Generate a new Nostr keypair (or derive from an existing private key)
and write each key to its own file. Each file contains the key value, the key
type (npub or nsec), and a UTC timestamp.

The nsec (private key) file is written with 0600 permissions; the npub file
with 0644 since it is public information.

Examples:
  dl_conn keygen files
  dl_conn keygen files --dir ./keys --format json
  dl_conn keygen files --npub-file pub.key --nsec-file priv.key
  dl_conn keygen files --from-key nsec1... --dir ./keys
`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runKeygenFiles(opts, cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}

	cmd.Flags().StringVarP(&opts.fromKey, "from-key", "k", "", "derive keypair from existing private key (nsec or hex)")
	cmd.Flags().StringVar(&opts.npubFile, "npub-file", "", "path for the npub file (default: <dir>/npub.<ext>)")
	cmd.Flags().StringVar(&opts.nsecFile, "nsec-file", "", "path for the nsec file (default: <dir>/nsec.<ext>)")
	cmd.Flags().StringVar(&opts.dir, "dir", ".", "directory for output files")
	cmd.Flags().StringVar(&opts.format, "format", "yaml", "file format: yaml or json")

	return cmd
}

func runKeygenFiles(opts keygenFilesOptions, w io.Writer, ew io.Writer) error {
	if opts.format != "yaml" && opts.format != "json" {
		return fmt.Errorf("invalid format %q: must be 'yaml' or 'json'", opts.format)
	}

	var (
		kp  *nostr.KeyPair
		err error
	)

	if opts.fromKey != "" {
		kp, err = nostr.DeriveKeyPair(opts.fromKey)
		if err != nil {
			return fmt.Errorf("deriving keypair: %w", err)
		}
	} else {
		kp, err = nostr.GenerateKeyPair()
		if err != nil {
			return fmt.Errorf("generating keypair: %w", err)
		}
	}

	ts := time.Now().UTC().Format(time.RFC3339)

	// Ensure the output directory exists.
	dir := opts.dir
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating output directory: %w", err)
	}

	npubEntry := keygenFileEntry{
		Type:      "npub",
		Value:     kp.Npub,
		Timestamp: ts,
	}
	nsecEntry := keygenFileEntry{
		Type:      "nsec",
		Value:     kp.Nsec,
		Timestamp: ts,
	}

	ext := "yaml"
	if opts.format == "json" {
		ext = "json"
	}

	npubPath := opts.npubFile
	if npubPath == "" {
		npubPath = filepath.Join(opts.dir, "npub."+ext)
	}
	nsecPath := opts.nsecFile
	if nsecPath == "" {
		nsecPath = filepath.Join(opts.dir, "nsec."+ext)
	}

	if err := writeKeyFile(npubPath, npubEntry, opts.format, 0o644); err != nil {
		return fmt.Errorf("writing npub file: %w", err)
	}
	if err := writeKeyFile(nsecPath, nsecEntry, opts.format, 0o600); err != nil {
		return fmt.Errorf("writing nsec file: %w", err)
	}

	fmt.Fprintf(w, "Keys generated and written:\n")
	fmt.Fprintf(w, "  npub:   %s  (file: %s,  perms: 0644)\n", kp.Npub, npubPath)
	fmt.Fprintf(w, "  nsec:   %s  (file: %s,  perms: 0600)\n", kp.Nsec, nsecPath)
	fmt.Fprintf(w, "  timestamp: %s\n", ts)
	fmt.Fprintln(ew, "SECURITY: keep the nsec file secret — it is your private key.")

	return nil
}

// writeKeyFile serialises entry and writes it to path with the given permissions.
func writeKeyFile(path string, entry keygenFileEntry, format string, perms os.FileMode) error {
	var data []byte
	var err error

	if format == "json" {
		data, err = json.MarshalIndent(entry, "", "  ")
	} else {
		data, err = yaml.Marshal(entry)
	}
	if err != nil {
		return err
	}

	data = append(data, '\n')
	return os.WriteFile(path, data, perms)
}
