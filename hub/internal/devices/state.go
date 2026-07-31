package devices

import "strings"

// Reading a device's ACTIVE state — docs/DEVICE-STATE.md.
//
// This is the piece that lets a caller ask "is this light on" without guessing.
// It answers from the catalogue's declaration and the driver's readings, and it
// has a third answer — UNKNOWN — which is the one that makes the other two
// trustworthy.

// ActiveState is what a device reports about itself.
type ActiveState int

const (
	// StateUnknown — this device has no declared state, or reported no reading
	// carrying it. NOT a synonym for inactive: §3.3 requires a device whose
	// state the hub does not know to be excluded from any count and SAID to be,
	// because a fleet summarised as "2 of 10 on" when seven are unknown is a
	// partial answer that reads as complete.
	StateUnknown ActiveState = iota
	// StateInactive — the device reported, and it is off / idle / docked.
	StateInactive
	// StateActive — the device reported, and it is on / running.
	StateActive
)

func (s ActiveState) String() string {
	switch s {
	case StateInactive:
		return "inactive"
	case StateActive:
		return "active"
	}
	return "unknown"
}

// Known reports whether the device actually told us. Callers counting devices
// must filter on this rather than on `== StateInactive`, or every unknown
// device is silently counted as off.
func (s ActiveState) Known() bool { return s != StateUnknown }

// ActiveFrom resolves a device's state from its capabilities and readings.
//
// The capability declaration decides which reading matters, so a device with
// several readings ("level", "celsius", "battery") is not searched for
// something that looks like a state — it is asked for the one the catalogue
// named. A reading whose Metric matches but whose shape does not (Text where a
// number was declared) is UNKNOWN rather than coerced: a driver disagreeing
// with the catalogue about a metric's type is a configuration fault, and
// guessing past it is how the wrong answer gets reported confidently.
//
// The FIRST capability with a declared state wins. A device exposing two is a
// case docs/DEVICE-STATE.md §5 leaves open, and this resolves it in the only
// way that is stable rather than arbitrary: capabilities are consulted in the
// order the device declares them.
func ActiveFrom(caps []CapabilityID, readings []Reading) ActiveState {
	for _, id := range caps {
		c, ok := catalogue[id]
		if !ok || c.State == nil {
			continue
		}
		spec := c.State
		for _, r := range readings {
			if r.Metric != spec.Metric {
				continue
			}
			if spec.ActiveAbove != nil {
				// Numeric state. Text set means the driver sent the wrong
				// shape for this metric.
				if r.Text != "" {
					return StateUnknown
				}
				if r.Value > *spec.ActiveAbove {
					return StateActive
				}
				return StateInactive
			}
			// Text state.
			if r.Text == "" {
				return StateUnknown
			}
			for _, want := range spec.ActiveText {
				if strings.EqualFold(r.Text, want) {
					return StateActive
				}
			}
			// Reported something the catalogue does not list as active. That
			// is INACTIVE, not unknown: the device told us what it is doing and
			// it is not one of the doing-something states.
			return StateInactive
		}
	}
	return StateUnknown
}

// HasDeclaredState reports whether any of these capabilities declares one.
//
// Separate from ActiveFrom so a caller can tell "this device could never answer"
// from "it did not answer this time" — the first is a fleet the operator has
// not mapped, the second is a device that is unreachable, and they want
// different words.
func HasDeclaredState(caps []CapabilityID) bool {
	for _, id := range caps {
		if c, ok := catalogue[id]; ok && c.State != nil {
			return true
		}
	}
	return false
}
