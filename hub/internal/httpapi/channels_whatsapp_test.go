package httpapi

import (
	"context"
	"github.com/vul-os/aql/hub/internal/store"
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
	"strconv"
)

// waTextMsg builds a signed-friendly WhatsApp text webhook body.
func waTextMsg(from, id, text, phoneID string) []byte {
	return mustJSONBytes(map[string]any{
		"object": "whatsapp_business_account",
		"entry": []map[string]any{{
			"id": "WABA",
			"changes": []map[string]any{{
				"field": "messages",
				"value": map[string]any{
					"metadata": map[string]any{"phone_number_id": phoneID},
					"messages": []map[string]any{{
						"id": id, "from": from, "timestamp": "1700000000", "type": "text",
						"text": map[string]any{"body": text},
					}},
				},
			}},
		}},
	})
}

func waInteractiveMsg(from, id, replyID, title string) []byte {
	return mustJSONBytes(map[string]any{
		"object": "whatsapp_business_account",
		"entry": []map[string]any{{
			"id": "WABA",
			"changes": []map[string]any{{
				"field": "messages",
				"value": map[string]any{
					"metadata": map[string]any{"phone_number_id": waPhoneID},
					"messages": []map[string]any{{
						"id": id, "from": from, "timestamp": "1700000000", "type": "interactive",
						"interactive": map[string]any{
							"type":       "list_reply",
							"list_reply": map[string]any{"id": replyID, "title": title},
						},
					}},
				},
			}},
		}},
	})
}

func TestWhatsAppSignatureFailClosed(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	body := waTextMsg(testPhoneRaw, "wamid.sig", "hi", waPhoneID)

	// missing signature
	rec := rawPost(e.h, "/webhooks/whatsapp", body, map[string]string{"Content-Type": "application/json"})
	if rec.Code != http.StatusForbidden {
		t.Errorf("missing sig: %d", rec.Code)
	}
	// bad signature
	rec = rawPost(e.h, "/webhooks/whatsapp", body, map[string]string{"X-Hub-Signature-256": "sha256=deadbeef"})
	if rec.Code != http.StatusForbidden {
		t.Errorf("bad sig: %d", rec.Code)
	}
	// valid signature passes
	rec = waPost(e.h, body)
	if rec.Code != http.StatusOK {
		t.Errorf("valid sig: %d %s", rec.Code, rec.Body)
	}
	// GET verify challenge
	req, _ := http.NewRequest("GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token="+waVerify+"&hub.challenge=CHAL", nil)
	rec2 := doRaw(e.h, req)
	if rec2.Code != 200 || rec2.Body.String() != "CHAL" {
		t.Errorf("verify challenge: %d %q", rec2.Code, rec2.Body.String())
	}
	req, _ = http.NewRequest("GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHAL", nil)
	if rec3 := doRaw(e.h, req); rec3.Code != http.StatusForbidden {
		t.Errorf("bad verify token: %d", rec3.Code)
	}
}

func TestWhatsAppUnlinkedSignupPrompt(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	rec := waPost(e.h, waTextMsg("27009998888", "wamid.u1", "hi", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 || !strings.Contains(sent[0].body, "isn't linked") || !strings.Contains(sent[0].body, "/signup?") {
		t.Fatalf("unlinked prompt: %+v", sent)
	}
}

func TestWhatsAppHelpShowsGateMenu(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.h1", "hi", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil || sent[0].interactive.Type != "button" {
		t.Fatalf("help menu should be a single-gate button: %+v", sent)
	}
	if id := sent[0].interactive.Action.Buttons[0].Reply.ID; id != "open_ap:"+e.apID {
		t.Errorf("button id: %q", id)
	}
}

func TestWhatsAppDirectOpenReachesVerdict(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.o1", "open", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("open not audited: %d", n)
	}
	sent := e.wa.all()
	// "Opening Main gate..." text + a close-button interactive follow-up.
	if len(sent) != 2 || !strings.Contains(sent[0].body, "Opening Main gate") {
		t.Fatalf("open replies: %+v", sent)
	}
	if sent[1].interactive == nil || !strings.HasPrefix(sent[1].interactive.Action.Buttons[0].Reply.ID, "close_ap:") {
		t.Errorf("missing close button: %+v", sent[1])
	}
}

