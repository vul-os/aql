//go:build gpio

package relay

import (
	"errors"
	"io"
	"log/slog"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// These tests cover everything the GPIO driver does ABOVE the kernel
// boundary. They run on any OS because the lineHandle seam is substituted
// with a fake. They prove NOTHING about the ioctls themselves — see the
// package doc: this driver has not been validated on hardware.

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fakeLine records every logical transition and can fail on demand.
type fakeLine struct {
	mu       sync.Mutex
	writes   []bool // logical values written, in order
	closes   int
	failSetN int   // fail the Nth set (1-based); 0 = never
	setErr   error // error returned by the failing set
	getVal   bool
	getErr   error
	nSets    int
}

func (f *fakeLine) set(asserted bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nSets++
	if f.failSetN != 0 && f.nSets == f.failSetN {
		return f.setErr
	}
	f.writes = append(f.writes, asserted)
	return nil
}

func (f *fakeLine) get() (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.getVal, f.getErr
}

func (f *fakeLine) close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closes++
	return nil
}

func (f *fakeLine) history() []bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]bool(nil), f.writes...)
}

func (f *fakeLine) closed() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closes
}

// energised reports whether the last write left the line asserted.
func (f *fakeLine) energised() bool {
	h := f.history()
	return len(h) > 0 && h[len(h)-1]
}

func newTestGPIO(t *testing.T, cfg GPIOConfig, out, in *fakeLine) *GPIO {
	t.Helper()
	cfg.Log = quietLogger()
	c, err := cfg.normalized()
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	var inH lineHandle
	if in != nil {
		inH = in
	}
	g, err := newGPIO(c, out, inH)
	if err != nil {
		t.Fatalf("newGPIO: %v", err)
	}
	return g
}

func TestNormalizeChipPath(t *testing.T) {
	ok := map[string]string{
		"":                 DefaultChip,
		"0":                "/dev/gpiochip0",
		"4":                "/dev/gpiochip4",
		"gpiochip0":        "/dev/gpiochip0",
		"/dev/gpiochip0":   "/dev/gpiochip0",
		"/dev/gpiochip512": "/dev/gpiochip512",
	}
	for in, want := range ok {
		got, err := normalizeChipPath(in)
		if err != nil || got != want {
			t.Errorf("normalizeChipPath(%q) = %q, %v; want %q, nil", in, got, err, want)
		}
	}
	bad := []string{
		"/etc/passwd",
		"gpiochip0/../../etc/passwd",
		"/dev/gpiochip0/../mem",
		"/dev/gpiochipA",
		"/dev/gpiochip",
		"gpiochip",
		"/dev/gpiochip9999",
		"../dev/gpiochip0",
		"/dev/gpiochip0\x00",
		"0 ",
	}
	for _, in := range bad {
		if got, err := normalizeChipPath(in); err == nil {
			t.Errorf("normalizeChipPath(%q) = %q, nil; want an error", in, got)
		}
	}
}

func TestConfigRejectsNonsenseAtOpen(t *testing.T) {
	cases := []struct {
		name string
		cfg  GPIOConfig
	}{
		{"line out of range", GPIOConfig{Line: 5000}},
		{"bad chip", GPIOConfig{Chip: "/dev/mem"}},
		{"bad bias", GPIOConfig{Bias: Bias(9)}},
		{"consumer too long", GPIOConfig{Consumer: strings.Repeat("x", gpioMaxNameSize)}},
		{"consumer non-printable", GPIOConfig{Consumer: "gate\x01"}},
		{"min pulse below floor", GPIOConfig{MinPulse: time.Millisecond}},
		{"max pulse above ceiling", GPIOConfig{MaxPulse: time.Minute}},
		{"min above max", GPIOConfig{MinPulse: 2 * time.Second, MaxPulse: time.Second}},
		{"hold below max pulse", GPIOConfig{MaxPulse: 4 * time.Second, MaxHold: time.Second}},
		{"hold above ceiling", GPIOConfig{MaxHold: 48 * time.Hour}},
		{"sensor line out of range", GPIOConfig{Sensor: &GPIOSensorConfig{Line: 9000}}},
		{"sensor line == relay line", GPIOConfig{Line: 17, Sensor: &GPIOSensorConfig{Line: 17}}},
		{"sensor bias invalid", GPIOConfig{Sensor: &GPIOSensorConfig{Line: 5, Bias: Bias(7)}}},
		{"sensor debounce too long", GPIOConfig{Sensor: &GPIOSensorConfig{Line: 5, DebounceMs: 60000}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.cfg.normalized(); err == nil {
				t.Fatalf("config %+v accepted; want rejection at open time", tc.cfg)
			}
		})
	}
}

