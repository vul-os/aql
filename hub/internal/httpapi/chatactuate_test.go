package httpapi

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// The first time a chat message drives something that is not a gate.
//
// docs/CHAT-COMMANDS.md §3 at T1 and no higher. Every test here is about a
// refusal except the first: the feature is mostly the set of things it will not
// do, and each of those is a branch that would be silently permissive if it
// were wrong.

type actEnv struct {
	srv     *Server
	st      *store.Store
	userID  string
	profile string
}

func actuationServer(t *testing.T) *actEnv {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	access, _ := register(t, h, "owner@act.test")
	_ = access
	u, err := st.UserByUsername(context.Background(), "owner@act.test")
	if err != nil {
		t.Fatal(err)
	}
	// One account on the hub, so the scope is soleAccount and the whole mock
	// fleet is visible — the household case this product is mostly for.
	return &actEnv{srv: srv, st: st, userID: u.ID, profile: u.ID}
}

func (e *actEnv) act(t *testing.T, body string, v devices.Verb) (chatActuationResult, bool) {
	t.Helper()
	return e.actIn(t, body, "chat-1", "", v)
}

// actIn is act with the conversation and any confirmation token made explicit —
// the two things §3.4 adds.
func (e *actEnv) actIn(t *testing.T, body, chatID, token string, v devices.Verb) (chatActuationResult, bool) {
	t.Helper()
	return e.srv.chatActuate(context.Background(), body, e.profile, channels.KindWhatsApp, chatID, token, v)
}

func (e *actEnv) commands(t *testing.T, command string) int {
	t.Helper()
	rows, err := e.st.DB().Query(`SELECT count(*) FROM access_logs WHERE command = ?`, command)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	if rows.Next() {
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
	}
	return n
}

// The one that does something.
func TestAT1VerbActuatesAndIsAudited(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "turn on the garden lights", devices.VerbOn)
	if !handled || !res.Actuated {
		t.Fatalf("handled=%v actuated=%v reply=%q", handled, res.Actuated, res.Reply)
	}
	if !strings.Contains(res.Reply, "Garden Lights") || !strings.Contains(res.Reply, "now on") {
		t.Errorf("reply does not report what happened: %q", res.Reply)
	}
	// §3.8: the same table as a gate open, never a second log.
	if n := e.commands(t, "on"); n != 1 {
		t.Errorf("audited `on` rows: %d, want 1", n)
	}
}

// The ceiling, exercised by the verb that actually reaches it.
//
// This test first used `start`, and passed for the wrong reason: `start` is not
// in chatArgumentlessVerbs, so it never got as far as the tier check and the
// ceiling was untested. `resume` IS in that set, and `resume` on a mower's
// blade-job is TierHazardousMotion — resuming a mower spins blades. The ceiling
// is the only thing between a text message and that, which is precisely why it
// had to be tested by something that reaches it.
func TestAHazardousVerbIsRefusedFromChat(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "resume the mower", devices.VerbResume)
	if !handled {
		t.Fatal("not handled — the ceiling was never consulted, so this proves nothing")
	}
	if res.Actuated {
		t.Fatal("chat resumed a mower's blades")
	}
	if !strings.Contains(res.Reply, "hazardous-motion") {
		t.Errorf("refusal does not name the tier: %q", res.Reply)
	}
	if !strings.Contains(res.Reply, "console") {
		t.Errorf("refusal does not say where it CAN be done: %q", res.Reply)
	}
	if n := e.commands(t, "resume"); n != 0 {
		t.Errorf("a refused command was audited as sent: %d", n)
	}
}

