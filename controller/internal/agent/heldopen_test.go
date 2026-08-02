package agent

import (
	"context"
	"sync"
	"testing"
	"time"
)

// A sensor whose readings a test can change, and whose presence it can revoke.
type fakeSensor struct {
	mu      sync.Mutex
	closed  bool
	present bool
}

func (f *fakeSensor) GateClosed() (bool, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed, f.present
}

func (f *fakeSensor) set(closed, present bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed, f.present = closed, present
}

type recorded struct {
	mu   sync.Mutex
	kind []string
	data []map[string]any
}

func (r *recorded) record(kind string, data map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.kind = append(r.kind, kind)
	r.data = append(r.data, data)
}

func (r *recorded) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.kind)
}

// A clock the test drives, so nothing here waits on real minutes.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newWatcher(s *fakeSensor, r *recorded, c *fakeClock, threshold time.Duration) *heldOpenWatcher {
	return &heldOpenWatcher{
		sensors:   s,
		record:    r.record,
		threshold: threshold,
		interval:  time.Millisecond,
		now:       c.now,
	}
}

// waitForTick gives the 1ms-interval watcher room to observe the current
// sensor state before a test changes the clock under it.
func waitForTick() { time.Sleep(20 * time.Millisecond) }

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// The alert fires once, after the threshold, and carries the elapsed seconds.
func TestHeldOpenFiresOnceAfterTheThreshold(t *testing.T) {
	s := &fakeSensor{closed: false, present: true}
	r := &recorded{}
	c := &fakeClock{t: time.Unix(1_700_000_000, 0)}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newWatcher(s, r, c, 90*time.Second).run(ctx)

	// Let the first tick land before moving the clock.
	//
	// The watcher stamps "not closed since" on the tick that first sees the
	// gate open, and that tick happens whenever the goroutine gets scheduled.
	// Advancing immediately made the stamp land at T+30s instead of T, so the
	// elapsed time never reached the threshold and this test failed against
	// working code — a race in the test, not in the watcher.
	waitForTick()

	// Not yet: the sensor has been not-closed for less than the threshold.
	c.advance(30 * time.Second)
	time.Sleep(20 * time.Millisecond)
	if n := r.count(); n != 0 {
		t.Fatalf("alerted after 30s of a 90s threshold (%d events)", n)
	}

	c.advance(70 * time.Second)
	waitFor(t, "the held_open event", func() bool { return r.count() >= 1 })

	r.mu.Lock()
	kind, data := r.kind[0], r.data[0]
	r.mu.Unlock()
	if kind != "held_open" {
		t.Errorf("kind = %q, want held_open", kind)
	}
	secs, ok := data["seconds"].(int)
	if !ok || secs < 90 {
		t.Errorf("seconds = %v, want at least the 90s threshold", data["seconds"])
	}

	// And it does not repeat while the gate stays open. A durable, at-least-once
	// event queue filled with copies of one fact is worse than no alert.
	c.advance(10 * time.Minute)
	time.Sleep(30 * time.Millisecond)
	if n := r.count(); n != 1 {
		t.Errorf("%d events after ten more minutes open; the alert must fire once per episode", n)
	}
}

// Closing re-arms it, so a second episode alerts again.
func TestHeldOpenRearmsAfterTheGateCloses(t *testing.T) {
	s := &fakeSensor{closed: false, present: true}
	r := &recorded{}
	c := &fakeClock{t: time.Unix(1_700_000_000, 0)}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newWatcher(s, r, c, 60*time.Second).run(ctx)
	waitForTick()

	c.advance(61 * time.Second)
	waitFor(t, "the first alert", func() bool { return r.count() == 1 })

	s.set(true, true) // shut
	waitForTick()
	s.set(false, true) // opened again
	waitForTick()
	c.advance(61 * time.Second)
	waitFor(t, "the second alert", func() bool { return r.count() == 2 })
}

// No sensor, no reporting — in either direction.
func TestHeldOpenSaysNothingWithoutASensor(t *testing.T) {
	// Absent from the start: the watcher returns immediately rather than
	// treating "cannot see the gate" as "the gate is open".
	s := &fakeSensor{closed: false, present: false}
	r := &recorded{}
	c := &fakeClock{t: time.Unix(1_700_000_000, 0)}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newWatcher(s, r, c, time.Second).run(ctx)
	c.advance(time.Hour)
	time.Sleep(30 * time.Millisecond)
	if n := r.count(); n != 0 {
		t.Errorf("%d events from a controller with no position sensor", n)
	}

	// And when it disappears mid-episode — a released line after a fault — the
	// count resets instead of maturing into an alert about a gate nobody can
	// see.
	s2 := &fakeSensor{closed: false, present: true}
	r2 := &recorded{}
	c2 := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	go newWatcher(s2, r2, c2, 60*time.Second).run(ctx2)

	c2.advance(30 * time.Second)
	time.Sleep(20 * time.Millisecond)
	s2.set(false, false) // sensor gone
	c2.advance(10 * time.Minute)
	time.Sleep(30 * time.Millisecond)
	if n := r2.count(); n != 0 {
		t.Errorf("%d events after the sensor disappeared mid-episode", n)
	}
}

// A threshold of zero disables it, which is the default for a controller whose
// operator has not asked for the alert.
func TestHeldOpenIsOffWhenNoThresholdIsSet(t *testing.T) {
	s := &fakeSensor{closed: false, present: true}
	r := &recorded{}
	c := &fakeClock{t: time.Unix(1_700_000_000, 0)}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newWatcher(s, r, c, 0).run(ctx)
	c.advance(time.Hour)
	time.Sleep(30 * time.Millisecond)
	if n := r.count(); n != 0 {
		t.Errorf("%d events with the threshold disabled", n)
	}
}
