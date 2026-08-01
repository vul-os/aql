package keys_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
)

// A hub with paired controllers must not mint a new signing identity.
//
// keys.Load generates one when the seed file is absent. On a first boot that is
// exactly right. Afterwards it is the worst outcome this system has: every
// paired controller pins the OLD public key, so each command it receives fails
// `badsig`, and the `repair` that would move it must be signed by the key that
// is gone. Recovery is walking to every gate and re-pairing it.
//
// The failure is silent and looks like success — the hub starts, serves, logs a
// public key, and every controller stops obeying it.
func TestRequireExistingRefusesWhenTheKeyIsGone(t *testing.T) {
	dir := t.TempDir()
	err := keys.RequireExisting(dir)
	if !errors.Is(err, keys.ErrNoKeyForPairedHub) {
		t.Fatalf("err = %v, want ErrNoKeyForPairedHub", err)
	}
	// The message has to say what to do. An operator meeting this is mid-outage
	// and the difference between "restore the file from a backup" and a bare
	// error is whether they try re-pairing first.
	if msg := err.Error(); !contains(msg, "backup") || !contains(msg, "orphan") {
		t.Errorf("message does not say what happened or what to do: %q", msg)
	}
}

func TestRequireExistingAcceptsAKeyThatIsThere(t *testing.T) {
	dir := t.TempDir()
	// Load MINTS on a fresh directory — the first-boot path, which stays
	// exactly as it was.
	if _, err := keys.Load(dir); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if err := keys.RequireExisting(dir); err != nil {
		t.Fatalf("RequireExisting after a real first boot: %v", err)
	}
}

// The refusal must not fire for an unreadable-but-present key: that is a
// different fault with a different fix (permissions), and reporting it as a
// lost identity would send an operator to restore a backup they do not need.
func TestRequireExistingDistinguishesMissingFromUnreadable(t *testing.T) {
	dir := t.TempDir()
	if _, err := keys.Load(dir); err != nil {
		t.Fatalf("Load: %v", err)
	}
	path := filepath.Join(dir, "gateway_ed25519.seed")
	if err := os.Chmod(path, 0o000); err != nil {
		t.Skipf("cannot chmod on this platform: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o600) })

	// Stat still succeeds on a mode-000 file, so this is present-and-unreadable
	// and RequireExisting says nothing about it — Load reports the read error.
	if err := keys.RequireExisting(dir); err != nil {
		t.Errorf("RequireExisting on an unreadable but PRESENT key: %v — that is a "+
			"permissions fault, not a lost identity", err)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
