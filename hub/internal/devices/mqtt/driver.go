// Package mqtt drives devices that speak MQTT 3.1.1. Standard library only: no
// external client, no CGO. The protocol lives in packet.go and client.go; this
// file is the devices.Driver implementation over them.
//
// # What it is
//
// A device is DECLARED, not discovered. MQTT has no discovery — only
// conventions — and a hub that guesses a convention is a hub that publishes
// "start" to something it never identified. The operator states a device's id,
// kind, zone, catalogue capabilities, the state topics it publishes, and one
// command topic per verb. Discover therefore touches no network and publishes
// nothing.
//
// Telemetry is push, not poll. The driver subscribes once per session and
// caches what arrives, so Read answers from memory: no round trip, and no
// request a battery-powered sensor would have to wake up and serve.
//
// # What it is NOT
//
//   - It does not invent verbs. Capabilities come from the catalogue and
//     devices.Device.Validate rejects anything else, so an operator cannot
//     widen the verb space — or dodge a tier — through config.
//   - No QoS 2, no persistent session, no last-will. Clean session is always
//     set; this process keeps no session state a broker could usefully hold.
//   - It does not read config from disk. Config is a plain struct.
//
// # What an Execute return actually means
//
// This is the part worth reading. MQTT is a message bus: a publish is addressed
// to a topic, and a topic is not a device. Nothing in the protocol tells this
// driver that a device acted, so "the publish worked" and "the device did it"
// are different claims and only one of them is usually available.
//
//	unknown device id                     -> ErrUnknownDevice
//	verb not in the device's capabilities -> ErrUnsupported
//	verb with no command topic configured -> ErrUnsupported
//	payload template needs an argument it
//	  was not given, or a non-finite one  -> plain failure (nothing published)
//	no broker link                        -> ErrUnreachable   (nothing was written)
//	write failed having written 0 bytes   -> ErrUnreachable   (nothing left this host)
//	write failed mid-packet               -> ErrIndeterminate (broker may hold a whole packet)
//	QoS 1, no PUBACK before AckTimeout    -> ErrIndeterminate (it went out; the ack did not come back)
//	QoS 0, published                      -> ErrIndeterminate (nothing acknowledges anything)
//	QoS 1, PUBACK, tier > TierReversible  -> ErrIndeterminate (see below)
//	QoS 1, PUBACK, tier <= TierReversible -> nil              (see below)
//	Command.Confirm configured, device
//	  published the expected payload      -> nil
//	Command.Confirm configured, it did
//	  not arrive in time / link dropped   -> ErrIndeterminate
//
// # The QoS 1 concession, stated plainly
//
// A PUBACK proves the BROKER holds the message. It does not prove the device
// received it, and it certainly does not prove the device acted: the device may
// be unsubscribed, asleep, unplugged, or subscribed to a topic one character
// different from the one configured here.
//
// This driver nonetheless reports nil — "it happened" — for exactly one case:
// CommandQoS is QoSAtLeastOnce, the PUBACK came back, and the verb's catalogue
// tier is TierReversible or below. Those are lamps, switches, `close`, `stop`,
// `dock` — verbs whose worst case when the claim is wrong is that a resident
// presses it again. Demanding a confirmation topic for every light in a house
// would make the driver unusable, and an unusable driver is not safer.
//
// Above TierReversible the concession is withdrawn. A thermostat setpoint, a
// patrol disarm, a gate `open`, a mower `start` — TierConsequential,
// TierPhysicalAccess, TierHazardousMotion — never report success on a PUBACK
// alone. Either the device confirms on its own state topic (Command.Confirm) or
// the caller is told ErrIndeterminate, because "the gate may have opened" and
// "the gate opened" are different facts and a resident acts on them
// differently. The tier is read from the catalogue, never chosen here.
//
// Command.Confirm is the only mechanism in this package that can turn a
// hazardous verb into a nil return, and it works by requiring the device to say
// so itself.
//
// # Readings, and what an unheard topic reads as
//
// Read answers from the subscription cache. A topic that has NOT been published
// since the driver connected has no entry, and the driver does not invent one:
// that metric is OMITTED from the result rather than returned as 0, because a
// tank reporting "level 0" that has in fact never reported is worse than no
// reading at all. When no metric of a device has a value, Read returns
// devices.ErrUnreachable and says whether the device has never been heard from
// or has gone quiet — MQTT gives no way to poll it and ask.
//
// A dropped broker link clears the whole cache and Read then returns
// ErrUnreachable for every device: cached values outlive their truth the moment
// the driver stops being able to see updates. Devices report AvailOffline while
// the link is down, never AvailOnline, and Health carries the link state with
// the reason it is in (a fixed vocabulary that cannot leak an address or a
// password).
//
// Config.StaleAfter expires values on age as well. Past it a sample is dropped
// rather than returned: a temperature from six hours ago is not a reading.
package mqtt

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Driver is the MQTT driver. Safe for concurrent use: the device table, the
// route table and the subscription list are built once by New and never
// mutated, and every piece of mutable state — the telemetry cache, the
// confirmation waiters, the link-down signal — is behind one mutex. The broker
// connection has its own lock and is never touched while this driver's mutex is
// held.
type Driver struct {
	id         string
	qos        QoS
	staleAfter time.Duration
	now        func() time.Time
	logf       func(string, ...any)

	// devices, order, routes and subs are read-only after New.
	devices map[string]*device
	order   []string
	routes  []route
	subs    []subFilter

	client *client

	mu      sync.Mutex
	samples map[string]map[string]sample
	// lastMsg is when this device last said anything on any of its topics. It
	// survives a disconnect on purpose: "last heard 40 minutes ago" is true
	// whether or not the broker is currently reachable.
	lastMsg    map[string]time.Time
	waiters    map[int64]*waiter
	nextWaiter int64
	// downSig is closed when the current session ends, so a command waiting for
	// a device's confirmation fails at the drop rather than at its timeout.
	downSig    chan struct{}
	downClosed bool
}

