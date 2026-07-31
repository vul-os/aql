package store

// The clip index for camera recording. See
// migrations/0024_camera_clips.sql for why the bytes are not in here, and
// docs/CAMERA-RETENTION.md for the policy these queries implement.

import (
	"context"
	"database/sql"
)

// The clip LISTING lives in cameraview.go, beside the permission that gates it —
// it was removed from here when nothing called it, and came back with its
// caller.

// Clip is one recorded segment.
type Clip struct {
	ID         string
	AccountID  string
	DeviceKey  string
	StartedAt  int64
	DurationS  int
	SizeBytes  int64
	RelPath    string
	Reason     string
	DeletedAt  *int64
	DeletedWhy string
}

// Clip deletion reasons. Kept apart because they mean opposite things to
// someone auditing a gap in a timeline.
const (
	// ClipExpired: the retention worker removed it because it aged past the
	// camera's retain_hours, or to recover free space. The policy working.
	ClipExpired = "expired"
	// ClipMissing: the file was gone when a sweep looked. NOT a fault —
	// docs/CAMERA-RETENTION.md §2.1 deliberately makes the layout walkable so a
	// human can delete a day by hand without this software's cooperation.
	ClipMissing = "missing"
)

// RecordClip inserts the index row for a clip already written to disk.
//
// Called after the file is closed, never before. A row for a file that does not
// exist yet would be a row the retention sweep can select, and the sweep deletes
// what it selects.
func (s *Store) RecordClip(ctx context.Context, c Clip) (Clip, error) {
	if c.ID == "" {
		c.ID = NewID()
	}
	if c.Reason == "" {
		c.Reason = "continuous"
	}
	t := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO camera_clips
		   (id, account_id, device_key, started_at, duration_s, size_bytes, rel_path, reason, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.AccountID, c.DeviceKey, c.StartedAt, c.DurationS, c.SizeBytes, c.RelPath, c.Reason, t)
	return c, err
}

// ExpiredClips returns live clips older than the given cutoff for one camera.
//
// The cutoff is passed in rather than computed here: retention is a per-camera
// duration, and the store has no business knowing which camera has which policy.
func (s *Store) ExpiredClips(ctx context.Context, accountID, deviceKey string, olderThan int64, limit int) ([]Clip, error) {
	return s.scanClips(ctx,
		`SELECT id, account_id, device_key, started_at, duration_s, size_bytes, rel_path, reason
		   FROM camera_clips
		  WHERE deleted_at IS NULL AND account_id = ? AND device_key = ? AND started_at < ?
		  ORDER BY started_at ASC LIMIT ?`,
		accountID, deviceKey, olderThan, limit)
}

// OldestLiveClips returns the oldest live clips across EVERY camera.
//
// Across, deliberately (§2.3): when free space runs low the oldest footage goes
// first regardless of which camera produced it. Evicting per camera would let a
// busy camera preferentially consume a quiet one's history, and "the camera that
// records most" and "the camera that matters most" are unrelated.
func (s *Store) OldestLiveClips(ctx context.Context, limit int) ([]Clip, error) {
	return s.scanClips(ctx,
		`SELECT id, account_id, device_key, started_at, duration_s, size_bytes, rel_path, reason
		   FROM camera_clips
		  WHERE deleted_at IS NULL
		  ORDER BY started_at ASC LIMIT ?`, limit)
}

// MarkClipDeleted records that a clip is no longer on disk.
//
// The row stays. A gap in a timeline has to be visible as a gap — §2.6 requires
// that someone looking for the evening they cared about is told it was dropped
// and when, rather than shown an empty list that reads identically to a camera
// which never recorded at all.
func (s *Store) MarkClipDeleted(ctx context.Context, id, why string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE camera_clips SET deleted_at = ?, deleted_why = ?
		  WHERE id = ? AND deleted_at IS NULL`,
		now(), why, id)
	return err
}

func (s *Store) scanClips(ctx context.Context, q string, args ...any) ([]Clip, error) {
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Clip
	for rows.Next() {
		var c Clip
		if err := rows.Scan(&c.ID, &c.AccountID, &c.DeviceKey, &c.StartedAt, &c.DurationS,
			&c.SizeBytes, &c.RelPath, &c.Reason); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ClipOwners lists every (account, device) pair that still has a live clip.
//
// The retention sweep derives its work from here rather than from the device
// registry, and that is deliberate: a camera removed from the engine's config
// still has footage on the disk. Driving expiry from what is currently
// configured would leave that footage unbounded forever — the exact shape of the
// "reclaim path with no caller" failure, one level further in.
func (s *Store) ClipOwners(ctx context.Context) ([][2]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT DISTINCT account_id, device_key FROM camera_clips WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var a, d string
		if err := rows.Scan(&a, &d); err != nil {
			return nil, err
		}
		out = append(out, [2]string{a, d})
	}
	return out, rows.Err()
}

// LiveClipPaths is every clip path the index still expects to exist on disk.
//
// The complement of this set, walked from the filesystem, is what nothing will
// ever reclaim: WriteClip renames a file into place and THEN inserts its row,
// so a crash in between leaves a file no index-driven expiry can see. Deleted
// rows are excluded deliberately — if a row says the file is gone and the file
// is there, the delete failed, and it is as orphaned as one that was never
// indexed at all.
func (s *Store) LiveClipPaths(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT rel_path FROM camera_clips WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out[p] = true
	}
	return out, rows.Err()
}

// NewestClipAt returns when the most recent surviving clip for a camera
// started, and whether there is one.
//
// Deleted clips are excluded. A retention sweep removing the last clip must not
// look like a camera that never recorded — but it must also not look like a NEW
// recording, which is why this reads started_at rather than a row count: a
// count falls when the sweep runs, and a rule watching a count would fire on
// deletion.
//
// Exists for the automations runner, which polls it: the hub writes clips
// itself, so "a clip was written" is something it knows first-hand and does not
// need a camera to report.
func (s *Store) NewestClipAt(ctx context.Context, accountID, deviceKey string) (int64, bool, error) {
	var at sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		`SELECT max(started_at) FROM camera_clips
		  WHERE account_id = ? AND device_key = ? AND deleted_at IS NULL`,
		accountID, deviceKey).Scan(&at)
	if err != nil {
		return 0, false, err
	}
	return at.Int64, at.Valid, nil
}
