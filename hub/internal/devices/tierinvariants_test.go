package devices

import "testing"

// Invariants the catalogue must hold because code elsewhere depends on them.
//
// These are not tests of the catalogue's taste — whether `start` deserves T4 is
// a judgement, not a property. They pin the facts that OTHER packages have
// quietly built on, so that changing the catalogue fails here rather than
// somewhere far away and later.

// No hazardous-motion verb may take an argument.
//
// # What depends on this, and how it would fail
//
// The chat step-up path is the only way a T4 verb reaches a device from a
// message (httpapi/chatstepup.go, httpapi/stepupapi.go), and BOTH ends resolve
// with nil args:
//
//	reg.Resolve(m.Device.Key, v, nil)              // when the request arrives
//	reg.Resolve(intent.DeviceKey, verb, nil)       // when the console approves
//
// Give a T4 verb an argument and Resolve starts returning "verb %q requires
// argument %q" for both. That is FAIL-CLOSED, which is the right direction and
// is why this is an invariant rather than a bug — nothing actuates wrongly.
//
// What breaks is everything around it, quietly:
//
//   - The member is told "that device would not accept it", which is false. The
//     device would accept it perfectly well, with a number nobody asked them
//     for. A refusal that misdescribes the reason is the failure this
//     repository keeps finding, and it would be shipped by omission.
//
//   - An operator could ARM a window for that verb and it would never be
//     usable. handleT4WindowArm checks the tier and not the argument, so the
//     window is created, listed as `active`, and consumed by nothing. That is
//     precisely the state ArmT4Window's zero-use-cap check exists to refuse:
//     "a window that silently never works is worse than an error at the moment
//     of arming."
//
//   - chatstepup.go's chatT4Verbs comment says a T4 verb taking a value "would
//     need the number echoed in the approval and re-checked at execution, and
//     that is not built". That sentence is only true while this test passes.
//
// So: if this test fails, the catalogue change is probably fine and the three
// call sites above are not. Fix them, then delete this test or narrow it —
// do not weaken it to make the build green.
func TestNoHazardousMotionVerbTakesAnArgument(t *testing.T) {
	checked := 0
	for capID, cap := range catalogue {
		for _, spec := range cap.Verbs {
			if spec.Tier != TierHazardousMotion {
				continue
			}
			checked++
			if spec.Arg != "" {
				t.Errorf("%s.%s is TierHazardousMotion and takes argument %q — "+
					"the chat step-up path resolves T4 verbs with nil args and would "+
					"refuse it while telling the member the device would not accept it; "+
					"see this test's comment before changing it",
					capID, spec.Verb, spec.Arg)
			}
		}
	}
	// The guard on the guard. A catalogue that stopped declaring any T4 verb —
	// or a renamed tier constant — would make the loop above examine nothing
	// and pass forever while the property it names went unheld.
	if checked < 2 {
		t.Fatalf("examined %d hazardous-motion verbs; the catalogue declares at least "+
			"start and resume, so this test is no longer looking at what it claims to", checked)
	}
}

// The tier ladder must stay ordered, because two ceilings are expressed as
// comparisons rather than set membership.
//
// httpapi/chatactuate.go refuses `plan.Tier > chatTierCeiling`, and
// httpapi/t4windows.go refuses `spec.Tier < devices.TierHazardousMotion`. Both
// read as English only while the constants ascend with severity. Reorder them —
// insert a tier in the middle, renumber — and every one of those comparisons
// silently changes meaning without a single call site being edited.
func TestTheTierLadderAscendsWithSeverity(t *testing.T) {
	ladder := []Tier{
		TierRead,
		TierReversible,
		TierConsequential,
		TierPhysicalAccess,
		TierHazardousMotion,
	}
	for i := 1; i < len(ladder); i++ {
		if !(ladder[i-1] < ladder[i]) {
			t.Fatalf("tier %s (%d) does not sort below %s (%d) — every ceiling "+
				"expressed as a comparison has changed meaning",
				ladder[i-1], ladder[i-1], ladder[i], ladder[i])
		}
	}
	// And the two the ceilings actually name must be the extremes they are
	// assumed to be: nothing may sit above hazardous motion, or a verb could
	// pass a `> ceiling` check by being off the end of the ladder.
	for capID, cap := range catalogue {
		for _, spec := range cap.Verbs {
			if spec.Tier > TierHazardousMotion {
				t.Errorf("%s.%s is tier %s, above TierHazardousMotion — the chat "+
					"ceilings assume that is the top", capID, spec.Verb, spec.Tier)
			}
			if spec.Tier < TierRead {
				t.Errorf("%s.%s is tier %s, below TierRead", capID, spec.Verb, spec.Tier)
			}
		}
	}
}

// Every verb the catalogue declares must be ACTUABLE.
//
// Tier.Allowed() is `t > TierUnset && t < TierRefused`, and TierRefused sits
// above TierHazardousMotion in the ladder. That ordering is what makes a
// one-sided ceiling dangerous: `spec.Tier < TierHazardousMotion` — the shape
// httpapi/t4windows.go used to use — lets TierRefused through, because it is
// larger, not smaller.
//
// Registry.Resolve refuses anything Allowed() rejects, so nothing could
// actuate. What could happen is an operator arming a T4 window for a verb that
// can never be consumed. The arm route is now two-sided; this holds the
// premise that made it latent rather than live, so a capability declaring
// TierRefused fails HERE, next to the ladder, rather than as a window somebody
// armed and could not use.
func TestEveryCatalogueVerbIsActuable(t *testing.T) {
	checked := 0
	for capID, cap := range catalogue {
		for _, spec := range cap.Verbs {
			checked++
			if !spec.Tier.Allowed() {
				t.Errorf("%s.%s declares tier %s, which Tier.Allowed() rejects — "+
					"see this test's comment: the T4 arm route ceiling is two-sided "+
					"because of exactly this case", capID, spec.Verb, spec.Tier)
			}
		}
	}
	if checked < 20 {
		t.Fatalf("examined %d verb specs; the catalogue declares far more, so this "+
			"test is no longer looking at what it claims to", checked)
	}
}
