package channels

// Slack — two modes from one implementation. This file owns the Events API +
// interactions wire (verify, parse, block rendering); socketmode.go dials the
// zero-URL Socket Mode connection and feeds the SAME payloads back through the
// httpapi handler. Port of backend/src/routes/slack.ts (block_actions
// open_gate → verdict, hardened signature check).

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/vul-os/aql/hub/internal/store"
)

// Slack is the channel value.
type Slack struct {
	SigningSecret string
}

func (Slack) Kind() string { return KindSlack }

func (c Slack) Verify(headers http.Header, body []byte, now int64) VerifyResult {
	return verifySlackSig(c.SigningSecret, headers, body, now)
}

// ---------------------------------------------------------------------------
// Events API wire
// ---------------------------------------------------------------------------

type SlackEnvelope struct {
	Token     string      `json:"token"`
	Challenge string      `json:"challenge"`
	Type      string      `json:"type"`
	TeamID    string      `json:"team_id"`
	Event     *SlackEvent `json:"event"`
}

type SlackEvent struct {
	Type    string `json:"type"` // message | app_mention
	Channel string `json:"channel"`
	User    string `json:"user"`
	Text    string `json:"text"`
	TS      string `json:"ts"`
	BotID   string `json:"bot_id"`
}

// ParseSlackEnvelope decodes an Events API body.
func ParseSlackEnvelope(body []byte) (*SlackEnvelope, error) {
	var e SlackEnvelope
	if err := json.Unmarshal(body, &e); err != nil {
		return nil, err
	}
	return &e, nil
}

// ---------------------------------------------------------------------------
// Interactions wire (block_actions)
// ---------------------------------------------------------------------------

type SlackInteraction struct {
	Type       string              `json:"type"`
	CallbackID string              `json:"callback_id"`
	User       struct{ ID string } `json:"user"`
	Channel    struct{ ID string } `json:"channel"`
	Actions    []SlackAction       `json:"actions"`
}

type SlackAction struct {
	ActionID string `json:"action_id"`
	Value    string `json:"value"`
}

// ---------------------------------------------------------------------------
// Block Kit action ids
// ---------------------------------------------------------------------------

// The complete set of gate action_id prefixes this gateway mints on Slack.
// This is Slack's own id scheme, deliberately kept separate from the
// interactive-reply scheme WhatsApp and Telegram share (SelOpenAP/SelCloseAP):
// SlackActOpenGate is the value every Slack gate button ever rendered carries,
// and buttons already sitting in workspace histories are echoed back verbatim
// by Slack, so it keeps its exact wire value and keeps meaning open.
// SlackActCloseGate is ADDED alongside it — nothing is repurposed.
const (
	SlackActOpenGate  = "open_gate"
	SlackActCloseGate = "close_gate"
)

// SlackActionVerb maps a Slack action command to the verb it carries. The verb
// comes from this table, never from the id's text: ok is false for anything
// outside the two, including the open_ap:/close_ap: ids the OTHER rails mint —
// an id from a different rail's scheme is an id this handler did not write.
// store/openpath.go still independently rejects any command outside
// open/close; this sits above that boundary, it does not replace it.
func SlackActionVerb(cmd string) (GateVerb, bool) {
	switch cmd {
	case SlackActOpenGate:
		return VerbOpen, true
	case SlackActCloseGate:
		return VerbClose, true
	}
	return verbUnset, false
}

// ParseSlackAction splits a gate button's action_id ("<cmd>:<access point id>")
// into the verb it was rendered with and its target. It is the Slack-side twin
// of ParseSelection and fails closed for exactly the same reasons: ok is false
// for an id with no ':' prefix, an empty target, or a command outside
// SlackActionVerb's allowlist. Callers MUST check ok before touching verb —
// there is no fallback verb, and an id this gateway did not mint actuates
// nothing.
func ParseSlackAction(actionID string) (verb GateVerb, accessPointID string, ok bool) {
	i := strings.IndexByte(actionID, ':')
	if i < 0 {
		return verbUnset, "", false
	}
	cmd, arg := actionID[:i], actionID[i+1:]
	if arg == "" {
		return verbUnset, "", false
	}
	v, known := SlackActionVerb(cmd)
	if !known {
		return verbUnset, "", false
	}
	return v, arg, true
}