// A consequential verb needs the second message §3.4 requires. Resuming the
// cleaning bot costs time and power and is T2.
func TestAConsequentialVerbNeedsConfirming(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "resume the cleaning bot", devices.VerbResume)
	if !handled {
		t.Fatal("not handled")
	}
	if res.Actuated {
		t.Fatal("a T2 verb actuated on one message")
	}
	tok := tokenFrom(t, res.Reply)
	if !strings.Contains(res.Reply, "Cleaning Bot") {
		t.Errorf("prompt does not name the device being authorized: %q", res.Reply)
	}
	// Explicitly not "reply yes" — §3.4 rules that out.
	if strings.Contains(strings.ToLower(res.Reply), "reply yes") {
		t.Errorf("prompt asks for a replayable yes: %q", res.Reply)
	}
	if n := e.commands(t, "resume"); n != 0 {
		t.Errorf("an unconfirmed command was audited as sent: %d", n)
	}

	// The second message, carrying the token alongside the command.
	res2, handled2 := e.actIn(t, "resume the cleaning bot "+tok, "chat-1", tok, devices.VerbResume)
	if !handled2 || !res2.Actuated {
		t.Fatalf("confirmed command did not run: handled=%v reply=%q", handled2, res2.Reply)
	}
	if n := e.commands(t, "resume"); n != 1 {
		t.Errorf("audited `resume` rows: %d, want 1", n)
	}
}

// A confirmation raises the ceiling by ONE tier. T4 stays refused however many
// messages arrive: §3.3 wants step-up on a different rail and an armed window,
// and a token is neither.
func TestAConfirmationDoesNotUnlockHazardousMotion(t *testing.T) {
	e := actuationServer(t)
	res, _ := e.act(t, "resume the mower", devices.VerbResume)
	if strings.Contains(res.Reply, "send this back") {
		t.Fatal("a T4 verb was offered a confirmation")
	}
	if !strings.Contains(res.Reply, "hazardous-motion") {
		t.Errorf("refusal does not name the tier: %q", res.Reply)
	}
	// Even holding a valid token for something else, T4 does not open. Mint one
	// against the cleaning bot, then present it at the mower.
	prompt, _ := e.act(t, "resume the cleaning bot", devices.VerbResume)
	tok := tokenFrom(t, prompt.Reply)
	res2, _ := e.actIn(t, "resume the mower "+tok, "chat-1", tok, devices.VerbResume)
	if res2.Actuated {
		t.Fatal("a confirmation for one device started a mower")
	}
	if n := e.commands(t, "resume"); n != 0 {
		t.Errorf("something ran: %d resume rows", n)
	}
}

// §3.4's whole reason for existing: "a confirmation for 'start the mower'
// cannot confirm 'unlock the front door' if the two exchanges interleave".
//
// The token here is entirely VALID — right subject, right conversation,
// unexpired, unspent — and was minted for a different intent. Only the hash
// comparison stands between it and actuating the wrong device, and a tamper
// removing that comparison left every other test in this package green, because
// the mock fleet has one T2 device and a same-tier mismatch cannot be built by
// sending messages. Minting directly is what makes the branch reachable.
func TestAValidTokenForAnotherIntentConfirmsNothing(t *testing.T) {
	e := actuationServer(t)
	tok, err := e.st.MintConfirmation(context.Background(), store.PendingConfirmation{
		Subject: "profile:" + e.profile, Channel: channels.KindWhatsApp, ChatID: "chat-1",
		// A different device entirely.
		IntentHash: store.IntentHash("mock:mower-1", "resume", nil),
		DeviceKey:  "mock:mower-1", Verb: "resume",
	}, time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}

	res, handled := e.actIn(t, "resume the cleaning bot "+tok, "chat-1", tok, devices.VerbResume)
	if !handled {
		t.Fatal("not handled")
	}
	if res.Actuated {
		t.Fatal("a confirmation minted for the mower resumed the cleaning bot")
	}
	if !strings.Contains(res.Reply, "mower-1") {
		t.Errorf("reply does not say what the token was actually for: %q", res.Reply)
	}
	if n := e.commands(t, "resume"); n != 0 {
		t.Errorf("something ran: %d rows", n)
	}

	// The mis-aimed token is SPENT — it was authentic and it was used. Leaving
	// it live would make a mis-aimed confirmation reusable.
	res2, _ := e.actIn(t, "resume the cleaning bot "+tok, "chat-1", tok, devices.VerbResume)
	if res2.Actuated {
		t.Error("a mis-aimed confirmation was still spendable")
	}
}

