package mqtt

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// --- the worked examples. One reversible device, one consequential, one
// physical-access and one hazardous-motion, because the whole point of the
// error mapping is that they are not treated alike.

func lampDevice() DeviceConfig {
	return DeviceConfig{
		ID: "lamp-1", Kind: devices.KindLighting, Name: "Garden Lights", Zone: "Exterior",
		Capabilities: []devices.CapabilityID{devices.CapDimmable},
		State: []StateTopic{
			{Metric: "level", Topic: "home/lamp1/level", QoS: 1},
			{Metric: "state", Topic: "home/lamp1/mode", Text: true},
		},
		Commands: []Command{
			{Verb: devices.VerbOn, Topic: "home/lamp1/cmd", Payload: "{{verb}}"},
			{Verb: devices.VerbOff, Topic: "home/lamp1/cmd", Payload: "{{verb}}"},
			{Verb: devices.VerbSet, Topic: "home/lamp1/cmd/level", Payload: `{"id":"{{device}}","level":{{level}}}`},
		},
	}
}

func thermoDevice() DeviceConfig {
	return DeviceConfig{
		ID: "thermo-1", Kind: devices.KindClimate, Name: "Thermostat", Zone: "Interior",
		Capabilities: []devices.CapabilityID{devices.CapSetpoint},
		State:        []StateTopic{{Metric: "celsius", Topic: "home/thermo1/temp"}},
		Commands: []Command{
			{Verb: devices.VerbSet, Topic: "home/thermo1/set", Payload: "{{celsius}}"},
		},
	}
}

// gateDevice is here for one reason: `open` is TierPhysicalAccess, and the
// evidence rule has to be proved at that tier. It is NOT a claim that access
// points should be driven over MQTT — the hub's signed path still owns those
// (see the devices package doc).
func gateDevice() DeviceConfig {
	return DeviceConfig{
		ID: "gate-1", Kind: devices.KindAccess, Name: "Side Gate", Zone: "Exterior",
		Capabilities: []devices.CapabilityID{devices.CapBarrier},
		State:        []StateTopic{{Metric: "state", Topic: "home/gate1/state", Text: true}},
		Commands: []Command{
			{Verb: devices.VerbOpen, Topic: "home/gate1/cmd", Payload: "OPEN"},
			{Verb: devices.VerbClose, Topic: "home/gate1/cmd", Payload: "CLOSE"},
		},
	}
}

// mowerDevice's start is TierHazardousMotion. confirm, when non-nil, is attached
// to start.
func mowerDevice(confirm *Confirm) DeviceConfig {
	return DeviceConfig{
		ID: "mower-1", Kind: devices.KindRobot, Name: "Mower", Zone: "Lawn",
		Capabilities: []devices.CapabilityID{devices.CapBladeJob},
		State:        []StateTopic{{Metric: "state", Topic: "home/mower1/state", Text: true}},
		Commands: []Command{
			{Verb: devices.VerbStart, Topic: "home/mower1/cmd", Payload: "START", Confirm: confirm},
			{Verb: devices.VerbStop, Topic: "home/mower1/cmd", Payload: "STOP"},
			{Verb: devices.VerbDock, Topic: "home/mower1/cmd", Payload: "DOCK"},
		},
	}
}

// capabilityOf names the single capability each worked example declares, so a
// test can ask the catalogue what tier a verb really carries.
func capabilityOf(t *testing.T, deviceID string) devices.CapabilityID {
	t.Helper()
	switch deviceID {
	case "lamp-1":
		return devices.CapDimmable
	case "thermo-1":
		return devices.CapSetpoint
	case "gate-1":
		return devices.CapBarrier
	case "mower-1":
		return devices.CapBladeJob
	}
	t.Fatalf("no capability known for device %q", deviceID)
	return ""
}

func testConfig(b *fakeBroker, clk *testClock, devs ...DeviceConfig) Config {
	return Config{
		BrokerAddr:     "broker.example:8883",
		ClientID:       "aql-test",
		Username:       "hub",
		Password:       "hunter2",
		CommandQoS:     QoSAtLeastOnce,
		Dial:           b.dial,
		KeepAlive:      time.Minute,
		ConnectTimeout: 2 * time.Second,
		AckTimeout:     150 * time.Millisecond,
		ReconnectMin:   5 * time.Millisecond,
		ReconnectMax:   20 * time.Millisecond,
		Now:            clk.Now,
		Devices:        devs,
		// Logf is deliberately left nil (it defaults to a no-op): the driver
		// logs from the client's read-loop goroutine, and routing that to
		// t.Logf panics when it lands after the test has finished.
	}
}

