package recording

import (
	"context"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// ExpireAll — the retention fan-out — which was at 0% while everything below it
// was well covered.
//
// expireOnce, removeClip, ensureFreeSpace and ReclaimOrphans all have tests.
// The wrapper that decides WHICH accounts and WHICH cameras those run against
// did not, and it is the part with the interesting failure modes, because both
// of them are silent:
//
//   - Group the (account, device_key) pairs wrongly and expireOnce is called
//     with an account that owns none of the keys handed to it. Nothing matches,
//     nothing is deleted, no error is returned, and footage outlives its
//     retention window forever. A privacy commitment quietly stops holding and
//     the sweep keeps reporting success.
//   - Drive the work list from the configured cameras instead of the index and
//     a camera removed from the config strands its footage in the same way,
//     which is exactly what this function's doc comment says it is avoiding.
//
// Neither shows up in a log, and both leave the disk looking fine.

// A second account. seedAccount hardcodes one username, so it cannot be called
// twice against the same store.
func seedSecondAccount(t *testing.T, st *store.Store) string {
	t.Helper()
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "rec2@x.com", "hash", "R2", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, "Second Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return acct.ID
}

func mustRecord(t *testing.T, st *store.Store, acct, key string, startedAt int64, rel string) {
	t.Helper()
	if _, err := st.RecordClip(context.Background(), store.Clip{
		AccountID: acct, DeviceKey: key, StartedAt: startedAt,
		DurationS: 60, SizeBytes: 1000, RelPath: rel,
	}); err != nil {
		t.Fatal(err)
	}
}

// Every account on the hub is swept, and each camera is evaluated under the
// account that actually owns it.
//
// Two accounts, one camera each, both holding a clip past its retention. If the
// (account, device_key) pairs were grouped the wrong way round — an easy
// transposition on a [2]string — expireOnce would be handed an "account" that
// is really a device key and a key list that is really account ids. Not one
// clip would match, ExpireAll would return (0, nil), and every camera on the
// hub would keep its footage indefinitely while the sweep reported no error.
func TestExpireAllSweepsEveryAccountAndAttributesEachCameraToItsOwner(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acctA := seedAccount(t, st)
	acctB := seedSecondAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, now, map[string]int{"cam-a": 1, "cam-b": 1})

	old := now.Add(-5 * time.Hour).Unix()
	mustRecord(t, st, acctA, "cam-a", old, "cam-a/old.mp4")
	mustRecord(t, st, acctB, "cam-b", old, "cam-b/old.mp4")

	n, err := r.ExpireAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("ExpireAll expired %d clips, want 2. A count of 0 with no error is what "+
			"a mis-grouped work list looks like: every camera keeps its footage past "+
			"its retention and nothing reports a problem.", n)
	}
	if clipState(t, st, acctA, "cam-a")[0].DeletedAt == nil {
		t.Error("account A's expired clip survived the sweep")
	}
	if clipState(t, st, acctB, "cam-b")[0].DeletedAt == nil {
		t.Error("account B's expired clip survived the sweep — only the first account " +
			"was swept, so every account after the first keeps its footage")
	}
}