// A refused command does not consume the member's confirmation.
//
// The tier check runs BEFORE redemption, so presenting a cleaning-bot token at
// the mower refuses on tier and leaves the token intact for what it was minted
// for. I expected the opposite when writing this and the code was right: a
// command that never got as far as being authorized has no business spending
// the authorization, and destroying it would mean a mistyped device name costs
// the member their confirmation and a fresh round trip.
func TestARefusedCommandDoesNotSpendTheConfirmation(t *testing.T) {
	e := actuationServer(t)
	prompt, _ := e.act(t, "resume the cleaning bot", devices.VerbResume)
	tok := tokenFrom(t, prompt.Reply)

	res, handled := e.actIn(t, "resume the mower "+tok, "chat-1", tok, devices.VerbResume)
	if !handled || res.Actuated {
		t.Fatalf("a token aimed at a T4 verb actuated: %q", res.Reply)
	}
	res2, _ := e.actIn(t, "resume the cleaning bot "+tok, "chat-1", tok, devices.VerbResume)
	if !res2.Actuated {
		t.Errorf("the refused command consumed the confirmation: %q", res2.Reply)
	}
}

// A spent token does not work twice, end to end.
func TestAConfirmationIsSingleUseThroughTheRail(t *testing.T) {
	e := actuationServer(t)
	prompt, _ := e.act(t, "resume the cleaning bot", devices.VerbResume)
	tok := tokenFrom(t, prompt.Reply)

	if res, _ := e.actIn(t, "resume the cleaning bot "+tok, "chat-1", tok, devices.VerbResume); !res.Actuated {
		t.Fatal("first confirmation failed")
	}
	res, _ := e.actIn(t, "resume the cleaning bot "+tok, "chat-1", tok, devices.VerbResume)
	if res.Actuated {
		t.Error("a spent confirmation actuated a second time")
	}
	if n := e.commands(t, "resume"); n != 1 {
		t.Errorf("audited `resume` rows: %d, want 1", n)
	}
}

// A token from one conversation does not work in another, even for the same
// member — §3.4 requires the confirming message to be in the same conversation.
func TestAConfirmationDoesNotCrossConversations(t *testing.T) {
	e := actuationServer(t)
	prompt, _ := e.actIn(t, "resume the cleaning bot", "chat-1", "", devices.VerbResume)
	tok := tokenFrom(t, prompt.Reply)

	res, _ := e.actIn(t, "resume the cleaning bot "+tok, "chat-2", tok, devices.VerbResume)
	if res.Actuated {
		t.Fatal("a token was spent in another conversation")
	}
}

// tokenFrom pulls the minted token out of a prompt, and fails loudly if the
// prompt did not carry one — a test that silently used "" would exercise the
// unconfirmed path while claiming to test the confirmed one.
func tokenFrom(t *testing.T, reply string) string {
	t.Helper()
	tok, ok := store.ConfirmationTokenIn(reply)
	if !ok {
		t.Fatalf("no confirmation token in reply: %q", reply)
	}
	return tok
}

// `start` is refused earlier still: it is not a verb chat sends at all.
func TestStartIsNotAVerbChatSends(t *testing.T) {
	e := actuationServer(t)
	if _, handled := e.act(t, "start the mower", devices.VerbStart); handled {
		t.Error("chat claimed to handle `start`")
	}
}

// And the verb that IS reachable on the same device: §3.2 requires every
// hazardous verb to have a safe inverse, and stopping must never be harder
// than starting.
func TestStoppingIsReachableWhereStartingIsNot(t *testing.T) {
	e := actuationServer(t)
	res, handled := e.act(t, "stop the mower", devices.VerbStop)
	if !handled || !res.Actuated {
		t.Fatalf("stop refused: handled=%v reply=%q", handled, res.Reply)
	}
}

// Ambiguity actuates nothing — §3.5, and the reason the resolver refuses ties.
func TestAnAmbiguousBodyActuatesNothing(t *testing.T) {
	e := actuationServer(t)
	// "the light" names no device: below the floor on kind alone.
	if res, handled := e.act(t, "turn on the light", devices.VerbOn); handled && res.Actuated {
		t.Fatal("an unresolved body actuated a device")
	}
	if n := e.commands(t, "on"); n != 0 {
		t.Errorf("an unresolved body wrote an audit row: %d", n)
	}
}