func startDriver(t *testing.T, cfg Config) *Driver {
	t.Helper()
	d, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func newConnected(t *testing.T, devs ...DeviceConfig) (*Driver, *fakeBroker, *testClock) {
	t.Helper()
	b := newFakeBroker()
	clk := newTestClock()
	d := startDriver(t, testConfig(b, clk, devs...))
	waitUp(t, d)
	return d, b, clk
}

func waitUp(t *testing.T, d *Driver) {
	t.Helper()
	waitFor(t, "a healthy broker link", func() bool { return d.Health(context.Background()).OK })
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func waitReading(t *testing.T, d *Driver, deviceID, metric string) devices.Reading {
	t.Helper()
	var found devices.Reading
	waitFor(t, fmt.Sprintf("metric %q of %q", metric, deviceID), func() bool {
		rs, err := d.Read(context.Background(), deviceID)
		if err != nil {
			return false
		}
		for _, r := range rs {
			if r.Metric == metric {
				found = r
				return true
			}
		}
		return false
	})
	return found
}

// --- connect and subscribe.

func TestConnectAndSubscribe(t *testing.T) {
	confirm := &Confirm{Topic: "home/mower1/ack", Payload: "STARTED"}
	_, b, _ := newConnected(t, lampDevice(), mowerDevice(confirm))

	b.mu.Lock()
	rec := b.connects[0]
	b.mu.Unlock()
	if rec.name != "MQTT" || rec.level != 4 {
		t.Fatalf("CONNECT is not MQTT 3.1.1: %q level %d", rec.name, rec.level)
	}
	if rec.clientID != "aql-test" || rec.username != "hub" || rec.password != "hunter2" {
		t.Fatalf("CONNECT credentials not carried: %+v", rec)
	}
	if !rec.cleanSession {
		t.Fatal("clean session must always be set; this client holds no session state")
	}
	if rec.keepAlive != 60 {
		t.Fatalf("keepalive = %d, want 60", rec.keepAlive)
	}

	got := map[string]byte{}
	for _, f := range b.subscriptions() {
		got[f.filter] = f.qos
	}
	want := map[string]byte{
		"home/lamp1/level":  1, // declared QoS 1
		"home/lamp1/mode":   0,
		"home/mower1/state": 0,
		"home/mower1/ack":   1, // confirmations are forced to QoS 1
	}
	if len(got) != len(want) {
		t.Fatalf("subscribed to %v, want %v", got, want)
	}
	for filter, q := range want {
		if got[filter] != q {
			t.Fatalf("filter %q subscribed at QoS %d, want %d", filter, got[filter], q)
		}
	}
}

func TestSubscriptionRefusedFailsTheSession(t *testing.T) {
	b := newFakeBroker()
	b.set(func(b *fakeBroker) { b.subackFail = true })
	d := startDriver(t, testConfig(b, newTestClock(), lampDevice()))

	// A refused subscription must not present as a healthy driver: readings
	// would never update and nothing would say so.
	waitFor(t, "the broker to be asked at least twice", func() bool { return b.sessionCount() >= 2 })
	h := d.Health(context.Background())
	if h.OK {
		t.Fatal("driver reports healthy after the broker refused a telemetry subscription")
	}
	if !strings.Contains(h.Detail, "refused a telemetry subscription") {
		t.Fatalf("Health.Detail does not name the cause: %q", h.Detail)
	}
}

func TestRefusedCredentialsSurfaceInHealth(t *testing.T) {
	b := newFakeBroker()
	b.set(func(b *fakeBroker) { b.connack = connackBadCredentials })
	d := startDriver(t, testConfig(b, newTestClock(), lampDevice()))

	waitFor(t, "a CONNECT attempt", func() bool { return b.sessionCount() >= 1 })
	waitFor(t, "the refusal to reach Health", func() bool {
		return strings.Contains(d.Health(context.Background()).Detail, "bad username or password")
	})
	if d.Health(context.Background()).OK {
		t.Fatal("driver reports healthy after the broker refused its credentials")
	}
}

// --- reading from the cache.

func TestReadAnswersFromCacheWithoutTouchingTheBroker(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())
	b.push(t, "home/lamp1/level", "62", 0)
	b.push(t, "home/lamp1/mode", " warm \n", 0)

	waitReading(t, d, "lamp-1", "state")
	before := len(b.received())

	rs, err := d.Read(context.Background(), "lamp-1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(b.received()) != before {
		t.Fatal("Read published something; it must answer from the subscription cache")
	}
	if len(rs) != 2 || rs[0].Metric != "level" || rs[0].Value != 62 {
		t.Fatalf("readings = %+v, want level 62 first (declared order)", rs)
	}
	if rs[1].Metric != "state" || rs[1].Text != "warm" || rs[1].Value != 0 {
		t.Fatalf("text reading = %+v, want Text \"warm\" with no numeric value", rs[1])
	}
	if rs[0].DeviceID != "lamp-1" || rs[0].At.IsZero() {
		t.Fatalf("reading is missing its device or timestamp: %+v", rs[0])
	}
}

func TestUnpublishedTopicIsOmittedNeverZero(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())

	// Nothing published at all: the honest answer is that the state is unknown,
	// not that every metric is zero.
	_, err := d.Read(context.Background(), "lamp-1")
	if !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("Read before any telemetry = %v, want ErrUnreachable", err)
	}
	if !strings.Contains(err.Error(), "unknown rather than zero") {
		t.Fatalf("error does not say what an unheard topic reads as: %v", err)
	}

	// One of two metrics published: the other is omitted, not fabricated.
	b.push(t, "home/lamp1/mode", "warm", 0)
	waitReading(t, d, "lamp-1", "state")
	rs, err := d.Read(context.Background(), "lamp-1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(rs) != 1 || rs[0].Metric != "state" {
		t.Fatalf("readings = %+v, want only the metric that was actually published", rs)
	}
}

