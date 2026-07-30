package keys

import (
	"crypto/ed25519"
	"os"
	"path/filepath"
	"testing"
)

// Two-key retention, at the level where getting it wrong strands hardware.
//
// The property under test is not "rotation produces a new key" — that is one
// line. It is that a controller which has NOT been repaired can still be sent
// commands it can verify, for as long as it takes to reach it. A hub that
// rotates and immediately signs everything with the new key has not rotated,
// it has disconnected its fleet.
func TestCommandsForAnUnrepairedControllerStillVerify(t *testing.T) {
	dir := t.TempDir()
	k, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	oldPub := k.PublicKeyB64()
	oldRaw := append(ed25519.PublicKey(nil), k.Public()...)

	newPub, err := k.Rotate()
	if err != nil {
		t.Fatal(err)
	}
	if newPub == oldPub {
		t.Fatal("Rotate returned the key it was supposed to replace")
	}
	if !k.HasPrevious() || k.PreviousPublicKeyB64() != oldPub {
		t.Fatalf("the pre-rotation key was not retained: %q", k.PreviousPublicKeyB64())
	}

	// A controller that has not been repaired: it still pins the old key, and
	// an ordinary open sent to it must verify against that.
	env, err := k.SignCommandForPin(oldPub, "lift", "dev-1", "ap-1", nil, 30, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyEnvelope(oldRaw, env); err != nil {
		t.Fatalf("a command for an unrepaired controller does not verify against the key "+
			"it pins: %v — that controller cannot open its gate until it is repaired", err)
	}
	// And must NOT verify against the new key, or the test above proves nothing.
	if err := VerifyEnvelope(k.Public(), env); err == nil {
		t.Fatal("the same envelope verified against both keys")
	}

	// A repaired controller gets the new key.
	env2, err := k.SignCommandForPin(newPub, "lift", "dev-2", "ap-1", nil, 30, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyEnvelope(k.Public(), env2); err != nil {
		t.Fatalf("a command for a repaired controller does not verify: %v", err)
	}

	// A pin this hub does not hold is refused rather than signed with whatever
	// is current: signing would produce a badsig at the gate, which looks like a
	// broken controller instead of like broken bookkeeping.
	if _, err := k.SignCommandForPin("SOME_OTHER_KEY", "lift", "dev-3", "", nil, 30, nil); err == nil {
		t.Error("signed for a controller pinning a key this hub does not hold")
	}
}

// A second rotation before the first completes would discard the key some
// controllers still pin — the exact outcome the retention exists to prevent.
func TestASecondRotationIsRefusedWhileOneIsInFlight(t *testing.T) {
	k, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := k.Rotate(); err != nil {
		t.Fatal(err)
	}
	if _, err := k.Rotate(); err != ErrRotationInFlight {
		t.Fatalf("second Rotate err = %v, want ErrRotationInFlight", err)
	}
}

// The retained key must survive a restart. A hub that forgot it on reboot would
// be a hub that strands every controller it had not yet repaired — and a reboot
// mid-rotation is precisely when that matters.
func TestTheRetainedKeySurvivesAReload(t *testing.T) {
	dir := t.TempDir()
	k, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	oldPub := k.PublicKeyB64()
	newPub, err := k.Rotate()
	if err != nil {
		t.Fatal(err)
	}

	reloaded, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.PublicKeyB64() != newPub {
		t.Errorf("after reload the current key is %q, want %q", reloaded.PublicKeyB64(), newPub)
	}
	if reloaded.PreviousPublicKeyB64() != oldPub {
		t.Fatalf("after reload the retained key is %q, want %q — every unrepaired "+
			"controller is now unreachable", reloaded.PreviousPublicKeyB64(), oldPub)
	}
	// And it still signs for them.
	if _, err := reloaded.SignCommandForPin(oldPub, "lift", "d", "", nil, 30, nil); err != nil {
		t.Errorf("the reloaded hub cannot sign for an unrepaired controller: %v", err)
	}
}

// Retiring the key ends the rotation and must not leave the seed on disk: the
// whole point of completing a rotation is that the superseded private key is
// gone.
func TestRetiringThePreviousKeyDestroysIt(t *testing.T) {
	dir := t.TempDir()
	k, _ := Load(dir)
	oldPub := k.PublicKeyB64()
	if _, err := k.Rotate(); err != nil {
		t.Fatal(err)
	}
	if err := k.RetirePrevious(); err != nil {
		t.Fatal(err)
	}
	if k.HasPrevious() {
		t.Error("HasPrevious is still true after retiring")
	}
	if _, err := k.SignCommandForPin(oldPub, "lift", "d", "", nil, 30, nil); err == nil {
		t.Error("still signing with a key that was supposed to be destroyed")
	}
	// A reload must not resurrect it from disk.
	reloaded, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.HasPrevious() {
		t.Error("the retired key came back after a reload; the seed file was not removed")
	}
}

// The crash window rotation.go calls benign, exercised rather than asserted.
//
// Rotate writes the old seed to the previous-key file BEFORE replacing the
// current one, so losing power between those two steps leaves both files
// holding the same key. Without the dedupe in loadPrevious, the hub comes back
// believing it is mid-rotation and offers to repair every controller onto the
// key it already pins — a rotation that can never complete, against a "previous"
// key that is also the current one.
func TestARotationInterruptedBeforeTheNewKeyLandsIsNotARotation(t *testing.T) {
	dir := t.TempDir()
	k, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	pub := k.PublicKeyB64()

	// Simulate the crash: the previous-key file exists holding the CURRENT seed,
	// because that is exactly what Rotate writes first.
	if err := writeSeed(filepath.Join(dir, previousKeyFile), k.priv.Seed()); err != nil {
		t.Fatal(err)
	}

	reloaded, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.HasPrevious() {
		t.Fatalf("a hub that crashed before its new key landed came back mid-rotation, "+
			"with a retained key identical to its current one (%q)", reloaded.PreviousPublicKeyB64())
	}
	if reloaded.PublicKeyB64() != pub {
		t.Errorf("the current key changed: %q, want %q", reloaded.PublicKeyB64(), pub)
	}
	// The stale file must be gone, or every subsequent boot repeats the dedupe
	// and a real rotation cannot start.
	if _, err := os.Stat(filepath.Join(dir, previousKeyFile)); !os.IsNotExist(err) {
		t.Errorf("the duplicate previous-key file was left on disk: %v", err)
	}
	if _, err := reloaded.Rotate(); err != nil {
		t.Errorf("a real rotation is now refused: %v", err)
	}
}

// A corrupt retained key must be reported, not ignored. Ignoring it would hand
// back a hub that silently cannot sign for its unrepaired controllers, which
// presents as those controllers refusing every command.
func TestACorruptRetainedKeyIsAnError(t *testing.T) {
	dir := t.TempDir()
	if _, err := Load(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, previousKeyFile), []byte("not hex"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil {
		t.Error("a corrupt retained key file loaded without error")
	}
}