func TestConfigDefaults(t *testing.T) {
	c, err := GPIOConfig{}.normalized()
	if err != nil {
		t.Fatalf("zero config rejected: %v", err)
	}
	if c.Chip != DefaultChip || c.Consumer != DefaultConsumer {
		t.Errorf("defaults: chip=%q consumer=%q", c.Chip, c.Consumer)
	}
	if c.MinPulse != DefaultMinPulse || c.MaxPulse != DefaultMaxPulse || c.MaxHold != DefaultMaxHold {
		t.Errorf("duration defaults: %v %v %v", c.MinPulse, c.MaxPulse, c.MaxHold)
	}
	// The sensor config must be copied, not aliased: a caller mutating its
	// struct after Open must not change the running driver.
	s := &GPIOSensorConfig{Line: 6}
	c2, err := GPIOConfig{Sensor: s}.normalized()
	if err != nil {
		t.Fatal(err)
	}
	s.Line = 99
	if c2.Sensor.Line != 6 {
		t.Errorf("sensor config aliased the caller's struct")
	}
}

func TestOpenIsDeAssertedAndProvesTheValuePath(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()
	if got := out.history(); len(got) != 1 || got[0] {
		t.Fatalf("open wrote %v; want exactly one de-assert", got)
	}
	if g.State() != StateIdle {
		t.Fatalf("state after open = %q", g.State())
	}
}

func TestOpenFailsIfTheLineCannotBeWritten(t *testing.T) {
	out := &fakeLine{failSetN: 1, setErr: errors.New("EIO")}
	in := &fakeLine{}
	c, _ := GPIOConfig{Sensor: &GPIOSensorConfig{Line: 3}, Log: quietLogger()}.normalized()
	if _, err := newGPIO(c, out, in); err == nil {
		t.Fatal("newGPIO succeeded with an unwritable line")
	}
	if out.closed() == 0 || in.closed() == 0 {
		t.Errorf("failed open left lines claimed: out=%d in=%d", out.closed(), in.closed())
	}
}

func TestPulseAssertsThenDeasserts(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	start := time.Now()
	if err := g.Pulse(80 * time.Millisecond); err != nil {
		t.Fatalf("Pulse: %v", err)
	}
	if el := time.Since(start); el < 80*time.Millisecond {
		t.Errorf("Pulse returned after %v; it must block for the full pulse", el)
	}
	want := []bool{false, true, false} // open de-assert, leading edge, trailing edge
	if got := out.history(); !equalBools(got, want) {
		t.Errorf("writes = %v; want %v", got, want)
	}
	if g.State() != StateIdle {
		t.Errorf("state after pulse = %q", g.State())
	}
}

func TestPulseIsObservableWhileItRuns(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	done := make(chan struct{})
	go func() { defer close(done); _ = g.Pulse(150 * time.Millisecond) }()
	time.Sleep(50 * time.Millisecond)
	if s := g.State(); s != StatePulsing {
		t.Errorf("state during pulse = %q, want %q (State must not block on the pulse)", s, StatePulsing)
	}
	if !out.energised() {
		t.Error("line not energised during the pulse")
	}
	<-done
}

func TestPulseRefusesOutOfRangeDurations(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{MinPulse: 100 * time.Millisecond, MaxPulse: time.Second}, out, nil)
	defer g.Close()

	for _, d := range []time.Duration{0, -1, 10 * time.Millisecond, 2 * time.Second} {
		if err := g.Pulse(d); err == nil {
			t.Errorf("Pulse(%v) accepted; want refusal (never clamped)", d)
		}
	}
	if got := out.history(); len(got) != 1 {
		t.Errorf("refused pulses actuated the line: %v", got)
	}
}

