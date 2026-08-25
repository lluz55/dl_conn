package main

import (
	"encoding/json"
	"fmt"
	"io"

	"dl_conn/internal/nostr"
	"github.com/mdp/qrterminal/v3"

	"github.com/spf13/cobra"
)

type keygenOptions struct {
	jsonOutput bool
	fromKey    string
	nsecOnly   bool
	npubOnly   bool
	pubHexOnly bool
	secHexOnly bool
	qr         bool
}

func newKeygenCmd() *cobra.Command {
	var opts keygenOptions

	cmd := &cobra.Command{
		Use:     "keygen",
		Aliases: []string{"genkey", "key"},
		Short:   "Generate a new Nostr keypair (nsec/npub) or derive from an existing private key",
		Long: `Generate a new cryptographic keypair for Nostr (secp256k1).
Outputs the private key (nsec / hex) and public key (npub / hex).
Can also derive the public key from an existing private key using --from-key.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runKeygen(opts, cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}

	cmd.Flags().BoolVar(&opts.jsonOutput, "json", false, "output keypair as JSON")
	cmd.Flags().StringVarP(&opts.fromKey, "from-key", "k", "", "derive keypair from existing private key (nsec or hex)")
	cmd.Flags().BoolVar(&opts.nsecOnly, "nsec", false, "output only nsec (bech32 private key)")
	cmd.Flags().BoolVar(&opts.npubOnly, "npub", false, "output only npub (bech32 public key)")
	cmd.Flags().BoolVar(&opts.pubHexOnly, "pub-hex", false, "output only public key in hex")
	cmd.Flags().BoolVar(&opts.secHexOnly, "sec-hex", false, "output only private key in hex")
	cmd.Flags().BoolVar(&opts.qr, "qr", false, "print a scannable QR code in the terminal (nsec by default, or npub with --npub)")

	return cmd
}

func runKeygen(opts keygenOptions, w io.Writer, ew io.Writer) error {
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

	if opts.jsonOutput && opts.qr {
		return fmt.Errorf("cannot combine --qr with --json")
	}

	if opts.qr {
		var qrTarget string
		if opts.npubOnly || opts.pubHexOnly {
			if opts.pubHexOnly {
				qrTarget = kp.PublicKeyHex
				fmt.Fprintln(ew, "QR code for your public key (hex):")
			} else {
				qrTarget = kp.Npub
				fmt.Fprintln(ew, "QR code for your npub (public key):")
			}
		} else {
			if opts.secHexOnly {
				qrTarget = kp.PrivateKeyHex
				fmt.Fprintln(ew, "QR code for your private key in hex (do not photograph or share — it is your private key):")
			} else {
				qrTarget = kp.Nsec
				fmt.Fprintln(ew, "QR code for your nsec (do not photograph or share — it is your private key):")
			}
		}
		qrterminal.GenerateHalfBlock(qrTarget, qrterminal.L, w)
		fmt.Fprintln(w)

		msg := fmt.Sprintf(`Nostr Keypair:

  Private Key (nsec): %s
  Private Key (hex):  %s
  Public Key (npub):  %s
  Public Key (hex):   %s

Example config.yaml usage:
  nostr:
    nsec: "%s"
    authorizedNpubs:
      - "%s"
`, kp.Nsec, kp.PrivateKeyHex, kp.Npub, kp.PublicKeyHex, kp.Nsec, kp.Npub)
		_, err = fmt.Fprint(w, msg)
		return err
	}

	if opts.nsecOnly {
		_, err = fmt.Fprintln(w, kp.Nsec)
		return err
	}
	if opts.npubOnly {
		_, err = fmt.Fprintln(w, kp.Npub)
		return err
	}
	if opts.pubHexOnly {
		_, err = fmt.Fprintln(w, kp.PublicKeyHex)
		return err
	}
	if opts.secHexOnly {
		_, err = fmt.Fprintln(w, kp.PrivateKeyHex)
		return err
	}

	if opts.jsonOutput {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(kp)
	}

	msg := fmt.Sprintf(`Nostr Keypair:

  Private Key (nsec): %s
  Private Key (hex):  %s
  Public Key (npub):  %s
  Public Key (hex):   %s

Example config.yaml usage:
  nostr:
    nsec: "%s"
    authorizedNpubs:
      - "%s"
`, kp.Nsec, kp.PrivateKeyHex, kp.Npub, kp.PublicKeyHex, kp.Nsec, kp.Npub)

	_, err = fmt.Fprint(w, msg)
	return err
}

func init() {
	rootCmd.AddCommand(newKeygenCmd())
}