func TestUnparseableAndEmptyPayloads(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())

	b.push(t, "home/lamp1/level", "62", 0)
	waitReading(t, d, "lamp-1", "level")

	// A numeric metric that arrives unparseable must not become 0, and must not
	// overwrite the last good value with anything either.
	for _, bad := range []string{"banana", "NaN", "+Inf", ""} {
		b.push(t, "home/lamp1/level", bad, 0)
	}
	// The empty payload is MQTT's retained-message delete: the metric is
	// forgotten rather than read as zero.
	waitFor(t, "the empty payload to clear the metric", func() bool {
		_, err := d.Read(context.Background(), "lamp-1")
		return errors.Is(err, devices.ErrUnreachable)
	})

	b.push(t, "home/lamp1/level", "12.5", 0)
	if got := waitReading(t, d, "lamp-1", "level").Value; got != 12.5 {
		t.Fatalf("level = %v, want 12.5 after a good sample arrives again", got)
	}
}

func TestInboundQoS1MessageIsAcknowledged(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())
	// A subscription granted at QoS 1 obliges this client to PUBACK, or the
	// broker redelivers forever and the driver looks like a message sink.
	b.push(t, "home/lamp1/level", "62", 1)
	if got := waitReading(t, d, "lamp-1", "level").Value; got != 62 {
		t.Fatalf("level = %v, want 62", got)
	}
	select {
	case <-b.acks:
	case <-time.After(3 * time.Second):
		t.Fatal("no PUBACK for an inbound QoS 1 message")
	}
}

func TestStaleReadingIsDroppedNotServed(t *testing.T) {
	b := newFakeBroker()
	clk := newTestClock()
	cfg := testConfig(b, clk, lampDevice())
	cfg.StaleAfter = time.Minute
	d := startDriver(t, cfg)
	waitUp(t, d)

	b.push(t, "home/lamp1/level", "62", 0)
	waitReading(t, d, "lamp-1", "level")

	clk.advance(2 * time.Minute)
	_, err := d.Read(context.Background(), "lamp-1")
	if !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("stale Read = %v, want ErrUnreachable", err)
	}
	if !strings.Contains(err.Error(), "gone quiet") {
		t.Fatalf("stale error should distinguish 'went quiet' from 'never heard': %v", err)
	}

	found := discoverOne(t, d, "lamp-1")
	if found.Availability != devices.AvailOffline {
		t.Fatalf("availability = %q, want offline once telemetry has expired", found.Availability)
	}
	if found.LastSeen.IsZero() {
		t.Fatal("LastSeen was cleared; when the device was last heard from stays true")
	}
}

