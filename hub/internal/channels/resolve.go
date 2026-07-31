package channels

import (
	"sort"
	"strings"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Resolving "turn on the porch light" to one device — docs/CHAT-COMMANDS.md
// §2.3, stages 1 and 3.
//
// # Why this is careful out of proportion to its size
//
// Gate resolution can afford to be simple because every candidate is the same
// kind of thing: a body naming no gate, on a one-gate household, means that
// gate. The engine fleet is heterogeneous. "Open the gate" against a fleet
// holding `Gate Lock` (capability `access.barrier`) and `Front Gate Camera`
// (capability `camera.*`) has two name matches and one real candidate, and
// picking by slice order picks a camera half the time.
//
// The failure mode is not "no result". It is the WRONG device actuated, with a
// success message naming the one the member asked for. §2.3 is explicit: "a
// tie, a near-tie, or an all-below-floor set is ambiguous — and ambiguous means
// ask, never guess."
//
// # Stage 1 is the load-bearing one
//
// Verb-first filtering: drop every device whose capabilities do not expose the
// verb, before looking at names at all. §2.3 calls it "the single largest
// reduction available and it is free", and it is also the only stage that is
// CORRECT rather than merely helpful — a device that cannot do the thing is not
// a worse match for it, it is not a match. Scoring alone would rank the camera
// against "open" and rely on the margin to reject it.
//
// # What this does not do yet
//
// Stages 2 (scope narrowing), 4 (the discriminating question), 5 (groups) and 6
// (selection context) are not built. Nothing here actuates: the only consumer
// today is the refusal reply, which names what it understood. That order is
// deliberate — a resolver whose failure is "actuates the wrong device" should
// be wrong in public, in a message that changes nothing, before it is wrong at
// a relay.

// Score ranks, from §2.3 stage 3's table. Named rather than inline so the
// margin rule below reads against them.
const (
	scoreExactName     = 100
	scoreTokensInOrder = 80
	scoreSubstring     = 40
	scoreZoneOrKind    = 20

	// scoreFloor is the lowest score that may be accepted at all. A device
	// matched only on its zone or kind ("the light" against three lights in
	// "Lighting") is not identified, and taking it would be first-match with
	// extra steps.
	scoreFloor = scoreSubstring

	// scoreMargin is how far the winner must beat the runner-up. Two devices
	// matched the same way are a tie whatever their absolute score, and §2.3
	// forbids breaking one by recency or by "the one you used last time":
	// convenience heuristics are how the wrong door opens.
	scoreMargin = 20
)

// DeviceMatch is the outcome of resolving a body against the fleet. It mirrors
// GateMatch deliberately: the rails already branch on Unique/Ambiguous/None for
// gates, and a second shape would mean a second set of branches to get wrong.
type DeviceMatch struct {
	Outcome    MatchOutcome
	Device     devices.IndexedDevice
	Candidates []devices.IndexedDevice
	// Verb is what the body asked for. Set even when nothing resolved, so a
	// refusal can name the verb the member used.
	Verb devices.Verb
}

func (m DeviceMatch) Unique() bool    { return m.Outcome == MatchUnique }
func (m DeviceMatch) Ambiguous() bool { return m.Outcome == MatchAmbiguous }

// ResolveDevice picks the one device a body asks for, or reports that it
// cannot.
//
// fleet must already be scoped to what the caller may see — this function does
// no authorization and must never be handed the whole registry.
func ResolveDevice(body string, verb devices.Verb, fleet []devices.IndexedDevice) DeviceMatch {
	m := DeviceMatch{Verb: verb}

	// Stage 1. Capability, not name.
	eligible := make([]devices.IndexedDevice, 0, len(fleet))
	for _, d := range fleet {
		if deviceExposes(d, verb) {
			eligible = append(eligible, d)
		}
	}
	if len(eligible) == 0 {
		m.Outcome = MatchNone
		return m
	}

	// Stage 3. Score what survived.
	var ranked []scoredDevice
	for _, d := range eligible {
		if n := scoreDevice(body, d); n > 0 {
			ranked = append(ranked, scoredDevice{d, n})
		}
	}
	if len(ranked) == 0 {
		// Nothing named. NOT "the only eligible one" — that collapse is
		// defensible for a one-gate household asking to open a gate, and is not
		// defensible for a fleet, where the single eligible device may be
		// nothing like what was meant.
		m.Outcome = MatchNone
		return m
	}

	// Deterministic before the margin is applied: equal scores must not be
	// ordered by however the registry happened to enumerate, or "ambiguous"
	// would depend on map iteration.
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].n != ranked[j].n {
			return ranked[i].n > ranked[j].n
		}
		return ranked[i].dev.Key < ranked[j].dev.Key
	})

	top := ranked[0]
	if top.n < scoreFloor {
		m.Outcome = MatchAmbiguous
		m.Candidates = devicesOf(ranked)
		return m
	}
	if len(ranked) > 1 && top.n-ranked[1].n < scoreMargin {
		m.Outcome = MatchAmbiguous
		// Only the candidates that are actually close. Listing a
		// zone-word match beside two exact ties would ask the member to choose
		// between things the resolver already knows are not equals.
		m.Candidates = devicesOf(closeTo(ranked, top.n))
		return m
	}
	m.Outcome = MatchUnique
	m.Device = top.dev
	return m
}

