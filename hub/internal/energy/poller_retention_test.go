package energy

import (
	"context"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Sample retention, which until now never ran.
//
// PruneSamples has existed for a while: written, documented, and guarded with
// real care — it refuses while any bucket at or before the cutoff is still
// dirty, so a queued rollup can never lose the samples it has not read yet. It
// simply had no caller anywhere outside its own file. A hub polling a meter
// every 60 seconds therefore grew its samples table forever, on the Raspberry
// Pi this product targets.
//
// The second test is the one worth keeping: pruning runs AFTER the rollup, and
// that order is load-bearing rather than stylistic. Prune first and the cutoff
// is permanently blocked by its own dirty backlog, so the window never
// advances and retention silently does nothing — which looks exactly like
// working code.

// pollAt drives one cycle with a reading at t, then returns the result.
func pollAt(t *testing.T, p *Poller, drv *fakeMeter, at time.Time, value float64) PollResult {
	t.Helper()
	drv.readings = []devices.Reading{{DeviceID: "m1", Metric: "kwh", Value: value, At: at}}
	res, err := p.PollOnce(context.Background())
	if err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	return res
}

func TestPollCyclePrunesSamplesPastTheWindow(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "fake:m1", nil)
	drv := &fakeMeter{id: "fake"}
	reg := newRegistry(t, drv)

	now := base.Add(48 * time.Hour)
	p := NewPoller(reg, s, acc, WithSampleRetention(time.Hour))
	p.now = func() time.Time { return now }

	var pruned int64
	for i := 0; i <= 3; i++ {
		res := pollAt(t, p, drv, base.Add(time.Duration(i)*15*time.Minute), float64(i)*2)
		if res.PruneErr != nil {
			t.Fatalf("cycle %d: prune refused: %v", i, res.PruneErr)
		}
		pruned += res.Pruned
	}
	if pruned == 0 {
		t.Fatal("nothing was ever pruned; retention did not run")
	}
	// Exactly the anchor survives: everything here is 48h old against a 1h
	// window, so only the never-pruned newest sample per channel is left.
	if got := sampleCount(t, s, acc); got != 1 {
		t.Fatalf("%d samples remain, want only the anchor", got)
	}
	// The evidence is untouched — deltas are never pruned.
	if ds := deltaRows(t, s, acc, "fake:m1", "kwh"); len(ds) == 0 {
		t.Fatal("pruning destroyed the delta record")
	}
}

// The reason the anchor exists. A meter that goes silent for longer than the
// retention window must still produce a delta when it comes back: without the
// anchor its first reading has no predecessor to pair against, so the
// consumption is accepted and then silently produces nothing.
func TestAMeterReturningAfterALongSilenceStillProducesADelta(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "fake:m1", nil)
	drv := &fakeMeter{id: "fake"}
	reg := newRegistry(t, drv)

	now := base
	p := NewPoller(reg, s, acc, WithSampleRetention(time.Hour))
	p.now = func() time.Time { return now }

	// A reading, then a long silence during which retention keeps running.
	pollAt(t, p, drv, base, 100)
	now = base.Add(90 * 24 * time.Hour)
	drv.readings = nil
	if _, err := p.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	// The meter comes back with a higher counter.
	before := len(deltaRows(t, s, acc, "fake:m1", "kwh"))
	pollAt(t, p, drv, now, 160)
	after := deltaRows(t, s, acc, "fake:m1", "kwh")
	if len(after) <= before {
		t.Fatalf("a returning meter produced no new delta (%d -> %d); its anchor "+
			"sample was pruned and 60 kWh vanished", before, len(after))
	}
}

// Retention off must stay reachable and must stay the old behaviour: an
// operator keeping every raw reading for a regulator has to be able to say so.
func TestRetentionOffKeepsEverySample(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "fake:m1", nil)
	drv := &fakeMeter{id: "fake"}
	reg := newRegistry(t, drv)

	p := NewPoller(reg, s, acc) // no WithSampleRetention
	p.now = func() time.Time { return base.Add(48 * time.Hour) }

	for i := 0; i <= 3; i++ {
		res := pollAt(t, p, drv, base.Add(time.Duration(i)*15*time.Minute), float64(i)*2)
		if res.Pruned != 0 {
			t.Fatalf("pruned %d samples with retention off", res.Pruned)
		}
	}
	if got := sampleCount(t, s, acc); got != 4 {
		t.Fatalf("kept %d samples, want all 4", got)
	}
}

// A zero or negative retention is "keep forever", not "delete everything".
// The option guards this, and getting it backwards would delete a customer's
// history on a typo.
func TestZeroRetentionIsKeepForeverNotDeleteEverything(t *testing.T) {
	s, acc, _ := newStore(t)
	counterChannel(t, s, acc, "fake:m1", nil)
	drv := &fakeMeter{id: "fake"}
	reg := newRegistry(t, drv)

	for _, d := range []time.Duration{0, -time.Hour} {
		p := NewPoller(reg, s, acc, WithSampleRetention(d))
		if p.sampleRetention != 0 {
			t.Fatalf("WithSampleRetention(%v) set %v; a non-positive window must "+
				"mean keep-forever, never a cutoff in the future", d, p.sampleRetention)
		}
	}
}