func TestWhatsAppPickerFlowMultipleGates(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ap2 := createAP(t, e.h, e.ownerA, e.loc, "Side door")

	// "open" with two gates in one location → a list picker (no open yet).
	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.p1", "open", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 || sent[0].interactive == nil || sent[0].interactive.Type != "list" {
		t.Fatalf("expected picker list: %+v", sent)
	}
	if len(sent[0].interactive.Action.Sections[0].Rows) != 2 {
		t.Fatalf("picker rows: %+v", sent[0].interactive.Action.Sections[0].Rows)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("picker must not open yet: %d", n)
	}

	// user taps the second gate → open reaches the verdict.
	rec = waPost(e.h, waInteractiveMsg(testPhoneRaw, "wamid.p2", "open_ap:"+ap2, "Side door"))
	if rec.Code != 200 {
		t.Fatalf("selection code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("selection open not audited: %d", n)
	}
}

func TestWhatsAppDedupeAndPhoneIDFilter(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	// wrong phone_number_id → ignored, no reply, still 200.
	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.f1", "open", "OTHER_PHONE_ID"))
	if rec.Code != 200 || len(e.wa.all()) != 0 {
		t.Fatalf("phone id filter: %d %+v", rec.Code, e.wa.all())
	}

	// duplicate message id → processed once.
	body := waTextMsg(testPhoneRaw, "wamid.dup", "hi", waPhoneID)
	waPost(e.h, body)
	waPost(e.h, body)
	if len(e.wa.all()) != 1 {
		t.Fatalf("dedupe failed, replies: %d", len(e.wa.all()))
	}
}

func TestWhatsAppFloodThrottleGoesQuietStill200(t *testing.T) {
	rl := permissiveRL()
	rl.ChatMsgsPerMin = 2
	e := setupChannels(t, rl)

	// 3 distinct messages; past the cap the bot goes quiet but still 200s.
	for i, id := range []string{"wamid.t1", "wamid.t2", "wamid.t3"} {
		rec := waPost(e.h, waTextMsg(testPhoneRaw, id, "hi", waPhoneID))
		if rec.Code != 200 {
			t.Fatalf("msg %d code: %d", i, rec.Code)
		}
	}
	if got := len(e.wa.all()); got != 2 {
		t.Fatalf("throttle: want 2 replies (3rd quiet), got %d", got)
	}
}

func TestWhatsAppDeniedOpenIsHonest(t *testing.T) {
	rl := permissiveRL()
	rl.OpenCooldownS = 3600 // force the second open into cooldown
	e := setupChannels(t, rl)

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.d1", "open", waPhoneID)) // allowed
	e.wa.sent = nil
	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.d2", "open", waPhoneID)) // denied by cooldown
	sent := e.wa.all()
	if len(sent) != 1 || !strings.Contains(sent[0].body, "Too many opens") {
		t.Fatalf("denied open must reply honestly: %+v", sent)
	}
}

// A member who asks for a capability chat does not serve gets told so, over
// the real webhook.
//
// Before this, "turn on the porch light" fell through to the welcome menu and
// the member was shown a list of GATES with an offer to open one. Nothing
// actuated, so it was never dangerous — it was misleading, and the member had
// no way to tell "I did not understand you" from "that is not a thing I do".
func TestWhatsAppSaysWhatItCannotDo(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.unsup1", "turn on the porch light", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 {
		t.Fatalf("want one reply, got %+v", sent)
	}
	body := sent[0].body
	if !strings.Contains(body, "can't on") && !strings.Contains(body, "only open and close") {
		t.Errorf("reply does not say what it cannot do: %q", body)
	}
	// The specific regression: it must not answer a lighting request with a
	// gate picker.
	if sent[0].interactive != nil {
		t.Errorf("answered an unsupported verb with an interactive gate menu: %+v", sent[0].interactive)
	}
}

