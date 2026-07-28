package store

// The last-resort 2FA escape hatch, and why it lives here alone.
//
// twofactor.go's DisableTOTP requires a SecondFactorClaim: a live TOTP code or
// an unspent recovery code. That is correct for every path a user reaches,
// because turning a second factor off is exactly what an attacker who has the
// password wants, and letting them do it unproven would reduce the account back
// to a password.
//
// It leaves one person stuck: the user who lost the authenticator AND the
// recovery codes. They hold no claim, so no route in the product can help them,
// and until now the documented answer was an UPDATE against user_totp on the
// hub's own SQLite file. That is worse than a subcommand in three ways — it is
// untyped (nothing stops disabling a pending factor, or the wrong user's), it
// is unaudited, and it teaches an operator that hand-editing the auth tables is
// a normal thing to do.
//
// So this is the same act, made narrow and recorded.
//
// # What authorises it
//
// Not a claim, and not a role: possession of the hub's data directory. The CLI
// opens the database file directly, which means shell access to the host. That
// is already game over for the deployment — someone who can edit the SQLite
// file can do this and considerably worse — so this function grants no power
// that the filesystem did not already grant. What it adds is a record.
//
// # Why it is in its own file
//
// This is the only code in the hub that ends a second factor without proving
// anything. It should be reviewable in one sitting, and a reviewer should not
// have to find it among the paths that DO require proof. TestNoHTTPHandlerCanDisableTOTPWithoutAClaim
// pins the other half: nothing served over the network may call it.

import (
	"context"
	"database/sql"
	"errors"
)

// ErrNoLiveTOTP — the user has no activated, undisabled factor. Returned
// rather than silently succeeding so the operator learns that the lockout they
// were called about has some other cause, instead of believing they fixed it.
var ErrNoLiveTOTP = errors.New("store: user has no active TOTP factor")

// OperatorDisableResult describes what was turned off, for the operator to read
// back before they tell someone their account is usable again.
type OperatorDisableResult struct {
	UserID   string
	Username string
	FactorID string
	// RecoveryCodesOutstanding is how many unspent recovery codes the dead
	// factor still had. It is reported because a non-zero count means the user
	// DID have a way out and did not use it — worth a question before assuming
	// the lockout story is complete.
	RecoveryCodesOutstanding int
}

// DisableTOTPByOperator turns off a user's active second factor with no claim,
// and writes the audit entry in the SAME transaction, so the two cannot come
// apart. reason is recorded verbatim; it is the operator's own account of why.
//
// It refuses a pending (never-activated) enrolment: that is not a lockout, and
// CancelPendingTOTP already handles it without special authority.
func (s *Store) DisableTOTPByOperator(ctx context.Context, userID, reason string) (*OperatorDisableResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Resolve the user first, so an operator who mistypes an id gets "no such
	// user" rather than "no active factor" — two different next actions.
	var username string
	if err := tx.QueryRowContext(ctx,
		`SELECT username FROM users WHERE id = ?`, userID).Scan(&username); err != nil {
		return nil, err // ErrNotFound for an unknown id
	}

	var factorID string
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM user_totp
		 WHERE user_id = ? AND activated_at IS NOT NULL AND disabled_at IS NULL`,
		userID).Scan(&factorID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoLiveTOTP
	}
	if err != nil {
		return nil, err
	}

	var outstanding int
	if err := tx.QueryRowContext(ctx,
		`SELECT count(*) FROM user_totp_recovery_codes
		 WHERE totp_id = ? AND consumed_at IS NULL`, factorID).Scan(&outstanding); err != nil {
		return nil, err
	}

	// The activated_at / disabled_at clauses repeat the SELECT's on purpose.
	// Either one alone still refuses a pending enrolment, so removing "the
	// redundant one" looks safe and is not: the pair is what keeps the refusal
	// true if the lookup above is ever widened — a lockout tool that quietly
	// starts cancelling half-finished enrolments is a tool people reach for
	// routinely, and this one should stay hard to justify using.
	res, err := tx.ExecContext(ctx,
		`UPDATE user_totp SET disabled_at = ?
		 WHERE id = ? AND user_id = ? AND activated_at IS NOT NULL AND disabled_at IS NULL`,
		now(), factorID, userID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Lost a race with a concurrent disable. Report it as the same
		// "nothing to do" the operator would have seen a moment earlier.
		return nil, ErrNoLiveTOTP
	}

	// actorUserID is deliberately empty: the actor is not a user of this hub,
	// it is whoever holds the host. Naming a user id here would attribute the
	// act to someone who did not perform it.
	if err := writeAdminAuditTx(ctx, tx, "", "totp_disable_by_operator", "user", userID, true,
		map[string]any{
			"username":                   username,
			"factor_id":                  factorID,
			"reason":                     reason,
			"recovery_codes_outstanding": outstanding,
			"via":                        "cli",
		}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &OperatorDisableResult{
		UserID: userID, Username: username, FactorID: factorID,
		RecoveryCodesOutstanding: outstanding,
	}, nil
}

// UserIDByUsernameForOperator resolves a username to an id for the CLI, which
// is handed the name a locked-out person gives over the phone rather than an
// opaque id.
func (s *Store) UserIDByUsernameForOperator(ctx context.Context, username string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM users WHERE username = ?`, username).Scan(&id)
	return id, err
}
