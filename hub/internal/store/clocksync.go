package store

// Proof that a controller's clock is fresh, and the report built on it.
//
// See migrations/0022_controller_clock_sync.sql for why an acked `ping` is the
// only thing the hub receives that proves a clock moved, and why last_seen_at
// is not.

import (
	"context"
	"database/sql"
)

// RecordPingDispatched remembers the nonce of a ping sent to a device, so the
// ack that comes back can be recognised as proof of a sync.
//
// Overwrites any previous pending nonce. That is deliberate: an unanswered ping
// is not an event to track, it is a controller that will be pinged again — and
// keeping a queue of outstanding nonces would mean deciding when to give up on
// one, a decision with no good answer and no consequence.
func (s *Store) RecordPingDispatched(ctx context.Context, deviceID, nonce string) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO controller_clock_syncs (device_id, pending_nonce, pending_at, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT (device_id) DO UPDATE SET
		     pending_nonce = excluded.pending_nonce,
		     pending_at    = excluded.pending_at,
		     updated_at    = excluded.updated_at`,
		deviceID, nonce, t, t)
	return err
}

// RecordAckIfPing records a clock sync when nonce matches the ping this device
// was waiting on, and reports whether it did.
//
// ok=false is the ordinary case — most acks are for opens and closes — so the
// caller treats it as nothing at all rather than as a failure.
//
// The nonce match is what makes this proof rather than a guess: a ping acks
// with result "ok", and so does a config, so keying on the result would count a
// config acknowledgement as a clock sync.
func (s *Store) RecordAckIfPing(ctx context.Context, deviceID, nonce string) (ok bool, err error) {
	if nonce == "" {
		return false, nil
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE controller_clock_syncs
		 SET synced_at = ?, pending_nonce = NULL, pending_at = NULL, updated_at = ?
		 WHERE device_id = ? AND pending_nonce = ?`,
		now(), now(), deviceID, nonce)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ClockFreshness is what the hub can honestly say about one controller's clock.
type ClockFreshness struct {
	DeviceID string
	Label    string
	// SyncedAt is when a ping was last PROVED processed, or nil when none ever
	// has been. Nil is a real answer: a controller that has never acked a ping
	// has never demonstrably synced since pairing.
	SyncedAt *int64
}

// ClockFreshnessByAccount reports every paired controller in an account,
// oldest-proof first, so a caller can name the ones approaching the limit.
//
// A LEFT JOIN, so a device with no row at all appears with SyncedAt nil rather
// than being omitted. Omitting it would hide exactly the controller that has
// never synced — the worst one to leave out of a staleness report.
func (s *Store) ClockFreshnessByAccount(ctx context.Context, accountID string) ([]ClockFreshness, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT d.id, coalesce(d.label, ''), c.synced_at
		 FROM devices d
		 JOIN locations l ON l.id = d.location_id
		 LEFT JOIN controller_clock_syncs c ON c.device_id = d.id
		 WHERE l.account_id = ? AND d.status = 'active' AND d.paired_at IS NOT NULL
		 ORDER BY c.synced_at IS NOT NULL, c.synced_at ASC, d.id ASC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClockFreshness
	for rows.Next() {
		var f ClockFreshness
		var synced sql.NullInt64
		if err := rows.Scan(&f.DeviceID, &f.Label, &synced); err != nil {
			return nil, err
		}
		if synced.Valid {
			v := synced.Int64
			f.SyncedAt = &v
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
