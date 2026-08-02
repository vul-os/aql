package agent

import (
	"context"
	"time"

	"github.com/vul-os/aql/controller/internal/relay"
)

// held_open: the gate-left-open event proto/events.md reserved.
//
// # Why it was reserved, and what changed
//
// The Kinds table listed `held_open {seconds}` as "reserved — needs a position
// sensor". A position sensor has existed since the GPIO driver landed
// (`-tags gpio`, Linux): relay.Sensors.GateClosed reads a real line and refuses
// to claim the gate is shut when it cannot read one. What was missing is this —
// something that looks at the line MORE THAN ONCE. A poll answers "is it closed
// now"; an alert needs someone watching it stay not-closed.
//
// # What the number means, precisely
//
// `seconds` is how long the sensor has NOT REPORTED CLOSED. That is not the
// same sentence as "the gate was open for N seconds", and the difference is not
// pedantry: GateClosed returns (false, true) both when the gate is genuinely
// open and when the line cannot be read, because a sensor that cannot be read
// must not be allowed to assert the gate is shut (gpio.go). Those two are
// indistinguishable through this interface.
//
// So the event reports the thing that is actually known. An operator who reads
// "not reported closed for 5 minutes" and finds the gate shut has learned
// something true and useful — the sensor is broken — where "open for 5 minutes"
// would have been a claim about a gate nobody watched.
//
// # One event per episode
//
// Emitted once when the threshold is first crossed, not repeatedly, and armed
// again only after a closed reading. A gate propped open for a day should
// produce one alert and not two hundred: the event queue is durable and
// forwarded at least once, so a repeat-until-fixed loop would fill it with
// copies of a fact the hub already has.
type heldOpenWatcher struct {
	sensors   relay.Sensors
	record    func(kind string, data map[string]any)
	threshold time.Duration
	interval  time.Duration
	now       func() time.Time
}

// run polls until ctx ends. It returns immediately when no sensor is present,
// which is every build without the GPIO driver and every GPIO build with no
// sensor line configured — a controller that cannot see the gate must not
// report on it.
func (w *heldOpenWatcher) run(ctx context.Context) {
	if w.sensors == nil || w.threshold <= 0 {
		return
	}
	if _, present := w.sensors.GateClosed(); !present {
		return
	}

	tick := time.NewTicker(w.interval)
	defer tick.Stop()

	var notClosedSince time.Time
	alerted := false

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			closed, present := w.sensors.GateClosed()
			if !present {
				// The sensor went away mid-run (a released line after a fault).
				// Stop counting rather than treating absence as openness.
				notClosedSince = time.Time{}
				alerted = false
				continue
			}
			if closed {
				notClosedSince = time.Time{}
				alerted = false
				continue
			}
			if notClosedSince.IsZero() {
				notClosedSince = w.now()
				continue
			}
			if alerted {
				continue
			}
			if elapsed := w.now().Sub(notClosedSince); elapsed >= w.threshold {
				w.record("held_open", map[string]any{"seconds": int(elapsed.Seconds())})
				alerted = true
			}
		}
	}
}
