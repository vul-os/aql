package store

// `camera:view` — who may watch recorded footage, and the record of who did.
//
// See migrations/0025_camera_view_grants.sql for why this is a grant per member
// per camera rather than a role, and docs/CAMERA-RETENTION.md §2.4/§2.5 for the
// policy. Two rules govern everything here:
//
//   - the permission is NOT implied by owner or admin, because "can configure
//     the hub" and "can watch the other residents" are different authorities
//   - every view is recorded in the hash-chained audit log, and EVERY MEMBER of
//     the account can read that record — not just admins. The people most
//     affected must not be the only ones who cannot check.

import (
	"context"
	"database/sql"
	"errors"
)

// Audit actions for footage. Distinct verbs because export is a different act
// from watching: it takes the footage somewhere this hub no longer governs.
const (
	CameraViewAction   = "camera_view"
	CameraExportAction = "camera_export"
)

// CameraViewGrant is one member's permission on one camera.
type CameraViewGrant struct {
	ID        string
	AccountID string
	UserID    string
	Username  string
	DeviceKey string
	StartsAt  *int64
	EndsAt    *int64
	GrantedBy string
	RevokedAt *int64
}

// CameraAccess is one recorded viewing.
type CameraAccess struct {
	ID        string
	UserID    string
	Username  string
	DeviceKey string
	Action    string
	Detail    string
	At        int64
}

// GrantCameraView gives one member the right to watch one camera.
//
// Upserts: a second grant for the same (member, camera) replaces the first
// rather than stacking. Two overlapping grants with different windows is a
// question about which one governs, and there is no good answer to it.
func (s *Store) GrantCameraView(ctx context.Context, accountID, userID, deviceKey, grantedBy string, startsAt, endsAt *int64) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO camera_view_grants
		   (id, account_id, user_id, device_key, starts_at, ends_at, granted_by, revoked_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
		 ON CONFLICT (account_id, user_id, device_key) DO UPDATE SET
		     starts_at  = excluded.starts_at,
		     ends_at    = excluded.ends_at,
		     granted_by = excluded.granted_by,
		     revoked_at = NULL`,
		NewID(), accountID, userID, deviceKey, startsAt, endsAt, grantedBy, t)
	return err
}

// RevokeCameraView withdraws the permission.
//
// Marks rather than deletes, so "who could watch, between when and when" stays
// answerable after the fact — which is the whole reason §2.4 wants granting
// audited in the first place.
func (s *Store) RevokeCameraView(ctx context.Context, accountID, userID, deviceKey string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE camera_view_grants SET revoked_at = ?
		  WHERE account_id = ? AND user_id = ? AND device_key = ? AND revoked_at IS NULL`,
		now(), accountID, userID, deviceKey)
	return err
}

// MayViewCamera reports whether a member may watch a camera at the given time.
//
// Fail-closed in every direction: a missing row, a revoked one, a window that
// has not opened, a window that has closed. Expiry is evaluated HERE rather than
// by a sweep, so a grant that has run out stops working even if nothing has run
// to tidy it away.
func (s *Store) MayViewCamera(ctx context.Context, accountID, userID, deviceKey string, nowUnix int64) (bool, error) {
	var startsAt, endsAt sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		`SELECT starts_at, ends_at FROM camera_view_grants
		  WHERE account_id = ? AND user_id = ? AND device_key = ? AND revoked_at IS NULL`,
		accountID, userID, deviceKey).Scan(&startsAt, &endsAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if startsAt.Valid && nowUnix < startsAt.Int64 {
		return false, nil
	}
	if endsAt.Valid && nowUnix >= endsAt.Int64 {
		return false, nil
	}
	return true, nil
}

