package channels

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/store"
)

func hmacHexT(secret, msg string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}

func hdr(kv ...string) http.Header {
	h := http.Header{}
	for i := 0; i+1 < len(kv); i += 2 {
		h.Set(kv[i], kv[i+1])
	}
	return h
}

func TestWhatsAppVerifyFailClosed(t *testing.T) {
	body := []byte(`{"object":"whatsapp_business_account"}`)
	c := WhatsApp{AppSecret: "topsecret"}
	good := "sha256=" + hmacHexT("topsecret", string(body))

	cases := []struct {
		name    string
		secret  string
		headers http.Header
		want    bool
	}{
		{"unset secret refuses", "", hdr("X-Hub-Signature-256", good), false},
		{"missing header", "topsecret", hdr(), false},
		{"wrong prefix", "topsecret", hdr("X-Hub-Signature-256", "md5=deadbeef"), false},
		{"bad signature", "topsecret", hdr("X-Hub-Signature-256", "sha256=deadbeef"), false},
		{"valid passes", "topsecret", hdr("X-Hub-Signature-256", good), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := WhatsApp{AppSecret: tc.secret}.Verify(tc.headers, body, 0).OK
			if got != tc.want {
				t.Fatalf("want %v got %v", tc.want, got)
			}
		})
	}
	// challenge handshake: token must match, fail-closed when unset.
	if _, ok := (WhatsApp{VerifyToken: "vt"}).VerifyChallenge("subscribe", "vt", "123"); !ok {
		t.Error("valid challenge rejected")
	}
	if _, ok := (WhatsApp{VerifyToken: "vt"}).VerifyChallenge("subscribe", "wrong", "123"); ok {
		t.Error("bad token accepted")
	}
	if _, ok := (WhatsApp{VerifyToken: ""}).VerifyChallenge("subscribe", "", "123"); ok {
		t.Error("unset verify token must fail closed")
	}
	_ = c
}

func TestSlackVerifyFailClosed(t *testing.T) {
	body := []byte(`{"type":"event_callback"}`)
	now := int64(1_700_000_000)
	ts := strconv.FormatInt(now, 10)
	sig := "v0=" + hmacHexT("signing", "v0:"+ts+":"+string(body))

	cases := []struct {
		name    string
		secret  string
		headers http.Header
		now     int64
		want    bool
	}{
		{"unset secret refuses", "", hdr("X-Slack-Request-Timestamp", ts, "X-Slack-Signature", sig), now, false},
		{"missing headers never skip", "signing", hdr(), now, false},
		{"stale timestamp rejected", "signing", hdr("X-Slack-Request-Timestamp", ts, "X-Slack-Signature", sig), now + 400, false},
		{"bad signature", "signing", hdr("X-Slack-Request-Timestamp", ts, "X-Slack-Signature", "v0=bad"), now, false},
		{"valid passes", "signing", hdr("X-Slack-Request-Timestamp", ts, "X-Slack-Signature", sig), now, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Slack{SigningSecret: tc.secret}.Verify(tc.headers, body, tc.now).OK
			if got != tc.want {
				t.Fatalf("want %v got %v", tc.want, got)
			}
		})
	}
}

func TestTelegramVerifyFailClosed(t *testing.T) {
	cases := []struct {
		name    string
		secret  string
		headers http.Header
		want    bool
	}{
		{"unset secret refuses", "", hdr("X-Telegram-Bot-Api-Secret-Token", "s"), false},
		{"missing header", "s", hdr(), false},
		{"wrong token", "s", hdr("X-Telegram-Bot-Api-Secret-Token", "nope"), false},
		{"valid passes", "s", hdr("X-Telegram-Bot-Api-Secret-Token", "s"), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Telegram{WebhookSecret: tc.secret}.Verify(tc.headers, nil, 0).OK
			if got != tc.want {
				t.Fatalf("want %v got %v", tc.want, got)
			}
		})
	}
}

func TestDenialMessagesExact(t *testing.T) {
	if got := DenialMessage("account_suspended", 0, "https://x"); got != "This account has been suspended by the gateway operator — the gate cannot be opened. Contact your operator for help." {
		t.Errorf("suspended: %q", got)
	}
	if got := DenialMessage("user_disabled", 0, "https://x"); got != "Your lintel user has been disabled by the gateway operator — the gate cannot be opened. Contact your operator for help." {
		t.Errorf("disabled: %q", got)
	}
	if got := DenialMessage("quota_exceeded", 0, "https://gate.example/"); got != "Daily limit reached for this location — contact your admin. The web portal: https://gate.example/app" {
		t.Errorf("quota: %q", got)
	}
	if got := DenialMessage("rate_limited", 90, "https://x"); got != "Too many opens — try again in ~2 min." {
		t.Errorf("rate: %q", got)
	}
	if got := DenialMessage("rate_limited", 5, "https://x"); got != "Too many opens — try again in ~1 min." {
		t.Errorf("rate min: %q", got)
	}
}

