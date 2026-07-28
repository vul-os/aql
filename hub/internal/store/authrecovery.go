package store

// Account-recovery token persistence — the store half of
// POST /v1/auth/{forgot-password,reset-password,verify-username,update-password}.
// See migrations/0009_auth_recovery.sql for the schema rationale (split
// selector/verifier, per-row salt, the two distinct lifecycle columns) and
// internal/httpapi/authrecovery.go for the token construction itself.
//
// THE INVARIANT THIS FILE EXISTS TO ENFORCE, stated once: a recovery token
// is spent AT MOST ONCE, and the act of spending it is inseparable from the
// state change it authorises. Every redemption below is a single
// transaction containing (a) a guarded UPDATE that claims the token and (b)
// the password/verification write it pays for. If (a) affects zero rows —
// because the token was already consumed, already invalidated, or already
// expired — the transaction returns ErrRecoveryTokenUnusable and rolls back
// with nothing changed. There is no code path that checks a token's state
// and then acts on it in a second statement, because that shape is the one
// that loses a race.
//
// AND THE SECOND INVARIANT: every password change, by ANY route, ends every
// live session and kills every live reset token for that user in the SAME
// transaction. Not "then calls revoke" — in the same transaction, so a
// crash between the two is impossible. See setPasswordTx.

import (
	"context"
	"database/sql"
	"errors"
)

// RecoveryPurpose discriminates the flows sharing auth_recovery_tokens.
//
// There is exactly ONE today. This comment used to say "the two flows" and
// give a username-verification token as its example, which is a token this
// hub cannot issue: identity here is a local username, so there is no address
// to verify and no sender to verify it with, and migration 0009 leaves
// 'email_verify' deliberately out of the purpose CHECK constraint.
//
// The discriminator is kept anyway, and kept in the redemption LOOKUP KEY
// rather than checked after the row is fetched: a token issued for one flow
// must be structurally unable to redeem in another, not merely rejected once
// found. With one purpose that costs nothing and proves nothing; the moment a
// second exists it is the difference between a guarantee and an `if` somebody
// has to remember, inside a function that already returns one opaque error for
// four different reasons. Pinned by TestEveryRecoveryTokenQueryFiltersOnPurpose,
// which is worth having precisely while there is no second flow to catch a
// regression.
type RecoveryPurpose string

const (
	// RecoveryPasswordReset tokens redeem at POST /v1/auth/reset-password.
	RecoveryPasswordReset RecoveryPurpose = "password_reset"
)

// ErrRecoveryTokenUnusable is the SINGLE error every failed redemption
// returns, whatever the underlying reason (unknown, expired, already
// consumed, superseded). Callers map it to one opaque client-facing code:
// telling an attacker "expired" instead of "unknown" tells them a token
// once existed, which is information they did not have.
var ErrRecoveryTokenUnusable = errors.New("recovery_token_unusable")

// RecoveryToken is one issued recovery token's stored half. The plaintext
// verifier is not here and cannot be derived from here — VerifierHash is a
// salted digest, and comparing against it requires the presented value.
type RecoveryToken struct {
	ID            string
	UserID        string
	Purpose       RecoveryPurpose
	Selector      string
	Salt          string
	VerifierHash  string
	IssuedAt      int64
	ExpiresAt     int64
	ConsumedAt    sql.NullInt64
	InvalidatedAt sql.NullInt64
}

// Live reports whether the token is still redeemable at nowUnix. The
// redemption paths do NOT rely on this — they use the guarded UPDATE in
// claimRecoveryToken, which is atomic. This exists for the handler's
// early-out and for tests; treating it as the authority would reintroduce
// the check-then-act race it deliberately does not close.
func (t *RecoveryToken) Live(nowUnix int64) bool {
	return !t.ConsumedAt.Valid && !t.InvalidatedAt.Valid && t.ExpiresAt > nowUnix
}

// CreateRecoveryToken issues a token, superseding every live token the user
// already holds for the same purpose in the same transaction.
//
// One live token per (user, purpose) is a deliberate bound: without it, an
// attacker who can trigger issuance (POST /v1/auth/forgot-password is
// unauthenticated by necessity) could accumulate an arbitrary number of
// simultaneously-valid credentials for a victim's account, each one a
// separate chance for a mail-path leak to pay off. With it, only the newest
// request is ever redeemable, so the exposure window is one token wide no
// matter how many are requested.
func (s *Store) CreateRecoveryToken(ctx context.Context, userID string, purpose RecoveryPurpose,
	selector, salt, verifierHash string, expiresAt int64) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if err := invalidateLiveRecoveryTokensTx(ctx, tx, userID, purpose); err != nil {
		return "", err
	}
	id := NewID()
	t := now()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO auth_recovery_tokens
		   (id, user_id, purpose, selector, salt, verifier_hash, issued_at, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, userID, string(purpose), selector, salt, verifierHash, t, expiresAt, t); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

