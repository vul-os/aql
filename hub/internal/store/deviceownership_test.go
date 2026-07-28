package store

// Ownership, held to the one property that makes it worth having.
//
// A claim is an assertion, not an inference — nobody can prove a lamp is
// theirs, they can only say so first. That is exactly the shape of the
// controller's pairing model, and it is safe for the same reason: the first
// assertion is deliberate and recorded, and every later one is refused rather
// than allowed to overwrite it.
//
// If a second account could take over a claimed device, anyone with an account
// on the hub could steal a neighbour's devices one request at a time — which is
// the hole the whole ownership model exists to close. So that refusal is the
// test that matters most here, and it is enforced by the primary key rather
// than by a check-then-insert that two concurrent admins would race through.

import (
	"context"
	"errors"
	"testing"
)

func ownershipFixture(t *testing.T) (*Store, context.Context, string, string, string) {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	ua, err := s.CreateUser(ctx, "a@own.com", "hash", "A", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	ub, err := s.CreateUser(ctx, "b@own.com", "hash", "B", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acctA, _, err := s.CreateAccountWithOwner(ctx, ua.ID, "A home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acctB, _, err := s.CreateAccountWithOwner(ctx, ub.ID, "B home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return s, ctx, acctA.ID, acctB.ID, ua.ID
}

func TestAClaimedDeviceCannotBeTakenOver(t *testing.T) {
	s, ctx, acctA, acctB, userA := ownershipFixture(t)

	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctA, userA, "Kitchen lamp"); err != nil {
		t.Fatalf("first claim: %v", err)
	}

	// The attack: B asserts ownership of a device A already owns.
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctB, "", "Mine now"); !errors.Is(err, ErrDeviceAlreadyClaimed) {
		t.Fatalf("a second account claimed an owned device (err = %v). Anyone with an account "+
			"on this hub could take a neighbour's devices one request at a time.", err)
	}

	// And the claim is untouched — not merely the refusal, but the state
	// afterwards, since a refusal that still wrote the label would let B
	// rename A's devices.
	// Observed through the key sets, because that is what production reads.
	aKeys, err := s.DeviceKeysForAccount(ctx, acctA)
	if err != nil {
		t.Fatal(err)
	}
	bKeys, err := s.DeviceKeysForAccount(ctx, acctB)
	if err != nil {
		t.Fatal(err)
	}
	if !aKeys["mock:lamp-1"] {
		t.Error("the refused claim took the device away from its owner")
	}
	if bKeys["mock:lamp-1"] {
		t.Error("the refused claim gave the device to the claimant anyway")
	}
}

// Re-claiming your own device is not an error. An admin who clicks twice, or a
// client retrying a request whose response it lost, has done nothing wrong.
func TestReclaimingYourOwnDeviceIsIdempotent(t *testing.T) {
	s, ctx, acctA, _, userA := ownershipFixture(t)

	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctA, userA, "Kitchen"); err != nil {
		t.Fatal(err)
	}
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctA, userA, "Kitchen lamp"); err != nil {
		t.Fatalf("re-claiming an own device was refused: %v", err)
	}
	keys, err := s.DeviceKeysForAccount(ctx, acctA)
	if err != nil {
		t.Fatal(err)
	}
	if !keys["mock:lamp-1"] {
		t.Error("re-claiming an own device lost it")
	}
}

func TestReleaseIsScopedToTheOwner(t *testing.T) {
	s, ctx, acctA, acctB, userA := ownershipFixture(t)
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctA, userA, "Kitchen"); err != nil {
		t.Fatal(err)
	}

	// B cannot release A's claim — otherwise takeover is a two-step process
	// rather than an impossible one.
	if err := s.ReleaseDevice(ctx, "mock:lamp-1", acctB); !errors.Is(err, ErrDeviceNotClaimed) {
		t.Fatalf("another account released a device it does not own (err = %v)", err)
	}
	if keys, _ := s.DeviceKeysForAccount(ctx, acctA); !keys["mock:lamp-1"] {
		t.Fatal("the device lost its owner anyway")
	}

	// The owner can, and then the device is claimable again — that is how a
	// device legitimately changes hands.
	if err := s.ReleaseDevice(ctx, "mock:lamp-1", acctA); err != nil {
		t.Fatalf("the owner could not release: %v", err)
	}
	if keys, _ := s.DeviceKeysForAccount(ctx, acctA); keys["mock:lamp-1"] {
		t.Error("released device still belongs to its old owner")
	}
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctB, "", "Now B's"); err != nil {
		t.Errorf("a released device could not be claimed by anyone else: %v", err)
	}
}

// The three states a caller must be able to tell apart: yours, someone else's,
// and nobody's. Collapsing any two of them produces a wrong screen — an
// unclaimed device shown as forbidden, or another account's shown as claimable.
func TestOwnershipDistinguishesYoursTheirsAndUnclaimed(t *testing.T) {
	s, ctx, acctA, acctB, userA := ownershipFixture(t)
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctA, userA, "Kitchen"); err != nil {
		t.Fatal(err)
	}
	if err := s.ClaimDevice(ctx, "mock:cam-1", acctB, "", "Gate cam"); err != nil {
		t.Fatal(err)
	}

	mine, err := s.DeviceKeysForAccount(ctx, acctA)
	if err != nil {
		t.Fatal(err)
	}
	if !mine["mock:lamp-1"] {
		t.Error("A's own device is missing from its key set")
	}
	if mine["mock:cam-1"] {
		t.Error("B's device appears in A's key set — this set is what scopes the fleet A sees")
	}
	if mine["mock:mower-1"] {
		t.Error("an unclaimed device appears as owned")
	}

	all, err := s.ClaimedDeviceKeys(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Used to decide what may be offered for claiming. It must know that B's
	// camera is spoken for without revealing that it is B's.
	if !all["mock:lamp-1"] || !all["mock:cam-1"] {
		t.Error("the claimed-key set is missing a claim")
	}
	if all["mock:mower-1"] {
		t.Error("an unclaimed device is listed as claimed, so nobody could ever claim it")
	}
}

// A deleted account must not leave its devices permanently unclaimable.
func TestDeletingAnAccountFreesItsDevices(t *testing.T) {
	s, ctx, acctA, acctB, userA := ownershipFixture(t)
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctA, userA, "Kitchen"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM accounts WHERE id = ?`, acctA); err != nil {
		t.Fatal(err)
	}

	// ON DELETE CASCADE. Without it the row would survive pointing at an
	// account that no longer exists, and the device would be owned by nobody
	// and claimable by nobody — invisible forever with no way to recover it
	// short of editing the database.
	if all, _ := s.ClaimedDeviceKeys(ctx); all["mock:lamp-1"] {
		t.Fatal("the claim outlived its account; that device is now unclaimable")
	}
	if err := s.ClaimDevice(ctx, "mock:lamp-1", acctB, "", "Recovered"); err != nil {
		t.Errorf("the orphaned device could not be re-claimed: %v", err)
	}
}
