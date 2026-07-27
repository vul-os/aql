package modbus

// The Driver: the last layer, and deliberately the thinnest.
//
// frame.go owns the wire format, conn.go owns the socket and its queue,
// decode.go owns register-to-number, and config.go has already refused
// everything it cannot prove decodable — by the time New returns, every device,
// block and metric is validated and immutable. So this file does almost no
// deciding. It walks blocks, hands PDUs to the endpoint, and turns the results
// into devices.Reading.
//
// Two things it DOES decide, both about honesty rather than protocol:
//
//   - A device that answers some blocks and fails others is DEGRADED, not
//     offline and not fine. A meter whose power register reads while its energy
//     register times out is a real and common state — one register range lives
//     behind a slow sub-device on the bus — and collapsing it to either extreme
//     loses the thing an operator needs to see.
//   - A block that fails contributes NO readings, rather than stale ones. The
//     engine's Reading has an At timestamp precisely so a consumer can age a
//     value out, but re-emitting last cycle's number with this cycle's clock
//     would defeat that. internal/energy is the caller that matters here: it
//     treats a gap as a gap and interpolates visibly, which is only correct if
//     a gap actually arrives as one.

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Driver is a read-only Modbus TCP adapter. Construct with New; the zero value
// is unusable.
type Driver struct {
	id      string
	devices map[string]device
	// order is the config order of device ids, so Discover is deterministic.
	// A map iteration would reshuffle the console's device list on every
	// refresh for no reason.
	order []string

	// endpoints is one per unique ADDRESS, not per device. Several Modbus
	// slaves commonly sit behind one TCP-to-RTU gateway on one socket, and that
	// socket is genuinely single-threaded: the MBAP transaction id is 16 bits
	// and cheap gateways ignore it entirely. Sharing the endpoint means
	// endpoint.mu serialises those devices against each other, which is the
	// required behaviour rather than a limitation.
	endpoints map[string]*endpoint

	// avail is the last observed availability per device id, so Discover
	// reports what the driver actually knows rather than a fixed Unknown.
	mu      sync.RWMutex
	avail   map[string]devices.Availability
	summary map[string]string
	lastErr map[string]string
}

