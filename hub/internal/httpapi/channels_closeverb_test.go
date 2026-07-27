package httpapi

// Handler-level regression tests for the fourth fail-open defect on the chat
// gate route — the one e10c06a found, named in its commit message and
// deliberately did NOT fix:
//
//	"Known, pre-existing, not widened here: a "close" resolving to no gate
//	 still shows an Open picker, because PushGateMenu is shared with welcome
//	 menus where open is the right default."
//
// A resident texts "close the back gate". Nothing resolves. The fallback
// renders the shared gate picker — whose rows were unconditionally open_ap: —
// so the answer to "close this" was a button that opens. That is the same
// hazard class as the ambiguity bug e10c06a did fix (PushAmbiguousGateMenu
// takes a verb precisely so an unresolved close cannot come back as an open),
// only one branch over.
//
// These tests prove the WIRING, not the renderer: what matters is that no
// sequence of real webhook deliveries starting from a close request ever lands
// a successful `open` in access_logs. The renderer-level assertions live in
// internal/channels (verb_test.go).
//
// Baseline against e10c06a (before the fix), quoted verbatim in the report:
// TestWhatsAppUnresolvedCloseOffersCloseRows,
// TestWhatsAppCloseRequestNeverActuatesAnOpen,
// TestWhatsAppCloseKeepsTheVerbAcrossTheLocationHop and
// TestDMTAPCloseFollowUpNeverOpens all FAIL; the two guards
// (TestWhatsAppWelcomeMenuStillOffersOpen,
// TestWhatsAppAmbiguousCloseStillOffersClose) pass before and after — they
// exist to stop this fix from breaking the greeting default or regressing
// e10c06a's ambiguity fix, so passing first is what they are for.

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

// successCloses counts audited successful closes, the mirror of successOpens.
// A close request must produce these and never the other kind.
func (e *chEnv) successCloses(t *testing.T, source string) int {
	t.Helper()
	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 100)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range logs {
		if l.Success && l.Command == "close" && l.Source == source {
			n++
		}
	}
	return n
}

// addLocation creates a second location inside the SAME account, so the owner's
// verified phone reaches gates at both (member access is account-scoped:
// store/channels.go AvailableAccessPointsByPhone joins account_members).
func addLocation(t *testing.T, e *chEnv, name string) string {
	t.Helper()
	rec, out := doJSON(t, e.h, "POST", "/v1/accounts/"+e.acct+"/locations", e.ownerA, map[string]any{
		"type": "building", "name": name,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("location create: %d %s", rec.Code, rec.Body)
	}
	return out["id"].(string)
}

// pickerRows returns the rows of the single interactive list reply just sent.
func pickerRows(t *testing.T, e *chEnv) []channels.WhatsAppRow {
	t.Helper()
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil {
		t.Fatalf("expected exactly one interactive reply: %+v", sent)
	}
	if len(sent[0].interactive.Action.Sections) == 0 {
		t.Fatalf("expected a list picker, got %+v", sent[0].interactive)
	}
	return sent[0].interactive.Action.Sections[0].Rows
}

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

// TestWhatsAppUnresolvedCloseOffersCloseRows is the reported case: "close the
// <something we don't have>" resolves to no gate, and the fallback picker must
// offer CLOSE. Pre-fix every row was open_ap: — a request to shut a gate came
// back as buttons that open one.
func TestWhatsAppUnresolvedCloseOffersCloseRows(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door") // two gates → a list, not a collapse

	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.cu1", "close the barn", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("an unresolved close opened a gate %d time(s)", n)
	}
	rows := pickerRows(t, e)
	if len(rows) != 2 {
		t.Fatalf("picker should list both gates: %+v", rows)
	}
	for _, r := range rows {
		if !strings.HasPrefix(r.ID, "close_ap:") {
			t.Errorf("a close request was answered with a row that OPENS: %+v", r)
		}
		if strings.HasPrefix(r.ID, "open_ap:") {
			t.Errorf("row mints an open selection: %+v", r)
		}
	}
	body := e.wa.all()[0].interactive.Body.Text
	if strings.Contains(body, "open?") || strings.Contains(body, "to open") {
		t.Errorf("close picker asks to open: %q", body)
	}
	if !strings.Contains(body, "close") {
		t.Errorf("close picker never says close: %q", body)
	}
}