// RecoveryTokenBySelector fetches the stored half of a token by its public
// lookup handle, scoped to a purpose. Returns ErrNotFound (== sql.ErrNoRows)
// when no such row exists; the caller must still verify the presented
// verifier against VerifierHash in constant time before trusting anything
// here — a selector proves nothing on its own.
func (s *Store) RecoveryTokenBySelector(ctx context.Context, selector string, purpose RecoveryPurpose) (*RecoveryToken, error) {
	var t RecoveryToken
	var p string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id, purpose, selector, salt, verifier_hash, issued_at, expires_at,
		        consumed_at, invalidated_at
		 FROM auth_recovery_tokens WHERE selector = ? AND purpose = ?`, selector, string(purpose)).
		Scan(&t.ID, &t.UserID, &p, &t.Selector, &t.Salt, &t.VerifierHash, &t.IssuedAt, &t.ExpiresAt,
			&t.ConsumedAt, &t.InvalidatedAt)
	if err != nil {
		return nil, err
	}
	t.Purpose = RecoveryPurpose(p)
	return &t, nil
}

// invalidateLiveRecoveryTokensTx kills every live token for (userID,
// purpose) without consuming any of them — see the migration's note on why
// invalidated_at and consumed_at are separate columns.
func invalidateLiveRecoveryTokensTx(ctx context.Context, x execer, userID string, purpose RecoveryPurpose) error {
	_, err := x.ExecContext(ctx,
		`UPDATE auth_recovery_tokens SET invalidated_at = ?
		 WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND invalidated_at IS NULL`,
		now(), userID, string(purpose))
	return err
}

// claimRecoveryToken is the guarded single-use claim: it consumes the token
// only if it is still unconsumed, un-invalidated and unexpired AS OF this
// statement. Zero rows affected => ErrRecoveryTokenUnusable, and the caller
// (always inside a transaction) aborts without applying whatever the token
// was going to authorise.
func claimRecoveryToken(ctx context.Context, x execer, tokenID, userID string, purpose RecoveryPurpose) error {
	t := now()
	res, err := x.ExecContext(ctx,
		`UPDATE auth_recovery_tokens SET consumed_at = ?
		 WHERE id = ? AND user_id = ? AND purpose = ?
		   AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
		t, tokenID, userID, string(purpose), t)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrRecoveryTokenUnusable
	}
	return nil
}

// setPasswordTx is the ONE place a password_hash is written, and it does
// three things atomically because doing fewer than three would be a bug:
//
//  1. write the new hash;
//  2. revoke EVERY live refresh token for the user (reusing
//     revokeAllRefreshTokens — the same primitive POST /v1/auth/logout-all
//     and the admin "disable user" transition already use, deliberately not
//     a second session-killing mechanism);
//  3. invalidate every live password-reset token for the user.
//
// (2) is the requirement "a password change must invalidate existing
// sessions". Its honest bound is the same one RevokeAllRefreshTokensForUser
// documents: already-issued ACCESS tokens are stateless JWTs and live out
// their remaining <=15 minutes. What makes that survivable rather than a
// hole is requireAuth's live per-request user re-read (server.go) — it
// re-reads the users row on every authenticated request, so the ceiling on
// a stolen access token surviving a password change is its own TTL, and
// nothing can be renewed past it.
//
// (3) closes the other half: a reset link mailed an hour ago must not still
// work after the account holder has changed their password by hand. Without
// it, "change my password because I think someone got into my mail" would
// leave the attacker's mailed reset link live.
func setPasswordTx(ctx context.Context, x execer, userID, passwordHash string) error {
	res, err := x.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
		passwordHash, now(), userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Not active (or gone) between the handler's read and here: fail
		// closed rather than silently writing a credential for an account
		// that is no longer allowed to log in.
		return ErrNotFound
	}
	if err := revokeAllRefreshTokens(ctx, x, userID); err != nil {
		return err
	}
	return invalidateLiveRecoveryTokensTx(ctx, x, userID, RecoveryPasswordReset)
}

// RedeemPasswordReset consumes a password-reset token and applies the new
// password in one transaction. Returns ErrRecoveryTokenUnusable if the
// token was already spent, invalidated or expired — including under a
// concurrent double-redeem, where exactly one caller wins.
func (s *Store) RedeemPasswordReset(ctx context.Context, tokenID, userID, newPasswordHash string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := claimRecoveryToken(ctx, tx, tokenID, userID, RecoveryPasswordReset); err != nil {
		return err
	}
	if err := setPasswordTx(ctx, tx, userID, newPasswordHash); err != nil {
		return err
	}
	return tx.Commit()
}

// SetUserPassword is the authenticated change-password path
// (POST /v1/auth/update-password). Same three atomic effects as a redeemed
// reset (see setPasswordTx) minus the token claim, because this route
// authenticates with the CURRENT password instead — which the handler
// verifies before calling this. Returns ErrNotFound if the user is not
// active.
func (s *Store) SetUserPassword(ctx context.Context, userID, newPasswordHash string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := setPasswordTx(ctx, tx, userID, newPasswordHash); err != nil {
		return err
	}
	return tx.Commit()
}