// discoverOne is a small helper for the availability assertions.
func discoverOne(t *testing.T, d *Driver, id string) devices.Device {
	t.Helper()
	found, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	for _, dev := range found {
		if dev.ID == id {
			return dev
		}
	}
	t.Fatalf("device %q not discovered", id)
	return devices.Device{}
}

// --- the link going away.

func TestDisconnectSurfacesInHealthAndNothingReadsAsLive(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())
	b.push(t, "home/lamp1/level", "62", 0)
	waitReading(t, d, "lamp-1", "level")

	if dev := discoverOne(t, d, "lamp-1"); dev.Availability != devices.AvailOnline {
		t.Fatalf("availability = %q, want online while telemetry is flowing", dev.Availability)
	}

	b.set(func(b *fakeBroker) { b.dialErr = true }) // stop it coming straight back
	b.drop()

	waitFor(t, "the driver to notice the drop", func() bool { return !d.Health(context.Background()).OK })

	h := d.Health(context.Background())
	if !strings.Contains(h.Detail, "broker link") {
		t.Fatalf("Health.Detail does not describe the link: %q", h.Detail)
	}
	_, err := d.Read(context.Background(), "lamp-1")
	if !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("Read while disconnected = %v, want ErrUnreachable: a cached value outlives its truth", err)
	}
	dev := discoverOne(t, d, "lamp-1")
	if dev.Availability != devices.AvailOffline {
		t.Fatalf("availability = %q, want offline while the broker link is down", dev.Availability)
	}
	if dev.Summary != "broker disconnected" {
		t.Fatalf("summary = %q, want it to say why", dev.Summary)
	}
}

func TestReconnectResubscribesAndTelemetryResumes(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())
	b.push(t, "home/lamp1/level", "62", 0)
	waitReading(t, d, "lamp-1", "level")

	b.drop()
	waitFor(t, "a second session", func() bool { return b.sessionCount() >= 2 })
	waitUp(t, d)

	if len(b.subscriptions()) != 2 {
		t.Fatalf("resubscribed to %d filter(s), want 2: a clean session keeps nothing", len(b.subscriptions()))
	}
	// The cache did not survive the gap, so the new value is genuinely new.
	b.push(t, "home/lamp1/level", "77", 0)
	if got := waitReading(t, d, "lamp-1", "level").Value; got != 77 {
		t.Fatalf("level = %v after reconnect, want 77", got)
	}
}

// --- Execute: the error mapping, which is the reason this package exists.

func TestExecuteQoS0IsAlwaysIndeterminate(t *testing.T) {
	b := newFakeBroker()
	cfg := testConfig(b, newTestClock(), lampDevice())
	cfg.CommandQoS = QoSAtMostOnce
	d := startDriver(t, cfg)
	waitUp(t, d)

	err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("QoS 0 Execute = %v, want ErrIndeterminate: nothing acknowledges a QoS 0 publish", err)
	}
	// It really was published — indeterminate is not a euphemism for "we gave up".
	m := b.nextPublish(t)
	if m.topic != "home/lamp1/cmd" || string(m.payload) != "on" || m.qos != 0 {
		t.Fatalf("published %+v, want the rendered command at QoS 0", m)
	}
}

