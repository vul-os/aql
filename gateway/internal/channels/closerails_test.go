package channels

// Renderer-level tests for close reaching Telegram and Slack — the half of the
// fix that mints the buttons. The wiring proof (a resident can close a gate
// they can open, end to end over signed webhook deliveries, with zero audited
// opens) lives in httpapi/channels_closerails_test.go; these pin the pieces
// that make it true.
//
// Most of this file cannot compile against the pre-fix tree at all:
// AccessBlocks and TelegramGatePicker took no verb, which is the defect —
// there was no way to ask either of them for a picker that closes. That
// compile failure IS the forcing function, the same one PushGateMenu's verb
// parameter used in c5c697b: every existing call site had to be reopened and
// given a verb by hand.

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/store"
)

// slackAccessories returns (action_id, button label) for every gate button.
func slackAccessories(t *testing.T, blocks []Block) [][2]string {
	t.Helper()
	var out [][2]string
	for _, b := range blocks {
		acc, ok := b["accessory"].(map[string]any)
		if !ok {
			continue
		}
		id, _ := acc["action_id"].(string)
		txt, _ := acc["text"].(map[string]any)
		label, _ := txt["text"].(string)
		out = append(out, [2]string{id, label})
	}
	return out
}

// TestSlackBlocksStayUnderCeilingForBothVerbs. Slack rejects a message over
// SlackMaxBlocks outright — an over-ceiling picker does not truncate, it simply
// fails to send and the resident gets nothing. Adding a verb must not change
// that accounting, which is the concrete reason close is ONE button per gate in
// the verb that was asked for rather than an Open/Close pair: a Block Kit
// section carries at most one accessory, so a pair needs a second block per
// gate and the ceiling arrives at half the fleet size.
func TestSlackBlocksStayUnderCeilingForBothVerbs(t *testing.T) {
	for _, n := range []int{1, 10, 50, 200} {
		gates := manyGates(n)
		open := AccessBlocks(VerbOpen, "Ada", gates, testPortal)
		closed := AccessBlocks(VerbClose, "Ada", gates, testPortal)

		for _, tc := range []struct {
			verb   string
			blocks []Block
		}{{"open", open}, {"close", closed}} {
			if len(tc.blocks) > SlackMaxBlocks {
				t.Fatalf("%d gates, %s → %d blocks, over the %d ceiling", n, tc.verb, len(tc.blocks), SlackMaxBlocks)
			}
			want := n
			if want > PickerCapacity {
				want = PickerCapacity
			}
			if got := len(slackAccessories(t, tc.blocks)); got != want {
				t.Errorf("%d gates, %s → %d gate buttons, want %d", n, tc.verb, got, want)
			}
		}
		// The verb changes the label and the id, never the block count — so
		// TruncationNotice keeps counting the same thing it always counted, and
		// the "Showing 10 of 200" line stays honest for both verbs.
		if len(open) != len(closed) {
			t.Errorf("%d gates: open renders %d blocks, close renders %d", n, len(open), len(closed))
		}
		if n > PickerCapacity {
			for _, tc := range []struct {
				verb   string
				blocks []Block
			}{{"open", open}, {"close", closed}} {
				last := tc.blocks[len(tc.blocks)-1]
				els, _ := last["elements"].([]any)
				if last["type"] != "context" || len(els) != 1 {
					t.Fatalf("%d gates, %s: no truncation notice: %+v", n, tc.verb, last)
				}
				txt, _ := els[0].(map[string]any)["text"].(string)
				if !strings.Contains(txt, "of "+itoa(int64(n))) || !strings.Contains(txt, "Showing 10 ") {
					t.Errorf("%d gates, %s: dishonest notice %q", n, tc.verb, txt)
				}
			}
		}
	}
}

// TestSlackCloseBlocksNeverOfferOpen is the defect at the renderer: asked for a
// close picker, every button must close.
func TestSlackCloseBlocksNeverOfferOpen(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	for _, b := range slackAccessories(t, AccessBlocks(VerbClose, "Ada", gates, testPortal)) {
		if !strings.HasPrefix(b[0], "close_gate:") || b[1] != "Close" {
			t.Errorf("close picker button opens or is mislabelled: %+v", b)
		}
	}
	body, _ := AccessBlocks(VerbClose, "Ada", gates, testPortal)[0]["text"].(map[string]any)
	txt, _ := body["text"].(string)
	if !strings.Contains(txt, "haven't closed") || !strings.Contains(txt, "close?") {
		t.Errorf("close picker must say plainly that nothing moved: %q", txt)
	}
	if strings.Contains(txt, "open") {
		t.Errorf("close picker offers open: %q", txt)
	}

	// An unset verb renders the closing form, never the opening one — the same
	// fail-closed property the zero value has everywhere else (verb.go).
	var forgotten GateVerb
	for _, b := range slackAccessories(t, AccessBlocks(forgotten, "Ada", gates, testPortal)) {
		if !strings.HasPrefix(b[0], "close_gate:") {
			t.Errorf("an unset verb minted a Slack button that opens: %+v", b)
		}
	}
}

