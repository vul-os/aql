package store

import (
	"context"
	"errors"
	"testing"
)

// mkUser creates an active user for the 2FA tests to hang a factor off.
func mkUser(t *testing.T, s *Store, username string) *User {
	t.Helper()
	u, err := s.CreateUser(context.Background(), username, "hash", "T", "ZA")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return u
}

func mkSeeds(n int) []RecoveryCodeSeed {
	out := make([]RecoveryCodeSeed, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, RecoveryCodeSeed{Salt: "salt", CodeHash: string(rune('a'+i)) + "-hash"})
	}
	return out
}

// TestTOTPEnrollmentIsPendingAndGatesNothing pins the enrol→prove→activate
// invariant at the persistence layer: a freshly created factor is Pending,
// NOT Active, so the login gate ignores it. A pending secret that already
// gated login would lock a user out of the hub that opens their own gates.
func TestTOTPEnrollmentIsPendingAndGatesNothing(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u := mkUser(t, s, "pending@x.com")

	f, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET", 6, 30)
	if err != nil {
		t.Fatalf("CreateTOTPEnrollment: %v", err)
	}
	if f.Active() {
		t.Error("a fresh enrolment must NOT be active")
	}
	if !f.Pending() {
		t.Error("a fresh enrolment must be pending")
	}
	st, err := s.TOTPStatus(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Enrolled || st.Active || !st.Pending {
		t.Errorf("status: %+v", st)
	}
	if st.RecoveryCodesRemaining != 0 {
		t.Error("recovery codes must not exist before activation")
	}
}

// TestTOTPEnrollmentSupersedesPendingRefusesActive: a half-finished
// enrolment may be replaced freely (it authorises nothing), but an ACTIVE
// factor must not be silently swapped — that would be a way for a stolen
// session to take over the second factor without proving anything.
func TestTOTPEnrollmentSupersedesPendingRefusesActive(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u := mkUser(t, s, "supersede@x.com")

	first, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET-ONE", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET-TWO", 6, 30)
	if err != nil {
		t.Fatalf("re-enrolling over a PENDING factor must be allowed: %v", err)
	}
	if second.ID == first.ID {
		t.Error("expected a fresh factor row")
	}
	live, err := s.LiveTOTPFactor(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.ID != second.ID || live.Secret != "SECRET-TWO" {
		t.Errorf("the newest pending factor must be the live one: %+v", live)
	}

	if err := s.ActivateTOTP(ctx, second.ID, u.ID, 100, mkSeeds(3)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET-THREE", 6, 30); !errors.Is(err, ErrTOTPAlreadyActive) {
		t.Errorf("re-enrolling over an ACTIVE factor must be refused, got %v", err)
	}
}

// TestActivateTOTPIsAtomicAndOnce: activation writes the recovery-code batch
// in the same transaction that flips the factor on (2FA is never live without
// an escape hatch), and a second activation of the same factor is refused so
// it cannot mint a second batch.
func TestActivateTOTPIsAtomicAndOnce(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u := mkUser(t, s, "activate@x.com")
	f, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ActivateTOTP(ctx, f.ID, u.ID, 42, mkSeeds(10)); err != nil {
		t.Fatal(err)
	}
	st, err := s.TOTPStatus(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Active || st.RecoveryCodesRemaining != 10 {
		t.Errorf("status after activation: %+v", st)
	}
	live, err := s.LiveTOTPFactor(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !live.LastStep.Valid || live.LastStep.Int64 != 42 {
		t.Error("the proving code's counter must be spent by activation")
	}
	if err := s.ActivateTOTP(ctx, f.ID, u.ID, 43, mkSeeds(10)); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("double activation must be refused, got %v", err)
	}
	codes, err := s.LiveRecoveryCodes(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 10 {
		t.Errorf("a refused second activation must not add codes: got %d", len(codes))
	}
}

// activeFactor is the shared fixture: a user with an ACTIVE factor and three
// recovery codes.
func activeFactor(t *testing.T, s *Store, username string) (*User, *TOTPFactor, []RecoveryCodeRow) {
	t.Helper()
	ctx := context.Background()
	u := mkUser(t, s, username)
	f, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ActivateTOTP(ctx, f.ID, u.ID, 10, mkSeeds(3)); err != nil {
		t.Fatal(err)
	}
	codes, err := s.LiveRecoveryCodes(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	return u, f, codes
}

// TestClaimTOTPStepRefusesReplay is the replay guard: a counter is spent at
// most once, and an EARLIER counter (one still inside the skew window) is
// refused too.
func TestClaimTOTPStepRefusesReplay(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, f, _ := activeFactor(t, s, "replay@x.com")

	claim := SecondFactorClaim{Kind: SecondFactorTOTP, FactorID: f.ID, Step: 11}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, claim, "r1", "fam1", "hash1", 1<<40); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	// Same code, again.
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, claim, "r2", "fam2", "hash2", 1<<40); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("replaying a spent counter must be refused, got %v", err)
	}
	// An earlier counter, still inside a ±1 skew window.
	older := SecondFactorClaim{Kind: SecondFactorTOTP, FactorID: f.ID, Step: 10}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, older, "r3", "fam3", "hash3", 1<<40); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("an earlier counter must be refused, got %v", err)
	}
	// And no session leaked out of either refusal.
	for _, h := range []string{"hash2", "hash3"} {
		if _, err := s.RefreshTokenByHash(ctx, h); err == nil {
			t.Errorf("a refused claim must not leave a refresh token behind (%s)", h)
		}
	}
	if _, err := s.RefreshTokenByHash(ctx, "hash1"); err != nil {
		t.Errorf("the accepted claim must have issued its session: %v", err)
	}
}

