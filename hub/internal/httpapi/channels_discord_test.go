package httpapi

// Discord wiring proof: an inbound Gateway event reaches the SAME shared open
// path every other rail uses, a tap opens and closes a gate through the SAME
// choke point, and everything this rail did not mint actuates nothing.
//
// Nothing here touches the network: the events are fed to the rail's Handle
// exactly as channels.Discord would after decoding a Gateway frame (the
// connection itself is tested in channels/discord_gateway_test.go against a
// fake gateway), and the sender is a recording fake.

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/vul-os/aql/hub/internal/channels"
)

const testDiscordUID = "123456789012345678" // a Discord user snowflake

type discordSent struct {
	channel    string
	text       string
	components []channels.DiscordComponent
}

type fakeDiscord struct {
	mu   sync.Mutex
	sent []discordSent
	acks int
}

func (f *fakeDiscord) SendText(_ context.Context, ch, content string) channels.SendResult {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, discordSent{channel: ch, text: content})
	return channels.SendResult{OK: true, ProviderMessageID: "dm-out"}
}

func (f *fakeDiscord) SendComponents(_ context.Context, ch, content string, c []channels.DiscordComponent) channels.SendResult {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, discordSent{channel: ch, text: content, components: c})
	return channels.SendResult{OK: true, ProviderMessageID: "dm-out"}
}

func (f *fakeDiscord) AckComponent(_ context.Context, id, token string) channels.SendResult {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id == "" || token == "" {
		return channels.SendResult{Error: "discord_interaction_unset"}
	}
	f.acks++
	return channels.SendResult{OK: true}
}

func (f *fakeDiscord) all() []discordSent {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]discordSent(nil), f.sent...)
}

func (f *fakeDiscord) ackCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.acks
}

// discordEnv is a channel harness with the Discord rail attached and the test
// member linked on it.
type discordEnv struct {
	*chEnv
	dc *fakeDiscord
}

func setupDiscord(t *testing.T) *discordEnv {
	t.Helper()
	e := setupChannels(t, permissiveRL())
	fd := &fakeDiscord{}
	e.s.attachDiscord(fd, &channels.Discord{BotToken: "test-bot-token"})
	// Same member, a second rail: identity is keyed on (channel,
	// external_id), so this is one person reachable twice — not two members.
	if err := e.st.LinkChannelIdentity(context.Background(), channels.KindDiscord, testDiscordUID, e.ownID); err != nil {
		t.Fatal(err)
	}
	return &discordEnv{chEnv: e, dc: fd}
}

// message feeds one MESSAGE_CREATE through the rail's Handle, the way the
// Gateway connection does.
func (e *discordEnv) message(t *testing.T, id, userID, content string) {
	t.Helper()
	e.event(t, channels.DiscordEventMessageCreate, map[string]any{
		"id": id, "channel_id": "chan-1", "guild_id": "g1", "content": content,
		"timestamp": "2026-07-27T10:00:00.000000+00:00",
		"author":    map[string]any{"id": userID, "username": "ada", "bot": false},
	})
}

// tap feeds one INTERACTION_CREATE (a component tap) through the rail.
func (e *discordEnv) tap(t *testing.T, userID, customID string) {
	t.Helper()
	e.event(t, channels.DiscordEventInteractionCreate, map[string]any{
		"id": "inter-1", "token": "interaction-token", "type": channels.DiscordInteractionMessageComponent,
		"channel_id": "chan-1",
		"data":       map[string]any{"custom_id": customID, "component_type": 2},
		"member":     map[string]any{"user": map[string]any{"id": userID, "username": "ada"}},
	})
}

func (e *discordEnv) event(t *testing.T, eventType string, payload map[string]any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	e.s.handleDiscordEvent(context.Background(), e.dc, eventType, json.RawMessage(raw))
}