// And the gate path is untouched: a body naming a gate verb still opens,
// including when it also mentions something chat cannot do.
func TestWhatsAppGateVerbStillWinsOverAnUnsupportedOne(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.mixed1", "open the gate and turn on the light", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) == 0 {
		t.Fatal("no reply to a gate request")
	}
	for _, m := range sent {
		if strings.Contains(m.body, "only open and close") {
			t.Fatalf("a gate request was diverted to the unsupported-verb reply: %q", m.body)
		}
	}
}

// The defect, end to end, on the rail where it was reachable without naming a
// gate: a one-gate household collapses any body onto its only gate, so a
// question about the gate opened the gate.
//
// This drives the real webhook and counts AUDITED opens rather than inspecting
// the matcher, because the matcher was only half of it — the collapse rule is
// what turned a bad classification into a moving barrier.
func TestWhatsAppAQuestionAboutTheGateDoesNotOpenIt(t *testing.T) {
	for i, q := range []string{
		"when was the gate last opened?",
		"who opened the front gate today",
		"is the gate closed?",
	} {
		e := setupChannels(t, permissiveRL())
		rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.q"+strconv.Itoa(i), q, waPhoneID))
		if rec.Code != 200 {
			t.Fatalf("%q code: %d", q, rec.Code)
		}
		if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
			t.Errorf("%q produced %d audited opens — a question moved the gate", q, n)
		}
		sent := e.wa.all()
		if len(sent) != 1 {
			t.Fatalf("%q replies: %+v", q, sent)
		}
		// Not the welcome menu. Being offered a gate to open is the misdirection
		// that made the original behaviour hard to notice.
		if strings.Contains(sent[0].body, "Which gate") {
			t.Errorf("%q answered with a gate menu: %q", q, sent[0].body)
		}
		if strings.Contains(sent[0].body, "Opening") || strings.Contains(sent[0].body, "Closing") {
			t.Errorf("%q reply implies actuation: %q", q, sent[0].body)
		}
	}
}

// The control on the same rail. If the question guard is too eager the product
// stops doing the one thing it is for, and that failure is invisible to the
// test above.
func TestWhatsAppARealOpenStillOpensAfterTheQuestionGuard(t *testing.T) {
	for i, body := range []string{"open", "open the gate", "can you open the gate?", "please open the main gate"} {
		e := setupChannels(t, permissiveRL())
		waPost(e.h, waTextMsg(testPhoneRaw, "wamid.r"+strconv.Itoa(i), body, waPhoneID))
		if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
			t.Errorf("%q produced %d audited opens, want 1 — a real request was refused", body, n)
		}
	}
}

// A question is ANSWERED from the hub's own record, and the answer is audited.
//
// docs/CHAT-COMMANDS.md §4.4 rule 5: reads of a security system are
// security-relevant events. The row goes to access_logs with command "read", so
// this asserts both that the member was told something true and that the
// telling was recorded — and, critically, that the read did not land in the
// open counters, which would turn every question into a phantom entry in the
// gate's own history.
func TestWhatsAppAQuestionIsAnsweredAndAudited(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	// A real open first, so there is something true to report.
	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.pre", "open", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("setup open not audited: %d", n)
	}
	before := len(e.wa.all())

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.ask", "when was the gate last opened?", waPhoneID))
	sent := e.wa.all()[before:]
	if len(sent) != 1 {
		t.Fatalf("replies: %+v", sent)
	}
	if !strings.Contains(sent[0].body, "Main gate") || !strings.Contains(sent[0].body, "last opened") {
		t.Errorf("question not answered from the record: %q", sent[0].body)
	}
	// The qualifier §4.1 requires: an ack is not a barrier that moved.
	if !strings.Contains(sent[0].body, "not proof the gate moved") {
		t.Errorf("answer presents an ack as movement: %q", sent[0].body)
	}

	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 100)
	if err != nil {
		t.Fatal(err)
	}
	reads := 0
	for _, l := range logs {
		if l.Command == "read" {
			reads++
		}
	}
	if reads != 1 {
		t.Errorf("read disclosures audited: %d, want 1", reads)
	}
	// And the read did not inflate the gate's open history.
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Errorf("a question changed the open count: %d, want 1", n)
	}
}

