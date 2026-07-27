package channels

// Renderer + wire tests for the Discord rail. The wiring proof (an inbound
// message reaching the shared handler, a tap opening and closing a gate
// through the shared choke point) lives in
// httpapi/channels_discord_test.go; these pin the pieces that make it true.

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/gateway/internal/store"
)

// discordButtons flattens a rendered picker into (custom_id, label) pairs and
// checks the row structure Discord requires on the way through.
func discordButtons(t *testing.T, rows []DiscordComponent) [][2]string {
	t.Helper()
	if len(rows) > DiscordMaxActionRows {
		t.Fatalf("%d action rows, over the %d ceiling", len(rows), DiscordMaxActionRows)
	}
	var out [][2]string
	for _, row := range rows {
		if row["type"] != discordComponentActionRow {
			t.Fatalf("top-level component is not an action row: %+v", row)
		}
		btns, ok := row["components"].([]DiscordComponent)
		if !ok {
			t.Fatalf("action row carries no components: %+v", row)
		}
		if len(btns) > DiscordButtonsPerRow {
			t.Fatalf("%d buttons in one row, over the %d ceiling", len(btns), DiscordButtonsPerRow)
		}
		for _, b := range btns {
			if b["type"] != discordComponentButton {
				t.Fatalf("row carries a non-button: %+v", b)
			}
			id, _ := b["custom_id"].(string)
			label, _ := b["label"].(string)
			if len([]rune(label)) > DiscordMaxButtonLabel {
				t.Errorf("label %q is over the %d-char ceiling", label, DiscordMaxButtonLabel)
			}
			if len(id) > DiscordMaxCustomID {
				t.Errorf("custom_id %q is over the %d-char ceiling", id, DiscordMaxCustomID)
			}
			out = append(out, [2]string{id, label})
		}
	}
	return out
}

// TestDiscordPickerAtAndOverCapacity. Discord rejects a message over its
// component ceilings outright rather than trimming it, so an uncapped picker
// does not degrade — the reply simply fails to send and the member gets
// nothing. At capacity the list is complete and silent; over it, it is
// truncated and SAYS SO.
func TestDiscordPickerAtAndOverCapacity(t *testing.T) {
	for _, n := range []int{1, 5, 9, PickerCapacity, PickerCapacity + 1, 50, 1000} {
		gates := manyGates(n)
		for _, verb := range []GateVerb{VerbOpen, VerbClose} {
			body, rows := DiscordGatePicker(verb, "Which gate?", gates, testPortal)
			btns := discordButtons(t, rows)

			want := n
			if want > PickerCapacity {
				want = PickerCapacity
			}
			if len(btns) != want {
				t.Fatalf("%d gates, %s → %d buttons, want %d", n, verb, len(btns), want)
			}
			if n > PickerCapacity {
				if !strings.Contains(body, "this list is incomplete") {
					t.Errorf("%d gates, %s: truncated picker did not disclose it: %q", n, verb, body)
				}
			} else if strings.Contains(body, "incomplete") {
				t.Errorf("%d gates, %s: complete picker claimed truncation: %q", n, verb, body)
			}
		}
		// The verb changes the label and the id, never the button count — so
		// TruncationNotice keeps counting the same thing for both verbs.
		_, openRows := DiscordGatePicker(VerbOpen, "p", gates, testPortal)
		_, closeRows := DiscordGatePicker(VerbClose, "p", gates, testPortal)
		if len(discordButtons(t, openRows)) != len(discordButtons(t, closeRows)) {
			t.Errorf("%d gates: open and close render different button counts", n)
		}
	}
}

// TestDiscordPickerMintsSharedSelectionIDs. The rail reuses the open_ap/
// close_ap scheme ParseSelection already validates rather than inventing a
// fourth one — so the ids it mints are exactly the ids the shared allowlist
// accepts, and both directions agree on the verb.
func TestDiscordPickerMintsSharedSelectionIDs(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home")}
	for _, tc := range []struct {
		verb    GateVerb
		prefix  string
		command string
	}{
		{VerbOpen, SelOpenAP + ":", "open"},
		{VerbClose, SelCloseAP + ":", "close"},
	} {
		_, rows := DiscordGatePicker(tc.verb, "p", gates, testPortal)
		btns := discordButtons(t, rows)
		if len(btns) != 1 {
			t.Fatalf("want one button, got %d", len(btns))
		}
		id, label := btns[0][0], btns[0][1]
		if !strings.HasPrefix(id, tc.prefix) {
			t.Fatalf("%s rendered custom_id %q", tc.verb, id)
		}
		if !strings.HasPrefix(label, tc.verb.Title()+" ") {
			t.Errorf("%s rendered label %q", tc.verb, label)
		}
		cmd, arg, ok := ParseSelection(id)
		if !ok || arg != "ap1" {
			t.Fatalf("shared parser rejected a Discord id: %q (%v)", id, ok)
		}
		if got, ok := SelectionCommandVerb(cmd); !ok || got != tc.command {
			t.Fatalf("id %q resolved to verb %q (%v), want %q", id, got, ok, tc.command)
		}
	}
}

// TestDiscordPickerUnsetVerbCloses. The zero value of GateVerb must render a
// picker that CLOSES: a call site that forgets is then visibly wrong rather
// than dangerous (verb.go).
func TestDiscordPickerUnsetVerbCloses(t *testing.T) {
	var unset GateVerb
	_, rows := DiscordGatePicker(unset, "p", []store.AvailableAP{ap("ap1", "Main gate", "Home")}, testPortal)
	btns := discordButtons(t, rows)
	if len(btns) != 1 || !strings.HasPrefix(btns[0][0], SelCloseAP+":") {
		t.Fatalf("an unset verb must render close, got %+v", btns)
	}
}

