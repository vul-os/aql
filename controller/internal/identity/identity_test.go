package identity_test

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vul-os/aql/controller/internal/identity"
)

// The controller's device identity, which had no tests at all.
//
// Found by extending the coverage audit to the controller: Load, FromSeed and
// Private were at zero. This is the keypair the hub knows a controller BY —
// proto/pairing.md rule 2 — so the failures here are not subtle degradations,
// they are a controller the hub no longer recognises.

// The property everything else rests on: a controller is the same device across
// reboots. If Load ever regenerated, a restart would present an unknown public
// key, the hub would refuse it, and every gate behind it would stop opening
// until someone re-paired by hand.
func TestAnIdentitySurvivesAReload(t *testing.T) {
	dir := t.TempDir()
	first, err := identity.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := identity.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.PublicKeyB64() != second.PublicKeyB64() {
		t.Fatalf("identity changed across a reload: %q then %q — the hub would see a new device",
			first.PublicKeyB64(), second.PublicKeyB64())
	}
	// And a DIFFERENT directory is a different device, or every controller in a
	// fleet would share one identity.
	other, err := identity.Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if other.PublicKeyB64() == first.PublicKeyB64() {
		t.Error("two independent controllers generated the same identity")
	}
}

// A damaged seed file is an ERROR, never a fresh identity.
//
// The dangerous "fix" here is a helpful one: regenerate when the file will not
// parse, so the controller boots. That turns a repairable fault into a silent
// re-pairing — the device comes up as a stranger, the hub refuses it, and the
// original identity is overwritten and gone. Refusing to boot is the correct
// outcome because it is the recoverable one.
func TestACorruptSeedRefusesRatherThanRegenerating(t *testing.T) {
	dir := t.TempDir()
	orig, err := identity.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "controller_ed25519.seed")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"", "not-hex", "aabb", strings.Repeat("aa", 31), strings.Repeat("aa", 33)} {
		if err := os.WriteFile(path, []byte(bad), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := identity.Load(dir); err == nil {
			t.Errorf("a seed file of %q loaded successfully — a corrupt identity became a new one", bad)
		}
	}

	// And the file was not rewritten while refusing: a failed load must not
	// destroy the seed someone might still recover.
	if err := os.WriteFile(path, before, 0o600); err != nil {
		t.Fatal(err)
	}
	back, err := identity.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if back.PublicKeyB64() != orig.PublicKeyB64() {
		t.Error("restoring the original seed did not restore the original identity")
	}
}

// The seed never leaves the device, so the file it sits in must not be readable
// by anyone else on the box.
//
// The FILE mode is the security property — a 0600 seed is unreadable whatever
// the directory allows, and a directory that is merely listable reveals only
// that a seed file exists, which is not a secret.
func TestTheSeedFileIsNotReadableByOthers(t *testing.T) {
	dir := t.TempDir()
	if _, err := identity.Load(dir); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(dir, "controller_ed25519.seed"))
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm&0o077 != 0 {
		t.Errorf("seed file mode %o — group or other can read the private key", perm)
	}
}

// The directory Load CREATES is 0700.
//
// Asserted against a path Load actually creates, not against t.TempDir()'s: the
// first version of this checked the temp directory and failed at 0755, which
// says nothing about the code — MkdirAll leaves an existing directory's mode
// alone, so it was measuring the test harness. The consequence is worth
// recording rather than silently narrowing the test: on a box where the state
// directory ALREADY exists, Load does not tighten it. That is acceptable here
// only because the file mode carries the secret.
func TestLoadCreatesItsDirectoryPrivately(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state", "controller")
	if _, err := identity.Load(dir); err != nil {
		t.Fatal(err)
	}
	di, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if perm := di.Mode().Perm(); perm&0o077 != 0 {
		t.Errorf("Load created its state directory as %o, want 0700", perm)
	}
}

// Seed-only on disk. The public key is DERIVED, so it must not be written
// alongside — a file carrying both is a file where the two can disagree.
func TestOnlyTheSeedIsPersisted(t *testing.T) {
	dir := t.TempDir()
	id, err := identity.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "controller_ed25519.seed"))
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != ed25519.SeedSize*2 {
		t.Errorf("seed file is %d bytes, want %d hex characters and nothing else",
			len(raw), ed25519.SeedSize*2)
	}
	if strings.Contains(string(raw), id.PublicKeyB64()) {
		t.Error("the public key is stored beside the seed — derived values must not be persisted")
	}
	seed, err := hex.DecodeString(string(raw))
	if err != nil {
		t.Fatalf("seed file is not hex: %v", err)
	}
	// The persisted seed reproduces the identity exactly. This is what makes
	// the file a backup rather than a coincidence.
	if identity.FromSeed(seed).PublicKeyB64() != id.PublicKeyB64() {
		t.Error("the persisted seed does not reproduce the loaded identity")
	}
}

// The wire format pair.redeem carries: base64url, UNPADDED. Padded or standard
// base64 would be a pairing that fails at the hub with a key mismatch nobody
// can read.
func TestThePublicKeyIsUnpaddedBase64URL(t *testing.T) {
	id := identity.FromSeed(make([]byte, ed25519.SeedSize))
	got := id.PublicKeyB64()
	if strings.ContainsAny(got, "=+/") {
		t.Errorf("public key %q is padded or standard base64, not base64url unpadded", got)
	}
	raw, err := base64.RawURLEncoding.DecodeString(got)
	if err != nil {
		t.Fatalf("public key does not decode as raw base64url: %v", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		t.Errorf("public key decodes to %d bytes, want %d", len(raw), ed25519.PublicKeySize)
	}
}

// Private and Public are halves of one key, and the private one actually signs.
func TestTheKeyPairMatchesAndSigns(t *testing.T) {
	id := identity.FromSeed(make([]byte, ed25519.SeedSize))
	msg := []byte("pair.redeem")
	sig := ed25519.Sign(id.Private(), msg)
	if !ed25519.Verify(id.Public(), msg, sig) {
		t.Fatal("the public key does not verify what the private key signed")
	}
	// Derived from the private half rather than carried separately.
	derived := id.Private().Public().(ed25519.PublicKey)
	if string(derived) != string(id.Public()) {
		t.Error("Public() is not the public half of Private()")
	}
}
