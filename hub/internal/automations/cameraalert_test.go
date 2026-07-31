package automations

import (
	"context"
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

// And the gap that remains, stated as a test so it cannot quietly be believed
// fixed: a rule cannot ask about MOTION, because the camera driver emits no
// such reading and the event vocabulary is a closed set of availability
// transitions.
//
// Clip-written was in this gap and no longer is — it became a trigger KIND
// (TriggerClip) rather than an event name, because the hub writes clips itself
// and so knows the fact first-hand. The event half of that check stays below:
// "clip_written" must still not resolve as an availability transition, or the
// closed vocabulary would have two different ways to say the same thing.
func TestMotionIsNotYetExpressible(t *testing.T) {
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

	// The event vocabulary is closed to availability transitions. Clips are
	// reached through TriggerClip, so "clip_written" must NOT also resolve here
	// — two spellings of one trigger is how a rule ends up firing twice.
	if _, ok := EventName("clip_written").Availability(); ok {
		t.Error("clip_written resolved as an availability transition")
	}
}

// --- clip triggers ----------------------------------------------------------

// fakeClips is a clip index the test drives directly.
type fakeClips struct {
	at map[string]int64
}

func (f *fakeClips) NewestClipAt(_ context.Context, _ string, deviceKey string) (int64, bool, error) {
	v, ok := f.at[deviceKey]
	return v, ok, nil
}

func clipRunner(h *harness, clips ClipIndex) *Runner {
	h.t.Helper()
	rn, err := NewRunner(RunnerConfig{Engine: h.eng, Now: h.clock.Now, Clips: clips})
	if err != nil {
		h.t.Fatalf("NewRunner: %v", err)
	}
	return rn
}

// The trigger the camera pipeline could always have supported and did not: the
// hub writes clips itself, so a new one is a fact it knows first-hand.
func TestANewClipFiresARuleAndAnOldOneDoesNot(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)
	clips := &fakeClips{at: map[string]int64{"test:cam-1": 1000}}

	saved, err := h.eng.SaveRule(h.ctx, h.rule("driveway recorded",
		Trigger{Kind: TriggerClip, Clip: &Clip{DeviceKey: "test:cam-1"}},
		Action{Notify: &Notify{Message: "the driveway camera recorded something"}}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := clipRunner(h, clips)

	// FIRST tick seeds. A hub restarting beside a week of footage must not
	// alert about all of it — "there are clips" is not the event.
	h.tick(rn)
	if n := len(spy.all()); n != 0 {
		t.Fatalf("%d alerts on the first observation — it must seed, not fire", n)
	}
	// Nothing new.
	h.tick(rn)
	if n := len(spy.all()); n != 0 {
		t.Fatalf("%d alerts with no new clip", n)
	}
	// A new clip.
	clips.at["test:cam-1"] = 1060
	h.tick(rn)
	alerts := spy.all()
	if len(alerts) != 1 {
		t.Fatalf("alerts after a new clip: %d, want 1", len(alerts))
	}
	if alerts[0].TriggerDeviceKey != "test:cam-1" {
		t.Errorf("alert does not name the camera: %+v", alerts[0])
	}
	if runs := h.runs(saved.ID); len(runs) == 0 {
		t.Error("the run left no record")
	}
}

// The memo is the newest clip's INSTANT, not a count. A retention sweep
// deleting an old clip lowers a count, and a rule watching one would fire on a
// DELETION — an alert saying a camera recorded, sent because footage was thrown
// away.
func TestDeletingOldFootageDoesNotLookLikeANewRecording(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)
	clips := &fakeClips{at: map[string]int64{"test:cam-1": 5000}}

	if _, err := h.eng.SaveRule(h.ctx, h.rule("driveway recorded",
		Trigger{Kind: TriggerClip, Clip: &Clip{DeviceKey: "test:cam-1"}},
		Action{Notify: &Notify{Message: "recorded"}})); err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := clipRunner(h, clips)
	h.tick(rn) // seed

	// The sweep removed everything newer, so the newest surviving clip is now
	// OLDER than what was seen. That is not a new recording.
	clips.at["test:cam-1"] = 3000
	h.tick(rn)
	if n := len(spy.all()); n != 0 {
		t.Errorf("%d alerts after a retention sweep — deletion is not a recording", n)
	}
}

// A camera that has never recorded does not fire, and does not error.
func TestACameraWithNoFootageNeverFires(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)

	if _, err := h.eng.SaveRule(h.ctx, h.rule("never recorded",
		Trigger{Kind: TriggerClip, Clip: &Clip{DeviceKey: "test:cam-1"}},
		Action{Notify: &Notify{Message: "recorded"}})); err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := clipRunner(h, &fakeClips{at: map[string]int64{}})
	h.tick(rn)
	h.tick(rn)
	if n := len(spy.all()); n != 0 {
		t.Errorf("%d alerts for a camera with no footage", n)
	}
}

