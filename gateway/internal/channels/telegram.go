package channels

// Telegram — the backend (src/routes/telegram.ts) is an honest stub: it links
// the chat, logs, flood-throttles and replies a bare "success"/"failed"
// without touching the rules pipeline. Here Telegram is a REAL open channel:
// a linked user's "open" runs the shared verdict → sign → dispatch choke
// point, and multiple gates render an inline-keyboard picker. This EXCEEDS the
// backend stub (noted in the README).

import (
	"encoding/json"
	"net/http"

	"github.com/vul-os/aql/gateway/internal/store"
)

// Telegram is the channel value.
type Telegram struct {
	WebhookSecret string
}

func (Telegram) Kind() string { return KindTelegram }

func (c Telegram) Verify(headers http.Header, body []byte, now int64) VerifyResult {
	return verifyTelegramSecret(c.WebhookSecret, headers)
}

// ---------------------------------------------------------------------------
// Bot API wire
// ---------------------------------------------------------------------------

type TGUpdate struct {
	UpdateID      int64            `json:"update_id"`
	Message       *TGMessage       `json:"message"`
	CallbackQuery *TGCallbackQuery `json:"callback_query"`
}

type TGMessage struct {
	MessageID int64   `json:"message_id"`
	From      *TGUser `json:"from"`
	Chat      TGChat  `json:"chat"`
	Date      int64   `json:"date"`
	Text      string  `json:"text"`
}

type TGUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
}

type TGChat struct {
	ID        int64  `json:"id"`
	Type      string `json:"type"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type TGCallbackQuery struct {
	ID      string     `json:"id"`
	From    TGUser     `json:"from"`
	Message *TGMessage `json:"message"`
	Data    string     `json:"data"`
}

// ParseTGUpdate decodes an inbound update.
func ParseTGUpdate(body []byte) (*TGUpdate, error) {
	var u TGUpdate
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// ---------------------------------------------------------------------------
// Reply rendering
// ---------------------------------------------------------------------------

// TelegramGatePicker renders the gate picker as an inline keyboard, one button
// per gate (callback data "open_ap:<id>"), capped at PickerCapacity rows —
// together with the message body that must accompany it.
//
// It returns the body rather than leaving it to the caller precisely because
// the cap lives here: an inline keyboard has nowhere to say "there are more",
// so the disclosure has to ride in the text, and a renderer that silently
// dropped rows while the caller wrote the text is how a truncated list ends up
// looking complete. The prompt param keeps the caller's wording.
func TelegramGatePicker(prompt string, gates []store.AvailableAP, publicURL string) (string, InlineKeyboard) {
	kb := InlineKeyboard{}
	for _, g := range gates {
		if len(kb.Rows) == PickerCapacity {
			break
		}
		kb.Rows = append(kb.Rows, []InlineButton{{
			Text:         "Open " + g.APName,
			CallbackData: "open_ap:" + g.APID,
		}})
	}
	return withTruncationNotice(prompt, len(kb.Rows), len(gates), publicURL), kb
}

// TelegramMenu is the help/greeting text.
func TelegramMenu(profileName string) string {
	hello := "Welcome to lintel."
	if profileName != "" {
		hello = "Hi " + profileName + "."
	}
	return hello + "\n\nSend \"open\" to open your linked gates."
}
