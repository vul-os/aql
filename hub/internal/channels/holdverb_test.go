package channels

// Adding a third verb to a fail-closed system.
//
// Every method on GateVerb was written as "if it is explicitly open, do the
// open thing; otherwise do the close thing". That shape IS the safety
// property: an unset verb, a verb from a rail that did not mint it, a verb
// that arrived through a code path nobody thought about — all of them land on
// close, which is the direction that cannot let anyone in.
//
// A third verb is where that shape breaks if it is going to. Written
// carelessly — `if v == VerbClose { close } else { open-ish }` — the fallback
// inverts and an unset verb becomes the most permissive one. HOLD is the most
// permissive verb here: it leaves the gate standing open until the
// controller's hold_max releases it. It must therefore be reachable ONLY on an
// explicit match, in every single method, and never as anybody's fallback.

import "testing"

// everyVerbMethod runs a verb through all six mappings, so a new method added
// later without a hold branch shows up here rather than in production.
func everyVerbMethod(v GateVerb) map[string]string {
	return map[string]string{
		"SelectionCommand":   v.SelectionCommand(),
		"LocationCommand":    v.LocationCommand(),
		"SlackActionCommand": v.SlackActionCommand(),
		"Command":            v.Command(),
		"Title":              v.Title(),
		"Past":               v.Past(),
	}
}

// The property the whole type is built on: anything not explicitly set still
// resolves to close, everywhere.
func TestAnUnsetVerbStillFallsBackToCloseEverywhere(t *testing.T) {
	var unset GateVerb // the zero value, reachable by any caller outside this package

	got := everyVerbMethod(unset)
	want := map[string]string{
		"SelectionCommand":   SelCloseAP,
		"LocationCommand":    SelSelectLocClose,
		"SlackActionCommand": SlackActCloseGate,
		"Command":            "close",
		"Title":              "Close",
		"Past":               "closed",
	}
	for method, w := range want {
		if got[method] != w {
			t.Errorf(`%s on an UNSET verb = %q, want %q.

Adding hold must not have inverted the fallback. An unset verb reaching the
most permissive branch would mean a malformed reply, a rail that did not mint
the id, or a caller that forgot to set the verb, all resolving to a gate left
standing open.`, method, got[method], w)
		}
	}
	if unset.Valid() {
		t.Error("an unset verb reports Valid()")
	}
}

// Hold is reachable only when it was explicitly asked for.
func TestHoldIsNeverAFallback(t *testing.T) {
	holdValues := map[string]bool{
		SelHoldAP: true, SelSelectLocHold: true, SlackActHoldGate: true,
		"hold": true, "Hold open": true, "held open": true,
	}
	for _, v := range []GateVerb{verbUnset, VerbOpen, VerbClose, GateVerb(99)} {
		for method, out := range everyVerbMethod(v) {
			if holdValues[out] && v != VerbHold {
				t.Errorf("%s on verb %v produced the HOLD value %q; hold must be reachable "+
					"only on an explicit match", method, int(v), out)
			}
		}
	}
	// ...and every method does produce it when it IS hold, so the branches
	// were actually added rather than the test passing on their absence.
	for method, out := range everyVerbMethod(VerbHold) {
		if !holdValues[out] {
			t.Errorf("%s on VerbHold = %q, which is not a hold value — the branch is missing "+
				"and this verb silently behaves as close", method, out)
		}
	}
}

// The ordering trap. Every natural phrasing of a hold contains the word "open".
func TestHoldIsMatchedBeforeOpen(t *testing.T) {
	holds := []string{
		"hold the gate open",
		"hold it open please",
		"keep open",
		"keep it open for the delivery",
		"leave open",
		"leave it open",
		"can you let it stay open",
		"hold",
	}
	for _, body := range holds {
		v, ok := TextGateVerb(body)
		if !ok || v != VerbHold {
			t.Errorf(`TextGateVerb(%q) = %v (ok=%v), want hold.

Checked after "open", every plain-English hold resolves to a pulse and the gate
swings shut in the face of whoever was told it would stay open.`, body, v, ok)
		}
	}

	// Close still wins over everything, including a body that also says hold.
	for _, body := range []string{"close it", "close the gate, don't hold it open"} {
		if v, ok := TextGateVerb(body); !ok || v != VerbClose {
			t.Errorf("TextGateVerb(%q) = %v, want close — of the readings available, the "+
				"one that leaves the gate shut is the one to guess", body, v)
		}
	}

	// A plain open is still a plain open.
	if v, ok := TextGateVerb("open the gate"); !ok || v != VerbOpen {
		t.Errorf("TextGateVerb(\"open the gate\") = %v, want open", v)
	}

	// And a body naming no action is still no verb: there is no default.
	if _, ok := TextGateVerb("thanks!"); ok {
		t.Error("ordinary chatter resolved to a verb; there is no default verb")
	}
}

// Ids from a rail that did not mint them, and ids nobody minted, actuate
// nothing — including the new hold ids.
func TestOnlyMintedIdsResolveToHold(t *testing.T) {
	if v, ok := SelectionCommandVerb(SelHoldAP); !ok || v != "hold" {
		t.Errorf("SelectionCommandVerb(%q) = %q (ok=%v), want hold", SelHoldAP, v, ok)
	}
	// Slack's scheme must not accept the other rails' hold id, and vice versa.
	if _, ok := SlackActionVerb(SelHoldAP); ok {
		t.Error("Slack accepted an interactive-reply hold id; an id from another rail's " +
			"scheme is an id this handler did not write")
	}
	if _, ok := SelectionCommandVerb(SlackActHoldGate); ok {
		t.Error("the interactive-reply parser accepted a Slack hold action id")
	}
	// A narrowing id must never read as an actuation.
	if _, ok := SelectionCommandVerb(SelSelectLocHold); ok {
		t.Error("the location-narrowing hold id resolved as an actuation")
	}
	if v, ok := LocationCommandVerb(SelSelectLocHold); !ok || v != VerbHold {
		t.Errorf("LocationCommandVerb(%q) = %v, want hold — a hold that loses its verb on "+
			"the narrowing hop re-defaults to open at the gate menu", SelSelectLocHold, v)
	}
}

// The round trip the open path depends on.
func TestHoldSurvivesTheCommandRoundTrip(t *testing.T) {
	v, ok := GateVerbForCommand("hold")
	if !ok || v != VerbHold {
		t.Fatalf("GateVerbForCommand(\"hold\") = %v (ok=%v)", v, ok)
	}
	if v.Command() != "hold" {
		t.Errorf("round trip produced %q", v.Command())
	}
	// The vocabulary stays closed.
	for _, bad := range []string{"lockdown", "repair", "config", "lift", "", "HOLD"} {
		if _, ok := GateVerbForCommand(bad); ok {
			t.Errorf("GateVerbForCommand(%q) was accepted", bad)
		}
	}
}
