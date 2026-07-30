// Package recording writes camera clips to disk and expires them.
//
// This is step 3 of docs/CAMERA-RETENTION.md §4's list, and it is built now
// because steps 1 and 2 are done: camera.ConsumeMedia receives media over RTSP
// and camera.Fragmenter muxes it. The doc's own reason for not building this
// earlier — "shipping a retention policy for footage that does not exist, which
// is the wrong order" — has stopped applying.
//
// # The policy is not decided here
//
// Every rule below comes from that document, which was written first and
// deliberately. Where this package makes a choice the document did not, the
// comment says so. The rules, in the order they bite:
//
//	§2.1  clips live on the filesystem, never in SQLite; the layout is
//	      date-partitioned so a human can delete a day by hand
//	§2.2  retention is a per-camera duration, default 72h, and 0 means record
//	      nothing — the setting a shared household should reach for first
//	§2.3  the disk limit is a FLOOR ON FREE SPACE, not a cap on footage;
//	      eviction is oldest-first ACROSS cameras; and if deleting every expired
//	      clip still leaves the hub under the floor, recording STOPS rather than
//	      deleting unexpired footage
//
// That last rule is the one worth stating twice. The tempting behaviour —
// silently dropping the oldest still-wanted clip to make room for a new one —
// makes the retention setting a lie under exactly the conditions where someone
// will later go looking. So this package would rather stop recording and say so.
//
// # Nothing here may ever touch the access path
//
// §2.3 again: "Recording is best-effort and runs on its own goroutine; a full
// disk must not delay or fail a gate opening." Nothing in this package is called
// from the open path, and its errors are logged rather than returned into
// anything that actuates.
package recording

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/vul-os/aql/hub/internal/devices/camera"
	"github.com/vul-os/aql/hub/internal/store"
)

// DefaultRetainHours is docs/CAMERA-RETENTION.md §2.2's default: three days.
//
// Long enough to answer what recording is actually for — what happened last
// night, or over a weekend — and short enough that it does not accumulate into a
// surveillance archive by inattention. There is deliberately no "keep forever".
const DefaultRetainHours = 72

// MinFreeFloorBytes is the absolute floor under §2.3's "10% of the filesystem,
// or 2 GB, whichever is larger".
const MinFreeFloorBytes int64 = 2 << 30

// MinFreeFraction is the proportional half of the same rule.
const MinFreeFraction = 0.10

// ErrBelowFloor reports that free space is under the floor and expired clips
// alone cannot recover it.
//
// Recording stops on this rather than deleting unexpired footage — see the
// package comment for why that direction is not negotiable.
var ErrBelowFloor = errors.New("recording: free space is below the floor and no expired clips remain to reclaim")

// Clock is the time source, injected so retention can be tested without
// sleeping for three days.
type Clock func() time.Time

// FreeSpaceFunc reports free bytes on the filesystem holding a path.
type FreeSpaceFunc func(path string) (free, total int64, err error)

// Config is what a Recorder needs.
type Config struct {
	// Root is the recordings directory: <data-dir>/recordings.
	Root string
	// RetainHours per device key. A device with no entry gets
	// DefaultRetainHours; a device set to 0 records nothing at all.
	RetainHours map[string]int
	// Log receives the loud complaints §2.3 requires. Required: a recorder that
	// stops recording silently is the failure this package is written against.
	Log *slog.Logger
	// Now and FreeSpace are injectable for tests. Both default when nil.
	Now       Clock
	FreeSpace FreeSpaceFunc
}

// Recorder writes clips and enforces retention.
type Recorder struct {
	cfg   Config
	store *store.Store
	now   Clock
	free  FreeSpaceFunc
}

// New builds a Recorder. The root is created if absent.
func New(st *store.Store, cfg Config) (*Recorder, error) {
	if cfg.Root == "" {
		return nil, errors.New("recording: a root directory is required")
	}
	if cfg.Log == nil {
		// Refused rather than defaulted to a discard logger. §2.3 requires this
		// component to say loudly when it stops recording, and a nil logger is
		// how "loudly" becomes "not at all".
		return nil, errors.New("recording: a logger is required — this package must be able to say when it stops")
	}
	if err := os.MkdirAll(cfg.Root, 0o700); err != nil {
		return nil, fmt.Errorf("recording: create root: %w", err)
	}
	r := &Recorder{cfg: cfg, store: st, now: cfg.Now, free: cfg.FreeSpace}
	if r.now == nil {
		r.now = time.Now
	}
	if r.free == nil {
		r.free = diskFree
	}
	return r, nil
}