func TestExecuteQoS1PubackIsSuccessOnlyAtOrBelowReversible(t *testing.T) {
	d, _, _ := newConnected(t, lampDevice(), thermoDevice(), gateDevice(), mowerDevice(nil))

	// wantNil is stated per row rather than derived from the tier, so a change
	// to either the catalogue's tiering or the driver's rule breaks this.
	cases := []struct {
		device  string
		verb    devices.Verb
		args    map[string]float64
		tier    devices.Tier
		wantNil bool
	}{
		{"lamp-1", devices.VerbOn, nil, devices.TierReversible, true},
		{"lamp-1", devices.VerbSet, map[string]float64{"level": 40}, devices.TierReversible, true},
		{"mower-1", devices.VerbStop, nil, devices.TierReversible, true},
		{"gate-1", devices.VerbClose, nil, devices.TierReversible, true},
		{"thermo-1", devices.VerbSet, map[string]float64{"celsius": 21}, devices.TierConsequential, false},
		{"gate-1", devices.VerbOpen, nil, devices.TierPhysicalAccess, false},
		{"mower-1", devices.VerbStart, nil, devices.TierHazardousMotion, false},
	}
	for _, tc := range cases {
		if got := devices.TierOf(capabilityOf(t, tc.device), tc.verb); got != tc.tier {
			t.Fatalf("%s %s: catalogue tier is %s, the table says %s", tc.device, tc.verb, got, tc.tier)
		}
		err := d.Execute(context.Background(), tc.device, tc.verb, tc.args)
		if tc.wantNil {
			if err != nil {
				t.Fatalf("%s %s: %v, want nil (PUBACK on a reversible verb)", tc.device, tc.verb, err)
			}
			continue
		}
		if !errors.Is(err, devices.ErrIndeterminate) {
			t.Fatalf("%s %s: %v, want ErrIndeterminate: a PUBACK is the broker's word, not the device's",
				tc.device, tc.verb, err)
		}
		if !strings.Contains(err.Error(), "nothing confirms the device acted") {
			t.Fatalf("%s %s: error does not say what is unproven: %v", tc.device, tc.verb, err)
		}
	}
}

func TestExecuteWithoutPubackIsIndeterminate(t *testing.T) {
	b := newFakeBroker()
	b.set(func(b *fakeBroker) { b.noPuback = true })
	d := startDriver(t, testConfig(b, newTestClock(), lampDevice()))
	waitUp(t, d)

	err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("Execute without a PUBACK = %v, want ErrIndeterminate", err)
	}
	if !strings.Contains(err.Error(), "no PUBACK") {
		t.Fatalf("error does not name the missing evidence: %v", err)
	}
	if got := b.received(); len(got) != 1 {
		t.Fatalf("broker saw %d publish(es), want 1: the bytes did leave this host", len(got))
	}
}

func TestExecuteWithNoLinkIsUnreachableNotIndeterminate(t *testing.T) {
	b := newFakeBroker()
	b.set(func(b *fakeBroker) { b.dialErr = true })
	d := startDriver(t, testConfig(b, newTestClock(), gateDevice()))

	err := d.Execute(context.Background(), "gate-1", devices.VerbOpen, nil)
	if !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("Execute with no link = %v, want ErrUnreachable: nothing was written", err)
	}
	if errors.Is(err, devices.ErrIndeterminate) {
		t.Fatal("a publish that never happened must not be reported as maybe-happened")
	}
}

func TestExecuteWriteFailureMapping(t *testing.T) {
	t.Run("nothing sent is unreachable", func(t *testing.T) {
		b := newFakeBroker()
		fd := &flakyDialer{b: b}
		cfg := testConfig(b, newTestClock(), gateDevice())
		cfg.Dial = fd.dial
		d := startDriver(t, cfg)
		waitUp(t, d)

		fd.arm(t, writeFailsWithNothingSent)
		err := d.Execute(context.Background(), "gate-1", devices.VerbOpen, nil)
		if !errors.Is(err, devices.ErrUnreachable) {
			t.Fatalf("write of 0 bytes = %v, want ErrUnreachable", err)
		}
	})

	t.Run("partial write is indeterminate", func(t *testing.T) {
		b := newFakeBroker()
		fd := &flakyDialer{b: b}
		cfg := testConfig(b, newTestClock(), gateDevice())
		cfg.Dial = fd.dial
		d := startDriver(t, cfg)
		waitUp(t, d)

		fd.arm(t, writeFailsMidPacket)
		err := d.Execute(context.Background(), "gate-1", devices.VerbOpen, nil)
		if !errors.Is(err, devices.ErrIndeterminate) {
			t.Fatalf("partial write = %v, want ErrIndeterminate: the broker may hold a whole packet", err)
		}
		if !strings.Contains(err.Error(), "mid-packet") {
			t.Fatalf("error does not say how far it got: %v", err)
		}
	})
}

