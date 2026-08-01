package store

import (
	"context"
	"database/sql"
	"testing"
)

// Operator-armed T4 windows.
//
// Most of these are about a window NOT admitting something. That is the shape
// of the feature: a window is meant to stand between a chat message and a mower
// blade, and every branch that failed open would be silent.
//
// The consume path is not tested here because it is not here — see the note in
// t4window.go about why the atomic claim and its refund were removed before
// commit rather than shipped with no caller.

func t4Env(t *testing.T) (*Store, context.Context, string, string) {
	t.Helper()
	st := openTest(t)
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "op@t4.test", "pw-hash-placeholder", "Operator", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, "T4 Household", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return st, ctx, acct.ID, u.ID
}

func armWindow(t *testing.T, st *Store, ctx context.Context, acct, user string, starts, ends int64, maxUses sql.NullInt64) *T4Window {
	t.Helper()
	w, err := st.ArmT4Window(ctx, T4WindowArgs{
		AccountID: acct, DeviceKey: "mock:mower-1", Verb: "start",
		ArmedByUserID: user, StartsAt: starts, EndsAt: ends, MaxUses: maxUses,
		Notes: "mowing the top field",
	})
	if err != nil {
		t.Fatalf("ArmT4Window: %v", err)
	}
	return w
}

// A window records the exact (device, verb) it was armed for.
//
// Per device AND verb, because §3.2's point is that a mower is not "a T4
// device": it has a T4 `start` and a T1 `stop`, and a window naming only the
// mower would cover more than the operator chose.
func TestAWindowRecordsTheDeviceAndVerbItWasArmedFor(t *testing.T) {
	st, ctx, acct, user := t4Env(t)
	nowTS := int64(1_000_000)
	w := armWindow(t, st, ctx, acct, user, nowTS-60, nowTS+600, sql.NullInt64{})

	if w.DeviceKey != "mock:mower-1" || w.Verb != "start" {
		t.Errorf("armed for %q/%q, want mock:mower-1/start", w.DeviceKey, w.Verb)
	}
	if w.ArmedByUserID != user {
		t.Errorf("armed_by is %q, want the operator who armed it", w.ArmedByUserID)
	}
	if w.UsesCount != 0 || w.Status != "active" {
		t.Errorf("a fresh window is %q with %d uses", w.Status, w.UsesCount)
	}

	// And it is not readable from another account. Scoping is a parameter of
	// the lookup rather than a comparison afterwards, so there is no moment at
	// which another account's window is in the caller's hands.
	if _, err := st.T4WindowByID(ctx, "other-account", w.ID); err == nil {
		t.Error("a window was readable from another account")
	}
}

