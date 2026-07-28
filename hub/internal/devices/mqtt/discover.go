package mqtt

// Bridge discovery: reading a device list off zigbee2mqtt or zwave-js-ui
// instead of writing one by hand.
//
// # Why this is the piece that finishes the Zigbee story
//
// The driver can already read Zigbee and Z-Wave hardware — a bridge owns the
// radio and republishes onto MQTT, and StateTopic.Field pulls one metric out of
// the JSON object each device publishes. What it could not do was tell you WHAT
// IS THERE. Every device had to be transcribed by hand: its friendly name, its
// topic, which JSON key carries which metric, one entry at a time, from a web
// UI into a config file. For a house with forty Zigbee devices that is an
// afternoon and a guaranteed typo.
//
// Both bridges already publish exactly the answer. zigbee2mqtt retains a JSON
// array on `zigbee2mqtt/bridge/devices`; zwave-js-ui publishes node information
// under its own prefix. Subscribing and reading it is the whole mechanism.
//
// # What this deliberately does NOT do
//
// It does not write a config file, and it does not add devices to the registry.
//
// A discovered device is a SUGGESTION. The capability a device is given decides
// which verbs the engine will route to it, and a wrong guess there is not a
// cosmetic error — capabilities are how the tier system knows that starting a
// mower's blades is TierHazardousMotion. A bridge's own "definition.exposes"
// metadata is good enough to propose `light.switch` for something it calls a
// light, and nowhere near good enough to be trusted unreviewed for anything
// that moves.
//
// So this returns candidates with their evidence attached, and a human decides.
// The alternative — auto-registering whatever a bridge announces — means an
// operator's device list changes because someone paired a new bulb, which is
// the kind of surprise that has no place in a system that also opens gates.
//
// # Read-only, and safe to run against a live bridge
//
// Discovery subscribes and reads. It publishes nothing except the subscription
// itself, never touches a bridge's `/set` topics, and never asks a bridge to
// permit joining. Turning on pairing is an actuation with a real security
// consequence — it is how a device gets onto the network — and it is not
// something a discovery routine should be able to do as a side effect.

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// DefaultDiscoveryWindow is how long Scan listens before reporting.
//
// Both bridges publish their device list RETAINED, so a subscribing client
// receives it immediately rather than waiting for a change. The window exists
// for the broker to deliver it and for slower bridges to answer at all — not as
// a polling interval.
const DefaultDiscoveryWindow = 5 * time.Second

// KnownBridges are the topic prefixes Scan subscribes to, in the spelling the
// bridges themselves use.
//
// Subscribing is not the same as understanding. See parseableBridges.
var KnownBridges = []string{"zigbee2mqtt", "zwave-js-ui"}

// parseableBridges are the bridges whose announcement format this scanner can
// actually decode.
//
// Only zigbee2mqtt. parseAnnouncement decodes ONE shape — the retained JSON
// array of devices with `friendly_name` / `ieee_address` / `definition.exposes`
// that zigbee2mqtt publishes on `<prefix>/bridge/devices`. zwave-js-ui does not
// publish that, so its devices are configured by topic like any other MQTT
// device rather than discovered.
//
// This distinction exists because reporting zwave-js-ui as SILENT was worse
// than reporting nothing. Silent means "we asked correctly and it did not
// answer", which sends an operator to check whether their bridge is running.
// The truth is that we cannot read its format whatever it publishes, and that
// is a different thing to go and fix.
var parseableBridges = map[string]bool{"zigbee2mqtt": true}

// Candidate is one device a bridge announced.
//
// It is deliberately not a devices.Device. A Device carries capabilities, and
// capabilities decide which verbs the engine will route — that is a decision a
// person makes, not one a bridge announcement is allowed to make for them.
type Candidate struct {
	// Bridge is the topic prefix this came from, e.g. "zigbee2mqtt".
	Bridge string
	// Topic is where this device's state is published — the value that would
	// become StateTopic.Topic.
	Topic string
	// Name is the bridge's friendly name, which is what an operator named it in
	// the bridge's own UI and therefore what they will recognise.
	Name string
	// Model and Vendor are free text from the bridge, carried through verbatim
	// because they are how a human identifies a device they cannot see.
	Model  string
	Vendor string
	// Fields are the JSON keys the bridge says this device exposes, sorted. Each
	// is a candidate StateTopic.Field.
	Fields []string
	// SuggestedKind is a GUESS from the bridge's own metadata, and is empty when
	// nothing in the announcement supports one. It is never a capability: see
	// the package comment for why proposing a capability would be a different
	// and much worse thing to get wrong.
	SuggestedKind devices.Kind
	// Raw is the announcement as received, so an operator can see exactly what
	// the suggestion was derived from rather than trusting it.
	Raw string
}

