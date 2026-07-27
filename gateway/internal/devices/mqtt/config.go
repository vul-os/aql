package mqtt

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// Config is the driver's whole input. It is a parsed struct, not a file: this
// package deliberately defines no file format and reads no disk. Whatever
// eventually loads hub configuration builds one of these, so the mapping can be
// unit-tested without a filesystem and a second config source can feed the same
// driver.
type Config struct {
	// DriverID is the devices.Driver id and the prefix of every device key it
	// produces. It must be stable across restarts. Defaults to "mqtt"; give a
	// second broker a distinct id ("mqtt-plantroom"). It may not contain a
	// colon: the registry recovers a driver id by splitting a device key at its
	// first one, so an id containing a colon indexes devices under a driver
	// that was never registered. New refuses it.
	DriverID string

	// BrokerAddr is host:port. Required.
	BrokerAddr string
	// ClientID is the MQTT client identifier. Defaults to "aql-hub". Two hubs
	// sharing one must not share a broker: MQTT evicts the older session.
	ClientID string
	Username string
	Password string
	// TLSConfig, when set, wraps the connection in TLS. Ignored when Dial is
	// set, since a custom dialer owns its own transport.
	TLSConfig *tls.Config

	// Dial replaces the default dialer. The test suite uses it to run the whole
	// driver over an in-memory pipe; an operator could use it for a proxy or a
	// unix socket.
	Dial func(ctx context.Context, addr string) (net.Conn, error)

	// KeepAlive is the MQTT keepalive. Defaults to 30s. The client pings at
	// half this and drops a link that has been silent for one and a half.
	KeepAlive time.Duration
	// ConnectTimeout bounds dial plus CONNACK plus SUBACK. Defaults to 10s.
	ConnectTimeout time.Duration
	// AckTimeout bounds the wait for a QoS 1 PUBACK. Defaults to 5s.
	AckTimeout time.Duration
	// CommandQoS is the QoS commands are published at. It has no default: the
	// zero value is invalid and New refuses it, the same shape as
	// devices.TierUnset. Silently defaulting a delivery guarantee is the kind
	// of default that gets discovered during an incident, and the choice
	// changes what Execute is able to honestly report (see the package doc).
	CommandQoS QoS
	// MaxPacketBytes caps an inbound packet body. Defaults to 256 KiB. A broker
	// announcing a larger one has the link dropped rather than being allowed to
	// name this process's allocation size.
	MaxPacketBytes int
	// StaleAfter, when > 0, is how long a received value stays usable. Past it
	// the reading is dropped rather than returned: a temperature from six hours
	// ago is not a reading, it is a memory. Zero means values never expire on
	// age alone (they are still dropped on disconnect).
	StaleAfter time.Duration
	// ReconnectMin and ReconnectMax bound the backoff ladder. Default 1s and
	// 60s.
	ReconnectMin time.Duration
	ReconnectMax time.Duration

	// Now and Logf are test seams. Logf defaults to a no-op: this package does
	// not choose a logger for the hub.
	Now  func() time.Time
	Logf func(format string, args ...any)

	Devices []DeviceConfig
}

// DeviceConfig declares one device and how it maps onto topics.
type DeviceConfig struct {
	ID           string
	Kind         devices.Kind
	Name         string
	Zone         string
	Capabilities []devices.CapabilityID
	// State maps inbound topics to metrics.
	State []StateTopic
	// Commands maps catalogue verbs to outbound topics. A verb the device's
	// capabilities offer but that has no command here is refused at Execute
	// with devices.ErrUnsupported — a driver that published to a guessed topic
	// would be inventing a device's protocol.
	Commands []Command
}

