package devices

import "testing"

// docs/DEVICE-STATE.md's decision, under test.
//
// The value of this is almost entirely in the UNKNOWN answers. Active and
// inactive are easy and would be easy to fake; the whole design rests on a
// device the hub cannot speak for being excluded rather than counted as off.

func TestABrightnessAboveZeroIsActive(t *testing.T) {
	caps := []CapabilityID{CapDimmable}
	cases := []struct {
		level float64
		want  ActiveState
	}{
		{62, StateActive},
		{0.5, StateActive},
		{0, StateInactive},
	}
	for _, c := range cases {
		got := ActiveFrom(caps, []Reading{{Metric: "level", Value: c.level}})
		if got != c.want {
			t.Errorf("level %v → %v, want %v", c.level, got, c.want)
		}
	}
}

func TestATextStateIsMatchedAgainstTheDeclaredList(t *testing.T) {
	caps := []CapabilityID{CapJob}
	if got := ActiveFrom(caps, []Reading{{Metric: "state", Text: "cleaning"}}); got != StateActive {
		t.Errorf("cleaning → %v", got)
	}
	// Case-insensitive: a driver's capitalisation is not a semantic difference.
	if got := ActiveFrom(caps, []Reading{{Metric: "state", Text: "Cleaning"}}); got != StateActive {
		t.Errorf("Cleaning → %v", got)
	}
	if got := ActiveFrom(caps, []Reading{{Metric: "state", Text: "docked"}}); got != StateInactive {
		t.Errorf("docked → %v", got)
	}
	// A state nobody listed is INACTIVE, not unknown: the device told us what
	// it is doing, and it is not one of the doing-something states.
	if got := ActiveFrom(caps, []Reading{{Metric: "state", Text: "charging"}}); got != StateInactive {
		t.Errorf("charging → %v, want inactive — the device did report", got)
	}
}

// The answer the whole design exists for.
func TestADeviceThatDidNotReportIsUnknownNotOff(t *testing.T) {
	caps := []CapabilityID{CapDimmable}

	// No readings at all — unreachable, or never polled.
	if got := ActiveFrom(caps, nil); got != StateUnknown {
		t.Errorf("no readings → %v, want unknown; counting this as off reports a light "+
			"as off when nobody asked it", got)
	}
	// Readings, but not the one the catalogue named. This is the operator-named
	// metric problem: a driver emitting "brightness" has not been mapped, and
	// assuming it means level is the guess DEVICE-STATE.md refuses.
	other := []Reading{{Metric: "brightness", Value: 80}, {Metric: "celsius", Value: 21}}
	if got := ActiveFrom(caps, other); got != StateUnknown {
		t.Errorf("unmapped metric → %v, want unknown", got)
	}
	// A capability with no declared state never answers.
	if got := ActiveFrom([]CapabilityID{CapSetpoint}, []Reading{{Metric: "celsius", Value: 21}}); got != StateUnknown {
		t.Errorf("a setpoint reported a state: %v", got)
	}
	if HasDeclaredState([]CapabilityID{CapSetpoint}) {
		t.Error("CapSetpoint declares a state — a thermostat setpoint is not on or off")
	}
	if !HasDeclaredState(caps) {
		t.Error("CapDimmable declares no state")
	}
}

// A driver disagreeing with the catalogue about a metric's SHAPE is a fault,
// and coercing past it is how a wrong answer gets reported confidently.
func TestAMetricOfTheWrongShapeIsUnknown(t *testing.T) {
	// Numeric declared, text sent.
	if got := ActiveFrom([]CapabilityID{CapDimmable}, []Reading{{Metric: "level", Text: "bright"}}); got != StateUnknown {
		t.Errorf("text in a numeric state → %v, want unknown", got)
	}
	// Text declared, number sent.
	if got := ActiveFrom([]CapabilityID{CapJob}, []Reading{{Metric: "state", Value: 1}}); got != StateUnknown {
		t.Errorf("number in a text state → %v, want unknown", got)
	}
}

// Every declared state must be self-consistent, or a capability could declare
// one that can never resolve.
func TestEveryDeclaredStateIsUsable(t *testing.T) {
	declared := 0
	for id, c := range catalogue {
		if c.State == nil {
			continue
		}
		declared++
		if c.State.Metric == "" {
			t.Errorf("%s declares a state with no metric", id)
		}
		numeric := c.State.ActiveAbove != nil
		text := len(c.State.ActiveText) > 0
		if numeric == text {
			t.Errorf("%s declares a state that is both numeric and text, or neither — "+
				"nothing could resolve it", id)
		}
	}
	// The guard on the guard: if the catalogue lost every declaration this
	// would pass having checked nothing.
	if declared < 4 {
		t.Errorf("only %d capabilities declare a state; lighting and jobs were declared", declared)
	}
}

// Known() is what a caller must filter on. A count that filtered on
// `!= StateActive` would fold every unknown device into "off".
func TestKnownSeparatesReportedFromUnreported(t *testing.T) {
	if StateUnknown.Known() {
		t.Error("unknown reports as known")
	}
	if !StateInactive.Known() || !StateActive.Known() {
		t.Error("a reported state is not known")
	}
}
