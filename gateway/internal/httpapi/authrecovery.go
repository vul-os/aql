package httpapi

// Account recovery — the HTTP half of POST /v1/auth/{forgot-password,
// reset-password,verify-email,update-password}. The persistence half (and the
// single-use / session-killing invariants it enforces) is
// store/authrecovery.go; the out-of-band delivery seam is authmail.go. This
// file owns exactly one thing neither of those can: TOKEN CONSTRUCTION.
//
// TOKEN FORMAT — "<selector>.<verifier>", and the split is the whole point:
//
//	selector  16 random bytes (128 bits), base64url. PUBLIC. Stored in the
//	          clear so redemption is an indexed equality lookup. It authorises
//	          NOTHING on its own — finding a row by selector is not evidence
//	          the caller holds the token, which is why nothing in this file
//	          acts on a lookup result before the verifier check below.
//	verifier  32 random bytes (256 bits), base64url. SECRET. Never stored;
//	          what lands in the row is
//	          hex(SHA-256(domain || purpose || 0x00 || salt || 0x00 || verifier))
//	          against a fresh 128-bit per-row salt, compared with
//	          crypto/subtle.ConstantTimeCompare on redemption.
//
// The purpose is inside the hash domain as well as in the lookup key, so a
// verification token's stored hash is not even the same value a reset token
// with an identical secret would produce — cross-purpose redemption is
// structurally impossible twice over, not merely rejected.
//
// Why SHA-256 and not argon2id, when password.go reaches for argon2id? A
// password is low-entropy and human-chosen, so its hash must be slow. These
// verifiers are 256 bits of crypto/rand: there is no dictionary to run and no
// feasible offline search, so a fast salted digest is the correct primitive.
// The salt is still there for the reason the migration gives — no
// precomputation, no cross-row correlation from a stolen database.
//
// WHERE A TOKEN IS ALLOWED TO EXIST: in the response of crypto/rand, in the
// argument list of the RecoveryMailer call, and — hashed — in one database
// column. Not in a log line (authmail.go's LogRecoveryMailer is the ONE
// deliberate exception and says so at length), not in a response body, not in
// an audit detail, not in a URL this server logs. If you add a debug print
// here, you have written an account-takeover primitive.
//
// NO USER ENUMERATION, and what that costs: POST /v1/auth/forgot-password is
// unauthenticated and takes an email address, which makes it the obvious
// oracle for "does this person have an account on this gate system?" — a
// question with physical-world consequences here, since an account on this
// instance means a person with keys to a specific building. So the handler
// returns a byte-identical body and status either way, and does the same
// shaped work either way: it mints selector+verifier+salt and computes the
// verifier hash BEFORE it knows whether the account exists, and writes an
// audit row in both branches. The residual difference is honest and stated
// rather than papered over: an existing account additionally pays one local
// SQLite INSERT and one mailer call. This code does not pad with a sleep —
// a fixed delay is itself a signal, and on a self-hosted single-writer SQLite
// box the insert is orders of magnitude below the request's own jitter. What
// actually bounds the oracle is the rate limit: the attacker gets a small
// fixed number of probes per window, not an unmetered scan.
//
// EVERY FAILURE IS THE SAME FAILURE. Unknown selector, wrong verifier,
// expired, already consumed, invalidated by a newer request, invalidated by a
// password change, malformed input: all of them render as one
// 400 invalid_token. store.ErrRecoveryTokenUnusable exists to make that easy
// to honour — see its doc comment for why "expired" is information an
// attacker did not have.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/gateway/internal/store"
)

const (
	// Token part sizes. See this file's doc comment for what each half is.
	recoverySelectorBytes = 16 // 128 bits, public lookup handle
	recoveryVerifierBytes = 32 // 256 bits, the secret
	recoverySaltBytes     = 16 // 128 bits, per-row

	// recoveryHashDomain separates these digests from every other SHA-256 in
	// this codebase (hashToken's refresh/invite hashes, the audit chain).
	recoveryHashDomain = "aql/auth-recovery/v1/"

	// passwordResetTTL is deliberately short: this is the one credential in
	// the system that converts, on its own, into control of an account that
	// opens physical gates. A mailbox that leaks in an hour's time should not
	// still be a key.
	passwordResetTTL = time.Hour
	// emailVerifyTTL is longer because the token is worth far less — proving
	// reachability, never identity (see store.RedeemEmailVerification).
	emailVerifyTTL = 24 * time.Hour
)

// mintedRecovery is a freshly generated token in both of its forms: the
// plaintext to hand out exactly once, and the three columns to store.
type mintedRecovery struct {
	plain        string // "<selector>.<verifier>" — never persisted, never logged
	selector     string
	salt         string
	verifierHash string
}