// scoredDevice is one candidate and its rank. Package-level so the helpers
// below can take it — a function-local type would force every helper inline,
// and the margin logic is the part that most needs to be read on its own.
type scoredDevice struct {
	dev devices.IndexedDevice
	n   int
}

func devicesOf(ranked []scoredDevice) []devices.IndexedDevice {
	out := make([]devices.IndexedDevice, 0, len(ranked))
	for _, r := range ranked {
		out = append(out, r.dev)
	}
	return out
}

// closeTo returns the candidates within the margin of the top score — the ones
// genuinely tied. A candidate the resolver already ranks well below the winner
// is not a thing the member should be asked to choose between.
func closeTo(ranked []scoredDevice, top int) []scoredDevice {
	out := make([]scoredDevice, 0, len(ranked))
	for _, r := range ranked {
		if top-r.n < scoreMargin {
			out = append(out, r)
		}
	}
	return out
}

// deviceExposes reports whether any of a device's capabilities carries the
// verb, per the catalogue.
//
// The catalogue is consulted rather than the device: a driver names its
// capabilities and the catalogue names their verbs, so a driver cannot widen
// what it is eligible for by claiming a verb.
func deviceExposes(d devices.IndexedDevice, v devices.Verb) bool {
	for _, cap := range d.Device.Capabilities {
		if _, ok := devices.Lookup(cap, v); ok {
			return true
		}
	}
	return false
}

// scoreDevice ranks one device against a body. 0 means no signal at all.
func scoreDevice(body string, d devices.IndexedDevice) int {
	b := strings.ToLower(strings.TrimSpace(body))
	name := strings.ToLower(strings.TrimSpace(d.Device.Name))
	if name == "" {
		return 0
	}
	switch {
	case b == name:
		return scoreExactName
	case tokensAppearInOrder(b, name):
		return scoreTokensInOrder
	case textIncludesName(b, d.Device.Name):
		return scoreSubstring
	}
	// Zone or kind only. Deliberately below the floor: it is a hint about
	// which devices are plausible, never an identification of one.
	if z := strings.ToLower(d.Device.Zone); z != "" && wordPhraseIn(b, z) {
		return scoreZoneOrKind
	}
	if k := strings.ToLower(string(d.Device.Kind)); k != "" && wordPhraseIn(b, k) {
		return scoreZoneOrKind
	}
	return 0
}

// tokensAppearInOrder reports whether every word of the name appears in the
// body, in the name's order, on word boundaries.
//
// "turn on the porch light" against "Porch Light" matches; "light porch" does
// not, because a fleet with both "Porch Light" and "Light Porch" would
// otherwise score them identically and the margin rule would call an ambiguity
// that is not one.
func tokensAppearInOrder(body, name string) bool {
	nameWords := fields(name)
	if len(nameWords) == 0 {
		return false
	}
	bodyWords := fields(body)
	i := 0
	for _, w := range bodyWords {
		if w == nameWords[i] {
			i++
			if i == len(nameWords) {
				return true
			}
		}
	}
	return false
}