// New validates the whole configuration and returns a ready driver.
//
// Nothing is dialled here. A Modbus device that is switched off must not
// prevent the hub from starting, and a driver that dialled in its constructor
// would make boot time depend on a plant room's network.
func New(cfg Config) (*Driver, error) {
	id := strings.TrimSpace(cfg.ID)
	if id == "" {
		id = "modbus"
	}
	if len(cfg.Devices) == 0 {
		return nil, configErr("no devices configured")
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	base := cfg.BaseBackoff
	if base <= 0 {
		base = DefaultBaseBackoff
	}
	max := cfg.MaxBackoff
	if max <= 0 {
		max = DefaultMaxBackoff
	}
	if max < base {
		return nil, configErr("MaxBackoff (%s) is shorter than BaseBackoff (%s)", max, base)
	}

	d := &Driver{
		id:        id,
		devices:   make(map[string]device, len(cfg.Devices)),
		order:     make([]string, 0, len(cfg.Devices)),
		endpoints: map[string]*endpoint{},
		avail:     map[string]devices.Availability{},
		summary:   map[string]string{},
		lastErr:   map[string]string{},
	}

	for i, dc := range cfg.Devices {
		dev, err := dc.validate()
		if err != nil {
			return nil, err
		}
		if _, dup := d.devices[dev.model.ID]; dup {
			return nil, configErr("device %q is declared twice", dev.model.ID)
		}
		if len(dev.blocks) == 0 {
			// A device with no reads is a device that can never report
			// anything. Refusing at config time beats a console row that is
			// permanently blank with no explanation.
			return nil, configErr("device %q (index %d) declares no reads", dev.model.ID, i)
		}
		d.devices[dev.model.ID] = dev
		d.order = append(d.order, dev.model.ID)
		if _, ok := d.endpoints[dev.addr]; !ok {
			d.endpoints[dev.addr] = newEndpoint(dev.addr, timeout, base, max)
		}
		d.avail[dev.model.ID] = devices.AvailUnknown
	}
	return d, nil
}

func (d *Driver) ID() string { return d.id }

// Discover returns the configured fleet. There is no discovery protocol in
// Modbus TCP — a register map is a PDF, not a broadcast — so this reports
// exactly what was configured, annotated with what polling has learned since.
func (d *Driver) Discover(_ context.Context) ([]devices.Device, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	out := make([]devices.Device, 0, len(d.order))
	for _, id := range d.order {
		dev := d.devices[id]
		model := dev.model
		model.Capabilities = append([]devices.CapabilityID(nil), dev.model.Capabilities...)
		model.Availability = d.avail[id]
		model.Summary = d.summary[id]
		out = append(out, model)
	}
	return out, nil
}

// Execute always refuses.
//
// Not a policy this function enforces — see the package doc. Config accepts
// only capabilities whose entire verb set is TierRead, so the registry will
// never route an actuating verb to one of these devices in the first place.
// This is the backstop, and it returns ErrUnsupported rather than a Modbus
// error because the honest answer is "this driver does not do that", not "the
// device refused".
func (d *Driver) Execute(_ context.Context, deviceID string, v devices.Verb, _ map[string]float64) error {
	d.mu.RLock()
	_, known := d.devices[deviceID]
	d.mu.RUnlock()
	if !known {
		return fmt.Errorf("modbus: device %q: %w", deviceID, devices.ErrUnknownDevice)
	}
	return fmt.Errorf("modbus: %q is read-only; verb %q is not available: %w",
		deviceID, v, devices.ErrUnsupported)
}

// Read polls every block for one device and returns whatever decoded.
//
// A partial result is returned WITH an error only when nothing decoded at all.
// When some blocks answered, the readings are returned with a nil error and the
// device is marked degraded — a caller that wanted all-or-nothing would have to
// discard good data because of an unrelated register range.
func (d *Driver) Read(ctx context.Context, deviceID string) ([]devices.Reading, error) {
	d.mu.RLock()
	dev, ok := d.devices[deviceID]
	d.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("modbus: device %q: %w", deviceID, devices.ErrUnknownDevice)
	}

	ep := d.endpoints[dev.addr]
	now := time.Now()

	var (
		out      []devices.Reading
		failures []string
		lastErr  error
	)

	for _, blk := range dev.blocks {
		regs, err := d.readBlock(ctx, ep, dev.unit, blk)
		if err != nil {
			lastErr = err
			failures = append(failures, fmt.Sprintf("%s@%d+%d: %v", blk.fn, blk.start, blk.count, err))
			continue
		}
		for _, m := range blk.metrics {
			// The metric's registers, sliced out of the block it shares with
			// its neighbours. lo/hi were resolved at config time against the
			// block's own start, so no arithmetic happens here — this is the
			// off-by-one the package doc warns about, and the place to not
			// have one is once, in validate.
			value, derr := m.decode(regs[m.lo:m.hi])
			if derr != nil {
				// A decode failure is a CONFIG error surfacing at runtime: the
				// registers arrived fine and the declared type could not read
				// them. Report it as a failure of that metric rather than of
				// the device, and never emit a number for it.
				// m.Metric is the EMBEDDED struct; m.Metric.Metric is its name
				// field. Confusing, and worth spelling out rather than
				// aliasing: the embedding is what lets validate() attach lo/hi
				// without copying the config type.
				failures = append(failures, fmt.Sprintf("metric %q: %v", m.Metric.Metric, derr))
				continue
			}
			out = append(out, devices.Reading{
				DeviceID: deviceID,
				Metric:   m.Metric.Metric,
				Value:    value,
				At:       now,
			})
		}
	}

	switch {
	case len(out) == 0:
		// Nothing decoded. The device is offline as far as this driver can
		// tell, and the error is propagated so the registry sees a genuine
		// failure rather than an empty success.
		d.note(deviceID, devices.AvailOffline, "", strings.Join(failures, "; "))
		if lastErr == nil {
			lastErr = fmt.Errorf("modbus: device %q: no metric decoded: %s",
				deviceID, strings.Join(failures, "; "))
		}
		return nil, lastErr
	case len(failures) > 0:
		// Some blocks answered. Degraded is the only honest label: the device
		// is demonstrably reachable and demonstrably not reporting everything.
		d.note(deviceID, devices.AvailDegraded, summarise(out), strings.Join(failures, "; "))
		return out, nil
	default:
		d.note(deviceID, devices.AvailOnline, summarise(out), "")
		return out, nil
	}
}