// StateTopic binds one subscription to one metric.
type StateTopic struct {
	// Metric uses the capability's own vocabulary: "level", "celsius", "kw",
	// "percent", "state".
	Metric string
	// Topic may be a filter, with '+' and '#', for devices that publish under
	// a per-instance prefix.
	Topic string
	// QoS to subscribe at: 0 or 1. Defaults to 0. QoS 1 costs a round trip per
	// message and buys redelivery across a reconnect, which telemetry rarely
	// wants — the next sample is more useful than the last one repeated.
	QoS byte
	// Text carries the payload through as Reading.Text instead of parsing it as
	// a number. Use it for "docked", "patrol", "locked".
	Text bool
}

// Command binds one catalogue verb to one outbound topic and payload.
type Command struct {
	Verb devices.Verb
	// Topic must be concrete: no wildcards. Commanding a wildcard would
	// actuate every device beneath it.
	Topic string
	// Payload is a template. {{verb}} and {{device}} are always available, and
	// the verb's own argument is available under its catalogue name — {{level}}
	// for light.dimmable set, {{celsius}} for climate.setpoint set. A verb that
	// takes an argument MUST reference it, so a template cannot silently drop
	// the number the resident asked for. Numbers render without exponent or
	// trailing zeros: 21.5 as "21.5", 100 as "100".
	Payload string
	// Retain asks the broker to retain the command. Off by default and rarely
	// right: a retained command is replayed to a device every time it
	// reconnects, so a retained "start" can restart a mower at 03:00 after a
	// power cut.
	Retain bool
	// Confirm, when set, turns this command into a closed loop: after
	// publishing, the driver waits for the device's own state topic to report
	// the expected value, and only then reports success. Without it the best
	// this driver can honestly say about a command is ErrIndeterminate (or, at
	// QoS 1 for a reversible verb, that the broker took it). See the package
	// doc's error table.
	Confirm *Confirm
}

// Confirm is the evidence a command actually landed.
type Confirm struct {
	// Topic is where the device reports the result. May be a filter.
	Topic string
	// Payload is the exact payload that counts as confirmation, after template
	// rendering with the same variables as Command.Payload.
	Payload string
	// Timeout bounds the wait. Defaults to 5s. It is also bounded by the
	// caller's context.
	Timeout time.Duration
}

const (
	defaultDriverID     = "mqtt"
	defaultClientID     = "aql-hub"
	defaultKeepAlive    = 30 * time.Second
	defaultConnect      = 10 * time.Second
	defaultAckTimeout   = 5 * time.Second
	defaultConfirmWait  = 5 * time.Second
	defaultMaxPacket    = 256 << 10
	defaultReconnectMin = time.Second
	defaultReconnectMax = 60 * time.Second
)

// QoS is a command's delivery guarantee. QoSUnset is deliberately the zero
// value and is never valid.
type QoS byte

const (
	QoSUnset QoS = iota
	// QoSAtMostOnce is MQTT QoS 0: fire and forget. The broker never
	// acknowledges, so Execute can never do better than ErrIndeterminate.
	QoSAtMostOnce
	// QoSAtLeastOnce is MQTT QoS 1: the broker acknowledges with PUBACK. That
	// proves the BROKER holds the message, not that the device acted on it.
	QoSAtLeastOnce
)

// wire is the on-the-wire QoS value.
func (q QoS) wire() byte { return byte(q) - 1 }

func (q QoS) String() string {
	switch q {
	case QoSAtMostOnce:
		return "0"
	case QoSAtLeastOnce:
		return "1"
	}
	return "unset"
}