// A genuine ambiguity — two devices with the same name, both able to do it —
// actuates NOTHING.
//
// The mock fleet has one device per name, so the earlier test only ever reached
// "resolved nothing". This registers the driver twice so "Garden Lights" exists
// on both, which is the realistic collision: two bridges, one lamp name. It is
// the case where taking the first candidate would be silently wrong, and where
// the member would be told the right device had been driven.
func TestATrueAmbiguityActuatesNothing(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, _ := keys.Load(dir)
	reg := devices.NewRegistry()
	for _, id := range []string{"mock", "mock2"} {
		if err := reg.Register(devices.NewMockDriver(id)); err != nil {
			t.Fatal(err)
		}
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	register(t, h, "amb@act.test")
	u, err := st.UserByUsername(context.Background(), "amb@act.test")
	if err != nil {
		t.Fatal(err)
	}

	res, handled := srv.chatActuate(context.Background(), "turn on the garden lights", u.ID,
		channels.KindWhatsApp, "chat-1", "", devices.VerbOn)
	if handled && res.Actuated {
		t.Fatal("actuated one of two identically named devices — the member would be told the right one moved")
	}
	var n int
	if err := st.DB().QueryRow(`SELECT count(*) FROM access_logs WHERE command = 'on'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("an ambiguous body wrote %d audit rows", n)
	}
}

// The cooldown §3.3's T1 row requires. A duplicate webhook delivery must not
// actuate twice.
func TestTheSameCommandTwiceIsCooledDown(t *testing.T) {
	e := actuationServer(t)
	if res, _ := e.act(t, "turn on the garden lights", devices.VerbOn); !res.Actuated {
		t.Fatal("first actuation failed")
	}
	res, handled := e.act(t, "turn on the garden lights", devices.VerbOn)
	if !handled {
		t.Fatal("second attempt was not handled")
	}
	if res.Actuated {
		t.Error("the same command actuated twice inside the cooldown")
	}
	if !strings.Contains(res.Reply, "give it a moment") {
		t.Errorf("cooldown refusal does not explain itself: %q", res.Reply)
	}
	if n := e.commands(t, "on"); n != 1 {
		t.Errorf("audited `on` rows: %d, want 1 — a cooled-down attempt was logged as sent", n)
	}
}

// The cooldown is per (subject, device, VERB). Turning a lamp on and then off
// is a legitimate sequence, not a repeat, and a member must not be told to wait.
func TestTheCooldownDoesNotBlockTheInverseVerb(t *testing.T) {
	e := actuationServer(t)
	if res, _ := e.act(t, "turn on the garden lights", devices.VerbOn); !res.Actuated {
		t.Fatal("on failed")
	}
	if res, _ := e.act(t, "turn off the garden lights", devices.VerbOff); !res.Actuated {
		t.Errorf("off was blocked by on's cooldown: %q", res.Reply)
	}
}

// And per DEVICE: one lamp's cooldown must not silence another device.
func TestTheCooldownIsPerDevice(t *testing.T) {
	e := actuationServer(t)
	if res, _ := e.act(t, "stop the mower", devices.VerbStop); !res.Actuated {
		t.Fatal("mower stop failed")
	}
	if res, _ := e.act(t, "stop the cleaning bot", devices.VerbStop); !res.Actuated {
		t.Errorf("one device's cooldown blocked another: %q", res.Reply)
	}
}

// A verb taking a value is not sent from chat at all, even at T1.
func TestAVerbWithAnArgumentIsNotSentFromChat(t *testing.T) {
	e := actuationServer(t)
	if _, handled := e.act(t, "set the thermostat to 21", devices.VerbSet); handled {
		t.Error("chat sent a verb that takes a value")
	}
}

// No engine configured is not an error and not an actuation.
func TestNoEngineMeansTheRailFallsThrough(t *testing.T) {
	h := newTestServer(t, "")
	_ = h
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, _ := keys.Load(dir)
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef")},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	if _, handled := srv.chatActuate(context.Background(), "turn on the lights", "nobody", channels.KindWhatsApp, "chat-1", "", devices.VerbOn); handled {
		t.Error("a hub with no engine claimed to handle an actuation")
	}
}

// ---------------------------------------------------------------------------
// End to end, through the real webhooks.
// ---------------------------------------------------------------------------

// Everything above drives chatActuate directly. That establishes the rule and
// says nothing about whether a rail reaches it — and until this test, none did:
// setupChannels attaches no engine, so registry() was nil in every chat test and
// the actuation branch returned "not handled" before doing anything.
//
// The same gap I have hit twice before in this package, in the same shape: a
// helper proved correct and a call site nobody exercised.
func TestARealMessageActuatesADevice(t *testing.T) {
	e := setupChannelsWithEngine(t, permissiveRL())

	rec := waPost(e.h, waTextMsg(testPhoneRaw, "wamid.act1", "turn on the garden lights", waPhoneID))
	if rec.Code != 200 {
		t.Fatalf("code %d", rec.Code)
	}
	sent := e.wa.all()
	if len(sent) != 1 {
		t.Fatalf("replies: %+v", sent)
	}
	if !strings.Contains(sent[0].body, "Garden Lights") || !strings.Contains(sent[0].body, "now on") {
		t.Errorf("reply does not report the actuation: %q", sent[0].body)
	}

	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 100)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range logs {
		if l.Command == "on" && l.Source == channels.KindWhatsApp {
			n++
		}
	}
	if n != 1 {
		t.Errorf("audited `on` rows from whatsapp: %d, want 1", n)
	}
}

// The confirmation round trip over a real rail.
//
// This is the test that can only be written end to end: redemption requires the
// SAME conversation, so it fails if a rail threads a different chat id into the
// second message than it did the first. Calling chatActuate directly passes a
// chat id chosen by the test and could never catch that.
func TestAConfirmationRoundTripsOverARealRail(t *testing.T) {
	e := setupChannelsWithEngine(t, permissiveRL())

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.c1", "resume the cleaning bot", waPhoneID))
	first := e.wa.all()
	if len(first) != 1 {
		t.Fatalf("replies: %+v", first)
	}
	tok, ok := store.ConfirmationTokenIn(first[0].body)
	if !ok {
		t.Fatalf("no token in the prompt: %q", first[0].body)
	}

	// Nothing has run yet.
	if countCommands(t, e, "resume") != 0 {
		t.Fatal("a T2 verb ran on the first message")
	}

	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.c2", "resume the cleaning bot "+tok, waPhoneID))
	second := e.wa.all()
	if len(second) != 2 {
		t.Fatalf("replies after confirming: %+v", second)
	}
	if !strings.Contains(second[1].body, "Cleaning Bot") {
		t.Errorf("confirmation reply: %q", second[1].body)
	}
	if n := countCommands(t, e, "resume"); n != 1 {
		t.Errorf("audited `resume` rows: %d, want 1 — the confirmation did not carry", n)
	}
}

// A hazardous verb is refused over the wire too, with no token offered.
func TestARealMessageCannotStartAMowersBlades(t *testing.T) {
	e := setupChannelsWithEngine(t, permissiveRL())
	waPost(e.h, waTextMsg(testPhoneRaw, "wamid.haz", "resume the mower", waPhoneID))
	sent := e.wa.all()
	if len(sent) != 1 {
		t.Fatalf("replies: %+v", sent)
	}
	if strings.Contains(sent[0].body, "send this back") {
		t.Error("a T4 verb was offered a confirmation over the wire")
	}
	if n := countCommands(t, e, "resume"); n != 0 {
		t.Errorf("a mower resumed: %d rows", n)
	}
}

func countCommands(t *testing.T, e *chEnv, command string) int {
	t.Helper()
	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 200)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range logs {
		if l.Command == command && l.Success {
			n++
		}
	}
	return n
}