// ScanResult is what one discovery pass found.
type ScanResult struct {
	Candidates []Candidate
	// BridgesSeen are the prefixes that actually answered. A prefix that was
	// subscribed to and stayed silent is reported in BridgesSilent instead —
	// "no devices" and "no bridge" are different answers and an operator
	// debugging an empty result needs to know which they got.
	BridgesSeen   []string
	BridgesSilent []string
	// BridgesUnreadable are known bridges this scanner subscribes to but whose
	// announcement format it cannot decode — a third answer that used to be
	// reported as the second. "Did not answer" and "answered in a language we
	// do not speak" send an operator to different places.
	BridgesUnreadable []string
	// Notes carries anything that was skipped and why, so a device missing from
	// the result is explained rather than merely absent.
	Notes []string
}

// Scan subscribes to the known bridge announcement topics and reports what they
// publish, then unsubscribes by disconnecting.
//
// It uses its own short-lived client rather than the driver's, so discovery
// cannot disturb a running fleet's subscriptions or its keepalive.
func Scan(ctx context.Context, cfg Config, window time.Duration) (ScanResult, error) {
	if window <= 0 {
		window = DefaultDiscoveryWindow
	}
	// A discovery client must not collide with the driver's session: brokers
	// evict an existing session when a second connects with the same client id,
	// which would drop a live fleet's subscriptions to run a scan.
	cfg.ClientID = cfg.ClientID + "-discover"
	cfg.Devices = nil

	res := ScanResult{}
	seen := map[string]bool{}
	byTopic := map[string]Candidate{}

	// The callback runs on the client's READ GOROUTINE, so everything it
	// touches is shared. Guarding it is not defensive: without this, the
	// collection below races the delivery of a retained message that arrives
	// while the window is closing, which is exactly when a real broker delivers
	// one.
	var mu sync.Mutex

	c, err := newDiscoveryClient(cfg, func(topic string, payload []byte) {
		bridge, ok := bridgeOf(topic)
		if !ok {
			return
		}
		cands, notes := parseAnnouncement(bridge, payload)
		mu.Lock()
		defer mu.Unlock()
		seen[bridge] = true
		res.Notes = append(res.Notes, notes...)
		for _, cd := range cands {
			byTopic[cd.Topic] = cd
		}
	})
	if err != nil {
		return res, err
	}

	runErr := c.run(ctx, window)
	// Close BEFORE reading, not in a defer. A deferred close would run after
	// the collection below and leave the read loop live while it ran.
	c.close()
	if runErr != nil {
		return res, runErr
	}

	mu.Lock()
	defer mu.Unlock()

	for _, b := range KnownBridges {
		switch {
		case seen[b]:
			res.BridgesSeen = append(res.BridgesSeen, b)
		case !parseableBridges[b]:
			// Not silent — unreadable. Saying "silent" would send an operator
			// to debug a bridge that is working perfectly well.
			res.BridgesUnreadable = append(res.BridgesUnreadable, b)
			res.Notes = append(res.Notes, b+": discovery cannot read this bridge's "+
				"announcement format, so its devices are not listed here. They are still "+
				"reachable — configure them by topic like any other MQTT device.")
		default:
			res.BridgesSilent = append(res.BridgesSilent, b)
		}
	}
	for _, cd := range byTopic {
		res.Candidates = append(res.Candidates, cd)
	}
	sort.Slice(res.Candidates, func(i, j int) bool {
		return res.Candidates[i].Topic < res.Candidates[j].Topic
	})
	return res, nil
}

func bridgeOf(topic string) (string, bool) {
	for _, b := range KnownBridges {
		if strings.HasPrefix(topic, b+"/") {
			return b, true
		}
	}
	return "", false
}

// z2mDevice is the subset of zigbee2mqtt's bridge/devices entry this reads.
//
// Deliberately partial. The full object is large and version-dependent, and
// decoding only what is used means a bridge upgrade that adds fields cannot
// break discovery.
type z2mDevice struct {
	FriendlyName string `json:"friendly_name"`
	IEEEAddress  string `json:"ieee_address"`
	Type         string `json:"type"`
	Supported    bool   `json:"supported"`
	Definition   *struct {
		Model       string `json:"model"`
		Vendor      string `json:"vendor"`
		Description string `json:"description"`
		Exposes     []struct {
			Type     string `json:"type"`
			Name     string `json:"name"`
			Property string `json:"property"`
			Features []struct {
				Name     string `json:"name"`
				Property string `json:"property"`
			} `json:"features"`
		} `json:"exposes"`
	} `json:"definition"`
}

func parseAnnouncement(bridge string, payload []byte) ([]Candidate, []string) {
	var devs []z2mDevice
	if err := json.Unmarshal(payload, &devs); err != nil {
		return nil, []string{fmt.Sprintf(
			"%s: announcement was not a JSON array of devices; nothing discovered from it", bridge)}
	}

	var out []Candidate
	var notes []string
	for _, d := range devs {
		name := strings.TrimSpace(d.FriendlyName)
		if name == "" {
			continue
		}
		// The bridge itself appears in its own device list. It is a coordinator,
		// not a device anyone wants in their fleet.
		if strings.EqualFold(d.Type, "Coordinator") || strings.EqualFold(name, "Coordinator") {
			continue
		}
		// An unsupported device still publishes SOMETHING, but the bridge is
		// saying it has no definition for it — so there is no reliable field
		// list and any suggestion would be invented. Report it as a note rather
		// than as a candidate with made-up metadata.
		if !d.Supported {
			notes = append(notes, fmt.Sprintf(
				"%s/%s: the bridge reports it as unsupported, so it exposes no known "+
					"fields; add it by hand after checking what it actually publishes",
				bridge, name))
			continue
		}

		cd := Candidate{
			Bridge: bridge,
			Topic:  bridge + "/" + name,
			Name:   name,
			Raw:    string(payload),
		}
		if d.Definition != nil {
			cd.Model = d.Definition.Model
			cd.Vendor = d.Definition.Vendor
			cd.Fields = exposedFields(d)
			cd.SuggestedKind = suggestKind(d)
		}
		out = append(out, cd)
	}
	return out, notes
}

