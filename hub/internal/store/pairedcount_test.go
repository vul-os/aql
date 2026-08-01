package store

import (
	"context"
	"testing"
)

// AnyDevicePaired decides whether the hub may mint a new signing identity, so
// what counts as "paired" is the whole question.
func TestAnyDevicePairedIsFalseUntilSomethingActuallyPairs(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()

	if got, err := st.AnyDevicePaired(ctx); err != nil || got {
		t.Fatalf("empty hub: %v %v — a first boot must be allowed to mint a key", got, err)
	}

	u, err := st.CreateUser(ctx, "owner@example.test", "x", "Owner", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, "Estate", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Gate", "hash", now()+3600)
	if err != nil {
		t.Fatal(err)
	}

	// An UNPAIRED device is a claim token nobody redeemed. A hub that got this
	// far and lost its key has lost nothing that cannot be re-issued from the
	// console, so it must still be allowed to start.
	if got, err := st.AnyDevicePaired(ctx); err != nil || got {
		t.Fatalf("unpaired device counted as paired: %v %v — that would lock an operator "+
			"out of a hub with nothing at stake", got, err)
	}

	// The REAL pairing path, not an UPDATE this test invented. The first
	// version wrote `status = 'paired'`, a value no production code writes, so
	// the fixture and the query agreed with each other and the guard was inert
	// against an actual hub.
	if _, err := st.RedeemClaim(ctx, "hash", "cGFpcmVkLXB1YmtleS0zMi1ieXRlcy1sb25nISE"); err != nil {
		t.Fatalf("RedeemClaim: %v", err)
	}
	if got, err := st.AnyDevicePaired(ctx); err != nil || !got {
		t.Fatalf("a paired device was not seen: %v %v — the hub would mint a new identity "+
			"and orphan it", got, err)
	}
}
