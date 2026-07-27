package modbus

import (
	"fmt"
	"math"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Defaults applied by New when a Config field is zero.
const (
	DefaultDriverID = "modbus"
	// DefaultPort is Modbus TCP's registered port. Appended when an address
	// names only a host.
	DefaultPort = "502"
	// DefaultTimeout bounds one request end to end, including the dial. Modbus
	// devices are slow — a gateway polling a serial bus can take hundreds of
	// milliseconds — but a meter that has not answered in three seconds is not
	// about to.
	DefaultTimeout = 3 * time.Second
	// DefaultMaxBackoff caps how long an unreachable endpoint is left alone.
	DefaultMaxBackoff = 30 * time.Second
	// DefaultBaseBackoff is the first wait after an endpoint fails to dial
	// twice in a row. It doubles up to DefaultMaxBackoff.
	DefaultBaseBackoff = time.Second
)

// readOnlyCaps is the closed set of capabilities a Modbus device may declare.
//
// Every capability here offers nothing but devices.TierRead verbs, which is what
// makes this driver structurally read-only: the registry will not route a verb
// to a device that does not declare it, so a device that can only ever declare
// read capabilities can only ever be read. See the package doc for why the line
// is drawn here and what a write path would have to establish first.
//
// The set is explicit rather than computed from the catalogue, mirroring the
// catalogue's own closure: adding a row is a reviewed change. TestReadOnlyCaps
// walks the catalogue and fails if any capability listed here has grown a verb
// above TierRead.
var readOnlyCaps = map[devices.CapabilityID]bool{
	devices.CapMeter:        true,
	devices.CapSensorReadCa: true,
}

// Config is the whole configuration surface. It is a parsed struct: this
// package never touches the filesystem and owns no file format. The hub's
// config wiring decides what YAML or TOML looks like.
type Config struct {
	// ID is the driver id the registry namespaces device keys with. Defaults to
	// DefaultDriverID. It must not contain ':' — the registry recovers a driver
	// id by splitting a device key at the FIRST colon — which also means a
	// per-site id like "modbus-plantroom" is fine and "modbus:plantroom" is not.
	ID string
	// Timeout bounds one request, dial included. Defaults to DefaultTimeout. It
	// is applied on top of the caller's context, never instead of it: a caller
	// with a shorter deadline still wins.
	Timeout time.Duration
	// BaseBackoff and MaxBackoff bound how often a dead endpoint is re-dialled.
	// Default to DefaultBaseBackoff and DefaultMaxBackoff.
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
	// Devices are the declared devices. Zero devices is legal.
	Devices []DeviceConfig
}

// DeviceConfig declares one device, where it lives, and how to decode it.
//
// There is no discovery step in Modbus and nothing to probe: a device does not
// announce its address map, its register widths, its word order or its scaling.
// All of it is declared here, and all of it comes from the vendor's
// documentation.
type DeviceConfig struct {
	// ID must be unique within this driver and stable across restarts: the
	// registry reconciles persisted state on it.
	ID   string
	Kind devices.Kind
	Name string
	Zone string
	// Capabilities are catalogue ids, restricted to readOnlyCaps. Declaring an
	// actuable capability is a startup error, not a runtime refusal.
	Capabilities []devices.CapabilityID

	// Address is host:port. A bare host gets DefaultPort. Devices sharing an
	// address share one TCP connection and are polled one at a time — see
	// endpoint.
	Address string
	// UnitID addresses a slave behind a TCP-to-serial gateway. Devices that are
	// natively TCP ignore it; the conventional value for those is 1, and 255 or
	// 0 also appear in the wild. It is not validated against 1..247 because
	// native-TCP devices routinely sit outside that range.
	UnitID uint8

	// Reads are the register blocks to fetch, in order, each of which yields
	// one or more metrics. At least one is required: a Modbus device with no
	// declared block has nothing this driver can do with it.
	Reads []ReadSpec
}

// ReadSpec is one register-block request and the metrics sliced out of it.
//
// Blocks rather than per-metric requests because a Modbus round trip is
// expensive — a gateway relaying to a serial bus can spend a hundred
// milliseconds on one — and a meter's registers are nearly always contiguous.
// Count is declared here rather than derived from the metrics so that an
// operator can transcribe a vendor's block directly, and so that a block may
// deliberately span registers no metric reads: some devices fault on a request
// that starts mid-value.
type ReadSpec struct {
	// Function is 3 (holding) or 4 (input). It is declared per block because a
	// single device commonly publishes in both banks.
	Function FunctionCode
	// Start is the WIRE address of the first register, zero-based.
	//
	// It is not the "4x" number from a vendor manual. The Modicon convention
	// numbers holding registers from 40001 and input registers from 30001, so a
	// manual's 40100 is wire address 99 here, and a manual's 30001 is wire
	// address 0. Vendors are inconsistent about whether their own tables are
	// already zero-based, which is why this field names the wire and refuses to
	// guess: an off-by-one produces a plausible wrong number, never an error.
	Start uint16
	// Count is how many registers to request, 1..MaxReadRegisters. Every
	// metric's registers must fall entirely inside [Start, Start+Count).
	Count uint16
	// Metrics are sliced out of the block once it arrives.
	Metrics []Metric
}

// Metric is one value inside a block: where it starts, how wide it is, how its
// bytes are arranged, and what to multiply it by.
type Metric struct {
	// Metric is the devices.Reading.Metric name, in the capability's own
	// vocabulary — "kw", "kwh", "celsius", "percent". Unique within a device.
	Metric string
	// Address is the WIRE address of the metric's first register, on the same
	// zero-based scale as ReadSpec.Start. Absolute, not an offset into the
	// block: a vendor table lists absolute addresses, and making an operator
	// subtract the block start by hand is an off-by-one waiting to happen.
	Address uint16
	// Type gives the width and signedness. See RegisterType.
	Type RegisterType
	// Order gives the byte and register layout. See WordOrder — this is the
	// field that is wrong when a reading is plausible but incorrect.
	Order WordOrder
	// Scale multiplies the raw value. Zero means unset and is treated as 1.
	Scale float64
	// Offset is added after scaling: value = raw*Scale + Offset.
	Offset float64
}

func configErr(format string, a ...any) error {
	return fmt.Errorf("modbus: config: "+format, a...)
}

// metric is a validated Metric plus its resolved position inside its block.
type metric struct {
	Metric
	// lo and hi are the metric's register span within the block's slice.
	lo, hi int
}

// readBlock is the validated, immutable form of a ReadSpec.
type readBlock struct {
	fn      FunctionCode
	start   uint16
	count   uint16
	metrics []metric
}

// device is the validated, immutable form of a DeviceConfig. Nothing mutates it
// after New returns, which is most of why the driver is concurrency-safe.
type device struct {
	model  devices.Device
	addr   string
	unit   uint8
	blocks []readBlock
}

// validate turns a DeviceConfig into a device, refusing anything it cannot
// prove safe or decodable. Every check here fails the hub's startup rather than
// a resident's evening — and, for the capability check, rather than a plant
// room's.
func (dc DeviceConfig) validate() (device, error) {
	model := devices.Device{
		ID:           dc.ID,
		Kind:         dc.Kind,
		Name:         dc.Name,
		Zone:         dc.Zone,
		Capabilities: append([]devices.CapabilityID(nil), dc.Capabilities...),
		Availability: devices.AvailUnknown,
	}
	// The catalogue check lives in the engine, not here. A driver that
	// re-implemented it could drift from it.
	if err := model.Validate(); err != nil {
		return device{}, configErr("%v", err)
	}
	if dc.Name == "" {
		return device{}, configErr("device %q has no name", dc.ID)
	}
	for _, c := range dc.Capabilities {
		if !readOnlyCaps[c] {
			return device{}, configErr("device %q declares capability %q, which offers verbs that "+
				"actuate; this driver is read-only and accepts only %s", dc.ID, string(c), readOnlyCapList())
		}
	}

	addr, err := normaliseAddress(dc.ID, dc.Address)
	if err != nil {
		return device{}, err
	}
	d := device{model: model, addr: addr, unit: dc.UnitID}

	if len(dc.Reads) == 0 {
		return device{}, configErr("device %q declares no register blocks to read", dc.ID)
	}
	seen := map[string]bool{}
	for i, r := range dc.Reads {
		blk, err := r.validate(dc.ID, i, seen)
		if err != nil {
			return device{}, err
		}
		d.blocks = append(d.blocks, blk)
	}
	return d, nil
}

func (r ReadSpec) validate(deviceID string, idx int, seen map[string]bool) (readBlock, error) {
	where := fmt.Sprintf("device %q read %d", deviceID, idx)
	if !r.Function.valid() {
		return readBlock{}, configErr("%s uses function code %d; this driver reads only, so the "+
			"only codes are %d (holding registers) and %d (input registers)",
			where, uint8(r.Function), FCReadHolding, FCReadInput)
	}
	if r.Count < 1 || r.Count > MaxReadRegisters {
		return readBlock{}, configErr("%s asks for %d registers; the protocol allows 1..%d in one request",
			where, r.Count, MaxReadRegisters)
	}
	// The address space is 16-bit and does not wrap. A block that would run off
	// the end is a transcription error, and a device's own answer to it is an
	// exception at best.
	if int(r.Start)+int(r.Count) > 1<<16 {
		return readBlock{}, configErr("%s spans registers %d..%d, past the end of the 16-bit address space",
			where, r.Start, int(r.Start)+int(r.Count)-1)
	}
	if len(r.Metrics) == 0 {
		return readBlock{}, configErr("%s declares no metrics", where)
	}

	blk := readBlock{fn: r.Function, start: r.Start, count: r.Count}
	for _, m := range r.Metrics {
		if m.Metric == "" {
			return readBlock{}, configErr("%s has a metric with no name", where)
		}
		if seen[m.Metric] {
			return readBlock{}, configErr("device %q declares metric %q twice", deviceID, m.Metric)
		}
		seen[m.Metric] = true
		if !m.Type.valid() {
			return readBlock{}, configErr("%s metric %q has unknown type %q; known: %s",
				where, m.Metric, string(m.Type), typeList())
		}
		if !m.Order.valid() {
			return readBlock{}, configErr("%s metric %q has unknown word order %q; known: %s",
				where, m.Metric, string(m.Order), orderList())
		}
		if math.IsNaN(m.Scale) || math.IsInf(m.Scale, 0) {
			return readBlock{}, configErr("%s metric %q has a non-finite scale", where, m.Metric)
		}
		if math.IsNaN(m.Offset) || math.IsInf(m.Offset, 0) {
			return readBlock{}, configErr("%s metric %q has a non-finite offset", where, m.Metric)
		}
		width := int(m.Type.Registers())
		lo := int(m.Address) - int(r.Start)
		hi := lo + width
		// A metric that straddles the edge of its block would otherwise be
		// decoded from whatever registers happened to be adjacent in the slice,
		// which is a silent wrong number rather than a failure.
		if lo < 0 || hi > int(r.Count) {
			return readBlock{}, configErr("%s metric %q reads registers %d..%d as %s, outside the "+
				"block's %d..%d", where, m.Metric, m.Address, int(m.Address)+width-1, m.Type,
				r.Start, int(r.Start)+int(r.Count)-1)
		}
		blk.metrics = append(blk.metrics, metric{Metric: m, lo: lo, hi: hi})
	}
	return blk, nil
}

// normaliseAddress requires a host and appends DefaultPort when the address
// names only one. A URL is refused outright rather than half-parsed: "modbus is
// not HTTP" is a cheaper thing to say at startup than at 3am.
func normaliseAddress(deviceID, raw string) (string, error) {
	addr := strings.TrimSpace(raw)
	if addr == "" {
		return "", configErr("device %q has no address", deviceID)
	}
	if strings.Contains(addr, "://") || strings.Contains(addr, "/") {
		return "", configErr("device %q address %q looks like a URL; Modbus TCP takes host:port", deviceID, raw)
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// No port, or an unbracketed IPv6 literal. Try the default port; if the
		// result still will not split, the address is genuinely malformed.
		withPort := net.JoinHostPort(addr, DefaultPort)
		if h, p, err2 := net.SplitHostPort(withPort); err2 == nil && h != "" {
			return net.JoinHostPort(h, p), nil
		}
		return "", configErr("device %q address %q is not host:port", deviceID, raw)
	}
	if host == "" {
		return "", configErr("device %q address %q has no host", deviceID, raw)
	}
	if port == "" {
		port = DefaultPort
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return "", configErr("device %q address %q has an invalid port", deviceID, raw)
	}
	return net.JoinHostPort(host, port), nil
}

func readOnlyCapList() string {
	out := make([]string, 0, len(readOnlyCaps))
	for c := range readOnlyCaps {
		out = append(out, string(c))
	}
	sort.Strings(out)
	return strings.Join(out, ", ")
}

func typeList() string {
	return strings.Join([]string{
		string(TypeU16), string(TypeS16), string(TypeU32), string(TypeS32),
		string(TypeU64), string(TypeS64), string(TypeF32), string(TypeF64),
	}, ", ")
}

func orderList() string {
	return strings.Join([]string{
		string(OrderABCD), string(OrderBADC), string(OrderCDAB), string(OrderDCBA),
	}, ", ")
}
