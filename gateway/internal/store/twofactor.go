package store

// Two-factor (TOTP) persistence — the store half of POST /v1/auth/2fa/*
// and of the second-factor gate in POST /v1/auth/login. The code that
// actually computes and compares an RFC 6238 value is
// internal/httpapi/twofactor.go; see migrations/0016_two_factor.sql for the
// schema rationale. This file owns liveness, atomic claims and nothing else.
//
// THE SECRET IS RECOVERABLE, AND THAT IS NOT A MISTAKE. Verifying a TOTP
// means recomputing HMAC-SHA1(secret, counter) server-side, so the secret
// cannot be hashed the way a password or a recovery token verifier is. It is
// the same class of value as a webhook signing key, and it gets that
// treatment: exactly ONE query in this file selects the column
// (LiveTOTPFactor), the status read path (TOTPStatus) does not select it at
// all so no listing projection can carry it, and it is handed to a client
// once — in the enrolment response, as the base32 secret and the otpauth://
// URI — and never again. Never log it. Never put it in an audit detail.
// Never add a second selecting query without a reason that survives review.
//
// THE INVARIANTS THIS FILE EXISTS TO ENFORCE:
//
//  1. A pending factor gates NOTHING. LiveTOTPFactor returns pending rows
//     because activation needs them, but only Active() rows make login demand
//     a second factor. A half-enrolled secret that already gates login locks
//     a user out of the hub that opens their own gates.
//
//  2. A TOTP counter is spent AT MOST ONCE. Every claim is a guarded UPDATE
//     requiring the new step to be strictly greater than last_step. Replay
//     affects zero rows and the login it was to authorise is refused.
//
//  3. A recovery code is spent AT MOST ONCE, and the act of spending it is
//     INSEPARABLE from the state change it pays for. Each redemption below is
//     one transaction holding both the guarded claim and its effect (the
//     refresh-token insert, or the factor teardown). Zero rows affected =>
//     ErrTOTPUnusable and the whole transaction rolls back. There is no path
//     that checks a code and then acts on it in a second statement, because
//     that shape loses the double-redeem race. This is authrecovery.go's
//     discipline, reused rather than re-derived — read that file's doc
//     comment for the full argument.
//
//  4. Every failure is ONE failure. ErrTOTPUnusable covers replayed, unknown,
//     already-spent, not-activated and disabled alike; the caller maps it to a
//     single opaque client-facing code. "Already used" instead of "wrong"
//     tells an attacker a code once existed.

import (
	"context"
	"database/sql"
	"errors"
)

// ErrTOTPUnusable is the SINGLE error every failed claim returns, whatever
// the underlying reason. See invariant (4) above.
var ErrTOTPUnusable = errors.New("totp_unusable")

// ErrTOTPAlreadyActive is returned when enrolment is attempted while an
// ACTIVE factor already exists. It is deliberately NOT folded into
// ErrTOTPUnusable: this one is reported to an authenticated user about their
// own account, where "you already have 2FA on" is the honest and useful
// answer, and it leaks nothing they cannot read from GET /v1/auth/2fa.
var ErrTOTPAlreadyActive = errors.New("totp_already_active")

// TOTPFactor is one user's second factor. Secret is populated ONLY by
// LiveTOTPFactor; every other read path in this file leaves it empty.
type TOTPFactor struct {
	ID          string
	UserID      string
	Secret      string // recoverable by necessity — see this file's doc comment
	Digits      int
	PeriodS     int
	CreatedAt   int64
	ActivatedAt sql.NullInt64
	DisabledAt  sql.NullInt64
	LastStep    sql.NullInt64
}

// Active reports whether this factor gates login: proven and not torn down.
func (f *TOTPFactor) Active() bool { return f.ActivatedAt.Valid && !f.DisabledAt.Valid }

// Pending reports whether this factor is enrolled but unproven. A pending
// factor gates nothing — invariant (1).
func (f *TOTPFactor) Pending() bool { return !f.ActivatedAt.Valid && !f.DisabledAt.Valid }