// TestSlackOpenBlocksAreByteIdentical: the open picker is what Slack has been
// rendering all along and what every already-delivered button was minted from.
// Threading a verb through it must be invisible on that path.
func TestSlackOpenBlocksAreByteIdentical(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}
	blocks := AccessBlocks(VerbOpen, "Ada", gates, testPortal)

	head, _ := blocks[0]["text"].(map[string]any)
	if got, _ := head["text"].(string); got != "Hi *Ada*, which gate would you like to open?" {
		t.Errorf("open picker copy changed: %q", got)
	}
	want := [][2]string{{"open_gate:ap1", "Open"}, {"open_gate:ap2", "Open"}}
	got := slackAccessories(t, blocks)
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("open picker buttons changed: %+v", got)
	}
	// The empty-name fallback is part of that contract too.
	nameless, _ := AccessBlocks(VerbOpen, "", gates, testPortal)[0]["text"].(map[string]any)
	if txt, _ := nameless["text"].(string); txt != "Hi *there*, which gate would you like to open?" {
		t.Errorf("nameless open picker copy changed: %q", txt)
	}
}

// TestTelegramPickerRendersTheVerbItWasGiven, including the fail-closed zero
// value and the unchanged open rendering.
func TestTelegramPickerRendersTheVerbItWasGiven(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	_, openKB := TelegramGatePicker(VerbOpen, "Which gate would you like to open?", gates, testPortal)
	want := [][2]string{{"Open Main gate", "open_ap:ap1"}, {"Open Side door", "open_ap:ap2"}}
	for i, row := range openKB.Rows {
		if len(row) != 1 {
			t.Fatalf("one button per row, got %d: %+v", len(row), row)
		}
		if row[0].Text != want[i][0] || row[0].CallbackData != want[i][1] {
			t.Errorf("open keyboard changed: %+v", row[0])
		}
	}

	_, closeKB := TelegramGatePicker(VerbClose, "I haven't closed anything. Which gate would you like to close?", gates, testPortal)
	for i, row := range closeKB.Rows {
		if len(row) != 1 {
			// One button per row is the safety choice, not an accident: an
			// Open/Close pair puts the two thumb targets a few millimetres apart
			// and truncates both labels on a narrow screen.
			t.Fatalf("close keyboard must not pair buttons in a row: %+v", row)
		}
		if !strings.HasPrefix(row[0].CallbackData, "close_ap:") || !strings.HasPrefix(row[0].Text, "Close ") {
			t.Errorf("close keyboard row %d opens or is mislabelled: %+v", i, row[0])
		}
	}

	var forgotten GateVerb
	_, unsetKB := TelegramGatePicker(forgotten, "…", gates, testPortal)
	for _, row := range unsetKB.Rows {
		if !strings.HasPrefix(row[0].CallbackData, "close_ap:") {
			t.Errorf("an unset verb minted a Telegram button that opens: %+v", row[0])
		}
	}

	// The cap and its disclosure hold for close exactly as they do for open.
	body, kb := TelegramGatePicker(VerbClose, "Which gate would you like to close?", manyGates(34), testPortal)
	if len(kb.Rows) != PickerCapacity {
		t.Errorf("close keyboard rows: %d", len(kb.Rows))
	}
	if !strings.Contains(body, "Showing 10 of 34") {
		t.Errorf("close keyboard truncated silently: %q", body)
	}
}