// RetainHoursFor is the configured retention for a camera, or the default.
func (r *Recorder) RetainHoursFor(deviceKey string) int {
	if h, ok := r.cfg.RetainHours[deviceKey]; ok {
		return h
	}
	return DefaultRetainHours
}

// Records reports whether a camera records at all.
//
// retain_hours 0 is live-view-only (§2.2), and it is checked before any file is
// opened rather than by writing a clip and expiring it immediately — a camera
// configured not to record must never put footage on the disk, not even briefly.
func (r *Recorder) Records(deviceKey string) bool { return r.RetainHoursFor(deviceKey) > 0 }

// relPath is §2.1's layout:
//
//	<account-id>/<device-key>/<YYYY-MM-DD>/<start-unix>-<duration>s.mp4
//
// Date-partitioned so expiry is a directory walk rather than a query, and so a
// human can find and delete a day by hand without this software's cooperation.
// That second property is a promise the document makes to the people being
// recorded, and it is why the date is in the path rather than only in a column.
func relPath(accountID, deviceKey string, start time.Time, durationS int) string {
	return filepath.Join(accountID, deviceKey,
		start.UTC().Format("2006-01-02"),
		fmt.Sprintf("%d-%ds.mp4", start.Unix(), durationS))
}

// WriteClip muxes access units into a clip file and indexes it.
//
// The free-space floor is checked BEFORE the file is opened, so a hub under the
// floor writes nothing rather than writing and then reclaiming. Returns
// ErrBelowFloor when it cannot proceed; the caller logs and skips, and does not
// treat it as fatal — a hub whose disk is full must keep opening gates.
func (r *Recorder) WriteClip(ctx context.Context, accountID, deviceKey string,
	sps, pps []byte, units []camera.AccessUnit) (store.Clip, error) {

	if !r.Records(deviceKey) {
		return store.Clip{}, nil // live-view only; not an error
	}
	if len(units) == 0 {
		return store.Clip{}, errors.New("recording: refusing to write a clip with no pictures")
	}
	if err := r.ensureFreeSpace(ctx); err != nil {
		return store.Clip{}, err
	}

	f, err := camera.NewFragmenter(sps, pps, camera.H264ClockRate)
	if err != nil {
		return store.Clip{}, fmt.Errorf("recording: %w", err)
	}
	samples, err := camera.Samples(units)
	if err != nil {
		return store.Clip{}, fmt.Errorf("recording: %w", err)
	}
	frag, err := f.Fragment(samples)
	if err != nil {
		return store.Clip{}, fmt.Errorf("recording: %w", err)
	}

	var ticks uint64
	for _, s := range samples {
		ticks += uint64(s.Duration)
	}
	durationS := int(ticks / camera.H264ClockRate)
	if durationS < 1 {
		durationS = 1 // a sub-second clip still occupies a second in the layout
	}
	start := r.now()
	rel := relPath(accountID, deviceKey, start, durationS)
	full := filepath.Join(r.cfg.Root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
		return store.Clip{}, fmt.Errorf("recording: create clip directory: %w", err)
	}

	// Written to a temporary name and renamed, so a crash mid-write cannot leave
	// a truncated file at a path the index will later claim is a playable clip.
	tmp := full + ".part"
	body := append(f.InitSegment(), frag...)
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return store.Clip{}, fmt.Errorf("recording: write clip: %w", err)
	}
	if err := os.Rename(tmp, full); err != nil {
		_ = os.Remove(tmp)
		return store.Clip{}, fmt.Errorf("recording: commit clip: %w", err)
	}

	// Indexed AFTER the rename. A row for a file that is not yet at its final
	// path is a row the retention sweep can select, and the sweep deletes what
	// it selects.
	return r.store.RecordClip(ctx, store.Clip{
		AccountID: accountID, DeviceKey: deviceKey,
		StartedAt: start.Unix(), DurationS: durationS,
		SizeBytes: int64(len(body)), RelPath: rel, Reason: "continuous",
	})
}

