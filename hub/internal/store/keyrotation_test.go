package store

// What must be true of the bookkeeping before a signing key is destroyed.
//
// The failure this guards against is not recoverable in software. A controller
// still pinning a key the hub has discarded cannot be sent anything — not a
// lift, not another repair — and the only way back is a physical factory reset.
// For a gate controller that is someone with a ladder, so every check here is
// about refusing to complete a rotation one controller too early.

import (
	"context"
	"errors"
	"testing"
)

const (
	oldPub = "OLD_KEY_PUBLIC_BASE64URL"
	newPub = "NEW_KEY_PUBLIC_BASE64URL"
)

func rotationFixture(t *testing.T, devices int) (*Store, context.Context, string, []string) {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "rot@x.com", "hash", "R", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := s.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for i := 0; i < devices; i++ {
		d, err := s.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Gate", "hash-"+string(rune('a'+i)), now()+3600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.ExecContext(ctx,
			`UPDATE devices SET paired_at = ?, public_key = 'x', status = 'active' WHERE id = ?`,
			now(), d.ID); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, d.ID)
	}
	return s, ctx, acct.ID, ids
}

// Beginning a rotation must write down what every controller pins, not leave it
// implied. "No row" and "not yet repaired" have to be distinguishable, or the
// completion check cannot tell a controller it has never reached from one that
// does not exist.
func TestBeginningARotationRecordsWhatEveryControllerPins(t *testing.T) {
	s, ctx, _, ids := rotationFixture(t, 3)

	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, "suspected compromise"); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		got, err := s.PinnedKey(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if got != oldPub {
			t.Errorf("device %s pins %q, want the pre-rotation key", id, got)
		}
	}
	// The count lives inside CompleteKeyRotation's transaction — the only place
	// it is safe to read, since a check followed by a separate write is a window
	// in which a controller can pair.
	err := s.CompleteKeyRotation(ctx, "rot-1", newPub)
	var incomplete *RotationIncompleteError
	if !errors.As(err, &incomplete) {
		t.Fatalf("CompleteKeyRotation err = %v, want RotationIncompleteError", err)
	}
	if incomplete.Remaining != 3 {
		t.Errorf("Remaining = %d, want 3", incomplete.Remaining)
	}
}

// The nonce is what separates proof from a guess. An ack's result is "ok" for
// every command kind, so an uncorrelated one would let the acknowledgement of an
// ordinary lift move a controller onto the new key — after which the hub stops
// signing with the key that controller actually pins.
func TestOnlyTheMatchingNonceMovesAControllerOntoTheNewKey(t *testing.T) {
	s, ctx, _, ids := rotationFixture(t, 1)
	dev := ids[0]
	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordRepairDispatched(ctx, dev, "nonce-A"); err != nil {
		t.Fatal(err)
	}

	// An ack for something else entirely.
	moved, err := s.RecordRepairAck(ctx, dev, "nonce-of-a-lift", newPub)
	if err != nil {
		t.Fatal(err)
	}
	if moved {
		t.Fatal("an unrelated ack moved the controller onto the new key")
	}
	if got, _ := s.PinnedKey(ctx, dev); got != oldPub {
		t.Fatalf("pin changed to %q on an unrelated ack", got)
	}

	// An empty nonce must not match the row's own emptiness after a completed
	// repair, nor anything else.
	if moved, err := s.RecordRepairAck(ctx, dev, "", newPub); err != nil || moved {
		t.Fatalf("an empty nonce matched: moved=%v err=%v", moved, err)
	}

	// The real one.
	moved, err = s.RecordRepairAck(ctx, dev, "nonce-A", newPub)
	if err != nil {
		t.Fatal(err)
	}
	if !moved {
		t.Fatal("the ack for the dispatched repair did not move the controller")
	}
	if got, _ := s.PinnedKey(ctx, dev); got != newPub {
		t.Errorf("pin is %q after a matching ack, want the new key", got)
	}

	// Replaying it must not match again — the pending nonce is consumed.
	if moved, err := s.RecordRepairAck(ctx, dev, "nonce-A", newPub); err != nil || moved {
		t.Errorf("the same ack matched twice: moved=%v err=%v", moved, err)
	}
}

// The check that keeps someone off a ladder.
func TestARotationCannotCompleteWhileAnyControllerStillPinsTheOldKey(t *testing.T) {
	s, ctx, _, ids := rotationFixture(t, 3)
	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, ""); err != nil {
		t.Fatal(err)
	}

	// Repair two of the three.
	for _, id := range ids[:2] {
		if err := s.RecordRepairDispatched(ctx, id, "n-"+id); err != nil {
			t.Fatal(err)
		}
		if moved, err := s.RecordRepairAck(ctx, id, "n-"+id, newPub); err != nil || !moved {
			t.Fatalf("repair ack for %s: moved=%v err=%v", id, moved, err)
		}
	}

	err := s.CompleteKeyRotation(ctx, "rot-1", newPub)
	var incomplete *RotationIncompleteError
	if !errors.As(err, &incomplete) {
		t.Fatalf("CompleteKeyRotation err = %v, want RotationIncompleteError", err)
	}
	if incomplete.Remaining != 1 {
		t.Errorf("Remaining = %d, want 1", incomplete.Remaining)
	}
	if _, err := s.OpenKeyRotation(ctx); err != nil {
		t.Errorf("the rotation was closed despite refusing: %v", err)
	}

	// The last one.
	last := ids[2]
	if err := s.RecordRepairDispatched(ctx, last, "n-last"); err != nil {
		t.Fatal(err)
	}
	if moved, err := s.RecordRepairAck(ctx, last, "n-last", newPub); err != nil || !moved {
		t.Fatal("final repair ack did not land")
	}
	if err := s.CompleteKeyRotation(ctx, "rot-1", newPub); err != nil {
		t.Fatalf("CompleteKeyRotation with every controller repaired: %v", err)
	}
	if _, err := s.OpenKeyRotation(ctx); !errors.Is(err, ErrNoOpenRotation) {
		t.Errorf("a completed rotation still reports as open: %v", err)
	}
}