// TOTPStatus is the projection behind GET /v1/auth/2fa. It has no Secret
// field, and the query that fills it does not select the column — a listing
// shape that structurally cannot carry the secret, rather than one that
// merely happens not to today.
type TOTPStatus struct {
	Enrolled               bool
	Active                 bool
	Pending                bool
	CreatedAt              int64
	ActivatedAt            sql.NullInt64
	RecoveryCodesRemaining int
}

// RecoveryCodeSeed is one recovery code's stored half, as minted by the HTTP
// layer. The plaintext is not here and cannot be derived from here.
type RecoveryCodeSeed struct {
	Salt     string
	CodeHash string
}

// RecoveryCodeRow is one stored recovery code as read back for verification:
// the salt and digest needed to test a presented code, and the id needed to
// claim it. Never the plaintext, which does not exist after issuance.
type RecoveryCodeRow struct {
	ID       string
	Salt     string
	CodeHash string
}

const totpCols = `id, user_id, secret, digits, period_s, created_at, activated_at, disabled_at, last_step`

func scanTOTP(row *sql.Row) (*TOTPFactor, error) {
	var f TOTPFactor
	if err := row.Scan(&f.ID, &f.UserID, &f.Secret, &f.Digits, &f.PeriodS, &f.CreatedAt,
		&f.ActivatedAt, &f.DisabledAt, &f.LastStep); err != nil {
		return nil, err
	}
	return &f, nil
}

// LiveTOTPFactor returns the user's one live factor — pending or active —
// INCLUDING the secret, because its callers are the three that must
// recompute a code: the login gate, activation and disablement. Returns
// ErrNotFound when the user has no live factor, which is the common case and
// is not an error condition.
//
// This is the only query in the codebase that selects user_totp.secret.
func (s *Store) LiveTOTPFactor(ctx context.Context, userID string) (*TOTPFactor, error) {
	return scanTOTP(s.db.QueryRowContext(ctx,
		`SELECT `+totpCols+` FROM user_totp WHERE user_id = ? AND disabled_at IS NULL`, userID))
}

