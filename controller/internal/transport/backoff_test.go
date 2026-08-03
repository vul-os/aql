package transport

import (
	"context"
	"testing"
	"time"
)

// The reconnect backoff, which had no test.
//
// This is the one function in the controller whose failure mode is felt by
// something other than the controller: every unit in a fleet runs it against
// the same hub, and a backoff that returns zero is a hot reconnect loop from
// every gate at once — a self-inflicted outage arriving from the field, at
// exactly the moment the hub is already unreachable.
//
// # The clamp is the whole test
//
// `attempt` is clamped to 9 before the shift. Without that clamp the shift is
// the bug: Go defines a shift of 64 or more as zero rather than as overflow, so
// `time.Second << 100` is 0, the `base > 5*time.Minute` cap does not fire on a
// zero, and backoff returns 0. Not a long wait, not a panic — no wait at all.
//
// The caller reaches high attempt counts by simply staying disconnected, which
// is the normal condition this function exists for.
func TestBackoffIsNeverZeroHoweverManyAttemptsHavePassed(t *testing.T) {
	// Well past the clamp, including counts a unit offline for a long time
	// would really reach.
	for _, attempt := range []int{0, 1, 5, 9, 10, 63, 64, 65, 100, 1 << 20} {
		for i := 0; i < 200; i++ {
			d := backoff(attempt)
			if d <= 0 {
				t.Fatalf("backoff(%d) = %v — a non-positive backoff is a hot reconnect "+
					"loop against the hub from every controller in the fleet", attempt, d)
			}
			// The documented shape: min(1s<<attempt, 5m) x [0.5, 1.5). The cap
			// is on the base, so the largest value it may ever return is 7m30s.
			if d >= 7*time.Minute+30*time.Second {
				t.Fatalf("backoff(%d) = %v, above the 7m30s ceiling the 5m base cap "+
					"and the 1.5 jitter bound imply", attempt, d)
			}
		}
	}
}

// The lower end matters too: the first retry must not be instant.
//
// A controller that reconnects immediately on the first failure turns a
// one-second hub restart into a thundering herd. The jitter floor of 0.5 on a
// one-second base is what makes the minimum 500ms.
func TestTheFirstRetryStillWaits(t *testing.T) {
	for i := 0; i < 500; i++ {
		if d := backoff(0); d < 500*time.Millisecond {
			t.Fatalf("backoff(0) = %v, below the 500ms the 1s base and 0.5 jitter floor imply", d)
		}
	}
}

// Backoff grows: an early attempt must not be able to wait longer than a late
// one is guaranteed to.
//
// Asserted between attempt 0 and attempt 9 rather than between adjacent
// attempts, because the jitter windows of neighbours OVERLAP by design —
// backoff(3) can exceed backoff(4) on any given call and that is correct, not a
// bug. Comparing the extremes is the strongest claim the jitter permits, and
// asserting anything tighter would be a flaky test dressed as a strict one.
func TestBackoffGrowsWithAttempts(t *testing.T) {
	var maxFirst, minLast time.Duration = 0, time.Hour
	for i := 0; i < 500; i++ {
		if d := backoff(0); d > maxFirst {
			maxFirst = d
		}
		if d := backoff(9); d < minLast {
			minLast = d
		}
	}
	if maxFirst >= minLast {
		t.Fatalf("the largest backoff(0) seen was %v and the smallest backoff(9) was %v; "+
			"the schedule is not growing", maxFirst, minLast)
	}
}

// sleepCtx returns as soon as the context is done rather than serving out its
// timer.
//
// This is what makes shutdown prompt: the runner sleeps a backoff of up to
// seven and a half minutes between reconnect attempts, and a controller that
// ignored cancellation there would take that long to stop after a SIGTERM —
// long enough for an operator or a service manager to conclude it had hung and
// kill it mid-write.
func TestSleepCtxReturnsOnCancellationRatherThanServingTheTimer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		sleepCtx(ctx, time.Hour)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("sleepCtx did not return within 5s of cancellation; a controller would " +
			"take its full backoff to shut down")
	}
}

// And the other half: with no cancellation it does wait for the timer.
//
// The control. A sleepCtx that returned immediately would satisfy the test
// above perfectly while removing the backoff entirely — the same hot loop, one
// function further down.
func TestSleepCtxActuallySleeps(t *testing.T) {
	start := time.Now()
	sleepCtx(context.Background(), 50*time.Millisecond)
	if elapsed := time.Since(start); elapsed < 40*time.Millisecond {
		t.Fatalf("sleepCtx(50ms) returned after %v; it is not waiting, so every backoff "+
			"the runner computes is discarded", elapsed)
	}
}
