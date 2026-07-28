package store

// Offboarding, held to the claim that makes it worth having.
//
// RemoveAccountMember writes one column. Everything it is supposed to
// accomplish happens elsewhere — in the console's membership gate, in the API
// token authenticator, in the chat lookups — and each of those is a separate
// query that merely HAPPENS to filter on `status = 'active'` today. Any one of
// them dropping the clause turns removal into a roster cosmetic: the person is
// gone from the members list and their phone still opens the gate.
//
// So these tests do not assert on the column. They take the three doors a
// removed member could still walk through, prove each one is open while the
// membership is live, and prove the same call is refused afterwards.

import (
	"context"
	"errors"
	"testing"
)

type offboardFixture struct {
	st       *Store
	ctx      context.Context
	acct     string
	locID    string
	apID     string
	owner    string
	resident string
	phone    string
}

// addMember goes through the real invite → accept path rather than inserting a
// row, so the fixture builds the same shape production does — including the
// location_members rows accept creates, which removal has to clean up.
func addMember(t *testing.T, st *Store, ctx context.Context, acct, username, role string) string {
	t.Helper()
	u, err := st.CreateUser(ctx, username, "hash", "Member", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	tokenHash := "hash-" + username
	if _, err := st.CreateInvite(ctx, acct, username, role, "", tokenHash, now()+3600); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AcceptInvite(ctx, tokenHash, u.ID, ""); err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func newOffboardFixture(t *testing.T) offboardFixture {
	t.Helper()
	st := openTest(t)
	ctx := context.Background()

	owner, err := st.CreateUser(ctx, "owner@x.com", "hash", "Owner", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, owner.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	ap, err := st.CreateAccessPointFull(ctx, acct.ID, loc.ID, "Front gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	resident := addMember(t, st, ctx, acct.ID, "resident@x.com", "member")
	phone := "+27820000001"
	if err := st.AddVerifiedPhone(ctx, resident, phone); err != nil {
		t.Fatal(err)
	}

	return offboardFixture{st: st, ctx: ctx, acct: acct.ID, locID: loc.ID,
		apID: ap.ID, owner: owner.ID, resident: resident, phone: phone}
}

func (f offboardFixture) chatCanOpen(t *testing.T) bool {
	t.Helper()
	aps, err := f.st.AvailableAccessPointsByPhone(f.ctx, f.phone, now())
	if err != nil {
		t.Fatal(err)
	}
	for _, ap := range aps {
		if ap.APID == f.apID {
			return true
		}
	}
	return false
}

func (f offboardFixture) locationRows(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.st.db.QueryRowContext(f.ctx,
		`SELECT count(*) FROM location_members WHERE user_id = ? AND location_id = ?`,
		f.resident, f.locID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// The whole point, in one test: every door a removed member could use.
func TestRemovingAMemberClosesTheConsoleTheTokenAndTheGate(t *testing.T) {
	f := newOffboardFixture(t)
	mkStoreToken(t, f.st, f.ctx, f.acct, f.resident, "sel-resident", nil, APITokenScope("access:open"))

	// Every door open while the membership is live. Without this half, a
	// removal test would pass against a fixture that never granted anything.
	if _, err := f.st.MemberRole(f.ctx, f.acct, f.resident); err != nil {
		t.Fatalf("fixture: resident is not a member: %v", err)
	}
	if !f.chatCanOpen(t) {
		t.Fatal("fixture: the resident's phone cannot open the gate before removal")
	}
	if _, err := f.st.AuthenticateAPIToken(f.ctx, "sel-resident", alwaysVerify, now()); err != nil {
		t.Fatalf("fixture: the resident's token does not work before removal: %v", err)
	}
	if f.locationRows(t) != 1 {
		t.Fatal("fixture: invite-accept did not create a location_members row")
	}

	role, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.resident, "owner")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if role != "member" {
		t.Errorf("returned role = %q, want member — the audit record names the wrong role", role)
	}

	// 1. The console.
	if _, err := f.st.MemberRole(f.ctx, f.acct, f.resident); !errors.Is(err, ErrNotFound) {
		t.Errorf("MemberRole still resolves after removal (err = %v); every account-scoped "+
			"handler gates on this, so the whole console stays open to them", err)
	}

	// 2. Chat — the one that opens a physical gate. A removed resident whose
	//    phone still works is the failure this feature exists to prevent.
	if f.chatCanOpen(t) {
		t.Error("the removed member's phone can still open the gate over chat. " +
			"Their access was revoked in the console and not in the world.")
	}

	// 3. API tokens. These outlive a session by design, so if they did not
	//    re-check membership the removal would be undone by any long-lived
	//    token the member had already minted.
	if _, err := f.st.AuthenticateAPIToken(f.ctx, "sel-resident", alwaysVerify, now()); !errors.Is(err, ErrAPITokenUnusable) {
		t.Errorf("the removed member's API token still authenticates (err = %v)", err)
	}

	// 4. Location grants, which have no status column and so must be deleted.
	if n := f.locationRows(t); n != 0 {
		t.Errorf("%d location_members row(s) survive the removal; whoever adds the first "+
			"location-level check would silently re-grant them", n)
	}

	// The row itself stays, so the roster can show what happened and a
	// re-invite can reactivate it.
	members, err := f.st.MemberList(f.ctx, f.acct)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, m := range members {
		if m.UserID == f.resident {
			found = true
			if m.Status == "active" {
				t.Error("the roster still reports the removed member as active")
			}
		}
	}
	if !found {
		t.Error("the removed member vanished from the roster; the membership is a soft " +
			"revocation precisely so the account keeps a record that they were here")
	}
}

// What removal does NOT close, asserted so the docs stay honest.
//
// A grant is consumed by matching the VISITOR's phone against an access point.
// Nothing in that path looks at who issued it, so a grant outlives its issuer's
// membership. That is the intended behaviour — a departing concierge's visitor
// should not be locked out mid-visit — but it means offboarding alone can leave
// doors open, and an operator who is not told will not think to look.
//
// So the roster carries the count. If this test ever fails because grants DID
// die with the membership, the surfacing is no longer needed and the docs page
// on revoking access is wrong; if it fails because the count went to zero, the
// operator lost their only warning.
func TestGrantsOutliveTheirIssuerAndTheRosterSaysSo(t *testing.T) {
	f := newOffboardFixture(t)
	visitor := "+27829999999"

	if _, err := f.st.CreateGrant(f.ctx, f.acct, CreateGrantArgs{
		GrantedByUserID: f.resident, PhoneE164: visitor, VisitorName: "Plumber",
		StartsAt: now() - 60, EndsAt: now() + 3600, AccessPointIDs: []string{f.apID},
	}); err != nil {
		t.Fatal(err)
	}

	before, err := f.st.MemberList(f.ctx, f.acct)
	if err != nil {
		t.Fatal(err)
	}
	var counted int
	for _, m := range before {
		if m.UserID == f.resident {
			counted = m.ActiveGrantsIssued
		}
	}
	if counted != 1 {
		t.Fatalf("roster reports %d active grants issued by the resident, want 1 — the "+
			"operator would be told there is nothing to clean up", counted)
	}

	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.resident, "owner"); err != nil {
		t.Fatal(err)
	}

	// The resident's own phone is done.
	if f.chatCanOpen(t) {
		t.Fatal("the removed member still has access")
	}
	// The visitor they let in is not, and that is on purpose.
	id, err := f.st.TryConsumeGrant(f.ctx, visitor, f.apID, now())
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Error("a grant stopped working when its issuer was removed. That may be the " +
			"better policy, but the docs page on revoking access says the opposite and " +
			"the roster's warning count is now pointless — change both in the same commit.")
	}
}

// Re-inviting reactivates rather than duplicating — the reason removal is a
// status flip and not a delete.
func TestARemovedMemberCanBeInvitedBack(t *testing.T) {
	f := newOffboardFixture(t)
	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.resident, "owner"); err != nil {
		t.Fatal(err)
	}

	tokenHash := "hash-again"
	if _, err := f.st.CreateInvite(f.ctx, f.acct, "resident@x.com", "member", "", tokenHash, now()+3600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.st.AcceptInvite(f.ctx, tokenHash, f.resident, ""); err != nil {
		t.Fatalf("a removed member could not be invited back: %v", err)
	}
	if _, err := f.st.MemberRole(f.ctx, f.acct, f.resident); err != nil {
		t.Errorf("re-accepted invite did not restore membership: %v", err)
	}
	if !f.chatCanOpen(t) {
		t.Error("re-invited member's phone does not open the gate; the reactivation is partial")
	}
	if f.locationRows(t) != 1 {
		t.Error("re-invited member did not get their location_members row back")
	}
}

// An account with no active owner cannot be administered by anyone, and there
// is no route in the product to give it one. The refusal is the only thing
// standing between a mis-click and an account nobody can ever change again.
func TestTheLastOwnerCannotBeRemoved(t *testing.T) {
	f := newOffboardFixture(t)

	_, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.owner, "owner")
	if !errors.Is(err, ErrLastOwner) {
		t.Fatalf("removing the only owner returned %v, want ErrLastOwner", err)
	}
	if _, err := f.st.MemberRole(f.ctx, f.acct, f.owner); err != nil {
		t.Errorf("the refused removal still revoked the owner: %v", err)
	}

	// With a second owner the same call must succeed — otherwise the guard is
	// "owners can never be removed", which is a different and wrong rule.
	second := addMember(t, f.st, f.ctx, f.acct, "owner2@x.com", "owner")
	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.owner, "owner"); err != nil {
		t.Fatalf("removing one of two owners was refused: %v", err)
	}
	// And now THAT owner is the last one.
	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, second, "owner"); !errors.Is(err, ErrLastOwner) {
		t.Errorf("the remaining sole owner was removable (err = %v); the count is being "+
			"read from a stale snapshot rather than live rows", err)
	}
}

