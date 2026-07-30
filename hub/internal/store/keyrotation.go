package store

// The bookkeeping half of gateway key rotation.
//
// See migrations/0023_gateway_key_rotation.sql for why two keys must be
// retained and why the pinned PUBLIC KEY is recorded rather than a generation
// number. The private halves never come near this package — they live in 0600
// files beside the database (hub/internal/keys/rotation.go).

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
)

// KeyRotation is one rotation, open or finished.
type KeyRotation struct {
	ID          string
	StartedAt   int64
	CompletedAt *int64
	PreviousPub string
	NewPub      string
	Reason      string
}

// DevicePin is what one controller is believed to pin.
type DevicePin struct {
	DeviceID string
	Label    string
	// PinnedPub is empty for a controller that has never been recorded, which
	// means it pins whatever was current when it paired. Every controller
	// paired before this feature existed is in that state, and the reader has
	// to treat it as "the current key" rather than as "unknown".
	PinnedPub string
	// Repaired is true when PinnedPub is the rotation's new key.
	Repaired bool
	// PendingSince is when a repair was last dispatched and not yet
	// acknowledged, nil if none is outstanding.
	PendingSince *int64
}

// ErrNoOpenRotation reports that no rotation is in flight.
var ErrNoOpenRotation = errors.New("store: no key rotation is in flight")

// BeginKeyRotation records a rotation that has already happened to the seeds on
// disk.
//
// Called after keys.Rotate succeeds, never before: the file move is the
// irreversible step, and a row claiming a rotation that did not happen would
// have the hub trying to sign with a key it does not hold.
func (s *Store) BeginKeyRotation(ctx context.Context, id, previousPub, newPub, reason string) (KeyRotation, error) {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO gateway_key_rotations (id, started_at, completed_at, previous_pub, new_pub, reason)
		 VALUES (?, ?, NULL, ?, ?, ?)`,
		id, t, previousPub, newPub, reason)
	if err != nil {
		return KeyRotation{}, err
	}
	// Every controller that has no pin recorded was pinning the key that just
	// became the previous one — that is what "current" meant until a moment
	// ago. Writing it now turns an implicit fact into a checkable one, and it
	// is the difference between "this controller has not been repaired" and
	// "nothing is known about this controller".
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO device_key_pins (device_id, pinned_pub, pending_nonce, pending_at, updated_at)
		 SELECT id, ?, NULL, NULL, ? FROM devices
		  WHERE status = 'active' AND paired_at IS NOT NULL
		 ON CONFLICT (device_id) DO NOTHING`,
		previousPub, t)
	if err != nil {
		return KeyRotation{}, err
	}
	return KeyRotation{ID: id, StartedAt: t, PreviousPub: previousPub, NewPub: newPub, Reason: reason}, nil
}

// OpenKeyRotation returns the rotation in flight, if any.
func (s *Store) OpenKeyRotation(ctx context.Context) (KeyRotation, error) {
	var r KeyRotation
	err := s.db.QueryRowContext(ctx,
		`SELECT id, started_at, completed_at, previous_pub, new_pub, reason
		   FROM gateway_key_rotations WHERE completed_at IS NULL
		  ORDER BY started_at DESC LIMIT 1`).
		Scan(&r.ID, &r.StartedAt, &r.CompletedAt, &r.PreviousPub, &r.NewPub, &r.Reason)
	if errors.Is(err, sql.ErrNoRows) {
		return KeyRotation{}, ErrNoOpenRotation
	}
	return r, err
}

// PinnedKey returns the public key a device is believed to pin, or "" when
// nothing has been recorded for it.
func (s *Store) PinnedKey(ctx context.Context, deviceID string) (string, error) {
	var pub string
	err := s.db.QueryRowContext(ctx,
		`SELECT pinned_pub FROM device_key_pins WHERE device_id = ?`, deviceID).Scan(&pub)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return pub, err
}