// A controller paired DURING a rotation pins the new key already — it was
// current when it paired — so it must not hold the rotation open. But a
// controller paired during a rotation with no pin row recorded would read as
// "not the new key" under a naive COUNT and block completion forever.
//
// This is the case that makes the pin row's absence ambiguous, and it is why
// BeginKeyRotation writes a row for every controller that exists at the time:
// after that moment, no row means paired since, which means the new key.
func TestAControllerPairedDuringARotationDoesNotBlockIt(t *testing.T) {
	s, ctx, acct, ids := rotationFixture(t, 1)
	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordRepairDispatched(ctx, ids[0], "n1"); err != nil {
		t.Fatal(err)
	}
	if moved, _ := s.RecordRepairAck(ctx, ids[0], "n1", newPub); !moved {
		t.Fatal("repair ack did not land")
	}

	// A new controller pairs now, pinning the new key.
	locs, err := s.LocationsByAccount(ctx, acct)
	if err != nil || len(locs) == 0 {
		t.Fatalf("locations: %v", err)
	}
	fresh, err := s.CreateDeviceWithClaim(ctx, acct, locs[0].ID, "New gate", "hash-new", now()+3600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE devices SET paired_at = ?, public_key = 'y', status = 'active' WHERE id = ?`,
		now(), fresh.ID); err != nil {
		t.Fatal(err)
	}
	// Pairing records the pin, as the pairing path does in production.
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO device_key_pins (device_id, pinned_pub, updated_at) VALUES (?, ?, ?)`,
		fresh.ID, newPub, now()); err != nil {
		t.Fatal(err)
	}

	if err := s.CompleteKeyRotation(ctx, "rot-1", newPub); err != nil {
		t.Fatalf("CompleteKeyRotation: %v; a controller paired during the rotation "+
			"already pins the new key and must not hold it open", err)
	}
}

// The progress report must show controllers it has not reached, and show them
// first. A report that omitted them would read "all done" precisely when it was
// least true.
func TestDevicePinsShowsUnrepairedControllersFirst(t *testing.T) {
	s, ctx, _, ids := rotationFixture(t, 3)
	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordRepairDispatched(ctx, ids[0], "n0"); err != nil {
		t.Fatal(err)
	}
	if moved, _ := s.RecordRepairAck(ctx, ids[0], "n0", newPub); !moved {
		t.Fatal("ack did not land")
	}
	// One with a repair outstanding, so PendingSince is populated.
	if err := s.RecordRepairDispatched(ctx, ids[1], "n1"); err != nil {
		t.Fatal(err)
	}

	pins, err := s.DevicePins(ctx, newPub)
	if err != nil {
		t.Fatal(err)
	}
	if len(pins) != 3 {
		t.Fatalf("DevicePins returned %d rows, want 3 — a controller missing from this "+
			"report is one nobody knows is stranded", len(pins))
	}
	if pins[0].Repaired || pins[1].Repaired {
		t.Error("repaired controllers sort before unrepaired ones; the ones needing "+
			"attention must come first", pins)
	}
	if !pins[2].Repaired {
		t.Error("the repaired controller is not marked as such")
	}
	var pending int
	for _, p := range pins {
		if p.PendingSince != nil {
			pending++
		}
	}
	if pending != 1 {
		t.Errorf("%d controllers report an outstanding repair, want 1", pending)
	}
}

// A rotation with no controllers at all completes immediately. Worth pinning
// because the check is a COUNT, and a COUNT over an empty set is the one input
// that makes a "refuse while any remain" guard trivially pass — so the guard
// should be seen to pass for the right reason.
func TestARotationWithNoControllersCompletesImmediately(t *testing.T) {
	s, ctx, _, _ := rotationFixture(t, 0)
	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteKeyRotation(ctx, "rot-1", newPub); err != nil {
		t.Fatalf("CompleteKeyRotation on a hub with no controllers: %v", err)
	}
}

// An unpaired or removed controller is not something a rotation waits for.
// Counting one would leave the previous key retained forever, which is the
// mirror-image failure: not a stranded controller, but a key that was supposed
// to be destroyed still sitting on disk.
func TestUnpairedControllersDoNotHoldARotationOpen(t *testing.T) {
	s, ctx, _, ids := rotationFixture(t, 2)
	if _, err := s.BeginKeyRotation(ctx, "rot-1", oldPub, newPub, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordRepairDispatched(ctx, ids[0], "n0"); err != nil {
		t.Fatal(err)
	}
	if moved, _ := s.RecordRepairAck(ctx, ids[0], "n0", newPub); !moved {
		t.Fatal("ack did not land")
	}
	// The second controller is retired rather than repaired.
	if _, err := s.db.ExecContext(ctx,
		`UPDATE devices SET status = 'revoked' WHERE id = ?`, ids[1]); err != nil {
		t.Fatal(err)
	}

	if err := s.CompleteKeyRotation(ctx, "rot-1", newPub); err != nil {
		t.Fatalf("CompleteKeyRotation: %v; a revoked controller is not one the "+
			"rotation is waiting for", err)
	}
}