// device is one declared device plus its topic map.
type device struct {
	model devices.Device
	// state is in declared order, so readings come back in a stable order.
	state    []StateTopic
	commands map[devices.Verb]Command
}

// route binds one subscribed filter to one device, and to one metric when the
// topic carries state. A confirm-only topic has an empty metric: it proves the
// device is alive without contributing a reading.
type route struct {
	filter   string
	deviceID string
	metric   string
	text     bool
	field    string
}

// sample is one cached telemetry value.
type sample struct {
	value float64
	text  string
	at    time.Time
}

// waiter is one Execute blocked on a device's own confirmation.
type waiter struct {
	id     int64
	filter string
	want   []byte
	ch     chan struct{}
	done   bool
}

var (
	_ devices.Driver = (*Driver)(nil)
	_ devices.Closer = (*Driver)(nil)
)

// New validates the config, builds the device and route tables, and starts the
// broker connection in the background. Every configuration problem is an error
// here, at hub startup, rather than a surprise at actuation time.
//
// New does not wait for the broker: a hub must come up with an unreachable
// broker, and Health reports the link honestly until it is there. Call Close to
// stop the connection supervisor.
func New(cfg Config) (*Driver, error) {
	cfg.applyDefaults()
	// Refused at startup rather than debugged at actuation time. The rules —
	// no colon, no whitespace, not a reserved name — are properties of the key
	// namespace, so they live with it rather than in a copy per driver.
	if err := devices.ValidateDriverID(cfg.DriverID); err != nil {
		return nil, fmt.Errorf("mqtt: invalid config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}

	d := &Driver{
		id:         cfg.DriverID,
		qos:        cfg.CommandQoS,
		staleAfter: cfg.StaleAfter,
		now:        cfg.Now,
		logf:       cfg.Logf,
		devices:    map[string]*device{},
		samples:    map[string]map[string]sample{},
		lastMsg:    map[string]time.Time{},
		waiters:    map[int64]*waiter{},
		downSig:    make(chan struct{}),
	}

	// Subscription QoS per filter, taking the highest anyone asked for. Two
	// devices sharing a filter must not have one silently downgrade the other.
	subQoS := map[string]byte{}
	for _, dc := range cfg.Devices {
		dev := &device{
			model:    dc.device(),
			state:    append([]StateTopic(nil), dc.State...),
			commands: map[devices.Verb]Command{},
		}
		for _, cmd := range dc.Commands {
			dev.commands[cmd.Verb] = cmd
		}
		d.devices[dc.ID] = dev
		d.order = append(d.order, dc.ID)
		d.samples[dc.ID] = map[string]sample{}

		for _, st := range dc.State {
			d.routes = append(d.routes, route{
				filter: st.Topic, deviceID: dc.ID, metric: st.Metric, text: st.Text, field: st.Field,
			})
			if q, seen := subQoS[st.Topic]; !seen || st.QoS > q {
				subQoS[st.Topic] = st.QoS
			}
		}
		for _, cmd := range dc.Commands {
			if cmd.Confirm == nil {
				continue
			}
			d.routes = append(d.routes, route{filter: cmd.Confirm.Topic, deviceID: dc.ID})
			// Confirmations are subscribed at QoS 1 whatever the state topics
			// asked for: a confirmation the broker dropped would be reported as
			// ErrIndeterminate, which is a false "I don't know" about an action
			// that did happen.
			if subQoS[cmd.Confirm.Topic] < 1 {
				subQoS[cmd.Confirm.Topic] = 1
			}
		}
	}
	sort.Strings(d.order)
	for filter, q := range subQoS {
		d.subs = append(d.subs, subFilter{filter: filter, qos: q})
	}
	sort.Slice(d.subs, func(i, j int) bool { return d.subs[i].filter < d.subs[j].filter })

	d.client = newClient(clientConfig{
		addr:           cfg.BrokerAddr,
		clientID:       cfg.ClientID,
		username:       cfg.Username,
		password:       cfg.Password,
		dial:           cfg.Dial,
		keepAlive:      cfg.KeepAlive,
		connectTimeout: cfg.ConnectTimeout,
		ackTimeout:     cfg.AckTimeout,
		maxPacket:      cfg.MaxPacketBytes,
		reconnectMin:   cfg.ReconnectMin,
		reconnectMax:   cfg.ReconnectMax,
		subs:           d.subs,
		now:            cfg.Now,
		logf:           cfg.Logf,
		onMessage:      d.onMessage,
		onDown:         d.onDown,
		onUp:           d.onUp,
	})
	d.client.start()
	return d, nil
}

func (d *Driver) ID() string { return d.id }

// Discover returns the declared devices annotated with what the driver has
// actually observed. It publishes nothing and subscribes to nothing new.
//
// Availability is deliberately conservative:
//
//	broker link down            -> AvailOffline. Whatever was cached is gone and
//	                               no update can arrive, so nothing may claim to
//	                               be live.
//	link up, never heard from   -> AvailUnknown. Not offline — the device may be
//	                               perfectly healthy and simply silent since the
//	                               driver connected — and certainly not online.
//	link up, heard recently     -> AvailOnline.
//	link up, gone quiet past
//	  Config.StaleAfter         -> AvailOffline, with LastSeen kept.
//
// A successful publish never moves a device to AvailOnline. A PUBACK is
// evidence about the broker; only the device's own messages are evidence about
// the device.
func (d *Driver) Discover(_ context.Context) ([]devices.Device, error) {
	up, _, _ := d.client.state()
	now := d.now()

	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]devices.Device, 0, len(d.order))
	for _, id := range d.order {
		dev := d.devices[id]
		model := dev.model
		model.Capabilities = append([]devices.CapabilityID(nil), dev.model.Capabilities...)
		last := d.lastMsg[id]
		model.LastSeen = last

		switch {
		case !up:
			model.Availability = devices.AvailOffline
			model.Summary = "broker disconnected"
		case last.IsZero():
			model.Availability = devices.AvailUnknown
			if len(dev.state) == 0 {
				model.Summary = "command-only; this device publishes no state"
			} else {
				model.Summary = "no telemetry yet"
			}
		case d.staleAfter > 0 && now.Sub(last) > d.staleAfter:
			model.Availability = devices.AvailOffline
			model.Summary = "no telemetry for " + now.Sub(last).Round(time.Second).String()
		default:
			model.Availability = devices.AvailOnline
			model.Summary = d.summaryLocked(dev, now)
		}
		out = append(out, model)
	}
	return out, nil
}

