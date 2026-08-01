// Package sealed encrypts the two files a hub cannot afford to leak and cannot
// afford to lose: its command signing key and its session secret.
//
// # What this protects, precisely
//
// Data at rest that has left the running host: a stolen disk, a snapshot, a
// backup tarball. docs/THREAT-MODEL.md §6 names exactly that — "a plain
// `tar czf` of the data directory captures the database and both keys in one
// unencrypted archive".
//
// It does NOT protect against someone who can read the hub's environment or the
// key file it points at, and it cannot: the process must decrypt without a
// human present, so whatever it uses is available to anything running as it.
// That is a smaller claim than "encrypted at rest" usually implies, and it is
// the true one.
//
// # Why not a passphrase
//
// Because this hub opens gates. A passphrase typed at boot means a hub that
// does not come back after a power cut until somebody drives out to it, and an
// access-control system that stays down is worse than one whose key is readable
// by root on its own box. The key therefore has to be something a machine can
// fetch unattended — an environment variable or a mounted file, which is what
// every deployment already has and what device secrets already use.
//
// # The failure this must never have
//
// Losing the data key must not look like losing the seed. A hub that cannot
// decrypt its signing key must REFUSE, loudly, naming what happened — never
// fall through to minting a new identity, which orphans every paired
// controller. Encryption adds an unrecoverable-loss mode, so it also has to
// add the refusal that makes it survivable.
package sealed

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// magic prefixes every sealed file so a reader can tell ciphertext from a
// plaintext seed without being told which to expect. Without it, the only way
// to know is to try, and a wrong guess about a 32-byte hex seed is a decrypt
// failure that reads as a wrong key.
var magic = []byte("AQLSEAL1\n")

// KeySize is the raw data-key length. 32 bytes: AES-256.
const KeySize = 32

var (
	// ErrNotSealed reports a file that is not ciphertext. Not an error in
	// itself — the caller decides whether plaintext is acceptable here.
	ErrNotSealed = errors.New("sealed: file is not sealed")
	// ErrWrongKey is a sealed file this key cannot open. Distinct from
	// corruption on purpose: an operator with the wrong key needs to hear
	// "wrong key", not "corrupt file", or they will restore a backup they did
	// not need to.
	ErrWrongKey = errors.New("sealed: this data key cannot decrypt the file (wrong key, or the file is damaged)")
)

// ParseKey decodes a base64 data key and rejects anything not exactly KeySize.
//
// Padded or unpadded, standard or URL alphabet — an operator pasting a key
// should not have to know which this wanted. Length is checked after decoding,
// because a key that is nearly right is the interesting failure: a truncated
// paste would otherwise become a valid-looking short key.
func ParseKey(s string) ([]byte, error) {
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding,
		base64.URLEncoding, base64.RawURLEncoding,
	} {
		if b, err := enc.DecodeString(s); err == nil {
			if len(b) != KeySize {
				return nil, fmt.Errorf("sealed: data key decodes to %d bytes, want %d", len(b), KeySize)
			}
			return b, nil
		}
	}
	return nil, errors.New("sealed: data key is not valid base64")
}

// NewKey returns a fresh random data key, base64 for an operator to store.
func NewKey() (string, error) {
	b := make([]byte, KeySize)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// IsSealed reports whether these bytes are a sealed file.
func IsSealed(b []byte) bool {
	return len(b) >= len(magic) && string(b[:len(magic)]) == string(magic)
}

// Seal encrypts plaintext with key.
//
// AES-256-GCM with a random nonce stored in front of the ciphertext. No KDF:
// the key is required to be a real 32-byte key rather than a passphrase, so
// there is nothing to stretch and no cost parameter to get wrong or to have to
// keep in step with the file.
func Seal(key, plaintext []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	out := append([]byte(nil), magic...)
	out = append(out, nonce...)
	// The magic is authenticated as additional data, so a file whose header was
	// edited to look unsealed fails to open rather than being silently treated
	// as plaintext.
	return gcm.Seal(out, nonce, plaintext, magic), nil
}

// Open decrypts a sealed file.
//
// Returns ErrNotSealed for plaintext, so a caller can distinguish "this hub is
// not using encryption" from "this key is wrong" — two states that call for
// opposite actions.
func Open(key, sealedBytes []byte) ([]byte, error) {
	if !IsSealed(sealedBytes) {
		return nil, ErrNotSealed
	}
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	body := sealedBytes[len(magic):]
	if len(body) < gcm.NonceSize() {
		return nil, ErrWrongKey
	}
	nonce, ct := body[:gcm.NonceSize()], body[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, magic)
	if err != nil {
		// GCM does not distinguish a wrong key from a tampered file, and
		// neither does this: both mean "do not proceed", and inventing a
		// distinction the cryptography does not offer would be a guess in an
		// error message an operator acts on.
		return nil, ErrWrongKey
	}
	return pt, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("sealed: data key is %d bytes, want %d", len(key), KeySize)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
