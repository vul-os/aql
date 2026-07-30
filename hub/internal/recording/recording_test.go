package recording

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices/camera"
	"github.com/vul-os/aql/hub/internal/store"
)

// These tests are about deleting people's footage, so they are written around
// the rules docs/CAMERA-RETENTION.md commits to rather than around the code's
// shape. Each one names the section it enforces. The rule that matters most is
// §2.3's refusal: when the floor cannot be met from expired clips alone,
// recording STOPS — it does not delete unexpired footage to keep going, because
// that makes the retention setting a lie precisely under the conditions where
// somebody will later go looking.

// openTestStore uses the store's real constructor against a temp directory —
// the same thing store's own tests do. No test-only export is added to the
// store package for this: production API that exists solely for tests is how a
// package accumulates surface nothing ships.
func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// seedAccount creates the account clips are foreign-keyed to.
func seedAccount(t *testing.T, st *store.Store) string {
	t.Helper()
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "rec@x.com", "hash", "R", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return acct.ID
}

// clipState reads a camera's clips straight from the database.
//
// A direct query rather than a store method, because the store had a
// ClipsByDevice and its reachability guard was right to flag it: nothing in
// production calls it until the viewer exists. A test is not a caller, and
// keeping production API alive for one is how a package accumulates surface
// nothing ships.
func clipState(t *testing.T, st *store.Store, accountID, deviceKey string) []clipRow {
	t.Helper()
	db := st.DB()
	rows, err := db.QueryContext(context.Background(),
		`SELECT id, started_at, deleted_at, COALESCE(deleted_why, '')
		   FROM camera_clips WHERE account_id = ? AND device_key = ?
		  ORDER BY started_at DESC`, accountID, deviceKey)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []clipRow
	for rows.Next() {
		var c clipRow
		if err := rows.Scan(&c.ID, &c.StartedAt, &c.DeletedAt, &c.DeletedWhy); err != nil {
			t.Fatal(err)
		}
		out = append(out, c)
	}
	return out
}

type clipRow struct {
	ID         string
	StartedAt  int64
	DeletedAt  *int64
	DeletedWhy string
}

func quietLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// A fixed clock, so retention can be tested without waiting three days.
func fixedClock(t time.Time) Clock { return func() time.Time { return t } }

// fakeDisk reports whatever the test says, and can change between calls so an
// eviction pass can be seen to recover.
type fakeDisk struct {
	free, total int64
	err         error
	calls       int
	// onCall, when set, mutates free before each answer — used to model space
	// coming back as clips are deleted.
	onCall func(d *fakeDisk)
}

func (d *fakeDisk) fn() FreeSpaceFunc {
	return func(string) (int64, int64, error) {
		d.calls++
		if d.onCall != nil {
			d.onCall(d)
		}
		return d.free, d.total, d.err
	}
}

