package mqtt

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// A real zigbee2mqtt bridge/devices payload, trimmed to the fields this reads.
// Taken from the shape the bridge actually publishes, so a change in what it
// sends breaks this test rather than a house full of devices.
const z2mAnnouncement = `[
  {"friendly_name":"Coordinator","ieee_address":"0x001","type":"Coordinator","supported":false},
  {"friendly_name":"Kitchen lamp","ieee_address":"0x002","type":"Router","supported":true,
   "definition":{"model":"LED1836G9","vendor":"IKEA","description":"TRADFRI bulb E27",
     "exposes":[{"type":"light","features":[
        {"name":"state","property":"state"},
        {"name":"brightness","property":"brightness"}]},
       {"type":"numeric","name":"linkquality","property":"linkquality"}]}},
  {"friendly_name":"Front door","ieee_address":"0x003","type":"EndDevice","supported":true,
   "definition":{"model":"MCCGQ11LM","vendor":"Aqara","description":"Door sensor",
     "exposes":[{"type":"binary","name":"contact","property":"contact"},
       {"type":"numeric","name":"battery","property":"battery"}]}},
  {"friendly_name":"Mystery thing","ieee_address":"0x004","type":"EndDevice","supported":false}
]`

func TestScanReadsARealBridgeAnnouncement(t *testing.T) {
	b := newFakeBroker()
	cfg := Config{
		BrokerAddr: "broker:1883", ClientID: "aql", CommandQoS: QoSAtLeastOnce,
		Dial: b.dial, Logf: func(string, ...any) {},
	}

	done := make(chan ScanResult, 1)
	go func() {
		res, err := Scan(context.Background(), cfg, 400*time.Millisecond)
		if err != nil {
			t.Errorf("Scan: %v", err)
		}
		done <- res
	}()

	// Give the client time to connect and subscribe, then deliver the retained
	// announcement the way a broker would.
	time.Sleep(120 * time.Millisecond)
	b.push(t, "zigbee2mqtt/bridge/devices", z2mAnnouncement, 0)

	res := <-done

	if len(res.Candidates) != 2 {
		t.Fatalf("got %d candidates, want 2: %+v", len(res.Candidates), res.Candidates)
	}

	byName := map[string]Candidate{}
	for _, c := range res.Candidates {
		byName[c.Name] = c
	}

	lamp, ok := byName["Kitchen lamp"]
	if !ok {
		t.Fatal("the lamp was not discovered")
	}
	if lamp.Topic != "zigbee2mqtt/Kitchen lamp" {
		t.Errorf("topic = %q", lamp.Topic)
	}
	if lamp.Vendor != "IKEA" || lamp.Model != "LED1836G9" {
		t.Errorf("vendor/model = %q/%q", lamp.Vendor, lamp.Model)
	}
	// The nested `features` are where the useful fields live; a parser that
	// only read top-level `property` would find linkquality and nothing else.
	if got := strings.Join(lamp.Fields, ","); got != "brightness,linkquality,state" {
		t.Errorf("fields = %q, want the nested feature properties too", got)
	}
	if lamp.SuggestedKind != devices.KindLighting {
		t.Errorf("suggested kind = %q, want lighting", lamp.SuggestedKind)
	}

	door := byName["Front door"]
	if door.SuggestedKind != devices.KindSensor {
		t.Errorf("door suggested kind = %q, want sensor", door.SuggestedKind)
	}
}

// The bridge lists itself. A coordinator is not a device anyone wants in their
// fleet, and it has no state topic to read.
func TestTheCoordinatorIsNotADevice(t *testing.T) {
	cands, _ := parseAnnouncement("zigbee2mqtt", []byte(z2mAnnouncement))
	for _, c := range cands {
		if strings.EqualFold(c.Name, "Coordinator") {
			t.Fatal("the coordinator was offered as a device")
		}
	}
}

