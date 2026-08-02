package command

import (
	"sync"
	"testing"
	"time"
)

// A relay that remembers what it was told to do, and when.
type recordingRelay struct {
	mu    sync.Mutex
	calls []string
}

func (r *recordingRelay) Pulse(time.Duration) error { return r.note("pulse") }
func (r *recordingRelay) Hold() error               { return r.note("hold") }
func (r *recordingRelay) Release() error            { return r.note("release") }
func (r *recordingRelay) State() string             { return "idle" }

func (r *recordingRelay) note(s string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, s)
	return nil
}

func (r *recordingRelay) seen() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.calls...)
}

// A hold that expires as it is cancelled must not release the gate.
//
// # The defect this pins
//
// time.Timer.Stop() does not wait for a callback that has already started, and
// returns false to say so. cancelRelease ignored that: after it returned, the
// in-flight callback still called Relay.Release(). Measured before the fix, at
// five runs out of five, by cancelling exactly at expiry.
//
// On a gate that is not an abstraction. A hold is running; a new open arrives
// as it expires; the command path cancels the hold and pulses — and the old
// callback closes the gate that was just opened, after the ack has already gone
// back saying the open succeeded. The gate shuts by itself and the audit trail
// disagrees.
//
// The fix is a generation counter rather than a wait: waiting would block the
// command path on a callback that is talking to hardware.
func TestACancelledHoldDoesNotReleaseAfterwards(t *testing.T) {
	for i := 0; i < 20; i++ {
		rl := &recordingRelay{}
		p := &Processor{Relay: rl}

		p.scheduleRelease(20 * time.Millisecond)
		// Land the cancel on the expiry, which is the whole hazard.
		time.Sleep(20 * time.Millisecond)
		p.cancelRelease()
		atCancel := len(rl.seen())

		// The property is not "no release ever" — a callback that reached the
		// relay BEFORE the cancel took the lock genuinely happened, and no
		// design can undo it. What must hold is that nothing further arrives
		// once cancelRelease has returned.
		time.Sleep(40 * time.Millisecond)
		if after := len(rl.seen()); after != atCancel {
			t.Fatalf("run %d: relay was told %v — %d call(s) arrived AFTER the hold was cancelled",
				i, rl.seen(), after-atCancel)
		}
	}
}

// Rescheduling invalidates the previous hold, so only the latest one fires.
func TestOnlyTheCurrentHoldReleases(t *testing.T) {
	rl := &recordingRelay{}
	p := &Processor{Relay: rl}

	p.scheduleRelease(20 * time.Millisecond)
	time.Sleep(20 * time.Millisecond)
	// A new hold arrives exactly as the first expires — the real sequence.
	p.scheduleRelease(60 * time.Millisecond)
	atReschedule := len(rl.seen())

	// Same property as the cancel case: a release that reached the relay before
	// the reschedule took the lock genuinely happened first and cannot be
	// undone. What must hold is that the SUPERSEDED hold contributes nothing
	// afterwards.
	time.Sleep(40 * time.Millisecond)
	if n := len(rl.seen()); n != atReschedule {
		t.Fatalf("the superseded hold released after being replaced: %v", rl.seen())
	}

	// And the new one still fires, or the fix would have broken the feature it
	// is protecting.
	time.Sleep(60 * time.Millisecond)
	got := rl.seen()
	if len(got) != atReschedule+1 || got[len(got)-1] != "release" {
		t.Fatalf("the current hold did not release on time: %v", got)
	}
}
