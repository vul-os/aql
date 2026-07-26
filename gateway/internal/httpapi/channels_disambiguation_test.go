package httpapi

// Handler-level regression tests for the three fail-open defects in the chat
// target-resolution path (docs/CHAT-COMMANDS.md §2.2a, §2.2c, §2.2d). The pure
// matcher/renderer tests live in internal/channels; these prove the WIRING —
// that an ambiguous message and an unrecognised selection reach the choke
// point ZERO times, which is the property that actually keeps a gate shut.

import (
	"strconv"
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/channels"
)

// TestWhatsAppAmbiguousGateMentionNeverOpens is the shipped-fleet case: an
// account holding both `Gate` and `Front Gate`. "open the front gate" names
// both, so it must open NEITHER and ask instead. Pre-fix, FindMentionedGate
// returned the first substring hit and the gate opened.
func TestWhatsAppAmbiguousGateMentionNeverOpens(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Gate")
	createAP(t, e.h, e.ownerA, e.loc, "Front Gate")

	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.amb1", "open the front gate", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("ambiguous mention opened a gate %d time(s) — it must ask, never guess", n)
	}
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil || sent[0].interactive.Type != "list" {
		t.Fatalf("expected a disambiguation picker: %+v", sent)
	}
	body := sent[0].interactive.Body.Text
	if !strings.Contains(body, "more than one") || !strings.Contains(body, "haven't opened") {
		t.Errorf("picker must say plainly that nothing opened: %q", body)
	}
	rows := sent[0].interactive.Action.Sections[0].Rows
	if len(rows) != 2 {
		t.Fatalf("picker should list exactly the two matches: %+v", rows)
	}
	for _, r := range rows {
		if !strings.HasPrefix(r.ID, "open_ap:") {
			t.Errorf("row is not a re-authorized open_ap selection: %+v", r)
		}
	}
}

// TestWhatsAppAmbiguousCloseOffersCloseRows: an unresolved "close" must not be
// answered with a picker whose rows OPEN. Stopping must never be harder than
// starting, and it must never turn into starting.
func TestWhatsAppAmbiguousCloseOffersCloseRows(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Gate")
	createAP(t, e.h, e.ownerA, e.loc, "Front Gate")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.ambc", "close the front gate", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("ambiguous close opened a gate %d time(s)", n)
	}
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil {
		t.Fatalf("expected a picker: %+v", sent)
	}
	if !strings.Contains(sent[0].interactive.Body.Text, "haven't closed") {
		t.Errorf("body: %q", sent[0].interactive.Body.Text)
	}
	for _, r := range sent[0].interactive.Action.Sections[0].Rows {
		if !strings.HasPrefix(r.ID, "close_ap:") {
			t.Errorf("close ambiguity offered a row that opens: %+v", r)
		}
	}
}

// TestWhatsAppUnambiguousMentionStillOpens is the other half of the contract:
// hardening ambiguity must not break the single-match path.
func TestWhatsAppUnambiguousMentionStillOpens(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.uniq", "open the side door", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("a uniquely named gate must still open: %d", n)
	}
	if sent := e.wa.all(); len(sent) == 0 || !strings.Contains(sent[0].body, "Opening Side door") {
		t.Fatalf("open reply: %+v", e.wa.all())
	}
}

// TestWhatsAppSubstringOfLongerWordIsNotAMention: "gatehouse" must not
// actuate a gate named `Gate`. Pre-fix this was a bare strings.Contains hit.
func TestWhatsAppSubstringOfLongerWordIsNotAMention(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Gate")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.sub", "open the gatehouse", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("a name buried in a longer word must not resolve: %d opens", n)
	}
}

// TestWhatsAppUnprefixedSelectionNeverOpens: an interactive reply id with no
// "cmd:" prefix used to parse as ("open", id) and actuate. It must now be
// refused with an honest reply and no audit-visible open.
func TestWhatsAppUnprefixedSelectionNeverOpens(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	rec := waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.bare", e.apID, "Open Main gate"))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("unprefixed selection id opened the gate %d time(s)", n)
	}
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].body != channels.UnknownSelectionMessage {
		t.Fatalf("expected the honest unknown-selection reply: %+v", sent)
	}
}