func testRecorder(t *testing.T, st *store.Store, disk *fakeDisk, now time.Time, retain map[string]int) *Recorder {
	t.Helper()
	cfg := Config{
		Root:        t.TempDir(),
		RetainHours: retain,
		Log:         quietLog(),
		Now:         fixedClock(now),
	}
	if disk != nil {
		cfg.FreeSpace = disk.fn()
	} else {
		// Plenty of room: the floor is never the thing under test unless a test
		// says it is.
		cfg.FreeSpace = (&fakeDisk{free: 1 << 40, total: 1 << 40}).fn()
	}
	r, err := New(st, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// A camera's parameter sets and one picture, enough to mux a real clip.
func testMedia(t *testing.T) (sps, pps []byte, units []camera.AccessUnit) {
	t.Helper()
	// Borrowed from the camera package's own vectors via its exported API: a
	// fragmenter refuses anything that is not a readable SPS, so building a clip
	// at all proves these are real parameter sets.
	sps = []byte{0x67, 0x42, 0x00, 0x1e, 0xf4, 0x0a, 0x0f, 0xc8}
	pps = []byte{0x68, 0xce, 0x3c, 0x80}
	units = []camera.AccessUnit{
		{RTPTimestamp: 0, Duration: 90000, NALUnits: [][]byte{{0x65, 0x01, 0x02}}, IsSync: true},
		{RTPTimestamp: 90000, Duration: 90000, NALUnits: [][]byte{{0x41, 0x03}}, IsSync: false},
	}
	return
}

func TestWriteClipUsesTheDatePartitionedLayout(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	when := time.Date(2026, 3, 14, 22, 5, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, when, nil)
	sps, pps, units := testMedia(t)

	clip, err := r.WriteClip(ctx, acct, "cam-front", sps, pps, units)
	if err != nil {
		t.Fatal(err)
	}

	// §2.1: <account>/<device>/<YYYY-MM-DD>/<start>-<dur>s.mp4. The date is in
	// the PATH, not only in a column, so a human can delete a day by hand
	// without this software's cooperation — a promise the document makes to the
	// people being recorded.
	wantDir := filepath.Join(acct, "cam-front", "2026-03-14")
	if !strings.HasPrefix(clip.RelPath, wantDir) {
		t.Errorf("clip path %q is not under %q", clip.RelPath, wantDir)
	}
	if !strings.HasSuffix(clip.RelPath, "s.mp4") {
		t.Errorf("clip path %q does not end in the duration suffix", clip.RelPath)
	}

	full := filepath.Join(r.cfg.Root, clip.RelPath)
	info, err := os.Stat(full)
	if err != nil {
		t.Fatalf("clip file is not on disk: %v", err)
	}
	if info.Size() != clip.SizeBytes {
		t.Errorf("indexed size %d, file is %d", clip.SizeBytes, info.Size())
	}
	// Two one-second pictures.
	if clip.DurationS != 2 {
		t.Errorf("duration %ds, want 2", clip.DurationS)
	}
	// No .part left behind.
	if _, err := os.Stat(full + ".part"); !os.IsNotExist(err) {
		t.Error("a .part file survived the write")
	}
}

// §2.2: retain_hours 0 is live-view only. The camera must put NOTHING on the
// disk — not a clip that is expired a moment later.
func TestACameraSetToZeroRetentionWritesNothing(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	r := testRecorder(t, st, nil, time.Now(), map[string]int{"cam-hall": 0})
	sps, pps, units := testMedia(t)

	clip, err := r.WriteClip(ctx, acct, "cam-hall", sps, pps, units)
	if err != nil {
		t.Fatal(err)
	}
	if clip.ID != "" {
		t.Error("a zero-retention camera produced a clip row")
	}
	entries, _ := os.ReadDir(r.cfg.Root)
	if len(entries) != 0 {
		t.Errorf("a zero-retention camera wrote %d entries to the recordings root", len(entries))
	}
	if r.Records("cam-hall") {
		t.Error("Records() is true for a zero-retention camera")
	}
}

// §2.2: expiry is per camera, using that camera's own duration.
func TestExpiryUsesEachCamerasOwnRetention(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, now, map[string]int{"short": 1, "long": 240})

	// Both cameras have a clip from two hours ago.
	twoHoursAgo := now.Add(-2 * time.Hour).Unix()
	for _, key := range []string{"short", "long"} {
		if _, err := st.RecordClip(ctx, store.Clip{
			AccountID: acct, DeviceKey: key, StartedAt: twoHoursAgo,
			DurationS: 60, SizeBytes: 1000, RelPath: key + "/old.mp4",
		}); err != nil {
			t.Fatal(err)
		}
	}

	n, err := r.expireOnce(ctx, acct, []string{"short", "long"})
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expired %d clips, want 1 — only the 1-hour camera's clip is past its retention", n)
	}
	short := clipState(t, st, acct, "short")
	long := clipState(t, st, acct, "long")
	if short[0].DeletedAt == nil {
		t.Error("the 1-hour camera's two-hour-old clip was not expired")
	}
	if long[0].DeletedAt != nil {
		t.Error("the 240-hour camera's clip was expired; retention is per camera")
	}
}

