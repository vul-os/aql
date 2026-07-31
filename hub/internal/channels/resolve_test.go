package channels

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

func dev(key, name, zone string, kind devices.Kind, caps ...devices.CapabilityID) devices.IndexedDevice {
	return devices.IndexedDevice{
		Key:    key,
		Driver: "test",
		Device: devices.Device{
			ID: key, Name: name, Zone: zone, Kind: kind, Capabilities: caps,
		},
	}
}

// A fleet with the shape §2.3 uses as its worked example: a name collision
// across two devices that do completely different things.
func mixedFleet(t *testing.T) []devices.IndexedDevice {
	t.Helper()
	lightCap := capWithVerb(t, devices.VerbOn)
	return []devices.IndexedDevice{
		dev("test:cam1", "Front Gate Camera", "Perimeter", devices.KindCamera, camCap(t)),
		dev("test:l1", "Porch Light", "Exterior", devices.KindLighting, lightCap),
		dev("test:l2", "Garden Light", "Exterior", devices.KindLighting, lightCap),
	}
}

// capWithVerb finds a real catalogue capability exposing a verb, so the tests
// score against the shipped catalogue rather than an invented one. A fixture
// capability would let this suite pass while the real catalogue disagreed.
func capWithVerb(t *testing.T, v devices.Verb) devices.CapabilityID {
	t.Helper()
	for _, c := range devices.Capabilities() {
		if _, ok := devices.Lookup(c, v); ok {
			return c
		}
	}
	t.Fatalf("no catalogue capability exposes %q", v)
	return ""
}

// camCap returns a capability that does NOT expose `on` — the point of the
// stage-1 test is that such a device is excluded before names are considered.
func camCap(t *testing.T) devices.CapabilityID {
	t.Helper()
	for _, c := range devices.Capabilities() {
		if _, ok := devices.Lookup(c, devices.VerbOn); ok {
			continue
		}
		return c
	}
	t.Fatal("every capability exposes `on` — the fixture assumption is wrong")
	return ""
}

// Stage 1: a device that cannot do the thing is not a worse match for it, it is
// not a match. Without this the camera scores on "front gate" and the margin
// rule has to save the day.
func TestVerbFilteringExcludesDevicesThatCannotDoIt(t *testing.T) {
	fleet := mixedFleet(t)
	m := ResolveDevice("turn on the front gate camera", devices.VerbOn, fleet)
	if m.Unique() {
		t.Errorf("resolved %q for a verb it does not expose", m.Device.Device.Name)
	}
	if m.Outcome != MatchNone {
		t.Errorf("outcome %v, want none — nothing eligible was named", m.Outcome)
	}
}

func TestAnExactlyNamedDeviceResolves(t *testing.T) {
	fleet := mixedFleet(t)
	for _, body := range []string{"porch light", "turn on the porch light", "switch on porch light"} {
		m := ResolveDevice(body, devices.VerbOn, fleet)
		if !m.Unique() {
			t.Errorf("%q did not resolve: outcome=%v candidates=%d", body, m.Outcome, len(m.Candidates))
			continue
		}
		if m.Device.Device.Name != "Porch Light" {
			t.Errorf("%q resolved %q", body, m.Device.Device.Name)
		}
	}
}

// The rule that matters most. Two devices matched the same way are a tie, and
// §2.3 forbids breaking one at all — not by order, not by recency.
func TestATieIsAmbiguousAndNeverBroken(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{
		dev("test:a", "Garden Light", "Exterior", devices.KindLighting, lightCap),
		dev("test:b", "Garden Light", "Interior", devices.KindLighting, lightCap),
	}
	m := ResolveDevice("turn on the garden light", devices.VerbOn, fleet)
	if !m.Ambiguous() {
		t.Fatalf("a tie resolved to %q — the wrong device would have been actuated", m.Device.Device.Name)
	}
	if len(m.Candidates) != 2 {
		t.Errorf("candidates: %d, want both", len(m.Candidates))
	}
}

// And the tie must not depend on enumeration order — the registry is a map.
func TestResolutionDoesNotDependOnFleetOrder(t *testing.T) {
	fleet := mixedFleet(t)
	reversed := make([]devices.IndexedDevice, len(fleet))
	for i, d := range fleet {
		reversed[len(fleet)-1-i] = d
	}
	a := ResolveDevice("turn on the light", devices.VerbOn, fleet)
	b := ResolveDevice("turn on the light", devices.VerbOn, reversed)
	if a.Outcome != b.Outcome {
		t.Errorf("outcome depends on order: %v vs %v", a.Outcome, b.Outcome)
	}
	if a.Unique() && a.Device.Key != b.Device.Key {
		t.Errorf("resolved device depends on order: %q vs %q", a.Device.Key, b.Device.Key)
	}
}

// A zone or kind word is a hint, not an identification. "The light" against two
// lights must ask, and it must not silently take one because it was eligible.
func TestAZoneOrKindWordAloneNeverResolves(t *testing.T) {
	fleet := mixedFleet(t)
	for _, body := range []string{"turn on the light", "turn on exterior", "turn on the lighting"} {
		m := ResolveDevice(body, devices.VerbOn, fleet)
		if m.Unique() {
			t.Errorf("%q resolved %q on a zone/kind word alone", body, m.Device.Device.Name)
		}
	}
}