// --- Confirm: the only way a hazardous verb reports success.

func echoConfirm(topic, payload string) func(*fakeBroker, publishMsg) {
	return func(b *fakeBroker, _ publishMsg) {
		b.mu.Lock()
		bc := b.cur
		b.mu.Unlock()
		if bc == nil {
			return
		}
		pkt, err := encodePublish(publishMsg{topic: topic, payload: []byte(payload)})
		if err != nil {
			return
		}
		_ = bc.write(pkt)
	}
}

func TestConfirmationTurnsAHazardousVerbIntoSuccess(t *testing.T) {
	confirm := &Confirm{Topic: "home/mower1/ack", Payload: "started-{{verb}}", Timeout: 3 * time.Second}
	b := newFakeBroker()
	b.set(func(b *fakeBroker) { b.onPublish = echoConfirm("home/mower1/ack", "started-start") })
	d := startDriver(t, testConfig(b, newTestClock(), mowerDevice(confirm)))
	waitUp(t, d)

	if err := d.Execute(context.Background(), "mower-1", devices.VerbStart, nil); err != nil {
		t.Fatalf("Execute with a confirmation = %v, want nil: the device said so itself", err)
	}
	// The confirmation is also the device speaking, so it counts as being heard
	// from even though it carries no metric.
	if dev := discoverOne(t, d, "mower-1"); dev.LastSeen.IsZero() {
		t.Fatal("a confirmation should count as the device being heard from")
	}
}

func TestConfirmationTimeoutIsIndeterminate(t *testing.T) {
	confirm := &Confirm{Topic: "home/mower1/ack", Payload: "STARTED", Timeout: 50 * time.Millisecond}
	d, b, _ := newConnected(t, mowerDevice(confirm))

	err := d.Execute(context.Background(), "mower-1", devices.VerbStart, nil)
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("unconfirmed start = %v, want ErrIndeterminate", err)
	}
	if !strings.Contains(err.Error(), "did not confirm") {
		t.Fatalf("error does not say the device stayed silent: %v", err)
	}
	if len(b.received()) != 1 {
		t.Fatal("the command should still have been published")
	}
}

func TestWrongConfirmationPayloadDoesNotCount(t *testing.T) {
	confirm := &Confirm{Topic: "home/mower1/ack", Payload: "STARTED", Timeout: 150 * time.Millisecond}
	b := newFakeBroker()
	b.set(func(b *fakeBroker) { b.onPublish = echoConfirm("home/mower1/ack", "FAILED") })
	d := startDriver(t, testConfig(b, newTestClock(), mowerDevice(confirm)))
	waitUp(t, d)

	if err := d.Execute(context.Background(), "mower-1", devices.VerbStart, nil); !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("a confirmation topic carrying something else = %v, want ErrIndeterminate", err)
	}
}

func TestConfirmationInterruptedByALinkDrop(t *testing.T) {
	confirm := &Confirm{Topic: "home/mower1/ack", Payload: "STARTED", Timeout: 30 * time.Second}
	b := newFakeBroker()
	b.set(func(b *fakeBroker) {
		b.onPublish = func(b *fakeBroker, _ publishMsg) { go b.drop() }
	})
	d := startDriver(t, testConfig(b, newTestClock(), mowerDevice(confirm)))
	waitUp(t, d)

	start := time.Now()
	err := d.Execute(context.Background(), "mower-1", devices.VerbStart, nil)
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("start interrupted by a drop = %v, want ErrIndeterminate", err)
	}
	if time.Since(start) > 10*time.Second {
		t.Fatal("Execute waited for the confirmation timeout instead of failing at the drop")
	}
}

func TestCallerContextBoundsTheConfirmationWait(t *testing.T) {
	confirm := &Confirm{Topic: "home/mower1/ack", Payload: "STARTED", Timeout: 30 * time.Second}
	d, _, _ := newConnected(t, mowerDevice(confirm))

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err := d.Execute(ctx, "mower-1", devices.VerbStart, nil)
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("cancelled confirmation wait = %v, want ErrIndeterminate", err)
	}
	if !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("error does not say whose deadline passed: %v", err)
	}
}

// --- refusals.

