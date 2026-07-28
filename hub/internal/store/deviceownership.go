package store

// Device ownership — the claim that tells the engine whose a device is.
//
// See migrations/0021_device_ownership.sql for the model and why it is an
// assertion rather than an inference. This file is the access layer, and its
// whole job is that every read is scoped by account and every write is
// first-claim-wins.

import (
	"context"
	"errors"
)

var (
	// ErrDeviceAlreadyClaimed — the device is owned, by this account or
	// another. Deliberately NOT distinguished at this layer: telling an
	// unrelated caller "that belongs to someone else" confirms the existence
	// of a device on an account they cannot see. The handler decides what to
	// reveal to whom.
	ErrDeviceAlreadyClaimed = errors.New("store: device already claimed")

	// ErrDeviceNotClaimed — no claim exists for this key.
	ErrDeviceNotClaimed = errors.New("store: device not claimed")
)

// DeviceClaim is one row: who owns a device key, and the label recorded when
// the claim was made.
type DeviceClaim struct {
	DeviceKey string
	AccountID string
	ClaimedBy string // "" when the claiming user has since been deleted
	Label     string
	ClaimedAt int64
}

// ClaimDevice records that accountID owns deviceKey.
//
// First claim wins, enforced by the primary key rather than by a check-then-
// insert, which would race two admins claiming the same device at once and
// leave whichever wrote second silently owning it.
//
// A re-claim by the SAME account is idempotent and returns nil: an admin who
// clicks twice, or a client that retries a request whose response it lost,
// has not done anything wrong and should not be told they have.
func (s *Store) ClaimDevice(ctx context.Context, deviceKey, accountID, userID, label string) error {
	t := now()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO device_ownership (device_key, account_id, claimed_by, label, claimed_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (device_key) DO UPDATE SET
		     label = excluded.label, updated_at = excluded.updated_at
		   WHERE device_ownership.account_id = excluded.account_id`,
		deviceKey, accountID, nullable(userID), label, t, t)
	if err != nil {
		return err
	}
	// Zero rows means the ON CONFLICT's WHERE excluded the update: the row
	// exists and belongs to a DIFFERENT account. That is the takeover attempt
	// the primary key exists to refuse.
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrDeviceAlreadyClaimed
	}
	return nil
}

// ReleaseDevice removes a claim, scoped to the owning account so one account
// cannot release another's device.
func (s *Store) ReleaseDevice(ctx context.Context, deviceKey, accountID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM device_ownership WHERE device_key = ? AND account_id = ?`,
		deviceKey, accountID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Either unclaimed or claimed by somebody else. Same error for both,
		// for the reason ErrDeviceAlreadyClaimed gives.
		return ErrDeviceNotClaimed
	}
	return nil
}

// DeviceKeysForAccount is every device key this account has claimed.
//
// Returned as a set because the caller filters a live fleet against it, and a
// fleet on a busy hub is long enough that a linear scan per device would be
// the wrong shape even if it were fast enough today.
func (s *Store) DeviceKeysForAccount(ctx context.Context, accountID string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT device_key FROM device_ownership WHERE account_id = ?`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}

// ClaimedDeviceKeys is every key claimed by ANY account.
//
// The engine needs this to answer "which of these devices are unclaimed", and
// an unclaimed device is the only kind a new account may claim. It carries no
// account ids: a caller deciding what to offer for claiming must not learn who
// owns what.
func (s *Store) ClaimedDeviceKeys(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT device_key FROM device_ownership`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}
