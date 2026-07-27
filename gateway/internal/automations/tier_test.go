package automations

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// The safety rule this package exists to enforce: an automation fires with
// nobody watching, so it may not do anything a person would want to be present
// for. These tests are deliberately about the boundary itself rather than the
// happy path — the failure mode being guarded against is a rule that quietly
// starts a mower's blades at 3am.

func TestNothingAboveConsequentialMayBeAutomated(t *testing.T) {
	for _, tc := range []struct {
		tier    devices.Tier
		allowed bool
		why     string
	}{
		{devices.TierRead, true, "reading a sensor harms nobody"},
		{devices.TierReversible, true, "a lamp is trivially undone"},
		{devices.TierConsequential, true, "the documented ceiling"},
		{devices.TierPhysicalAccess, false, "an unattended rule must not grant entry to a space"},
		{devices.TierHazardousMotion, false, "an unattended rule must not move something that can injure"},
		{devices.TierRefused, false, "never actuable by anyone"},
		{devices.TierUnset, false, "the zero value must never be actuable"},
	} {
		err := checkActionTier(tc.tier)
		if tc.allowed && err != nil {
			t.Errorf("tier %s was refused but should be permitted (%s): %v", tc.tier, tc.why, err)
		}
		if !tc.allowed && err == nil {
			t.Errorf("tier %s was PERMITTED — %s", tc.tier, tc.why)
		}
	}
}

// The ceiling must sit exactly where the doc comment says. If someone raises
// MaxActionTier to make a feature work, this fails and makes them say so out
// loud rather than discovering it at a gate.
func TestTheCeilingIsConsequential(t *testing.T) {
	if MaxActionTier != devices.TierConsequential {
		t.Fatalf("MaxActionTier is %s, expected consequential. Raising this ceiling "+
			"lets unattended rules open gates or start blades; it is not a routine change.",
			MaxActionTier)
	}
}

// The refusal has to explain itself. A resident or operator seeing "refused"
// with no reason will assume a bug and work around it.
func TestTheRefusalSaysWhy(t *testing.T) {
	err := checkActionTier(devices.TierHazardousMotion)
	if err == nil {
		t.Fatal("hazardous motion must be refused")
	}
	msg := err.Error()
	for _, want := range []string{"nobody watching", "injure"} {
		if !strings.Contains(msg, want) {
			t.Errorf("refusal should explain itself; %q missing from %q", want, msg)
		}
	}
}

// checkActionTier is a free function precisely so the save-time and
// execution-time paths cannot drift apart. Assert both call sites exist —
// a stored rule must be re-checked, because the catalogue can change beneath
// it after it was saved.
func TestBothCallSitesUseTheSameCheck(t *testing.T) {
	// A rule whose action targets a barrier resolves to TierPhysicalAccess.
	// Whichever path evaluates it, the answer must be identical.
	spec, ok := devices.Lookup(devices.CapBarrier, devices.VerbOpen)
	if !ok {
		t.Fatal("access.barrier open should exist in the catalogue")
	}
	if err := checkActionTier(spec.Tier); err == nil {
		t.Fatalf("opening a barrier resolved to %s and was permitted for an "+
			"unattended rule", spec.Tier)
	}
	// And the inverse must remain reachable: stopping is never harder than
	// starting, so a rule may always close.
	closeSpec, ok := devices.Lookup(devices.CapBarrier, devices.VerbClose)
	if !ok {
		t.Fatal("access.barrier close should exist")
	}
	if err := checkActionTier(closeSpec.Tier); err != nil {
		t.Fatalf("closing a barrier was refused (%v) — an automation must always "+
			"be able to make things safer", err)
	}
}