// Admins hold every other power in the account. If they could evict owners,
// "admin" and "owner" would be the same role after one removal.
func TestAnAdminCannotRemoveAnOwner(t *testing.T) {
	f := newOffboardFixture(t)
	// A second owner, so a refusal here cannot be ErrLastOwner wearing a
	// different name.
	second := addMember(t, f.st, f.ctx, f.acct, "owner2@x.com", "owner")

	_, err := f.st.RemoveAccountMember(f.ctx, f.acct, second, "admin")
	if !errors.Is(err, ErrOwnerRemovalRequiresOwner) {
		t.Fatalf("an admin removing an owner returned %v, want ErrOwnerRemovalRequiresOwner", err)
	}
	if _, err := f.st.MemberRole(f.ctx, f.acct, second); err != nil {
		t.Errorf("the refused removal went through anyway: %v", err)
	}

	// The same admin may remove a plain member — the rule is about owners, not
	// about admins being powerless.
	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.resident, "admin"); err != nil {
		t.Errorf("an admin could not remove a plain member: %v", err)
	}
}

func TestRemovingANonMemberIsNotFound(t *testing.T) {
	f := newOffboardFixture(t)

	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, "no-such-user", "owner"); !errors.Is(err, ErrNotFound) {
		t.Errorf("removing an unknown user returned %v, want ErrNotFound", err)
	}

	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.resident, "owner"); err != nil {
		t.Fatal(err)
	}
	// Twice must not look like success, or a caller retrying a failed request
	// would get a fresh audit entry for a removal that already happened.
	if _, err := f.st.RemoveAccountMember(f.ctx, f.acct, f.resident, "owner"); !errors.Is(err, ErrNotFound) {
		t.Errorf("removing an already-removed member returned %v, want ErrNotFound", err)
	}
}

// Tenancy: a member of one account must not be removable through another.
func TestRemovalIsScopedToItsAccount(t *testing.T) {
	f := newOffboardFixture(t)
	other, err := f.st.CreateUser(f.ctx, "other@x.com", "hash", "Other", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	otherAcct, _, err := f.st.CreateAccountWithOwner(f.ctx, other.ID, "Other home", "ZA")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := f.st.RemoveAccountMember(f.ctx, otherAcct.ID, f.resident, "owner"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a foreign account removed our member (err = %v)", err)
	}
	if _, err := f.st.MemberRole(f.ctx, f.acct, f.resident); err != nil {
		t.Errorf("the resident lost access to their own account: %v", err)
	}
}
