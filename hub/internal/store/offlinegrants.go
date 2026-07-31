package store

import (
	"context"
	"database/sql"
)

// Issued offline grants and the deny-list built from them — migration 0030,
// docs/GRANT-REVOCATION.md.

// OfflineGrant is one issued grant, as the hub remembers it.
type OfflineGrant struct {
	GrantID string
	// MemberUserID is the holder's user id, always present. Written to BOTH
	// member columns: the FK so a live join works, the snapshot so deleting
	// the user cannot erase which grant belonged to whom — 0010's
	// created_by/created_by_snapshot pattern, for the same reason. Reads take
	// it from the snapshot, which is the one that cannot become NULL.
	MemberUserID string
	// MemberLinked is false once the user row is gone. Nothing depends on it
	// today; it exists so a caller can tell "no such user any more" from "this
	// grant never named one", which the snapshot alone cannot.
	MemberLinked bool
	IssuedAt     int64
	ExpiresAt    int64
	RevokedAt    sql.NullInt64
	RevokedBy    sql.NullString
	Devices      []string
}

// Revoked reports whether this grant has been revoked.
func (g OfflineGrant) Revoked() bool { return g.RevokedAt.Valid }

// RecordOfflineGrant remembers a grant the hub has just signed.
//
// Called AFTER signing rather than before: a grant that failed to sign was
// never issued and must not appear in a list of things that can be revoked.
// The reverse ordering would make the deny-list a superset of reality, which is
// harmless for safety and confusing for an operator reading it.
func (s *Store) RecordOfflineGrant(ctx context.Context, g OfflineGrant) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO offline_grants
		   (grant_id, member_user_id, member_snapshot, issued_at, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		g.GrantID, nullable(g.MemberUserID), g.MemberUserID, g.IssuedAt, g.ExpiresAt, now()); err != nil {
		return err
	}
	for _, d := range g.Devices {
		if d == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO offline_grant_devices (grant_id, device_id) VALUES (?, ?)`,
			g.GrantID, d); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RevokeOfflineGrant marks a grant revoked and bumps the deny-list counter, in
// one transaction.
//
// The two belong together. A revocation recorded without a new `seq` produces a
// deny-list a controller will refuse as stale — the revocation would be
// invisible to the one thing that enforces it — and a bumped `seq` with no
// revocation makes controllers re-accept a list that says nothing new. Either
// half alone is worse than neither.
//
// Revoking an already-revoked grant returns ErrNotFound and does NOT bump the
// counter, so a repeated click cannot walk the sequence forward and force
// pointless redeliveries.
func (s *Store) RevokeOfflineGrant(ctx context.Context, grantID, byUserID string) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`UPDATE offline_grants SET revoked_at = ?, revoked_by = ?
		  WHERE grant_id = ? AND revoked_at IS NULL`,
		now(), nullable(byUserID), grantID)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if n == 0 {
		return 0, ErrNotFound
	}
	seq, err := bumpRevocationSeq(ctx, tx)
	if err != nil {
		return 0, err
	}
	// The sequence this grant joined the deny-list at (migration 0032), in the
	// SAME transaction. Recorded apart from the bump because it answers a
	// different question: the counter says how current a controller is, this
	// says whether a controller has THIS revocation — and a gate can have one
	// while being behind on the other.
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO offline_grant_revoked_at (grant_id, seq) VALUES (?, ?)
		 ON CONFLICT (grant_id) DO UPDATE SET seq = excluded.seq`,
		grantID, seq); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return seq, nil
}

// bumpRevocationSeq increments the single-row counter and returns the new
// value. Read-and-write inside the caller's transaction, so two concurrent
// revocations cannot both read the same seq and hand it to two different lists.
func bumpRevocationSeq(ctx context.Context, tx *sql.Tx) (int64, error) {
	if _, err := tx.ExecContext(ctx,
		`UPDATE offline_grant_revocation_seq SET seq = seq + 1 WHERE id = 1`); err != nil {
		return 0, err
	}
	var seq int64
	if err := tx.QueryRowContext(ctx,
		`SELECT seq FROM offline_grant_revocation_seq WHERE id = 1`).Scan(&seq); err != nil {
		return 0, err
	}
	return seq, nil
}

// RevocationSeq returns the current counter without advancing it, for a
// redelivery that carries the list as it already stands.
func (s *Store) RevocationSeq(ctx context.Context) (int64, error) {
	var seq int64
	err := s.db.QueryRowContext(ctx,
		`SELECT seq FROM offline_grant_revocation_seq WHERE id = 1`).Scan(&seq)
	return seq, err
}

// RevocationEntry is one line of a deny-list.
type RevocationEntry struct {
	GrantID string
	EXP     int64
}