// CameraViewGrants lists an account's grants, live and revoked.
//
// Revoked ones included: a list that showed only live grants would answer "who
// can watch" and silently lose "who could".
func (s *Store) CameraViewGrants(ctx context.Context, accountID string) ([]CameraViewGrant, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT g.id, g.account_id, g.user_id, COALESCE(u.username, ''), g.device_key,
		        g.starts_at, g.ends_at, COALESCE(g.granted_by, ''), g.revoked_at
		   FROM camera_view_grants g
		   LEFT JOIN users u ON u.id = g.user_id
		  WHERE g.account_id = ?
		  ORDER BY g.revoked_at IS NOT NULL, g.created_at DESC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CameraViewGrant
	for rows.Next() {
		var g CameraViewGrant
		if err := rows.Scan(&g.ID, &g.AccountID, &g.UserID, &g.Username, &g.DeviceKey,
			&g.StartsAt, &g.EndsAt, &g.GrantedBy, &g.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// CameraAccessLog is every recorded view and export of this account's cameras.
//
// Readable by EVERY member of the account, which is why it exists as its own
// query rather than as a filter someone applies to the admin audit view: the
// rows live in admin_audit_log, which is admin-only, and §2.5 requires the
// subjects of the footage to be able to check it.
//
// Scoped by joining device ownership rather than by trusting a value in the
// audit row's detail — the ownership table is what decides whose camera a device
// key is, and a scoping rule that reads its own input from the record being
// scoped is not a scoping rule.
func (s *Store) CameraAccessLog(ctx context.Context, accountID string, limit int) ([]CameraAccess, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.id, COALESCE(a.actor_user_id_snapshot, a.actor_user_id, ''),
		        COALESCE(u.username, ''), a.target_id, a.action, a.detail, a.created_at
		   FROM admin_audit_log a
		   JOIN device_ownership o ON o.device_key = a.target_id
		   LEFT JOIN users u ON u.id = a.actor_user_id
		  WHERE a.action IN (?, ?) AND o.account_id = ?
		  ORDER BY a.created_at DESC LIMIT ?`,
		CameraViewAction, CameraExportAction, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CameraAccess
	for rows.Next() {
		var c CameraAccess
		if err := rows.Scan(&c.ID, &c.UserID, &c.Username, &c.DeviceKey,
			&c.Action, &c.Detail, &c.At); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ClipsByDevice lists a camera's clips newest-first, INCLUDING deleted ones.
//
// Deleted rows included, deliberately (§2.6): a gap in a timeline has to read as
// a gap. Someone looking for the evening they cared about must be told it was
// dropped and when, rather than shown a list that looks identical to a camera
// which never recorded at all.
//
// This query was written once before and removed, because at the time nothing
// called it and the store's reachability guard was right to say so. The viewer
// path is its caller.
func (s *Store) ClipsByDevice(ctx context.Context, accountID, deviceKey string, limit int) ([]Clip, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, account_id, device_key, started_at, duration_s, size_bytes, rel_path, reason,
		        deleted_at, COALESCE(deleted_why, '')
		   FROM camera_clips
		  WHERE account_id = ? AND device_key = ?
		  ORDER BY started_at DESC LIMIT ?`,
		accountID, deviceKey, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Clip
	for rows.Next() {
		var c Clip
		if err := rows.Scan(&c.ID, &c.AccountID, &c.DeviceKey, &c.StartedAt, &c.DurationS,
			&c.SizeBytes, &c.RelPath, &c.Reason, &c.DeletedAt, &c.DeletedWhy); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ClipByID fetches one clip, scoped to the account that owns it.
//
// Scoped in the query rather than checked afterwards: a lookup by id alone,
// followed by a comparison, is one forgotten comparison away from serving
// another account's footage. The device key is required too, so a clip id
// cannot be used to read a camera the caller has no grant for.
func (s *Store) ClipByID(ctx context.Context, accountID, deviceKey, clipID string) (Clip, error) {
	var c Clip
	err := s.db.QueryRowContext(ctx,
		`SELECT id, account_id, device_key, started_at, duration_s, size_bytes, rel_path, reason,
		        deleted_at, COALESCE(deleted_why, '')
		   FROM camera_clips
		  WHERE id = ? AND account_id = ? AND device_key = ?`,
		clipID, accountID, deviceKey).
		Scan(&c.ID, &c.AccountID, &c.DeviceKey, &c.StartedAt, &c.DurationS,
			&c.SizeBytes, &c.RelPath, &c.Reason, &c.DeletedAt, &c.DeletedWhy)
	if errors.Is(err, sql.ErrNoRows) {
		return Clip{}, ErrNotFound
	}
	return c, err
}