// summaryLocked builds the console's one-line state from the cache. Purely
// presentational; never parsed.
func (d *Driver) summaryLocked(dev *device, now time.Time) string {
	var parts []string
	for _, st := range dev.state {
		s, ok := d.samples[dev.model.ID][st.Metric]
		if !ok || d.expired(s, now) {
			continue
		}
		if s.text != "" {
			parts = append(parts, s.text)
		} else {
			parts = append(parts, st.Metric+" "+formatNumber(s.value))
		}
		if len(parts) == 3 {
			break
		}
	}
	if len(parts) == 0 {
		return "no current telemetry"
	}
	return strings.Join(parts, " · ")
}

// Execute publishes one verb's command and reports what can honestly be claimed
// about it. The full mapping is the table in the package doc; the two rules
// that drive it are that a publish is not a delivery, and that a delivery to a
// broker is not an action by a device.
func (d *Driver) Execute(ctx context.Context, deviceID string, v devices.Verb, args map[string]float64) error {
	dev, ok := d.devices[deviceID]
	if !ok {
		return devices.ErrUnknownDevice
	}
	// The registry already checked this. Check it again anyway: a driver
	// reachable by another path must not depend on someone else's validation.
	spec, _, ok := dev.model.Supports(v)
	if !ok {
		return devices.ErrUnsupported
	}
	cmd, ok := dev.commands[v]
	if !ok {
		// The capability offers the verb but the operator mapped no topic for
		// it. Publishing to a guessed topic would be inventing the device's
		// protocol, so this is a refusal, not a best effort.
		return fmt.Errorf("mqtt: device %q offers %q but no command topic is configured for it: %w",
			deviceID, v, devices.ErrUnsupported)
	}

	payload, err := renderPayload(cmd.Payload, deviceID, v, spec, args)
	if err != nil {
		return err
	}

	// The waiter is registered BEFORE the publish. A device on the same broker
	// can confirm faster than this function returns, and a confirmation that
	// arrived while we were still setting up would otherwise be missed and
	// reported as ErrIndeterminate.
	var w *waiter
	if cmd.Confirm != nil {
		want, err := renderPayload(cmd.Confirm.Payload, deviceID, v, spec, args)
		if err != nil {
			return err
		}
		w = d.addWaiter(cmd.Confirm.Topic, []byte(want))
		defer d.dropWaiter(w)
	}

	d.mu.Lock()
	down := d.downSig
	d.mu.Unlock()

	res, perr := d.client.publish(ctx, publishMsg{
		topic:   cmd.Topic,
		payload: []byte(payload),
		retain:  cmd.Retain,
	}, d.qos.wire())

	if perr != nil && !res.sent {
		if errors.Is(perr, errProtocol) {
			// The topic and payload were validated at config time, so this is a
			// bug in the driver rather than an operator's problem. Nothing was
			// written either way.
			return fmt.Errorf("mqtt: device %q: %q could not be encoded", deviceID, v)
		}
		return fmt.Errorf("mqtt: device %q: %q was not published (%s): %w",
			deviceID, v, publishFailure(perr), devices.ErrUnreachable)
	}

	// Past this point some bytes left this host, so nothing below may report
	// that the action did not happen.
	if w != nil {
		return d.awaitConfirm(ctx, down, w, deviceID, v, cmd, res)
	}
	if perr != nil {
		return fmt.Errorf("mqtt: device %q: %q was published but %s: %w",
			deviceID, v, publishFailure(perr), devices.ErrIndeterminate)
	}
	if res.brokerAcked && spec.Tier <= devices.TierReversible {
		// The one concession, and it is bounded by the catalogue's tier. See
		// the package doc.
		return nil
	}
	return fmt.Errorf("mqtt: device %q: %q %s, and %s: %w",
		deviceID, v, publishEvidence(res), missingEvidence(spec.Tier), devices.ErrIndeterminate)
}