func TestNormalizeSlackTextStripsMentions(t *testing.T) {
	if got := NormalizeSlackText("<@U12345> OPEN "); got != "open" {
		t.Errorf("got %q", got)
	}
	if got := NormalizeText("  HeLLo "); got != "hello" {
		t.Errorf("got %q", got)
	}
}

func TestWaTitleTruncates(t *testing.T) {
	if got := waTitle("Short", 24); got != "Short" {
		t.Errorf("short: %q", got)
	}
	long := waTitle("A very long gate name that exceeds", 10)
	if len([]rune(long)) != 10 || !strings.HasSuffix(long, "…") {
		t.Errorf("truncate: %q (len %d)", long, len([]rune(long)))
	}
}

func TestPushGateMenuRendering(t *testing.T) {
	// Single gate → button with open_ap action.
	single := PushGateMenu("Home", []store.AvailableAP{{APID: "ap1", APName: "Main gate", LocName: "Home", Type: store.APMember}}, testPortal)
	if single.Interactive == nil || single.Interactive.Type != "button" {
		t.Fatalf("single gate should be a button: %+v", single)
	}
	if id := single.Interactive.Action.Buttons[0].Reply.ID; id != "open_ap:ap1" {
		t.Errorf("button id: %q", id)
	}

	// Visitor grant footer shows remaining uses.
	vis := PushGateMenu("Home", []store.AvailableAP{{APID: "ap1", APName: "Gate", LocName: "Home", Type: store.APVisitor, MaxUses: nz(3), UsesCount: 1}}, testPortal)
	if vis.Interactive.Footer == nil || vis.Interactive.Footer.Text != "You have 2 uses remaining." {
		t.Errorf("visitor footer: %+v", vis.Interactive.Footer)
	}

	// Multiple gates → list with open_ap rows.
	multi := PushGateMenu("Home", []store.AvailableAP{
		{APID: "ap1", APName: "Front", LocName: "Home", Type: store.APMember},
		{APID: "ap2", APName: "Back", LocName: "Home", Type: store.APMember},
	}, testPortal)
	if multi.Interactive.Type != "list" || len(multi.Interactive.Action.Sections[0].Rows) != 2 {
		t.Errorf("multi list: %+v", multi.Interactive)
	}
	if multi.Interactive.Action.Sections[0].Rows[1].ID != "open_ap:ap2" {
		t.Errorf("row id: %+v", multi.Interactive.Action.Sections[0].Rows)
	}
}

func TestParseSelection(t *testing.T) {
	for _, tc := range []struct {
		in, cmd, arg string
		ok           bool
	}{
		{"open_ap:ap1", "open_ap", "ap1", true},
		{"close_ap:ap9", "close_ap", "ap9", true},
		{"select_loc:loc1", "select_loc", "loc1", true},
		// An id carrying a ':' in the argument still splits on the FIRST one.
		{"open_ap:ap:1", "open_ap", "ap:1", true},
		// Defect 2: an unprefixed id used to return ("open", id) — the most
		// dangerous verb the gateway has, handed out on a malformed reply.
		{"bare", "", "", false},
		{"", "", "", false},
		// An unknown command must not fall through to a verb either.
		{"wat:ap1", "", "", false},
		{"open:ap1", "", "", false},
		{"open_ap", "", "", false},
		// A known command with no argument names no target.
		{"open_ap:", "", "", false},
		{":ap1", "", "", false},
	} {
		cmd, arg, ok := ParseSelection(tc.in)
		if cmd != tc.cmd || arg != tc.arg || ok != tc.ok {
			t.Errorf("%q → (%q,%q,%v) want (%q,%q,%v)", tc.in, cmd, arg, ok, tc.cmd, tc.arg, tc.ok)
		}
	}
}

// TestSelectionCommandVerbIsAllowlisted proves the verb is looked up, never
// derived from the id text, and that select_loc yields no verb at all.
func TestSelectionCommandVerbIsAllowlisted(t *testing.T) {
	for _, tc := range []struct {
		cmd, verb string
		ok        bool
	}{
		{SelOpenAP, "open", true},
		{SelCloseAP, "close", true},
		{SelSelectLoc, "", false},
		{"closet", "", false}, // used to satisfy strings.HasPrefix(cmd, "close")
		{"opener", "", false},
		{"", "", false},
	} {
		verb, ok := SelectionCommandVerb(tc.cmd)
		if verb != tc.verb || ok != tc.ok {
			t.Errorf("%q → (%q,%v) want (%q,%v)", tc.cmd, verb, ok, tc.verb, tc.ok)
		}
	}
	// Whatever the allowlist yields must stay inside what the choke point
	// accepts (store/openpath.go: open | close, nothing else).
	for cmd := range selectionCommands {
		if verb, ok := SelectionCommandVerb(cmd); ok && verb != "open" && verb != "close" {
			t.Errorf("%q yields verb %q, which store.LogAccess rejects", cmd, verb)
		}
	}
}

func nz(n int64) sql.NullInt64 { return sql.NullInt64{Int64: n, Valid: true} }