func (c *Config) applyDefaults() {
	if c.DriverID == "" {
		c.DriverID = defaultDriverID
	}
	if c.ClientID == "" {
		c.ClientID = defaultClientID
	}
	if c.KeepAlive == 0 {
		c.KeepAlive = defaultKeepAlive
	}
	if c.ConnectTimeout == 0 {
		c.ConnectTimeout = defaultConnect
	}
	if c.AckTimeout == 0 {
		c.AckTimeout = defaultAckTimeout
	}
	if c.MaxPacketBytes == 0 {
		c.MaxPacketBytes = defaultMaxPacket
	}
	if c.ReconnectMin <= 0 {
		c.ReconnectMin = defaultReconnectMin
	}
	if c.ReconnectMax < c.ReconnectMin {
		c.ReconnectMax = maxDuration(defaultReconnectMax, c.ReconnectMin)
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Logf == nil {
		c.Logf = func(string, ...any) {}
	}
	if c.Dial == nil {
		c.Dial = c.defaultDial
	}
}

func maxDuration(a, b time.Duration) time.Duration {
	if a > b {
		return a
	}
	return b
}

func (c *Config) defaultDial(ctx context.Context, addr string) (net.Conn, error) {
	d := &net.Dialer{}
	if c.TLSConfig == nil {
		return d.DialContext(ctx, "tcp", addr)
	}
	return (&tls.Dialer{NetDialer: d, Config: c.TLSConfig}).DialContext(ctx, "tcp", addr)
}

// validate checks everything that can be checked without a broker. It fails
// closed and reports every problem it finds, because a hub operator editing a
// device map wants the whole list, not the first line.
func (c *Config) validate() error {
	var problems []string
	add := func(format string, a ...any) { problems = append(problems, fmt.Sprintf(format, a...)) }

	if c.BrokerAddr == "" {
		add("broker address is empty")
	}
	if c.CommandQoS != QoSAtMostOnce && c.CommandQoS != QoSAtLeastOnce {
		add("CommandQoS is unset: choose QoSAtMostOnce or QoSAtLeastOnce explicitly")
	}
	if err := validString(c.ClientID); err != nil {
		add("client id: %v", err)
	}

	seen := map[string]bool{}
	for _, dc := range c.Devices {
		if seen[dc.ID] {
			add("device %q declared twice", dc.ID)
			continue
		}
		seen[dc.ID] = true
		problems = append(problems, validateDevice(dc)...)
	}
	if len(problems) == 0 {
		return nil
	}
	sort.Strings(problems)
	return fmt.Errorf("mqtt: invalid config: %s", strings.Join(problems, "; "))
}

func validateDevice(dc DeviceConfig) []string {
	var problems []string
	add := func(format string, a ...any) {
		problems = append(problems, fmt.Sprintf("device %q: %s", dc.ID, fmt.Sprintf(format, a...)))
	}

	dev := dc.device()
	// The catalogue, not this package, decides what a device may claim.
	if err := dev.Validate(); err != nil {
		problems = append(problems, fmt.Sprintf("device %q: %v", dc.ID, err))
	}

	metrics := map[string]bool{}
	for _, st := range dc.State {
		if st.Metric == "" {
			add("state topic %q has no metric", st.Topic)
		}
		if metrics[st.Metric] {
			add("metric %q is declared twice", st.Metric)
		}
		metrics[st.Metric] = true
		if err := ValidateFilter(st.Topic); err != nil {
			add("state topic: %v", err)
		}
		if st.QoS > 1 {
			add("state topic %q: QoS %d is not implemented", st.Topic, st.QoS)
		}
	}

	mapped := map[devices.Verb]bool{}
	for _, cmd := range dc.Commands {
		if mapped[cmd.Verb] {
			add("verb %q is mapped twice", cmd.Verb)
		}
		mapped[cmd.Verb] = true
		spec, _, ok := dev.Supports(cmd.Verb)
		if !ok {
			// Either the verb is not in the catalogue at all, or this device's
			// capabilities do not offer it. Both are the same config bug and
			// both are refused: a driver cannot widen the verb space.
			add("verb %q is not offered by its capabilities", cmd.Verb)
			continue
		}
		if err := ValidateTopic(cmd.Topic); err != nil {
			add("verb %q: %v", cmd.Verb, err)
		}
		for _, p := range checkTemplate(cmd.Payload, spec) {
			add("verb %q payload: %s", cmd.Verb, p)
		}
		if cmd.Confirm != nil {
			if err := ValidateFilter(cmd.Confirm.Topic); err != nil {
				add("verb %q confirm topic: %v", cmd.Verb, err)
			}
			for _, p := range checkTemplate(cmd.Confirm.Payload, spec) {
				add("verb %q confirm payload: %s", cmd.Verb, p)
			}
		}
	}

	// The catalogue's rule is that stopping is never riskier than starting
	// (capability.go, checkInverses). A config that maps a hazardous verb but
	// not its inverse would give a resident a start button and no stop button,
	// so it is refused here rather than discovered at 3am on a lawn.
	for verb := range mapped {
		spec, _, ok := dev.Supports(verb)
		if !ok || spec.Tier <= devices.TierConsequential {
			continue
		}
		if spec.Inverse != "" && !mapped[spec.Inverse] {
			add("verb %q is %s but its inverse %q is not mapped to a topic", verb, spec.Tier, spec.Inverse)
		}
	}
	return problems
}

// device builds the devices.Device this config declares, without any live
// state. Availability and Summary are filled in later from telemetry.
func (dc DeviceConfig) device() devices.Device {
	return devices.Device{
		ID:           dc.ID,
		Kind:         dc.Kind,
		Name:         dc.Name,
		Zone:         dc.Zone,
		Capabilities: append([]devices.CapabilityID(nil), dc.Capabilities...),
	}
}

// checkTemplate validates a payload template against the verb's spec.
func checkTemplate(tmpl string, spec devices.VerbSpec) []string {
	var problems []string
	names, err := templateVars(tmpl)
	if err != nil {
		return []string{err.Error()}
	}
	allowed := map[string]bool{"verb": true, "device": true}
	if spec.Arg != "" {
		allowed[spec.Arg] = true
	}
	usesArg := false
	for _, n := range names {
		if !allowed[n] {
			problems = append(problems, fmt.Sprintf("unknown placeholder {{%s}}", n))
			continue
		}
		if n == spec.Arg {
			usesArg = true
		}
	}
	if spec.Arg != "" && !usesArg {
		problems = append(problems, fmt.Sprintf("verb takes argument %q but the template never uses {{%s}}", spec.Arg, spec.Arg))
	}
	return problems
}

// templateVars returns the placeholder names in a template, refusing an
// unterminated one rather than treating it as literal text.
func templateVars(tmpl string) ([]string, error) {
	var out []string
	rest := tmpl
	for {
		i := strings.Index(rest, "{{")
		if i < 0 {
			return out, nil
		}
		rest = rest[i+2:]
		j := strings.Index(rest, "}}")
		if j < 0 {
			return nil, fmt.Errorf("unterminated placeholder in %q", tmpl)
		}
		out = append(out, strings.TrimSpace(rest[:j]))
		rest = rest[j+2:]
	}
}

// render substitutes a template's placeholders. It is only ever called with a
// template validate() already accepted, so an unknown name here is a bug, not
// operator input; it is reported rather than silently left in the payload.
func render(tmpl string, vars map[string]string) (string, error) {
	var b strings.Builder
	rest := tmpl
	for {
		i := strings.Index(rest, "{{")
		if i < 0 {
			b.WriteString(rest)
			return b.String(), nil
		}
		b.WriteString(rest[:i])
		rest = rest[i+2:]
		j := strings.Index(rest, "}}")
		if j < 0 {
			return "", fmt.Errorf("mqtt: unterminated placeholder in %q", tmpl)
		}
		name := strings.TrimSpace(rest[:j])
		val, ok := vars[name]
		if !ok {
			return "", fmt.Errorf("mqtt: template placeholder {{%s}} has no value", name)
		}
		b.WriteString(val)
		rest = rest[j+2:]
	}
}

// formatNumber renders a verb argument the way a device expects to read it:
// no exponent, no trailing zeros.
func formatNumber(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}