// §2.1: the layout is deliberately walkable so someone can delete their own
// footage by hand. A missing file is therefore a SUPPORTED state, and must be
// recorded as such rather than as a fault — the two mean opposite things to
// whoever audits the gap later.
func TestAFileRemovedByHandIsRecordedAsMissingNotExpired(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, now, map[string]int{"cam": 1})

	// Indexed, but nothing was ever written at that path.
	if _, err := st.RecordClip(ctx, store.Clip{
		AccountID: acct, DeviceKey: "cam", StartedAt: now.Add(-5 * time.Hour).Unix(),
		DurationS: 60, SizeBytes: 1000, RelPath: "cam/gone.mp4",
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := r.expireOnce(ctx, acct, []string{"cam"}); err != nil {
		t.Fatalf("a clip whose file a human removed must not be an error: %v", err)
	}
	clips := clipState(t, st, acct, "cam")
	if clips[0].DeletedWhy != store.ClipMissing {
		t.Errorf("deleted_why = %q, want %q — the policy working and a human "+
			"intervening must stay distinguishable", clips[0].DeletedWhy, store.ClipMissing)
	}
}

// §2.6: the row outlives the file. A gap has to be visible AS a gap — an empty
// list reads identically to a camera that never recorded, and the document is
// explicit that someone looking for the evening they cared about must be told it
// was dropped and when.
func TestAnExpiredClipStaysInTheIndex(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, now, map[string]int{"cam": 1})

	if _, err := st.RecordClip(ctx, store.Clip{
		AccountID: acct, DeviceKey: "cam", StartedAt: now.Add(-9 * time.Hour).Unix(),
		DurationS: 60, SizeBytes: 1000, RelPath: "cam/old.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.expireOnce(ctx, acct, []string{"cam"}); err != nil {
		t.Fatal(err)
	}

	clips := clipState(t, st, acct, "cam")
	if len(clips) != 1 {
		t.Fatalf("the index holds %d rows after expiry, want 1 — the gap must stay visible", len(clips))
	}
	if clips[0].DeletedAt == nil {
		t.Error("the row is present but not marked deleted")
	}
}

// §2.3, and the rule this package exists to hold: recording STOPS rather than
// deleting unexpired footage to make room.
func TestRecordingStopsRatherThanDeletingUnexpiredFootage(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)

	// Under the floor, and it never recovers — nothing can be reclaimed.
	disk := &fakeDisk{free: 1 << 20, total: 100 << 30} // 1 MiB free of 100 GiB
	r := testRecorder(t, st, disk, now, map[string]int{"cam": 240})

	// One clip, well inside its 240-hour retention.
	if _, err := st.RecordClip(ctx, store.Clip{
		AccountID: acct, DeviceKey: "cam", StartedAt: now.Add(-1 * time.Hour).Unix(),
		DurationS: 60, SizeBytes: 5000, RelPath: "cam/recent.mp4",
	}); err != nil {
		t.Fatal(err)
	}

	sps, pps, units := testMedia(t)
	_, err := r.WriteClip(ctx, acct, "cam", sps, pps, units)
	if err == nil {
		t.Fatal("WriteClip succeeded under the floor; it must refuse rather than make room")
	}
	if !strings.Contains(err.Error(), "below the floor") {
		t.Errorf("err = %v, want ErrBelowFloor", err)
	}

	// And the unexpired clip is untouched. This is the whole assertion: the
	// alternative — evicting it to keep recording — makes retain_hours a lie
	// under exactly the conditions where someone goes looking.
	clips := clipState(t, st, acct, "cam")
	if clips[0].DeletedAt != nil {
		t.Error("an UNEXPIRED clip was deleted to free space; the floor must stop " +
			"recording instead")
	}
}

