package energy

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
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