// mintRecovery generates a token for purpose. Both halves and the salt come
// from crypto/rand; an error here is fatal to the request (fail closed —
// never fall back to a weaker source).
func mintRecovery(purpose store.RecoveryPurpose) (mintedRecovery, error) {
	sel, err := randB64(recoverySelectorBytes)
	if err != nil {
		return mintedRecovery{}, err
	}
	ver, err := randB64(recoveryVerifierBytes)
	if err != nil {
		return mintedRecovery{}, err
	}
	saltRaw := make([]byte, recoverySaltBytes)
	if _, err := rand.Read(saltRaw); err != nil {
		return mintedRecovery{}, err
	}
	salt := hex.EncodeToString(saltRaw)
	return mintedRecovery{
		plain:        sel + "." + ver,
		selector:     sel,
		salt:         salt,
		verifierHash: recoveryVerifierHash(purpose, salt, ver),
	}, nil
}

func randB64(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// recoveryVerifierHash is the one derivation both issuance and redemption
// use. Purpose is bound into the domain string (see this file's doc comment).
func recoveryVerifierHash(purpose store.RecoveryPurpose, salt, verifier string) string {
	h := sha256.New()
	h.Write([]byte(recoveryHashDomain + string(purpose)))
	h.Write([]byte{0})
	h.Write([]byte(salt))
	h.Write([]byte{0})
	h.Write([]byte(verifier))
	return hex.EncodeToString(h.Sum(nil))
}

// splitRecoveryToken splits "<selector>.<verifier>". A token with no
// separator, an empty half, or extra dots is rejected here rather than
// guessed at.
func splitRecoveryToken(tok string) (selector, verifier string, ok bool) {
	sel, ver, found := strings.Cut(strings.TrimSpace(tok), ".")
	if !found || sel == "" || ver == "" || strings.Contains(ver, ".") {
		return "", "", false
	}
	return sel, ver, true
}

// dummyRecoverySalt / dummyRecoveryHash keep the verifier comparison in
// lookupRecovery running even when no row was found, so "no such selector"
// and "wrong verifier" cost the same hash and the same constant-time compare.
var (
	dummyRecoverySalt = hex.EncodeToString(make([]byte, recoverySaltBytes))
	dummyRecoveryHash = recoveryVerifierHash(store.RecoveryPasswordReset, dummyRecoverySalt, "never-a-real-verifier")
)

// lookupRecovery resolves a presented plaintext token to its stored row, or
// reports failure — one indistinguishable failure, whatever went wrong.
//
// The shape matters: the hash and the constant-time compare execute on EVERY
// path, including "no such selector", against a dummy salt and dummy digest.
// A short-circuit return on the not-found branch would turn the endpoint into
// a timing oracle for which selectors exist.
//
// The Live() check is an early-out only. It is NOT the authority on whether
// the token may be spent — store.claimRecoveryToken's guarded UPDATE is, and
// deliberately so (check-then-act loses the double-redeem race). Callers must
// still handle ErrRecoveryTokenUnusable from the redemption itself.
func (s *Server) lookupRecovery(ctx context.Context, plain string, purpose store.RecoveryPurpose) (*store.RecoveryToken, bool) {
	selector, verifier, wellFormed := splitRecoveryToken(plain)
	if !wellFormed {
		// Still burn a comparable hash+compare before refusing.
		verifier = plain
	}

	var row *store.RecoveryToken
	salt, want := dummyRecoverySalt, dummyRecoveryHash
	if wellFormed {
		r, err := s.store.RecoveryTokenBySelector(ctx, selector, purpose)
		if err == nil {
			row, salt, want = r, r.Salt, r.VerifierHash
		} else if !errors.Is(err, store.ErrNotFound) {
			s.log.Error("recovery token lookup", "purpose", purpose, "err", err)
		}
	}

	got := recoveryVerifierHash(purpose, salt, verifier)
	match := subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
	if !match || row == nil || !wellFormed {
		return nil, false
	}
	if !row.Live(time.Now().Unix()) {
		return nil, false
	}
	return row, true
}

// writeInvalidToken is the single generic refusal every token failure gets.
// Centralised so no future edit can accidentally introduce a second, more
// talkative variant for one branch.
func writeInvalidToken(w http.ResponseWriter) {
	writeErr(w, http.StatusBadRequest, "invalid_token")
}

// recoveryMailer resolves the configured delivery seam, defaulting to the
// loud console mailer. See authmail.go for the (important) bound on when that
// default is acceptable.
func (s *Server) recoveryMailer() RecoveryMailer {
	if s.cfg.RecoveryMailer != nil {
		return s.cfg.RecoveryMailer
	}
	return &LogRecoveryMailer{Log: s.log, PublicURL: s.cfg.PublicURL}
}

// ---------------------------------------------------------------------------
// POST /v1/auth/forgot-password
// ---------------------------------------------------------------------------

type forgotPasswordReq struct {
	Email string `json:"email"`
}

// handleForgotPassword issues a password-reset token and hands it to the
// delivery seam. It NEVER reveals whether the address is known — see this
// file's doc comment for the enumeration argument and what is and is not
// equalised.
//
// Throttled per-IP on the register budget rather than the login one: this is
// an issuance endpoint (it causes a message to be sent and a row to be
// written), so it belongs with account creation, not with credential
// guessing. There is deliberately NO per-ACCOUNT counter here — one keyed on
// the submitted email would let anyone freeze a victim's ability to recover
// their own account by spraying requests at their address, which on a system
// that opens doors is a denial-of-entry primitive, not a nuisance.
func (s *Server) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "forgot_password_ip", s.cfg.AuthRateLimits.RegisterIPPerWindow) {
		return
	}
	var req forgotPasswordReq
	if !readJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		// Structural rejection only. A string that cannot be an address tells
		// an attacker nothing about who has an account, so this is not an
		// enumeration channel — but it must stay structural: never reject
		// because of anything learned from the database.
		writeErr(w, http.StatusBadRequest, "invalid_email")
		return
	}

	// Minted BEFORE the user lookup, unconditionally: the rand + SHA-256 cost
	// is paid whether or not the account exists.
	minted, err := mintRecovery(store.RecoveryPasswordReset)
	if err != nil {
		s.log.Error("mint recovery token", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	expiresAt := time.Now().Add(passwordResetTTL)

	u, uerr := s.store.UserByEmail(r.Context(), email)
	issued := uerr == nil && u.Status == "active"
	if issued {
		if _, err := s.store.CreateRecoveryToken(r.Context(), u.ID, store.RecoveryPasswordReset,
			minted.selector, minted.salt, minted.verifierHash, expiresAt.Unix()); err != nil {
			// Fail closed on the ISSUANCE side only — the caller still gets
			// the uniform response below, because a 500 that appears only for
			// real accounts is the exact oracle this endpoint must not be.
			s.log.Error("create recovery token", "err", err)
			issued = false
		}
	}
	if issued {
		if err := s.recoveryMailer().SendPasswordReset(r.Context(), u.Email, minted.plain, expiresAt); err != nil {
			// Swallowed by contract (RecoveryMailer's doc comment): a
			// delivery error visible to the requester is an oracle too.
			s.log.Error("send password reset", "err", err)
		}
	}

	// Audited in BOTH branches: an operator investigating an incident needs
	// to see recovery attempts against addresses that have no account just as
	// much as ones that do. allowed=false marks the no-account case. The
	// token itself is never in here.
	actor := ""
	target := ""
	if uerr == nil {
		actor, target = u.ID, u.ID
	}
	if err := s.store.WriteAdminAudit(r.Context(), actor, "password_reset_request", "user", target,
		issued, map[string]any{"email": email}); err != nil {
		s.log.Error("audit password_reset_request", "err", err)
	}

	// One response, always. 202: "accepted, and that is all you get".
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

// ---------------------------------------------------------------------------
// POST /v1/auth/reset-password
// ---------------------------------------------------------------------------

type resetPasswordReq struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// handleResetPassword spends a reset token and sets the new password. The
// spend and the write are one transaction inside the store (see
// store.RedeemPasswordReset) — this handler never checks a token and then
// separately applies a change.
//
// Password strength is validated BEFORE the token is touched, so a rejected
// weak password does not burn the user's one live token.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "reset_password_ip", s.cfg.AuthRateLimits.LoginIPPerWindow) {
		return
	}
	var req resetPasswordReq
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password")
		return
	}
	row, ok := s.lookupRecovery(r.Context(), req.Token, store.RecoveryPasswordReset)
	if !ok {
		writeInvalidToken(w)
		return
	}
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// The token's own row carries the user id. It is NEVER taken from the
	// request — a caller-supplied user id here would let a valid token be
	// pointed at somebody else's account.
	err = s.store.RedeemPasswordReset(r.Context(), row.ID, row.UserID, hash)
	switch {
	case errors.Is(err, store.ErrRecoveryTokenUnusable), errors.Is(err, store.ErrNotFound):
		// Lost the double-redeem race, or the account stopped being active
		// between lookup and redemption. Same refusal as a bad verifier.
		writeInvalidToken(w)
		return
	case err != nil:
		s.log.Error("redeem password reset", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), row.UserID, "password_reset_redeem", "user", row.UserID,
		true, map[string]any{"token_id": row.ID}); err != nil {
		s.log.Error("audit password_reset_redeem", "err", err)
	}
	// Sessions are already dead — killed inside the redemption transaction by
	// setPasswordTx, not by a second call out here that could be interrupted.
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------------------------------------------------------------------------
// POST /v1/auth/verify-email
// ---------------------------------------------------------------------------