// The unanswerable one. §4.1 is explicit that the hub cannot know a gate's
// position, and that saying so is the requirement rather than a shortfall.
func TestWhatsAppIsTheGateClosedIsRefusedSpecifically(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.pos", "is the gate closed?", waPhoneID))
	sent := e.wa.all()
	if len(sent) != 1 {
		t.Fatalf("replies: %+v", sent)
	}
	if !strings.Contains(sent[0].body, "no position sensor") {
		t.Errorf("position question not refused with its reason: %q", sent[0].body)
	}
	if strings.Contains(sent[0].body, "Main gate is closed") || strings.Contains(sent[0].body, "Main gate is open") {
		t.Errorf("hub claimed a physical state it cannot know: %q", sent[0].body)
	}
}

// §4.4 rule 4: the query budget is its own scope.
//
// Asserted on the counters rather than by flooding, because a flood also trips
// the per-minute chat throttle (ChatMsgsPerMin), which silences everything
// inbound and would make this pass for the wrong reason — the opens would stop
// because the rail went quiet, not because the budgets are shared.
//
// What must be true: asking questions increments query_1h and leaves the open
// budget untouched. If the two shared a scope, a remote reconnaissance sweep —
// cheap, needing only a linked identity — would become a denial-of-open against
// a member standing at their own gate.
func TestAQuestionSpendsTheQueryBudgetAndNotTheOpenBudget(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	count := func(scope string) int64 {
		var n int64
		if err := e.st.DB().QueryRow(
			`SELECT coalesce(sum(count), 0) FROM rate_limit_counters WHERE scope = ?`, scope).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	for i := 0; i < 3; i++ {
		waPost(e.h, waTextMsg(testPhoneRaw, "wamid.b"+strconv.Itoa(i), "when was the gate last opened?", waPhoneID))
	}
	if got := count("query_1h"); got != 3 {
		t.Errorf("query_1h = %d, want 3 — questions are not counted in their own scope", got)
	}
	if got := count("opens_1h"); got != 0 {
		t.Errorf("opens_1h = %d after three questions, want 0 — a question spent the open budget", got)
	}
	if n := e.successOpens(t, channels.KindWhatsApp); n != 0 {
		t.Fatalf("questions actuated: %d", n)
	}

	// And a real open still works, spending the open budget and not the query one.
	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.bopen", "open", waPhoneID))
	if n := e.successOpens(t, channels.KindWhatsApp); n != 1 {
		t.Fatalf("open after questions: %d", n)
	}
	if got := count("query_1h"); got != 3 {
		t.Errorf("query_1h = %d after an open, want 3 — an open spent the query budget", got)
	}
}

// Past the cap the rail goes quiet rather than answering, and the webhook still
// 200s. A reply is itself a signal to whoever is probing.
func TestAQuestionPastTheCapIsNotAnswered(t *testing.T) {
	e := setupChannels(t, store.RateLimitConfig{OpenCooldownS: 0, OpensPerHour: 1000, ChatMsgsPerMin: 10000, AccountOpensPerHour: 100000})
	for i := 0; i < QueriesPerHour+3; i++ {
		rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.c"+strconv.Itoa(i), "when was the gate last opened?", waPhoneID))
		if rec.Code != 200 {
			t.Fatalf("webhook stopped 200ing at %d: %d", i, rec.Code)
		}
	}
	if n := len(e.wa.all()); n != QueriesPerHour {
		t.Errorf("%d replies for %d questions, want %d — the cap did not bind", n, QueriesPerHour+3, QueriesPerHour)
	}
}

// §4.4 rule 1: a device you cannot command is a device you cannot see.
//
// A second account's gate exists on the same hub and must not appear in the
// answer, must not be counted in the "of N" total, and must not produce an
// audit row — the last one matters because a read row against a gate nobody
// asked about would be a disclosure recorded for a disclosure that did not
// happen, which corrupts the log in the opposite direction.
func TestAQuestionOnlyReportsGatesTheAskerCouldOpen(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	// A whole separate tenant on the same hub.
	otherAccess, _ := register(t, e.h, "other@elsewhere.test")
	_, otherLoc := tenantIDs(t, e.h, otherAccess)
	otherAP := createAP(t, e.h, otherAccess, otherLoc, "Neighbour driveway")

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.scope", "when was the gate last opened?", waPhoneID))
	sent := e.wa.all()
	if len(sent) != 1 {
		t.Fatalf("replies: %+v", sent)
	}
	if strings.Contains(sent[0].body, "Neighbour driveway") {
		t.Errorf("answer named another account's gate: %q", sent[0].body)
	}
	// Not counted either — "1 of 2" would disclose that a second gate exists.
	if strings.Contains(sent[0].body, "Showing") {
		t.Errorf("answer counted gates outside the authorized set: %q", sent[0].body)
	}

	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range logs {
		if l.Command == "read" && l.AccessPointID == otherAP {
			t.Errorf("a read was audited against a gate the asker cannot see")
		}
	}
}

// The WhatsApp half of the same property: a rejected webhook must not have
// already acted. See the Telegram equivalent for why a 403 alone is not enough
// — a handler that parses, replies, and verifies afterwards returns exactly
// the same status, and the fail-closed test above cannot tell the difference.
func TestAnUnsignedWhatsAppWebhookDoesNothingAtAll(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	// A linked sender saying "hi", which on the signed path draws a reply.
	body := waTextMsg(testPhoneRaw, "wamid.unsigned", "hi", waPhoneID)

	for _, tc := range []struct {
		name    string
		headers map[string]string
	}{
		{"missing signature", map[string]string{"Content-Type": "application/json"}},
		{"bad signature", map[string]string{"X-Hub-Signature-256": "sha256=deadbeef"}},
	} {
		if rec := rawPost(e.h, "/webhooks/whatsapp", body, tc.headers); rec.Code != http.StatusForbidden {
			t.Fatalf("%s: %d, want 403", tc.name, rec.Code)
		}
	}

	e.wa.mu.Lock()
	sent := len(e.wa.sent)
	e.wa.mu.Unlock()
	if sent != 0 {
		t.Errorf("an unsigned webhook sent %d WhatsApp message(s); the body was "+
			"processed before its signature was checked", sent)
	}

	// And nothing was WRITTEN either, which the reply count alone cannot show.
	//
	// processWhatsAppMessage upserts a chat row, stores the inbound body and
	// meters the sender before any reply is built, so a handler that verifies
	// just before SENDING still persists an unsigned stranger's message and
	// leaves no visible trace. Moving the Verify call to exactly there was NOT
	// CAUGHT by the reply assertion above.
	//
	// The probe is the dedupe: message ids are single-use, so if the unsigned
	// body was recorded, the same id arriving legitimately is dropped as a
	// redelivery. That is the harm stated plainly — an attacker who knows a
	// message id can silence the real message by racing it unsigned.
	if rec := waPost(e.h, body); rec.Code != http.StatusOK {
		t.Fatalf("the signed retry: %d", rec.Code)
	}
	e.wa.mu.Lock()
	afterSigned := len(e.wa.sent)
	e.wa.mu.Unlock()
	if afterSigned == 0 {
		t.Error("the signed message drew no reply — the unsigned attempt had already " +
			"recorded its id, so the real one was dropped as a duplicate")
	}
}