// commands counts audited successful actuations of one command on one source.
func (e *discordEnv) commands(t *testing.T, source, command string) int {
	t.Helper()
	logs, err := e.st.AccessLogsByAccount(context.Background(), e.acct, 200)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, l := range logs {
		if l.Success && l.Command == command && l.Source == source {
			n++
		}
	}
	return n
}

func (e *discordEnv) lastReply(t *testing.T) discordSent {
	t.Helper()
	sent := e.dc.all()
	if len(sent) == 0 {
		t.Fatal("the rail replied nothing")
	}
	return sent[len(sent)-1]
}

// ---------------------------------------------------------------------------
// The shared open path
// ---------------------------------------------------------------------------

// TestDiscordMessageReachesTheSharedOpenPath: a linked member's "open" with a
// single gate runs the SAME store.LogAccess → sign → dispatch choke point the
// HTTP route and every other rail use — proven by the audit row, which is
// written by the choke point and nowhere else, and attributed to this rail.
func TestDiscordMessageReachesTheSharedOpenPath(t *testing.T) {
	e := setupDiscord(t)
	e.message(t, "m1", testDiscordUID, "open")

	if n := e.commands(t, channels.KindDiscord, "open"); n != 1 {
		t.Fatalf("discord open not audited through the shared path: %d", n)
	}
	if got := e.lastReply(t); !strings.Contains(got.text, "Opening Main gate") {
		t.Fatalf("reply: %+v", got)
	}
	// The source is this rail's own — never another rail's, since the audit
	// log is evidence about a system that opens physical gates.
	if n := e.commands(t, channels.KindSlack, "open"); n != 0 {
		t.Fatalf("a discord open was attributed to slack: %d", n)
	}
}

// TestDiscordCloseIsReachableWhereverOpenIs — the invariant fb01edc had to
// retrofit onto Telegram and Slack. This rail must ship with it, by the same
// route: the word, the picker and the tap.
func TestDiscordCloseIsReachableWhereverOpenIs(t *testing.T) {
	e := setupDiscord(t)

	// 1. The word.
	e.message(t, "m1", testDiscordUID, "close")
	if n := e.commands(t, channels.KindDiscord, "close"); n != 1 {
		t.Fatalf(`"close" did not close: %d`, n)
	}
	if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
		t.Fatalf("a close request opened a gate: %d", n)
	}
	if got := e.lastReply(t); !strings.Contains(got.text, "Closing Main gate") {
		t.Fatalf("close reply: %+v", got)
	}

	// 2. The menu names it, so a resident can find it at all.
	e.message(t, "m2", testDiscordUID, "help")
	if got := e.lastReply(t); !strings.Contains(strings.ToLower(got.text), "close") {
		t.Fatalf("menu does not name close: %q", got.text)
	}

	// 3. The picker mints it, and the tap actuates it.
	createAP(t, e.h, e.ownerA, e.loc, "Side gate")
	e.message(t, "m3", testDiscordUID, "close")
	picker := e.lastReply(t)
	if picker.components == nil {
		t.Fatalf("multi-gate close rendered no picker: %+v", picker)
	}
	if !strings.Contains(picker.text, "haven't closed anything") {
		t.Errorf("a close picker must say nothing has moved yet: %q", picker.text)
	}
	ids := discordCustomIDs(t, picker.components)
	for _, id := range ids {
		if !strings.HasPrefix(id, channels.SelCloseAP+":") {
			t.Fatalf("a close picker minted a button that opens: %q", id)
		}
	}
	before := e.commands(t, channels.KindDiscord, "close")
	e.tap(t, testDiscordUID, ids[0])
	if n := e.commands(t, channels.KindDiscord, "close"); n != before+1 {
		t.Fatalf("close tap did not actuate: %d → %d", before, n)
	}
	if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
		t.Fatalf("close path opened a gate: %d", n)
	}
}

