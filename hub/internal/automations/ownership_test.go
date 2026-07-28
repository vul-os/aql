package automations

// Whose device may a rule drive?
//
// Until the DeviceOwner seam existed, the answer was "any of them". A rule
// names a device key, and nothing verified that key belonged to the rule's
// account — not when the rule was saved, and not when it fired. On a
// multi-account hub an admin of one account could write a rule that drove
// another account's claimed device.
//
// The tier ceiling bounded what that could do — MaxActionTier stops entry and
// hazardous motion — but bounded is not prevented, and a thermostat driven by
// a stranger is still a stranger driving your thermostat.
//
// The check that matters is the one in the run path. A save-time refusal is a
// courtesy: it tells an admin immediately instead of letting them save a rule
// that is refused every time it fires. Ownership can change under a stored
// rule, so only the firing check actually protects the device.

import (
	"context"
	"errors"
	"testing"
)

// ownerFn is a lookup over a mutable table, so a test can transfer a device
// mid-life and watch a stored rule stop working.
type ownerFn struct {
	claims map[string]string
	fail   string
}

func (o *ownerFn) f(_ context.Context, key string) (string, bool, error) {
	if key == o.fail {
		return "", false, errors.New("ownership lookup unavailable")
	}
	if a, ok := o.claims[key]; ok {
		return a, true, nil
	}
	return "", false, nil
}

