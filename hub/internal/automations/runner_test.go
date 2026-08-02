package automations

import (
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

func (h *harness) runner() *Runner {
	h.t.Helper()
	rn, err := NewRunner(RunnerConfig{Engine: h.eng, Now: h.clock.Now})
	if err != nil {
		h.t.Fatalf("NewRunner: %v", err)
	}
	return rn
}

func (h *harness) tick(rn *Runner) {
	h.t.Helper()
	if err := rn.Tick(h.ctx); err != nil {
		h.t.Fatalf("Tick: %v", err)
	}
}

// The scheduler fires once per occurrence, and a restart — a fresh Runner with
// no in-memory state, reading the same database — does not re-fire it. That is
// the whole point of persisting last_occurrence_at.
func TestScheduleFiresOnceAndSurvivesRestart(t *testing.T) {
	h := newHarness(t)
	saved, err := h.eng.SaveRule(h.ctx, h.rule("evening lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := h.runner()

	// Before the occurrence: nothing.
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("fired %d times before 19:00", n)
	}

	// Ten seconds after it: once.
	h.clock.set(time.Date(2026, 7, 27, 19, 0, 10, 0, time.UTC))
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times at 19:00, want 1", n)
	}
	occ := time.Date(2026, 7, 27, 19, 0, 0, 0, time.UTC).Unix()
	if got := h.reload(saved.ID).LastOccurrenceAt; got != occ {
		t.Fatalf("last_occurrence_at = %d, want %d", got, occ)
	}

	// Same runner, another tick: no repeat.
	h.clock.advance(30 * time.Second)
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times, want 1 — an occurrence must fire once", n)
	}

	// RESTART: a brand-new runner with empty in-memory state.
	restarted := h.runner()
	h.tick(restarted)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times after restart, want 1", n)
	}

	// Tomorrow's occurrence still fires.
	h.clock.set(time.Date(2026, 7, 28, 19, 0, 5, 0, time.UTC))
	h.tick(restarted)
	if n := len(h.drv.Calls()); n != 2 {
		t.Fatalf("fired %d times over two days, want 2", n)
	}
	// Both runs are in the history, with their scheduled instants.
	runs := h.runs(saved.ID)
	if len(runs) != 2 {
		t.Fatalf("run history has %d rows, want 2", len(runs))
	}
	for _, r := range runs {
		if r.Cause != CauseSchedule || r.Outcome != OutcomeExecuted || r.OccurrenceAt == 0 {
			t.Errorf("unexpected run row: %+v", r)
		}
	}
	h.assertChainIntact()
}

// A hub that was down when an occurrence came due replays it only if it is
// recent. Older ones are stepped over, recorded, and never actuated.
func TestMissedOccurrencesBeyondGraceAreSkipped(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("evening lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	rn := h.runner()

	// Two days later: 27th 19:00 and 28th 19:00 both came due while we were off.
	h.clock.set(time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC))
	h.tick(rn)

	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("stale occurrences actuated %d times; a hub coming back must not "+
			"fire last night's automations in daylight", n)
	}
	runs := h.runs(saved.ID)
	if len(runs) != 2 {
		t.Fatalf("expected 2 skipped occurrences, got %d: %+v", len(runs), runs)
	}
	for _, r := range runs {
		if r.Outcome != OutcomeSkipped || r.Reason != ReasonStaleOccurrence {
			t.Errorf("unexpected row: %+v", r)
		}
	}
	// The next real occurrence still fires.
	h.clock.set(time.Date(2026, 7, 29, 19, 0, 2, 0, time.UTC))
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times at the next live occurrence, want 1", n)
	}
}

