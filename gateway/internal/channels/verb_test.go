package channels

// Renderer-level tests for the verb threading (verb.go). The wiring proof —
// that no sequence of real webhook deliveries starting from a close request
// ever lands a successful `open` in access_logs — lives in
// httpapi/channels_closeverb_test.go; these pin the pieces that make it true.
//
// Most of this file could not compile against the pre-fix tree at all:
// PushGateMenu / PushLocationMenu / PushAmbiguousGateMenu took no verb, which
// is the defect. That compile failure IS the forcing function — every existing
// call site had to be reopened and given a verb by hand.

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/store"
)

// TestGateVerbZeroValueFailsClosed is the property that keeps a FUTURE call
// site from re-introducing the defect. The zero value is not VerbOpen: a
// renderer that was not told the verb must produce the closing form, never the
// opening one. A forgotten verb should look wrong, not open a gate.
func TestGateVerbZeroValueFailsClosed(t *testing.T) {
	var forgotten GateVerb // exactly what a new caller writes by accident

	if forgotten.Valid() {
		t.Error("the zero value must not report itself as a set verb")
	}
	if got := forgotten.SelectionCommand(); got != SelCloseAP {
		t.Errorf("unset verb mints %q rows — an unset verb must never open", got)
	}
	if got := forgotten.LocationCommand(); got != SelSelectLocClose {
		t.Errorf("unset verb mints %q location rows", got)
	}
	if got := forgotten.Command(); got != "close" {
		t.Errorf("unset verb actuates %q", got)
	}
	if got := forgotten.Title(); got != "Close" {
		t.Errorf("unset verb labels buttons %q", got)
	}
	if got := forgotten.Past(); got != "closed" {
		t.Errorf("unset verb past tense %q", got)
	}
	if got := forgotten.String(); got != "unset" {
		t.Errorf("unset verb should say so in logs: %q", got)
	}

	// Anything outside the two constants gets the same treatment — there is no
	// numeric value of GateVerb other than VerbOpen that opens.
	for _, v := range []GateVerb{-1, 7, 99} {
		if v.SelectionCommand() != SelCloseAP || v.Command() != "close" || v.Valid() {
			t.Errorf("GateVerb(%d) is not fail-closed", v)
		}
	}

	// And the two real ones do exactly what they say.
	if VerbOpen.SelectionCommand() != SelOpenAP || VerbOpen.LocationCommand() != SelSelectLoc ||
		VerbOpen.Command() != "open" || VerbOpen.Title() != "Open" || VerbOpen.Past() != "opened" {
		t.Error("VerbOpen must render the open forms")
	}
	if VerbClose.SelectionCommand() != SelCloseAP || VerbClose.LocationCommand() != SelSelectLocClose ||
		VerbClose.Command() != "close" || VerbClose.Title() != "Close" || VerbClose.Past() != "closed" {
		t.Error("VerbClose must render the close forms")
	}
}

// TestPushGateMenuCloseNeverOffersOpen is the defect itself at the renderer:
// the fallback picker for an unresolved close, in both shapes (single-gate
// button and multi-gate list).
func TestPushGateMenuCloseNeverOffersOpen(t *testing.T) {
	one := []store.AvailableAP{ap("ap1", "Main gate", "Home")}
	two := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	single := PushGateMenu(VerbClose, "Home", one, testPortal)
	btn := single.Interactive.Action.Buttons[0].Reply
	if btn.ID != "close_ap:ap1" {
		t.Errorf("single-gate close button id: %q", btn.ID)
	}
	if btn.Title != "Close Main gate" {
		t.Errorf("single-gate close button title: %q", btn.Title)
	}
	if body := single.Interactive.Body.Text; strings.Contains(body, "open") || !strings.Contains(body, "close") {
		t.Errorf("single-gate close body offers open: %q", body)
	}

	multi := PushGateMenu(VerbClose, "Home", two, testPortal)
	rows := multi.Interactive.Action.Sections[0].Rows
	if len(rows) != 2 || rows[0].ID != "close_ap:ap1" || rows[1].ID != "close_ap:ap2" {
		t.Errorf("close picker rows: %+v", rows)
	}
	if body := multi.Interactive.Body.Text; strings.Contains(body, "open") || !strings.Contains(body, "close") {
		t.Errorf("close picker body offers open: %q", body)
	}
	// It also says plainly that nothing moved — same honesty rule as
	// PushAmbiguousGateMenu and DenialMessage.
	if !strings.Contains(multi.Interactive.Body.Text, "haven't closed") {
		t.Errorf("close picker must say nothing closed: %q", multi.Interactive.Body.Text)
	}
}