// awaitConfirm waits for the device to publish the configured confirmation. It
// is the only path in this package that can report success for a verb above
// TierReversible, because it is the only one where the device itself speaks.
func (d *Driver) awaitConfirm(ctx context.Context, down <-chan struct{}, w *waiter,
	deviceID string, v devices.Verb, cmd Command, res publishResult) error {

	wait := cmd.Confirm.Timeout
	if wait <= 0 {
		wait = defaultConfirmWait
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-w.ch:
		return nil
	case <-down:
		return fmt.Errorf("mqtt: device %q: %q %s but the broker link dropped before the device confirmed: %w",
			deviceID, v, publishEvidence(res), devices.ErrIndeterminate)
	case <-ctx.Done():
		return fmt.Errorf("mqtt: device %q: %q %s but the caller's deadline passed before the device confirmed: %w",
			deviceID, v, publishEvidence(res), devices.ErrIndeterminate)
	case <-timer.C:
		return fmt.Errorf("mqtt: device %q: %q %s but the device did not confirm within %s: %w",
			deviceID, v, publishEvidence(res), wait, devices.ErrIndeterminate)
	}
}

// Read answers from the subscription cache. It publishes nothing, so it cannot
// actuate and costs the device nothing.
//
// Its error mapping is deliberately simpler than Execute's: no action is in
// flight, so no outcome can be in doubt and ErrIndeterminate would overstate
// what is unknown. Everything that is not a reading is ErrUnreachable.
func (d *Driver) Read(_ context.Context, deviceID string) ([]devices.Reading, error) {
	dev, ok := d.devices[deviceID]
	if !ok {
		return nil, devices.ErrUnknownDevice
	}
	if len(dev.state) == 0 {
		return nil, fmt.Errorf("mqtt: device %q declares no state topics: %w", deviceID, devices.ErrUnsupported)
	}
	if up, reason, _ := d.client.state(); !up {
		return nil, fmt.Errorf("mqtt: device %q: %s, so nothing can be read: %w",
			deviceID, reason, devices.ErrUnreachable)
	}

	now := d.now()
	d.mu.Lock()
	defer d.mu.Unlock()

	out := make([]devices.Reading, 0, len(dev.state))
	stale := 0
	for _, st := range dev.state {
		s, ok := d.samples[deviceID][st.Metric]
		if !ok {
			// Never published. Omitted rather than reported as zero: see the
			// package doc.
			continue
		}
		if d.expired(s, now) {
			stale++
			continue
		}
		out = append(out, devices.Reading{
			DeviceID: deviceID, Metric: st.Metric, Value: s.value, Text: s.text, At: s.at,
		})
	}
	if len(out) == 0 {
		switch {
		case stale > 0:
			return nil, fmt.Errorf("mqtt: device %q has gone quiet: its last telemetry is older than %s "+
				"and MQTT gives no way to poll it: %w", deviceID, d.staleAfter, devices.ErrUnreachable)
		case !d.lastMsg[deviceID].IsZero():
			return nil, fmt.Errorf("mqtt: device %q has published nothing usable on its state topics, "+
				"so its state is unknown rather than zero: %w", deviceID, devices.ErrUnreachable)
		default:
			return nil, fmt.Errorf("mqtt: device %q has published nothing since the driver connected, "+
				"so its state is unknown rather than zero: %w", deviceID, devices.ErrUnreachable)
		}
	}
	return out, nil
}