// TestRecoveryCodeSingleUse: a recovery code authorises exactly one login,
// and the refusal rolls back the session it would have paid for.
func TestRecoveryCodeSingleUse(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, f, codes := activeFactor(t, s, "recovery@x.com")

	claim := SecondFactorClaim{Kind: SecondFactorRecoveryCode, FactorID: f.ID, CodeID: codes[0].ID}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, claim, "r1", "fam1", "hash1", 1<<40); err != nil {
		t.Fatalf("first use: %v", err)
	}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, claim, "r2", "fam2", "hash2", 1<<40); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("a recovery code must not be usable twice, got %v", err)
	}
	if _, err := s.RefreshTokenByHash(ctx, "hash2"); err == nil {
		t.Error("the second, refused use must not have issued a session")
	}
	left, err := s.LiveRecoveryCodes(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 2 {
		t.Errorf("expected 2 unspent codes left, got %d", len(left))
	}
	st, err := s.TOTPStatus(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if st.RecoveryCodesRemaining != 2 {
		t.Errorf("status must report the remaining count, got %d", st.RecoveryCodesRemaining)
	}
}

// TestRecoveryCodeCannotCrossFactors: a code belonging to one user's factor
// must not be claimable against another user, even with the right row id.
func TestRecoveryCodeCannotCrossFactors(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	_, fA, codesA := activeFactor(t, s, "owner@x.com")
	uB, _, _ := activeFactor(t, s, "other@x.com")

	claim := SecondFactorClaim{Kind: SecondFactorRecoveryCode, FactorID: fA.ID, CodeID: codesA[0].ID}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, uB.ID, claim, "r1", "f1", "h1", 1<<40); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("another user's recovery code must be unusable, got %v", err)
	}
}

// TestDisableTOTPRequiresAClaimAndKillsTheBatch: disablement spends the
// credential that authorised it, and the remaining recovery codes die with
// the factor rather than lingering as live gate-opening credentials.
func TestDisableTOTPRequiresAClaimAndKillsTheBatch(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, f, codes := activeFactor(t, s, "disable@x.com")

	// A bogus claim (unknown code id) must not disable anything.
	bogus := SecondFactorClaim{Kind: SecondFactorRecoveryCode, FactorID: f.ID, CodeID: "no-such-code"}
	if err := s.DisableTOTP(ctx, u.ID, bogus); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("a bogus claim must not disable 2FA, got %v", err)
	}
	if st, _ := s.TOTPStatus(ctx, u.ID); !st.Active {
		t.Fatal("2FA must still be active after a refused disable")
	}

	good := SecondFactorClaim{Kind: SecondFactorRecoveryCode, FactorID: f.ID, CodeID: codes[0].ID}
	if err := s.DisableTOTP(ctx, u.ID, good); err != nil {
		t.Fatalf("DisableTOTP: %v", err)
	}
	st, err := s.TOTPStatus(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Enrolled || st.Active {
		t.Errorf("2FA must be off: %+v", st)
	}
	if _, err := s.LiveTOTPFactor(ctx, u.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("no live factor should remain, got %v", err)
	}
	// The surviving codes belong to a dead factor and must no longer buy a
	// session.
	stale := SecondFactorClaim{Kind: SecondFactorRecoveryCode, FactorID: f.ID, CodeID: codes[1].ID}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, stale, "r", "f", "h", 1<<40); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("a recovery code must die with its factor, got %v", err)
	}
	// And re-enrolment is possible again.
	if _, err := s.CreateTOTPEnrollment(ctx, u.ID, "SECRET-NEW", 6, 30); err != nil {
		t.Errorf("re-enrolment after disable must work: %v", err)
	}
}

// TestCancelPendingTOTPRefusesActive: the "I closed the tab" escape must not
// double as a way to turn real 2FA off without proving anything.
func TestCancelPendingTOTPRefusesActive(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, f, _ := activeFactor(t, s, "cancel@x.com")
	if err := s.CancelPendingTOTP(ctx, f.ID, u.ID); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("cancelling an ACTIVE factor must be refused, got %v", err)
	}
	if st, _ := s.TOTPStatus(ctx, u.ID); !st.Active {
		t.Error("2FA must still be active")
	}
}

// TestUnknownClaimKindFailsClosed: a claim this layer does not understand is
// never treated as spent.
func TestUnknownClaimKindFailsClosed(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, f, _ := activeFactor(t, s, "unknown@x.com")
	c := SecondFactorClaim{Kind: SecondFactorKind("wishful"), FactorID: f.ID, Step: 99}
	if err := s.ClaimSecondFactorAndIssueRefresh(ctx, u.ID, c, "r", "f", "h", 1<<40); !errors.Is(err, ErrTOTPUnusable) {
		t.Errorf("an unknown claim kind must fail closed, got %v", err)
	}
}