func TestUnknownDeviceAndUnsupportedVerbs(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice(), mowerDevice(nil))

	if err := d.Execute(context.Background(), "nope", devices.VerbOn, nil); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("unknown device = %v, want ErrUnknownDevice", err)
	}
	if _, err := d.Read(context.Background(), "nope"); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("Read of an unknown device = %v, want ErrUnknownDevice", err)
	}
	// A verb the device's capabilities do not offer, even though the catalogue
	// has it: the driver re-checks rather than trusting the registry.
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbOpen, nil); !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("uncapable verb = %v, want ErrUnsupported", err)
	}
	// A verb the capability offers but the operator mapped no topic for. The
	// driver must not guess a topic.
	err := d.Execute(context.Background(), "mower-1", devices.VerbPause, nil)
	if !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("unmapped verb = %v, want ErrUnsupported", err)
	}
	if len(b.received()) != 0 {
		t.Fatal("a refused verb published something")
	}
}

func TestReadOfACommandOnlyDeviceIsUnsupported(t *testing.T) {
	dc := lampDevice()
	dc.State = nil
	d, _, _ := newConnected(t, dc)

	if _, err := d.Read(context.Background(), "lamp-1"); !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("Read of a device with no state topics = %v, want ErrUnsupported", err)
	}
	if dev := discoverOne(t, d, "lamp-1"); dev.Availability != devices.AvailUnknown {
		t.Fatalf("availability = %q, want unknown: a command-only device is never heard from", dev.Availability)
	}
}

func TestNonFiniteArgumentPublishesNothing(t *testing.T) {
	d, b, _ := newConnected(t, thermoDevice())

	// The registry's range check passes NaN through: NaN < Min and NaN > Max are
	// both false. It has to be refused here.
	err := d.Execute(context.Background(), "thermo-1", devices.VerbSet, map[string]float64{"celsius": math.NaN()})
	if err == nil {
		t.Fatal("NaN argument was accepted")
	}
	if errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("nothing was published, so the outcome is not in doubt: %v", err)
	}
	if err := d.Execute(context.Background(), "thermo-1", devices.VerbSet, nil); err == nil {
		t.Fatal("missing argument was accepted")
	}
	if len(b.received()) != 0 {
		t.Fatalf("a refused command published %d message(s)", len(b.received()))
	}
}

// --- templating.

func TestPayloadTemplatingAndRetain(t *testing.T) {
	dc := lampDevice()
	dc.Commands[2].Retain = true
	d, b, _ := newConnected(t, dc)

	if err := d.Execute(context.Background(), "lamp-1", devices.VerbSet, map[string]float64{"level": 42.5}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	m := b.nextPublish(t)
	if m.topic != "home/lamp1/cmd/level" {
		t.Fatalf("topic = %q", m.topic)
	}
	if string(m.payload) != `{"id":"lamp-1","level":42.5}` {
		t.Fatalf("payload = %q, want the device id and the argument substituted", m.payload)
	}
	if !m.retain {
		t.Fatal("Retain was configured but not set on the wire")
	}
	if m.qos != 1 {
		t.Fatalf("qos = %d, want 1", m.qos)
	}
}

func TestIntegerArgumentsRenderWithoutTrailingZeros(t *testing.T) {
	d, b, _ := newConnected(t, thermoDevice())
	// A setpoint is TierConsequential, so a PUBACK alone is still
	// ErrIndeterminate. What is being asserted here is what went on the wire.
	err := d.Execute(context.Background(), "thermo-1", devices.VerbSet, map[string]float64{"celsius": 21})
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("Execute = %v, want ErrIndeterminate", err)
	}
	if got := string(b.nextPublish(t).payload); got != "21" {
		t.Fatalf("payload = %q, want %q", got, "21")
	}
}

// --- Discover, Health, Close.

func TestDiscoverPublishesNothingAndYieldsValidDevices(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice(), mowerDevice(nil), gateDevice(), thermoDevice())

	found, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if len(found) != 4 {
		t.Fatalf("discovered %d devices, want 4", len(found))
	}
	if len(b.received()) != 0 {
		t.Fatal("Discover published something; it must not actuate")
	}
	for i, dev := range found {
		if err := dev.Validate(); err != nil {
			t.Fatalf("device %q fails the model's own validation: %v", dev.ID, err)
		}
		if dev.Availability == devices.AvailOnline {
			t.Fatalf("device %q reports online before anything was heard from it", dev.ID)
		}
		if i > 0 && found[i-1].ID >= dev.ID {
			t.Fatal("Discover order is not stable/sorted")
		}
	}
}

