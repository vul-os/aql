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

// Channel identity linking. See migrations/0020_channel_link_codes.sql for
// why this is a separate mechanism from 0018's phone codes rather than a
// parameter on the same one — briefly: a phone code names its target and can
// therefore be short, and a channel code cannot name its target and therefore
// cannot be.

const (
	// ChannelLinkCodeTTL matches the phone flow. Ten minutes is short enough
	// that a code is a live secret rather than a stored one.
	ChannelLinkCodeTTL = 10 * 60

	// ChannelLinkMaxAttempts caps guessing against one code.
	ChannelLinkMaxAttempts = 5

	// ChannelLinkMaxLivePerUser bounds minting.
	ChannelLinkMaxLivePerUser = 5

	// channelCodeLen is TWICE the phone flow's length, and that is the single
	// most important line in this file. A phone code is spendable only by the
	// number it names, so possession of the handset carries most of the
	// security and six characters is enough. A channel code names nothing —
	// whoever sends it gets bound — so the code alone stands between a
	// stranger and someone else's gate access.
	//
	// 31^12 is about 2^59. 31^6 is about 2^29, which a determined stranger
	// could work through inside a ten-minute window.
	channelCodeLen = 12
)

var (
	ErrChannelLinkTooMany = errors.New("too many live channel link codes")

	// ErrChannelLinkNotFound covers unknown, expired, consumed, exhausted and
	// wrong-channel alike. Distinguishing them would tell a stranger which
	// codes exist.
	ErrChannelLinkNotFound = errors.New("no such channel link code")

	// ErrChannelIdentityTaken is loud for the same reason its phone
	// counterpart is: the sender has proven control of the account, so they
	// are entitled to know it is already spoken for.
	ErrChannelIdentityTaken = errors.New("channel identity already linked to another profile")
)

// ChannelLinkCode is a minted, unspent code. The plaintext exists only in the
// return value of MintChannelLinkCode.
type ChannelLinkCode struct {
	ID        string
	Code      string // plaintext, mint-time only
	Channel   string
	ExpiresAt int64
}

func hashChannelCode(channel, code string) string {
	// The channel is folded into the digest, so a code minted for Telegram
	// cannot be looked up — let alone spent — on Slack. Doing this in the
	// hash rather than as a WHERE clause means there is no path that forgets
	// to compare it.
	sum := sha256.Sum256([]byte("aql-channel-link-code-v1:" + channel + ":" + NormalizeLinkCode(code)))
	return hex.EncodeToString(sum[:])
}

// LooksLikeChannelLinkCode reports whether a message is plausibly a channel
// link code, so that ordinary chatter is not treated as a guess.
func LooksLikeChannelLinkCode(s string) bool {
	n := NormalizeLinkCode(s)
	if len(n) != channelCodeLen {
		return false
	}
	for _, r := range n {
		if !strings.ContainsRune(codeAlphabet, r) {
			return false
		}
	}
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(s)), CodePrefix)
}

func randomChannelCode() (string, error) {
	b := make([]byte, channelCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, channelCodeLen)
	for i, v := range b {
		out[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	// Grouped for reading off a screen; NormalizeLinkCode strips the dashes.
	s := string(out)
	return s[0:4] + "-" + s[4:8] + "-" + s[8:12], nil
}

// MintChannelLinkCode issues a code the caller can send on `channel`.
func (s *Store) MintChannelLinkCode(ctx context.Context, userID, channel string) (*ChannelLinkCode, error) {
	if userID == "" || channel == "" {
		return nil, fmt.Errorf("channel link: missing user or channel")
	}
	t := now()

	var live int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM channel_link_codes
		  WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ?`,
		userID, t).Scan(&live); err != nil {
		return nil, err
	}
	if live >= ChannelLinkMaxLivePerUser {
		return nil, ErrChannelLinkTooMany
	}

	for attempt := 0; attempt < 5; attempt++ {
		code, err := randomChannelCode()
		if err != nil {
			return nil, err
		}
		id := NewID()
		expires := t + ChannelLinkCodeTTL
		_, err = s.db.ExecContext(ctx,
			`INSERT INTO channel_link_codes (id, user_id, channel, code_hash, issued_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			id, userID, channel, hashChannelCode(channel, code), t, expires)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				continue
			}
			return nil, err
		}
		return &ChannelLinkCode{ID: id, Code: CodePrefix + code, Channel: channel, ExpiresAt: expires}, nil
	}
	return nil, fmt.Errorf("channel link: could not mint a unique code")
}

