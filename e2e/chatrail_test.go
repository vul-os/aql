package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// The first chat rail exercised against real binaries.
//
// e2e/README.md item 6 records why this exists: every other test here reaches
// the open path over HTTP or the LAN grant surface, so finishOpen — the open
// path shared by WhatsApp, Telegram, Slack and Discord — had never run against
// a shipped binary. Two defects found on 2026-08-02 were both on chat paths and
// both invisible to this harness, while the identical mutation on the HTTP path
// is caught here twice over.
//
// It drives the whole product flow, not a shortcut: mint a link code over the
// console API, spend it from Telegram the way a resident would, then send
// "open" and watch a REAL controller pulse its relay.
func TestChatRail_TelegramOpensARealGate(t *testing.T) {
	const secret = "e2e-telegram-webhook-secret"
	t.Setenv("TELEGRAM_BOT_TOKEN", "e2e:bot-token")
	t.Setenv("TELEGRAM_WEBHOOK_SECRET", secret)

	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	const tgUser, tgChat = int64(880011), int64(990022)

	post := func(t *testing.T, payload any) int {
		t.Helper()
		b, _ := json.Marshal(payload)
		req, err := http.NewRequest(http.MethodPost, gw.url+"/webhooks/telegram", bytes.NewReader(b))
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Telegram-Bot-Api-Secret-Token", secret)
		st, _, _ := doReq(t, req)
		return st
	}
	message := func(id int64, text string) any {
		return map[string]any{
			"update_id": id,
			"message": map[string]any{
				"message_id": id,
				"date":       time.Now().Unix(),
				"text":       text,
				"from":       map[string]any{"id": tgUser, "is_bot": false, "first_name": "E2E"},
				"chat":       map[string]any{"id": tgChat, "type": "private"},
			},
		}
	}

	// Link the Telegram identity the way the product does: mint in the
	// console, spend from the rail.
	st, body, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/channels/me/link", ten.token,
		map[string]any{"channel": "telegram"})
	if st != http.StatusCreated && st != http.StatusOK {
		t.Fatalf("mint link code: %d %s", st, raw)
	}
	code, _ := body["code"].(string)
	if code == "" {
		t.Fatalf("no link code in %s", raw)
	}
	if st := post(t, message(1, code)); st != http.StatusOK {
		t.Fatalf("link-code webhook: %d", st)
	}

	// The identity is now the caller's, over the real API.
	st, idBody, raw := httpJSON(t, http.MethodGet, gw.url+"/v1/channels/me/identities", ten.token, nil)
	if st != http.StatusOK {
		t.Fatalf("identities: %d %s", st, raw)
	}
	ids, _ := idBody["identities"].([]any)
	if len(ids) != 1 {
		t.Fatalf("linked %d identities, want 1: %s", len(ids), raw)
	}

	// An UNSIGNED "open" from the now-linked user must not reach the gate.
	//
	// The first version of this probe posted `{}` before linking, which proves
	// nothing: an empty body does nothing whether it is verified first or not,
	// so moving Verify below processTGUpdate still passed. The body has to be
	// one that WOULD open the gate, sent by someone the hub would obey.
	pulseBefore := c.logs.countLines("relay", "state=pulsing")
	b, _ := json.Marshal(message(2, "open"))
	unsigned, err := http.NewRequest(http.MethodPost, gw.url+"/webhooks/telegram", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	unsigned.Header.Set("Content-Type", "application/json")
	if st, _, _ := doReq(t, unsigned); st != http.StatusForbidden {
		t.Fatalf("unsigned open: %d, want 403", st)
	}
	time.Sleep(500 * time.Millisecond) // let a wrongly-dispatched command land
	if got := c.logs.countLines("relay", "state=pulsing"); got != pulseBefore {
		t.Fatalf("an unsigned Telegram open pulsed the relay (%d → %d); the body was "+
			"processed before its signature was checked", pulseBefore, got)
	}

	// The signed one must.
	if st := post(t, message(3, "open")); st != http.StatusOK {
		t.Fatalf("open webhook: %d", st)
	}
	if !c.logs.waitLines(pulseBefore+1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("a Telegram open never reached the controller; controller log:\n%s\nhub log:\n%s",
			c.logs.String(), gw.logs.String())
	}
	fmt.Fprintf(gw.logs, "chat rail reached the gate\n")
}