// TestPushGateMenuOpenIsByteIdentical: the welcome/greeting menus keep open,
// and keep their exact copy and ids. This fix must be invisible on that path.
func TestPushGateMenuOpenIsByteIdentical(t *testing.T) {
	one := []store.AvailableAP{ap("ap1", "Main gate", "Home")}
	two := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	single := PushGateMenu(VerbOpen, "Home", one, testPortal)
	if got := single.Interactive.Body.Text; got != `Welcome to Home. Message "open" any time, or tap below to open Main gate.` {
		t.Errorf("single-gate welcome copy changed: %q", got)
	}
	if got := single.Interactive.Action.Buttons[0].Reply; got.ID != "open_ap:ap1" || got.Title != "Open Main gate" {
		t.Errorf("single-gate welcome button changed: %+v", got)
	}

	multi := PushGateMenu(VerbOpen, "Home", two, testPortal)
	if got := multi.Interactive.Body.Text; got != "Welcome to Home. Which gate would you like to open?" {
		t.Errorf("multi-gate welcome copy changed: %q", got)
	}
	if rows := multi.Interactive.Action.Sections[0].Rows; rows[0].ID != "open_ap:ap1" || rows[1].ID != "open_ap:ap2" {
		t.Errorf("multi-gate welcome rows changed: %+v", rows)
	}

	locs := []store.LinkedLocation{{ID: "l1", Name: "Home"}, {ID: "l2", Name: "Depot"}}
	lm := PushLocationMenu(VerbOpen, locs, testPortal)
	if got := lm.Interactive.Body.Text; got != "Welcome back. Which location do you want to use?" {
		t.Errorf("location menu copy changed: %q", got)
	}
	if rows := lm.Interactive.Action.Sections[0].Rows; rows[0].ID != "select_loc:l1" || rows[1].ID != "select_loc:l2" {
		t.Errorf("location menu row ids changed — menus already on residents' phones would stop resolving: %+v", rows)
	}
}

// TestPushLocationMenuCarriesTheVerb: the narrowing hop is where a verb is
// easiest to lose, because the answer arrives one message later carrying
// nothing but the row id. So the row id carries it.
func TestPushLocationMenuCarriesTheVerb(t *testing.T) {
	locs := []store.LinkedLocation{{ID: "l1", Name: "Home"}, {ID: "l2", Name: "Depot"}}

	lm := PushLocationMenu(VerbClose, locs, testPortal)
	for _, r := range lm.Interactive.Action.Sections[0].Rows {
		if !strings.HasPrefix(r.ID, SelSelectLocClose+":") {
			t.Errorf("close location row loses the verb: %+v", r)
		}
		// The tap must round-trip through the real parser back to the verb.
		cmd, arg, ok := ParseSelection(r.ID)
		if !ok {
			t.Fatalf("minted an id the parser rejects: %q", r.ID)
		}
		verb, isNarrowing := LocationCommandVerb(cmd)
		if !isNarrowing || verb != VerbClose {
			t.Errorf("%q → (%v, %v), want a close narrowing", r.ID, verb, isNarrowing)
		}
		if arg != "l1" && arg != "l2" {
			t.Errorf("location arg: %q", arg)
		}
	}
	if body := lm.Interactive.Body.Text; strings.Contains(body, "Welcome") {
		t.Errorf("a close request is not a welcome: %q", body)
	}
}

