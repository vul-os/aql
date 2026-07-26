package channels

// Slack — two modes from one implementation. This file owns the Events API +
// interactions wire (verify, parse, block rendering); socketmode.go dials the
// zero-URL Socket Mode connection and feeds the SAME payloads back through the
// httpapi handler. Port of backend/src/routes/slack.ts (block_actions
// open_gate → verdict, hardened signature check).

import (
	"encoding/json"
	"net/http"

	"github.com/vul-os/aql/gateway/internal/store"
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
// Reply rendering
// ---------------------------------------------------------------------------

// SlackMenu is the help/greeting text — backend slackMenu.
func SlackMenu(profileName string) string {
	hello := "Welcome to Aql."
	if profileName != "" {
		hello = "Hi " + profileName + "."
	}
	return hello + "\n\nI can help you open your linked gates.\nSend \"open\" to see available gates, or use the buttons below if provided."
}

// AccessBlocks renders the gate picker as Block Kit — backend accessBlocks.
//
// Capped at PickerCapacity gate sections. Slack rejects a message over
// SlackMaxBlocks blocks outright, so the uncapped version did not degrade past
// a certain fleet size — the reply simply failed to send and the member got
// nothing back at all. When gates are dropped the picker says so
// (TruncationNotice) instead of quietly showing a short list, and a final
// defensive trim keeps the payload under the ceiling no matter what is added
// above it.
func AccessBlocks(profileName string, gates []store.AvailableAP, publicURL string) []Block {
	name := profileName
	if name == "" {
		name = "there"
	}
	blocks := []Block{
		{
			"type": "section",
			"text": map[string]any{"type": "mrkdwn", "text": "Hi *" + name + "*, which gate would you like to open?"},
		},
	}
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
				"text":      map[string]any{"type": "plain_text", "text": "Open", "emoji": true},
				"value":     g.APID,
				"action_id": "open_gate:" + g.APID,
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