// exposedFields flattens the bridge's `exposes` tree into the JSON keys a
// StateTopic.Field would name.
func exposedFields(d z2mDevice) []string {
	set := map[string]bool{}
	for _, e := range d.Definition.Exposes {
		if e.Property != "" {
			set[e.Property] = true
		}
		for _, f := range e.Features {
			if f.Property != "" {
				set[f.Property] = true
			}
		}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// suggestKind proposes a devices.Kind from the bridge's own vocabulary.
//
// A SUGGESTION, and only for kinds where being wrong is harmless. There is
// deliberately no path here that proposes KindAccess: a bridge calling
// something a lock is not a reason for this hub to treat it as one, and access
// devices are the one kind where a wrong guess reaches the tier system.
func suggestKind(d z2mDevice) devices.Kind {
	if d.Definition == nil {
		return ""
	}
	for _, e := range d.Definition.Exposes {
		switch strings.ToLower(e.Type) {
		case "light":
			return devices.KindLighting
		case "climate":
			return devices.KindClimate
		case "switch":
			// A "switch" is a relay of unknown purpose — it could be a lamp or
			// it could be a pump. Lighting is the harmless reading, and the
			// operator reviews it either way.
			return devices.KindLighting
		}
	}
	fields := exposedFields(d)
	for _, f := range fields {
		switch f {
		case "temperature", "humidity", "occupancy", "contact", "illuminance", "battery":
			return devices.KindSensor
		case "power", "energy", "current", "voltage":
			return devices.KindEnergy
		}
	}
	return ""
}

// SuggestedConfig renders a candidate as the DeviceConfig an operator would
// otherwise type, ready to paste into the device config file after review.
//
// The ID is derived from the friendly name rather than the IEEE address,
// because the friendly name is what the operator chose and will recognise —
// and because a device that is re-paired keeps its name and gets a new address,
// which would otherwise silently orphan its history.
func (c Candidate) SuggestedConfig() DeviceConfig {
	dc := DeviceConfig{
		ID:   slug(c.Name),
		Name: c.Name,
		Kind: c.SuggestedKind,
	}
	for _, f := range c.Fields {
		dc.State = append(dc.State, StateTopic{
			Topic:  c.Topic,
			Metric: f,
			Field:  f,
			// Text for the fields that are genuinely words rather than numbers.
			// Guessing wrong here costs a dropped sample and a log line, not a
			// wrong reading — parse failures are refused, never coerced.
			Text: f == "state" || f == "action" || f == "last_seen",
		})
	}
	return dc
}

func slug(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '_' || r == '/' || r == '.':
			b.WriteRune('-')
		case r == '-':
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// ── the short-lived client discovery runs on ────────────────────────────────

// discoveryClient wraps the ordinary client with a lifetime bounded by the scan
// window rather than by the driver.
type discoveryClient struct {
	c *client
}

func newDiscoveryClient(cfg Config, onMsg func(topic string, payload []byte)) (*discoveryClient, error) {
	cfg.applyDefaults()

	// One filter per bridge rather than a single `#`. Subscribing to everything
	// on a shared broker means receiving every retained message on it — which on
	// a busy broker is a lot of traffic for no benefit, and on a broker carrying
	// other people's data is a privacy problem this has no reason to create.
	subs := make([]subFilter, 0, len(KnownBridges))
	for _, b := range KnownBridges {
		subs = append(subs, subFilter{filter: b + "/bridge/devices", qos: 0})
	}

	c := newClient(clientConfig{
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
		subs:           subs,
		now:            cfg.Now,
		logf:           cfg.Logf,
		onMessage: func(topic string, payload []byte, _ time.Time) {
			onMsg(topic, payload)
		},
		onDown: func(string) {},
		onUp:   func() {},
	})
	return &discoveryClient{c: c}, nil
}

// run connects, listens for the window, and returns.
//
// It does NOT fail when the broker is unreachable within the window: a scan
// that found nothing because the broker was down is reported through
// BridgesSilent and the caller's own error handling, not as a partial result
// dressed up as success. The distinction that matters — "no bridge answered"
// versus "a bridge answered with no devices" — is in ScanResult either way.
func (d *discoveryClient) run(ctx context.Context, window time.Duration) error {
	d.c.start()
	t := time.NewTimer(window)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (d *discoveryClient) close() { _ = d.c.Close() }
