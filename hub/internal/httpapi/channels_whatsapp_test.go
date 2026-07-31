package httpapi

import (
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
		if !strings.Contains(sent[0].body, "haven't touched it") {
			t.Errorf("%q reply does not say nothing moved: %q", q, sent[0].body)
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
