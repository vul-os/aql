package keys_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/sealed"
)

func dataKey(t *testing.T) []byte {
	t.Helper()
	s, err := sealed.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	k, err := sealed.ParseKey(s)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func seedPath(dir string) string { return filepath.Join(dir, "gateway_ed25519.seed") }

// THE FAILURE THIS FEATURE MUST NOT HAVE.
//
// A sealed seed with no data key must refuse. Without the check it fails hex
// decoding, reads as "corrupt", and any caller that treats a missing-or-broken
// key as first boot mints a new identity — which orphans every paired
// controller. Encryption adds this loss mode, so the refusal is part of the
// feature rather than a nicety on top of it.
func TestASealedSeedWithNoDataKeyRefusesRatherThanMinting(t *testing.T) {
	dir := t.TempDir()
	key := dataKey(t)

	original, err := keys.Load(dir, keys.WithDataKey(key))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	pub := original.PublicKeyB64()

	raw, err := os.ReadFile(seedPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if !sealed.IsSealed(raw) {
		t.Fatal("the seed was not sealed on disk despite a data key")
	}

	// No key this time.
	got, err := keys.Load(dir)
	if !errors.Is(err, keys.ErrSealedNoKey) {
		t.Fatalf("err = %v, want ErrSealedNoKey", err)
	}
	if got != nil {
		t.Fatal("a Keys was returned alongside the refusal")
	}
	// And nothing was overwritten: the sealed file must survive so the right
	// key still opens it.
	after, err := os.ReadFile(seedPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(raw) {
		t.Fatal("the refusal rewrote the seed file")
	}
	reopened, err := keys.Load(dir, keys.WithDataKey(key))
	if err != nil {
		t.Fatalf("reopen with the right key: %v", err)
	}
	if reopened.PublicKeyB64() != pub {
		t.Fatal("the identity changed across a refused open")
	}
}

func TestTheWrongDataKeyRefusesToo(t *testing.T) {
	dir := t.TempDir()
	if _, err := keys.Load(dir, keys.WithDataKey(dataKey(t))); err != nil {
		t.Fatal(err)
	}
	if _, err := keys.Load(dir, keys.WithDataKey(dataKey(t))); err == nil {
		t.Fatal("a different data key opened the seed")
	}
}

// Turning encryption on is setting a variable, not running a migration.
func TestAPlaintextSeedIsSealedInPlaceOnFirstUse(t *testing.T) {
	dir := t.TempDir()
	before, err := keys.Load(dir) // plaintext, as today
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(seedPath(dir))
	if sealed.IsSealed(raw) {
		t.Fatal("a hub with no data key sealed its seed")
	}

	key := dataKey(t)
	after, err := keys.Load(dir, keys.WithDataKey(key))
	if err != nil {
		t.Fatalf("Load with a key over a plaintext seed: %v", err)
	}
	if after.PublicKeyB64() != before.PublicKeyB64() {
		t.Fatal("sealing changed the identity — every controller would be orphaned")
	}
	raw2, _ := os.ReadFile(seedPath(dir))
	if !sealed.IsSealed(raw2) {
		t.Fatal("the plaintext seed was not sealed in place")
	}
	// And it still opens.
	reopened, err := keys.Load(dir, keys.WithDataKey(key))
	if err != nil || reopened.PublicKeyB64() != before.PublicKeyB64() {
		t.Fatalf("reopen after sealing: %v", err)
	}
}

// A hub with no data key behaves exactly as it did. This is the control: if
// encryption changed the default path, every existing deployment would be
// affected by a feature nobody turned on.
func TestNoDataKeyIsTodaysBehaviourUnchanged(t *testing.T) {
	dir := t.TempDir()
	k1, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(seedPath(dir))
	if sealed.IsSealed(raw) {
		t.Fatal("a seed was sealed with no data key configured")
	}
	k2, err := keys.Load(dir)
	if err != nil || k2.PublicKeyB64() != k1.PublicKeyB64() {
		t.Fatalf("reload: %v", err)
	}
}