func TestPulseRefusedWhileHeld(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	if err := g.Hold(); err != nil {
		t.Fatal(err)
	}
	if err := g.Pulse(50 * time.Millisecond); err == nil {
		t.Fatal("Pulse while held was accepted")
	}
	if got := out.history(); !equalBools(got, []bool{false, true}) {
		t.Errorf("writes = %v; want the hold assert only", got)
	}
}

func TestConcurrentPulseIsRefusedNotQueued(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	done := make(chan struct{})
	go func() { defer close(done); _ = g.Pulse(120 * time.Millisecond) }()
	time.Sleep(40 * time.Millisecond)
	// A queued second pulse would toggle a gate opener a second time.
	if err := g.Pulse(50 * time.Millisecond); err == nil {
		t.Fatal("concurrent Pulse accepted; want refusal")
	}
	<-done
	if got := out.history(); !equalBools(got, []bool{false, true, false}) {
		t.Errorf("writes = %v; want a single pulse", got)
	}
}

func TestLeadingEdgeFailureFaultsAndReleasesTheLine(t *testing.T) {
	out := &fakeLine{failSetN: 2, setErr: errors.New("EIO")} // set #1 is the open de-assert
	g := newTestGPIO(t, GPIOConfig{}, out, nil)

	err := g.Pulse(50 * time.Millisecond)
	if err == nil {
		t.Fatal("Pulse returned nil after a failed leading edge")
	}
	if !strings.Contains(err.Error(), "released to the kernel") {
		t.Errorf("error does not say the line was released: %v", err)
	}
	if out.energised() {
		t.Error("line left energised after a failed leading edge")
	}
	if out.closed() == 0 {
		t.Error("faulted driver did not close the line request fd")
	}
	if g.State() != StateFault {
		t.Errorf("state = %q, want %q", g.State(), StateFault)
	}
	if g.Err() == nil {
		t.Error("Err() is nil after a fault")
	}
}

func TestTrailingEdgeFailureFaultsAndReleasesTheLine(t *testing.T) {
	// set #1 open de-assert, #2 leading edge, #3 trailing edge ← fails.
	out := &fakeLine{failSetN: 3, setErr: errors.New("EIO")}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)

	err := g.Pulse(60 * time.Millisecond)
	if err == nil {
		t.Fatal("Pulse returned nil though the relay was left energised")
	}
	if !strings.Contains(err.Error(), "trailing edge") {
		t.Errorf("error should name the trailing edge: %v", err)
	}
	// The driver could not drop the line itself, so the only remaining
	// safety action is handing it back to the kernel.
	if out.closed() == 0 {
		t.Fatal("stuck-energised line was not released to the kernel")
	}
	if g.State() != StateFault {
		t.Errorf("state = %q, want %q", g.State(), StateFault)
	}
}

func TestFaultedDriverRefusesEverySubsequentActuation(t *testing.T) {
	out := &fakeLine{failSetN: 2, setErr: errors.New("EIO")}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	_ = g.Pulse(50 * time.Millisecond)

	if err := g.Pulse(50 * time.Millisecond); err == nil {
		t.Error("Pulse accepted after a fault")
	}
	if err := g.Hold(); err == nil {
		t.Error("Hold accepted after a fault")
	}
	// Release must report the fault rather than claiming a close it cannot
	// prove: after release-to-kernel the level depends on the external pull.
	if err := g.Release(); err == nil {
		t.Error("Release claimed success after a fault")
	}
	if g.State() != StateFault {
		t.Errorf("state = %q", g.State())
	}
}