// readBlock performs one request and decodes the register payload.
func (d *Driver) readBlock(ctx context.Context, ep *endpoint, unit uint8, blk readBlock) ([]uint16, error) {
	pdu, err := readRequestPDU(blk.fn, blk.start, blk.count)
	if err != nil {
		return nil, err
	}
	resp, err := ep.exchange(ctx, unit, pdu)
	if err != nil {
		return nil, err
	}
	return decodeReadResponse(resp, blk.fn, blk.count)
}

// note records what the last poll observed.
func (d *Driver) note(deviceID string, a devices.Availability, summary, errText string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.avail[deviceID] = a
	d.summary[deviceID] = summary
	if errText == "" {
		delete(d.lastErr, deviceID)
	} else {
		d.lastErr[deviceID] = errText
	}
}

// Health reports the driver's own state without touching the network.
//
// It is derived from the endpoints' cached flags and from the last poll of each
// device, never from a fresh dial — the seam forbids blocking here, and a health
// check that queued behind an in-flight poll would report a slow device as a
// broken driver.
func (d *Driver) Health(_ context.Context) devices.Health {
	var down []string
	for addr, ep := range d.endpoints {
		if !ep.healthy.Load() {
			// The address is operator-facing and is NOT a credential: a Modbus
			// TCP endpoint carries no auth of any kind, which is itself worth
			// knowing and is documented in the package doc. Host:port is what
			// an operator needs to go and look at.
			down = append(down, addr)
		}
	}
	sort.Strings(down)

	d.mu.RLock()
	var degraded, offline int
	for _, id := range d.order {
		switch d.avail[id] {
		case devices.AvailDegraded:
			degraded++
		case devices.AvailOffline:
			offline++
		}
	}
	total := len(d.order)
	d.mu.RUnlock()

	switch {
	case len(down) > 0:
		return devices.Health{
			OK: false,
			Detail: fmt.Sprintf("%d of %d endpoint(s) unreachable: %s",
				len(down), len(d.endpoints), strings.Join(down, ", ")),
		}
	case offline > 0:
		return devices.Health{
			OK:     false,
			Detail: fmt.Sprintf("%d of %d device(s) reported nothing on the last poll", offline, total),
		}
	case degraded > 0:
		// Reachable but incomplete. OK stays true because the driver is
		// working and the devices are answering; the count is what says the
		// picture is partial.
		return devices.Health{
			OK:     true,
			Detail: fmt.Sprintf("%d of %d device(s) answered only some register blocks", degraded, total),
		}
	default:
		return devices.Health{OK: true, Detail: fmt.Sprintf("%d device(s) configured", total)}
	}
}

// Close releases every pooled connection. Not part of the Driver interface —
// a driver holding no resources needs none — but cmd/hub closes what it can.
func (d *Driver) Close() error {
	for _, ep := range d.endpoints {
		ep.mu.Lock()
		ep.closeLocked()
		ep.mu.Unlock()
	}
	return nil
}

// summarise builds the console's one-line state.
//
// Deliberately just the first metric in config order, with its name. Inventing
// a prettier sentence would mean this driver deciding that "kw" is the
// interesting one on a meter and "celsius" on a sensor, which is exactly the
// per-protocol special-casing the device model exists to avoid.
func summarise(readings []devices.Reading) string {
	if len(readings) == 0 {
		return ""
	}
	r := readings[0]
	return fmt.Sprintf("%s %s", trimFloat(r.Value), r.Metric)
}

// trimFloat renders a reading without trailing zeros, so 21.5 does not become
// "21.500000" and 4 does not become "4.000000".
func trimFloat(v float64) string {
	s := fmt.Sprintf("%.3f", v)
	s = strings.TrimRight(s, "0")
	return strings.TrimSuffix(s, ".")
}

// errIsUnreachable reports whether err came from the transport rather than
// from the device's own answer. Kept here so tests can assert the distinction
// the package doc promises: a gateway exception 0x0A/0x0B is unreachable, a
// malformed frame is not.
func errIsUnreachable(err error) bool { return errors.Is(err, devices.ErrUnreachable) }
