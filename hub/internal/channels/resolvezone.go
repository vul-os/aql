package channels

import (
	"sort"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Zone resolution: when one message means every device in a place.
//
// # Why this is separate from ResolveDevice, and why it demands more
//
// ResolveDevice scores a zone word DELIBERATELY BELOW THE FLOOR — "a hint about
// which devices are plausible, never an identification of one" — so "turn off
// the exterior lights" is answered with the candidates rather than acted on.
// That is the right answer to an ambiguous singular, and this file does not
// change it.
//
// What it adds is a narrower case. A member who writes "turn off ALL the
// exterior lights" has not been ambiguous: they have said, in the message, that
// they mean more than one. The quantifier is the whole discriminator. Without
// one this resolver returns nothing and the member gets the same picker they
// get today.
//
// That line matters because the failure mode is asymmetric. Reading a plural
// noun as a group command would silently convert every existing ambiguity into
// an actuation of N devices — the member asked a question and N things moved.
// Requiring an explicit quantifier means a zone command can only be produced by
// a member who wrote one, so the widened blast radius is never inferred.
//
// English plurals are NOT quantifiers here. "lights" is how people name a
// single fixture ("the kitchen lights") at least as often as a set, and a
// resolver that cannot tell those apart would be guessing at exactly the point
// where guessing multiplies.

// zoneQuantifiers are the words that make a body a group command.
//
// Kept short and literal on purpose. Every addition widens what one message can
// move, so this is a list to argue about rather than a pattern to be clever
// with — "both" is absent because it asserts a count this does not check, and
// "any" is absent because it is a question in most sentences that contain it.
var zoneQuantifiers = []string{"all", "every", "everything"}

// ZoneMatch is the outcome of resolving a body against the fleet's zones.
//
// Mirrors DeviceMatch's shape for the same reason DeviceMatch mirrors
// GateMatch: the rails already branch on Unique/Ambiguous/None, and a third
// shape would be a third set of branches to get wrong.
type ZoneMatch struct {
	Outcome MatchOutcome
	// Zone is the zone's name as the DEVICES spell it, not as the member typed
	// it, so a reply quoting it reads the way the console does.
	Zone string
	// Members are the eligible devices in that zone, ordered by key so a reply
	// listing them and a test asserting on them agree every time.
	Members []devices.IndexedDevice
	// Candidates carries the zone names that tied, so an ambiguous outcome can
	// name them. Devices are not listed here: the member's problem is which
	// PLACE they meant.
	Candidates []string
	Verb       devices.Verb
}

func (m ZoneMatch) Unique() bool    { return m.Outcome == MatchUnique }
func (m ZoneMatch) Ambiguous() bool { return m.Outcome == MatchAmbiguous }

// ResolveZone picks the one zone a body asks EVERY member of, or reports that
// it cannot.
//
// fleet must already be scoped to what the caller may see — like ResolveDevice
// this does no authorization and must never be handed the whole registry.
//
// Callers must try ResolveDevice FIRST and only fall here when it did not
// resolve uniquely. That ordering is what keeps a device NAMED for a place from
// being swallowed by the place: "Exterior Lights" scores on its name, above the
// floor, so ResolveDevice claims it and this is never reached. Without the
// ordering the two would race, and the device — the more specific reading —
// would be the one that lost.
func ResolveZone(body string, verb devices.Verb, fleet []devices.IndexedDevice) ZoneMatch {
	m := ZoneMatch{Verb: verb}

	// Stage 0. The quantifier, before anything else. No quantifier, no group
	// command, whatever else the body contains.
	if !hasZoneQuantifier(body) {
		m.Outcome = MatchNone
		return m
	}

	// Stage 1. Capability, not name — the same first stage as ResolveDevice.
	// A device that cannot do the verb is not a member of the group being
	// addressed, so it neither joins the fan-out nor makes its zone eligible.
	byZone := map[string][]devices.IndexedDevice{}
	for _, d := range fleet {
		if !deviceExposes(d, verb) {
			continue
		}
		z := strings.TrimSpace(d.Device.Zone)
		if z == "" {
			continue
		}
		k := strings.ToLower(z)
		byZone[k] = append(byZone[k], d)
	}
	if len(byZone) == 0 {
		m.Outcome = MatchNone
		return m
	}

	// Stage 2. Which zone was named. Word-phrase matching, the same test
	// scoreDevice applies to a zone word, so "shed" matches the Shed and does
	// not match "Sheds Annex" by substring.
	var named []string
	for k := range byZone {
		if wordPhraseIn(strings.ToLower(strings.TrimSpace(body)), k) {
			named = append(named, k)
		}
	}
	// Deterministic before anything branches on the count: two zones matching
	// must produce the same message every time, not one ordered by however the
	// map happened to enumerate.
	sort.Strings(named)

	switch len(named) {
	case 0:
		// A quantifier and no zone. "Turn off everything" is a real sentence
		// and this deliberately does NOT answer it — a fleet-wide command has a
		// blast radius no zone does, and nothing in the body limits it.
		m.Outcome = MatchNone
		return m
	case 1:
	default:
		// Two zones named. The member wrote both words; this does not pick.
		m.Outcome = MatchAmbiguous
		for _, k := range named {
			m.Candidates = append(m.Candidates, displayZone(byZone[k]))
		}
		return m
	}

	members := byZone[named[0]]
	sort.Slice(members, func(i, j int) bool { return members[i].Key < members[j].Key })

	// A "group" of one is not a group. Falling through to MatchNone hands the
	// member back to ResolveDevice's answer, which for a sole zone match is the
	// floor refusing to identify a device from a place word — the property
	// TestASoleZoneMatchIsStillBelowTheFloor pins. Fanning out over one device
	// here would route around that floor by way of the word "all", which is
	// precisely the collapse the floor exists to prevent.
	if len(members) < 2 {
		m.Outcome = MatchNone
		return m
	}

	m.Outcome = MatchUnique
	m.Zone = displayZone(members)
	m.Members = members
	return m
}

// hasZoneQuantifier reports whether the body contains one of the words that
// makes it a group command, on word boundaries.
//
// The boundary is load-bearing: without it "install" contains "all", and every
// message mentioning a wall, a hallway or a ball would silently become a
// fan-out.
func hasZoneQuantifier(body string) bool {
	b := strings.ToLower(strings.TrimSpace(body))
	for _, q := range zoneQuantifiers {
		if wordPhraseIn(b, q) {
			return true
		}
	}
	return false
}

// displayZone returns the zone's name as its devices spell it.
//
// Devices in one zone can disagree on case, so this takes the spelling of the
// lowest key rather than whichever the map yielded — the same determinism rule
// the rest of this file follows, for the same reason.
func displayZone(members []devices.IndexedDevice) string {
	best := ""
	bestKey := ""
	for _, d := range members {
		if best == "" || d.Key < bestKey {
			best, bestKey = strings.TrimSpace(d.Device.Zone), d.Key
		}
	}
	return best
}