// TestWhatsAppCloseRequestNeverActuatesAnOpen is the property that actually
// keeps a gate shut: drive the WHOLE exchange over real webhook deliveries —
// the close request, then a tap on the row the gateway itself offered, echoed
// back verbatim the way Meta echoes it — and require that zero successful
// `open` rows exist in the audit log at the end. Pre-fix the offered row was
// open_ap:<id>, so tapping the answer to "close" opened the gate.
func TestWhatsAppCloseRequestNeverActuatesAnOpen(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.cu2", "close the barn", waPhoneID))
	rows := pickerRows(t, e)

	e.wa.sent = nil
	waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.cu2tap", rows[0].ID, rows[0].Title))

	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("tapping the answer to a close request opened a gate %d time(s)", n)
	}
	if n := e.successCloses(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("the close must still actuate: %d closes audited", n)
	}
	if sent := e.wa.all(); len(sent) != 1 || !strings.Contains(sent[0].body, "Closing ") {
		t.Fatalf("expected a Closing… reply: %+v", sent)
	}
}

// TestWhatsAppCloseKeepsTheVerbAcrossTheLocationHop: with gates at more than
// one location the close request is answered by the LOCATION picker first, so
// the verb has to survive that hop or it is lost one message later. Pre-fix
// the location rows carried no verb and the gate menu after the tap rendered
// open_ap: — the close silently became an open two taps in.
func TestWhatsAppCloseKeepsTheVerbAcrossTheLocationHop(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	annex := addLocation(t, e, "Annex")
	createAP(t, e.h, e.ownerA, annex, "Annex gate")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.cu3", "close the barn", waPhoneID))
	locRows := pickerRows(t, e)
	if len(locRows) != 2 {
		t.Fatalf("expected a two-location picker: %+v", locRows)
	}

	// Tap "Annex" (the location holding exactly one gate → a single button).
	var annexRow channels.WhatsAppRow
	for _, r := range locRows {
		if r.Title == "Annex" {
			annexRow = r
		}
	}
	if annexRow.ID == "" {
		t.Fatalf("no Annex row: %+v", locRows)
	}
	e.wa.sent = nil
	waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.cu3loc", annexRow.ID, annexRow.Title))

	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil || len(sent[0].interactive.Action.Buttons) != 1 {
		t.Fatalf("expected a single-gate button after the location tap: %+v", sent)
	}
	btn := sent[0].interactive.Action.Buttons[0].Reply
	if !strings.HasPrefix(btn.ID, "close_ap:") {
		t.Fatalf("the verb was lost across the location hop — button %+v opens", btn)
	}

	// …and following it through must close, never open.
	e.wa.sent = nil
	waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.cu3gate", btn.ID, btn.Title))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("a close request opened a gate %d time(s) after two hops", n)
	}
	if n := e.successCloses(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("close not audited: %d", n)
	}
}

