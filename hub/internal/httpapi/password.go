package httpapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// argon2id parameters (RFC 9106 low-memory profile; fine for a self-hosted
// gateway on Pi-class hardware).
//
// These constants are the SHIPPED cost and are asserted by
// TestArgonDefaultsAreTheRFCProfile. Nothing may lower them.
const (
	argonTime    = 3
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// The cost actually used, defaulting to the constants above.
//
// Variables rather than constants for exactly one reason: this package's test
// binary registers hundreds of users, and 64 MiB × 3 passes each pushed
// `go test ./internal/httpapi` past Go's ten-minute per-package timeout — CI
// runs a bare `go test ./...`, so the suite had stopped being able to finish at
// all. TestMain lowers them for tests only; production reads the constants.
//
// A deliberately awkward seam. The alternative was raising the timeout, which
// buys nothing and hides the growth, or trimming tests, which trades coverage
// for seconds. Lowering a cost that exists to be slow is safe only because the
// default is pinned by a test that reads the constants and not these vars.
var (
	argonTimeUsed    uint32 = argonTime
	argonMemoryUsed  uint32 = argonMemory
	argonThreadsUsed uint8  = argonThreads
)

// HashPassword derives an argon2id hash in the standard PHC string format.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTimeUsed, argonMemoryUsed, argonThreadsUsed, argonKeyLen)
	// The parameters are written into the hash, so VerifyPassword re-derives
	// with whatever cost produced it — a hash made at test cost verifies at
	// test cost, and a production hash keeps its own.
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryUsed, argonTimeUsed, argonThreadsUsed,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword checks password against a PHC argon2id hash string,
// re-deriving with the parameters embedded in the hash.
func VerifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	// "" argon2id v=19 m=...,t=...,p=... salt key
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
