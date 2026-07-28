package energy

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// fakeMeter is a one-device driver whose readings and failure mode a test
// controls directly.
type fakeMeter struct {
	id       string
	readings []devices.Reading
	err      error
}

func (f *fakeMeter) ID() string { return f.id }

func (f *fakeMeter) Discover(context.Context) ([]devices.Device, error) {
	return []devices.Device{{
		ID: "m1", Kind: devices.KindEnergy, Name: "Main Meter", Zone: "Utility",
		Capabilities: []devices.CapabilityID{devices.CapMeter},
		Availability: devices.AvailOnline,
	}}, nil
}

func (f *fakeMeter) Execute(context.Context, string, devices.Verb, map[string]float64) error {
	return devices.ErrUnsupported
}

func (f *fakeMeter) Read(context.Context, string) ([]devices.Reading, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.readings, nil
}

func (f *fakeMeter) Health(context.Context) devices.Health {
	return devices.Health{OK: f.err == nil, Detail: "fake"}
}

func newRegistry(t *testing.T, d devices.Driver) *devices.Registry {
	t.Helper()
	reg := devices.NewRegistry()
	if err := reg.Register(d); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := reg.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	return reg
}

func sampleCount(t *testing.T, s *Store, acc string) int {
	t.Helper()
	var n int
	if err := s.db.QueryRowContext(context.Background(),
		`SELECT count(*) FROM energy_samples WHERE account_id = ?`, acc).Scan(&n); err != nil {
		t.Fatalf("count samples: %v", err)
	}
	return n
}

func TestPollerIngestsMeterReadings(t *testing.T) {
	s, acc, ctx := newStore(t)
	counterChannel(t, s, acc, "fake:m1", nil)
	drv := &fakeMeter{id: "fake"}
	reg := newRegistry(t, drv)
	p := NewPoller(reg, s, acc)

	for i := 0; i <= 4; i++ {
		drv.readings = []devices.Reading{{
			DeviceID: "m1", Metric: "kwh", Value: float64(i) * 2,
			At: base.Add(time.Duration(i) * 15 * time.Minute),
		}}
		res, err := p.PollOnce(ctx)
		if err != nil {
			t.Fatalf("PollOnce: %v", err)
		}
		if res.Meters != 1 || res.Read != 1 || res.Failed != 0 {
			t.Fatalf("poll %d: %+v", i, res)
		}
	}
	if got := sampleCount(t, s, acc); got != 5 {
		t.Fatalf("stored %d samples, want 5", got)
	}
	h := hours(t, s, acc, "fake:m1", 1)[0]
	wantKWh(t, h, 8)
	wantQuality(t, h, QualityComplete)
}

// An unreachable meter produces a GAP. Writing a zero for it would be a
// fabricated observation, and once stored it would be indistinguishable from a
// real zero forever after.
func TestPollerWritesNothingForAnUnreachableMeter(t *testing.T) {
	s, acc, ctx := newStore(t)
	counterChannel(t, s, acc, "fake:m1", nil)
	drv := &fakeMeter{id: "fake", err: devices.ErrUnreachable}
	p := NewPoller(newRegistry(t, drv), s, acc)

	res, err := p.PollOnce(ctx)
	if err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	if res.Meters != 1 || res.Failed != 1 || res.Read != 0 {
		t.Fatalf("%+v: an unreachable meter must count as failed", res)
	}
	if len(res.Errors) != 1 || res.Errors[0].DeviceKey != "fake:m1" {
		t.Fatalf("errors %+v, want one for fake:m1", res.Errors)
	}
	if got := sampleCount(t, s, acc); got != 0 {
		t.Fatalf("wrote %d samples for a meter that did not answer", got)
	}
	h := hours(t, s, acc, "fake:m1", 1)[0]
	wantNilKWh(t, h)
	wantQuality(t, h, QualityEmpty)
}

// A driver returning a reading under someone else's device id is a bug in the
// driver. Attributing the energy to the wrong meter would be worse than losing
// it, so it is dropped and counted.
func TestPollerDropsForeignReadings(t *testing.T) {
	s, acc, ctx := newStore(t)
	drv := &fakeMeter{id: "fake", readings: []devices.Reading{
		{DeviceID: "m1", Metric: "kwh", Value: 1, At: base},
		{DeviceID: "someone-else", Metric: "kwh", Value: 900, At: base},
	}}
	p := NewPoller(newRegistry(t, drv), s, acc)

	res, err := p.PollOnce(ctx)
	if err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	if res.Foreign != 1 {
		t.Errorf("foreign readings dropped: %d, want 1", res.Foreign)
	}
	if got := sampleCount(t, s, acc); got != 1 {
		t.Errorf("stored %d samples, want 1", got)
	}
	chans, err := s.Channels(ctx, acc)
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	if len(chans) != 1 || chans[0].DeviceKey != "fake:m1" {
		t.Errorf("channels %+v, want only fake:m1", chans)
	}
}