// §2.3: eviction is oldest-first ACROSS cameras, never per camera — a busy
// camera must not be able to evict a quiet one's footage preferentially.
//
// The ordering lives in the store query, so it is asserted there. An earlier
// version of this test tried to observe it through EnsureFreeSpace and proved
// nothing twice over: it gave both cameras a one-hour retention, so every clip
// was expired and eviction correctly took them all, and its "recovered after two
// deletions" hook closed over a counter that was only assigned once the test had
// finished. Testing the rule where it is implemented is both honest and legible.
func TestOldestLiveClipsOrdersAcrossCamerasNotWithinThem(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)

	mk := func(key string, hoursAgo int) {
		t.Helper()
		if _, err := st.RecordClip(ctx, store.Clip{
			AccountID: acct, DeviceKey: key, StartedAt: now.Add(-time.Duration(hoursAgo) * time.Hour).Unix(),
			DurationS: 60, SizeBytes: 1000,
			RelPath: key + "/" + strconv.Itoa(hoursAgo) + ".mp4",
		}); err != nil {
			t.Fatal(err)
		}
	}
	// Interleaved deliberately: the busy camera has MORE clips, and the quiet
	// camera has the two oldest. A per-camera policy would take a busy clip
	// first because that camera has the most to give.
	mk("quiet", 10)
	mk("busy", 5)
	mk("busy", 4)
	mk("quiet", 9)
	mk("busy", 3)

	clips, err := st.OldestLiveClips(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(clips) != 3 {
		t.Fatalf("got %d clips, want 3", len(clips))
	}
	// The two oldest are the quiet camera's, then the busy camera's oldest.
	want := []string{"quiet", "quiet", "busy"}
	for i, w := range want {
		if clips[i].DeviceKey != w {
			t.Errorf("clip %d is from %q, want %q — eviction order is by AGE across "+
				"cameras, not by which camera has the most footage",
				i, clips[i].DeviceKey, w)
		}
	}
	if !(clips[0].StartedAt < clips[1].StartedAt && clips[1].StartedAt < clips[2].StartedAt) {
		t.Error("clips are not in ascending age order")
	}
}

// Eviction may only take clips ALREADY past their camera's retention. A clip
// inside its window survives a low-disk pass, and the pass then reports that it
// could not reach the floor rather than widening its remit.
func TestEvictionWillNotTakeAClipInsideItsRetention(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)

	disk := &fakeDisk{free: 1 << 20, total: 100 << 30} // permanently under the floor
	r := testRecorder(t, st, disk, now, map[string]int{"cam": 240})

	if _, err := st.RecordClip(ctx, store.Clip{
		AccountID: acct, DeviceKey: "cam", StartedAt: now.Add(-2 * time.Hour).Unix(),
		DurationS: 60, SizeBytes: 1000, RelPath: "cam/inside.mp4",
	}); err != nil {
		t.Fatal(err)
	}

	if err := r.EnsureFreeSpace(ctx); err == nil {
		t.Fatal("EnsureFreeSpace reported success while still under the floor")
	}
	clips := clipState(t, st, acct, "cam")
	if clips[0].DeletedAt != nil {
		t.Error("a clip inside its retention was evicted to free space")
	}
}

// A measurement failure must not take recording out — but it must not pretend a
// floor is being enforced either.
func TestAnUnmeasurableFilesystemRecordsAndSaysSo(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	disk := &fakeDisk{err: os.ErrPermission}
	r := testRecorder(t, st, disk, time.Now(), nil)
	sps, pps, units := testMedia(t)

	if _, err := r.WriteClip(ctx, acct, "cam", sps, pps, units); err != nil {
		t.Fatalf("an unmeasurable filesystem must not stop recording: %v", err)
	}
}

// New refuses a nil logger, because §2.3 requires this component to be able to
// say loudly that it has stopped, and a discard logger is how "loudly" becomes
// "not at all".
func TestNewRefusesWithoutALogger(t *testing.T) {
	st := openTestStore(t)
	if _, err := New(st, Config{Root: t.TempDir()}); err == nil {
		t.Error("New accepted a nil logger")
	}
	if _, err := New(st, Config{Log: quietLog()}); err == nil {
		t.Error("New accepted an empty root")
	}
}

func TestFloorIsTheLargerOfTenPercentAndTwoGigabytes(t *testing.T) {
	// Small disk: the 2 GiB absolute floor wins.
	if got := floorFor(10 << 30); got != MinFreeFloorBytes {
		t.Errorf("floor on a 10 GiB disk = %d, want the 2 GiB absolute floor", got)
	}
	// Large disk: 10% wins.
	// A runtime value: 1 TiB * 0.10 has a fractional part, and Go refuses to
	// convert a constant float with one to int64 at compile time.
	var oneTiB int64 = 1 << 40
	want := int64(float64(oneTiB) * MinFreeFraction)
	if got := floorFor(oneTiB); got != want {
		t.Errorf("floor on a 1 TiB disk = %d, want %d (10%%)", got, want)
	}
}