// Down for five minutes, back within the grace window: the occurrence is
// replayed, because "the lights should have come on five minutes ago" is still
// what the resident wants.
func TestMissedOccurrenceWithinGraceIsReplayed(t *testing.T) {
	h := newHarness(t)
	h.eng.SaveRule(h.ctx, h.rule("evening lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	rn := h.runner()
	h.clock.set(time.Date(2026, 7, 27, 19, 5, 0, 0, time.UTC))
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times, want 1", n)
	}
}

// A threshold fires on the crossing, not on the state. A tank sitting below the
// bound does not re-fire every thirty seconds, and one that is already below at
// boot does not fire at all.
func TestThresholdFiresOnTheEdgeOnly(t *testing.T) {
	h := newHarness(t)
	trig := Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
		DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 20}}
	saved, err := h.eng.SaveRule(h.ctx, h.rule("low water light", trig,
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := h.runner()

	h.tick(rn) // baseline at 80%: no edge
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("fired %d times on the baseline tick", n)
	}
	h.drv.setReading("tank-1", "percent", 10)
	h.tick(rn) // crossed
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times on the crossing, want 1", n)
	}
	h.drv.setReading("tank-1", "percent", 8)
	h.tick(rn) // still below: no new edge
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times while it stayed below, want 1", n)
	}
	h.drv.setReading("tank-1", "percent", 50)
	h.tick(rn)
	h.drv.setReading("tank-1", "percent", 5)
	h.tick(rn) // crossed again
	if n := len(h.drv.Calls()); n != 2 {
		t.Fatalf("fired %d times after a second crossing, want 2", n)
	}
	if got := len(h.runs(saved.ID)); got != 2 {
		t.Errorf("run history has %d rows, want 2", got)
	}
}

// An edge needs two observations, and a reboot supplies neither. A tank already
// below the bound when the hub starts must not be treated as having just
// crossed it.
func TestThresholdDoesNotFireOnTheFirstObservation(t *testing.T) {
	h := newHarness(t)
	h.drv.setReading("tank-1", "percent", 5) // already below before we start
	trig := Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
		DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 20}}
	h.eng.SaveRule(h.ctx, h.rule("low water light", trig,
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	rn := h.runner()
	h.tick(rn)
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("fired %d times on a level that never crossed", n)
	}
}

// A trigger sensor that cannot be read is recorded ONCE per outage: never is
// how a rule silently stops working, every tick is how a log becomes useless.
func TestUnreadableTriggerSensorIsRecordedOncePerOutage(t *testing.T) {
	h := newHarness(t)
	trig := Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
		DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 20}}
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("low water light", trig,
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	rn := h.runner()
	h.tick(rn)

	h.drv.clearReadings("tank-1")
	h.tick(rn)
	h.tick(rn)
	h.tick(rn)
	runs := h.runs(saved.ID)
	if len(runs) != 1 {
		t.Fatalf("expected 1 recorded outage row, got %d: %+v", len(runs), runs)
	}
	if runs[0].Outcome != OutcomeSkipped {
		t.Errorf("outage row outcome = %s, want skipped", runs[0].Outcome)
	}
	if got := h.reload(saved.ID); !got.Enabled || got.ConsecutiveFailures != 0 {
		t.Errorf("an unreadable sensor must not spend the rule's budget: %+v", got)
	}
	// It recovers, and a later crossing still fires.
	h.drv.setReading("tank-1", "percent", 80)
	h.tick(rn)
	h.drv.setReading("tank-1", "percent", 5)
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times after recovery, want 1", n)
	}
}

func TestEventFiresOnAnAvailabilityTransition(t *testing.T) {
	h := newHarness(t)
	trig := Trigger{Kind: TriggerEvent, Event: &Event{DeviceKey: "test:bot-1", Name: EventOffline}}
	saved, err := h.eng.SaveRule(h.ctx, h.rule("bot went offline", trig,
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := h.runner()
	h.tick(rn) // seeds the baseline
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("fired %d times on the seeding tick", n)
	}

	h.drv.setAvailability("bot-1", devices.AvailOffline)
	h.refresh()
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times on the transition, want 1", n)
	}
	// Still offline: not a new transition.
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("fired %d times while it stayed offline, want 1", n)
	}
	// Back online then offline again: a second transition.
	h.drv.setAvailability("bot-1", devices.AvailOnline)
	h.refresh()
	h.tick(rn)
	h.drv.setAvailability("bot-1", devices.AvailOffline)
	h.refresh()
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 2 {
		t.Fatalf("fired %d times over two transitions, want 2", n)
	}
	if got := len(h.runs(saved.ID)); got != 2 {
		t.Errorf("run history has %d rows, want 2", got)
	}
}

