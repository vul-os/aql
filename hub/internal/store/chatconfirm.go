package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"sort"
	"strconv"
	"strings"
)

// Pending chat confirmations — docs/CHAT-COMMANDS.md §3.4, migration 0027.

// ErrConfirmationNotFound is returned when a token is unknown, expired, spent,
// or belongs to another subject or conversation.
//
// ONE error for all of those, deliberately. Distinguishing "expired" from
// "wrong subject" in the reply tells whoever is guessing which half they got
// right, and none of the distinctions help a member who simply waited too long
// — for them the answer is the same in every case: ask again.
var ErrConfirmationNotFound = errors.New("confirmation not found")

// ConfirmationTTL is §3.4's 60 s.
const ConfirmationTTL = 60

// PendingConfirmation is a minted, unspent confirmation.
type PendingConfirmation struct {
	Token      string
	Subject    string
	Channel    string
	ChatID     string
	IntentHash string
	DeviceKey  string
	Verb       string
	ExpiresAt  int64
}

// IntentHash is the binding §3.4 requires: a confirmation for "start the mower"
// cannot confirm "unlock the front door".
//
// Over the RESOLVED intent — the device key the resolver produced, the
// canonical verb, and the arguments — never over the message text. Two bodies
// that resolve to the same action produce the same hash, which is correct: the
// member may re-word their confirmation, and what is being authorized is the
// action, not the sentence.
//
// Arguments are sorted before hashing so map iteration order cannot make the
// same intent hash two ways. Fields are length-prefixed rather than joined by a
// separator, so no combination of key and value can be re-split into different
// fields — "a:b" with key "c" must not collide with "a" and key "b:c".
func IntentHash(deviceKey, verb string, args map[string]float64) string {
	h := sha256.New()
	write := func(s string) {
		h.Write([]byte(strconv.Itoa(len(s))))
		h.Write([]byte(":"))
		h.Write([]byte(s))
	}
	write(deviceKey)
	write(verb)
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		write(k)
		write(strconv.FormatFloat(args[k], 'g', -1, 64))
	}
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// MintConfirmation issues a one-time token for a resolved intent.
//
// Any confirmation this subject already holds is spent first. A member holding
// two live tokens for two different devices has no way to tell which is which
// — the tokens are opaque by design — so the most recent request is the one
// that stands, and an older one silently ceasing to work is better than one
// that authorizes a device the member has stopped thinking about.
func (s *Store) MintConfirmation(ctx context.Context, p PendingConfirmation, nowUnix int64) (string, error) {
	// Prefixed so ConfirmationTokenIn can find it in a message that also
	// carries words. Without the prefix the scanner would have to treat every
	// word as a possible token, and every message as a redemption attempt.
	token := ConfirmationPrefix + strings.ToUpper(strings.ReplaceAll(NewID(), "-", ""))[:10]
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`UPDATE chat_confirmations SET used_at = ? WHERE subject = ? AND used_at IS NULL`,
		nowUnix, p.Subject); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO chat_confirmations
		   (token, subject, channel, chat_id, intent_hash, device_key, verb, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		token, p.Subject, p.Channel, p.ChatID, p.IntentHash, p.DeviceKey, p.Verb,
		nowUnix, nowUnix+ConfirmationTTL); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return token, nil
}

// RedeemConfirmation spends a token, or refuses.
//
// Every condition §3.4 names is in the WHERE of a single UPDATE: the token, the
// subject, the conversation, unspent, unexpired. That is not brevity — it is
// the atomicity. Two deliveries of the same confirming message race inside one
// statement and exactly one wins, where a SELECT-then-UPDATE would let both
// through and actuate twice. For a confirmation that is the whole failure,
// because the second message IS the authorization.
//
// The intent hash is checked by the CALLER against a freshly resolved intent
// rather than passed in here, and that ordering matters: the caller must
// re-resolve at redemption time and compare, so a fleet that changed between
// the two messages cannot have a stale token pointing at a device that has
// moved. This returns what the token was minted for; deciding whether that is
// still what the member is asking for is not the store's judgement to make.
func (s *Store) RedeemConfirmation(ctx context.Context, token, subject, channel, chatID string, nowUnix int64) (PendingConfirmation, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE chat_confirmations SET used_at = ?
		 WHERE token = ? AND subject = ? AND channel = ? AND chat_id = ?
		   AND used_at IS NULL AND expires_at > ?`,
		nowUnix, token, subject, channel, chatID, nowUnix)
	if err != nil {
		return PendingConfirmation{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return PendingConfirmation{}, err
	}
	if n == 0 {
		return PendingConfirmation{}, ErrConfirmationNotFound
	}

	var p PendingConfirmation
	if err := s.db.QueryRowContext(ctx,
		`SELECT token, subject, channel, chat_id, intent_hash, device_key, verb, expires_at
		   FROM chat_confirmations WHERE token = ?`, token).
		Scan(&p.Token, &p.Subject, &p.Channel, &p.ChatID, &p.IntentHash, &p.DeviceKey, &p.Verb, &p.ExpiresAt); err != nil {
		if err == sql.ErrNoRows {
			return PendingConfirmation{}, ErrConfirmationNotFound
		}
		return PendingConfirmation{}, err
	}
	return p, nil
}

// ConfirmationTokenIn extracts a token from a message body, returning it in the
// canonical (upper) case the token was minted in.
//
// Tokens are looked for anywhere in the body rather than requiring the message
// to be the token alone: rails add quoting, autocorrect adds punctuation, and a
// member replying to a prompt often types "yes OK-…". The prefix is what makes
// that safe to scan for — an id with no prefix would match arbitrary words and
// turn every message into a redemption attempt.
//
// # Case-insensitive, and that is not a nicety
//
// Every rail normalises an inbound body with channels.NormalizeText, which
// LOWERCASES it. A case-sensitive scan therefore matched nothing a member could
// actually send: the first version of this failed to find its own minted token
// in the very next message, so a T2 command answered a confirmation with a
// fresh confirmation, forever. The store tests passed throughout because they
// carried the raw token; only a test driving the real webhook could see it.
func ConfirmationTokenIn(body string) (string, bool) {
	for _, w := range strings.FieldsFunc(body, func(r rune) bool {
		return !(r == '-' || r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'))
	}) {
		if len(w) > len(ConfirmationPrefix) && strings.EqualFold(w[:len(ConfirmationPrefix)], ConfirmationPrefix) {
			return strings.ToUpper(w), true
		}
	}
	return "", false
}

// ConfirmationPrefix marks a token in a message. Uppercase and hyphenated so it
// survives a rail's autocorrect and reads as a code rather than a word.
const ConfirmationPrefix = "OK-"
