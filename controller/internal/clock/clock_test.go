package clock_test

import (
	"testing"
	"time"

	"github.com/vul-os/aql/controller/internal/clock"
)

// TestStaleBothDirections covers the defect: a naive "elapsed > limit"
// check only catches a clock that has drifted too far FORWARD. A clock
// reset BACKWARD past lastSynced (RTC-less reboot landing before the
// persisted sync instant) produces a negative elapsed time that such a
// check never flags. Stale must fail closed in both directions.
func TestStaleBothDirections(t *testing.T) {
	const limit = 1209600 // 14 days, proto/grants.md
	cases := []struct {
		name            string
		now, lastSynced int64
		want            bool
	}{
		{"never synced", 1_000_000, 0, true},
		{"fresh sync, now==lastSynced", 1_000_000, 1_000_000, false},
		{"well within window", 1_000_000, 1_000_000 - 100, false},
		{"exactly at forward limit", 1_000_000 + limit, 1_000_000, false},
		{"one second past forward limit", 1_000_000 + limit + 1, 1_000_000, true},
		{"far forward drift", 1_000_000 + 50*limit, 1_000_000, true},
		// Backward: now is BEFORE lastSynced — the RTC-less-reboot case.
		{"one second backward", 999_999, 1_000_000, true},
		{"far backward reset (bad wall clock)", 1_000_000, 1_000_000 + 2*limit, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := clock.Stale(c.now, c.lastSynced, limit); got != c.want {
				t.Errorf("Stale(now=%d, lastSynced=%d, limit=%d) = %v, want %v",
					c.now, c.lastSynced, limit, got, c.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// The clock itself
// ---------------------------------------------------------------------------
//
// clock_test.go covered Stale — a pure function — and nothing else, so the
// package read as tested while every stateful path in it was at zero: NewSynced,
// Now, SyncFromGateway, LastGatewaySync. A test file plus one function at 100%
// is exactly the shape that stops anyone looking.
//
// What is at stake: this clock is the time base every offline grant is verified
// against. A controller whose Now() is wrong either honours expired grants or
// refuses valid ones, and neither is visible from the hub.

// The reason this package exists at all: after a sync, Now() is derived from
// the GATEWAY base advanced by the local MONOTONIC clock — never from the
// system wall clock, which on an RTC-less board is whatever the last boot
// guessed and which NTP may step out from under it at any moment.
//
// A base far from real time is what makes that observable: if Now() ever fell
// back to time.Now(), it would return ~1.7e9 here instead of ~1e6.
func TestNowFollowsTheGatewayBaseAndNotTheWallClock(t *testing.T) {
	const base = int64(1_000_000)
	c := clock.NewSynced(0, nil)
	c.SyncFromGateway(base)

	got := c.Now()
	if got < base || got > base+5 {
		t.Fatalf("Now() = %d, want within a few seconds of the gateway base %d — "+
			"a value near the system clock means the monotonic base was abandoned", got, base)
	}
	if wall := time.Now().Unix(); got == wall {
		t.Errorf("Now() returned the wall clock (%d)", wall)
	}
}

// Before the first sync there is no gateway base, so the wall clock is the only
// answer available — and LastGatewaySync must report the PERSISTED instant from
// previous runs, which is what keeps the stale-clock rule working across a
// reboot.
func TestBeforeTheFirstSyncTheClockFallsBackAndRemembers(t *testing.T) {
	const persisted = int64(1_700_000_000)
	c := clock.NewSynced(persisted, nil)

	if got, wall := c.Now(), time.Now().Unix(); got < wall-2 || got > wall+2 {
		t.Errorf("Now() = %d before any sync, want the wall clock (~%d)", got, wall)
	}
	if got := c.LastGatewaySync(); got != persisted {
		t.Errorf("LastGatewaySync() = %d, want the persisted %d — without it a reboot "+
			"looks like a controller that has never synced", got, persisted)
	}
}

// A controller with no persisted sync has never synced, and Stale must say so.
// This is the composition the product actually runs: an unsynced clock refuses
// offline decisions rather than trusting a boot-time guess.
func TestAnUnsyncedClockIsStale(t *testing.T) {
	const limit = 1209600
	c := clock.NewSynced(0, nil)
	if !clock.Stale(c.Now(), c.LastGatewaySync(), limit) {
		t.Error("a controller that has never synced is not reporting a stale clock — " +
			"it would verify offline grants against whatever the last boot guessed")
	}
	c.SyncFromGateway(time.Now().Unix())
	if clock.Stale(c.Now(), c.LastGatewaySync(), limit) {
		t.Error("a freshly synced clock reports stale")
	}
}

// Every sync is persisted, because the value is what survives the reboot.
func TestEverySyncIsPersisted(t *testing.T) {
	var got []int64
	c := clock.NewSynced(0, func(ts int64) { got = append(got, ts) })

	c.SyncFromGateway(1_000_000)
	c.SyncFromGateway(1_000_060)

	if len(got) != 2 || got[0] != 1_000_000 || got[1] != 1_000_060 {
		t.Errorf("persisted %v, want both syncs in order", got)
	}
	if last := c.LastGatewaySync(); last != 1_000_060 {
		t.Errorf("LastGatewaySync() = %d after re-syncing, want the newest", last)
	}
}

// A nil persist hook is the documented case (a controller with no state store)
// and must not panic.
func TestSyncingWithNoPersistenceHookIsSafe(t *testing.T) {
	c := clock.NewSynced(0, nil)
	c.SyncFromGateway(1_000_000)
	if c.LastGatewaySync() != 1_000_000 {
		t.Error("sync did not take effect without a persistence hook")
	}
}

// Re-basing moves the clock backward as readily as forward. A gateway that
// corrects a controller which had jumped ahead must be obeyed — the gateway is
// the authority, and a clock that only ever advanced would be unfixable.
func TestAGatewaySyncCanMoveTheClockBackward(t *testing.T) {
	c := clock.NewSynced(0, nil)
	c.SyncFromGateway(2_000_000)
	c.SyncFromGateway(1_000_000)
	if got := c.Now(); got < 1_000_000 || got > 1_000_005 {
		t.Errorf("Now() = %d after a corrective sync, want ~1000000", got)
	}
}
