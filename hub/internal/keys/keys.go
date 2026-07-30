// Package keys holds the gateway's Ed25519 signing identity and the signed
// command envelope per proto/commands.md. Controllers pin the public key at
// pairing; every actuation they perform is an envelope signed here.
package keys

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

const keyFile = "gateway_ed25519.seed"

// Keys is the gateway signing identity.
//
// It holds up to two keys. The second exists only while a key rotation is in
// flight, and only so that controllers which have not yet been repaired onto the
// new key can still be sent commands — see rotation.go for why that retention is
// not optional.
type Keys struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey

	// dir is where the seeds live, needed to rotate. Empty for a Keys built in
	// memory by a test, which then cannot rotate.
	dir string

	// prevPriv/prevPub are the retained pre-rotation key, nil when no rotation
	// is in flight.
	prevPriv ed25519.PrivateKey
	prevPub  ed25519.PublicKey
}

// b64 is the encoding controllers pin and /v1/gateway/key serves: base64url,
// unpadded.
var b64 = base64.RawURLEncoding

// Load reads the Ed25519 seed from dir, generating one at first boot
// (0600, seed-only on disk — the public key is derived).
func Load(dir string) (*Keys, error) {
	path := filepath.Join(dir, keyFile)
	seedHex, err := os.ReadFile(path)
	switch {
	case err == nil:
		seed, err := hex.DecodeString(string(seedHex))
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("corrupt gateway key file %s", path)
		}
		priv := ed25519.NewKeyFromSeed(seed)
		k := &Keys{priv: priv, pub: priv.Public().(ed25519.PublicKey), dir: dir}
		if k.prevPriv, k.prevPub, err = loadPrevious(dir, priv); err != nil {
			return nil, err
		}
		return k, nil
	case os.IsNotExist(err):
		seed := make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			return nil, err
		}
		if err := os.WriteFile(path, []byte(hex.EncodeToString(seed)), 0o600); err != nil {
			return nil, fmt.Errorf("persist gateway key: %w", err)
		}
		priv := ed25519.NewKeyFromSeed(seed)
		// First boot: there is nothing to have rotated away from, so no
		// previous-key file is consulted.
		return &Keys{priv: priv, pub: priv.Public().(ed25519.PublicKey), dir: dir}, nil
	default:
		return nil, err
	}
}

// PublicKeyB64 returns the raw public key, base64url (unpadded) — the format
// controllers pin and /v1/gateway/key serves.
func (k *Keys) PublicKeyB64() string {
	return base64.RawURLEncoding.EncodeToString(k.pub)
}

// Public returns the raw public key.
func (k *Keys) Public() ed25519.PublicKey { return k.pub }

// Sign signs msg with the gateway key, returning base64url (unpadded).
func (k *Keys) Sign(msg []byte) string {
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(k.priv, msg))
}

// Verify checks a base64url signature over msg against pub.
//
// A pub that is not exactly 32 bytes is REFUSED rather than handed to
// ed25519.Verify, which panics on a wrong-sized key instead of returning false.
// Callers here reach this through hub.DecodePubkey, which enforces the length,
// so this is the belt on top of the braces — but the counterpart in the
// controller (wire.Verify) has a path that genuinely can arrive with nil, and
// the two halves of a signing discipline should not disagree about what an
// unusable key means.
func Verify(pub ed25519.PublicKey, msg []byte, sigB64 string) bool {
	if len(pub) != ed25519.PublicKeySize {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return false
	}
	return ed25519.Verify(pub, msg, sig)
}