// DenyListForDevice returns the revoked, not-yet-expired grants that name one
// controller.
//
// Scoped by DEVICE rather than by account, because a grant can name access
// points in more than one account and the device is the only thing that decides
// whether a given controller will ever be asked about it. Sending an account's
// whole list to every controller would also tell each one about grants for
// gates it does not serve.
//
// `now` drops entries already past their expiry: such a grant is refused by the
// controller's validity step anyway, so carrying it wastes wire and storage on
// both sides. This is what keeps the list bounded by the TTL window rather than
// by how long the hub has been running.
func (s *Store) DenyListForDevice(ctx context.Context, deviceID string, now int64) ([]RevocationEntry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT g.grant_id, g.expires_at
		   FROM offline_grants g
		   JOIN offline_grant_devices d ON d.grant_id = g.grant_id
		  WHERE d.device_id = ?
		    AND g.revoked_at IS NOT NULL
		    AND g.expires_at >= ?
		  ORDER BY g.grant_id`, deviceID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RevocationEntry{}
	for rows.Next() {
		var e RevocationEntry
		if err := rows.Scan(&e.GrantID, &e.EXP); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// OfflineGrantsForMember lists what one member holds, newest first, for the
// console. Expired grants are included: "this expired yesterday" is an answer
// an operator asking "what did they have" needs.
func (s *Store) OfflineGrantsForMember(ctx context.Context, memberUserID string) ([]OfflineGrant, error) {
	// Matched on the SNAPSHOT, not the foreign key. A member whose user row was
	// deleted still held grants, and an operator asking what they held must not
	// get an empty answer because the account was tidied up first.
	rows, err := s.db.QueryContext(ctx,
		`SELECT grant_id, member_user_id, member_snapshot, issued_at, expires_at,
		        revoked_at, revoked_by
		   FROM offline_grants WHERE member_snapshot = ?
		  ORDER BY expires_at DESC`, memberUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OfflineGrant
	for rows.Next() {
		var g OfflineGrant
		var live sql.NullString
		if err := rows.Scan(&g.GrantID, &live, &g.MemberUserID, &g.IssuedAt, &g.ExpiresAt,
			&g.RevokedAt, &g.RevokedBy); err != nil {
			return nil, err
		}
		g.MemberLinked = live.Valid
		out = append(out, g)
	}
	return out, rows.Err()
}

// OfflineGrantByID reads one grant and the controllers it names.
//
// Returns both together because every caller needs both: the grant to decide
// whether it may be revoked, the devices to know who must be told.
func (s *Store) OfflineGrantByID(ctx context.Context, grantID string) (OfflineGrant, []string, error) {
	var g OfflineGrant
	var live sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT grant_id, member_user_id, member_snapshot, issued_at, expires_at,
		        revoked_at, revoked_by
		   FROM offline_grants WHERE grant_id = ?`, grantID).
		Scan(&g.GrantID, &live, &g.MemberUserID, &g.IssuedAt, &g.ExpiresAt, &g.RevokedAt, &g.RevokedBy)
	if err == sql.ErrNoRows {
		return OfflineGrant{}, nil, ErrNotFound
	}
	if err != nil {
		return OfflineGrant{}, nil, err
	}
	g.MemberLinked = live.Valid

	rows, err := s.db.QueryContext(ctx,
		`SELECT device_id FROM offline_grant_devices WHERE grant_id = ? ORDER BY device_id`, grantID)
	if err != nil {
		return OfflineGrant{}, nil, err
	}
	defer rows.Close()
	devices := []string{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return OfflineGrant{}, nil, err
		}
		devices = append(devices, d)
	}
	if err := rows.Err(); err != nil {
		return OfflineGrant{}, nil, err
	}
	g.Devices = devices
	return g, devices, nil
}

// GateEnforcement is one controller's state with respect to ONE revoked grant.
type GateEnforcement struct {
	DeviceID string
	// Reported is false when the controller has never said which deny-list it
	// holds — older firmware, or one that has not connected since. Distinct
	// from Enforcing=false, which is a controller that HAS reported and is
	// behind. The first cannot be confirmed either way; the second is known.
	Reported bool
	// Seq is what it reported, meaningful only when Reported.
	Seq int64
	// Enforcing is true when its reported sequence is at or above the one this
	// grant was revoked at — so it is refusing this grant, whatever else it
	// may be behind on.
	Enforcing bool
}

// RevocationConvergence answers "which of this grant's gates are actually
// refusing it".
//
// Compared against the sequence THIS GRANT was revoked at, not the hub's
// current counter. The difference matters and is the reason migration 0032
// exists: a gate on list 5, for a grant revoked at 3 while the hub has reached
// 9, is enforcing this revocation and would read as "behind" under the coarser
// comparison — sending an operator to latch lockdown on a gate already
// refusing the person they fired.
//
// Returns nothing for a grant that is not revoked, and for one revoked before
// 0032 existed: with no recorded sequence there is no honest comparison to
// make, and inventing one would claim gates hold a revocation that may never
// have reached them.
func (s *Store) RevocationConvergence(ctx context.Context, grantID string) ([]GateEnforcement, bool, error) {
	var at int64
	err := s.db.QueryRowContext(ctx,
		`SELECT seq FROM offline_grant_revoked_at WHERE grant_id = ?`, grantID).Scan(&at)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT d.device_id, r.seq
		   FROM offline_grant_devices d
		   LEFT JOIN controller_revocation_reports r ON r.device_id = d.device_id
		  WHERE d.grant_id = ?
		  ORDER BY d.device_id`, grantID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []GateEnforcement{}
	for rows.Next() {
		var g GateEnforcement
		var seq sql.NullInt64
		if err := rows.Scan(&g.DeviceID, &seq); err != nil {
			return nil, false, err
		}
		g.Reported = seq.Valid
		g.Seq = seq.Int64
		g.Enforcing = seq.Valid && seq.Int64 >= at
		out = append(out, g)
	}
	return out, true, rows.Err()
}