// At boot the drivers may not have discovered anything yet. Evaluating rules
// then would refuse every one of them for a reason that is about startup, not
// about the rules — and with the breaker, could disable a fleet's automations
// because a broker was slow.
func TestTickIsSkippedWhileTheRegistryIsEmpty(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("evening lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	rn := h.runner()

	for id := range h.drv.devs {
		delete(h.drv.devs, id)
	}
	h.refresh()
	h.clock.set(time.Date(2026, 7, 27, 19, 0, 10, 0, time.UTC))
	h.tick(rn)

	if got := h.runs(saved.ID); len(got) != 0 {
		t.Fatalf("an empty registry produced %d runs: %+v", len(got), got)
	}
	if r := h.reload(saved.ID); !r.Enabled {
		t.Error("a rule must not be disabled because the hub had not discovered its devices yet")
	}
}

// A disabled rule is invisible to the scheduler entirely — the breaker is not
// advisory.
func TestDisabledRulesAreNotTicked(t *testing.T) {
	h := newHarness(t)
	saved, _ := h.eng.SaveRule(h.ctx, h.rule("evening lights", dailyAt(19*60),
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	if _, err := h.eng.SetEnabled(h.ctx, h.accountID, saved.ID, h.userID, false); err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	rn := h.runner()
	h.clock.set(time.Date(2026, 7, 27, 19, 0, 10, 0, time.UTC))
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("a disabled rule fired %d times", n)
	}
}

// The scheduler is the unattended path, so it gets its own end-to-end proof
// that a hazardous action cannot reach a driver through it.
func TestSchedulerCannotActuateAboveTheTierCeiling(t *testing.T) {
	h := newHarness(t)
	// Saved while the bot is safe...
	saved, err := h.eng.SaveRule(h.ctx, h.rule("start the bot", dailyAt(19*60),
		Action{DeviceKey: "test:bot-1", Verb: devices.VerbStart}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	// ...and hazardous by the time the schedule comes round.
	h.drv.setCaps("bot-1", devices.CapBladeJob)
	h.refresh()

	rn := h.runner()
	h.clock.set(time.Date(2026, 7, 27, 19, 0, 10, 0, time.UTC))
	h.tick(rn)

	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("the scheduler actuated a hazardous verb %d times", n)
	}
	runs := h.runs(saved.ID)
	if len(runs) != 1 || runs[0].Outcome != OutcomeRefused {
		t.Fatalf("expected one refused run, got %+v", runs)
	}
	if r := h.reload(saved.ID); r.Enabled || r.DisabledReason != ReasonTierTooHigh {
		t.Fatalf("rule left armed: enabled=%v reason=%q", r.Enabled, r.DisabledReason)
	}
	h.assertChainIntact()
}

// Only one tick runs at a time, and that is checkable rather than assumed.
//
// Tick reads the availability snapshot, evaluates every rule against it — driver
// I/O included — and then writes the new snapshot. That span cannot be held
// under a mutex without serialising hardware reads behind a lock, so its
// correctness rests on there being exactly one tick in flight. Run provides that
// by calling Tick on one goroutine; nothing wrote it down and nothing checked
// it.
//
// This is the assertion that CAN fail, unlike the double-fire it protects
// against: two concurrent ticks serialise on the store long before reaching any
// edge decision, so no test could demonstrate that. What is demonstrable is the
// guard itself — a tick entered while another is in flight does no work.
func TestOverlappingTicksAreRefused(t *testing.T) {
	h := newHarness(t)
	h.eng.SaveRule(h.ctx, h.rule("tank low",
		Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
			DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 20}},
		Action{DeviceKey: "test:lamp-1", Verb: devices.VerbOn}))
	rn := h.runner()

	// Seed a state where the NEXT tick would actuate: known and above the
	// threshold, so a crossing is a real rising edge.
	//
	// Without this the test was worthless and a tamper said so: it called Tick
	// at boot, where no previous level is known and nothing fires anyway, so
	// deleting the guard entirely changed nothing and the assertion held.
	h.drv.setReading("tank-1", "percent", 50)
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("the baseline tick actuated %d times", n)
	}

	// Now hold the flag as if a tick were already running, and cross.
	if !rn.ticking.CompareAndSwap(false, true) {
		t.Fatal("fixture: the runner already claims to be ticking")
	}
	h.drv.setReading("tank-1", "percent", 10)
	if err := rn.Tick(h.ctx); err != nil {
		t.Fatalf("a refused tick must be a no-op, not an error: %v", err)
	}
	if n := len(h.drv.Calls()); n != 0 {
		t.Fatalf("a tick entered while another was in flight actuated %d times on a "+
			"crossing it should not have evaluated", n)
	}
	rn.ticking.Store(false)

	// And the guard releases: the same crossing fires once now.
	h.tick(rn)
	if n := len(h.drv.Calls()); n != 1 {
		t.Fatalf("after the guard released, the crossing fired %d times, want 1", n)
	}
}