// discordCustomIDs flattens a rendered picker's button ids.
func discordCustomIDs(t *testing.T, rows []channels.DiscordComponent) []string {
	t.Helper()
	var out []string
	for _, row := range rows {
		btns, ok := row["components"].([]channels.DiscordComponent)
		if !ok {
			t.Fatalf("action row carries no components: %+v", row)
		}
		for _, b := range btns {
			id, _ := b["custom_id"].(string)
			out = append(out, id)
		}
	}
	if len(out) == 0 {
		t.Fatal("picker carried no buttons")
	}
	return out
}

// TestDiscordPickerRendersWithoutActuating: showing the list is not choosing
// from it.
func TestDiscordPickerRendersWithoutActuating(t *testing.T) {
	e := setupDiscord(t)
	createAP(t, e.h, e.ownerA, e.loc, "Side gate")
	e.message(t, "m1", testDiscordUID, "open")
	got := e.lastReply(t)
	if got.components == nil {
		t.Fatalf("multi-gate open rendered no picker: %+v", got)
	}
	if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
		t.Fatalf("rendering the picker opened %d gate(s)", n)
	}
	for _, id := range discordCustomIDs(t, got.components) {
		if !strings.HasPrefix(id, channels.SelOpenAP+":") {
			t.Fatalf("open picker minted %q", id)
		}
	}
}

// TestDiscordPickerOverCapacityDisclosesTruncation, end to end through the
// handler: the reply a member actually receives says the list is incomplete.
func TestDiscordPickerOverCapacityDisclosesTruncation(t *testing.T) {
	e := setupDiscord(t)
	for i := 0; i < channels.PickerCapacity+3; i++ {
		createAP(t, e.h, e.ownerA, e.loc, "Extra gate "+string(rune('A'+i)))
	}
	e.message(t, "m1", testDiscordUID, "open")
	got := e.lastReply(t)
	ids := discordCustomIDs(t, got.components)
	if len(ids) != channels.PickerCapacity {
		t.Fatalf("picker rendered %d buttons, want the %d capacity", len(ids), channels.PickerCapacity)
	}
	if !strings.Contains(got.text, "this list is incomplete") {
		t.Fatalf("a truncated picker must say so: %q", got.text)
	}
}

// TestDiscordTapIsAcknowledgedBeforeTheOpen: Discord expires an interaction
// in ~3s, which is shorter than the open path's own ceiling, so the tap is
// acknowledged first — and acknowledging claims nothing about the gate.
func TestDiscordTapIsAcknowledgedBeforeTheOpen(t *testing.T) {
	e := setupDiscord(t)
	e.tap(t, testDiscordUID, channels.SelOpenAP+":"+e.apID)
	if e.dc.ackCount() != 1 {
		t.Fatalf("tap was not acknowledged: %d acks", e.dc.ackCount())
	}
	if n := e.commands(t, channels.KindDiscord, "open"); n != 1 {
		t.Fatalf("tap did not open: %d", n)
	}
}

// ---------------------------------------------------------------------------
// Nothing this rail did not mint actuates anything
// ---------------------------------------------------------------------------

// TestDiscordUnknownCustomIDActuatesNothing. The verb and the target come out
// of the SHARED allowlist, never from a prefix test: an id with no command, an
// id from another rail's scheme, and a narrowing id are all refused.
func TestDiscordUnknownCustomIDActuatesNothing(t *testing.T) {
	for _, customID := range []string{
		"",                        // nothing at all
		"open_gate:AP",            // Slack's scheme, not this rail's
		"select_loc:LOC",          // a narrowing step, never an actuation
		"select_loc_close:LOC",    // ditto
		"open_ap:",                // no target
		"unprefixed",              // no command
		"OPEN_AP:AP",              // not the exact command word
		"open_ap:not-a-real-gate", // well-formed, but not an AP this member has
	} {
		e := setupDiscord(t)
		id := strings.ReplaceAll(customID, "AP", e.apID)
		e.tap(t, testDiscordUID, id)
		if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
			t.Errorf("custom_id %q opened a gate", customID)
		}
		if n := e.commands(t, channels.KindDiscord, "close"); n != 0 {
			t.Errorf("custom_id %q closed a gate", customID)
		}
	}
}