func TestDisarmingClosesAWindowImmediately(t *testing.T) {
	st, ctx, acct, user := t4Env(t)
	nowTS := int64(6_000_000)
	w := armWindow(t, st, ctx, acct, user, nowTS-1, nowTS+3600, sql.NullInt64{})

	ok, err := st.DisarmT4Window(ctx, acct, w.ID, user)
	if err != nil || !ok {
		t.Fatalf("disarm: %v %v", ok, err)
	}
	got, err := st.T4WindowByID(ctx, acct, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s := got.EffectiveStatus(nowTS); s != "disarmed" {
		t.Errorf("a disarmed window reports %q", s)
	}
	if got.Live(nowTS) {
		t.Error("a disarmed window reports itself live")
	}

	// Idempotent: a second disarm reports false rather than erroring.
	if ok, err := st.DisarmT4Window(ctx, acct, w.ID, user); err != nil || ok {
		t.Errorf("second disarm reported %v %v, want false and no error", ok, err)
	}

	// And it must not be disarmable from another account.
	w2 := armWindow(t, st, ctx, acct, user, nowTS-1, nowTS+3600, sql.NullInt64{})
	if ok, err := st.DisarmT4Window(ctx, "other-account", w2.ID, user); err != nil || ok {
		t.Errorf("a window was disarmed from another account (%v, %v)", ok, err)
	}
	still, err := st.T4WindowByID(ctx, acct, w2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !still.Live(nowTS) {
		t.Error("a cross-account disarm reported failure but closed the window anyway")
	}
}

// Expiry is DERIVED, not stored. Nothing sweeps, so a window that has passed its
// end must read as expired on the strength of the timestamps alone.
//
// This is the property that makes the absence of a sweeper safe: a stored
// 'expired' is a claim someone has to keep true, and a sweeper that stops
// running turns every expired window into a live one.
func TestExpiryIsDerivedRatherThanWrittenBack(t *testing.T) {
	st, ctx, acct, user := t4Env(t)
	starts, ends := int64(7_000_000), int64(7_000_060)
	w := armWindow(t, st, ctx, acct, user, starts, ends, sql.NullInt64{})

	got, err := st.T4WindowByID(ctx, acct, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The stored status never changed...
	if got.Status != "active" {
		t.Fatalf("stored status is %q — something wrote expiry back", got.Status)
	}
	// ...and yet the window is expired.
	if s := got.EffectiveStatus(ends + 1); s != "expired" {
		t.Errorf("EffectiveStatus after the end is %q, want expired", s)
	}
	// The boundaries, at the exact instants. The middle of a window passes
	// under any comparison; an off-by-one in either bound is a window that is
	// live when it should not be.
	if got.Live(starts - 1) {
		t.Error("a window reports itself live before it starts")
	}
	if !got.Live(starts) {
		t.Error("a window is not live at the instant it starts")
	}
	if !got.Live(ends - 1) {
		t.Error("a window is not live at its last instant")
	}
	if got.Live(ends) {
		t.Error("a window is still live at the instant it ends")
	}
}

// The precedence ladder, including the cases where two conditions are true at
// once. A disarmed AND expired window reports disarmed, because that is the
// fact an operator chose and the one they will look for when auditing.
func TestEffectiveStatusPrecedence(t *testing.T) {
	base := func() *T4Window {
		return &T4Window{StartsAt: 100, EndsAt: 200, Status: "active"}
	}
	disarmedAndExpired := base()
	disarmedAndExpired.Status = "disarmed"
	if s := disarmedAndExpired.EffectiveStatus(500); s != "disarmed" {
		t.Errorf("disarmed+expired reports %q, want disarmed", s)
	}

	exhaustedAndExpired := base()
	exhaustedAndExpired.MaxUses = sql.NullInt64{Int64: 1, Valid: true}
	exhaustedAndExpired.UsesCount = 1
	if s := exhaustedAndExpired.EffectiveStatus(500); s != "exhausted" {
		t.Errorf("exhausted+expired reports %q, want exhausted", s)
	}

	if s := base().EffectiveStatus(50); s != "pending" {
		t.Errorf("before start reports %q, want pending", s)
	}
	if s := base().EffectiveStatus(150); s != "active" {
		t.Errorf("inside reports %q, want active", s)
	}
	if s := base().EffectiveStatus(200); s != "expired" {
		t.Errorf("at the end instant reports %q, want expired", s)
	}
}

// Arguments that could only produce a window nobody can use are refused at the
// moment of arming, rather than stored and silently inert.
func TestAWindowThatCouldNeverBeUsedIsRefused(t *testing.T) {
	st, ctx, acct, user := t4Env(t)
	for _, tc := range []struct {
		name string
		args T4WindowArgs
	}{
		{"ends before it starts", T4WindowArgs{AccountID: acct, DeviceKey: "d", Verb: "start",
			ArmedByUserID: user, StartsAt: 200, EndsAt: 100}},
		{"zero length", T4WindowArgs{AccountID: acct, DeviceKey: "d", Verb: "start",
			ArmedByUserID: user, StartsAt: 100, EndsAt: 100}},
		{"a cap of zero uses", T4WindowArgs{AccountID: acct, DeviceKey: "d", Verb: "start",
			ArmedByUserID: user, StartsAt: 100, EndsAt: 200, MaxUses: sql.NullInt64{Int64: 0, Valid: true}}},
		{"no device", T4WindowArgs{AccountID: acct, DeviceKey: "  ", Verb: "start",
			ArmedByUserID: user, StartsAt: 100, EndsAt: 200}},
		{"no verb", T4WindowArgs{AccountID: acct, DeviceKey: "d", Verb: "",
			ArmedByUserID: user, StartsAt: 100, EndsAt: 200}},
	} {
		if _, err := st.ArmT4Window(ctx, tc.args); err == nil {
			t.Errorf("%s: was accepted", tc.name)
		}
	}
}

// The list is for an operator asking "what has been armed here", so it must
// include windows that are no longer live — a forgotten standing window is
// exactly what that page is read to find.
func TestTheListShowsDisarmedAndExpiredWindowsToo(t *testing.T) {
	st, ctx, acct, user := t4Env(t)
	nowTS := int64(8_000_000)
	live := armWindow(t, st, ctx, acct, user, nowTS-1, nowTS+3600, sql.NullInt64{})
	gone := armWindow(t, st, ctx, acct, user, nowTS-3600, nowTS-1800, sql.NullInt64{})
	closed := armWindow(t, st, ctx, acct, user, nowTS-1, nowTS+3600, sql.NullInt64{})
	if _, err := st.DisarmT4Window(ctx, acct, closed.ID, user); err != nil {
		t.Fatal(err)
	}

	list, err := st.T4WindowsByAccount(ctx, acct, 0)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, w := range list {
		seen[w.ID] = w.EffectiveStatus(nowTS)
	}
	for id, want := range map[string]string{
		live.ID: "active", gone.ID: "expired", closed.ID: "disarmed",
	} {
		if got, ok := seen[id]; !ok {
			t.Errorf("window %s is missing from the list", id)
		} else if got != want {
			t.Errorf("window %s listed as %q, want %q", id, got, want)
		}
	}

	// Another account's list must not see them at all.
	other, err := st.T4WindowsByAccount(ctx, "other-account", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Errorf("another account's list returned %d windows", len(other))
	}
}
