package main

// Recovering energy history after a timezone change.
//
// The trap: rollups carry `tz` in their primary key, reads filter on the zone
// configured now, and the incremental engine recomputes only what ingest marked
// dirty. Change AQL_ENERGY_TZ and the history is still in the database, keyed to
// a zone nothing asks about — a hub that has metered for months shows no past.
//
// These tests do the whole round trip against a real store rather than asserting
// the pieces: ingest under one zone, read under it, switch zones, watch the
// history vanish, run the rebuild, watch it come back.

import (
	"context"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/energy"
	"github.com/vul-os/aql/hub/internal/store"
)

// seedMeter ingests a day of hourly counter samples for one channel.
func seedMeter(t *testing.T, st *store.Store, acct string, loc *time.Location, start time.Time, hours int) {
	t.Helper()
	es := energy.NewStore(st.DB(), energy.WithLocation(loc))
	ctx := context.Background()
	if err := es.UpsertChannel(ctx, acct, energy.Channel{
		AccountID: acct, DeviceKey: "mock:meter-1", Metric: "kwh",
		Kind: energy.KindCounter, Source: energy.SourceGrid, Flow: energy.FlowSupply,
		Label: "Main", Scale: 1, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	var samples []energy.Sample
	for i := 0; i <= hours; i++ {
		samples = append(samples, energy.Sample{
			DeviceKey: "mock:meter-1", Metric: "kwh",
			At: start.Add(time.Duration(i) * time.Hour), Value: float64(i) * 2, HasValue: true,
		})
	}
	if _, err := es.Ingest(ctx, acct, samples); err != nil {
		t.Fatal(err)
	}
	for {
		res, err := es.Rollup(ctx, acct, 0)
		if err != nil {
			t.Fatal(err)
		}
		if res.Remaining == 0 {
			break
		}
	}
}

func dayBuckets(t *testing.T, st *store.Store, acct string, loc *time.Location, from, to time.Time) int {
	t.Helper()
	es := energy.NewStore(st.DB(), energy.WithLocation(loc))
	got, err := es.Series(context.Background(), acct, energy.SeriesQuery{
		DeviceKey: "mock:meter-1", Metric: "kwh", Grain: energy.GrainHour, From: from, To: to,
	})
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, b := range got {
		if b.KWh != nil {
			n++
		}
	}
	return n
}

func TestARollupRebuildRecoversHistoryAfterATimezoneChange(t *testing.T) {
	h, _, acct := energyHub(t)
	st := h.store
	utc := time.UTC
	jhb, err := time.LoadLocation("Africa/Johannesburg")
	if err != nil {
		t.Skip("no tzdata on this system")
	}

	start := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	seedMeter(t, st, acct, utc, start, 24)

	from, to := start.Add(-time.Hour), start.Add(26*time.Hour)
	if n := dayBuckets(t, st, acct, utc, from, to); n == 0 {
		t.Fatal("fixture is wrong: nothing was rolled up under UTC")
	}

	// The operator sets their real timezone. Nothing re-derives anything.
	if n := dayBuckets(t, st, acct, jhb, from, to); n != 0 {
		t.Fatalf(`%d buckets survived the timezone change.

If this passes without a rebuild the premise is wrong and the command is
unnecessary — check whether reads still filter on tz.`, n)
	}

	// The rebuild.
	es := energy.NewStore(st.DB(), energy.WithLocation(jhb))
	first, last, ok, err := es.SampleSpan(context.Background(), acct)
	if err != nil || !ok {
		t.Fatalf("SampleSpan: %v ok=%v", err, ok)
	}
	marked, err := es.MarkRangeDirty(context.Background(), acct, first, last)
	if err != nil {
		t.Fatal(err)
	}
	if marked == 0 {
		t.Fatal("MarkRangeDirty queued nothing, so the rebuild would be a no-op")
	}
	for {
		res, err := es.Rollup(context.Background(), acct, 0)
		if err != nil {
			t.Fatal(err)
		}
		if res.Remaining == 0 {
			break
		}
	}

	if n := dayBuckets(t, st, acct, jhb, from, to); n == 0 {
		t.Fatal(`the rebuild recovered nothing.

MarkRangeDirty queued work and Rollup drained it, but the series under the new
timezone is still empty — so the buckets were written under a key the read path
does not ask for.`)
	}

	// And the old zone's buckets are untouched. A rebuild that deleted them
	// would turn a recoverable mistake into an unrecoverable one if the new
	// zone were also wrong.
	if n := dayBuckets(t, st, acct, utc, from, to); n == 0 {
		t.Error("the rebuild destroyed the buckets under the previous timezone")
	}
}

// Running it twice must do nothing the first run did not. Idempotence is what
// makes it safe to re-run after an interruption, which is the only recovery this
// command has — it deliberately takes no transaction.
func TestRebuildingTwiceQueuesNothingTheSecondTime(t *testing.T) {
	h, _, acct := energyHub(t)
	jhb, err := time.LoadLocation("Africa/Johannesburg")
	if err != nil {
		t.Skip("no tzdata on this system")
	}
	seedMeter(t, h.store, acct, time.UTC, time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC), 6)

	es := energy.NewStore(h.store.DB(), energy.WithLocation(jhb))
	ctx := context.Background()
	first, last, _, err := es.SampleSpan(ctx, acct)
	if err != nil {
		t.Fatal(err)
	}
	firstMark, err := es.MarkRangeDirty(ctx, acct, first, last)
	if err != nil || firstMark == 0 {
		t.Fatalf("first mark queued %d (%v)", firstMark, err)
	}
	secondMark, err := es.MarkRangeDirty(ctx, acct, first, last)
	if err != nil {
		t.Fatal(err)
	}
	if secondMark != 0 {
		t.Errorf("re-marking an already-queued range queued %d more buckets; the insert is "+
			"ON CONFLICT DO NOTHING precisely so an interrupted run can be re-run", secondMark)
	}
}

// An account with no retained samples must not report success. There is nothing
// to rebuild from, and saying "done" would tell an operator their history is
// coming back when it is not.
func TestAnAccountWithNoSamplesHasNothingToRebuild(t *testing.T) {
	h, _, acct := energyHub(t)
	es := energy.NewStore(h.store.DB(), energy.WithLocation(time.UTC))
	_, _, ok, err := es.SampleSpan(context.Background(), acct)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("an account with no samples reported a recoverable span")
	}
}
