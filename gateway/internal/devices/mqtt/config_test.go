package mqtt

import (
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// New is the only place a configuration problem can be caught cheaply: after
// this, the next opportunity is a resident pressing a button. Every case below
// is a config New must refuse.
func TestNewRefusesBadConfig(t *testing.T) {
	base := func(devs ...DeviceConfig) Config {
		return Config{BrokerAddr: "b:1883", CommandQoS: QoSAtMostOnce,
			Dial: newFakeBroker().dial, Devices: devs}
	}
	lamp := func(mutate func(*DeviceConfig)) DeviceConfig {
		dc := lampDevice()
		mutate(&dc)
		return dc
	}

	cases := []struct {
		name string
		cfg  Config
		want string
	}{
		{"no broker address", func() Config { c := base(lampDevice()); c.BrokerAddr = ""; return c }(),
			"broker address is empty"},
		{"QoS not chosen", func() Config { c := base(lampDevice()); c.CommandQoS = QoSUnset; return c }(),
			"CommandQoS is unset"},
		{"driver id with a colon", func() Config { c := base(lampDevice()); c.DriverID = "mqtt:plantroom"; return c }(),
			"must not contain ':'"},
		{"driver id with whitespace", func() Config { c := base(lampDevice()); c.DriverID = "mqtt hub"; return c }(),
			"must not contain ':'"},
		{"duplicate device", base(lampDevice(), lampDevice()), "declared twice"},
		{"no id", base(lamp(func(dc *DeviceConfig) { dc.ID = "" })), "device id is empty"},
		{"unknown kind", base(lamp(func(dc *DeviceConfig) { dc.Kind = "toaster" })), "unknown kind"},
		{"no capabilities", base(lamp(func(dc *DeviceConfig) { dc.Capabilities = nil })), "declares no capabilities"},
		{"uncatalogued capability", base(lamp(func(dc *DeviceConfig) {
			dc.Capabilities = []devices.CapabilityID{"light.strobe"}
		})), "uncatalogued capability"},
		{"verb outside the device's capabilities", base(lamp(func(dc *DeviceConfig) {
			dc.Commands = append(dc.Commands, Command{Verb: devices.VerbUnlock, Topic: "x", Payload: "y"})
		})), "not offered by its capabilities"},
		{"verb outside the catalogue entirely", base(lamp(func(dc *DeviceConfig) {
			dc.Commands = append(dc.Commands, Command{Verb: "detonate", Topic: "x", Payload: "y"})
		})), "not offered by its capabilities"},
		{"verb mapped twice", base(lamp(func(dc *DeviceConfig) {
			dc.Commands = append(dc.Commands, Command{Verb: devices.VerbOn, Topic: "x", Payload: "y"})
		})), "mapped twice"},
		{"command topic with a wildcard", base(lamp(func(dc *DeviceConfig) {
			dc.Commands[0].Topic = "home/+/cmd"
		})), "contains a wildcard"},
		{"empty command topic", base(lamp(func(dc *DeviceConfig) { dc.Commands[0].Topic = "" })), "empty topic"},
		{"state filter with a misplaced #", base(lamp(func(dc *DeviceConfig) {
			dc.State[0].Topic = "home/#/level"
		})), "before the last level"},
		{"state filter with a partial +", base(lamp(func(dc *DeviceConfig) {
			dc.State[0].Topic = "home/lamp+/level"
		})), "inside a level"},
		{"state topic with no metric", base(lamp(func(dc *DeviceConfig) { dc.State[0].Metric = "" })), "has no metric"},
		{"metric declared twice", base(lamp(func(dc *DeviceConfig) {
			dc.State[1].Metric = dc.State[0].Metric
		})), "declared twice"},
		{"subscription QoS 2", base(lamp(func(dc *DeviceConfig) { dc.State[0].QoS = 2 })), "not implemented"},
		{"template never uses the argument", base(lamp(func(dc *DeviceConfig) {
			dc.Commands[2].Payload = "set"
		})), "never uses {{level}}"},
		{"template uses an unknown placeholder", base(lamp(func(dc *DeviceConfig) {
			dc.Commands[2].Payload = "{{level}} {{secret}}"
		})), "unknown placeholder"},
		{"unterminated placeholder", base(lamp(func(dc *DeviceConfig) {
			dc.Commands[2].Payload = "{{level"
		})), "unterminated placeholder"},
		{"confirm topic is invalid", base(lamp(func(dc *DeviceConfig) {
			dc.Commands[0].Confirm = &Confirm{Topic: "a/#/b", Payload: "ok"}
		})), "confirm topic"},
		{"confirm payload uses an unknown placeholder", base(lamp(func(dc *DeviceConfig) {
			dc.Commands[0].Confirm = &Confirm{Topic: "a/b", Payload: "{{nope}}"}
		})), "confirm payload"},
		// The catalogue's rule is that stopping is never riskier than starting.
		// A config offering a hazardous verb with no mapped inverse would give a
		// resident a start button and no stop button.
		{"hazardous verb without its inverse mapped", base(DeviceConfig{
			ID: "mower-1", Kind: devices.KindRobot, Name: "Mower",
			Capabilities: []devices.CapabilityID{devices.CapBladeJob},
			Commands:     []Command{{Verb: devices.VerbStart, Topic: "m/cmd", Payload: "START"}},
		}), `inverse "stop" is not mapped`},
		{"physical-access verb without its inverse mapped", base(DeviceConfig{
			ID: "gate-1", Kind: devices.KindAccess, Name: "Gate",
			Capabilities: []devices.CapabilityID{devices.CapBarrier},
			Commands:     []Command{{Verb: devices.VerbOpen, Topic: "g/cmd", Payload: "OPEN"}},
		}), `inverse "close" is not mapped`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, err := New(tc.cfg)
			if err == nil {
				_ = d.Close()
				t.Fatalf("config was accepted; want a refusal mentioning %q", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestConfigReportsEveryProblemAtOnce(t *testing.T) {
	dc := lampDevice()
	dc.Kind = "toaster"
	dc.Commands[0].Topic = "home/+/cmd"
	_, err := New(Config{BrokerAddr: "b:1883", CommandQoS: QoSAtMostOnce, Dial: newFakeBroker().dial,
		Devices: []DeviceConfig{dc}})
	if err == nil {
		t.Fatal("bad config accepted")
	}
	// An operator editing a device map wants the whole list, not the first line.
	if !strings.Contains(err.Error(), "unknown kind") || !strings.Contains(err.Error(), "wildcard") {
		t.Fatalf("only some problems reported: %v", err)
	}
}

func TestDefaultsAreApplied(t *testing.T) {
	b := newFakeBroker()
	d := startDriver(t, Config{BrokerAddr: "b:1883", CommandQoS: QoSAtMostOnce, Dial: b.dial,
		Devices: []DeviceConfig{lampDevice()}})
	if d.ID() != "mqtt" {
		t.Fatalf("driver id = %q, want the mqtt default", d.ID())
	}
	waitUp(t, d)
	b.mu.Lock()
	rec := b.connects[0]
	b.mu.Unlock()
	if rec.clientID != defaultClientID {
		t.Fatalf("client id = %q, want %q", rec.clientID, defaultClientID)
	}
	if rec.keepAlive != uint16(defaultKeepAlive/time.Second) {
		t.Fatalf("keepalive = %d, want %v", rec.keepAlive, defaultKeepAlive/time.Second)
	}
}

func TestQoSStringAndWire(t *testing.T) {
	if QoSUnset.String() != "unset" || QoSAtMostOnce.String() != "0" || QoSAtLeastOnce.String() != "1" {
		t.Fatal("QoS does not render as its wire number")
	}
	if QoSAtMostOnce.wire() != 0 || QoSAtLeastOnce.wire() != 1 {
		t.Fatal("QoS wire value is wrong")
	}
}

// --- the topic grammar the whole config rests on.

func TestValidateTopicAndFilter(t *testing.T) {
	for _, bad := range []string{"", "a/+/b", "a/#", "a\x00b"} {
		if err := ValidateTopic(bad); err == nil {
			t.Fatalf("ValidateTopic(%q) accepted a topic that cannot be published to", bad)
		}
	}
	for _, good := range []string{"a", "a/b/c", "$SYS/broker/uptime"} {
		if err := ValidateTopic(good); err != nil {
			t.Fatalf("ValidateTopic(%q) = %v", good, err)
		}
	}
	for _, bad := range []string{"", "a/#/b", "a/b+/c", "a/#b"} {
		if err := ValidateFilter(bad); err == nil {
			t.Fatalf("ValidateFilter(%q) accepted a malformed filter", bad)
		}
	}
	for _, good := range []string{"a/+/c", "a/#", "#", "+"} {
		if err := ValidateFilter(good); err != nil {
			t.Fatalf("ValidateFilter(%q) = %v", good, err)
		}
	}
}

func TestTopicMatch(t *testing.T) {
	cases := []struct {
		filter, topic string
		want          bool
	}{
		{"a/b", "a/b", true},
		{"a/b", "a/c", false},
		{"a/+/c", "a/b/c", true},
		{"a/+/c", "a/b/d", false},
		{"a/+", "a/b/c", false},
		{"a/#", "a/b/c", true},
		{"a/#", "a", true},
		{"#", "a/b", true},
		// A '#' or '+' at the first level must not reach the broker's own tree:
		// a config saying "#" should not quietly subscribe to $SYS.
		{"#", "$SYS/uptime", false},
		{"+/uptime", "$SYS/uptime", false},
		{"$SYS/#", "$SYS/uptime", true},
	}
	for _, tc := range cases {
		if got := TopicMatch(tc.filter, tc.topic); got != tc.want {
			t.Fatalf("TopicMatch(%q, %q) = %v, want %v", tc.filter, tc.topic, got, tc.want)
		}
	}
}

// A filter that two devices share must be subscribed once, at the highest QoS
// anyone asked for: one device's QoS 0 must not silently downgrade another's.
func TestSharedFilterKeepsTheHighestQoS(t *testing.T) {
	a := lampDevice()
	bDev := lampDevice()
	bDev.ID = "lamp-2"
	bDev.State = []StateTopic{{Metric: "level", Topic: "home/lamp1/level", QoS: 0}}
	bDev.Commands = nil

	_, b, _ := newConnected(t, a, bDev)
	for _, f := range b.subscriptions() {
		if f.filter == "home/lamp1/level" && f.qos != 1 {
			t.Fatalf("shared filter subscribed at QoS %d, want 1", f.qos)
		}
	}
	if got := len(b.subscriptions()); got != 2 {
		t.Fatalf("subscribed to %d filters, want 2 (the shared one deduplicated)", got)
	}
}
