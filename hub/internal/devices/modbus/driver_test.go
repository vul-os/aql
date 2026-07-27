package modbus

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// A realistic three-phase meter: power as a float32 across two registers, and a
// lifetime energy counter as a uint32. This is the shape almost every real
// device uses, so the tests read against it rather than against invented
// register layouts.
func meterConfig(addr string) Config {
	return Config{
		ID: "modbus",
		Devices: []DeviceConfig{{
			ID:           "meter-main",
			Kind:         devices.KindEnergy,
			Name:         "Main incomer",
			Zone:         "Utility",
			Capabilities: []devices.CapabilityID{devices.CapMeter},
			Address:      addr,
			UnitID:       1,
			Reads: []ReadSpec{{
				Function: FCReadHolding,
				Start:    100,
				Count:    4,
				Metrics: []Metric{
					{Metric: "kw", Address: 100, Type: TypeF32, Order: OrderABCD},
					{Metric: "kwh", Address: 102, Type: TypeU32, Order: OrderABCD, Scale: 0.01},
				},
			}},
		}},
	}
}

func newTestDriver(t *testing.T, cfg Config) *Driver {
	t.Helper()
	d, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func TestReadDecodesARealisticMeter(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 2410.5)  // kW
	srv.set(102, 0x0001, 0x86A0) // 100000 raw -> 1000.00 kWh at scale 0.01

	d := newTestDriver(t, meterConfig(srv.addr()))
	readings, err := d.Read(context.Background(), "meter-main")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(readings) != 2 {
		t.Fatalf("got %d readings, want 2: %+v", len(readings), readings)
	}

	got := map[string]float64{}
	for _, r := range readings {
		got[r.Metric] = r.Value
		if r.DeviceID != "meter-main" {
			t.Errorf("reading carries device id %q", r.DeviceID)
		}
		if r.At.IsZero() {
			t.Error("reading has no timestamp; a consumer cannot age it out")
		}
	}
	if got["kw"] != 2410.5 {
		t.Errorf("kw = %v, want 2410.5", got["kw"])
	}
	if got["kwh"] != 1000 {
		t.Errorf("kwh = %v, want 1000 (100000 raw at scale 0.01)", got["kwh"])
	}
}

// Two metrics sharing one block must be sliced out of it correctly. This is
// the off-by-one the package doc warns about: Metric.Address is ABSOLUTE, and a
// driver that treated it as an offset would read kw's registers for kwh.
func TestMetricsAreSlicedFromTheSharedBlock(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 1.0)
	srv.set(102, 0, 500)

	d := newTestDriver(t, meterConfig(srv.addr()))
	readings, err := d.Read(context.Background(), "meter-main")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]float64{}
	for _, r := range readings {
		got[r.Metric] = r.Value
	}
	if got["kw"] != 1.0 || got["kwh"] != 5.0 {
		t.Fatalf("metrics read each other's registers: kw=%v kwh=%v (want 1 and 5)",
			got["kw"], got["kwh"])
	}
	// One block, one request — the whole point of grouping metrics.
	if srv.requestsServed() != 1 {
		t.Errorf("%d requests for one block; metrics in a block must be read together",
			srv.requestsServed())
	}
}

// The read-only property. It holds because config refuses actuable
// capabilities, and Execute is the backstop.
func TestExecuteAlwaysRefuses(t *testing.T) {
	srv := newFakeServer(t)
	d := newTestDriver(t, meterConfig(srv.addr()))

	err := d.Execute(context.Background(), "meter-main", devices.VerbOn, nil)
	if !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("Execute error = %v, want ErrUnsupported", err)
	}
	// And nothing was sent. A refusal that still wrote to the bus would be the
	// worst possible way to be read-only.
	if srv.requestsServed() != 0 {
		t.Errorf("a refused verb still produced %d Modbus request(s)", srv.requestsServed())
	}
}

func TestUnknownDeviceIsDistinctFromAFailure(t *testing.T) {
	srv := newFakeServer(t)
	d := newTestDriver(t, meterConfig(srv.addr()))

	if _, err := d.Read(context.Background(), "nope"); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Errorf("Read of an unknown device = %v, want ErrUnknownDevice", err)
	}
	if err := d.Execute(context.Background(), "nope", devices.VerbOn, nil); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Errorf("Execute on an unknown device = %v, want ErrUnknownDevice", err)
	}
}

