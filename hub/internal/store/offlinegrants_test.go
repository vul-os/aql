package store

import (
	"context"
	"errors"
	"testing"
)

// ogStore opens a store with a real holder and a real admin.
//
// Real users, not string literals: member_user_id and revoked_by are foreign
// keys, and a fixture that dodged them would leave the ON DELETE SET NULL
// behaviour — the thing that makes a grant outlive its holder's account —
// untested and unexercised.
func ogStore(t *testing.T) (*Store, context.Context, string, string) {
	t.Helper()
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()
	holder, err := st.CreateUser(ctx, "holder@example.test", "x", "Holder", "ZA")
	if err != nil {
		t.Fatalf("CreateUser holder: %v", err)
	}
	admin, err := st.CreateUser(ctx, "admin@example.test", "x", "Admin", "ZA")
	if err != nil {
		t.Fatalf("CreateUser admin: %v", err)
	}
	return st, ctx, holder.ID, admin.ID
}

// realDevice creates a device row, because controller_revocation_reports keys
// on one. offline_grant_devices does NOT — a grant can name a controller this
// hub has never met — so the other tests here pass bare strings deliberately.
func realDevice(t *testing.T, s *Store, ctx context.Context, label string) string {
	t.Helper()
	u, err := s.CreateUser(ctx, label+"-owner@example.test", "x", "Owner", "ZA")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	acct, loc, err := s.CreateAccountWithOwner(ctx, u.ID, label+" Estate", "ZA")
	if err != nil {
		t.Fatalf("CreateAccountWithOwner: %v", err)
	}
	dev, err := s.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, label, "hash-"+label, 0)
	if err != nil {
		t.Fatalf("CreateDeviceWithClaim: %v", err)
	}
	return dev.ID
}

func record(t *testing.T, s *Store, ctx context.Context, holder, id string, exp int64, devices ...string) {
	t.Helper()
	if err := s.RecordOfflineGrant(ctx, OfflineGrant{
		GrantID: id, MemberUserID: holder, IssuedAt: 1000, ExpiresAt: exp, Devices: devices,
	}); err != nil {
		t.Fatalf("RecordOfflineGrant %s: %v", id, err)
	}
}

// The deny-list is what a controller consults, so what goes ON it is the whole
// point: revoked, not yet expired, and naming this controller.
func TestTheDenyListHoldsOnlyRevokedUnexpiredGrantsForThatController(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)

	record(t, s, ctx, holder, "active", 9000, "ctl-a")        // not revoked
	record(t, s, ctx, holder, "revoked-live", 9000, "ctl-a")  // the one that belongs
	record(t, s, ctx, holder, "revoked-stale", 500, "ctl-a")  // revoked but expired
	record(t, s, ctx, holder, "revoked-other", 9000, "ctl-b") // revoked, different gate

	for _, id := range []string{"revoked-live", "revoked-stale", "revoked-other"} {
		if _, err := s.RevokeOfflineGrant(ctx, id, admin); err != nil {
			t.Fatalf("revoke %s: %v", id, err)
		}
	}

	list, err := s.DenyListForDevice(ctx, "ctl-a", 1000)
	if err != nil {
		t.Fatalf("DenyListForDevice: %v", err)
	}
	if len(list) != 1 || list[0].GrantID != "revoked-live" {
		t.Fatalf("deny-list = %+v, want only revoked-live:\n"+
			"  an active grant on it would lock out a legitimate member;\n"+
			"  an expired one is dead weight the validity step already denies;\n"+
			"  another controller's grant tells this gate about doors it does not serve", list)
	}
	if list[0].EXP != 9000 {
		t.Errorf("entry exp = %d, want 9000 — without it the entry can never be pruned", list[0].EXP)
	}
}

// A grant naming two controllers appears on both lists. This is the case that a
// per-account scoping would get wrong, since the two gates may be in different
// accounts.
func TestAGrantNamingTwoControllersIsOnBothDenyLists(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	record(t, s, ctx, holder, "shared", 9000, "ctl-a", "ctl-b")
	if _, err := s.RevokeOfflineGrant(ctx, "shared", admin); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	for _, dev := range []string{"ctl-a", "ctl-b"} {
		list, err := s.DenyListForDevice(ctx, dev, 1000)
		if err != nil {
			t.Fatalf("%s: %v", dev, err)
		}
		if len(list) != 1 {
			t.Errorf("%s deny-list = %+v, want the shared grant", dev, list)
		}
	}
}