// The poller reads meters and nothing else, through the one verb CapMeter
// offers.
func TestPollerOnlyTouchesMeterDevices(t *testing.T) {
	s, acc, ctx := newStore(t)
	mock := devices.NewMockDriver("mock")
	p := NewPoller(newRegistry(t, mock), s, acc)

	res, err := p.PollOnce(ctx)
	if err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	if res.Meters != 1 {
		t.Fatalf("polled %d devices, want the 1 declaring CapMeter", res.Meters)
	}
	if len(mock.Calls) != 0 {
		t.Fatalf("the poller actuated something: %+v", mock.Calls)
	}
	chans, err := s.Channels(ctx, acc)
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	if len(chans) != 1 {
		t.Fatalf("registered %d channels, want 1: %+v", len(chans), chans)
	}
	if chans[0].DeviceKey != "mock:meter-1" || chans[0].Metric != "kw" {
		t.Errorf("channel %s/%s, want mock:meter-1/kw", chans[0].DeviceKey, chans[0].Metric)
	}
	if chans[0].Kind != KindPower || chans[0].Source != SourceUnattributed {
		t.Errorf("channel %+v, want an unattributed power channel", chans[0])
	}
}

func TestPollerRunStopsOnContextCancel(t *testing.T) {
	s, acc, _ := newStore(t)
	drv := &fakeMeter{id: "fake", readings: []devices.Reading{
		{DeviceID: "m1", Metric: "kwh", Value: 1, At: base},
	}}
	p := NewPoller(newRegistry(t, drv), s, acc, WithInterval(time.Millisecond))
	ctx, cancel := context.WithCancel(context.Background())
	var cycles atomic.Int64
	go func() {
		for cycles.Load() < 2 {
			time.Sleep(2 * time.Millisecond)
		}
		cancel()
	}()
	err := p.Run(ctx, func(PollResult, error) { cycles.Add(1) })
	if err != context.Canceled {
		t.Fatalf("Run returned %v, want context.Canceled", err)
	}
}

// The three Store/Poller options below (WithClock, WithReadTimeout,
// WithRollupBudget) had no caller anywhere — not production, not a test. Found
// by sweeping for exported symbols nothing calls.
//
// The tempting conclusion is that they are dead weight. They are not: each one
// is the seam for a behaviour nothing was testing, which is a worse state than
// dead code because it looks covered. Deleting them would have removed the only
// way to test the thing.

// A reading with no timestamp of its own gets the GATEWAY's clock, and is
// marked AtSourceGateway so a reader can tell the difference. ingest_test.go
// covers SamplesFromReadings directly; nothing covered the poller actually
// supplying its clock.
//
// Verified the gap before writing this: shifting PollOnce's `now` by 72 hours
// broke no test in the package.
func TestPollerStampsUntimedReadingsWithItsOwnClock(t *testing.T) {
	pinned := base.Add(37 * time.Minute)
	s, acc, ctx := newStore(t, WithClock(func() time.Time { return pinned }))

	// No At on either reading — a driver that reports a value and nothing about
	// when it was taken, which is the common case for a plain HTTP meter.
	drv := &fakeMeter{id: "fake", readings: []devices.Reading{
		{DeviceID: "m1", Metric: "kwh", Value: 12.5},
	}}
	p := NewPoller(newRegistry(t, drv), s, acc)

	if _, err := p.PollOnce(ctx); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}

	var at int64
	var src string
	if err := s.db.QueryRowContext(ctx,
		`SELECT at, at_source FROM energy_samples WHERE account_id = ?`, acc).Scan(&at, &src); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if at != pinned.Unix() {
		t.Errorf("sample stamped at %d, want the poller's clock %d", at, pinned.Unix())
	}
	// The honesty half: the hub must not present its own clock as the device's.
	if src != string(AtSourceGateway) {
		t.Errorf("at_source = %q, want %q — a hub-supplied time must say so", src, AtSourceGateway)
	}
}