// A configured capability whose verbs are not all TierRead must be refused at
// config time, not at request time. This is what makes "read-only" structural.
func TestActuableCapabilitiesAreRefusedAtConfigTime(t *testing.T) {
	cfg := meterConfig("127.0.0.1:1")
	cfg.Devices[0].Kind = devices.KindAccess
	cfg.Devices[0].Capabilities = []devices.CapabilityID{devices.CapBarrier}
	if _, err := New(cfg); err == nil {
		t.Fatal("a device with an actuable capability was accepted; the read-only " +
			"property would then depend on Execute remembering to refuse")
	}
}

// Availability has to distinguish three states, because a plant room genuinely
// produces all three and an operator needs to tell them apart.
func TestAvailabilityDistinguishesOnlineDegradedAndOffline(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 5)
	srv.set(102, 0, 100)

	// Two blocks so one can fail independently of the other.
	cfg := meterConfig(srv.addr())
	cfg.Devices[0].Reads = append(cfg.Devices[0].Reads, ReadSpec{
		Function: FCReadInput,
		Start:    200,
		Count:    1,
		Metrics:  []Metric{{Metric: "celsius", Address: 200, Type: TypeS16, Order: OrderABCD}},
	})
	d := newTestDriver(t, cfg)

	// All blocks answer.
	if _, err := d.Read(context.Background(), "meter-main"); err != nil {
		t.Fatalf("Read: %v", err)
	}
	if a := availabilityOf(t, d, "meter-main"); a != devices.AvailOnline {
		t.Errorf("availability = %q, want online", a)
	}

	// Every block fails: the server answers every request with an exception.
	srv.faults(func(f *fakeServer) { f.exception = 0x02 }) // illegal data address
	readings, err := d.Read(context.Background(), "meter-main")
	if err == nil {
		t.Error("a device that decoded nothing returned no error")
	}
	if len(readings) != 0 {
		t.Errorf("a fully failed read returned %d readings", len(readings))
	}
	if a := availabilityOf(t, d, "meter-main"); a != devices.AvailOffline {
		t.Errorf("availability = %q, want offline", a)
	}
}

// The state the whole design turns on: reachable and incomplete.
//
// A meter whose power register reads while its energy register times out is
// common — one range often lives behind a slower sub-device — and collapsing it
// to online or offline loses exactly what an operator needs.
func TestPartialReadIsDegradedAndKeepsWhatItGot(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 7.5)
	srv.set(102, 0, 42)

	cfg := meterConfig(srv.addr())
	// A second block at an address the fake will answer, plus a metric whose
	// declared type cannot decode what arrives — a config error surfacing at
	// runtime, which must fail that METRIC and not the device.
	cfg.Devices[0].Reads = append(cfg.Devices[0].Reads, ReadSpec{
		Function: FCReadHolding,
		Start:    300,
		Count:    2,
		Metrics: []Metric{
			{Metric: "volts", Address: 300, Type: TypeF32, Order: OrderABCD},
		},
	})
	d := newTestDriver(t, cfg)

	// A NaN float32 in the volts registers: decodable as bytes, refused as a
	// reading (decode.go rejects non-finite values).
	srv.set(300, 0x7FC0, 0x0000)

	readings, err := d.Read(context.Background(), "meter-main")
	if err != nil {
		t.Fatalf("a partial read returned an error rather than what it got: %v", err)
	}
	if len(readings) != 2 {
		t.Fatalf("got %d readings, want the 2 that decoded: %+v", len(readings), readings)
	}
	for _, r := range readings {
		if r.Metric == "volts" {
			t.Error("a metric that failed to decode was still emitted")
		}
	}
	if a := availabilityOf(t, d, "meter-main"); a != devices.AvailDegraded {
		t.Errorf("availability = %q, want degraded — the device answered, "+
			"incompletely", a)
	}
}