// TestDiscordUnlinkedUserNoActuation: an unlinked snowflake is told how to get
// linked and actuates nothing — a platform-asserted id is a lookup key, never
// an authorization.
func TestDiscordUnlinkedUserNoActuation(t *testing.T) {
	e := setupDiscord(t)
	e.message(t, "m1", "999999999999999999", "open")
	if got := e.lastReply(t); !strings.Contains(got.text, "isn't linked to an Aql member") {
		t.Fatalf("unlinked reply: %+v", got)
	}
	if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
		t.Fatalf("an unlinked user opened %d gate(s)", n)
	}

	// A tap from an unlinked user actuates nothing either.
	e.tap(t, "999999999999999999", channels.SelOpenAP+":"+e.apID)
	if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
		t.Fatalf("an unlinked tap opened %d gate(s)", n)
	}
}

// TestDiscordFailsClosedOnMalformedEvents: a bot, a webhook post, an authorless
// message, a payload that does not decode, an event this rail never asked for,
// and an interaction type it never rendered all actuate nothing and answer
// nothing.
func TestDiscordFailsClosedOnMalformedEvents(t *testing.T) {
	e := setupDiscord(t)
	ctx := context.Background()

	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	base := map[string]any{"id": "m1", "channel_id": "chan-1", "content": "open"}
	with := func(author map[string]any, extra map[string]any) json.RawMessage {
		m := map[string]any{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		m["author"] = author
		return raw(m)
	}

	cases := []struct {
		name    string
		event   string
		payload json.RawMessage
	}{
		{"bot author", channels.DiscordEventMessageCreate,
			with(map[string]any{"id": testDiscordUID, "bot": true}, nil)},
		{"webhook post", channels.DiscordEventMessageCreate,
			with(map[string]any{"id": testDiscordUID}, map[string]any{"webhook_id": "w1"})},
		{"no author", channels.DiscordEventMessageCreate, raw(base)},
		{"undecodable", channels.DiscordEventMessageCreate, json.RawMessage(`{"id":`)},
		{"unrequested event", "GUILD_MEMBER_ADD",
			with(map[string]any{"id": testDiscordUID}, nil)},
		{"interaction type we never rendered", channels.DiscordEventInteractionCreate,
			raw(map[string]any{"id": "i1", "token": "t", "type": 2, "channel_id": "chan-1",
				"data":   map[string]any{"custom_id": channels.SelOpenAP + ":" + e.apID},
				"member": map[string]any{"user": map[string]any{"id": testDiscordUID}}})},
		{"interaction naming nobody", channels.DiscordEventInteractionCreate,
			raw(map[string]any{"id": "i2", "token": "t", "type": channels.DiscordInteractionMessageComponent,
				"channel_id": "chan-1",
				"data":       map[string]any{"custom_id": channels.SelOpenAP + ":" + e.apID}})},
	}
	for _, tc := range cases {
		e.s.handleDiscordEvent(ctx, e.dc, tc.event, tc.payload)
		if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
			t.Fatalf("%s actuated an open", tc.name)
		}
	}
	if sent := e.dc.all(); len(sent) != 0 {
		t.Fatalf("malformed events produced %d repl(ies): %+v", len(sent), sent)
	}
}

// TestDiscordRedeliveryDoesNotDoubleOpen. Every RESUME replays what the socket
// missed and may replay what it did not, so the inbound dedupe — the SAME
// (channel, provider_message_id) index every other rail uses — has to hold.
func TestDiscordRedeliveryDoesNotDoubleOpen(t *testing.T) {
	e := setupDiscord(t)
	e.message(t, "m-dup", testDiscordUID, "open")
	e.message(t, "m-dup", testDiscordUID, "open")
	if n := e.commands(t, channels.KindDiscord, "open"); n != 1 {
		t.Fatalf("a redelivered message opened the gate %d times", n)
	}
	if sent := e.dc.all(); len(sent) != 1 {
		t.Fatalf("a redelivered message got %d replies", len(sent))
	}
}