// ── the capture loop ────────────────────────────────────────────────────────
//
// What these cover is the decision-making above the socket: which windows
// become clips, which are skipped, and what a skip is called. The socket half is
// covered where it lives — camera's own tests drive ConsumeMedia against an
// in-process RTSP server whose framing is written from RFC 2326 and RFC 3550
// independently of the client.

// fakeFetch returns a canned window.
func fakeFetch(units []camera.AccessUnit, a *camera.Assembler, flow camera.MediaFlow, err error) FetchFunc {
	return func(context.Context, string, camera.Credential, time.Duration, time.Duration) (
		camera.StreamInfo, camera.MediaFlow, []camera.AccessUnit, *camera.Assembler, error) {
		return camera.StreamInfo{}, flow, units, a, err
	}
}

// An assembler that has seen the parameter sets, as one has after a stream that
// carries them in-band.
func primedAssembler(t *testing.T, sps, pps []byte) *camera.Assembler {
	t.Helper()
	a := camera.NewAssembler()
	// Push the parameter sets through as single-NAL RTP packets: this is how a
	// camera sends them when it advertises no sprop-parameter-sets, and it is
	// the path that populates SPS()/PPS().
	var seq uint16
	for _, nal := range [][]byte{sps, pps} {
		seq++
		pkt := make([]byte, 12, 12+len(nal))
		pkt[0] = 0x80
		pkt[1] = 96
		pkt[2], pkt[3] = byte(seq>>8), byte(seq)
		pkt = append(pkt, nal...)
		if _, err := a.Push(pkt); err != nil {
			t.Fatal(err)
		}
	}
	if len(a.SPS()) == 0 || len(a.PPS()) == 0 {
		t.Fatal("the primed assembler holds no parameter sets")
	}
	return a
}

func TestCaptureWritesAClipFromAWindow(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	sps, pps, units := testMedia(t)
	// A trailing unit with no duration, exactly as the assembler leaves the
	// last picture of a window — its successor has not arrived to say when it
	// ended.
	units = append(units, camera.AccessUnit{
		RTPTimestamp: 180000, Duration: 0,
		NALUnits: [][]byte{{0x41, 0x09}},
	})

	r := testRecorder(t, st, nil, time.Now(), nil)
	r.cfg.Fetch = fakeFetch(units, primedAssembler(t, sps, pps), camera.MediaFlow{Packets: 9}, nil)

	if err := r.CaptureOnce(ctx, Source{DeviceKey: "cam", AccountID: acct, StreamURL: "rtsp://x/1"}); err != nil {
		t.Fatal(err)
	}
	clips := clipState(t, st, acct, "cam")
	if len(clips) != 1 {
		t.Fatalf("wrote %d clips, want 1", len(clips))
	}
}

// The final picture of a window has no duration, and Samples refuses a
// zero-duration sample rather than inventing one. Capture must drop it rather
// than guess a length — a guessed final-frame duration is indistinguishable
// from a measured one once it is in the container.
func TestCaptureDropsTheUnterminatedFinalPicture(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	sps, pps, _ := testMedia(t)

	only := []camera.AccessUnit{{RTPTimestamp: 0, Duration: 0, NALUnits: [][]byte{{0x65, 0x01}}, IsSync: true}}
	r := testRecorder(t, st, nil, time.Now(), nil)
	r.cfg.Fetch = fakeFetch(only, primedAssembler(t, sps, pps), camera.MediaFlow{Packets: 1}, nil)

	if err := r.CaptureOnce(ctx, Source{DeviceKey: "cam", AccountID: acct, StreamURL: "rtsp://x/1"}); err != nil {
		t.Fatalf("a window holding only an unterminated picture must be skipped, not fail: %v", err)
	}
	if n := len(clipState(t, st, acct, "cam")); n != 0 {
		t.Errorf("wrote %d clips from a window with no terminated picture, want 0", n)
	}
}

