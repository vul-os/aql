package e2e

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"
)

// hmacHex mirrors channels.hmacHex — the same primitive both remaining rails
// sign with, recomputed here rather than imported so this harness keeps
// treating the hub as a binary it talks to rather than a package it links.
func hmacHex(secret, message string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(message))
	return hex.EncodeToString(m.Sum(nil))
}

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

	// And "close" reaches it too.
	//
	// channels_slack.go records why this is worth an assertion rather than an
	// assumption: AccessBlocks minted only open_gate: buttons and the switch
	// recognised only "open", so a resident who could open a gate from chat had
	// no way to close one — "close is never harder to reach than open" violated
	// in the one direction that matters. It has been fixed on all three rails
	// and regressed on two, which is the definition of something to pin.
	//
	// A close is Relay.Release, not a pulse: matching on state=pulsing would
	// pass on an open and prove nothing about the verb.
	closesBefore := c.logs.countLines("msg=command", "cmd=close")
	if st := post(t, message(4, "close")); st != http.StatusOK {
		t.Fatalf("close webhook: %d", st)
	}
	if !c.logs.waitLines(closesBefore+1, 5*time.Second, "msg=command", "cmd=close") {
		t.Fatalf("a Telegram close never reached the controller; controller log:\n%s",
			c.logs.String())
	}
	fmt.Fprintf(gw.logs, "chat rail reached the gate, both verbs\n")
}