func TestHealthCarriesNoAddressOrCredential(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())
	h := d.Health(context.Background())
	if !h.OK {
		t.Fatal("expected a healthy link")
	}
	for _, secret := range []string{"hunter2", "broker.example", "8883"} {
		if strings.Contains(h.Detail, secret) {
			t.Fatalf("Health.Detail leaks %q: %q", secret, h.Detail)
		}
	}
	if h.Since.IsZero() {
		t.Fatal("Health.Since is unset")
	}

	b.set(func(b *fakeBroker) { b.dialErr = true })
	b.drop()
	waitFor(t, "the link to go down", func() bool { return !d.Health(context.Background()).OK })
	for _, secret := range []string{"hunter2", "broker.example", "8883"} {
		if strings.Contains(d.Health(context.Background()).Detail, secret) {
			t.Fatalf("Health.Detail leaks %q while down: %q", secret, d.Health(context.Background()).Detail)
		}
	}
}

func TestCloseIsIdempotentAndStopsReading(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice())
	b.push(t, "home/lamp1/level", "62", 0)
	waitReading(t, d, "lamp-1", "level")

	if err := d.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := d.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if _, err := d.Read(context.Background(), "lamp-1"); !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("Read after Close = %v, want ErrUnreachable", err)
	}
	if d.Health(context.Background()).OK {
		t.Fatal("a closed driver reports a healthy link")
	}
}

// --- the seam itself.

func TestConcurrentUse(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice(), mowerDevice(nil))

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ctx := context.Background()
			for j := 0; j < 25; j++ {
				switch (i + j) % 5 {
				case 0:
					_ = d.Execute(ctx, "lamp-1", devices.VerbOn, nil)
				case 1:
					_ = d.Execute(ctx, "mower-1", devices.VerbStop, nil)
				case 2:
					_, _ = d.Read(ctx, "lamp-1")
				case 3:
					_, _ = d.Discover(ctx)
				case 4:
					_ = d.Health(ctx)
				}
			}
		}(i)
	}
	for i := 0; i < 40; i++ {
		b.push(t, "home/lamp1/level", fmt.Sprint(i), 0)
	}
	wg.Wait()
}

func TestRegistryDrivesIt(t *testing.T) {
	d, b, _ := newConnected(t, lampDevice(), mowerDevice(nil))

	reg := devices.NewRegistry()
	if err := reg.Register(d); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := reg.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if _, ok := reg.Get("mqtt:lamp-1"); !ok {
		t.Fatal("device not indexed under its driver id")
	}

	// The tier the registry resolves is the catalogue's, and it is what the
	// driver's evidence rule keys off.
	plan, err := reg.Resolve("mqtt:mower-1", devices.VerbStart, nil)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if plan.Tier != devices.TierHazardousMotion {
		t.Fatalf("tier = %s, want hazardous-motion", plan.Tier)
	}
	if err := reg.ExecutePlan(context.Background(), plan); !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("registry Execute of a hazardous verb = %v, want ErrIndeterminate", err)
	}
	if err := reg.Execute(context.Background(), "mqtt:lamp-1", devices.VerbOn, nil); err != nil {
		t.Fatalf("registry Execute of a reversible verb = %v, want nil", err)
	}

	b.push(t, "home/lamp1/level", "62", 0)
	waitReading(t, d, "lamp-1", "level")
	rs, err := reg.Read(context.Background(), "mqtt:lamp-1")
	if err != nil {
		t.Fatalf("registry Read: %v", err)
	}
	if len(rs) != 1 || rs[0].Value != 62 {
		t.Fatalf("registry readings = %+v", rs)
	}
	if h := reg.DriverHealth(context.Background())["mqtt"]; !h.OK {
		t.Fatal("registry reports the driver unhealthy")
	}
	if err := reg.Close(); err != nil {
		t.Fatalf("registry Close: %v", err)
	}
}