// A failed block contributes NO readings rather than stale ones. internal/energy
// treats a gap as a gap and interpolates visibly, which is only correct if a gap
// actually arrives as one.
func TestAFailedBlockEmitsNothingRatherThanStaleValues(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 99)
	srv.set(102, 0, 1)

	d := newTestDriver(t, meterConfig(srv.addr()))
	first, err := d.Read(context.Background(), "meter-main")
	if err != nil || len(first) != 2 {
		t.Fatalf("warm-up read: %d readings, %v", len(first), err)
	}

	srv.faults(func(f *fakeServer) { f.exception = 0x0B }) // gateway target failed
	second, err := d.Read(context.Background(), "meter-main")
	if err == nil {
		t.Fatal("a wholly failed read reported success")
	}
	if len(second) != 0 {
		t.Fatalf("a failed read re-emitted %d stale reading(s); internal/energy "+
			"would record them as freshly measured", len(second))
	}
}

// The distinction the package doc promises: a gateway exception means the
// device behind the bridge is unreachable, not that the request was malformed.
func TestGatewayExceptionsAreUnreachableNotProtocolErrors(t *testing.T) {
	for _, code := range []uint8{0x0A, 0x0B} {
		srv := newFakeServer(t)
		srv.faults(func(f *fakeServer) { f.exception = code })
		d := newTestDriver(t, meterConfig(srv.addr()))

		_, err := d.Read(context.Background(), "meter-main")
		if err == nil {
			t.Fatalf("exception 0x%02X was treated as success", code)
		}
		if !errIsUnreachable(err) {
			t.Errorf("exception 0x%02X = %v; a TCP-to-RTU bridge saying the slave "+
				"did not answer must read as unreachable, so an operator looks at "+
				"the bus and not at the register map", code, err)
		}
	}
}

// A non-gateway exception is the device answering, not the transport failing.
// Reporting it as unreachable would send an operator to check cabling when the
// real problem is an address in their config.
func TestDataExceptionsAreNotUnreachable(t *testing.T) {
	srv := newFakeServer(t)
	srv.faults(func(f *fakeServer) { f.exception = 0x02 }) // illegal data address
	d := newTestDriver(t, meterConfig(srv.addr()))

	_, err := d.Read(context.Background(), "meter-main")
	if err == nil {
		t.Fatal("an illegal-data-address exception was treated as success")
	}
	if errIsUnreachable(err) {
		t.Error("an illegal-data-address exception was reported as unreachable; " +
			"the device answered, and the register map is what is wrong")
	}
}

// Health must not dial. The seam forbids blocking here, and a health check that
// queued behind an in-flight poll would report a slow device as a broken driver.
func TestHealthDoesNotTouchTheNetwork(t *testing.T) {
	srv := newFakeServer(t)
	d := newTestDriver(t, meterConfig(srv.addr()))

	h := d.Health(context.Background())
	if !h.OK {
		t.Errorf("a driver that has not polled yet reports a fault: %+v", h)
	}
	if srv.requestsServed() != 0 {
		t.Errorf("Health produced %d Modbus request(s)", srv.requestsServed())
	}
	if h.Detail == "" {
		t.Error("health carries no detail; an operator gets nothing to act on")
	}
}

func TestHealthReportsDeviceStateAfterPolling(t *testing.T) {
	srv := newFakeServer(t)
	srv.faults(func(f *fakeServer) { f.exception = 0x02 })
	d := newTestDriver(t, meterConfig(srv.addr()))

	_, _ = d.Read(context.Background(), "meter-main")
	h := d.Health(context.Background())
	if h.OK {
		t.Error("health is OK after every device failed to report")
	}
	if !strings.Contains(h.Detail, "reported nothing") {
		t.Errorf("health detail = %q; it must say what is wrong", h.Detail)
	}
}