// TestNarrowingAndActuationStayDisjoint: a narrowing id must never be readable
// as an actuation and vice versa. This is the same line SelectionCommandVerb
// already drew for select_loc, extended to its close sibling — the reason
// select_loc_close is a NARROWING command and not a third actuation verb.
func TestNarrowingAndActuationStayDisjoint(t *testing.T) {
	for _, cmd := range []string{SelOpenAP, SelCloseAP} {
		if _, ok := LocationCommandVerb(cmd); ok {
			t.Errorf("%q reads as a location narrowing", cmd)
		}
		if _, ok := SelectionCommandVerb(cmd); !ok {
			t.Errorf("%q must be an actuation", cmd)
		}
	}
	for _, cmd := range []string{SelSelectLoc, SelSelectLocClose} {
		if _, ok := SelectionCommandVerb(cmd); ok {
			t.Errorf("%q must never yield an actuation verb", cmd)
		}
		if _, ok := LocationCommandVerb(cmd); !ok {
			t.Errorf("%q must be a narrowing step", cmd)
		}
	}
	for _, cmd := range []string{"", "select_loc_", "select_locclose", "close_loc", "closet", "wat"} {
		if _, ok := LocationCommandVerb(cmd); ok {
			t.Errorf("%q must not read as a narrowing step", cmd)
		}
	}
	// select_loc_close is on the ParseSelection allowlist, or the tap it mints
	// would be rejected as an id this gateway never wrote.
	if cmd, arg, ok := ParseSelection("select_loc_close:l1"); !ok || cmd != SelSelectLocClose || arg != "l1" {
		t.Errorf("ParseSelection(select_loc_close:l1) = (%q,%q,%v)", cmd, arg, ok)
	}
}

// TestEveryMintedIDIsAcceptedBack closes the loop: every id any renderer here
// writes must survive ParseSelection and resolve to the verb it was rendered
// with. An id the gateway mints and then refuses is a dead button; an id that
// resolves to the OTHER verb is the defect.
func TestEveryMintedIDIsAcceptedBack(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	for _, verb := range []GateVerb{VerbOpen, VerbClose} {
		var ids []string
		for _, r := range PushGateMenu(verb, "Home", gates, testPortal).Interactive.Action.Sections[0].Rows {
			ids = append(ids, r.ID)
		}
		for _, r := range PushAmbiguousGateMenu(verb, gates, testPortal).Interactive.Action.Sections[0].Rows {
			ids = append(ids, r.ID)
		}
		ids = append(ids, PushGateMenu(verb, "Home", gates[:1], testPortal).Interactive.Action.Buttons[0].Reply.ID)
		for _, id := range ids {
			cmd, arg, ok := ParseSelection(id)
			if !ok || arg == "" {
				t.Fatalf("%v minted an unparseable id: %q", verb, id)
			}
			got, ok := SelectionCommandVerb(cmd)
			if !ok || got != verb.Command() {
				t.Errorf("%q rendered for %v resolves to %q", id, verb, got)
			}
		}
	}

	// PushCloseButton is the post-open follow-up and is close by construction.
	id := PushCloseButton("ap1", "Main gate").Interactive.Action.Buttons[0].Reply.ID
	cmd, _, ok := ParseSelection(id)
	if v, vok := SelectionCommandVerb(cmd); !ok || !vok || v != "close" {
		t.Errorf("post-open follow-up button %q is not a close", id)
	}
}