func TestReleaseCutsAPulseShort(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	done := make(chan error, 1)
	go func() { done <- g.Pulse(4 * time.Second) }()
	time.Sleep(50 * time.Millisecond)

	start := time.Now()
	if err := g.Release(); err != nil {
		t.Fatalf("Release: %v", err)
	}
	if err := <-done; err != nil {
		t.Errorf("aborted Pulse returned %v; the trailing edge belongs to Release", err)
	}
	if el := time.Since(start); el > time.Second {
		t.Errorf("Release took %v; it must not wait out the pulse", el)
	}
	if out.energised() {
		t.Error("line still energised after Release")
	}
	if g.State() != StateIdle {
		t.Errorf("state = %q", g.State())
	}
}

func TestReleaseIsIdempotentAndAlwaysWrites(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	for i := 0; i < 3; i++ {
		if err := g.Release(); err != nil {
			t.Fatalf("Release #%d: %v", i, err)
		}
	}
	// Every Release drives the de-asserted level; the safe direction is
	// never optimised away.
	if got := out.history(); !equalBools(got, []bool{false, false, false, false}) {
		t.Errorf("writes = %v", got)
	}
}

func TestHoldLatchesAndReleaseDrops(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{}, out, nil)
	defer g.Close()

	if err := g.Hold(); err != nil {
		t.Fatal(err)
	}
	if g.State() != StateHeld || !out.energised() {
		t.Fatalf("state=%q energised=%v", g.State(), out.energised())
	}
	if err := g.Hold(); err != nil { // idempotent
		t.Fatalf("second Hold: %v", err)
	}
	if err := g.Release(); err != nil {
		t.Fatal(err)
	}
	if got := out.history(); !equalBools(got, []bool{false, true, false}) {
		t.Errorf("writes = %v", got)
	}
}

func TestHoldWatchdogDeEnergises(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{MaxPulse: 50 * time.Millisecond, MaxHold: 80 * time.Millisecond}, out, nil)
	defer g.Close()

	if err := g.Hold(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for g.State() == StateHeld && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if g.State() != StateIdle {
		t.Fatalf("watchdog did not release the hold: state=%q", g.State())
	}
	if out.energised() {
		t.Error("relay still energised after the hold watchdog fired")
	}
}

func TestHoldWatchdogIsNotRearmedByRepeatedHolds(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{MaxPulse: 50 * time.Millisecond, MaxHold: 150 * time.Millisecond}, out, nil)
	defer g.Close()

	if err := g.Hold(); err != nil {
		t.Fatal(err)
	}
	// Spam Hold: the bound must be on continuous ENERGISED TIME, so the relay
	// must spend a real part of this window de-energised however often Hold is
	// called.
	//
	// The previous version sampled the state ONCE, after the loop, and asked
	// whether it happened to be held. That made a genuine defect look like a
	// flaky test: the relay was in fact energised from 0ms to 283ms with
	// MaxHold=150ms, and the single final sample landed in the brief gap
	// between a watchdog release and the next re-latch about two runs in three.
	// Sampling throughout, and asserting on the WORST continuous run, makes the
	// question deterministic.
	start := time.Now()
	stop := start.Add(400 * time.Millisecond)
	var energisedFrom time.Time
	var longestEnergised time.Duration
	for time.Now().Before(stop) {
		_ = g.Hold()
		now := time.Now()
		if out.energised() {
			if energisedFrom.IsZero() {
				energisedFrom = now
			} else if d := now.Sub(energisedFrom); d > longestEnergised {
				longestEnergised = d
			}
		} else {
			energisedFrom = time.Time{}
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Generous slack for scheduler jitter on a loaded machine: the point is
	// that the bound EXISTS, not its precision. Before the cooldown, this
	// measured the full 400ms window.
	if limit := 2 * 150 * time.Millisecond; longestEnergised > limit {
		t.Errorf("relay stayed continuously energised for %v under repeated Hold "+
			"calls; MaxHold is 150ms, so the watchdog is bounding one latch rather "+
			"than continuous energised time and a caller can hold the gate open "+
			"indefinitely", longestEnergised)
	}
}

// The cooldown itself, asserted directly: a Hold arriving straight after the
// watchdog fired must be REFUSED, not silently re-latched.
func TestHoldIsRefusedDuringTheWatchdogCooldown(t *testing.T) {
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{MaxPulse: 50 * time.Millisecond, MaxHold: 100 * time.Millisecond}, out, nil)
	defer g.Close()

	if err := g.Hold(); err != nil {
		t.Fatal(err)
	}
	// Wait for the watchdog rather than sleeping a fixed time.
	deadline := time.Now().Add(2 * time.Second)
	for g.State() == StateHeld && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	if g.State() != StateIdle {
		t.Fatalf("watchdog did not release: state=%q", g.State())
	}
	if out.energised() {
		t.Fatal("relay still energised after the watchdog fired")
	}

	err := g.Hold()
	if err == nil {
		t.Fatal("Hold succeeded immediately after the watchdog fired; the relay can " +
			"be re-latched forever, one MaxHold at a time")
	}
	if !strings.Contains(err.Error(), "cooling down") {
		t.Errorf("refusal does not say why: %v", err)
	}
	if out.energised() {
		t.Error("a refused Hold energised the relay anyway")
	}

	// And it recovers: the cooldown is a pause, not a latch-out.
	time.Sleep(120 * time.Millisecond)
	if err := g.Hold(); err != nil {
		t.Errorf("Hold still refused after the cooldown elapsed: %v", err)
	}
}