// A device that carries its own timestamp keeps it, clock or no clock. The
// pinned clock here is deliberately far from the reading's time so a
// regression that stamped everything with the gateway clock is unmistakable.
func TestPollerKeepsDeviceTimestamps(t *testing.T) {
	pinned := base.Add(90 * time.Hour)
	s, acc, ctx := newStore(t, WithClock(func() time.Time { return pinned }))
	drv := &fakeMeter{id: "fake", readings: []devices.Reading{
		{DeviceID: "m1", Metric: "kwh", Value: 3, At: base},
	}}
	p := NewPoller(newRegistry(t, drv), s, acc)

	if _, err := p.PollOnce(ctx); err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	var at int64
	var src string
	if err := s.db.QueryRowContext(ctx,
		`SELECT at, at_source FROM energy_samples WHERE account_id = ?`, acc).Scan(&at, &src); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if at != base.Unix() {
		t.Errorf("sample stamped at %d, want the device's own time %d", at, base.Unix())
	}
	if src != string(AtSourceDevice) {
		t.Errorf("at_source = %q, want %q", src, AtSourceDevice)
	}
}

// hangingMeter blocks in Read until its context is cancelled, which is what a
// meter on a dead TCP session does.
type hangingMeter struct {
	fakeMeter
	entered chan struct{}
	once    atomic.Bool
}

func (h *hangingMeter) Read(ctx context.Context, _ string) ([]devices.Reading, error) {
	if h.once.CompareAndSwap(false, true) {
		close(h.entered)
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

// One unresponsive meter must not hold up the cycle. WithReadTimeout is what
// makes that assertable in a test — the default is seconds, which is correct in
// production and useless here.
func TestPollerReadTimeoutBoundsOneDevice(t *testing.T) {
	s, acc, ctx := newStore(t)
	h := &hangingMeter{fakeMeter: fakeMeter{id: "fake"}, entered: make(chan struct{})}
	p := NewPoller(newRegistry(t, h), s, acc, WithReadTimeout(50*time.Millisecond))

	done := make(chan PollResult, 1)
	go func() {
		res, err := p.PollOnce(ctx)
		if err != nil {
			t.Errorf("PollOnce: %v", err)
		}
		done <- res
	}()

	select {
	case <-h.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the poller never called Read")
	}
	select {
	case res := <-done:
		// Abandoned and counted, not silently dropped: a meter that timed out
		// is a meter whose hour is unmeasured, and the result has to say so.
		if res.Failed != 1 {
			t.Errorf("Failed = %d, want 1 for a meter that timed out", res.Failed)
		}
		if len(res.Errors) != 1 {
			t.Errorf("Errors = %d, want the timeout reported", len(res.Errors))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("PollOnce did not return; the read timeout did not bound the device read")
	}
}

// The poller must pass its rollup budget through. rollup_test.go covers the
// budget itself at store level — that a capped pass rolls exactly N hours and
// reports the rest Remaining. Nothing covered the poller supplying its own
// cap, so replacing p.rollupBudget with 0 (no cap) broke no test.
//
// The cap is not a tuning knob: it is what stops one site with a year of
// backfilled samples from holding a poll cycle open long enough to miss the
// next one, on a box that also has to answer a gate.
func TestPollerAppliesItsRollupBudget(t *testing.T) {
	s, acc, ctx := newStore(t)

	// A meter carrying its own timestamps across many hours, so ingest marks
	// far more dirty hour buckets than one budgeted pass may drain.
	readings := make([]devices.Reading, 0, 40)
	for i := 0; i < 40; i++ {
		readings = append(readings, devices.Reading{
			DeviceID: "m1", Metric: "kwh", Value: float64(i),
			At: base.Add(time.Duration(i) * time.Hour),
		})
	}
	drv := &fakeMeter{id: "fake", readings: readings}
	p := NewPoller(newRegistry(t, drv), s, acc, WithRollupBudget(3))

	res, err := p.PollOnce(ctx)
	if err != nil {
		t.Fatalf("PollOnce: %v", err)
	}
	if res.Rollup.Hours > 3 {
		t.Errorf("rolled %d hours in one cycle under a budget of 3; the poller is "+
			"not passing its budget to Rollup", res.Rollup.Hours)
	}
	if res.Rollup.Remaining == 0 {
		t.Error("a budgeted cycle over 40 dirty hours reported nothing remaining")
	}

	// And it converges: repeated cycles finish the queue rather than stalling.
	for i := 0; i < 50; i++ {
		r, err := p.PollOnce(ctx)
		if err != nil {
			t.Fatalf("PollOnce: %v", err)
		}
		if r.Rollup.Remaining == 0 {
			return
		}
	}
	t.Error("budgeted poll cycles did not drain the dirty queue")
}
