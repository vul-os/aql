package devices

import "sort"

// Tier is a verb's safety class. It is assigned HERE, by this package, from the
// (capability, verb) pair — never parsed from a message, never supplied by a
// driver, never carried on the wire. A device that could name its own tier
// could name T0.
//
// The ladder is docs/CHAT-COMMANDS.md §3. Its two load-bearing rules:
//
//   - Stopping is never riskier than starting. Every hazardous verb MUST have
//     an inverse at TierReversible or below, and the registry refuses to build
//     without one (see checkInverses).
//   - Nothing above TierConsequential inherits the open path's fail-open on a
//     counter-store error. That was a reviewed, accepted decision for gates
//     (store/openpath.go); it would be wrong for blades.
type Tier int

const (
	// TierUnset is the zero value and is never valid. Deliberate: a Tier that
	// defaulted to something usable would make a forgotten assignment silently
	// permissive. Every lookup that cannot resolve a real tier returns this,
	// and Allowed reports false for it. Same shape as channels.verbUnset.
	TierUnset Tier = iota
	// TierRead — observation only. Changes nothing.
	TierRead
	// TierReversible — trivially undone, no safety consequence (a lamp).
	TierReversible
	// TierConsequential — costly or disruptive to undo (a thermostat setpoint,
	// disarming a patrol route).
	TierConsequential
	// TierPhysicalAccess — grants or revokes entry to a space. Today's `open`.
	TierPhysicalAccess
	// TierHazardousMotion — moves something that can injure. Blades, barriers
	// under load.
	TierHazardousMotion
	// TierRefused — never actuable from a remote surface, whatever the caller.
	TierRefused
)

// Allowed reports whether a tier may be actuated at all. TierUnset and
// TierRefused are the two that cannot.
func (t Tier) Allowed() bool { return t > TierUnset && t < TierRefused }

func (t Tier) String() string {
	switch t {
	case TierRead:
		return "read"
	case TierReversible:
		return "reversible"
	case TierConsequential:
		return "consequential"
	case TierPhysicalAccess:
		return "physical-access"
	case TierHazardousMotion:
		return "hazardous-motion"
	case TierRefused:
		return "refused"
	}
	return "unset"
}

// Verb is a canonical action name. The set is CLOSED — drivers map onto these,
// they do not invent them. That closure is exactly what makes tiering
// enforceable: an open-ended verb space cannot be tiered, so it cannot be
// safely exposed to a chat rail or an automation.
//
// A driver needing a verb the registry lacks gets the registry extended in a
// reviewed change, with a tier assigned at that moment.
type Verb string

const (
	VerbRead   Verb = "read"
	VerbStatus Verb = "status"

	VerbOn     Verb = "on"
	VerbOff    Verb = "off"
	VerbToggle Verb = "toggle"
	VerbSet    Verb = "set"

	VerbStart  Verb = "start"
	VerbStop   Verb = "stop"
	VerbPause  Verb = "pause"
	VerbResume Verb = "resume"
	VerbDock   Verb = "dock"

	VerbOpen  Verb = "open"
	VerbClose Verb = "close"
	VerbHold  Verb = "hold"

	VerbLock   Verb = "lock"
	VerbUnlock Verb = "unlock"

	VerbArm    Verb = "arm"
	VerbDisarm Verb = "disarm"
)

// CapabilityID names a bundle of verbs a device supports. Verbs attach to
// capabilities rather than to kinds, so a lock inside a robot and a lock on a
// door share one verb and one tier.
type CapabilityID string

const (
	CapBarrier      CapabilityID = "access.barrier"
	CapLock         CapabilityID = "access.lock"
	CapSwitch       CapabilityID = "light.switch"
	CapDimmable     CapabilityID = "light.dimmable"
	CapSetpoint     CapabilityID = "climate.setpoint"
	CapJob          CapabilityID = "robot.job"
	CapBladeJob     CapabilityID = "robot.blade-job"
	CapPosture      CapabilityID = "security.posture"
	CapMeter        CapabilityID = "energy.meter"
	CapSensorReadCa CapabilityID = "sensor.read"
	CapCameraStream CapabilityID = "camera.stream"
)

// VerbSpec is one verb within a capability: its name, whether it takes a
// numeric argument, and its tier.
type VerbSpec struct {
	Verb Verb
	// Arg, when non-empty, names the single numeric argument the verb takes
	// (e.g. "level" 0..100, "celsius"). Empty means the verb takes none.
	Arg string
	// Min and Max bound Arg. Ignored when Arg is empty.
	Min, Max float64
	Tier     Tier
	// Inverse, when set, names the verb that undoes this one. Required for
	// anything above TierConsequential — see checkInverses.
	Inverse Verb
}

// Capability is a named, versioned bundle of verbs.
type Capability struct {
	ID    CapabilityID
	Verbs []VerbSpec
}