// §3.5's counter. Revoking must advance it, or the list the hub builds is one
// the controller refuses as stale — the revocation would be invisible to the
// only thing that enforces it.
func TestRevokingAdvancesTheSequence(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	start, err := s.RevocationSeq(ctx)
	if err != nil {
		t.Fatalf("RevocationSeq: %v", err)
	}
	if start != 0 {
		t.Fatalf("initial seq = %d, want 0 — the controller treats 0 as 'never received a list'", start)
	}
	record(t, s, ctx, holder, "g1", 9000, "ctl-a")
	record(t, s, ctx, holder, "g2", 9000, "ctl-a")

	first, err := s.RevokeOfflineGrant(ctx, "g1", admin)
	if err != nil {
		t.Fatalf("revoke g1: %v", err)
	}
	second, err := s.RevokeOfflineGrant(ctx, "g2", admin)
	if err != nil {
		t.Fatalf("revoke g2: %v", err)
	}
	if first <= start || second <= first {
		t.Fatalf("seq did not advance: start=%d first=%d second=%d", start, first, second)
	}
	if got, _ := s.RevocationSeq(ctx); got != second {
		t.Errorf("RevocationSeq = %d, want %d — a plain read must not advance it", got, second)
	}
}

// Revoking twice is not two revocations. Bumping the counter on a no-op would
// let a repeated click walk the sequence forward, forcing controllers to accept
// and re-store a list that says nothing new.
func TestRevokingTwiceIsRefusedAndDoesNotAdvanceTheSequence(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	record(t, s, ctx, holder, "g1", 9000, "ctl-a")
	seq, err := s.RevokeOfflineGrant(ctx, "g1", admin)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := s.RevokeOfflineGrant(ctx, "g1", admin); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second revoke returned %v, want ErrNotFound", err)
	}
	if got, _ := s.RevocationSeq(ctx); got != seq {
		t.Errorf("seq moved on a repeated revoke: %d -> %d", seq, got)
	}
}

// A revocation that cannot be recorded must not advance the counter either —
// the two are one fact and are written in one transaction.
func TestRevokingAGrantTheHubNeverIssuedChangesNothing(t *testing.T) {
	s, ctx, _, admin := ogStore(t)
	before, _ := s.RevocationSeq(ctx)
	if _, err := s.RevokeOfflineGrant(ctx, "never-issued", admin); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	if after, _ := s.RevocationSeq(ctx); after != before {
		t.Errorf("seq advanced for a grant that does not exist: %d -> %d", before, after)
	}
}