// Health reports the broker link. It never touches the network: the client
// keeps its state under a mutex and this reads it.
//
// Detail comes from the client's fixed reason vocabulary, so it can carry
// neither the broker address nor a credential, whatever the failure was.
func (d *Driver) Health(_ context.Context) devices.Health {
	up, reason, since := d.client.state()
	return devices.Health{
		OK: up,
		Detail: fmt.Sprintf("broker link: %s (%d device(s), %d subscription(s), commands at QoS %s)",
			reason, len(d.order), len(d.subs), d.qos),
		Since: since,
	}
}

// Close stops the connection supervisor and drops the link. It is idempotent.
func (d *Driver) Close() error {
	err := d.client.Close()
	d.clearCache("driver closed")
	return err
}

// onUp runs when a session is established and its subscriptions acknowledged.
func (d *Driver) onUp() {
	d.mu.Lock()
	d.downSig = make(chan struct{})
	d.downClosed = false
	d.mu.Unlock()
}

// onDown runs once per lost or failed session.
func (d *Driver) onDown(reason string) { d.clearCache(reason) }

// clearCache drops every cached value and releases anything waiting on a
// confirmation.
//
// Dropping the cache is the point: a value is only true while updates can still
// arrive. Serving the last temperature seen before the broker vanished would
// make a stale number indistinguishable from a live one, which is exactly the
// failure the Availability model exists to prevent. lastMsg survives, because
// "last heard at 14:02" stays true regardless.
func (d *Driver) clearCache(reason string) {
	d.mu.Lock()
	for id := range d.samples {
		d.samples[id] = map[string]sample{}
	}
	if !d.downClosed {
		close(d.downSig)
		d.downClosed = true
	}
	d.mu.Unlock()
	d.logf("mqtt: telemetry cache cleared: %s", reason)
}