// TestDiscordIdentityIsOnePersonAcrossRails: identity is keyed on (channel,
// external_id), so the same member reachable on Discord and on Slack is one
// member with one set of gates — not two records.
func TestDiscordIdentityIsOnePersonAcrossRails(t *testing.T) {
	e := setupDiscord(t)
	ctx := context.Background()

	discordProfile, err := e.st.ResolveChannelIdentity(ctx, channels.KindDiscord, testDiscordUID)
	if err != nil {
		t.Fatal(err)
	}
	slackProfile, err := e.st.ResolveChannelIdentity(ctx, channels.KindSlack, testSlackUID)
	if err != nil {
		t.Fatal(err)
	}
	if discordProfile == "" || discordProfile != slackProfile {
		t.Fatalf("two rails resolved to different members: discord=%q slack=%q", discordProfile, slackProfile)
	}
	// And a Discord snowflake is not a Slack id: the same string on another
	// rail is a different, unlinked identity.
	if p, _ := e.st.ResolveChannelIdentity(ctx, channels.KindSlack, testDiscordUID); p != "" {
		t.Fatalf("a discord snowflake resolved on the slack rail: %q", p)
	}
}

// TestDiscordRailRegisteredOnlyWhenConfigured: fail-closed registration — a
// bot token builds the rail, no token builds nothing.
func TestDiscordRailRegisteredOnlyWhenConfigured(t *testing.T) {
	for _, tc := range []struct {
		token string
		want  bool
	}{{"", false}, {"a-bot-token", true}} {
		s := newEngineTestServer(t, channels.Config{DiscordBotToken: tc.token}, nil)
		found := false
		for _, d := range s.dial {
			if d.Kind() == channels.KindDiscord {
				found = true
				if !d.Enabled() {
					t.Error("a registered discord rail reported itself disabled")
				}
			}
		}
		if found != tc.want {
			t.Errorf("token %q: rail registered = %v, want %v", tc.token, found, tc.want)
		}
	}
}

// TestDiscordConfigReadFromEnv: the operator-facing knob is one env var, in
// the same shape as every other provider credential.
func TestDiscordConfigReadFromEnv(t *testing.T) {
	env := map[string]string{"DISCORD_BOT_TOKEN": "tok-from-env"}
	cfg := channels.FromEnv(func(k string) string { return env[k] }, "https://gate.example")
	if cfg.DiscordBotToken != "tok-from-env" {
		t.Fatalf("DISCORD_BOT_TOKEN not read: %q", cfg.DiscordBotToken)
	}
	if empty := channels.FromEnv(func(string) string { return "" }, ""); empty.DiscordBotToken != "" {
		t.Error("an unset environment must leave the rail unconfigured")
	}
}

// TestDiscordNoAccessRepliesHonestly: a linked member with no gates is told
// so, rather than shown an empty picker.
func TestDiscordNoAccessRepliesHonestly(t *testing.T) {
	e := setupDiscord(t)
	ctx := context.Background()
	// A second member on the same instance, linked on Discord, with no access.
	otherAccess, _ := register(t, e.h, "nogates@ch.com")
	otherID := meID(t, e.h, otherAccess)
	if err := e.st.LinkChannelIdentity(ctx, channels.KindDiscord, "222222222222222222", otherID); err != nil {
		t.Fatal(err)
	}
	e.message(t, "m1", "222222222222222222", "open")
	if got := e.lastReply(t); !strings.Contains(got.text, "don't have any active gate access") {
		t.Fatalf("no-access reply: %+v", got)
	}
	if n := e.commands(t, channels.KindDiscord, "open"); n != 0 {
		t.Fatalf("a member with no access opened %d gate(s)", n)
	}
}