// Packets arriving and no picture assembling is a real diagnosis, not an error:
// every packet a fragment whose remainder never came. It must not write a clip
// and must not fail the pass.
func TestCaptureSkipsAWindowThatAssembledNothing(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	sps, pps, _ := testMedia(t)

	r := testRecorder(t, st, nil, time.Now(), nil)
	r.cfg.Fetch = fakeFetch(nil, primedAssembler(t, sps, pps), camera.MediaFlow{Packets: 400}, nil)

	if err := r.CaptureOnce(ctx, Source{DeviceKey: "cam", AccountID: acct, StreamURL: "rtsp://x/1"}); err != nil {
		t.Fatalf("a window that assembled nothing must not fail the pass: %v", err)
	}
	if n := len(clipState(t, st, acct, "cam")); n != 0 {
		t.Errorf("wrote %d clips from a window that assembled no picture", n)
	}
}

// A stream that has not yet sent its parameter sets cannot be muxed — avcC
// needs them. Skipping the window is correct; failing is not, because the sets
// arrive periodically and the next window will have them.
func TestCaptureWaitsForParameterSets(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	_, _, units := testMedia(t)

	r := testRecorder(t, st, nil, time.Now(), nil)
	// A bare assembler: pictures, but no SPS/PPS seen yet.
	r.cfg.Fetch = fakeFetch(units, camera.NewAssembler(), camera.MediaFlow{Packets: 9}, nil)

	if err := r.CaptureOnce(ctx, Source{DeviceKey: "cam", AccountID: acct, StreamURL: "rtsp://x/1"}); err != nil {
		t.Fatalf("a window before the parameter sets arrive must be skipped, not fail: %v", err)
	}
	if n := len(clipState(t, st, acct, "cam")); n != 0 {
		t.Errorf("wrote %d clips without parameter sets — the container would have no avcC", n)
	}
}

// §2.2 again, at the capture layer: a live-view-only camera must not even open
// a stream, let alone write a file.
func TestCaptureDoesNotFetchFromAZeroRetentionCamera(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	r := testRecorder(t, st, nil, time.Now(), map[string]int{"cam": 0})

	fetched := false
	r.cfg.Fetch = func(context.Context, string, camera.Credential, time.Duration, time.Duration) (
		camera.StreamInfo, camera.MediaFlow, []camera.AccessUnit, *camera.Assembler, error) {
		fetched = true
		return camera.StreamInfo{}, camera.MediaFlow{}, nil, nil, nil
	}
	if err := r.CaptureOnce(ctx, Source{DeviceKey: "cam", AccountID: acct, StreamURL: "rtsp://x/1"}); err != nil {
		t.Fatal(err)
	}
	if fetched {
		t.Error("a zero-retention camera's stream was opened; retain_hours 0 is live-view only")
	}
}

// ── live fan-out ────────────────────────────────────────────────────────────

// A viewer joining mid-stream has missed the init segment, and a SourceBuffer
// rejects every fragment without one. So the broadcaster keeps the last one and
// hands it over on subscribe — otherwise the picture starts only for people who
// were already watching.
func TestALateViewerStillGetsTheInitSegment(t *testing.T) {
	b := NewBroadcaster()
	b.PublishInit("cam", []byte("moov"))
	b.PublishFragment("cam", []byte("frag-1"))

	ch, stop := b.Subscribe("cam")
	defer stop()

	// A non-blocking read, deliberately. Subscribe delivers the stored init
	// segment synchronously, so it is already buffered by the time this runs —
	// and if it is NOT, this must say so rather than block. A test that hangs
	// when the behaviour it guards is removed burns a CI timeout and reports
	// "test timed out" instead of naming the defect.
	select {
	case seg := <-ch:
		if !seg.Init || string(seg.Data) != "moov" {
			t.Fatalf("first segment for a late viewer = %+v, want the init segment", seg)
		}
	default:
		t.Fatal("a viewer joining mid-stream received no init segment; a SourceBuffer " +
			"rejects every fragment without one, so the picture would start only for " +
			"people who were already watching")
	}
}