// ---------------------------------------------------------------------------
// Reply rendering
// ---------------------------------------------------------------------------

// SlackMenu is the help/greeting text — backend slackMenu.
//
// It names BOTH verbs. Slack has no way to reach a gate except the words in
// this message and the buttons they produce, so a menu that only says "open" is
// a menu on which close does not exist — and "close is never harder to reach
// than open" is a property of what a resident can find, not only of what the
// handler would accept. Same reasoning as DMTAPMenu, one rail over.
func SlackMenu(profileName string) string {
	hello := "Welcome to Aql."
	if profileName != "" {
		hello = "Hi " + profileName + "."
	}
	return hello + "\n\nI can help you open and close your linked gates.\nSend \"open\" or \"close\" to see available gates, or use the buttons below if provided."
}

// AccessBlocks renders the gate picker as Block Kit — backend accessBlocks.
//
// verb is REQUIRED, for the reason PushGateMenu's is: the action_id minted here
// is the only thing that survives to the tap, so the verb the resident asked
// for either rides on it or is gone. Adding the parameter broke every call site
// at compile time, which is the point; and the zero value renders CLOSE, so a
// future caller that forgets is visibly wrong rather than dangerous (verb.go).
//
// ONE button per gate, carrying one verb — not an Open/Close pair. The picker
// renders whichever verb was asked for, so the tap surface per message is
// exactly what it has always been. Two buttons per gate would double the block
// count against the SlackMaxBlocks ceiling (a section carries at most one
// accessory, so a pair needs a second block per gate) and would put a button
// that grants physical access immediately beside one that revokes it.
//
// Capped at PickerCapacity gate sections. Slack rejects a message over
// SlackMaxBlocks blocks outright, so the uncapped version did not degrade past
// a certain fleet size — the reply simply failed to send and the member got
// nothing back at all. When gates are dropped the picker says so
// (TruncationNotice) instead of quietly showing a short list, and a final
// defensive trim keeps the payload under the ceiling no matter what is added
// above it. Because the verb changes the label and the id but never the number
// of blocks, that accounting is identical for both verbs.
func AccessBlocks(verb GateVerb, profileName string, gates []store.AvailableAP, publicURL string) []Block {
	name := profileName
	if name == "" {
		name = "there"
	}
	prompt := "Hi *" + name + "*, which gate would you like to open?"
	if verb != VerbOpen {
		// Reached only from a close request: it says plainly that nothing has
		// moved yet, the same honesty rule PushGateMenu follows.
		prompt = "Hi *" + name + "*, I haven't closed anything. Which gate would you like to close?"
	}
	blocks := []Block{
		{
			"type": "section",
			"text": map[string]any{"type": "mrkdwn", "text": prompt},
		},
	}
	actCmd := verb.SlackActionCommand()
	label := verb.Title()
	shown := 0
	for _, g := range gates {
		if shown == PickerCapacity {
			break
		}
		shown++
		blocks = append(blocks, Block{
			"type": "section",
			"text": map[string]any{"type": "mrkdwn", "text": "*" + g.APName + "*\n" + g.LocName},
			"accessory": map[string]any{
				"type":      "button",
				"text":      map[string]any{"type": "plain_text", "text": label, "emoji": true},
				"value":     g.APID,
				"action_id": actCmd + ":" + g.APID,
			},
		})
	}
	if n := TruncationNotice(shown, len(gates), publicURL); n != "" {
		blocks = append(blocks, Block{
			"type":     "context",
			"elements": []any{map[string]any{"type": "mrkdwn", "text": n}},
		})
	}
	if len(blocks) > SlackMaxBlocks {
		blocks = blocks[:SlackMaxBlocks]
	}
	return blocks
}