// A clip that is still inside its window survives, in an account that also has
// an expired one.
//
// The control. Every assertion above is satisfied by an ExpireAll that deletes
// everything it can reach, which would be a far worse bug than the one being
// guarded against — retention is a ceiling on how long footage is kept, not a
// licence to delete it early, and someone reviewing an incident from this
// morning needs it to still be there.
func TestExpireAllLeavesClipsInsideTheirWindow(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acctA := seedAccount(t, st)
	acctB := seedSecondAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	// 24-hour retention on both cameras.
	r := testRecorder(t, st, nil, now, map[string]int{"cam-a": 24, "cam-b": 24})

	mustRecord(t, st, acctA, "cam-a", now.Add(-48*time.Hour).Unix(), "cam-a/old.mp4")
	mustRecord(t, st, acctA, "cam-a", now.Add(-1*time.Hour).Unix(), "cam-a/fresh.mp4")
	mustRecord(t, st, acctB, "cam-b", now.Add(-2*time.Hour).Unix(), "cam-b/fresh.mp4")

	n, err := r.ExpireAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("ExpireAll expired %d clips, want 1 — only the 48-hour-old one is past "+
			"a 24-hour window", n)
	}
	for _, c := range clipState(t, st, acctB, "cam-b") {
		if c.DeletedAt != nil {
			t.Error("a two-hour-old clip in the OTHER account was deleted under a " +
				"24-hour retention; one account's sweep is reaching another's footage")
		}
	}
	var live int
	for _, c := range clipState(t, st, acctA, "cam-a") {
		if c.DeletedAt == nil {
			live++
		}
	}
	if live != 1 {
		t.Errorf("%d of account A's clips survived, want 1 (the one-hour-old one)", live)
	}
}

// A camera the config no longer mentions is still swept.
//
// This is the reason the work list comes from the clip index rather than from
// the configured cameras, stated in ExpireAll's own doc: a camera removed from
// the engine's config still has footage on disk, and a config-driven sweep
// would never look at it again. Its retention would silently become forever —
// the failure is invisible precisely because the camera is gone from every
// screen an operator looks at.
//
// "cam-gone" is absent from the RetainHours map here, so it falls to
// DefaultRetainHours, and the clip is aged well past that.
func TestFootageFromARemovedCameraIsStillExpired(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, now, map[string]int{"cam-still-here": 24})

	if _, configured := r.cfg.RetainHours["cam-gone"]; configured {
		t.Fatal("the fixture is wrong: cam-gone must NOT be in the config for this test " +
			"to be about a removed camera")
	}
	ancient := now.Add(-time.Duration(DefaultRetainHours+48) * time.Hour).Unix()
	mustRecord(t, st, acct, "cam-gone", ancient, "cam-gone/old.mp4")

	n, err := r.ExpireAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("ExpireAll expired %d clips, want 1. A camera dropped from the config "+
			"keeps its footage forever if the sweep is driven by the config instead of "+
			"the index.", n)
	}
	if clipState(t, st, acct, "cam-gone")[0].DeletedAt == nil {
		t.Error("the removed camera's clip is still live")
	}
}

// ClipOwners reports each (account, camera) pair once, and only for clips that
// are still live.
//
// It was at 0% too, and it is the whole work list: a duplicate pair makes
// expireOnce run twice over the same camera, and an already-deleted clip
// reappearing here would make every sweep after the first do work proportional
// to everything ever recorded.
func TestClipOwnersIsDistinctAndExcludesDeletedClips(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	acct := seedAccount(t, st)
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	r := testRecorder(t, st, nil, now, map[string]int{"cam": 1})

	// Three clips on one camera: the pair must still appear exactly once.
	for i, rel := range []string{"cam/a.mp4", "cam/b.mp4", "cam/c.mp4"} {
		mustRecord(t, st, acct, "cam", now.Add(-time.Duration(5+i)*time.Hour).Unix(), rel)
	}
	owners, err := st.ClipOwners(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(owners) != 1 {
		t.Fatalf("ClipOwners returned %d pairs for one camera with three clips, want 1: %v",
			len(owners), owners)
	}
	if owners[0][0] != acct || owners[0][1] != "cam" {
		t.Fatalf("ClipOwners returned %v; want {account, device_key} in that order — "+
			"transposed, ExpireAll sweeps accounts that do not exist", owners[0])
	}

	// After everything is expired, the camera drops out of the work list.
	if _, err := r.ExpireAll(ctx); err != nil {
		t.Fatal(err)
	}
	owners, err = st.ClipOwners(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(owners) != 0 {
		t.Errorf("ClipOwners still reports %v after every clip was expired; each sweep "+
			"would keep re-walking cameras with nothing left on disk", owners)
	}
}