// Two rules on one camera each get their own first-observation seed. Sharing
// the memo per DEVICE would let the second rule inherit the first's memory and
// never fire on a clip it had not seen.
func TestTwoRulesOnOneCameraEachSeedSeparately(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)
	clips := &fakeClips{at: map[string]int64{"test:cam-1": 1000}}

	for _, name := range []string{"first", "second"} {
		if _, err := h.eng.SaveRule(h.ctx, h.rule(name,
			Trigger{Kind: TriggerClip, Clip: &Clip{DeviceKey: "test:cam-1"}},
			Action{Notify: &Notify{Message: name}})); err != nil {
			t.Fatalf("SaveRule %s: %v", name, err)
		}
	}
	rn := clipRunner(h, clips)
	h.tick(rn)
	clips.at["test:cam-1"] = 2000
	h.tick(rn)

	if n := len(spy.all()); n != 2 {
		t.Errorf("alerts: %d, want 2 — both rules watch this camera", n)
	}
}

// A clip trigger carrying another kind's payload is refused, so the exhaustive
// "one payload per kind" rule did not quietly stop being exhaustive.
func TestAClipTriggerCannotCarryAnotherKindsPayload(t *testing.T) {
	h := newHarness(t)
	_, err := h.eng.SaveRule(h.ctx, h.rule("mixed",
		Trigger{Kind: TriggerClip, Clip: &Clip{DeviceKey: "test:cam-1"},
			Threshold: &Threshold{DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 5}},
		Action{Notify: &Notify{Message: "x"}}))
	if err == nil {
		t.Fatal("a clip trigger carrying a threshold was accepted")
	}
	// And the older kinds reject a stray clip payload, which is the half that
	// silently stops being checked when a kind is added.
	if _, err := h.eng.SaveRule(h.ctx, h.rule("stray",
		Trigger{Kind: TriggerThreshold,
			Threshold: &Threshold{DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 5},
			Clip:      &Clip{DeviceKey: "test:cam-1"}},
		Action{Notify: &Notify{Message: "x"}})); err == nil {
		t.Error("a threshold trigger carrying a clip payload was accepted")
	}
}

// A hub with no clip index must not ACTUATE. The first version of this path
// routed the missing index through Engine.Fire — which executes — so a rule
// whose trigger the hub could not observe would have run its action on every
// tick, forever, precisely because nothing could tell whether it should. The
// answer to "I cannot see the trigger" is a recorded skip, not the action.
func TestAHubThatCannotSeeClipsRecordsASkipRatherThanActing(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)

	saved, err := h.eng.SaveRule(h.ctx, h.rule("driveway recorded",
		Trigger{Kind: TriggerClip, Clip: &Clip{DeviceKey: "test:cam-1"}},
		Action{Notify: &Notify{Message: "recorded"}}))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	rn := clipRunner(h, nil) // no clip index

	for i := 0; i < 4; i++ {
		h.tick(rn)
	}
	if n := len(spy.all()); n != 0 {
		t.Errorf("%d alerts from a hub that cannot see clips — it acted on a trigger it never observed", n)
	}

	runs := h.runs(saved.ID)
	if len(runs) != 1 {
		t.Fatalf("runs recorded: %d, want exactly 1 — the notice belongs once per outage, "+
			"not never and not on every tick", len(runs))
	}
	if runs[0].Outcome != OutcomeSkipped {
		t.Errorf("outcome %q, want %q", runs[0].Outcome, OutcomeSkipped)
	}
	if runs[0].Reason == "" {
		t.Error("the skip gives no reason, so an operator sees a rule that silently never fires")
	}
}