// Discover is the console's device list. It must be stable across refreshes and
// must carry what polling has learned — not a permanent Unknown.
func TestDiscoverIsStableAndReflectsPolling(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 3)
	srv.set(102, 0, 7)

	cfg := meterConfig(srv.addr())
	cfg.Devices = append(cfg.Devices, DeviceConfig{
		ID:           "meter-b",
		Kind:         devices.KindEnergy,
		Name:         "Sub meter",
		Capabilities: []devices.CapabilityID{devices.CapMeter},
		Address:      srv.addr(),
		UnitID:       2,
		Reads: []ReadSpec{{
			Function: FCReadHolding, Start: 100, Count: 2,
			Metrics: []Metric{{Metric: "kw", Address: 100, Type: TypeF32, Order: OrderABCD}},
		}},
	})
	d := newTestDriver(t, cfg)

	first, err := d.Discover(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 {
		t.Fatalf("got %d devices, want 2", len(first))
	}
	if first[0].ID != "meter-main" || first[1].ID != "meter-b" {
		t.Errorf("Discover is not in config order: %s, %s", first[0].ID, first[1].ID)
	}
	if first[0].Availability != devices.AvailUnknown {
		t.Errorf("an unpolled device reports %q; it must be unknown, or a hub that "+
			"has not polled renders as live", first[0].Availability)
	}

	if _, err := d.Read(context.Background(), "meter-main"); err != nil {
		t.Fatal(err)
	}
	after, _ := d.Discover(context.Background())
	if after[0].Availability != devices.AvailOnline {
		t.Errorf("availability = %q after a successful poll", after[0].Availability)
	}
	if after[0].Summary == "" {
		t.Error("a polled device has no summary for the console row")
	}
	// The other device was never polled and must not inherit its neighbour's state.
	if after[1].Availability != devices.AvailUnknown {
		t.Errorf("an unpolled device took on %q from a polled one", after[1].Availability)
	}
}

// Several slaves behind one TCP-to-RTU bridge share a socket. That is required
// behaviour, not a limitation: the MBAP transaction id is 16 bits and cheap
// bridges ignore it, so overlapping requests on one socket produce crossed
// answers.
func TestDevicesAtTheSameAddressShareOneEndpoint(t *testing.T) {
	srv := newFakeServer(t)
	cfg := meterConfig(srv.addr())
	cfg.Devices = append(cfg.Devices, DeviceConfig{
		ID:           "meter-b",
		Kind:         devices.KindEnergy,
		Name:         "Sub meter",
		Capabilities: []devices.CapabilityID{devices.CapMeter},
		Address:      srv.addr(),
		UnitID:       2,
		Reads: []ReadSpec{{
			Function: FCReadHolding, Start: 100, Count: 2,
			Metrics: []Metric{{Metric: "kw", Address: 100, Type: TypeF32, Order: OrderABCD}},
		}},
	})
	d := newTestDriver(t, cfg)

	if len(d.endpoints) != 1 {
		t.Fatalf("%d endpoints for one address; slaves behind one bridge must "+
			"share a socket so their requests serialise", len(d.endpoints))
	}
}

func TestUnitIDReachesTheWire(t *testing.T) {
	srv := newFakeServer(t)
	srv.setFloat32(100, 1)
	srv.set(102, 0, 1)
	cfg := meterConfig(srv.addr())
	cfg.Devices[0].UnitID = 17
	d := newTestDriver(t, cfg)

	if _, err := d.Read(context.Background(), "meter-main"); err != nil {
		t.Fatal(err)
	}
	srv.faults(func(f *fakeServer) {
		if f.lastUnit != 17 {
			t.Errorf("unit id on the wire = %d, want 17 — the slave behind a "+
				"bridge would never be addressed", f.lastUnit)
		}
	})
}

// Config must refuse what it cannot prove, at startup, rather than at a plant
// room's expense later.
func TestConfigRefusals(t *testing.T) {
	for _, tc := range []struct {
		name string
		mut  func(*Config)
	}{
		{"no devices", func(c *Config) { c.Devices = nil }},
		{"duplicate device id", func(c *Config) { c.Devices = append(c.Devices, c.Devices[0]) }},
		{"no reads", func(c *Config) { c.Devices[0].Reads = nil }},
		{"backoff inverted", func(c *Config) { c.BaseBackoff = 10; c.MaxBackoff = 1 }},
	} {
		cfg := meterConfig("127.0.0.1:1")
		tc.mut(&cfg)
		if _, err := New(cfg); err == nil {
			t.Errorf("%s: accepted", tc.name)
		}
	}
}

// availabilityOf reads what Discover reports for one device.
func availabilityOf(t *testing.T, d *Driver, id string) devices.Availability {
	t.Helper()
	list, err := d.Discover(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, dev := range list {
		if dev.ID == id {
			return dev.Availability
		}
	}
	t.Fatalf("device %q not in Discover", id)
	return ""
}