// An unsupported device is REPORTED, not silently dropped and not invented.
// The bridge is saying it has no definition, so any field list would be made
// up — but a device missing from the result with no explanation sends someone
// hunting through a bridge UI for a bug that is not there.
func TestUnsupportedDevicesAreExplainedRatherThanDropped(t *testing.T) {
	cands, notes := parseAnnouncement("zigbee2mqtt", []byte(z2mAnnouncement))
	for _, c := range cands {
		if c.Name == "Mystery thing" {
			t.Fatal("an unsupported device was offered with invented metadata")
		}
	}
	var found bool
	for _, n := range notes {
		if strings.Contains(n, "Mystery thing") {
			found = true
		}
	}
	if !found {
		t.Error("an unsupported device vanished with no note; there is nothing " +
			"to tell an operator why it is missing")
	}
}

// Discovery must never propose a capability, and above all never an access
// one. Capabilities decide which verbs the engine routes, and that is the
// mechanism the tier system rests on.
func TestDiscoveryProposesNoCapabilitiesAndNeverAccess(t *testing.T) {
	cands, _ := parseAnnouncement("zigbee2mqtt", []byte(z2mAnnouncement))
	for _, c := range cands {
		dc := c.SuggestedConfig()
		if len(dc.Capabilities) != 0 {
			t.Errorf("%s: discovery proposed capabilities %v; that decision is a "+
				"human's, because it is what the tier gate reads", c.Name, dc.Capabilities)
		}
		if c.SuggestedKind == devices.KindAccess {
			t.Errorf("%s: discovery proposed the access kind", c.Name)
		}
	}
}

// A suggestion has to be usable: the rendered config must be the thing an
// operator would otherwise have typed, and it must survive validation.
func TestSuggestedConfigIsWhatAnOperatorWouldHaveTyped(t *testing.T) {
	cands, _ := parseAnnouncement("zigbee2mqtt", []byte(z2mAnnouncement))
	var lamp Candidate
	for _, c := range cands {
		if c.Name == "Kitchen lamp" {
			lamp = c
		}
	}
	dc := lamp.SuggestedConfig()
	if dc.ID != "kitchen-lamp" {
		t.Errorf("id = %q, want a slug of the friendly name", dc.ID)
	}
	if len(dc.State) != 3 {
		t.Fatalf("got %d state topics, want one per exposed field", len(dc.State))
	}
	for _, st := range dc.State {
		if st.Topic != lamp.Topic {
			t.Errorf("state topic points at %q, not the device's topic", st.Topic)
		}
		if st.Field == "" {
			t.Errorf("metric %q has no JSON field selector, so it would try to "+
				"parse the whole object as a number", st.Metric)
		}
		// `state` is "ON"/"OFF" — a number parse would drop every sample.
		if st.Metric == "state" && !st.Text {
			t.Error("the state field was not marked as text")
		}
		if st.Metric == "brightness" && st.Text {
			t.Error("brightness was marked as text; it is a number")
		}
	}
}

