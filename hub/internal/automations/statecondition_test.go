package automations

import (
	"errors"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// State conditions — the non-numeric half of Condition.
//
// The claim under test is the one in stateHolds's doc comment: an UNKNOWN state
// is a REFUSAL, not a false. Everything here exists to hold that line, because
// the failure it prevents is silent. "Turn the porch light on when it is off"
// against a light whose driver has gone quiet would fire on every tick if
// unknown folded into inactive, and nothing in the run record would say why.
//
// mower-1 declares CapBladeJob, whose StateSpec reads the "state" metric and
// counts "mowing"/"running"/"returning" as active. lamp-1 declares CapDimmable,
// whose state is the "level" metric above zero. tank-1 declares CapSensorReadCa,
// which declares no state at all — that is the third refusal case.

// A state condition that holds lets the rule run; one that does not skips it
// quietly. Neither is a refusal: the device reported both times.
func TestStateConditionMetAndUnmet(t *testing.T) {
	h := newHarness(t)
	r := h.rule("light the lawn while the mower works", dailyAt(9*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.Conditions = []Condition{{DeviceKey: "test:mower-1", State: StateRequireActive}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	// Active: it runs.
	h.drv.setTextReading("mower-1", "state", "mowing")
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("active state: outcome=%s reason=%s err=%v", run.Outcome, run.Reason, err)
	}

	// Inactive: it skips, and it skips as CONDITION UNMET rather than as any
	// flavour of error. A docked mower is not a fault.
	h.drv.setTextReading("mower-1", "state", "docked")
	run, err = h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeSkipped || run.Reason != ReasonConditionUnmet {
		t.Fatalf("inactive state: outcome=%s reason=%s err=%v", run.Outcome, run.Reason, err)
	}
}

// The inverse condition is not the negation of the first: `inactive` must be
// satisfied only by a device that SAID it was inactive.
func TestStateConditionInactive(t *testing.T) {
	h := newHarness(t)
	r := h.rule("mow only once the lamp is off", dailyAt(9*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.Conditions = []Condition{{DeviceKey: "test:lamp-1", State: StateRequireInactive}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	// CapDimmable: level 0 is off.
	h.drv.setReading("lamp-1", "level", 0)
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("inactive required, device inactive: outcome=%s err=%v", run.Outcome, err)
	}

	h.drv.setReading("lamp-1", "level", 60)
	run, err = h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeSkipped || run.Reason != ReasonConditionUnmet {
		t.Fatalf("inactive required, device active: outcome=%s reason=%s err=%v", run.Outcome, run.Reason, err)
	}
}

// The load-bearing test. Each setup leaves the state UNKNOWABLE in a different
// way, and every one must refuse — not skip, and above all not execute.
//
// The `inactive` requirement is the one used deliberately: if unknown were
// folded into false, `active` would merely stop firing (annoying but visible),
// whereas `inactive` would fire against a silent device (invisible and wrong).
func TestUnknownStateRefusesRatherThanReadingAsInactive(t *testing.T) {
	h := newHarness(t)
	r := h.rule("act when the mower is parked", dailyAt(9*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.Conditions = []Condition{{DeviceKey: "test:mower-1", State: StateRequireInactive}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	cases := []struct {
		name  string
		setup func()
	}{
		{"driver reported nothing at all", func() { h.drv.clearReadings("mower-1") }},
		{"reported some other metric", func() { h.drv.setReading("mower-1", "battery", 91) }},
		{"reported state in the wrong shape", func() { h.drv.setReading("mower-1", "state", 1) }},
	}

	callsBefore := len(h.drv.Calls())
	for _, tc := range cases {
		// Re-enable between iterations: a refusal spends the rule's budget.
		if _, err := h.eng.SetEnabled(h.ctx, h.accountID, saved.ID, h.userID, true); err != nil {
			t.Fatalf("%s: SetEnabled: %v", tc.name, err)
		}
		tc.setup()
		run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
		if run.Outcome != OutcomeRefused || RefusalReason(err) != ReasonAmbiguousState {
			t.Fatalf("%s: outcome=%s reason=%s err=%v, want refused/%s",
				tc.name, run.Outcome, run.Reason, err, ReasonAmbiguousState)
		}
	}
	if len(h.drv.Calls()) != callsBefore {
		t.Error("an unknown state actuated a device — unknown was treated as a reading")
	}
}

// A device that declares no state at all cannot answer the question, and saying
// so beats inventing an answer from whatever numbers it happens to publish.
func TestStateConditionOnAStatelessDeviceRefuses(t *testing.T) {
	h := newHarness(t)
	r := h.rule("act on the tank's state", dailyAt(9*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	// tank-1 publishes "percent" happily; it just never declares a state.
	r.Conditions = []Condition{{DeviceKey: "test:tank-1", State: StateRequireActive}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	if devices.HasDeclaredState([]devices.CapabilityID{devices.CapSensorReadCa}) {
		t.Fatal("premise broken: this test needs a capability that declares NO state")
	}

	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeRefused || RefusalReason(err) != ReasonAmbiguousState {
		t.Fatalf("stateless device: outcome=%s err=%v, want refused/%s",
			run.Outcome, err, ReasonAmbiguousState)
	}
	// The reason alone is NOT enough evidence here, and finding that out is the
	// point of this assertion. Deleting the HasDeclaredState guard entirely
	// leaves this test green if it only checks the reason: a stateless device
	// falls through to ActiveFrom, which returns StateUnknown, which the
	// !st.Known() check refuses with the SAME ReasonAmbiguousState. That check
	// is a backstop sitting behind this guard and it masks its removal.
	//
	// Asserting the DETAIL is what separates them — "declares no state to test"
	// can only come from the guard itself. Verified by deleting the guard and
	// watching this go red.
	var ref *Refusal
	if !errors.As(err, &ref) {
		t.Fatalf("want a *Refusal, got %T: %v", err, err)
	}
	if !strings.Contains(ref.Detail, "declares no state to test") {
		t.Errorf("refused with %q; want the no-declared-state guard, not the "+
			"unknown-reading backstop behind it", ref.Detail)
	}
	if len(h.drv.Calls()) != 0 {
		t.Error("a device with no declared state must not actuate anything")
	}
}

// A device that has left the fleet since the rule was saved refuses too — the
// same re-check against TODAY's catalogue the numeric path already does.
func TestStateConditionOnAVanishedDeviceRefuses(t *testing.T) {
	h := newHarness(t)
	r := h.rule("act on the mower", dailyAt(9*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.Conditions = []Condition{{DeviceKey: "test:mower-1", State: StateRequireActive}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	delete(h.drv.devs, "mower-1")
	h.refresh()

	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if run.Outcome != OutcomeRefused {
		t.Fatalf("vanished condition device: outcome=%s err=%v, want refused", run.Outcome, err)
	}
	if len(h.drv.Calls()) != 0 {
		t.Error("a vanished condition device must not actuate")
	}
}

// Validate is the other half: a condition that could mean two things is
// rejected at save time rather than resolved at run time.
func TestConditionValidateSeparatesTheTwoForms(t *testing.T) {
	cases := []struct {
		name string
		c    Condition
		ok   bool
	}{
		{"numeric alone", Condition{DeviceKey: "test:tank-1", Metric: "percent", Op: OpAtLeast, Value: 20}, true},
		{"state alone", Condition{DeviceKey: "test:mower-1", State: StateRequireActive}, true},
		{"state inactive alone", Condition{DeviceKey: "test:mower-1", State: StateRequireInactive}, true},
		{"both forms at once", Condition{DeviceKey: "test:mower-1", State: StateRequireActive,
			Metric: "state", Op: OpAtLeast, Value: 1}, false},
		{"state plus a bare metric", Condition{DeviceKey: "test:mower-1", State: StateRequireActive,
			Metric: "state"}, false},
		{"unknown state word", Condition{DeviceKey: "test:mower-1", State: ConditionState("on")}, false},
		{"neither form", Condition{DeviceKey: "test:mower-1"}, false},
		{"no device", Condition{State: StateRequireActive}, false},
	}
	for _, tc := range cases {
		err := tc.c.Validate()
		if tc.ok && err != nil {
			t.Errorf("%s: want accepted, got %v", tc.name, err)
		}
		if !tc.ok {
			if err == nil {
				t.Errorf("%s: want refused, got accepted", tc.name)
				continue
			}
			if RefusalReason(err) != ReasonInvalidRule {
				t.Errorf("%s: refused with %s, want %s", tc.name, RefusalReason(err), ReasonInvalidRule)
			}
		}
	}
}

// IsState is what routes a condition down one path or the other, so it is worth
// pinning: only a non-empty State makes it a state condition.
func TestIsStateRoutesOnTheStateFieldAlone(t *testing.T) {
	if (Condition{DeviceKey: "d", Metric: "percent", Op: OpAtLeast}).IsState() {
		t.Error("a numeric condition reported itself as a state condition")
	}
	if !(Condition{DeviceKey: "d", State: StateRequireInactive}).IsState() {
		t.Error("a state condition did not report itself as one")
	}
}

// A state condition must survive the store round-trip, or a rule saved through
// the API silently becomes a different rule when it is reloaded to fire.
func TestStateConditionRoundTripsThroughTheStore(t *testing.T) {
	h := newHarness(t)
	r := h.rule("round trip", dailyAt(9*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn})
	r.Conditions = []Condition{{DeviceKey: "test:mower-1", State: StateRequireInactive}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	got := h.reload(saved.ID)
	if len(got.Conditions) != 1 {
		t.Fatalf("conditions did not round-trip: %+v", got.Conditions)
	}
	c := got.Conditions[0]
	if c.State != StateRequireInactive || !c.IsState() {
		t.Errorf("state lost in the round trip: %+v", c)
	}
	if c.Metric != "" || c.Op != "" {
		t.Errorf("round trip invented a numeric half: %+v", c)
	}
}
