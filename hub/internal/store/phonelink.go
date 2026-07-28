package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// Phone linking (docs/PHONE-LINKING.md). See
// migrations/0018_phone_link_codes.sql for why this exists — briefly: every
// chat rail requires a verified phone, and until now nothing in production
// could produce one.

const (
	// PhoneLinkCodeTTL is the design's 10 minutes. Short because the code is
	// short: the window is the main thing standing between a 2^29 keyspace
	// and someone with time.
	PhoneLinkCodeTTL = 10 * 60

	// PhoneLinkMaxAttempts caps guessing against a single code.
	PhoneLinkMaxAttempts = 5

	// PhoneLinkMaxLivePerUser stops one account minting codes without bound.
	// Deliberately per USER, not per phone: a limit per phone would let an
	// attacker exhaust a victim's quota by minting codes against their
	// number, locking them out of a link they have not attempted yet.
	PhoneLinkMaxLivePerUser = 5

	// codeAlphabet omits 0/O/1/I/L — the code is read off a screen and typed
	// into a chat app by a person.
	codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

	// codeLen is the design's six characters.
	codeLen = 6

	// CodePrefix namespaces the code so it cannot be mistaken for a gate
	// command by the chat parser, or vice versa.
	CodePrefix = "LINK-"
)

var (
	// ErrPhoneLinkTooMany is the mint-side quota.
	ErrPhoneLinkTooMany = errors.New("too many live link codes")

	// ErrPhoneLinkNotFound covers every redemption failure that must look
	// identical from outside: unknown code, expired, consumed, attempts
	// exhausted, and — importantly — a real code sent from the wrong number.
	// Distinguishing them would tell a stranger which codes exist.
	ErrPhoneLinkNotFound = errors.New("no such link code")

	// ErrPhoneTakenByAnother is deliberately NOT folded into the above. The
	// design says this one fails loudly: the person redeeming has proven
	// control of the number, so telling them it is already linked elsewhere
	// leaks nothing they cannot discover by trying, and silence here would
	// look like a broken product rather than a support case.
	ErrPhoneTakenByAnother = errors.New("phone already verified to another profile")
)

// PhoneLinkCode is a minted, unspent code. The plaintext exists only in the
// return value of MintPhoneLinkCode; it is never stored and cannot be
// recovered afterwards.
type PhoneLinkCode struct {
	ID        string
	Code      string // plaintext, mint-time only
	PhoneE164 string
	ExpiresAt int64
}

// hashLinkCode is deterministic on purpose (see the migration's comment): the
// inbound chat message carries the code and nothing else, so there is no
// selector to look up a salted verifier by.
func hashLinkCode(code string) string {
	sum := sha256.Sum256([]byte("aql-phone-link-code-v1:" + NormalizeLinkCode(code)))
	return hex.EncodeToString(sum[:])
}

// NormalizeLinkCode uppercases, strips the prefix and removes separators, so
// "link-ab2 3cd", "LINK-AB23CD" and "ab23cd" are the same code. People retype
// these from a screen; being strict about case would generate support load
// and buy nothing, since the entropy is in the characters either way.
func NormalizeLinkCode(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, CodePrefix)
	return strings.NewReplacer(" ", "", "-", "", "_", "").Replace(s)
}

// LooksLikeLinkCode reports whether a chat message is plausibly a link code.
// Used by the channel side to decide whether to attempt a redemption at all,
// so that ordinary chatter is not treated as a guess and does not burn
// attempts.
func LooksLikeLinkCode(s string) bool {
	n := NormalizeLinkCode(s)
	if len(n) != codeLen {
		return false
	}
	for _, r := range n {
		if !strings.ContainsRune(codeAlphabet, r) {
			return false
		}
	}
	// Require the prefix on bare-looking input, so a six-character word in a
	// normal sentence is not treated as a code attempt. The prefix is what
	// the console tells the user to send.
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(s)), CodePrefix)
}

func randomCode() (string, error) {
	b := make([]byte, codeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, codeLen)
	for i, v := range b {
		// Modulo bias is negligible at 31 symbols over 256 values and the
		// entropy here is bounded by length, not by distribution.
		out[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	return string(out), nil
}

// MintPhoneLinkCode issues a code for (userID, phoneE164).
//
// Minting requires NO proof that the caller controls the number, and it does
// not need to: the code it produces can only ever be spent by that number.
// Requiring proof at mint time would be circular — proving control of the
// number is what the ceremony is for.
func (s *Store) MintPhoneLinkCode(ctx context.Context, userID, phoneE164 string) (*PhoneLinkCode, error) {
	if userID == "" || phoneE164 == "" {
		return nil, fmt.Errorf("phone link: missing user or phone")
	}
	t := now()

	// Refuse early if the number is already verified to someone else. The
	// unique index would catch it at redemption anyway, but failing at mint
	// time means the user is told before they go and message a bot.
	owner, err := s.verifiedOwnerOf(ctx, phoneE164)
	if err != nil {
		return nil, err
	}
	if owner != "" && owner != userID {
		return nil, ErrPhoneTakenByAnother
	}

	var live int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM phone_link_codes
		  WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ?`,
		userID, t).Scan(&live); err != nil {
		return nil, err
	}
	if live >= PhoneLinkMaxLivePerUser {
		return nil, ErrPhoneLinkTooMany
	}

	// Retry on the (astronomically unlikely) hash collision rather than
	// returning an error the caller cannot act on.
	for attempt := 0; attempt < 5; attempt++ {
		code, err := randomCode()
		if err != nil {
			return nil, err
		}
		id := NewID()
		expires := t + PhoneLinkCodeTTL
		_, err = s.db.ExecContext(ctx,
			`INSERT INTO phone_link_codes (id, user_id, phone_e164, code_hash, issued_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			id, userID, phoneE164, hashLinkCode(code), t, expires)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				continue
			}
			return nil, err
		}
		return &PhoneLinkCode{ID: id, Code: CodePrefix + code, PhoneE164: phoneE164, ExpiresAt: expires}, nil
	}
	return nil, fmt.Errorf("phone link: could not mint a unique code")
}