// catalogue is the closed registry. Adding a row here is the reviewed change
// that admits a new verb, and the tier is chosen at that moment rather than
// inferred later from a device name.
var catalogue = map[CapabilityID]Capability{
	CapBarrier: {ID: CapBarrier, Verbs: []VerbSpec{
		{Verb: VerbOpen, Tier: TierPhysicalAccess, Inverse: VerbClose},
		{Verb: VerbClose, Tier: TierReversible},
		{Verb: VerbHold, Arg: "seconds", Min: 1, Max: 600, Tier: TierPhysicalAccess, Inverse: VerbClose},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapLock: {ID: CapLock, Verbs: []VerbSpec{
		{Verb: VerbUnlock, Tier: TierPhysicalAccess, Inverse: VerbLock},
		{Verb: VerbLock, Tier: TierReversible},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapSwitch: {ID: CapSwitch, Verbs: []VerbSpec{
		{Verb: VerbOn, Tier: TierReversible, Inverse: VerbOff},
		{Verb: VerbOff, Tier: TierReversible},
		{Verb: VerbToggle, Tier: TierReversible},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapDimmable: {ID: CapDimmable, Verbs: []VerbSpec{
		{Verb: VerbOn, Tier: TierReversible, Inverse: VerbOff},
		{Verb: VerbOff, Tier: TierReversible},
		{Verb: VerbSet, Arg: "level", Min: 0, Max: 100, Tier: TierReversible},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapSetpoint: {ID: CapSetpoint, Verbs: []VerbSpec{
		{Verb: VerbSet, Arg: "celsius", Min: 5, Max: 35, Tier: TierConsequential},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapJob: {ID: CapJob, Verbs: []VerbSpec{
		{Verb: VerbStart, Tier: TierConsequential, Inverse: VerbStop},
		{Verb: VerbStop, Tier: TierReversible},
		{Verb: VerbPause, Tier: TierReversible},
		{Verb: VerbResume, Tier: TierConsequential, Inverse: VerbStop},
		{Verb: VerbDock, Tier: TierReversible},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	// A mower's blades are the reason TierHazardousMotion exists.
	CapBladeJob: {ID: CapBladeJob, Verbs: []VerbSpec{
		{Verb: VerbStart, Tier: TierHazardousMotion, Inverse: VerbStop},
		{Verb: VerbStop, Tier: TierReversible},
		{Verb: VerbPause, Tier: TierReversible},
		{Verb: VerbResume, Tier: TierHazardousMotion, Inverse: VerbStop},
		{Verb: VerbDock, Tier: TierReversible},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapPosture: {ID: CapPosture, Verbs: []VerbSpec{
		{Verb: VerbArm, Tier: TierConsequential, Inverse: VerbDisarm},
		{Verb: VerbDisarm, Tier: TierConsequential, Inverse: VerbArm},
		{Verb: VerbStatus, Tier: TierRead},
	}},
	CapMeter:        {ID: CapMeter, Verbs: []VerbSpec{{Verb: VerbRead, Tier: TierRead}}},
	CapSensorReadCa: {ID: CapSensorReadCa, Verbs: []VerbSpec{{Verb: VerbRead, Tier: TierRead}}},
	// Streaming is not actuation and no pipeline exists yet; status only.
	CapCameraStream: {ID: CapCameraStream, Verbs: []VerbSpec{{Verb: VerbStatus, Tier: TierRead}}},
}

// Lookup resolves a (capability, verb) pair to its spec. The second return is
// false for an unknown capability, an unknown verb, or a verb not offered by
// that capability — the caller cannot tell these apart on purpose, because the
// correct response to all three is identical: refuse.
func Lookup(cap CapabilityID, v Verb) (VerbSpec, bool) {
	c, ok := catalogue[cap]
	if !ok {
		return VerbSpec{}, false
	}
	for _, spec := range c.Verbs {
		if spec.Verb == v {
			return spec, true
		}
	}
	return VerbSpec{}, false
}

// TierOf resolves a pair to its tier, returning TierUnset when the pair is not
// in the catalogue. TierUnset.Allowed() is false, so a caller that forgets to
// check the ok from Lookup and uses this instead still fails closed.
func TierOf(cap CapabilityID, v Verb) Tier {
	spec, ok := Lookup(cap, v)
	if !ok {
		return TierUnset
	}
	return spec.Tier
}

// Capabilities returns every capability id in the catalogue, sorted. For
// diagnostics and the conformance test; not a hot path.
func Capabilities() []CapabilityID {
	out := make([]CapabilityID, 0, len(catalogue))
	for id := range catalogue {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// checkInverses enforces "stopping is never riskier than starting": every verb
// above TierConsequential must name an inverse, that inverse must exist in the
// same capability, and it must sit at TierReversible or below.
//
// Exported so the package's own test can assert it over the whole catalogue —
// a new row added without an inverse fails the build's tests, not a resident's
// evening.
func checkInverses() []string {
	var problems []string
	for id, c := range catalogue {
		for _, spec := range c.Verbs {
			if spec.Tier <= TierConsequential {
				continue
			}
			if spec.Inverse == "" {
				problems = append(problems, string(id)+"."+string(spec.Verb)+": tier "+spec.Tier.String()+" with no inverse")
				continue
			}
			inv, ok := Lookup(id, spec.Inverse)
			if !ok {
				problems = append(problems, string(id)+"."+string(spec.Verb)+": inverse "+string(spec.Inverse)+" not in capability")
				continue
			}
			if inv.Tier > TierReversible {
				problems = append(problems, string(id)+"."+string(spec.Verb)+": inverse "+string(spec.Inverse)+" is "+inv.Tier.String()+", must be reversible or below")
			}
		}
	}
	sort.Strings(problems)
	return problems
}