// WhatsApp and Slack, the two rails left after the Telegram test above.
//
// They share finishOpen, so the open path itself is already exercised. What is
// NOT shared, and what these cover, is the inbound half: each has its own
// signature scheme (Meta's X-Hub-Signature-256 over the raw body; Slack's
// v0:timestamp:body with a replay window) and its own payload parser. A rail
// whose signature check or parser breaks is a rail that either stops working
// or stops being authenticated, and neither shows up in the other's tests.
//
// Both assert the same two things the Telegram test does, for the same reasons:
// an unsigned body that WOULD open the gate does not, and a signed one does.
func TestChatRail_WhatsAppAndSlackReachARealGate(t *testing.T) {
	const waSecret = "e2e-whatsapp-app-secret"
	const slackSecret = "e2e-slack-signing-secret"
	const waPhoneID = "PHONE123"
	t.Setenv("WHATSAPP_APP_SECRET", waSecret)
	t.Setenv("WHATSAPP_ACCESS_TOKEN", "e2e-wa-access")
	t.Setenv("WHATSAPP_PHONE_NUMBER_ID", waPhoneID)
	t.Setenv("SLACK_SIGNING_SECRET", slackSecret)
	t.Setenv("SLACK_BOT_TOKEN", "xoxb-e2e")
	// Both rails resolve to the same member opening the same gate, and the
	// cooldown is keyed (subject | access point) with a 10s default — so the
	// Slack open lands inside the window the WhatsApp open just opened and is
	// refused. That refusal is correct, and it is not what this test is about:
	// TestRateLimit_NeverReachesController covers it directly.
	t.Setenv("RATE_OPEN_COOLDOWN_S", "0")

	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	mintCode := func(t *testing.T, channel string) string {
		t.Helper()
		st, body, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/channels/me/link", ten.token,
			map[string]any{"channel": channel})
		if st != http.StatusCreated && st != http.StatusOK {
			t.Fatalf("mint %s link code: %d %s", channel, st, raw)
		}
		code, _ := body["code"].(string)
		if code == "" {
			t.Fatalf("no %s link code in %s", channel, raw)
		}
		return code
	}

	post := func(t *testing.T, path string, payload []byte, headers map[string]string) int {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, gw.url+path, bytes.NewReader(payload))
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		st, _, _ := doReq(t, req)
		return st
	}

	// ── WhatsApp ────────────────────────────────────────────────────────────
	waBody := func(id, text string) []byte {
		b, _ := json.Marshal(map[string]any{
			"object": "whatsapp_business_account",
			"entry": []map[string]any{{
				"id": "WABA",
				"changes": []map[string]any{{
					"field": "messages",
					"value": map[string]any{
						"metadata": map[string]any{"phone_number_id": waPhoneID},
						"messages": []map[string]any{{
							"id": id, "from": "27820001111",
							"timestamp": strconv.FormatInt(time.Now().Unix(), 10),
							"type":      "text",
							"text":      map[string]any{"body": text},
						}},
					},
				}},
			}},
		})
		return b
	}
	waSigned := func(b []byte) map[string]string {
		return map[string]string{"X-Hub-Signature-256": "sha256=" + hmacHex(waSecret, string(b))}
	}

	// WhatsApp links by VERIFIED PHONE, not a channel code: /v1/channels/me/link
	// answers unsupported_channel for it, and channellink.go says why — the
	// identity is a profile_phone_numbers row with a stronger ceremony in
	// phones.go, and offering both would be a second weaker path to the same
	// access. So this drives the phone flow, which is the product's.
	stw, waLink, rawWA := httpJSON(t, http.MethodPost, gw.url+"/v1/phones/me/link", ten.token,
		map[string]any{"phone_e164": "+27820001111"})
	if stw != http.StatusCreated {
		t.Fatalf("mint phone link code: %d %s", stw, rawWA)
	}
	waCode, _ := waLink["code"].(string)
	if waCode == "" {
		t.Fatalf("no phone link code in %s", rawWA)
	}
	link := waBody("wamid.link", waCode)
	if st := post(t, "/webhooks/whatsapp", link, waSigned(link)); st != http.StatusOK {
		t.Fatalf("whatsapp link webhook: %d", st)
	}

	open1 := waBody("wamid.open1", "open")
	pulses := c.logs.countLines("relay", "state=pulsing")
	if st := post(t, "/webhooks/whatsapp", open1, nil); st != http.StatusForbidden {
		t.Fatalf("unsigned whatsapp open: %d, want 403", st)
	}
	time.Sleep(500 * time.Millisecond)
	if got := c.logs.countLines("relay", "state=pulsing"); got != pulses {
		t.Fatalf("an UNSIGNED WhatsApp open pulsed the relay (%d → %d)", pulses, got)
	}
	if st := post(t, "/webhooks/whatsapp", open1, waSigned(open1)); st != http.StatusOK {
		t.Fatalf("signed whatsapp open: %d", st)
	}
	if !c.logs.waitLines(pulses+1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("a signed WhatsApp open never reached the controller; controller log:\n%s", c.logs.String())
	}

	// ── Slack ───────────────────────────────────────────────────────────────
	// ts is the DEDUPE KEY, not decoration: processSlackEvent stores each
	// inbound by ev.TS and drops a repeat as a redelivery. Stamping both
	// messages with time.Now().Unix() put them in the same second, so the open
	// was silently discarded and the gate never moved — which reads exactly
	// like a broken rail.
	slackBody := func(ts int64, text string) []byte {
		b, _ := json.Marshal(map[string]any{
			"type": "event_callback", "team_id": "T1",
			"event": map[string]any{
				"type": "message", "channel": "C1", "user": "U1", "text": text,
				"ts": strconv.FormatInt(ts, 10) + ".000100",
			},
		})
		return b
	}
	slackSigned := func(b []byte) map[string]string {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		return map[string]string{
			"X-Slack-Request-Timestamp": ts,
			"X-Slack-Signature":         "v0=" + hmacHex(slackSecret, "v0:"+ts+":"+string(b)),
		}
	}

	slink := slackBody(time.Now().Unix(), mintCode(t, "slack"))
	if st := post(t, "/webhooks/slack", slink, slackSigned(slink)); st != http.StatusOK {
		t.Fatalf("slack link webhook: %d", st)
	}

	// Slack never opens from a message. "open" always renders a picker
	// (AccessBlocks), and the actual open is a BLOCK INTERACTION posted
	// form-encoded to /webhooks/slack/interactions — unlike Telegram, which
	// opens directly when there is only one gate. A test that sends "open" and
	// waits for a pulse waits forever, and looks exactly like a broken rail.
	interaction := func() []byte {
		payload, _ := json.Marshal(map[string]any{
			"type":    "block_actions",
			"user":    map[string]any{"id": "U1"},
			"channel": map[string]any{"id": "C1"},
			"actions": []map[string]any{{"action_id": "open_gate:" + ap, "value": ap}},
		})
		return []byte(url.Values{"payload": {string(payload)}}.Encode())
	}
	form := interaction()
	formSigned := func(b []byte) map[string]string {
		h := slackSigned(b)
		h["Content-Type"] = "application/x-www-form-urlencoded"
		return h
	}

	pulses = c.logs.countLines("relay", "state=pulsing")
	if st := post(t, "/webhooks/slack/interactions", form, map[string]string{
		"Content-Type": "application/x-www-form-urlencoded",
	}); st != http.StatusForbidden {
		t.Fatalf("unsigned slack interaction: %d, want 403", st)
	}
	time.Sleep(500 * time.Millisecond)
	if got := c.logs.countLines("relay", "state=pulsing"); got != pulses {
		t.Fatalf("an UNSIGNED Slack interaction pulsed the relay (%d → %d)", pulses, got)
	}
	if st := post(t, "/webhooks/slack/interactions", form, formSigned(form)); st != http.StatusOK {
		t.Fatalf("signed slack interaction: %d", st)
	}
	if !c.logs.waitLines(pulses+1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("a signed Slack interaction never reached the controller; controller log:\n%s\nhub log:\n%s",
			c.logs.String(), gw.logs.String())
	}

	// Close, on the rail where "close is never harder to reach than open" was
	// found violated: AccessBlocks minted only open_gate: buttons and the
	// switch recognised only "open". Same shape as the open above, with the
	// close_gate action id, and matched on cmd=close rather than a pulse —
	// a close is Relay.Release, so waiting for state=pulsing would pass on an
	// open and prove nothing about the verb.
	closeForm := func() []byte {
		payload, _ := json.Marshal(map[string]any{
			"type":    "block_actions",
			"user":    map[string]any{"id": "U1"},
			"channel": map[string]any{"id": "C1"},
			"actions": []map[string]any{{"action_id": "close_gate:" + ap, "value": ap}},
		})
		return []byte(url.Values{"payload": {string(payload)}}.Encode())
	}()
	closesBefore := c.logs.countLines("msg=command", "cmd=close")
	if st := post(t, "/webhooks/slack/interactions", closeForm, formSigned(closeForm)); st != http.StatusOK {
		t.Fatalf("signed slack close interaction: %d", st)
	}
	if !c.logs.waitLines(closesBefore+1, 5*time.Second, "msg=command", "cmd=close") {
		t.Fatalf("a Slack close never reached the controller; controller log:\n%s", c.logs.String())
	}
}