// TestTextGateVerbHasNoDefault: reading the verb out of free text is allowed to
// fail. It must fail rather than pick one — docs/CHAT-COMMANDS.md §3.5, and the
// same lesson ParseSelection learned when it stopped returning "open" for an
// id it did not recognise.
func TestTextGateVerbHasNoDefault(t *testing.T) {
	for _, tc := range []struct {
		body string
		want GateVerb
		ok   bool
	}{
		{"open", VerbOpen, true},
		{"please open the side gate", VerbOpen, true},
		{"close", VerbClose, true},
		{"close the back gate", VerbClose, true},
		// Both named → the reading that leaves the gate shut wins.
		{"close the gate, don't open it", VerbClose, true},
		// A gate name and no action is a question, not a command.
		{"side door", verbUnset, false},
		{"back gate", verbUnset, false},
		{"", verbUnset, false},
		{"thanks!", verbUnset, false},
		{"gates", verbUnset, false},
	} {
		got, ok := TextGateVerb(tc.body)
		if got != tc.want || ok != tc.ok {
			t.Errorf("TextGateVerb(%q) = (%v,%v), want (%v,%v)", tc.body, got, ok, tc.want, tc.ok)
		}
	}
}

// TestGateVerbForCommandIsTheClosedVocabulary: the map back from the open-path
// command string is exactly {open, close}, matching store/openpath.go.
func TestGateVerbForCommandIsTheClosedVocabulary(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want GateVerb
		ok   bool
	}{
		{"open", VerbOpen, true},
		{"close", VerbClose, true},
		{"Open", verbUnset, false},
		{"opened", verbUnset, false},
		{"closet", verbUnset, false},
		{"", verbUnset, false},
	} {
		got, ok := GateVerbForCommand(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("GateVerbForCommand(%q) = (%v,%v), want (%v,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
	// Round-trip: both verbs survive the trip through the choke point's
	// vocabulary unchanged.
	for _, v := range []GateVerb{VerbOpen, VerbClose} {
		if back, ok := GateVerbForCommand(v.Command()); !ok || back != v {
			t.Errorf("%v did not round-trip: %v %v", v, back, ok)
		}
	}
}

// TestDMTAPPromptsAskForTheVerbBack: the text-only rail has no button to carry
// the verb across a turn, so the question has to. "Reply with its name" invited
// an answer with no verb in it, and a verbless answer used to open.
func TestDMTAPPromptsAskForTheVerbBack(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	closeP := DMTAPGatePrompt(VerbClose, gates, testPortal)
	if !strings.Contains(closeP, `"close <name>"`) || !strings.Contains(closeP, `"close Main gate"`) {
		t.Errorf("close prompt does not ask for the verb back: %q", closeP)
	}
	if strings.Contains(closeP, "Reply with its name") {
		t.Errorf("close prompt still invites a verbless answer: %q", closeP)
	}
	if !strings.Contains(closeP, "1. Main gate (Home)") {
		t.Errorf("close prompt lost the gate list: %q", closeP)
	}

	openP := DMTAPGatePrompt(VerbOpen, gates, testPortal)
	if !strings.Contains(openP, `"open <name>"`) || strings.Contains(openP, "close") {
		t.Errorf("open prompt: %q", openP)
	}

	amb := DMTAPAmbiguousPrompt(VerbClose, gates, testPortal)
	if !strings.Contains(amb, "haven't closed anything") || !strings.Contains(amb, `"close <name>"`) {
		t.Errorf("ambiguous close prompt: %q", amb)
	}
	if !strings.Contains(DMTAPAmbiguousPrompt(VerbOpen, gates, testPortal), "haven't opened anything") {
		t.Error("ambiguous open prompt lost its past tense")
	}

	// The greeting names both verbs and never invites a bare name.
	menu := DMTAPMenu("Ada")
	if !strings.Contains(menu, `"open"`) || !strings.Contains(menu, `"close"`) {
		t.Errorf("dmtap menu must name both verbs: %q", menu)
	}
	if strings.Contains(menu, "name one directly") {
		t.Errorf("dmtap menu still invites a verbless gate name: %q", menu)
	}

	// An empty candidate list must not panic on the example.
	if got := DMTAPGatePrompt(VerbClose, nil, testPortal); !strings.Contains(got, "<name>") {
		t.Errorf("empty prompt: %q", got)
	}
}