// TestWhatsAppUnknownSelectionPrefixNeverOpens: a prefix outside the allowlist
// fell through to the same "open" default (only "close…" was special-cased).
func TestWhatsAppUnknownSelectionPrefixNeverOpens(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	for _, id := range []string{"wat:" + e.apID, "open:" + e.apID, "openap:" + e.apID, "open_ap:", ":" + e.apID} {
		e.wa.sent = nil
		waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid."+id, id, "Open Main gate"))
		if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
			t.Fatalf("selection id %q opened the gate", id)
		}
	}
}

// TestWhatsAppKnownSelectionsStillWork pins the flows that must NOT change:
// open_ap actuates, close_ap actuates a close, select_loc narrows.
func TestWhatsAppKnownSelectionsStillWork(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.k1", "open_ap:"+e.apID, "Open Main gate"))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("open_ap must still open: %d", n)
	}
	e.wa.sent = nil
	waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.k2", "close_ap:"+e.apID, "Close Main gate"))
	if sent := e.wa.all(); len(sent) == 0 || !strings.Contains(sent[0].body, "Closing Main gate") {
		t.Fatalf("close_ap must still close: %+v", e.wa.all())
	}
	e.wa.sent = nil
	waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.k3", "select_loc:"+e.loc, "Home"))
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil {
		t.Fatalf("select_loc must still render the gate menu: %+v", sent)
	}
}

// TestTelegramUnknownCallbackDataNeverOpens guards Telegram's redemption path.
// (This one already failed closed before the fix — the caller compared against
// "open_ap" — so it is a guard, not a regression proof.)
func TestTelegramUnknownCallbackDataNeverOpens(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	for _, data := range []string{e.apID, "wat:" + e.apID, "open:" + e.apID, "open_ap:"} {
		tgPost(e.h, tgCallback(testTGUID, testTGChat, data))
		if n := e.successOpens(t, channels.KindTelegram); n != 0 {
			t.Fatalf("callback data %q opened the gate", data)
		}
	}
}

// TestSlackPickerStaysUnderBlockCeiling: past ~49 gates the uncapped picker
// exceeded Slack's 50-block limit and the whole reply failed to send, so the
// member got nothing at all. It must now cap and disclose.
func TestSlackPickerStaysUnderBlockCeiling(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	const extra = 60
	for i := 0; i < extra; i++ {
		createAP(t, e.h, e.ownerA, e.loc, "Gate "+strconv.Itoa(i))
	}

	body := mustJSONBytes(map[string]any{
		"type":    "event_callback",
		"team_id": "T1",
		"event":   map[string]any{"type": "message", "user": testSlackUID, "channel": "C1", "text": "open", "ts": "1700000000.0002"},
	})
	if rec := slackPost(e.h, "/webhooks/slack", body); rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.slack.all()
	if len(sent) != 1 || sent[0].blocks == nil {
		t.Fatalf("expected one blocks reply: %+v", sent)
	}
	blocks := sent[0].blocks
	if len(blocks) > channels.SlackMaxBlocks {
		t.Fatalf("%d blocks for %d gates — over Slack's %d ceiling, the reply never sends",
			len(blocks), extra+1, channels.SlackMaxBlocks)
	}
	last := blocks[len(blocks)-1]
	els, _ := last["elements"].([]any)
	if last["type"] != "context" || len(els) != 1 {
		t.Fatalf("truncated picker must carry a disclosure block: %+v", last)
	}
	notice := els[0].(map[string]any)["text"].(string)
	if !strings.Contains(notice, "Showing 10 of 61") || !strings.Contains(notice, "https://gate.example/app") {
		t.Errorf("disclosure must name the real totals and where the rest are: %q", notice)
	}
	if n := e.successOpens(t, channels.KindSlack); n != 0 {
		t.Fatalf("rendering a picker must not open anything: %d", n)
	}
}

// TestWhatsAppPickerDisclosesTruncation: WhatsApp caps at 10 rows and, unlike
// before, says so rather than showing a list that looks complete.
func TestWhatsAppPickerDisclosesTruncation(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	for i := 0; i < 11; i++ {
		createAP(t, e.h, e.ownerA, e.loc, "Gate "+strconv.Itoa(i))
	}

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.trunc", "open", waPhoneID))
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil {
		t.Fatalf("expected a picker: %+v", sent)
	}
	rows := sent[0].interactive.Action.Sections[0].Rows
	if len(rows) != channels.PickerCapacity {
		t.Fatalf("rows: %d", len(rows))
	}
	if got := sent[0].interactive.Body.Text; !strings.Contains(got, "Showing 10 of 12") {
		t.Errorf("truncated picker must say so: %q", got)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("rendering a picker must not open anything: %d", n)
	}
}
