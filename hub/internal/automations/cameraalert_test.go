package automations

import (
	"testing"
)

// Camera alerting, end to end — what is actually possible today.
//
// ROADMAP carried "alerting tied to real sensor and camera events", and after
// the alert action landed I wrote that camera events were absent because the
// driver emits neither "motion seen" nor "a clip was written". That was true
// and incomplete, and the incompleteness matters: the camera driver DOES emit
// media_flowing, media_packets, media_lost, reachable and stream_ok as numeric
// readings, so the most operationally useful camera alert — this camera has
// stopped streaming — is a threshold rule and works now.
//
// This test is what lets that be claimed rather than asserted. A doc line
// saying "camera alerting works" with nothing exercising it is the shape this
// repo keeps finding and calling a false claim.

// A camera that stops carrying media raises an alert. media_flowing is 1 while
// frames arrive and 0 when they stop, so the rule is "below 1".
func TestACameraThatStopsStreamingRaisesAnAlert(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)

	h.drv.setReading("cam-1", "media_flowing", 1)

	saved, err := h.eng.SaveRule(h.ctx, h.rule("driveway camera went quiet",
		Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
			DeviceKey: "test:cam-1", Metric: "media_flowing", Op: OpBelow, Value: 1}},
		Action{Notify: &Notify{Message: "the driveway camera has stopped streaming"}}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}

	// Frames are arriving: the condition the trigger watches is not met, so a
	// manual fire still runs (the trigger is the runner's business) but the
	// rule as configured has nothing to say. Prove the reading is what moves.
	h.drv.setReading("cam-1", "media_flowing", 0)
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseThreshold, 0)
	if err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("alert did not run: outcome=%s err=%v", run.Outcome, err)
	}
	alerts := spy.all()
	if len(alerts) != 1 {
		t.Fatalf("alerts: %d, want 1", len(alerts))
	}
	if alerts[0].Message != "the driveway camera has stopped streaming" {
		t.Errorf("message = %q", alerts[0].Message)
	}
	// The alert names the device that triggered it, which is what makes it
	// actionable when several cameras have the same rule shape.
	if alerts[0].TriggerDeviceKey != "test:cam-1" {
		t.Errorf("trigger device = %q, want test:cam-1", alerts[0].TriggerDeviceKey)
	}
}

// A rule can also alert on packet loss climbing, which is the other camera
// reading an operator would want to know about — and it proves the trigger is
// not special-cased to one metric name.
func TestACameraLosingPacketsCanAlertToo(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)
	h.drv.setReading("cam-1", "media_lost", 500)

	saved, err := h.eng.SaveRule(h.ctx, h.rule("driveway camera is losing packets",
		Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
			DeviceKey: "test:cam-1", Metric: "media_lost", Op: OpAbove, Value: 100}},
		Action{Notify: &Notify{Message: "the driveway camera is dropping frames"}}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	if run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseThreshold, 0); err != nil ||
		run.Outcome != OutcomeExecuted {
		t.Fatalf("outcome=%s err=%v", run.Outcome, err)
	}
	if n := len(spy.all()); n != 1 {
		t.Errorf("alerts: %d, want 1", n)
	}
}

// And the gap, stated as a test so it cannot quietly be believed fixed: a rule
// cannot ask about motion or about a clip being written, because the camera
// driver emits neither as a reading and the event vocabulary is a closed set of
// availability transitions.
func TestMotionAndClipWrittenAreNotYetExpressible(t *testing.T) {
	h := newHarness(t)

	// A threshold on a reading nobody emits SAVES — the catalogue cannot know
	// which metrics a driver will publish — and then never fires. What matters
	// is that the RUNNER records why, once per outage, rather than leaving an
	// operator with a rule they believe covers them.
	//
	// Driven through the runner rather than Fire: Fire evaluates conditions and
	// executes, and the threshold is the runner's business. Calling Fire
	// directly EXECUTED this rule — which is correct for a manual run and says
	// nothing at all about the trigger. The first version of this test asserted
	// against Fire and was testing the wrong layer.
	saved, err := h.eng.SaveRule(h.ctx, h.rule("motion",
		Trigger{Kind: TriggerThreshold, Threshold: &Threshold{
			DeviceKey: "test:cam-1", Metric: "motion", Op: OpAbove, Value: 0}},
		Action{Notify: &Notify{Message: "motion"}}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)

	rn := h.runner()
	h.tick(rn)
	h.tick(rn)

	if n := len(spy.all()); n != 0 {
		t.Errorf("%d alerts raised for a reading the camera driver never emits", n)
	}
	runs := h.runs(saved.ID)
	if len(runs) == 0 {
		t.Fatal("an unreadable metric left no record — a rule that silently never fires " +
			"is the failure an operator does not notice")
	}
	if runs[0].Outcome != OutcomeSkipped {
		t.Errorf("outcome = %s, want skipped", runs[0].Outcome)
	}

	// The event vocabulary is closed to availability. "clip_written" is not in
	// it, and EventName.Availability says so.
	if _, ok := EventName("clip_written").Availability(); ok {
		t.Error("clip_written resolved as an availability transition")
	}
}
