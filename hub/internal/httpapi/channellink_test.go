package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

// The channel ceremony over the real rails.
//
// As with the phone flow, the store tests prove the rules and these prove the
// WIRING — which is the half that was missing. channel_identities had a
// correct writer and no production caller, so Telegram, Slack and Discord
// resolved every sender to a non-member and refused every open.

// An account the hub has never seen, which is the state everyone starts in.
const strangerTGID = int64(987654321)

var strangerTG = "987654321"

const strangerSlack = "USTRANGER"

func TestTelegramLinkCodeBindsTheSender(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	code, err := e.st.MintChannelLinkCode(ctx, e.ownID, channels.KindTelegram)
	if err != nil {
		t.Fatal(err)
	}
	tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 11, code.Code))

	got, err := e.st.ResolveChannelIdentity(ctx, channels.KindTelegram, strangerTG)
	if err != nil {
		t.Fatal(err)
	}
	if got != e.ownID {
		t.Fatalf("identity resolves to %q, want %q — the code did not bind over the wire", got, e.ownID)
	}
}

// The reachability guard, and the one that would have caught the original
// defect: an unlinked sender must reach redemption before the "I don't know
// who you are" branch answers them.
func TestTelegramLinkCodeIsReachableBeforeTheIdentityCheck(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	// The branch it has to beat.
	tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 12, "menu"))
	pre := e.tg.all()
	if len(pre) == 0 || !strings.Contains(strings.ToLower(pre[len(pre)-1].text), "isn't linked") {
		t.Fatalf("expected the unlinked prompt first: %+v", pre)
	}

	code, err := e.st.MintChannelLinkCode(ctx, e.ownID, channels.KindTelegram)
	if err != nil {
		t.Fatal(err)
	}
	tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 13, code.Code))
	all := e.tg.all()
	last := all[len(all)-1].text
	if strings.Contains(strings.ToLower(last), "isn't linked") {
		t.Fatal("the link code was routed as an ordinary message; redemption must run first")
	}
	if !strings.Contains(strings.ToLower(last), "linked") {
		t.Fatalf("link reply: %q", last)
	}
}

// The unlinked prompt must describe the ceremony that exists. It used to tell
// members to ask an admin to add their numeric id "in the dashboard" — a
// dashboard feature that was never built, because nothing could write the
// table it would have written to.
func TestTheUnlinkedPromptDescribesARealCeremony(t *testing.T) {
	e := setupChannels(t, permissiveRL())

	tgPost(e.h, tgMessage(strangerTGID, strangerTGID, 14, "menu"))
	sent := e.tg.all()
	if len(sent) == 0 {
		t.Fatal("no reply")
	}
	msg := sent[len(sent)-1].text
	if !strings.Contains(msg, "LINK-") {
		t.Errorf("the unlinked prompt does not mention a link code: %q", msg)
	}
	if strings.Contains(strings.ToLower(msg), "ask your admin to add") {
		t.Errorf("still pointing at the non-existent admin flow: %q", msg)
	}
}

// A code minted for Telegram must not bind a Slack account.
func TestASlackSenderCannotSpendATelegramCode(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	code, err := e.st.MintChannelLinkCode(ctx, e.ownID, channels.KindTelegram)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.st.RedeemChannelLinkCode(ctx, channels.KindSlack, strangerSlack, code.Code); err == nil {
		t.Fatal("a Telegram code bound a Slack identity")
	}
	got, _ := e.st.ResolveChannelIdentity(ctx, channels.KindSlack, strangerSlack)
	if got != "" {
		t.Fatalf("Slack identity was bound anyway: %q", got)
	}
}

// Ordinary chatter must not be treated as a guess.
func TestOrdinaryTelegramMessagesAreNotLinkAttempts(t *testing.T) {
	e := setupChannels(t, permissiveRL())
	ctx := context.Background()

	code, err := e.st.MintChannelLinkCode(ctx, e.ownID, channels.KindTelegram)
	if err != nil {
		t.Fatal(err)
	}
	// Distinct message ids: InsertInboundMessage dedupes on them, so reusing
	// one would silently process only the first message and the loop would
	// prove a quarter of what it claims.
	for i, body := range []string{"menu", "open", "hello", "LINK-AB23CD"} {
		tgPost(e.h, tgMessage(strangerTGID, strangerTGID, int64(20+i), body))
	}
	var attempts int
	if err := e.st.DB().QueryRowContext(ctx,
		`SELECT attempts FROM channel_link_codes WHERE id = ?`, code.ID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatalf("ordinary messages burned %d attempts", attempts)
	}
}

// The three routes.
func TestChannelLinkRoutes(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	access, _, _, _, _ := pairDevice(t, ts)

	// WhatsApp is deliberately not linkable here: its identity is a verified
	// phone number with its own, stronger ceremony. Offering both would be a
	// second and weaker path to the same access.
	code, out := liveJSON(t, ts, "POST", "/v1/channels/me/link", access,
		map[string]any{"channel": "whatsapp"})
	if code != http.StatusBadRequest {
		t.Errorf("whatsapp should not be linkable this way: %d %v", code, out)
	}

	code, out = liveJSON(t, ts, "POST", "/v1/channels/me/link", access,
		map[string]any{"channel": "nonsense"})
	if code != http.StatusBadRequest {
		t.Errorf("unknown channel: %d %v", code, out)
	}

	code, out = liveJSON(t, ts, "POST", "/v1/channels/me/link", access,
		map[string]any{"channel": "telegram"})
	if code != http.StatusCreated {
		t.Fatalf("mint: %d %v", code, out)
	}
	got, _ := out["code"].(string)
	if !strings.HasPrefix(got, "LINK-") {
		t.Errorf("code %q", got)
	}
	// The warning is load-bearing: unlike a phone code, anyone who sees this
	// one before it is spent can link their own account instead.
	if instr, _ := out["instruction"].(string); !strings.Contains(instr, "do not share") {
		t.Errorf("instruction does not warn about sharing: %q", instr)
	}

	code, out = liveJSON(t, ts, "GET", "/v1/channels/me/identities", access, nil)
	if code != 200 {
		t.Fatalf("list: %d %v", code, out)
	}
}

func TestChannelLinkRoutesRequireASession(t *testing.T) {
	ts, _, _ := newLiveServer(t)
	for _, c := range []struct{ method, path string }{
		{"POST", "/v1/channels/me/link"},
		{"GET", "/v1/channels/me/identities"},
		{"DELETE", "/v1/channels/me/identities/telegram/123"},
	} {
		code, _ := liveJSON(t, ts, c.method, c.path, "", map[string]any{"channel": "telegram"})
		if code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d, want 401", c.method, c.path, code)
		}
	}
}