// TestDiscordPickerDropsUnrenderableIDs. A custom_id over Discord's ceiling
// cannot be sent honestly, so the gate is dropped — and because dropping it
// reduces the shown count, the reply still says the list is incomplete rather
// than hiding the gap.
func TestDiscordPickerDropsUnrenderableIDs(t *testing.T) {
	long := strings.Repeat("x", DiscordMaxCustomID)
	gates := []store.AvailableAP{ap("ap1", "Main gate", "Home"), ap(long, "Huge id gate", "Home")}
	body, rows := DiscordGatePicker(VerbOpen, "Which gate?", gates, testPortal)
	btns := discordButtons(t, rows)
	if len(btns) != 1 || btns[0][0] != SelOpenAP+":ap1" {
		t.Fatalf("over-length id was rendered anyway: %+v", btns)
	}
	if !strings.Contains(body, "this list is incomplete") {
		t.Errorf("a dropped gate must be disclosed: %q", body)
	}
}

// TestDiscordPickerLabelTruncated. Discord rejects an over-length label, so a
// long gate name must be trimmed rather than sent.
func TestDiscordPickerLabelTruncated(t *testing.T) {
	gates := []store.AvailableAP{ap("ap1", strings.Repeat("Very long gate name ", 20), "Home")}
	_, rows := DiscordGatePicker(VerbOpen, "p", gates, testPortal)
	btns := discordButtons(t, rows) // asserts the ceiling itself
	if !strings.HasSuffix(btns[0][1], "…") {
		t.Errorf("a truncated label should say so: %q", btns[0][1])
	}
}

// TestDiscordContentClamped. Discord rejects an over-length message body
// outright; an unclamped reply would simply never arrive.
func TestDiscordContentClamped(t *testing.T) {
	if got := DiscordContent("short"); got != "short" {
		t.Errorf("short content was altered: %q", got)
	}
	long := DiscordContent(strings.Repeat("a", DiscordMaxContent+500))
	if n := len([]rune(long)); n > DiscordMaxContent {
		t.Fatalf("clamped content is %d runes, over the %d ceiling", n, DiscordMaxContent)
	}
	if !strings.HasSuffix(long, "…") {
		t.Errorf("clamped content should show it was cut: %q", long[len(long)-10:])
	}
}

// TestDiscordMenuNamesBothVerbs. On a rail whose entire interface is a
// message, a menu that only says "open" is a menu on which close does not
// exist — the property fb01edc had to retrofit onto two other rails.
func TestDiscordMenuNamesBothVerbs(t *testing.T) {
	m := DiscordMenu("Ada")
	for _, word := range []string{"open", "close"} {
		if !strings.Contains(strings.ToLower(m), word) {
			t.Errorf("menu does not name %q: %q", word, m)
		}
	}
	if !strings.Contains(m, "Ada") {
		t.Errorf("menu drops the member's name: %q", m)
	}
}

// ---------------------------------------------------------------------------
// Inbound wire — fail closed on anything that is not a human being
// ---------------------------------------------------------------------------

func TestDiscordMessageFromHuman(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want bool
	}{
		{"human", `{"id":"1","channel_id":"c","content":"open","author":{"id":"u1","bot":false}}`, true},
		{"bot", `{"id":"1","channel_id":"c","content":"open","author":{"id":"u1","bot":true}}`, false},
		{"webhook", `{"id":"1","channel_id":"c","content":"open","author":{"id":"u1"},"webhook_id":"w1"}`, false},
		{"no author", `{"id":"1","channel_id":"c","content":"open"}`, false},
	} {
		m, err := ParseDiscordMessage([]byte(tc.raw))
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got := m.FromHuman(); got != tc.want {
			t.Errorf("%s: FromHuman = %v, want %v", tc.name, got, tc.want)
		}
	}
	if _, err := ParseDiscordMessage([]byte(`{"id":`)); err == nil {
		t.Error("malformed MESSAGE_CREATE must not parse")
	}
}

// TestDiscordInteractionUserID: the tapper's snowflake comes from the guild
// shape or the DM shape, and a payload naming nobody names nobody.
func TestDiscordInteractionUserID(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want string
	}{
		{"guild", `{"type":3,"member":{"user":{"id":"u-guild"}}}`, "u-guild"},
		{"dm", `{"type":3,"user":{"id":"u-dm"}}`, "u-dm"},
		{"neither", `{"type":3}`, ""},
	} {
		i, err := ParseDiscordInteraction([]byte(tc.raw))
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got := i.UserID(); got != tc.want {
			t.Errorf("%s: UserID = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestDiscordEnabledFailsClosed(t *testing.T) {
	if (&Discord{}).Enabled() {
		t.Error("a rail with no bot token must be disabled")
	}
	if !(&Discord{BotToken: "tok"}).Enabled() {
		t.Error("a configured bot token should enable the rail")
	}
	if (&Discord{}).Kind() != KindDiscord {
		t.Error("Kind must be the discord identity space")
	}
}

// TestDiscordGatewayURLPinsVersion: the client decides which API version it
// speaks, not the URL the server handed back.
func TestDiscordGatewayURLPinsVersion(t *testing.T) {
	for _, in := range []string{"wss://gateway.discord.gg", "wss://gateway.discord.gg?v=6&encoding=etf"} {
		got := discordGatewayURL(in)
		if !strings.HasSuffix(got, "?v="+DiscordAPIVersion+"&encoding=json") {
			t.Errorf("%q → %q", in, got)
		}
		if strings.Count(got, "?") != 1 {
			t.Errorf("%q → %q has a mangled query", in, got)
		}
	}
}
