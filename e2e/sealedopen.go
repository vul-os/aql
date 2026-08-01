package e2e

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// An independent unsealer for the hub's sealed key files.
//
// This module imports nothing from hub/ or controller/ — Go's internal/ rule
// forbids it, and README.md ("Why subprocess, not in-process") explains why
// that is the point rather than a limitation. jcs.go duplicates canonicalisation
// for the same reason.
//
// The duplication is worth something beyond necessity: this is a SECOND
// implementation of the file format, so a change to the hub's that broke the
// format would fail here rather than being agreed with. It is written from the
// format — magic, nonce, AES-256-GCM with the magic as additional data — not
// copied from the source.
var sealMagic = []byte("AQLSEAL1\n")

func isSealedFile(b []byte) bool {
	return len(b) >= len(sealMagic) && string(b[:len(sealMagic)]) == string(sealMagic)
}

// parseDataKey decodes a base64 32-byte key, accepting any of the four
// alphabets an operator might paste.
func parseDataKey(s string) ([]byte, error) {
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding,
		base64.URLEncoding, base64.RawURLEncoding,
	} {
		if b, err := enc.DecodeString(s); err == nil {
			if len(b) != 32 {
				return nil, fmt.Errorf("data key decodes to %d bytes, want 32", len(b))
			}
			return b, nil
		}
	}
	return nil, errors.New("data key is not valid base64")
}

func openSealedFile(key, b []byte) ([]byte, error) {
	if !isSealedFile(b) {
		return nil, errors.New("not a sealed file")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	body := b[len(sealMagic):]
	if len(body) < gcm.NonceSize() {
		return nil, errors.New("sealed file is too short")
	}
	return gcm.Open(nil, body[:gcm.NonceSize()], body[gcm.NonceSize():], sealMagic)
}

// newDataKey mints a key for a test to hand the hub.
func newDataKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
