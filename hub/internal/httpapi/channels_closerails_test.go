package httpapi

// Handler-level tests for the fifth defect on the chat gate route — the one
// c5c697b found, named in its commit message and deliberately did NOT fix:
//
//	"Telegram and Slack are deliberately unchanged: neither rail can lose a
//	 close, because their handlers only ever accept open. Rendering close rows
//	 there would mint buttons their callback handlers refuse. That leaves close
//	 unreachable on those two rails while open is not — a real violation of
//	 'close is never harder to reach than open'."
//
// On Telegram the text matcher accepted only "open"/"gates" and
// processTGCallback refused any callback that was not SelOpenAP. On Slack
// AccessBlocks only ever minted open_gate: buttons and the interaction handler
// only handled that prefix. A resident who could open a gate from either rail
// could not close it from either rail: the invariant broken in the one
// direction that matters, on the safety-increasing verb.
//
// These tests prove the WIRING end to end — real signed webhook deliveries in,
// audited rows out — not the renderers. Renderer-level assertions live in
// internal/channels/closerails_test.go. Everything here is written against
// literal wire strings rather than the channels constants, deliberately: that
// makes the file compile against the PRE-change tree, so its failures are real
// runtime failures rather than a build error.
//
// Baseline against c4a0b1f (before the fix), source reverted, these tests
// present — quoted verbatim in the report:
//
//	channels_closerails_test.go:85: "close" must render a gate picker, got
//	    [{channel:C1 text:Hi T. / I can help you open your linked gates. …}]
//	--- FAIL: TestSlackCloseIsReachableAndOnlyCloses (0.23s)
//	channels_closerails_test.go:139: "close" must render an inline-keyboard
//	    picker: [{chat:999001 text:Hi T. / Send "open" to open your linked
//	    gates. kb:<nil>}]
//	--- FAIL: TestTelegramCloseIsReachableAndOnlyCloses (0.21s)
//	channels_closerails_test.go:217: close_gate: did not close: 0 closes
//	--- FAIL: TestWireIDsMintedBeforeThisChangeStillMeanWhatTheyMeant (0.22s)
//	channels_closerails_test.go:277: slack action_id
//	    "open_gate:not-an-access-point" opened a gate
//	--- FAIL: TestUnknownActionIDActuatesNothing (0.23s)

