package channels

import (
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// zoneFleet is two lamps in one zone, one lamp in another, and a device that
// cannot do the verb sitting in the first zone.
//
// The fourth device is the one that makes several of these tests mean
// something: a zone whose membership is filtered by capability reads
// identically to one that is not, unless the zone CONTAINS something the verb
// does not apply to.
func zoneFleet(t *testing.T) []devices.IndexedDevice {
	t.Helper()
	lightCap := capWithVerb(t, devices.VerbOn)
	openCap := capWithVerb(t, devices.VerbOpen)
	return []devices.IndexedDevice{
		dev("test:shed-a", "Workbench Lamp", "Shed", devices.KindLighting, lightCap),
		dev("test:shed-b", "Corner Lamp", "Shed", devices.KindLighting, lightCap),
		dev("test:shed-door", "Shed Door", "Shed", devices.KindAccess, openCap),
		dev("test:hall", "Hall Lamp", "Hallway", devices.KindLighting, lightCap),
	}
}

// THE property. Everything else in this file is detail; this is the reason zone
// resolution is allowed to exist at all.
//
// Without an explicit quantifier a body must never produce a zone command, or
// every ambiguity ResolveDevice answers with a picker today silently becomes an
// actuation of N devices. The member asked a question and N things moved.
func TestWithoutAQuantifierNothingEverFansOut(t *testing.T) {
	fleet := zoneFleet(t)
	for _, body := range []string{
		"turn on the shed",
		// The plural specifically. This is the reading that is tempting and
		// wrong: "the kitchen lights" is how people name ONE fixture.
		"turn on the shed lights",
		"turn on the shed lamps",
		"shed",
		"turn on the lights in the shed",
	} {
		m := ResolveZone(body, devices.VerbOn, fleet)
		if m.Outcome != MatchNone {
			t.Errorf("%q produced a zone command (%v, zone %q) with no quantifier in it",
				body, m.Outcome, m.Zone)
		}
	}
}

// The word boundary on the quantifier, isolated.
//
// "all" is a substring of a great many ordinary words, and a substring test
// here would turn "install", "wall", "hallway" and "ball" into fan-out
// triggers. "hallway" is the dangerous one — it is also a zone name in this
// fleet, so a substring bug would make every message mentioning the hallway a
// group command against it.
func TestAQuantifierMustBeAWordNotASubstring(t *testing.T) {
	fleet := zoneFleet(t)
	for _, body := range []string{
		"install the shed lamps",
		"the shed is by the wall",
		"turn on the hallway lamps and the shed lamps",
	} {
		if hasZoneQuantifier(body) {
			t.Errorf("%q counted as carrying a quantifier", body)
		}
		if m := ResolveZone(body, devices.VerbOn, fleet); m.Outcome != MatchNone {
			t.Errorf("%q fanned out on a substring of a quantifier", body)
		}
	}
}

func TestAQuantifierAndAZoneFansOutOverExactlyTheEligibleMembers(t *testing.T) {
	fleet := zoneFleet(t)
	for _, body := range []string{
		"turn on all the shed lamps",
		"turn on every lamp in the shed",
	} {
		m := ResolveZone(body, devices.VerbOn, fleet)
		if !m.Unique() {
			t.Fatalf("%q did not resolve a zone: %v", body, m.Outcome)
		}
		if m.Zone != "Shed" {
			t.Errorf("%q resolved zone %q, want Shed", body, m.Zone)
		}
		var keys []string
		for _, d := range m.Members {
			keys = append(keys, d.Key)
		}
		// The shed door is in the Shed and cannot be turned on. It must not be
		// a member: a device that does not offer the verb is not part of the
		// group being addressed.
		if len(keys) != 2 || keys[0] != "test:shed-a" || keys[1] != "test:shed-b" {
			t.Errorf("%q fanned out over %v, want the two lamps in key order", body, keys)
		}
	}
}

// A zone whose only eligible member is one device is NOT a group, and must not
// resolve.
//
// This is the rule that keeps zone resolution from routing around the floor
// TestASoleZoneMatchIsStillBelowTheFloor pins. That floor says a place word
// alone may not identify a device; if "all" were enough to fan out over a
// single-member zone, the same actuation the floor refuses would be reachable
// by adding one word.
func TestASingleMemberZoneIsNotAGroup(t *testing.T) {
	fleet := zoneFleet(t)
	m := ResolveZone("turn on all the hallway lamps", devices.VerbOn, fleet)
	if m.Outcome != MatchNone {
		t.Errorf("a one-device zone resolved as a group (%v, members %d) — this is the floor's job to refuse",
			m.Outcome, len(m.Members))
	}
}

// A quantifier with no zone named is not a fleet-wide command.
//
// "Turn off everything" is a real sentence and this deliberately does not
// answer it: nothing in the body bounds what it would move.
func TestAQuantifierAloneIsNotAFleetWideCommand(t *testing.T) {
	fleet := zoneFleet(t)
	for _, body := range []string{"turn on everything", "turn on all of them", "turn everything on"} {
		if m := ResolveZone(body, devices.VerbOn, fleet); m.Outcome != MatchNone {
			t.Errorf("%q resolved to zone %q with %d members — an unbounded command was answered",
				body, m.Zone, len(m.Members))
		}
	}
}

func TestTwoZonesNamedIsAmbiguousAndNamesBoth(t *testing.T) {
	fleet := append(zoneFleet(t),
		dev("test:hall-b", "Hall Sconce", "Hallway", devices.KindLighting, capWithVerb(t, devices.VerbOn)))
	m := ResolveZone("turn on all the shed and hallway lamps", devices.VerbOn, fleet)
	if !m.Ambiguous() {
		t.Fatalf("two zones named resolved %v (zone %q) instead of asking", m.Outcome, m.Zone)
	}
	if len(m.Candidates) != 2 {
		t.Fatalf("offered %d candidates, want both zones: %v", len(m.Candidates), m.Candidates)
	}
	// Sorted, so the message is the same every run rather than ordered by
	// however the zone map happened to enumerate.
	if m.Candidates[0] != "Hallway" || m.Candidates[1] != "Shed" {
		t.Errorf("candidates %v are not the two zones in a stable order", m.Candidates)
	}
	if len(m.Members) != 0 {
		t.Errorf("an ambiguous zone match carried %d members — nothing may be staged to actuate", len(m.Members))
	}
}

// Map iteration order must not reach the outcome. Zone membership is built in a
// map, and both the "which zone" decision and the ambiguity list are derived
// from it.
func TestZoneResolutionDoesNotDependOnMapOrder(t *testing.T) {
	fleet := zoneFleet(t)
	first := ResolveZone("turn on all the shed lamps", devices.VerbOn, fleet)
	for i := 0; i < 50; i++ {
		got := ResolveZone("turn on all the shed lamps", devices.VerbOn, fleet)
		if got.Outcome != first.Outcome || got.Zone != first.Zone || len(got.Members) != len(first.Members) {
			t.Fatalf("run %d differed: %v/%q/%d vs %v/%q/%d",
				i, got.Outcome, got.Zone, len(got.Members), first.Outcome, first.Zone, len(first.Members))
		}
		for j := range got.Members {
			if got.Members[j].Key != first.Members[j].Key {
				t.Fatalf("run %d ordered members differently: %s vs %s",
					i, got.Members[j].Key, first.Members[j].Key)
			}
		}
	}
}

// A zone with no member offering the verb does not resolve, even named with a
// quantifier — the same first stage ResolveDevice applies.
func TestAZoneWithNothingOfferingTheVerbDoesNotResolve(t *testing.T) {
	fleet := zoneFleet(t)
	// Nothing in the fleet can be opened except the shed door, and one device
	// is not a group.
	if m := ResolveZone("open all the shed doors", devices.VerbOpen, fleet); m.Outcome != MatchNone {
		t.Errorf("resolved %v for a verb only one device offers", m.Outcome)
	}
	// And a verb nothing offers at all.
	if m := ResolveZone("lock all the shed doors", devices.VerbLock, fleet); m.Outcome != MatchNone {
		t.Errorf("resolved %v for a verb no device offers", m.Outcome)
	}
}

// Devices with no zone are never swept into one.
func TestUnzonedDevicesAreNeverMembers(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{
		dev("test:shed-a", "Workbench Lamp", "Shed", devices.KindLighting, lightCap),
		dev("test:shed-b", "Corner Lamp", "Shed", devices.KindLighting, lightCap),
		dev("test:loose", "Spare Lamp", "", devices.KindLighting, lightCap),
	}
	m := ResolveZone("turn on all the shed lamps", devices.VerbOn, fleet)
	if !m.Unique() {
		t.Fatalf("did not resolve: %v", m.Outcome)
	}
	for _, d := range m.Members {
		if d.Key == "test:loose" {
			t.Error("a device with no zone was included in a zone fan-out")
		}
	}
	if len(m.Members) != 2 {
		t.Errorf("fanned out over %d devices, want the 2 in the Shed", len(m.Members))
	}
}

// The empty zone must never be a zone one can NAME, and the reason is sharper
// than it looks.
//
// wordPhraseIn(body, "") is not false. With an empty phrase the scan matches at
// any position whose neighbours are not word bytes, so it returns TRUE for any
// body ending in punctuation or a space. Group every unzoned device under the
// key "" and "turn off everything." — with the full stop — would name that
// group and fan out across every device in the fleet that has not been given a
// zone. On a real hub that is most of them shortly after setup.
//
// So the `z == ""` skip is load-bearing, not defensive tidiness, and this test
// exists because tampering found the rest of the file blind to removing it:
// every other case here uses a fleet where every device has a zone, and a body
// with no trailing punctuation.
//
// The sibling guard is in scoreDevice, which tests `z != ""` before the same
// call for the same reason.
func TestTheEmptyZoneIsNotAZoneThatCanBeNamed(t *testing.T) {
	lightCap := capWithVerb(t, devices.VerbOn)
	fleet := []devices.IndexedDevice{
		dev("test:a", "Spare Lamp", "", devices.KindLighting, lightCap),
		dev("test:b", "Other Lamp", "", devices.KindLighting, lightCap),
		dev("test:c", "Third Lamp", "", devices.KindLighting, lightCap),
	}
	// Trailing punctuation and trailing space are the two shapes that make an
	// empty phrase match. Both must still refuse.
	for _, body := range []string{
		"turn on everything.",
		"turn on everything!",
		"turn on all of it ",
		"turn on everything",
	} {
		m := ResolveZone(body, devices.VerbOn, fleet)
		if m.Outcome != MatchNone {
			t.Errorf("%q named the empty zone and fanned out over %d unzoned devices",
				body, len(m.Members))
		}
	}
}