// ExpireOnce removes clips past their camera's retention, for one account's
// cameras, and returns how many it removed.
func (r *Recorder) ExpireOnce(ctx context.Context, accountID string, deviceKeys []string) (int, error) {
	removed := 0
	nowUnix := r.now().Unix()
	for _, key := range deviceKeys {
		hours := r.RetainHoursFor(key)
		if hours <= 0 {
			// retain_hours 0 records nothing, so anything on disk under that key
			// predates the setting change. It is expired by definition.
			hours = 0
		}
		cutoff := nowUnix - int64(hours)*3600
		clips, err := r.store.ExpiredClips(ctx, accountID, key, cutoff, 500)
		if err != nil {
			return removed, err
		}
		for _, c := range clips {
			if err := r.removeClip(ctx, c, store.ClipExpired); err != nil {
				return removed, err
			}
			removed++
		}
	}
	return removed, nil
}

// EnsureFreeSpace is ensureFreeSpace, exported for the worker.
func (r *Recorder) EnsureFreeSpace(ctx context.Context) error { return r.ensureFreeSpace(ctx) }

// ensureFreeSpace evicts oldest-first across all cameras until the floor is met.
//
// Across all cameras (§2.3), never per camera: a busy camera must not be able to
// evict a quiet one's footage preferentially.
//
// It only ever deletes clips that are ALREADY expired under their camera's
// policy — which is why it takes no retention argument and stops rather than
// widening its remit. If the floor still is not met, ErrBelowFloor comes back
// and recording stops. Deleting unexpired footage to keep recording would make
// the retention setting a lie precisely when someone goes looking.
func (r *Recorder) ensureFreeSpace(ctx context.Context) error {
	free, total, err := r.free(r.cfg.Root)
	if err != nil {
		// A filesystem this cannot measure is one it will not fill on purpose.
		// Recording proceeds — refusing on an unreadable statfs would take the
		// feature out over a diagnostic failure — but it is logged, because a
		// floor that is not being enforced must not be silent.
		r.cfg.Log.Warn("recording: cannot measure free space; the disk floor is NOT being enforced",
			"root", r.cfg.Root, "err", err)
		return nil
	}
	floor := floorFor(total)
	if free >= floor {
		return nil
	}

	r.cfg.Log.Warn("recording: free space is below the floor; evicting expired clips oldest-first",
		"free_bytes", free, "floor_bytes", floor)

	// Oldest first across every camera, in batches, re-measuring as it goes.
	for pass := 0; pass < 20; pass++ {
		clips, err := r.store.OldestLiveClips(ctx, 100)
		if err != nil {
			return err
		}
		if len(clips) == 0 {
			break
		}
		nowUnix := r.now().Unix()
		progressed := false
		for _, c := range clips {
			cutoff := nowUnix - int64(r.RetainHoursFor(c.DeviceKey))*3600
			if c.StartedAt >= cutoff {
				// The oldest live clip is still within its retention. Everything
				// after it is newer, so there is nothing left to reclaim.
				break
			}
			if err := r.removeClip(ctx, c, store.ClipExpired); err != nil {
				return err
			}
			progressed = true
		}
		if !progressed {
			break
		}
		if free, _, err = r.free(r.cfg.Root); err == nil && free >= floor {
			r.cfg.Log.Info("recording: free space recovered", "free_bytes", free, "floor_bytes", floor)
			return nil
		}
	}

	r.cfg.Log.Error("recording: STOPPING — free space is below the floor and every expired clip "+
		"has been reclaimed. Unexpired footage will NOT be deleted to keep recording; "+
		"free space on the recordings filesystem, or lower retain_hours.",
		"free_bytes", free, "floor_bytes", floor)
	return ErrBelowFloor
}

// removeClip deletes the file and marks the row.
//
// A file that is already gone is NOT an error (§2.1): the layout is deliberately
// walkable so someone can remove their own footage by hand. It is recorded as
// ClipMissing rather than ClipExpired so a later reader can tell the policy
// working from a human having intervened.
func (r *Recorder) removeClip(ctx context.Context, c store.Clip, why string) error {
	full := filepath.Join(r.cfg.Root, c.RelPath)
	if err := os.Remove(full); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("recording: remove %s: %w", c.RelPath, err)
		}
		why = store.ClipMissing
	}
	return r.store.MarkClipDeleted(ctx, c.ID, why)
}

// floorFor is §2.3's "10% of the filesystem, or 2 GB, whichever is larger".
func floorFor(total int64) int64 {
	proportional := int64(float64(total) * MinFreeFraction)
	if proportional > MinFreeFloorBytes {
		return proportional
	}
	return MinFreeFloorBytes
}