func TestCloseDeassertsAndReleasesBothLines(t *testing.T) {
	out, in := &fakeLine{}, &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{Sensor: &GPIOSensorConfig{Line: 9}}, out, in)

	if err := g.Hold(); err != nil {
		t.Fatal(err)
	}
	if err := g.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if out.energised() {
		t.Error("relay left energised after Close")
	}
	if out.closed() != 1 || in.closed() != 1 {
		t.Errorf("lines not released: out=%d in=%d", out.closed(), in.closed())
	}
	if g.State() != StateClosed {
		t.Errorf("state = %q", g.State())
	}
	if err := g.Pulse(100 * time.Millisecond); !errors.Is(err, ErrClosed) {
		t.Errorf("Pulse after Close = %v, want ErrClosed", err)
	}
	if err := g.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
}

func TestGateClosedWithoutSensorMatchesMock(t *testing.T) {
	g := newTestGPIO(t, GPIOConfig{}, &fakeLine{}, nil)
	defer g.Close()
	closed, present := g.GateClosed()
	mClosed, mPresent := NewMock(quietLogger()).GateClosed()
	if closed != mClosed || present != mPresent {
		t.Errorf("GateClosed() = (%v,%v); mock reports (%v,%v)", closed, present, mClosed, mPresent)
	}
}

func TestGateClosedReadsTheInputLine(t *testing.T) {
	in := &fakeLine{getVal: true}
	g := newTestGPIO(t, GPIOConfig{Sensor: &GPIOSensorConfig{Line: 9}}, &fakeLine{}, in)
	defer g.Close()

	if closed, present := g.GateClosed(); !closed || !present {
		t.Errorf("GateClosed() = (%v,%v); want (true,true)", closed, present)
	}
	in.mu.Lock()
	in.getVal = false
	in.mu.Unlock()
	if closed, present := g.GateClosed(); closed || !present {
		t.Errorf("GateClosed() = (%v,%v); want (false,true)", closed, present)
	}
}

func TestSensorReadErrorDoesNotClaimClosedAndDoesNotFaultOutput(t *testing.T) {
	out := &fakeLine{}
	in := &fakeLine{getErr: errors.New("EIO")}
	g := newTestGPIO(t, GPIOConfig{Sensor: &GPIOSensorConfig{Line: 9}}, out, in)
	defer g.Close()

	closed, present := g.GateClosed()
	if closed {
		t.Error("an unreadable sensor claimed the gate is closed")
	}
	if !present {
		t.Error("a configured sensor reported itself absent on a read error")
	}
	// A flaky reed switch must not disable the gate output.
	if err := g.Pulse(60 * time.Millisecond); err != nil {
		t.Errorf("sensor read error faulted the output driver: %v", err)
	}
}