// withOwner rebuilds the harness's engine with an ownership lookup attached.
func withOwner(t *testing.T, h *harness, o *ownerFn) {
	t.Helper()
	eng, err := NewEngine(Config{
		Registry: h.reg, Store: h.rules, Audit: h.audit,
		Now: h.clock.Now, DeviceOwner: o.f,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	h.eng = eng
}

// A rule may drive a device its own account claimed.
func TestARuleDrivesItsOwnAccountsDevice(t *testing.T) {
	h := newHarness(t)
	o := &ownerFn{claims: map[string]string{"test:lamp-1": h.accountID}}
	withOwner(t, h, o)

	r := h.rule("evening lights", dailyAt(18*60), Action{DeviceKey: "test:lamp-1", Verb: "on"})
	saved, err := h.eng.SaveRule(h.ctx, r)
	if err != nil {
		t.Fatalf("saving a rule for an owned device was refused: %v", err)
	}
	run, err := h.eng.RunNow(h.ctx, h.accountID, saved.ID)
	if err != nil {
		t.Fatalf("RunNow: %v", err)
	}
	if run.Outcome != OutcomeExecuted {
		t.Errorf("outcome = %s (%s), want executed", run.Outcome, run.Reason)
	}
}

// An UNCLAIMED device is allowed. A hub with one household claims nothing, and
// requiring every lamp to be claimed before a rule could touch it would break
// the deployment this product is mostly for.
func TestAnUnclaimedDeviceIsStillDrivable(t *testing.T) {
	h := newHarness(t)
	withOwner(t, h, &ownerFn{claims: map[string]string{}})

	saved, err := h.eng.SaveRule(h.ctx,
		h.rule("evening lights", dailyAt(18*60), Action{DeviceKey: "test:lamp-1", Verb: "on"}))
	if err != nil {
		t.Fatalf("an unclaimed device was refused at save: %v", err)
	}
	run, err := h.eng.RunNow(h.ctx, h.accountID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Outcome != OutcomeExecuted {
		t.Errorf("outcome = %s (%s), want executed — an unclaimed device is nobody's, "+
			"not everybody-else's", run.Outcome, run.Reason)
	}
}

// The hole this closes.
func TestARuleCannotDriveAnotherAccountsDevice(t *testing.T) {
	h := newHarness(t)
	withOwner(t, h, &ownerFn{claims: map[string]string{"test:lamp-1": "some-other-account"}})

	_, err := h.eng.SaveRule(h.ctx,
		h.rule("take theirs", dailyAt(18*60), Action{DeviceKey: "test:lamp-1", Verb: "on"}))
	if RefusalReason(err) != ReasonForeignDevice {
		t.Fatalf("saving a rule against another account's device was allowed (err = %v)", err)
	}
	// The refusal must not describe the other tenant's fleet — not who owns
	// it, not that an owner exists.
	if err != nil && contains(err.Error(), "some-other-account") {
		t.Errorf("the refusal names the owning account: %v", err)
	}
}

// THE test. A rule saved while the device was this account's, still stored,
// must stop working the moment the device is released to someone else — which
// a save-time check alone would never notice.
func TestOwnershipIsRecheckedEveryTimeARuleFires(t *testing.T) {
	h := newHarness(t)
	o := &ownerFn{claims: map[string]string{"test:lamp-1": h.accountID}}
	withOwner(t, h, o)

	saved, err := h.eng.SaveRule(h.ctx,
		h.rule("evening lights", dailyAt(18*60), Action{DeviceKey: "test:lamp-1", Verb: "on"}))
	if err != nil {
		t.Fatal(err)
	}
	if run, err := h.eng.RunNow(h.ctx, h.accountID, saved.ID); err != nil || run.Outcome != OutcomeExecuted {
		t.Fatalf("fixture: the rule should work while the device is ours (%v, %v)", run.Outcome, err)
	}

	// The device changes hands. The rule row is untouched.
	o.claims["test:lamp-1"] = "new-owner-account"

	run, err := h.eng.RunNow(h.ctx, h.accountID, saved.ID)
	if run.Outcome != OutcomeRefused || RefusalReason(err) != ReasonForeignDevice {
		t.Fatalf(`a stored rule kept driving a device after it was released: %s (%v)

The save-time check passed a year ago and cannot know this. Only the run-path
check can, which is why it re-asks rather than trusting the rule row — the same
reason the tier is re-checked at firing.`, run.Outcome, err)
	}
}

// A lookup that FAILED has not established anything. Not knowing whose a
// device is, is not a licence to actuate it.
func TestAFailedOwnershipLookupRefusesRatherThanActuates(t *testing.T) {
	h := newHarness(t)
	withOwner(t, h, &ownerFn{claims: map[string]string{}, fail: "test:lamp-1"})

	// Saved through a permissive engine, so the failure is exercised at firing
	// rather than being caught at save.
	permissive := h.eng
	withOwner(t, h, &ownerFn{claims: map[string]string{}})
	saved, err := h.eng.SaveRule(h.ctx,
		h.rule("evening lights", dailyAt(18*60), Action{DeviceKey: "test:lamp-1", Verb: "on"}))
	if err != nil {
		t.Fatal(err)
	}
	_ = permissive
	withOwner(t, h, &ownerFn{claims: map[string]string{}, fail: "test:lamp-1"})

	run, err := h.eng.RunNow(h.ctx, h.accountID, saved.ID)
	if run.Outcome != OutcomeRefused || RefusalReason(err) != ReasonForeignDevice {
		t.Errorf("a rule actuated while ownership could not be established: %s (%v)",
			run.Outcome, err)
	}
}

// With no lookup configured nothing changes, so the seam cannot break a hub
// that predates ownership.
func TestWithoutALookupEveryDeviceRemainsDrivable(t *testing.T) {
	h := newHarness(t)
	saved, err := h.eng.SaveRule(h.ctx,
		h.rule("evening lights", dailyAt(18*60), Action{DeviceKey: "test:lamp-1", Verb: "on"}))
	if err != nil {
		t.Fatal(err)
	}
	run, err := h.eng.RunNow(h.ctx, h.accountID, saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Outcome != OutcomeExecuted {
		t.Errorf("outcome = %s, want executed", run.Outcome)
	}
}

func contains(hay, needle string) bool {
	for i := 0; i+len(needle) <= len(hay); i++ {
		if hay[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