// TOTPStatus answers "is 2FA on for this user, and how many recovery codes
// are left" without touching the secret column. A zero-value status with
// Enrolled=false is returned when there is no live factor.
func (s *Store) TOTPStatus(ctx context.Context, userID string) (TOTPStatus, error) {
	var st TOTPStatus
	var id string
	var activatedAt sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, created_at, activated_at FROM user_totp
		 WHERE user_id = ? AND disabled_at IS NULL`, userID).Scan(&id, &st.CreatedAt, &activatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.Enrolled = true
	st.ActivatedAt = activatedAt
	st.Active = activatedAt.Valid
	st.Pending = !activatedAt.Valid
	if st.Active {
		if err := s.db.QueryRowContext(ctx,
			`SELECT count(*) FROM user_totp_recovery_codes WHERE totp_id = ? AND consumed_at IS NULL`,
			id).Scan(&st.RecoveryCodesRemaining); err != nil {
			return st, err
		}
	}
	return st, nil
}

// CreateTOTPEnrollment starts enrolment: a PENDING factor holding the secret,
// gating nothing until proven.
//
// An ACTIVE factor blocks it (ErrTOTPAlreadyActive). That refusal is the
// whole point: if enrolment could supersede an active factor, then a stolen
// session could enrol a new secret and silently take over the second factor —
// which is precisely what "disabling 2FA must require a current code" exists
// to prevent, reached by a different door. Turning 2FA off is the only way to
// start again, and that requires proving possession.
//
// A PENDING factor is superseded freely, in the same transaction: it
// authorises nothing, and a user who abandoned a half-finished enrolment must
// be able to start over.
func (s *Store) CreateTOTPEnrollment(ctx context.Context, userID, secret string, digits, periodS int) (*TOTPFactor, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var existingID string
	var activatedAt sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT id, activated_at FROM user_totp WHERE user_id = ? AND disabled_at IS NULL`, userID).
		Scan(&existingID, &activatedAt)
	switch {
	case err == nil && activatedAt.Valid:
		return nil, ErrTOTPAlreadyActive
	case err == nil:
		// Pending: supersede it. disabled_at, not DELETE — the abandoned
		// secret stays visible as evidence and cannot be resurrected.
		if _, err := tx.ExecContext(ctx,
			`UPDATE user_totp SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL`,
			now(), existingID); err != nil {
			return nil, err
		}
	case !errors.Is(err, sql.ErrNoRows):
		return nil, err
	}

	f := &TOTPFactor{
		ID: NewID(), UserID: userID, Secret: secret,
		Digits: digits, PeriodS: periodS, CreatedAt: now(),
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_totp (id, user_id, secret, digits, period_s, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		f.ID, f.UserID, f.Secret, f.Digits, f.PeriodS, f.CreatedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return f, nil
}

// ActivateTOTP completes enrolment: it flips the factor to active, spends the
// counter the proving code came from, and writes the recovery-code batch — all
// in ONE transaction.
//
// One transaction because a crash between "2FA is now on" and "here are your
// recovery codes" leaves a user gated by a factor with no escape hatch. The
// codes are minted here, at activation, rather than at enrolment, so an
// abandoned pending factor never leaves live gate-opening credentials behind.
//
// The guarded UPDATE requires the factor to still be pending and live, so a
// concurrent double-activate has exactly one winner and the loser gets
// ErrTOTPUnusable rather than a second batch of codes.
func (s *Store) ActivateTOTP(ctx context.Context, factorID, userID string, step int64, codes []RecoveryCodeSeed) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	t := now()
	res, err := tx.ExecContext(ctx,
		`UPDATE user_totp SET activated_at = ?, last_step = ?
		 WHERE id = ? AND user_id = ? AND activated_at IS NULL AND disabled_at IS NULL`,
		t, step, factorID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTOTPUnusable
	}
	for _, c := range codes {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_totp_recovery_codes (id, totp_id, user_id, salt, code_hash, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			NewID(), factorID, userID, c.Salt, c.CodeHash, t); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// LiveRecoveryCodes returns the unspent codes for a factor so the HTTP layer
// can test a presented value against each of them in constant time. Salt and
// digest only — the plaintext does not exist anywhere after issuance.
func (s *Store) LiveRecoveryCodes(ctx context.Context, factorID string) ([]RecoveryCodeRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, salt, code_hash FROM user_totp_recovery_codes
		 WHERE totp_id = ? AND consumed_at IS NULL ORDER BY created_at, id`, factorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RecoveryCodeRow
	for rows.Next() {
		var c RecoveryCodeRow
		if err := rows.Scan(&c.ID, &c.Salt, &c.CodeHash); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SecondFactorKind names which credential authorised a second-factor step. It
// is part of the claim, not a label applied afterwards: the claim methods
// switch on it to choose which guarded UPDATE to run.
type SecondFactorKind string

const (
	// SecondFactorTOTP — a code from the authenticator app.
	SecondFactorTOTP SecondFactorKind = "totp"
	// SecondFactorRecoveryCode — one of the single-use codes issued at
	// activation.
	SecondFactorRecoveryCode SecondFactorKind = "recovery_code"
)

// SecondFactorClaim is a verified-but-not-yet-spent second factor. The HTTP
// layer produces one after a constant-time comparison succeeds; the store
// SPENDS it, atomically, together with whatever it authorises. Holding a
// claim is not authorisation — the guarded UPDATE inside the transaction is.
type SecondFactorClaim struct {
	Kind     SecondFactorKind
	FactorID string
	// Step is the RFC 6238 counter the code came from (SecondFactorTOTP).
	Step int64
	// CodeID is the recovery code's row id (SecondFactorRecoveryCode).
	CodeID string
}

// claimSecondFactorTx spends the claim, or returns ErrTOTPUnusable having
// changed nothing. Both branches re-assert, inside the guard, that the factor
// is still ACTIVE and LIVE — so a factor disabled between verification and
// claim cannot be spent, and a recovery code cannot outlive the factor it
// belongs to.
func claimSecondFactorTx(ctx context.Context, x execer, userID string, c SecondFactorClaim) error {
	t := now()
	var res sql.Result
	var err error
	switch c.Kind {
	case SecondFactorTOTP:
		// Strictly-greater is the replay guard: the same code (or an earlier
		// one inside the skew window) affects zero rows.
		res, err = x.ExecContext(ctx,
			`UPDATE user_totp SET last_step = ?
			 WHERE id = ? AND user_id = ?
			   AND activated_at IS NOT NULL AND disabled_at IS NULL
			   AND (last_step IS NULL OR last_step < ?)`,
			c.Step, c.FactorID, userID, c.Step)
	case SecondFactorRecoveryCode:
		res, err = x.ExecContext(ctx,
			`UPDATE user_totp_recovery_codes SET consumed_at = ?
			 WHERE id = ? AND user_id = ? AND totp_id = ? AND consumed_at IS NULL
			   AND totp_id IN (SELECT id FROM user_totp
			                   WHERE id = ? AND user_id = ?
			                     AND activated_at IS NOT NULL AND disabled_at IS NULL)`,
			t, c.CodeID, userID, c.FactorID, c.FactorID, userID)
	default:
		// Unknown kind: fail closed. A claim this function does not
		// understand must never be treated as spent.
		return ErrTOTPUnusable
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTOTPUnusable
	}
	return nil
}

// ClaimSecondFactorAndIssueRefresh is the login path: it spends the second
// factor and issues the session it pays for, in ONE transaction.
//
// The pairing is the point. If the claim and the refresh-token insert were
// two statements, a crash (or a lost race) between them would either burn a
// user's recovery code without logging them in, or — far worse — hand out a
// session whose second factor was never actually spent, leaving a replayable
// code behind. Zero rows on the guarded claim rolls the whole thing back and
// returns ErrTOTPUnusable; no token exists.
//
// The INSERT mirrors InsertRefreshToken (users.go) exactly; it is repeated
// here rather than called because it must run on THIS transaction's handle.
func (s *Store) ClaimSecondFactorAndIssueRefresh(ctx context.Context, userID string, c SecondFactorClaim,
	refreshID, familyID, tokenHash string, expiresAt int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := claimSecondFactorTx(ctx, tx, userID, c); err != nil {
		return err
	}
	t := now()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO refresh_tokens (id, family_id, user_id, token_hash, issued_at, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		refreshID, familyID, userID, tokenHash, t, expiresAt, t); err != nil {
		return err
	}
	return tx.Commit()
}

// DisableTOTP spends the presented second factor and tears the factor down,
// in ONE transaction.
//
// Requiring a claim here is not ceremony. Without it, a stolen session — the
// exact thing the second factor exists to survive — could turn 2FA off and
// reduce the account back to a password. So the caller must prove possession
// of the authenticator or of a recovery code, and that proof is SPENT: the
// same code cannot disable and then be replayed to log in.
//
// The remaining recovery codes are not swept. They do not need to be: every
// claim joins back to a live, activated user_totp row, so the batch dies with
// its factor. Re-enrolment mints a fresh batch tied to a fresh factor id.
func (s *Store) DisableTOTP(ctx context.Context, userID string, c SecondFactorClaim) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := claimSecondFactorTx(ctx, tx, userID, c); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx,
		`UPDATE user_totp SET disabled_at = ?
		 WHERE id = ? AND user_id = ? AND activated_at IS NOT NULL AND disabled_at IS NULL`,
		now(), c.FactorID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTOTPUnusable
	}
	return tx.Commit()
}

// CancelPendingTOTP discards an unproven enrolment. It refuses to touch an
// ACTIVE factor (zero rows => ErrTOTPUnusable), because turning real 2FA off
// is DisableTOTP's job and requires a claim. This exists so "I closed the tab
// mid-enrolment" is not a state a user has to prove their way out of.
func (s *Store) CancelPendingTOTP(ctx context.Context, factorID, userID string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE user_totp SET disabled_at = ?
		 WHERE id = ? AND user_id = ? AND activated_at IS NULL AND disabled_at IS NULL`,
		now(), factorID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrTOTPUnusable
	}
	return nil
}
