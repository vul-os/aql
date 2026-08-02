package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

func tgMessage(userID, chatID int64, msgID int64, text string) []byte {
	return mustJSONBytes(map[string]any{
		"update_id": msgID,
		"message": map[string]any{
			"message_id": msgID,
			"from":       map[string]any{"id": userID, "is_bot": false, "first_name": "Mia"},
			"chat":       map[string]any{"id": chatID, "type": "private"},
			"date":       1700000000,
			"text":       text,
		},
	})
}

func tgCallback(userID, chatID int64, data string) []byte {
	return mustJSONBytes(map[string]any{
		"update_id": 7777,
		"callback_query": map[string]any{
			"id":      "cbq1",
			"from":    map[string]any{"id": userID, "is_bot": false},
			"message": map[string]any{"message_id": 5, "chat": map[string]any{"id": chatID, "type": "private"}},
			"data":    data,
		},
	})
}

func TestTelegramSecretTokenFailClosed(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	body := tgMessage(testTGUID, testTGChat, 1, "open")

	// missing token
	if rec := rawPost(e.h, "/webhooks/telegram", body, map[string]string{"Content-Type": "application/json"}); rec.Code != http.StatusForbidden {
		t.Errorf("missing token: %d", rec.Code)
	}
	// wrong token
	if rec := rawPost(e.h, "/webhooks/telegram", body, map[string]string{"X-Telegram-Bot-Api-Secret-Token": "nope"}); rec.Code != http.StatusForbidden {
		t.Errorf("wrong token: %d", rec.Code)
	}
	// valid
	if rec := tgPost(e.h, body); rec.Code != 200 {
		t.Errorf("valid: %d %s", rec.Code, rec.Body)
	}
}

func TestTelegramUnlinkedUser(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	tgPost(e.h, tgMessage(880099, 880099, 1, "open"))
	sent := e.tg.all()
	if len(sent) != 1 || !strings.Contains(sent[0].text, "isn't linked") {
		t.Fatalf("unlinked tg: %+v", sent)
	}
}

func TestTelegramDirectOpenReachesVerdict(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	rec := tgPost(e.h, tgMessage(testTGUID, testTGChat, 1, "open"))
	if rec.Code != 200 {
		t.Fatalf("code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindTelegram); n != 1 {
		t.Fatalf("tg open not audited: %d", n)
	}
	sent := e.tg.all()
	if len(sent) != 1 || !strings.Contains(sent[0].text, "Opening Main gate") {
		t.Fatalf("tg open reply: %+v", sent)
	}
}

func TestTelegramInlineKeyboardPickerAndCallback(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ap2 := createAP(t, e.h, e.ownerA, e.loc, "Side door")

	// two gates → inline keyboard picker, no open yet.
	tgPost(e.h, tgMessage(testTGUID, testTGChat, 1, "open"))
	sent := e.tg.all()
	if len(sent) != 1 || sent[0].kb == nil || len(sent[0].kb.Rows) != 2 {
		t.Fatalf("expected inline keyboard picker: %+v", sent)
	}
	if n := e.successOpens(t, channels.KindTelegram); n != 0 {
		t.Fatalf("picker must not open: %d", n)
	}

	// tapping a button → callback → open reaches verdict + spinner dismissed.
	rec := tgPost(e.h, tgCallback(testTGUID, testTGChat, "open_ap:"+ap2))
	if rec.Code != 200 {
		t.Fatalf("callback code: %d", rec.Code)
	}
	if n := e.successOpens(t, channels.KindTelegram); n != 1 {
		t.Fatalf("callback open not audited: %d", n)
	}
	if e.tg.callbacks != 1 {
		t.Errorf("callback not answered (spinner not dismissed): %d", e.tg.callbacks)
	}
}

func TestTelegramDedupe(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	body := tgMessage(testTGUID, testTGChat, 42, "hi")
	tgPost(e.h, body)
	tgPost(e.h, body)
	if got := len(e.tg.all()); got != 1 {
		t.Fatalf("dedupe: want 1 reply, got %d", got)
	}
}

// A rejected webhook must not have DONE anything first.
//
// TestTelegramSecretTokenFailClosed asserts the status code, and a 403 is
// exactly what a handler that parses, acts, and THEN verifies would also
// return. Moving the Verify call below processTGUpdate — so an unsigned body
// reaches the open path and only afterwards gets its 403 — passes every test
// in this package. That was checked by making the change, not by reading:
// `NOT CAUGHT`.
//
// So this asserts the absence of the work instead of the presence of the
// refusal. The body is the same linked-user "open" that
// TestTelegramDirectOpenReachesVerdict drives to a real verdict, so if it is
// processed there is a reply to find and an access-log row to count.
func TestAnUnsignedTelegramWebhookDoesNothingAtAll(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	body := tgMessage(testTGUID, testTGChat, 1, "open")

	countLogs := func() int {
		_, total, err := e.st.AdminAudit(context.Background(), "all", 1, 0)
		if err != nil {
			t.Fatalf("count access logs: %v", err)
		}
		return total
	}
	before := countLogs()

	for _, tc := range []struct {
		name    string
		headers map[string]string
	}{
		{"no token", map[string]string{"Content-Type": "application/json"}},
		{"wrong token", map[string]string{"X-Telegram-Bot-Api-Secret-Token": "nope"}},
	} {
		rec := rawPost(e.h, "/webhooks/telegram", body, tc.headers)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: %d, want 403", tc.name, rec.Code)
		}
	}

	e.tg.mu.Lock()
	sent, callbacks := len(e.tg.sent), e.tg.callbacks
	e.tg.mu.Unlock()
	if sent != 0 || callbacks != 0 {
		t.Errorf("an unsigned webhook produced %d message(s) and %d callback(s); "+
			"the body was processed before its signature was checked", sent, callbacks)
	}

	if after := countLogs(); after != before {
		t.Errorf("an unsigned webhook added %d access-log row(s) — it reached the open path",
			after-before)
	}
}