// The floor, isolated. The margin rule hides it whenever two devices tie on a
// zone word, so the case that actually exercises the floor is ONE device
// matching on its zone or kind and nothing else — there is no runner-up, so the
// margin never engages and only the floor stands between "you said shed" and
// actuating the one thing in the shed.
//
// Found by tampering: removing the floor entirely left every other test green.
func TestASoleZoneMatchIsStillBelowTheFloor(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{
		dev("test:shed", "Workbench Lamp", "Shed", devices.KindLighting, lightCap),
		dev("test:hall", "Hall Lamp", "Hallway", devices.KindLighting, lightCap),
	}
	// "shed" matches exactly one device, on its zone, and nothing else.
	m := ResolveDevice("turn on the shed", devices.VerbOn, fleet)
	if m.Unique() {
		t.Errorf("resolved %q from a zone word with no competitor — the floor is not holding",
			m.Device.Device.Name)
	}
	if m.Outcome != MatchAmbiguous {
		t.Errorf("outcome %v, want ambiguous — a zone hint is not an identification", m.Outcome)
	}
}

// A single eligible device is still not a licence to guess. This is the one
// collapse the gate path DOES make ("one gate, one household"), and it is wrong
// for a fleet: the only dimmable light in the house is not necessarily the one
// meant by "turn on the thing in the shed".
func TestOneEligibleDeviceIsStillNotAMatchForAnUnnamedBody(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{dev("test:only", "Porch Light", "Exterior", devices.KindLighting, lightCap)}
	if m := ResolveDevice("turn on the thing in the shed", devices.VerbOn, fleet); m.Unique() {
		t.Errorf("resolved %q from a body that named nothing", m.Device.Device.Name)
	}
}

// An empty or capability-less fleet resolves nothing rather than panicking or
// picking.
func TestAnEmptyFleetResolvesNothing(t *testing.T) {
	if m := ResolveDevice("turn on the porch light", devices.VerbOn, nil); m.Unique() {
		t.Error("resolved a device from an empty fleet")
	}
	fleet := []devices.IndexedDevice{dev("test:x", "Porch Light", "Exterior", devices.KindLighting)}
	if m := ResolveDevice("porch light", devices.VerbOn, fleet); m.Unique() {
		t.Error("resolved a device with no capabilities at all")
	}
}

// A device whose name is a prefix of another's must not tie with it. "Porch
// Light" and "Porch Light Two" both contain "porch light"; only the exact one
// wins, and the margin is what separates them.
func TestAPrefixNameDoesNotTieWithTheExactOne(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{
		dev("test:a", "Porch Light", "Exterior", devices.KindLighting, lightCap),
		dev("test:b", "Porch Light Two", "Exterior", devices.KindLighting, lightCap),
	}
	m := ResolveDevice("porch light", devices.VerbOn, fleet)
	if !m.Unique() || m.Device.Device.Name != "Porch Light" {
		t.Errorf("outcome=%v device=%q — the exact name should win by the margin", m.Outcome, m.Device.Device.Name)
	}
}

// The refusal must stay a refusal. Naming the device makes it legible; it must
// never read as though something happened.
func TestTheResolvingRefusalStillRefuses(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{dev("test:l1", "Porch Light", "Exterior", devices.KindLighting, lightCap)}

	got := UnsupportedVerbReplyFor(ResolveDevice("turn on the porch light", devices.VerbOn, fleet), testPortal)
	if !strings.Contains(got, "I can only open and close gates") {
		t.Errorf("no longer refuses: %q", got)
	}
	if !strings.Contains(got, "Porch Light") {
		t.Errorf("does not name the device it understood: %q", got)
	}
	if !strings.Contains(got, "Exterior") {
		t.Errorf("does not name the zone, which is what disambiguates duplicates: %q", got)
	}
	// The words that would make it read as success.
	for _, bad := range []string{"Turning on", "Switching on", "done", "OK,"} {
		if strings.Contains(got, bad) {
			t.Errorf("reads as actuation (%q): %q", bad, got)
		}
	}
}

// An ambiguity is stated. A member who thinks they named one device and named
// three should learn it here, in a message that changes nothing, rather than
// the first time it matters.
func TestTheResolvingRefusalReportsAnAmbiguity(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{
		dev("test:a", "Garden Light", "Exterior", devices.KindLighting, lightCap),
		dev("test:b", "Garden Light", "Interior", devices.KindLighting, lightCap),
	}
	got := UnsupportedVerbReplyFor(ResolveDevice("turn on the garden light", devices.VerbOn, fleet), testPortal)
	if !strings.Contains(got, "matches 2 devices") {
		t.Errorf("ambiguity not stated: %q", got)
	}
	if !strings.Contains(got, "I can only open and close gates") {
		t.Errorf("no longer refuses: %q", got)
	}
}

// Nothing resolved falls back to the copy that shipped before any of this.
func TestTheResolvingRefusalFallsBackCleanly(t *testing.T) {
	got := UnsupportedVerbReplyFor(ResolveDevice("turn on something", devices.VerbOn, nil), testPortal)
	if !strings.Contains(got, "Lights, climate and the rest are in the console") {
		t.Errorf("unresolved reply lost its original copy: %q", got)
	}
}