// onMessage caches one inbound message. It runs on the client's read loop and
// must not block: it takes one mutex, does no I/O, and logs after releasing it.
func (d *Driver) onMessage(topic string, payload []byte, at time.Time) {
	var logs []string

	d.mu.Lock()
	for _, r := range d.routes {
		if !TopicMatch(r.filter, topic) {
			continue
		}
		// Anything on one of this device's topics is the device speaking, even
		// a confirmation that carries no metric.
		d.lastMsg[r.deviceID] = at
		if r.metric == "" {
			continue
		}
		trimmed := bytes.TrimSpace(payload)
		if len(trimmed) == 0 {
			// An empty payload is MQTT's retained-message delete, and an empty
			// reading is not zero. Forget the value rather than parse it.
			delete(d.samples[r.deviceID], r.metric)
			continue
		}
		// A JSON field selector turns a bridge's per-device object into a
		// single metric. See StateTopic.Field: this is what makes zigbee2mqtt
		// and zwave-js-ui readable, which is most of the Zigbee and Z-Wave
		// hardware anyone actually runs.
		if r.field != "" {
			var doc any
			if err := json.Unmarshal(trimmed, &doc); err != nil {
				logs = append(logs, fmt.Sprintf("mqtt: device %q metric %q: payload is not JSON but a field selector is set; sample dropped",
					r.deviceID, r.metric))
				continue
			}
			got, ok := jsonField(doc, r.field)
			if !ok {
				// A field the bridge did not publish this time is absent, not
				// zero and not stale. Forget rather than guess: zigbee2mqtt
				// omits keys a device has not reported since it joined.
				delete(d.samples[r.deviceID], r.metric)
				continue
			}
			trimmed = got
		}
		if r.text {
			d.samples[r.deviceID][r.metric] = sample{text: string(trimmed), at: at}
			continue
		}
		f, err := strconv.ParseFloat(string(trimmed), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			// A metric declared numeric that arrives unparseable is dropped,
			// never stored as 0. ParseFloat accepts "NaN" and "Inf", so those
			// are refused explicitly.
			logs = append(logs, fmt.Sprintf("mqtt: device %q metric %q: payload is not a finite number; sample dropped",
				r.deviceID, r.metric))
			continue
		}
		d.samples[r.deviceID][r.metric] = sample{value: f, at: at}
	}
	for _, w := range d.waiters {
		if w.done || !TopicMatch(w.filter, topic) || !bytes.Equal(payload, w.want) {
			continue
		}
		w.done = true
		close(w.ch)
	}
	d.mu.Unlock()

	for _, msg := range logs {
		d.logf("%s", msg)
	}
}

func (d *Driver) expired(s sample, now time.Time) bool {
	return d.staleAfter > 0 && now.Sub(s.at) > d.staleAfter
}