// TestDMTAPCloseFollowUpNeverOpens is the same hazard on the text-only rail.
// "close" with several gates answers "Which gate? Reply with its name:" — and
// pre-fix a bare name reply resolved to the DEFAULT verb, which was open. The
// gateway asked the question in a way whose honest answer opened the gate.
func TestDMTAPCloseFollowUpNeverOpens(t *testing.T) {
	e, tr := setupDMTAPChannel(t)
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	e.s.handleDMTAPIntent(context.Background(), channels.DMTAPIntent{
		MemberKeyName: testDMTAPKeyName, GroupID: "g1", Body: "close", IntentID: "dc1",
	})
	replies := tr.all()
	if len(replies) != 1 {
		t.Fatalf("expected one which-gate prompt: %+v", replies)
	}
	if strings.Contains(replies[0].Text, "Reply with its name") {
		t.Errorf("the prompt invites a verbless answer, which then defaults to open: %q", replies[0].Text)
	}

	// The resident answers the question exactly as asked.
	e.s.handleDMTAPIntent(context.Background(), channels.DMTAPIntent{
		MemberKeyName: testDMTAPKeyName, GroupID: "g1", Body: "Side door", IntentID: "dc2",
	})
	if n := e.successOpens(t, channels.KindDMTAP); n != 0 {
		t.Fatalf("answering a close prompt opened a gate %d time(s)", n)
	}

	// Naming the verb still works, both ways.
	e.s.handleDMTAPIntent(context.Background(), channels.DMTAPIntent{
		MemberKeyName: testDMTAPKeyName, GroupID: "g1", Body: "close Side door", IntentID: "dc3",
	})
	if n := e.successCloses(t, channels.KindDMTAP); n != 1 {
		t.Fatalf("an explicit close must still close: %d", n)
	}
	if n := e.successOpens(t, channels.KindDMTAP); n != 0 {
		t.Fatalf("still no opens allowed: %d", n)
	}
}

// ---------------------------------------------------------------------------
// Guards — these must pass BEFORE and after. They are what stops this fix from
// being implemented by widening a default in the other direction.
// ---------------------------------------------------------------------------

// TestWhatsAppWelcomeMenuStillOffersOpen: the greeting/welcome menus share the
// same renderer and genuinely mean open. Threading a verb must not turn a
// friendly "hi" into a picker full of Close buttons.
func TestWhatsAppWelcomeMenuStillOffersOpen(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Side door")

	for _, greeting := range []string{"hi", "hello", "menu", "help"} {
		e.wa.sent = nil
		waPost(e.h, waTextMsg(testPhoneRaw, "wamid.hi."+greeting, greeting, waPhoneID))
		rows := pickerRows(t, e)
		if len(rows) != 2 {
			t.Fatalf("%q: picker rows %+v", greeting, rows)
		}
		for _, r := range rows {
			if !strings.HasPrefix(r.ID, "open_ap:") {
				t.Errorf("%q: welcome menu must still offer open: %+v", greeting, r)
			}
		}
		// The greeting copy is a behavioural contract and must render
		// byte-identically to the pre-change tree.
		if body := e.wa.all()[0].interactive.Body.Text; body != "Welcome to Test House. Which gate would you like to open?" {
			t.Errorf("%q: welcome copy changed: %q", greeting, body)
		}
	}

	// Unrecognised chatter falls back to the same welcome menu, also open.
	e.wa.sent = nil
	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.hi.chat", "thanks!", waPhoneID))
	for _, r := range pickerRows(t, e) {
		if !strings.HasPrefix(r.ID, "open_ap:") {
			t.Errorf("fallback welcome menu must still offer open: %+v", r)
		}
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("rendering a welcome menu must not open anything: %d", n)
	}
}

// TestWhatsAppAmbiguousCloseStillOffersClose guards e10c06a's own fix from this
// change: an ambiguous close already rendered close_ap: rows and must keep
// doing so once the verb is threaded through the sibling renderer.
func TestWhatsAppAmbiguousCloseStillOffersClose(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	createAP(t, e.h, e.ownerA, e.loc, "Gate")
	createAP(t, e.h, e.ownerA, e.loc, "Front Gate")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.ac1", "close the front gate", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("ambiguous close opened a gate %d time(s)", n)
	}
	rows := pickerRows(t, e)
	if len(rows) != 2 {
		t.Fatalf("ambiguity picker should list exactly the matches: %+v", rows)
	}
	for _, r := range rows {
		if !strings.HasPrefix(r.ID, "close_ap:") {
			t.Errorf("ambiguous close offered a row that opens: %+v", r)
		}
	}
	if body := e.wa.all()[0].interactive.Body.Text; !strings.Contains(body, "haven't closed") {
		t.Errorf("ambiguity body: %q", body)
	}
}