// TestEverySlackActionIDIsAcceptedBack closes the loop on Slack's own id
// scheme, the way TestEveryMintedIDIsAcceptedBack does for the interactive-
// reply scheme: every action_id AccessBlocks writes must survive
// ParseSlackAction and come back as the verb it was rendered with. An id the
// gateway mints and then refuses is a dead button — the exact outcome c5c697b
// declined to create, and the reason both halves of this change ship together.
func TestEverySlackActionIDIsAcceptedBack(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap("ap2", "Side door", "Home")}

	for _, verb := range []GateVerb{VerbOpen, VerbClose} {
		for _, b := range slackAccessories(t, AccessBlocks(verb, "Ada", gates, testPortal)) {
			got, apID, ok := ParseSlackAction(b[0])
			if !ok {
				t.Fatalf("%v minted an action_id its own handler refuses: %q", verb, b[0])
			}
			if got != verb {
				t.Errorf("%q rendered for %v resolves to %v", b[0], verb, got)
			}
			if apID == "" {
				t.Errorf("%q carries no access point", b[0])
			}
		}
	}
}

// TestParseSlackActionFailsClosed. There is no fallback verb and no fallback
// target: an id outside the allowlist yields ok=false, and the zero GateVerb it
// returns alongside is the closing one anyway.
func TestParseSlackActionFailsClosed(t *testing.T) {
	for _, id := range []string{
		"", "open_gate", "open_gate:", ":ap1", "openGate:ap1", "open_gates:ap1",
		"hold_gate:ap1", "repair:ap1",
		// The other rails' scheme. Each rail's ids are its own; crossing them is
		// how an id nobody minted for this handler gets accepted by it.
		"open_ap:ap1", "close_ap:ap1", "select_loc:l1", "select_loc_close:l1",
	} {
		v, apID, ok := ParseSlackAction(id)
		if ok {
			t.Errorf("ParseSlackAction(%q) accepted an id this gateway never minted", id)
		}
		if v.Valid() || apID != "" {
			t.Errorf("ParseSlackAction(%q) = (%v, %q, %v): a refusal must carry nothing usable", id, v, apID, ok)
		}
		if v.Command() != "close" {
			t.Errorf("ParseSlackAction(%q) refusal verb actuates %q", id, v.Command())
		}
	}
	// The two real ones, both ways.
	if v, apID, ok := ParseSlackAction("open_gate:ap1"); !ok || v != VerbOpen || apID != "ap1" {
		t.Errorf(`ParseSlackAction("open_gate:ap1") = (%v,%q,%v)`, v, apID, ok)
	}
	if v, apID, ok := ParseSlackAction("close_gate:ap1"); !ok || v != VerbClose || apID != "ap1" {
		t.Errorf(`ParseSlackAction("close_gate:ap1") = (%v,%q,%v)`, v, apID, ok)
	}
	// An access point id containing a colon still resolves whole — the split is
	// on the FIRST separator, matching ParseSelection.
	if v, apID, ok := ParseSlackAction("close_gate:ap:1"); !ok || v != VerbClose || apID != "ap:1" {
		t.Errorf(`ParseSlackAction("close_gate:ap:1") = (%v,%q,%v)`, v, apID, ok)
	}
	// SlackActionVerb draws the same line on its own.
	for _, cmd := range []string{"", "open_ap", "close_ap", "select_loc", "open_gates", "OPEN_GATE"} {
		if _, ok := SlackActionVerb(cmd); ok {
			t.Errorf("SlackActionVerb(%q) must not resolve", cmd)
		}
	}
	if v, ok := SlackActionVerb(SlackActOpenGate); !ok || v != VerbOpen {
		t.Error("open_gate must resolve to open")
	}
	if v, ok := SlackActionVerb(SlackActCloseGate); !ok || v != VerbClose {
		t.Error("close_gate must resolve to close")
	}
	// And the mint side fails closed too: only an explicit VerbOpen opens.
	var forgotten GateVerb
	if forgotten.SlackActionCommand() != SlackActCloseGate || VerbClose.SlackActionCommand() != SlackActCloseGate {
		t.Error("an unset verb must mint close_gate")
	}
	if VerbOpen.SlackActionCommand() != SlackActOpenGate {
		t.Error("VerbOpen must mint open_gate")
	}
}

// TestBothRailMenusNameBothVerbs. Reachability is not only what the handler
// would accept: on rails whose entire interface is a message, a menu that names
// only "open" is a menu on which close does not exist.
func TestBothRailMenusNameBothVerbs(t *testing.T) {
	for name, menu := range map[string]string{
		"slack":    SlackMenu("Ada"),
		"telegram": TelegramMenu("Ada"),
		"dmtap":    DMTAPMenu("Ada"),
	} {
		if !strings.Contains(menu, `"open"`) || !strings.Contains(menu, `"close"`) {
			t.Errorf("%s menu must name both verbs: %q", name, menu)
		}
	}
}