// A grant outlives its holder's user row.
//
// This is what the FK/snapshot split is for, and the only way to see it is to
// actually delete the user. ON DELETE SET NULL nulls the pointer; the snapshot
// keeps the id, so an operator asking "what did they hold" still gets an answer
// after the account was tidied up — and a revoked grant stays revocable, which
// matters because deleting an account does NOT reach an issued grant.
func TestAGrantOutlivesItsHoldersUserRow(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	record(t, s, ctx, holder, "g1", 9000, "ctl-a")
	if _, err := s.RevokeOfflineGrant(ctx, "g1", admin); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	got, err := s.OfflineGrantsForMember(ctx, holder)
	if err != nil {
		t.Fatalf("OfflineGrantsForMember: %v", err)
	}
	if len(got) != 1 || !got[0].MemberLinked {
		t.Fatalf("before deletion: %+v, want one linked grant", got)
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, holder); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	got, err = s.OfflineGrantsForMember(ctx, holder)
	if err != nil {
		t.Fatalf("after deletion: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("the grant vanished with the user row: %+v — the record of what "+
			"someone held is what makes it revocable", got)
	}
	if got[0].MemberLinked {
		t.Error("MemberLinked still true after the user row was deleted")
	}
	if got[0].MemberUserID != holder {
		t.Errorf("MemberUserID = %q, want %q from the snapshot", got[0].MemberUserID, holder)
	}
	if !got[0].Revoked() {
		t.Error("the revocation did not survive the user deletion")
	}
	// And it is still on the controller's deny-list, which is the half that
	// actually keeps the gate shut.
	list, err := s.DenyListForDevice(ctx, "ctl-a", 1000)
	if err != nil {
		t.Fatalf("DenyListForDevice: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("deny-list after user deletion = %+v, want the revoked grant", list)
	}
}

func TestAnEmptyDenyListIsEmptyNotNil(t *testing.T) {
	s, ctx, _, _ := ogStore(t)
	list, err := s.DenyListForDevice(ctx, "ctl-a", 1000)
	if err != nil {
		t.Fatalf("DenyListForDevice: %v", err)
	}
	// A nil slice marshals to `null` and an empty one to `[]`. The command
	// payload's `entries` must be an array: the controller refuses the whole
	// command when it is not, so a hub with nothing revoked would fail every
	// delivery.
	if list == nil {
		t.Fatal("empty deny-list is nil, which marshals to null and the controller refuses")
	}
	if len(list) != 0 {
		t.Fatalf("deny-list = %+v", list)
	}
}

// Convergence: which of a grant's gates are actually refusing it.
//
// The comparison is against the sequence THIS grant was revoked at, not the
// hub's current counter, and these pin the difference — which is the whole
// reason migration 0032 exists.
func TestAGateAheadOfThisRevocationIsEnforcingItEvenWhileBehindOverall(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	dev := realDevice(t, s, ctx, "gate-a")
	record(t, s, ctx, holder, "g1", 9000, dev)

	seqAt, err := s.RevokeOfflineGrant(ctx, "g1", admin)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	// The hub moves on: two more revocations of other grants.
	record(t, s, ctx, holder, "g2", 9000, dev)
	record(t, s, ctx, holder, "g3", 9000, dev)
	if _, err := s.RevokeOfflineGrant(ctx, "g2", admin); err != nil {
		t.Fatalf("revoke g2: %v", err)
	}
	if _, err := s.RevokeOfflineGrant(ctx, "g3", admin); err != nil {
		t.Fatalf("revoke g3: %v", err)
	}
	hubSeq, _ := s.RevocationSeq(ctx)
	if hubSeq <= seqAt {
		t.Fatalf("fixture did not advance the hub past the grant: %d vs %d", hubSeq, seqAt)
	}

	// The gate holds the list this grant joined at, and nothing newer.
	if err := s.SaveRevocationReport(ctx, dev, seqAt, 1, 1000); err != nil {
		t.Fatalf("SaveRevocationReport: %v", err)
	}

	gates, ok, err := s.RevocationConvergence(ctx, "g1")
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if len(gates) != 1 {
		t.Fatalf("gates = %+v, want one", gates)
	}
	if !gates[0].Enforcing {
		t.Errorf("a gate on list %d, for a grant revoked at %d, reads as not enforcing it — "+
			"comparing against the hub's current %d instead would send an operator to latch "+
			"lockdown on a gate already refusing this grant", gates[0].Seq, seqAt, hubSeq)
	}
}

func TestAGateBehindThisRevocationIsNotEnforcingIt(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	dev := realDevice(t, s, ctx, "gate-a")
	record(t, s, ctx, holder, "g1", 9000, dev)
	seqAt, err := s.RevokeOfflineGrant(ctx, "g1", admin)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := s.SaveRevocationReport(ctx, dev, seqAt-1, 0, 1000); err != nil {
		t.Fatalf("SaveRevocationReport: %v", err)
	}
	gates, _, err := s.RevocationConvergence(ctx, "g1")
	if err != nil {
		t.Fatalf("RevocationConvergence: %v", err)
	}
	if len(gates) != 1 || gates[0].Enforcing {
		t.Errorf("gates = %+v, want the gate NOT enforcing", gates)
	}
	if !gates[0].Reported {
		t.Error("a gate that reported reads as not having reported")
	}
}

// Silence is its own answer and must not read as "not enforcing": one is
// unknown, the other is known-bad, and only the second is a fact.
func TestAGateThatHasReportedNothingIsMarkedUnreported(t *testing.T) {
	s, ctx, holder, admin := ogStore(t)
	dev := realDevice(t, s, ctx, "gate-a")
	record(t, s, ctx, holder, "g1", 9000, dev)
	if _, err := s.RevokeOfflineGrant(ctx, "g1", admin); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	gates, _, err := s.RevocationConvergence(ctx, "g1")
	if err != nil {
		t.Fatalf("RevocationConvergence: %v", err)
	}
	if len(gates) != 1 {
		t.Fatalf("gates = %+v", gates)
	}
	if gates[0].Reported {
		t.Error("a gate that has never reported reads as having reported")
	}
	if gates[0].Enforcing {
		t.Error("a gate that has never reported reads as enforcing — nothing confirms that")
	}
}

// An active grant has no revocation sequence, because there is no sequence at
// which something that has not happened happened.
func TestAnUnrevokedGrantHasNoConvergenceToReport(t *testing.T) {
	s, ctx, holder, _ := ogStore(t)
	dev := realDevice(t, s, ctx, "gate-a")
	record(t, s, ctx, holder, "g1", 9000, dev)
	_, ok, err := s.RevocationConvergence(ctx, "g1")
	if err != nil {
		t.Fatalf("RevocationConvergence: %v", err)
	}
	if ok {
		t.Error("an active grant reported a revocation sequence")
	}
}