// RedeemPhoneLinkCode spends a code presented BY a phone number, and is the
// security core of the ceremony.
//
// The caller must have already established that senderPhone is genuine — for
// the chat rails that is the provider's signature on the inbound webhook,
// checked before routing. This function's job is the other half: that the
// code was minted FOR that exact number.
//
// That check is what makes minting safe. Without it, an attacker could mint a
// code against a victim's number and redeem it from their own handset,
// verifying someone else's number onto their own profile — the exact squatting
// attack that made invite-accept stop auto-verifying in the first place.
//
// Everything runs in one transaction: the attempt increment must not be lost
// if the redemption then fails, or the counter would be advisory.
func (s *Store) RedeemPhoneLinkCode(ctx context.Context, senderPhone, code string) (userID string, err error) {
	if senderPhone == "" {
		return "", ErrPhoneLinkNotFound
	}
	t := now()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var (
		id        string
		rowUser   string
		rowPhone  string
		expiresAt int64
		attempts  int
		consumed  sql.NullInt64
	)
	err = tx.QueryRowContext(ctx,
		`SELECT id, user_id, phone_e164, expires_at, attempts, consumed_at
		   FROM phone_link_codes WHERE code_hash = ?`, hashLinkCode(code)).
		Scan(&id, &rowUser, &rowPhone, &expiresAt, &attempts, &consumed)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", ErrPhoneLinkNotFound
	case err != nil:
		return "", err
	}

	// Count the attempt before judging it, and commit that count even on the
	// failure paths below.
	if _, err := tx.ExecContext(ctx,
		`UPDATE phone_link_codes SET attempts = attempts + 1 WHERE id = ?`, id); err != nil {
		return "", err
	}
	fail := func(e error) (string, error) {
		if cerr := tx.Commit(); cerr != nil {
			return "", cerr
		}
		return "", e
	}

	if consumed.Valid || expiresAt <= t || attempts >= PhoneLinkMaxAttempts {
		return fail(ErrPhoneLinkNotFound)
	}
	// THE check. A code is spendable only by the number it was minted for.
	if rowPhone != senderPhone {
		return fail(ErrPhoneLinkNotFound)
	}

	// Re-check ownership inside the transaction: a number can become verified
	// elsewhere between mint and redemption.
	var otherOwner string
	err = tx.QueryRowContext(ctx,
		`SELECT profile_id FROM profile_phone_numbers
		  WHERE phone_e164 = ? AND verified_at IS NOT NULL`, senderPhone).Scan(&otherOwner)
	switch {
	case err == nil && otherOwner != rowUser:
		return fail(ErrPhoneTakenByAnother)
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return "", err
	}

	// The shared primitive, not a copy of it: AddVerifiedPhone and this
	// ceremony must never disagree about what "verified" writes.
	if err := addVerifiedPhoneTx(ctx, tx, rowUser, senderPhone, t); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE phone_link_codes SET consumed_at = ? WHERE id = ?`, t, id); err != nil {
		return "", err
	}
	// Any other live code for this number is now moot; spend them so a
	// second handset cannot replay an older one.
	if _, err := tx.ExecContext(ctx,
		`UPDATE phone_link_codes SET consumed_at = ?
		  WHERE phone_e164 = ? AND consumed_at IS NULL`, t, senderPhone); err != nil {
		return "", err
	}

	if err := tx.Commit(); err != nil {
		return "", err
	}
	return rowUser, nil
}

// verifiedOwnerOf returns the profile that has this number verified, or "".
func (s *Store) verifiedOwnerOf(ctx context.Context, phoneE164 string) (string, error) {
	var owner string
	err := s.db.QueryRowContext(ctx,
		`SELECT profile_id FROM profile_phone_numbers
		  WHERE phone_e164 = ? AND verified_at IS NOT NULL`, phoneE164).Scan(&owner)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", nil
	case err != nil:
		return "", err
	}
	return owner, nil
}

// LinkedPhone is one row of the user's own phone list.
type LinkedPhone struct {
	ID        string `json:"id"`
	PhoneE164 string `json:"phone_e164"`
	Verified  bool   `json:"verified"`
	IsPrimary bool   `json:"is_primary"`
	CreatedAt int64  `json:"created_at"`
}

// PhonesForUser lists the user's linked numbers, verified or not. Unverified
// rows are shown rather than hidden: an invite-linked number that has never
// been verified is exactly what the console needs to prompt about.
func (s *Store) PhonesForUser(ctx context.Context, userID string) ([]LinkedPhone, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, phone_e164, verified_at IS NOT NULL, is_primary, created_at
		   FROM profile_phone_numbers WHERE profile_id = ?
		  ORDER BY is_primary DESC, created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []LinkedPhone{}
	for rows.Next() {
		var p LinkedPhone
		if err := rows.Scan(&p.ID, &p.PhoneE164, &p.Verified, &p.IsPrimary, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UnlinkPhone removes one of the caller's own numbers.
//
// Scoped by profile_id in the DELETE itself rather than by a prior read, so
// there is no window in which a row could change hands between the check and
// the delete, and no way for the handler to forget the ownership test.
func (s *Store) UnlinkPhone(ctx context.Context, userID, phoneID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM profile_phone_numbers WHERE id = ? AND profile_id = ?`, phoneID, userID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
