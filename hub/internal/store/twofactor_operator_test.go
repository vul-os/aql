package store

// The escape hatch, and the two things that make it defensible.
//
// DisableTOTPByOperator ends a second factor without proving anything. That is
// only acceptable because of what surrounds it: it cannot be reached over the
// network, and it cannot happen without a record. Both of those are properties
// of the code around the function rather than of the function itself, which is
// why they are tested here rather than assumed.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func lockedOutUser(t *testing.T) (*Store, context.Context, string, string) {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "locked@x.com", "hash", "Locked", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	f, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ActivateTOTP(ctx, f.ID, u.ID, 100, mkSeeds(10)); err != nil {
		t.Fatal(err)
	}
	return s, ctx, u.ID, f.ID
}

func liveFactorCount(t *testing.T, s *Store, ctx context.Context, userID string) int {
	t.Helper()
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM user_totp
		 WHERE user_id = ? AND activated_at IS NOT NULL AND disabled_at IS NULL`,
		userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestOperatorDisableEndsTheFactorAndRecordsIt(t *testing.T) {
	s, ctx, userID, factorID := lockedOutUser(t)

	// The user is genuinely gated before the disable — without this the test
	// would pass against a fixture that never had 2FA on.
	if st, err := s.TOTPStatus(ctx, userID); err != nil || !st.Active {
		t.Fatalf("fixture: 2FA is not on (%+v, %v)", st, err)
	}

	res, err := s.DisableTOTPByOperator(ctx, userID, "phone lost, confirmed by video call")
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if res.FactorID != factorID || res.Username != "locked@x.com" {
		t.Errorf("result names the wrong factor or user: %+v", res)
	}
	if res.RecoveryCodesOutstanding != 10 {
		t.Errorf("outstanding recovery codes = %d, want 10 — an operator relies on this "+
			"number to know whether the lockout story holds together", res.RecoveryCodesOutstanding)
	}

	if st, err := s.TOTPStatus(ctx, userID); err != nil || st.Active {
		t.Errorf("2FA is still on after the disable (%+v, %v)", st, err)
	}
	if n := liveFactorCount(t, s, ctx, userID); n != 0 {
		t.Errorf("%d live factor(s) survive the disable", n)
	}

	// The record. This is the only trace the act leaves — the account simply
	// looks like one without 2FA afterwards.
	entries, _, err := s.AdminAuditActions(ctx, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, e := range entries {
		if e.Action == "totp_disable_by_operator" {
			found = true
			if !strings.Contains(string(e.Detail), "video call") {
				t.Errorf("the operator's reason is not in the audit detail: %s", e.Detail)
			}
		}
	}
	if !found {
		t.Error("no totp_disable_by_operator entry — the act left no trace at all")
	}
}

// The atomicity claim, tested by breaking the audit write.
//
// If the disable could commit while its audit entry failed, the result is an
// account whose second factor is off with nothing saying who did it — which is
// precisely the state this subcommand exists to avoid producing.
func TestADisableThatCannotBeAuditedDoesNotHappen(t *testing.T) {
	s, ctx, userID, _ := lockedOutUser(t)

	// Break the audit table the way a real failure would present: the insert
	// errors inside the transaction.
	if _, err := s.db.ExecContext(ctx, `DROP TABLE admin_audit_log`); err != nil {
		t.Fatal(err)
	}

	if _, err := s.DisableTOTPByOperator(ctx, userID, "should not survive"); err == nil {
		t.Fatal("the disable reported success with no way to record it")
	}
	if n := liveFactorCount(t, s, ctx, userID); n != 1 {
		t.Error("the factor was disabled even though the audit write failed. " +
			"A second factor is now off and nothing in the database says why or by whom.")
	}
}

func TestOperatorDisableRefusesWhatIsNotALockout(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()

	// Unknown user: a mistyped id must not read as "nothing to do".
	if _, err := s.DisableTOTPByOperator(ctx, "no-such-user", "typo"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown user returned %v, want ErrNotFound", err)
	}

	u, err := s.CreateUser(ctx, "plain@x.com", "hash", "Plain", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	// A user with no 2FA at all.
	if _, err := s.DisableTOTPByOperator(ctx, u.ID, "no factor"); !errors.Is(err, ErrNoLiveTOTP) {
		t.Errorf("user without 2FA returned %v, want ErrNoLiveTOTP", err)
	}

	// A PENDING enrolment is not a lockout — the user simply never finished,
	// and CancelPendingTOTP handles it without special authority. Treating it
	// as one would let this subcommand be used routinely, which is how a
	// last-resort tool stops being treated as one.
	f, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DisableTOTPByOperator(ctx, u.ID, "half-enrolled"); !errors.Is(err, ErrNoLiveTOTP) {
		t.Errorf("pending enrolment returned %v, want ErrNoLiveTOTP", err)
	}
	// ...and it is still pending, not quietly killed.
	var disabled *int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT disabled_at FROM user_totp WHERE id = ?`, f.ID).Scan(&disabled); err != nil {
		t.Fatal(err)
	}
	if disabled != nil {
		t.Error("the refused call disabled the pending enrolment anyway")
	}
}

// Twice is not success. An operator retrying a command whose output they lost
// must not get a second audit entry for an act that happened once.
func TestOperatorDisableIsNotIdempotentlySuccessful(t *testing.T) {
	s, ctx, userID, _ := lockedOutUser(t)

	if _, err := s.DisableTOTPByOperator(ctx, userID, "first"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DisableTOTPByOperator(ctx, userID, "second"); !errors.Is(err, ErrNoLiveTOTP) {
		t.Errorf("repeat disable returned %v, want ErrNoLiveTOTP", err)
	}

	entries, _, err := s.AdminAuditActions(ctx, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, e := range entries {
		if e.Action == "totp_disable_by_operator" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("%d audit entries for one disable", n)
	}
}

// The structural half: this must stay unreachable over the network.
//
// The function's authority is possession of the data directory. An HTTP
// handler calling it would convert that into "possession of a session", which
// is exactly the reduction DisableTOTP's claim requirement exists to prevent —
// and no existing test would notice, because the handler would work.
func TestNoHTTPHandlerCanDisableTOTPWithoutAClaim(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "internal", "httpapi")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	scanned := 0
	var offenders []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		scanned++
		if strings.Contains(string(b), "DisableTOTPByOperator") {
			offenders = append(offenders, e.Name())
		}
	}
	// A scan that read nothing would pass however many callers appeared.
	if scanned < 10 {
		t.Fatalf("scanned only %d httpapi sources; the scan is broken, not the code", scanned)
	}
	if len(offenders) > 0 {
		t.Errorf(`internal/httpapi calls DisableTOTPByOperator: %v

That function ends a second factor without proving anything, and what makes it
acceptable is that reaching it requires the hub's data directory — shell access
to the host, which already permits more than this does. Serving it over HTTP
replaces that with a session, so a stolen password plus a stolen cookie would
be enough to remove the factor that was supposed to stop exactly that.

If an operator-facing route is genuinely wanted, it needs its own design: an
authority that is not "logged in", and a reason it is safer than the CLI.`, offenders)
	}
}