// RecordRepairDispatched remembers the nonce of a repair sent to a device.
//
// The nonce is what makes the acknowledgement proof rather than a guess: an
// ack's result is "ok" for every command kind, so without correlating it the
// hub could record a controller as repaired on the strength of it acking the
// lift that happened to follow. It would then stop signing with the key that
// controller still pins, which is the one failure this whole feature exists to
// avoid.
func (s *Store) RecordRepairDispatched(ctx context.Context, deviceID, nonce string) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE device_key_pins SET pending_nonce = ?, pending_at = ?, updated_at = ?
		  WHERE device_id = ?`,
		nonce, t, t, deviceID)
	return err
}

// RecordRepairAck moves a device onto newPub when nonce matches the repair it
// was waiting on, and reports whether it did.
//
// ok=false is the ordinary case — most acks are for opens — so a caller treats
// it as nothing at all rather than as a failure.
func (s *Store) RecordRepairAck(ctx context.Context, deviceID, nonce, newPub string) (bool, error) {
	if nonce == "" {
		// An empty nonce would match every row whose pending_nonce is also
		// empty. Nothing writes an empty pending nonce, but a rotation is not
		// the place to rely on that.
		return false, nil
	}
	t := now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE device_key_pins
		    SET pinned_pub = ?, pending_nonce = NULL, pending_at = NULL, updated_at = ?
		  WHERE device_id = ? AND pending_nonce = ?`,
		newPub, t, deviceID, nonce)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// DevicePins reports what every paired controller pins, for the rotation's
// progress view.
//
// A LEFT JOIN from devices, so a controller with no row still appears. A
// rotation whose report silently omitted the controllers it had not reached
// would show "all done" precisely when it was least true.
func (s *Store) DevicePins(ctx context.Context, newPub string) ([]DevicePin, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT d.id, COALESCE(d.label, ''), COALESCE(p.pinned_pub, ''), p.pending_at
		   FROM devices d
		   LEFT JOIN device_key_pins p ON p.device_id = d.id
		  WHERE d.status = 'active' AND d.paired_at IS NOT NULL
		  ORDER BY (COALESCE(p.pinned_pub, '') = ?) ASC, d.id ASC`, newPub)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DevicePin
	for rows.Next() {
		var p DevicePin
		if err := rows.Scan(&p.DeviceID, &p.Label, &p.PinnedPub, &p.PendingSince); err != nil {
			return nil, err
		}
		p.Repaired = p.PinnedPub == newPub
		out = append(out, p)
	}
	return out, rows.Err()
}

// CompleteKeyRotation closes the rotation.
//
// Refuses while any controller still pins the old key, and says how many.
// The check is here, in the same statement's transaction as the write, rather
// than in the caller: a check followed by a separate write is a window in which
// a controller can be paired, and pairing during a rotation is exactly when
// someone is most likely to be plugging things in.
func (s *Store) CompleteKeyRotation(ctx context.Context, id, newPub string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var remaining int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM devices d
		   LEFT JOIN device_key_pins p ON p.device_id = d.id
		  WHERE d.status = 'active' AND d.paired_at IS NOT NULL
		    AND COALESCE(p.pinned_pub, '') <> ?`, newPub).Scan(&remaining); err != nil {
		return err
	}
	if remaining > 0 {
		return &RotationIncompleteError{Remaining: remaining}
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE gateway_key_rotations SET completed_at = ? WHERE id = ? AND completed_at IS NULL`,
		now(), id); err != nil {
		return err
	}
	return tx.Commit()
}

// RotationIncompleteError reports controllers still pinning the old key.
type RotationIncompleteError struct{ Remaining int }

func (e *RotationIncompleteError) Error() string {
	return "store: " + strconv.Itoa(e.Remaining) + " controller(s) still pin the previous key"
}

// OfflineGrantsIssuedSince counts offline grants minted at or after `since`.
//
// An UPPER BOUND on how many would stop working if the signing key rotated, not
// an exact figure, and the caller is expected to say so.
//
// Offline grants are not rows. They are signed, handed to a phone, and verified
// at a gate by a controller with no network — the hub keeps no record of which
// are still held, because there is nothing to keep: a grant lives in an
// IndexedDB on someone's phone until it expires. What the hub does have is the
// audit entry written when each was issued, and every grant expires no later
// than keys.DefaultGrantTTL after that.
//
// So counting issuances inside one TTL window bounds the damage from above. It
// over-counts grants already superseded, revoked at the membership level, or
// sitting on a phone that was factory reset — none of which the hub can see. It
// cannot under-count, which is the direction that matters when the number is
// there to warn somebody.
func (s *Store) OfflineGrantsIssuedSince(ctx context.Context, since int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM admin_audit_log
		  WHERE action = 'offline_grant_issue' AND allowed = 1 AND created_at >= ?`,
		since).Scan(&n)
	return n, err
}