import (
	"net/url"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

// slackAction builds a signed-interaction body for an ARBITRARY action_id and
// value — the existing slackInteraction helper hardcodes open_gate:, which is
// the thing under test. Slack echoes back whatever the gateway minted, so this
// is exactly the shape a tap arrives in.
func slackAction(user, actionID, value string) []byte {
	payload := mustJSONBytes(map[string]any{
		"type":    "block_actions",
		"user":    map[string]any{"id": user},
		"channel": map[string]any{"id": "C1"},
		"actions": []map[string]any{{"action_id": actionID, "value": value}},
	})
	return []byte(url.Values{"payload": {string(payload)}}.Encode())
}

// slackActionIDs pulls the action_id off every button in a rendered picker.
func slackActionIDs(t *testing.T, blocks []channels.Block) []string {
	t.Helper()
	var out []string
	for _, b := range blocks {
		acc, ok := b["accessory"].(map[string]any)
		if !ok {
			continue
		}
		id, _ := acc["action_id"].(string)
		out = append(out, id)
	}
	return out
}

// ---------------------------------------------------------------------------
// The defect: close reachable at parity with open, on both rails
// ---------------------------------------------------------------------------

// TestSlackCloseIsReachableAndOnlyCloses drives the whole exchange over real
// signed deliveries: the word "close", then a tap on the button the gateway
// itself offered, echoed back verbatim. Pre-fix "close" fell through to the
// default branch and got the help menu — there was no button to tap.
func TestSlackCloseIsReachableAndOnlyCloses(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	slackPost(e.h, "/webhooks/slack", slackEvent(testSlackUID, "close", "1700000000.10"))
	sent := e.slack.all()
	if len(sent) != 1 || sent[0].blocks == nil {
		t.Fatalf(`"close" must render a gate picker, got %+v`, sent)
	}
	ids := slackActionIDs(t, sent[0].blocks)
	if len(ids) != 1 {
		t.Fatalf("expected one gate button, got %v", ids)
	}
	for _, id := range ids {
		if !strings.HasPrefix(id, "close_gate:") {
			t.Errorf("a close request was answered with a button that does not close: %q", id)
		}
		if strings.HasPrefix(id, "open_gate:") {
			t.Errorf("a close request was answered with a button that OPENS: %q", id)
		}
	}
	if body, _ := sent[0].blocks[0]["text"].(map[string]any); body != nil {
		if txt, _ := body["text"].(string); !strings.Contains(txt, "close") {
			t.Errorf("close picker never says close: %q", txt)
		}
	}
	// Rendering a picker actuates nothing, in either direction.
	if n := e.successOpens(t, channels.KindSlack); n != 0 {
		t.Fatalf("rendering the close picker opened a gate %d time(s)", n)
	}
	if n := e.successCloses(t, channels.KindSlack); n != 0 {
		t.Fatalf("rendering the close picker closed a gate %d time(s)", n)
	}

	// The tap.
	e.slack.sent = nil
	if rec := slackPost(e.h, "/webhooks/slack/interactions", slackAction(testSlackUID, ids[0], e.apID)); rec.Code != 200 {
		t.Fatalf("interaction code: %d", rec.Code)
	}
	if n := e.successCloses(t, channels.KindSlack); n != 1 {
		t.Fatalf("the close must actuate: %d closes audited", n)
	}
	if n := e.successOpens(t, channels.KindSlack); n != 0 {
		t.Fatalf("tapping the answer to a close request opened a gate %d time(s)", n)
	}
	if sent := e.slack.all(); len(sent) != 1 || !strings.Contains(sent[0].text, "Closing gate") {
		t.Fatalf("expected a Closing… reply: %+v", sent)
	}
}

// TestTelegramCloseIsReachableAndOnlyCloses is the same property on the rail
// whose picker is an inline keyboard. Pre-fix "close" hit the default branch
// and got the menu, and even a hand-crafted close_ap: callback was refused by
// processTGCallback's `cmd != SelOpenAP`.
func TestTelegramCloseIsReachableAndOnlyCloses(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door") // two gates → a picker, not a collapse

	tgPost(e.h, tgMessage(testTGUID, testTGChat, 1, "close"))
	sent := e.tg.all()
	if len(sent) != 1 || sent[0].kb == nil || len(sent[0].kb.Rows) != 2 {
		t.Fatalf(`"close" must render an inline-keyboard picker: %+v`, sent)
	}
	if !strings.Contains(sent[0].text, "close") {
		t.Errorf("close picker never says close: %q", sent[0].text)
	}
	for _, row := range sent[0].kb.Rows {
		for _, b := range row {
			if !strings.HasPrefix(b.CallbackData, "close_ap:") {
				t.Errorf("a close request was answered with a button that does not close: %+v", b)
			}
			if strings.HasPrefix(b.CallbackData, "open_ap:") {
				t.Errorf("a close request was answered with a button that OPENS: %+v", b)
			}
		}
	}
	if n := e.successOpens(t, channels.KindTelegram); n != 0 {
		t.Fatalf("rendering the close picker opened a gate %d time(s)", n)
	}
	if n := e.successCloses(t, channels.KindTelegram); n != 0 {
		t.Fatalf("rendering the close picker closed a gate %d time(s)", n)
	}

	// The tap.
	data := sent[0].kb.Rows[0][0].CallbackData
	e.tg.sent = nil
	if rec := tgPost(e.h, tgCallback(testTGUID, testTGChat, data)); rec.Code != 200 {
		t.Fatalf("callback code: %d", rec.Code)
	}
	if n := e.successCloses(t, channels.KindTelegram); n != 1 {
		t.Fatalf("the close must actuate: %d closes audited", n)
	}
	if n := e.successOpens(t, channels.KindTelegram); n != 0 {
		t.Fatalf("tapping the answer to a close request opened a gate %d time(s)", n)
	}
	if sent := e.tg.all(); len(sent) != 1 || !strings.Contains(sent[0].text, "Closing ") {
		t.Fatalf("expected a Closing… reply: %+v", sent)
	}
	if e.tg.callbacks != 1 {
		t.Errorf("callback not answered (spinner not dismissed): %d", e.tg.callbacks)
	}

	// Parity with open's single-gate collapse: one gate and the word is enough,
	// exactly as "open" has always been. Close must never need MORE steps.
	solo := setupChannels(t, permissiveRL())
	tgPost(solo.h, tgMessage(testTGUID, testTGChat, 1, "close"))
	if n := solo.successCloses(t, channels.KindTelegram); n != 1 {
		t.Fatalf("a single-gate close must actuate on the word alone: %d", n)
	}
	if n := solo.successOpens(t, channels.KindTelegram); n != 0 {
		t.Fatalf("a single-gate close opened a gate %d time(s)", n)
	}
}

// ---------------------------------------------------------------------------
// Wire compatibility: add, never repurpose
// ---------------------------------------------------------------------------

// TestWireIDsMintedBeforeThisChangeStillMeanWhatTheyMeant. Buttons carrying
// today's exact ids are already sitting in residents' Telegram chats and Slack
// workspace histories, and a provider echoes them back verbatim whenever they
// are tapped — months later, by someone who has no idea the gateway changed
// underneath them. open_gate:<ap> and open_ap:<ap> must keep opening, and
// nothing else may have been quietly reassigned to that value. The new ids are
// checked alongside them, on the same gates, so the test also proves the two
// schemes coexist rather than one having replaced the other.
func TestWireIDsMintedBeforeThisChangeStillMeanWhatTheyMeant(t *testing.T) {
	// Slack: action_id open_gate:<ap>, value <ap> — the exact shape of every
	// gate button AccessBlocks has ever rendered.
	e := setupChannels(t, permissiveRL())
	slackPost(e.h, "/webhooks/slack/interactions", slackAction(testSlackUID, "open_gate:"+e.apID, e.apID))
	if n := e.successOpens(t, channels.KindSlack); n != 1 {
		t.Fatalf("a Slack button minted before this change no longer opens: %d opens", n)
	}
	if n := e.successCloses(t, channels.KindSlack); n != 0 {
		t.Fatalf("an old open_gate: button was repurposed into a close: %d closes", n)
	}
	slackPost(e.h, "/webhooks/slack/interactions", slackAction(testSlackUID, "close_gate:"+e.apID, e.apID))
	if n := e.successCloses(t, channels.KindSlack); n != 1 {
		t.Fatalf("close_gate: did not close: %d closes", n)
	}
	if n := e.successOpens(t, channels.KindSlack); n != 1 {
		t.Fatalf("close_gate: also opened something: %d opens", n)
	}

	// Telegram: callback data open_ap:<ap>, the value every inline button
	// TelegramGatePicker has ever carried.
	tg := setupChannels(t, permissiveRL())
	tgPost(tg.h, tgCallback(testTGUID, testTGChat, "open_ap:"+tg.apID))
	if n := tg.successOpens(t, channels.KindTelegram); n != 1 {
		t.Fatalf("a Telegram button minted before this change no longer opens: %d opens", n)
	}
	if n := tg.successCloses(t, channels.KindTelegram); n != 0 {
		t.Fatalf("an old open_ap: button was repurposed into a close: %d closes", n)
	}
	tgPost(tg.h, tgCallback(testTGUID, testTGChat, "close_ap:"+tg.apID))
	if n := tg.successCloses(t, channels.KindTelegram); n != 1 {
		t.Fatalf("close_ap: did not close: %d closes", n)
	}
	if n := tg.successOpens(t, channels.KindTelegram); n != 1 {
		t.Fatalf("close_ap: also opened something: %d opens", n)
	}
}

// ---------------------------------------------------------------------------
// Fail closed on anything unrecognised
// ---------------------------------------------------------------------------

// TestUnknownActionIDActuatesNothing. Widening a handler from "one prefix" to
// "two verbs" is exactly where a fallback verb gets introduced, so this pins
// the opposite: an id outside the allowlist resolves to NO verb and moves no
// gate, in either direction.
//
// Two of the Slack cases actuated an open against the pre-fix tree — a small
// fail-open found while widening this handler, not one that was being looked
// for. processSlackInteraction tested only the PREFIX of the action_id and then
// read the access point out of `value`, so "open_gate:<anything at all>" and
// even a bare "open_gate:" opened whatever gate `value` named: the id and the
// target could disagree and the target won. The two halves of a button are now
// parsed together and must agree.
func TestUnknownActionIDActuatesNothing(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	for _, actionID := range []string{
		"open_gate:not-an-access-point", // prefix right, target wrong: value must not win
		"open_gate:",                    // empty target, real value
		"openGate:" + e.apID,            // near-miss command
		"open_gates:" + e.apID,          // near-miss command
		":" + e.apID,                    // empty command
		"open_gate",                     // no separator
		"open_ap:" + e.apID,             // the OTHER rail's scheme
		"close_ap:" + e.apID,            // the other rail's scheme, safe verb
		"select_loc:" + e.apID,          // a narrowing id is never an actuation
		"select_loc_close:" + e.apID,    // ditto
		"hold_gate:" + e.apID,           // a verb the choke point knows, not minted here
		"",
	} {
		if rec := slackPost(e.h, "/webhooks/slack/interactions", slackAction(testSlackUID, actionID, e.apID)); rec.Code != 200 {
			t.Fatalf("%q: interaction code %d", actionID, rec.Code)
		}
		if n := e.successOpens(t, channels.KindSlack); n != 0 {
			t.Fatalf("slack action_id %q opened a gate", actionID)
		}
		if n := e.successCloses(t, channels.KindSlack); n != 0 {
			t.Fatalf("slack action_id %q closed a gate", actionID)
		}
	}

	tg := setupChannels(t, permissiveRL())
	for _, data := range []string{
		"open_ap:",                    // empty target
		"open_ap",                     // no separator
		":" + tg.apID,                 // empty command
		"opened_ap:" + tg.apID,        // near-miss command
		"open_gate:" + tg.apID,        // the OTHER rail's scheme
		"close_gate:" + tg.apID,       // the other rail's scheme, safe verb
		"select_loc:" + tg.apID,       // a narrowing id is never an actuation
		"select_loc_close:" + tg.apID, // ditto
		"open",                        // the word, not an id
		"",
	} {
		if rec := tgPost(tg.h, tgCallback(testTGUID, testTGChat, data)); rec.Code != 200 {
			t.Fatalf("%q: callback code %d", data, rec.Code)
		}
		if n := tg.successOpens(t, channels.KindTelegram); n != 0 {
			t.Fatalf("telegram callback %q opened a gate", data)
		}
		if n := tg.successCloses(t, channels.KindTelegram); n != 0 {
			t.Fatalf("telegram callback %q closed a gate", data)
		}
	}

	// …and the real ids still work, so none of the above passed by breaking the
	// rails outright.
	slackPost(e.h, "/webhooks/slack/interactions", slackAction(testSlackUID, "close_gate:"+e.apID, e.apID))
	if n := e.successCloses(t, channels.KindSlack); n != 1 {
		t.Fatalf("a real slack close id stopped working: %d", n)
	}
	tgPost(tg.h, tgCallback(testTGUID, testTGChat, "close_ap:"+tg.apID))
	if n := tg.successCloses(t, channels.KindTelegram); n != 1 {
		t.Fatalf("a real telegram close id stopped working: %d", n)
	}
}