func TestSensorStaysPresentAfterAFault(t *testing.T) {
	out := &fakeLine{failSetN: 2, setErr: errors.New("EIO")}
	in := &fakeLine{getVal: true}
	g := newTestGPIO(t, GPIOConfig{Sensor: &GPIOSensorConfig{Line: 9}}, out, in)
	_ = g.Pulse(50 * time.Millisecond)

	closed, present := g.GateClosed()
	if closed || !present {
		t.Errorf("GateClosed() = (%v,%v) after a fault; want (false,true)", closed, present)
	}
}

func TestPolarityIsAppliedByTheKernelNotTheDriver(t *testing.T) {
	// Active-low must show up as a flag, never as an inverted write: the
	// driver's notion of "asserted" stays "relay energised" either way.
	if f := outputFlags(GPIOConfig{}); f != lineFlagOutput {
		t.Errorf("active-high output flags = %#x, want %#x", f, lineFlagOutput)
	}
	if f := outputFlags(GPIOConfig{ActiveLow: true}); f != lineFlagOutput|lineFlagActiveLow {
		t.Errorf("active-low output flags = %#x", f)
	}
	if f := outputFlags(GPIOConfig{Bias: BiasPullDown}); f != lineFlagOutput|lineFlagBiasPullDown {
		t.Errorf("biased output flags = %#x", f)
	}
	if f := inputFlags(GPIOSensorConfig{ActiveLow: true, Bias: BiasPullUp}); f != lineFlagInput|lineFlagActiveLow|lineFlagBiasPullUp {
		t.Errorf("input flags = %#x", f)
	}

	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{ActiveLow: true}, out, nil)
	defer g.Close()
	if err := g.Pulse(60 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if got := out.history(); !equalBools(got, []bool{false, true, false}) {
		t.Errorf("active-low writes = %v; the driver must still write logical 1 to energise", got)
	}
}

func TestConcurrentUseIsRaceFree(t *testing.T) {
	// Run with -race. The Relay contract requires concurrency safety.
	out := &fakeLine{}
	g := newTestGPIO(t, GPIOConfig{
		MinPulse: minPulseFloor,
		MaxPulse: 100 * time.Millisecond,
		MaxHold:  200 * time.Millisecond,
		Sensor:   &GPIOSensorConfig{Line: 9},
	}, out, &fakeLine{})
	defer g.Close()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				switch (i + j) % 5 {
				case 0:
					_ = g.Pulse(10 * time.Millisecond)
				case 1:
					_ = g.Hold()
				case 2:
					_ = g.Release()
				case 3:
					_ = g.State()
				case 4:
					_, _ = g.GateClosed()
				}
			}
		}(i)
	}
	wg.Wait()
	if err := g.Release(); err != nil {
		t.Fatalf("final Release: %v", err)
	}
	if out.energised() {
		t.Error("relay left energised after the concurrency storm")
	}
}

func TestNewGPIORejectsBadLineWithoutTouchingHardware(t *testing.T) {
	if _, err := NewGPIO("/dev/gpiochip0", -1); err == nil {
		t.Error("NewGPIO accepted a negative line")
	}
	if _, err := NewGPIO("/dev/gpiochip0", 1<<20); err == nil {
		t.Error("NewGPIO accepted an absurd line")
	}
}

func TestOpenIsUnsupportedOffLinux(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("linux has a real backend; see gpio_linux_test.go")
	}
	_, err := Open(GPIOConfig{Log: quietLogger()})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("Open on %s = %v; want ErrUnsupported", runtime.GOOS, err)
	}
}

// TestGPIOSatisfiesTheRelaySeam is the compile-time check made explicit: the
// hardware driver must be a drop-in for the Mock everywhere the agent uses
// a relay.Relay, with the interface unchanged.
func TestGPIOSatisfiesTheRelaySeam(t *testing.T) {
	var r Relay = newTestGPIO(t, GPIOConfig{}, &fakeLine{}, nil)
	var s Sensors = r.(*GPIO)
	if _, present := s.GateClosed(); present {
		t.Error("no sensor configured but GateClosed reports one present")
	}
	if r.State() != StateIdle {
		t.Errorf("state = %q", r.State())
	}
	if err := r.(*GPIO).Close(); err != nil {
		t.Fatal(err)
	}
}

func equalBools(a, b []bool) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
