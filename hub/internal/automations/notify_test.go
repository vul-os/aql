package automations

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Alert actions — a rule that tells somebody instead of driving something.
//
// Until this existed a rule could only respond to its trigger by ACTUATING, so
// "tell me when the tank is low" was inexpressible: the nearest an operator
// could get was a rule that moved a device they did not want moved, purely to
// make a run happen.

type spyNotifier struct {
	mu     sync.Mutex
	alerts []Alert
}

func (s *spyNotifier) Alert(_ context.Context, a Alert) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.alerts = append(s.alerts, a)
}

func (s *spyNotifier) all() []Alert {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Alert(nil), s.alerts...)
}

func notifyRule(h *harness, msg string) Rule {
	r := h.rule("tell me", dailyAt(6*60), Action{Notify: &Notify{Message: msg}})
	return r
}

func TestANotifyActionRaisesAnAlertAndDrivesNothing(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)

	saved, err := h.eng.SaveRule(h.ctx, notifyRule(h, "the tank is low"))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	before := len(h.drv.Calls())

	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("alert run: outcome=%s err=%v", run.Outcome, err)
	}
	if got := len(h.drv.Calls()); got != before {
		t.Errorf("an alert actuated %d device commands", got-before)
	}

	alerts := spy.all()
	if len(alerts) != 1 {
		t.Fatalf("alerts raised: %d, want 1", len(alerts))
	}
	a := alerts[0]
	if a.Message != "the tank is low" {
		t.Errorf("message = %q", a.Message)
	}
	// The hub's context, so a message that three rules could have sent is still
	// attributable.
	if a.RuleName != "tell me" || a.RuleID != saved.ID || a.AccountID != h.accountID {
		t.Errorf("alert lacks its rule: %+v", a)
	}
	if a.At == 0 {
		t.Error("alert has no timestamp")
	}
}

// An alert is still a RUN. A hub with no webhook configured delivers nowhere,
// and the record is what separates "no alert was raised" from "one was raised
// and did not reach you".
func TestAnAlertIsRecordedEvenWithNowhereToSendIt(t *testing.T) {
	h := newHarness(t)
	// No notifier installed at all.
	saved, err := h.eng.SaveRule(h.ctx, notifyRule(h, "nobody is listening"))
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0)
	if err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("outcome=%s err=%v — an undeliverable alert must still run", run.Outcome, err)
	}
	if runs := h.runs(saved.ID); len(runs) == 0 {
		t.Error("the run left no record")
	}
}

// Conditions still gate an alert. It is an action like any other, and a rule
// whose condition is unmet must not notify.
func TestAnAlertStillObeysItsConditions(t *testing.T) {
	h := newHarness(t)
	spy := &spyNotifier{}
	h.eng.SetNotifier(spy)

	r := notifyRule(h, "only when the tank is low")
	r.Conditions = []Condition{{DeviceKey: "test:tank-1", Metric: "percent", Op: OpBelow, Value: 20}}
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("SaveRule: %v", err)
	}
	// The tank reads 80.
	if run, _ := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); run.Outcome == OutcomeExecuted {
		t.Fatal("an alert fired with its condition unmet")
	}
	if n := len(spy.all()); n != 0 {
		t.Fatalf("%d alerts raised despite the condition", n)
	}
	h.drv.setReading("tank-1", "percent", 5)
	if run, err := h.eng.Fire(h.ctx, h.reload(saved.ID), CauseManual, 0); err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("alert did not fire when the condition held: %s %v", run.Outcome, err)
	}
	if n := len(spy.all()); n != 1 {
		t.Errorf("alerts raised: %d, want 1", n)
	}
}

// The three action forms are mutually exclusive. One carrying two has two
// meanings, and choosing between them would make a rule do something its author
// did not write.
func TestAnActionCannotBothAlertAndActuate(t *testing.T) {
	h := newHarness(t)
	r := h.rule("both", dailyAt(6*60), Action{
		DeviceKey: "test:lamp-1", Verb: devices.VerbOn, Notify: &Notify{Message: "hi"}})
	if _, err := h.eng.SaveRule(h.ctx, r); err == nil {
		t.Fatal("an action that both alerts and actuates was accepted")
	} else if RefusalReason(err) != ReasonInvalidRule {
		t.Errorf("reason = %v, want invalid rule", RefusalReason(err))
	}
}

func TestAnAlertNeedsSomethingToSay(t *testing.T) {
	h := newHarness(t)
	for _, msg := range []string{"", "   ", strings.Repeat("x", NotifyMaxMessage+1)} {
		if _, err := h.eng.SaveRule(h.ctx, notifyRule(h, msg)); err == nil {
			t.Errorf("a %d-character message was accepted", len(msg))
		}
	}
	// The boundary is usable.
	if _, err := h.eng.SaveRule(h.ctx, notifyRule(h, strings.Repeat("x", NotifyMaxMessage))); err != nil {
		t.Errorf("a message at the limit was refused: %v", err)
	}
}