func (d *Driver) addWaiter(filter string, want []byte) *waiter {
	w := &waiter{filter: filter, want: want, ch: make(chan struct{})}
	d.mu.Lock()
	d.nextWaiter++
	w.id = d.nextWaiter
	d.waiters[w.id] = w
	d.mu.Unlock()
	return w
}

func (d *Driver) dropWaiter(w *waiter) {
	d.mu.Lock()
	delete(d.waiters, w.id)
	d.mu.Unlock()
}

// renderPayload substitutes a command template's placeholders.
//
// Only a float64 the registry already range-checked is ever substituted, and it
// is formatted as a plain decimal, so no caller-supplied string reaches the
// payload at all.
func renderPayload(tmpl, deviceID string, v devices.Verb, spec devices.VerbSpec, args map[string]float64) (string, error) {
	vars := map[string]string{"verb": string(v), "device": deviceID}
	if spec.Arg != "" {
		val, ok := args[spec.Arg]
		if !ok {
			return "", fmt.Errorf("mqtt: verb %q requires argument %q", v, spec.Arg)
		}
		// NaN slips through the registry's range check — `NaN < Min` and
		// `NaN > Max` are both false — so it has to be refused here.
		if math.IsNaN(val) || math.IsInf(val, 0) {
			return "", fmt.Errorf("mqtt: verb %q argument %q is not a finite number", v, spec.Arg)
		}
		vars[spec.Arg] = formatNumber(val)
	}
	return render(tmpl, vars)
}

// publishFailure turns a client sentinel into short operator-facing text. It
// never quotes the underlying error: a dial or write error routinely contains
// the broker's host and port, and this text reaches a console.
func publishFailure(err error) string {
	switch {
	case errors.Is(err, errNotConnected):
		return "there is no broker link"
	case errors.Is(err, errWriteFailed):
		return "the write to the broker failed before any byte was sent"
	case errors.Is(err, errPartialWrite):
		return "the write to the broker failed mid-packet"
	case errors.Is(err, errAckTimeout):
		return "the broker sent no PUBACK"
	case errors.Is(err, context.DeadlineExceeded):
		return "the deadline passed while waiting for the broker"
	case errors.Is(err, context.Canceled):
		return "the caller cancelled while waiting for the broker"
	}
	return "the publish failed"
}

// publishEvidence states exactly how far the message is known to have got.
func publishEvidence(res publishResult) string {
	if res.brokerAcked {
		return "was accepted by the broker"
	}
	return "was published at QoS 0"
}

// missingEvidence names what is still unproven, in the terms the tier makes
// matter.
func missingEvidence(t devices.Tier) string {
	switch t {
	case devices.TierPhysicalAccess:
		return "nothing confirms the device acted; configure a confirmation topic before treating this as an opened door"
	case devices.TierHazardousMotion:
		return "nothing confirms the device acted; configure a confirmation topic before treating this as motion started or stopped"
	case devices.TierConsequential:
		return "nothing confirms the device acted"
	}
	return "nothing confirms the device received it"
}

// jsonField resolves a dotted path in a decoded JSON document and renders the
// value as the bytes the normal payload path would have received. The grammar
// mirrors httpdev's deliberately: one path syntax in the product, not two.
//
// A bool renders as "1"/"0" so a Zigbee contact sensor publishing
// {"contact":true} can be read as a number, and a string renders as itself so
// {"state":"ON"} works with Text.
func jsonField(doc any, path string) ([]byte, bool) {
	cur := doc
	for _, seg := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = m[seg]
		if !ok {
			return nil, false
		}
	}
	switch v := cur.(type) {
	case string:
		return []byte(v), true
	case float64:
		return []byte(strconv.FormatFloat(v, 'f', -1, 64)), true
	case bool:
		if v {
			return []byte("1"), true
		}
		return []byte("0"), true
	}
	// null, an object or an array is not a reading. Absent beats invented.
	return nil, false
}

// jsonUnmarshal is a thin alias so tests can decode fixtures with the same
// decoder the driver uses.
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