// A silent bridge and a bridge with no devices are different answers, and an
// operator debugging an empty result needs to know which they got.
func TestTheThreeAnswersADiscoveryPassCanGive(t *testing.T) {
	// "No devices", "no bridge" and "a bridge we cannot read" are three
	// different things, and an operator debugging an empty result is sent to a
	// different place by each.
	//
	// The third used to be reported as the second. zwave-js-ui was listed as
	// SILENT, which means "we asked correctly and it did not answer" — so the
	// honest reading was to go and check whether the bridge was running. In
	// fact parseAnnouncement decodes only zigbee2mqtt's array shape, so that
	// bridge could have been publishing perfectly and would still never appear.
	b := newFakeBroker()
	cfg := Config{
		BrokerAddr: "broker:1883", ClientID: "aql", CommandQoS: QoSAtLeastOnce,
		Dial: b.dial, Logf: func(string, ...any) {},
	}

	done := make(chan ScanResult, 1)
	go func() {
		res, _ := Scan(context.Background(), cfg, 400*time.Millisecond)
		done <- res
	}()
	time.Sleep(120 * time.Millisecond)
	// zigbee2mqtt answers, with an empty list: a bridge that is running and has
	// nothing paired.
	b.push(t, "zigbee2mqtt/bridge/devices", `[]`, 0)

	res := <-done

	if len(res.BridgesSeen) != 1 || res.BridgesSeen[0] != "zigbee2mqtt" {
		t.Errorf("BridgesSeen = %v, want the one that answered", res.BridgesSeen)
	}
	if len(res.BridgesSilent) != 0 {
		t.Errorf("BridgesSilent = %v; nothing here was asked in a language it speaks "+
			"and then stayed quiet", res.BridgesSilent)
	}
	if len(res.BridgesUnreadable) != 1 || res.BridgesUnreadable[0] != "zwave-js-ui" {
		t.Errorf("BridgesUnreadable = %v, want zwave-js-ui — its format is not decoded, "+
			"which is not the same as it being absent", res.BridgesUnreadable)
	}
	// And the operator is told what to do instead, rather than left with a gap.
	var explained bool
	for _, n := range res.Notes {
		if strings.Contains(n, "zwave-js-ui") && strings.Contains(n, "configure them by topic") {
			explained = true
		}
	}
	if !explained {
		t.Errorf("no note explains the unreadable bridge: %v", res.Notes)
	}
}

// A bridge that CAN be read and simply did not answer is still silent — the
// distinction above must not have collapsed the other way.
func TestAParseableBridgeThatSaysNothingIsSilent(t *testing.T) {
	b := newFakeBroker()
	cfg := Config{
		BrokerAddr: "broker:1883", ClientID: "aql", CommandQoS: QoSAtLeastOnce,
		Dial: b.dial, Logf: func(string, ...any) {},
	}

	done := make(chan ScanResult, 1)
	go func() {
		res, _ := Scan(context.Background(), cfg, 300*time.Millisecond)
		done <- res
	}()
	res := <-done

	if len(res.BridgesSeen) != 0 {
		t.Errorf("BridgesSeen = %v, want none", res.BridgesSeen)
	}
	if len(res.BridgesSilent) != 1 || res.BridgesSilent[0] != "zigbee2mqtt" {
		t.Errorf("BridgesSilent = %v, want zigbee2mqtt — it is readable and said nothing",
			res.BridgesSilent)
	}
}

// Discovery must not evict the driver's own session. Brokers drop an existing
// session when a second connects with the same client id, so a scan sharing the
// id would silently unsubscribe a live fleet.
func TestScanUsesItsOwnClientID(t *testing.T) {
	b := newFakeBroker()
	cfg := Config{
		BrokerAddr: "broker:1883", ClientID: "aql-hub", CommandQoS: QoSAtLeastOnce,
		Dial: b.dial, Logf: func(string, ...any) {},
	}
	go func() { _, _ = Scan(context.Background(), cfg, 200*time.Millisecond) }()
	time.Sleep(150 * time.Millisecond)

	var ids []string
	b.set(func(f *fakeBroker) {
		for _, c := range f.connects {
			ids = append(ids, c.clientID)
		}
	})
	if len(ids) == 0 {
		t.Fatal("the scan never connected")
	}
	for _, id := range ids {
		if id == "aql-hub" {
			t.Fatal("the scan connected with the driver's client id; a real broker " +
				"would have evicted the driver's session and unsubscribed the fleet")
		}
	}
}

// A malformed announcement must be reported, never guessed at.
func TestAMalformedAnnouncementIsANoteNotAGuess(t *testing.T) {
	cands, notes := parseAnnouncement("zigbee2mqtt", []byte(`{"not":"an array"}`))
	if len(cands) != 0 {
		t.Errorf("got %d candidates from an unparseable payload", len(cands))
	}
	if len(notes) == 0 {
		t.Error("an unparseable announcement produced no explanation")
	}
}