// A viewer that cannot keep up is dropped rather than allowed to block. The
// alternative is back-pressure through the broadcaster into the capture loop —
// a camera stops being RECORDED because somebody's tab is struggling.
func TestASlowViewerIsDroppedRatherThanBlockingTheRecorder(t *testing.T) {
	b := NewBroadcaster()
	ch, stop := b.Subscribe("cam")
	defer stop()

	// Never read from ch. Publish past the buffer.
	for i := 0; i < liveBufferedFragments+5; i++ {
		b.PublishFragment("cam", []byte("frag"))
	}

	if b.Dropped() != 1 {
		t.Fatalf("Dropped() = %d, want 1 — a viewer that fills its buffer must be cut loose", b.Dropped())
	}
	if b.Viewers("cam") != 0 {
		t.Error("the dropped viewer is still attached")
	}
	// And the channel is closed, so the HTTP handler ranging over it returns
	// rather than hanging on a subscriber nothing will ever send to.
	drained := 0
	for range ch {
		drained++
	}
	if drained == 0 {
		t.Error("the dropped viewer's channel yielded nothing and was expected to be closed after its buffered segments")
	}
}

// Viewers of one camera must not receive another's fragments — the fan-out is
// per camera, and a mix-up here shows somebody the wrong room.
func TestFragmentsGoOnlyToTheirOwnCamerasViewers(t *testing.T) {
	b := NewBroadcaster()
	front, stopF := b.Subscribe("cam:front")
	defer stopF()
	hall, stopH := b.Subscribe("cam:hall")
	defer stopH()

	b.PublishFragment("cam:front", []byte("front-1"))

	select {
	case seg := <-front:
		if string(seg.Data) != "front-1" {
			t.Errorf("front viewer got %q", seg.Data)
		}
	default:
		t.Fatal("the front camera's viewer received nothing")
	}
	select {
	case seg := <-hall:
		t.Fatalf("the hallway viewer received the front camera's fragment: %q", seg.Data)
	default:
	}
}

// Capture publishes the SAME bytes it writes, so a picture that plays from the
// file plays from the live view.
func TestCapturePublishesWhatItWrites(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	sps, pps, units := testMedia(t)

	b := NewBroadcaster()
	r := testRecorder(t, st, nil, time.Now(), nil)
	r.cfg.Live = b
	r.cfg.Fetch = fakeFetch(units, primedAssembler(t, sps, pps), camera.MediaFlow{Packets: 9}, nil)

	ch, stop := b.Subscribe("cam")
	defer stop()

	if err := r.CaptureOnce(ctx, Source{DeviceKey: "cam", AccountID: acct, StreamURL: "rtsp://x/1"}); err != nil {
		t.Fatal(err)
	}

	var init, frag []byte
	for i := 0; i < 2; i++ {
		select {
		case seg := <-ch:
			if seg.Init {
				init = seg.Data
			} else {
				frag = seg.Data
			}
		default:
			t.Fatalf("expected an init segment and a fragment, got %d segments", i)
		}
	}
	if len(init) == 0 || len(frag) == 0 {
		t.Fatal("live view did not receive both an init segment and a fragment")
	}

	// The clip on disk is exactly those two concatenated.
	clips := clipState(t, st, acct, "cam")
	if len(clips) != 1 {
		t.Fatalf("wrote %d clips", len(clips))
	}
	onDisk, err := os.ReadFile(filepath.Join(r.cfg.Root, clipRelPath(t, st, clips[0].ID)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(onDisk, append(append([]byte(nil), init...), frag...)) {
		t.Error("the bytes published to live viewers differ from the bytes written to disk; " +
			"two muxers over one stream is two chances to disagree")
	}
}

// clipRelPath reads a clip's stored path directly.
func clipRelPath(t *testing.T, st *store.Store, id string) string {
	t.Helper()
	var rel string
	if err := st.DB().QueryRowContext(context.Background(),
		`SELECT rel_path FROM camera_clips WHERE id = ?`, id).Scan(&rel); err != nil {
		t.Fatal(err)
	}
	return rel
}