// RedeemChannelLinkCode binds (channel, externalID) to the profile that minted
// the code.
//
// Unlike the phone flow there is no target to check the sender against — the
// sender's id is the thing being learned. That asymmetry is why the code is
// long (see the migration), and why this function is careful about the two
// things it CAN check: that the code was minted for this exact channel, and
// that the identity is not already someone else's.
func (s *Store) RedeemChannelLinkCode(ctx context.Context, channel, externalID, code string) (userID string, err error) {
	if channel == "" || externalID == "" {
		return "", ErrChannelLinkNotFound
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
		expiresAt int64
		attempts  int
		consumed  sql.NullInt64
	)
	err = tx.QueryRowContext(ctx,
		`SELECT id, user_id, expires_at, attempts, consumed_at
		   FROM channel_link_codes WHERE code_hash = ?`, hashChannelCode(channel, code)).
		Scan(&id, &rowUser, &expiresAt, &attempts, &consumed)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", ErrChannelLinkNotFound
	case err != nil:
		return "", err
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE channel_link_codes SET attempts = attempts + 1 WHERE id = ?`, id); err != nil {
		return "", err
	}
	fail := func(e error) (string, error) {
		if cerr := tx.Commit(); cerr != nil {
			return "", cerr
		}
		return "", e
	}

	if consumed.Valid || expiresAt <= t || attempts >= ChannelLinkMaxAttempts {
		return fail(ErrChannelLinkNotFound)
	}

	// An identity belongs to one profile. Rebinding it silently would move a
	// member's gate access to whoever redeemed last.
	var existing string
	err = tx.QueryRowContext(ctx,
		`SELECT profile_id FROM channel_identities WHERE channel = ? AND external_id = ?`,
		channel, externalID).Scan(&existing)
	switch {
	case err == nil && existing != rowUser:
		return fail(ErrChannelIdentityTaken)
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return "", err
	}

	// The shared primitive, not a copy of it.
	if err := linkChannelIdentityTx(ctx, tx, channel, externalID, rowUser, t); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE channel_link_codes SET consumed_at = ? WHERE id = ?`, t, id); err != nil {
		return "", err
	}

	if err := tx.Commit(); err != nil {
		return "", err
	}
	return rowUser, nil
}

// ChannelIdentity is one linked platform account.
type ChannelIdentity struct {
	Channel    string `json:"channel"`
	ExternalID string `json:"external_id"`
	CreatedAt  int64  `json:"created_at"`
}

// ChannelIdentitiesForUser lists the caller's linked platform accounts.
func (s *Store) ChannelIdentitiesForUser(ctx context.Context, userID string) ([]ChannelIdentity, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT channel, external_id, created_at FROM channel_identities
		  WHERE profile_id = ? ORDER BY channel ASC, created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ChannelIdentity{}
	for rows.Next() {
		var c ChannelIdentity
		if err := rows.Scan(&c.Channel, &c.ExternalID, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UnlinkChannelIdentity removes one of the caller's own identities. Scoped by
// profile_id in the DELETE itself, so another member's row is unreachable and
// indistinguishable from one that does not exist.
func (s *Store) UnlinkChannelIdentity(ctx context.Context, userID, channel, externalID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM channel_identities WHERE channel = ? AND external_id = ? AND profile_id = ?`,
		channel, externalID, userID)
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
