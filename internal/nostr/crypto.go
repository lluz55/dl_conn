package nostr

import (
	"encoding/hex"
	"errors"
	"strings"

	nostr "github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
	"github.com/nbd-wtf/go-nostr/nip44"
)

var errInvalidKey = errors.New("invalid key format")

// DecodeNsec converts a bech32 nsec or hex private key to hex.
func DecodeNsec(nsec string) (string, error) {
	if strings.HasPrefix(nsec, "nsec") {
		_, data, err := nip19.Decode(nsec)
		if err != nil {
			return "", err
		}
		switch v := data.(type) {
		case string:
			return v, nil
		case []byte:
			return hex.EncodeToString(v), nil
		default:
			return "", errInvalidKey
		}
	}
	if nostr.IsValid32ByteHex(nsec) {
		return nsec, nil
	}
	return "", errInvalidKey
}

// DecodeNpub converts a bech32 npub or hex public key to hex.
func DecodeNpub(npub string) (string, error) {
	if strings.HasPrefix(npub, "npub") {
		_, data, err := nip19.Decode(npub)
		if err != nil {
			return "", err
		}
		switch v := data.(type) {
		case string:
			return v, nil
		case []byte:
			return hex.EncodeToString(v), nil
		default:
			return "", errInvalidKey
		}
	}
	if nostr.IsValid32ByteHex(npub) {
		return npub, nil
	}
	return "", errInvalidKey
}

// NsecToNpub derives the npub (bech32) from an nsec/hex private key.
func NsecToNpub(nsecHex string) (string, error) {
	pubHex, err := nostr.GetPublicKey(nsecHex)
	if err != nil {
		return "", err
	}
	return nip19.EncodePublicKey(pubHex)
}

// EncryptMessage encrypts a plaintext for the recipient's pubkey via NIP-44.
func EncryptMessage(plaintext string, recipientPubHex string, senderSecHex string) (string, error) {
	ck, err := nip44.GenerateConversationKey(recipientPubHex, senderSecHex)
	if err != nil {
		return "", err
	}
	return nip44.Encrypt(plaintext, ck)
}

// DecryptMessage decrypts a NIP-44 ciphertext from sender using
// the conversation key derived from sender+recipient keys.
func DecryptMessage(ciphertext string, senderPubHex string, recipientSecHex string) (string, error) {
	ck, err := nip44.GenerateConversationKey(senderPubHex, recipientSecHex)
	if err != nil {
		return "", err
	}
	return nip44.Decrypt(ciphertext, ck)
}

// KeyPair represents a Nostr keypair in both bech32 (nsec/npub) and hex formats.
type KeyPair struct {
	PrivateKeyHex string `json:"private_key_hex"`
	PublicKeyHex  string `json:"public_key_hex"`
	Nsec          string `json:"nsec"`
	Npub          string `json:"npub"`
}

// GenerateKeyPair generates a new random Nostr keypair.
func GenerateKeyPair() (*KeyPair, error) {
	sk := nostr.GeneratePrivateKey()
	return DeriveKeyPair(sk)
}

// DeriveKeyPair derives the public keys and bech32 encodings from a private key (hex or nsec).
func DeriveKeyPair(privateKey string) (*KeyPair, error) {
	skHex, err := DecodeNsec(privateKey)
	if err != nil {
		return nil, err
	}

	pkHex, err := nostr.GetPublicKey(skHex)
	if err != nil {
		return nil, err
	}

	nsec, err := nip19.EncodePrivateKey(skHex)
	if err != nil {
		return nil, err
	}

	npub, err := nip19.EncodePublicKey(pkHex)
	if err != nil {
		return nil, err
	}

	return &KeyPair{
		PrivateKeyHex: skHex,
		PublicKeyHex:  pkHex,
		Nsec:          nsec,
		Npub:          npub,
	}, nil
}

