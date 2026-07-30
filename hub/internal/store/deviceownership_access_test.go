package store

// Who a GATE belongs to, which is a different question from who CLAIMED a
// device — and the difference is the whole reason this file exists.
//
// Ordinary engine devices are claimed: an admin performs a deliberate act and a
// device_ownership row records it. Access points never are, and never will be:
// a gate is already owned through its location's account, and claiming it would
// be a second answer to a question that already has one.
//
// That left every gate reading as UNCLAIMED to anything asking
// DeviceOwnerAccount — and the two consumers of ownership disagree about what
// unclaimed means, in the least helpful possible way. The engine's HTTP scope
// DENIES an unclaimed device, so a member could not see their own gate. The
// automations engine PERMITS one, so a rule could name another account's gate.
// Same state, opposite defaults, held permanently by every access point the
// moment the access driver was switched on.

import (
	"context"
	"testing"
)

func TestAGateResolvesToItsLocationsAccountWithoutBeingClaimed(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	acctA, acctB, locA, _ := twoTenants(t, s)

	ap, err := s.CreateAccessPointFull(ctx, acctA.ID, locA.ID, "Main Gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	key := AccessDeviceKeyPrefix + ap.ID

	// Nothing claimed it, and nothing ever will.
	if _, err := s.DeviceOwnerAccount(ctx, key); err == nil {
		t.Fatal("fixture is wrong: a gate should have no device_ownership row")
	}

	owner, known, err := s.AccountForDeviceKey(ctx, key)
	if err != nil {
		t.Fatalf("AccountForDeviceKey: %v", err)
	}
	if !known {
		t.Fatal(`a gate reports as belonging to nobody.

That single fact means opposite things to the two consumers of ownership: the
engine's HTTP scope hides the gate from its own account's members, and the
automations engine treats it as fair game for any account's rules.`)
	}
	if owner != acctA.ID {
		t.Errorf("gate owner = %q, want account A (%q)", owner, acctA.ID)
	}
	if owner == acctB.ID {
		t.Error("a gate resolved to the wrong account entirely")
	}
}

// An unknown access point is not an error and not owned. A rule naming one is
// refused by the caller; a lookup failure here would turn a typo into a 500.
func TestAnUnknownGateIsUnownedRatherThanAnError(t *testing.T) {
	s := openTest(t)
	owner, known, err := s.AccountForDeviceKey(context.Background(),
		AccessDeviceKeyPrefix+"no-such-access-point")
	if err != nil {
		t.Fatalf("AccountForDeviceKey on an unknown gate errored: %v", err)
	}
	if known || owner != "" {
		t.Errorf("an unknown gate reported an owner: %q known=%v", owner, known)
	}
}

// The non-access path must be unchanged: an ordinary device is owned only once
// somebody claims it, and this resolver must not have quietly widened that.
func TestAnOrdinaryDeviceStillNeedsAClaim(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	acctA, _, _, _ := twoTenants(t, s)

	owner, known, err := s.AccountForDeviceKey(ctx, "mqtt:lamp-1")
	if err != nil {
		t.Fatal(err)
	}
	if known {
		t.Errorf("an unclaimed ordinary device reported owner %q; claiming is a deliberate "+
			"act and this resolver must not invent one", owner)
	}

	if err := s.ClaimDevice(ctx, "mqtt:lamp-1", acctA.ID, "", "lamp"); err != nil {
		t.Fatal(err)
	}
	owner, known, err = s.AccountForDeviceKey(ctx, "mqtt:lamp-1")
	if err != nil {
		t.Fatal(err)
	}
	if !known || owner != acctA.ID {
		t.Errorf("a claimed device resolved to %q known=%v, want account A", owner, known)
	}
}