type verifyEmailReq struct {
	Token string `json:"token"`
}

// handleVerifyEmail spends an email-verification token and stamps
// users.email_verified_at.
//
// NOTHING in this codebase mints these tokens yet — registration does not,
// because there is no real mailer to deliver them (authmail.go). The
// redemption side is here, complete and guarded, so that adding issuance is a
// one-call change rather than a security design; until then this endpoint
// answers every request with the same refusal an unknown token gets, which is
// the correct fail-closed behaviour, not a stub.
func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "verify_email_ip", s.cfg.AuthRateLimits.LoginIPPerWindow) {
		return
	}
	var req verifyEmailReq
	if !readJSON(w, r, &req) {
		return
	}
	row, ok := s.lookupRecovery(r.Context(), req.Token, store.RecoveryEmailVerify)
	if !ok {
		writeInvalidToken(w)
		return
	}
	err := s.store.RedeemEmailVerification(r.Context(), row.ID, row.UserID)
	switch {
	case errors.Is(err, store.ErrRecoveryTokenUnusable), errors.Is(err, store.ErrNotFound):
		writeInvalidToken(w)
		return
	case err != nil:
		s.log.Error("redeem email verification", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), row.UserID, "email_verify_redeem", "user", row.UserID,
		true, map[string]any{"token_id": row.ID}); err != nil {
		s.log.Error("audit email_verify_redeem", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------------------------------------------------------------------------
// POST /v1/auth/update-password
// ---------------------------------------------------------------------------

type updatePasswordReq struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// handleUpdatePassword changes the password of the AUTHENTICATED caller, and
// requires the CURRENT password to do it.
//
// Why the current password when the caller already holds a valid access
// token: this route must not be a quieter way to do what reset-password does.
// A stolen 15-minute access token (or a session left open on a shared
// machine) would otherwise be enough to change the password — which, because
// a password change ends every session, would simultaneously hand the account
// to the attacker and lock the owner out of the system that opens their gate.
// Requiring re-authentication turns a token leak into a bounded 15-minute
// problem instead of a permanent one.
//
// Two throttles, the same pair handleLogin uses and for the same reasons: the
// hard per-IP one, and a per-account soft cap that counts only FAILURES, so
// this cannot become an unmetered oracle for guessing the current password
// behind an access token. The account subject is the caller's own user id —
// unlike login's email-keyed counter, a stranger cannot reach it at all,
// because they would need a live token for that account first.
func (s *Server) handleUpdatePassword(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "update_password_ip", s.cfg.AuthRateLimits.LoginIPPerWindow) {
		return
	}
	c := claimsFrom(r)
	nowUnix := time.Now().Unix()
	acctSubject := "user:" + c.Sub
	over, retry, err := s.store.AuthAttemptsOverCap(r.Context(), "update_pw_acct", acctSubject,
		s.cfg.AuthRateLimits.LoginAccountPerWindow, nowUnix)
	if err != nil {
		s.log.Error("update-password rate limit check failed", "err", err)
		writeErr(w, http.StatusServiceUnavailable, "rate_limit_unavailable")
		return
	}
	if over {
		w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}

	var req updatePasswordReq
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password")
		return
	}
	u, err := s.store.UserByID(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if u.Status != "active" || u.PasswordHash == "" || !VerifyPassword(req.CurrentPassword, u.PasswordHash) {
		if ferr := s.store.RecordAuthFailure(r.Context(), "update_pw_acct", acctSubject, nowUnix); ferr != nil {
			s.log.Error("record auth failure", "err", ferr)
		}
		if aerr := s.store.WriteAdminAudit(r.Context(), u.ID, "password_update", "user", u.ID,
			false, map[string]any{"reason": "invalid_current_password"}); aerr != nil {
			s.log.Error("audit password_update", "err", aerr)
		}
		writeErr(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// SetUserPassword runs the same setPasswordTx a redeemed reset does: new
	// hash + every refresh token revoked + every live reset token invalidated,
	// in one transaction. That last part is what makes "I changed my password
	// because I think someone is in my mail" actually close the door.
	if err := s.store.SetUserPassword(r.Context(), u.ID, hash); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		s.log.Error("set user password", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), u.ID, "password_update", "user", u.ID,
		true, nil); err != nil {
		s.log.Error("audit password_update", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
