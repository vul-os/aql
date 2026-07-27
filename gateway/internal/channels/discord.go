package channels

// Discord — the wire, the ids and the reply rendering. discord_gateway.go
// dials the connection; discord_send.go sends. The httpapi handler
// (httpapi/channels_discord.go) drives the conversation through the SAME
// shared open path every other rail uses.
//
// WHY THIS RAIL FITS A HOUSE. Discord's inbound side is the Gateway: one
// held-open OUTBOUND WebSocket the bot dials to Discord, exactly the shape
// Slack Socket Mode (socketmode.go) and Telegram long-polling
// (telegram_polling.go) already have. No public URL, no port forward, no
// inbound reachability at all — which is the whole point on a hub that lives
// in a house behind CGNAT with no static IP. Component taps (button presses)
// arrive the same way, as INTERACTION_CREATE dispatches, as long as the
// application has no Interactions Endpoint URL configured in the developer
// portal; setting one would move them to a webhook and REQUIRE ingress. Leave
// it unset.
//
// BOT TOKEN ONLY. Authentication is `Authorization: Bot <token>` against the
// official API. A user token driving a self-bot is ToS-banned and is not a
// mode this rail has — the same structural rule the kotva §26 Discord adapter
// states (kotva-mail/src/adapters/discord.rs) and the same one send.go's
// WhatsApp engine block draws around unofficial clients.
//
// WHAT THIS RAIL CAN HONESTLY CLAIM ABOUT WHO IS SPEAKING. The origin of an
// inbound message is PLATFORM-ASSERTED and never cryptographically verifiable:
// all Discord tells us is "our API says this arrived from snowflake N". That
// is the same standing Slack and Telegram user ids already have here, and it
// is why the snowflake is only ever used as a LOOKUP KEY into
// channel_identities — an admin links it to a member deliberately — and never
// as a signature. TLS to discord.com plus the bot token are the entire trust
// root on the way in, exactly as telegram_polling.go spells out for getUpdates.

import (
	"encoding/json"
	"strings"

	"github.com/vul-os/aql/gateway/internal/store"
)

// KindDiscord is the identity space / source tag for this rail (the
// access_logs.source value and the channel_* tables' channel column). It sits
// here rather than beside the other Kind constants in channels.go so this rail
// is one self-contained set of files; the value is what matters, and nothing
// keys off where the constant is declared.
const KindDiscord = "discord"

// DiscordAPIVersion is the REST + Gateway API version this rail speaks.
// Pinned: Discord versions its API precisely so a client cannot be silently
// moved onto a different wire.
const DiscordAPIVersion = "10"

// DiscordAPIBase is the versioned REST base (overridable per sender/connection
// for tests — never for production credentials).
const DiscordAPIBase = "https://discord.com/api/v" + DiscordAPIVersion

// ---------------------------------------------------------------------------
// Discord's own limits — ASSUMED, sourced from Discord's documented ceilings
// ---------------------------------------------------------------------------
//
// Every number below is a documented Discord platform limit, not a preference,
// and each exists here for the SlackMaxBlocks reason: a payload over a
// provider's ceiling is not truncated by the provider, it is REJECTED — the
// whole reply fails to send and the member gets nothing back at all. They are
// named constants so a renderer never carries an inline literal.
//
// These were written from Discord's published API documentation, not verified
// against a live Gateway from this codebase (there is no network access here
// and no application to test against) — the same honesty note
// BridgeWhatsAppSender carries. If Discord moves a ceiling, these are the
// single place to change.
const (
	// DiscordMaxActionRows is how many top-level components (action rows) one
	// message may carry.
	DiscordMaxActionRows = 5
	// DiscordButtonsPerRow is how many buttons one action row may carry.
	DiscordButtonsPerRow = 5
	// DiscordMaxButtons is the hard ceiling on buttons in one message (25).
	// PickerCapacity (10) is well under it, so capacity is what binds the
	// picker — but the renderer holds this line too, so raising PickerCapacity
	// can never silently produce a message Discord rejects outright.
	DiscordMaxButtons = DiscordMaxActionRows * DiscordButtonsPerRow
	// DiscordMaxButtonLabel is the per-button label ceiling, in characters.
	DiscordMaxButtonLabel = 80
	// DiscordMaxCustomID is the per-component custom_id ceiling, in
	// characters. A gate whose "close_ap:<id>" id would exceed it is DROPPED
	// from the picker rather than sent malformed — and being dropped makes it
	// count against TruncationNotice, so the list still says it is incomplete.
	DiscordMaxCustomID = 100
	// DiscordMaxContent is the ceiling on a message's content field.
	DiscordMaxContent = 2000
)

// Component type + style ids from Discord's component schema.
const (
	discordComponentActionRow = 1
	discordComponentButton    = 2
	// discordButtonSecondary is the style BOTH verbs render in. Deliberate: a
	// green "Open" beside a grey "Close" would make the safety-reducing verb
	// the visually inviting one, which is the same asymmetry AccessBlocks
	// refuses when it keeps block counts identical between verbs. Same shape,
	// same prominence, different word.
	discordButtonSecondary = 2
)

// ---------------------------------------------------------------------------
// Gateway wire
// ---------------------------------------------------------------------------

// Gateway opcodes (the ones this rail acts on; anything else is ignored,
// forward-compatibly).
const (
	discordOpDispatch       = 0
	discordOpHeartbeat      = 1
	discordOpIdentify       = 2
	discordOpResume         = 6
	discordOpReconnect      = 7
	discordOpInvalidSession = 9
	discordOpHello          = 10
	discordOpHeartbeatACK   = 11
)

// The dispatch event names this rail consumes. Anything else Discord sends is
// dropped without parsing — a rail that opens gates has no business acting on
// events it did not ask for.
const (
	DiscordEventMessageCreate     = "MESSAGE_CREATE"
	DiscordEventInteractionCreate = "INTERACTION_CREATE"

	discordEventReady   = "READY"
	discordEventResumed = "RESUMED"
)

// DiscordInteractionMessageComponent is interaction type 3 — a component (our
// gate buttons) was used. This rail handles that type ONLY: slash commands,
// autocomplete and modals are other types and actuate nothing here.
const DiscordInteractionMessageComponent = 3

// discordCallbackDeferredUpdate is interaction callback type 6
// (DEFERRED_UPDATE_MESSAGE): acknowledge the tap, change nothing visible.
// Discord drops an interaction that is not acknowledged within ~3 seconds,
// which is shorter than an open may legitimately take (the device ack timeout
// is 5s), so the tap is ACKed first and the honest result follows as a normal
// message — the same two-step Telegram's AnswerCallback + reply already uses.
const discordCallbackDeferredUpdate = 6

// discordFrame is one Gateway frame: op code, event name, sequence, payload.
type discordFrame struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d"`
	S  *int64          `json:"s"`
	T  string          `json:"t"`
}

// DiscordUser is the subset of Discord's user object this rail reads. ID is
// the snowflake — the channel_identities.external_id value for KindDiscord,
// exactly as a Slack/Telegram user id is for theirs.
type DiscordUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Bot      bool   `json:"bot"`
}

// DiscordMessage is the MESSAGE_CREATE payload (subset).
type DiscordMessage struct {
	ID        string      `json:"id"`
	ChannelID string      `json:"channel_id"`
	GuildID   string      `json:"guild_id"`
	Content   string      `json:"content"`
	Timestamp string      `json:"timestamp"`
	Author    DiscordUser `json:"author"`
	// WebhookID is set when the message was posted by a webhook rather than a
	// user. Such a message has an author-shaped object that is not a user, so
	// it is refused (see FromHuman) rather than resolved as an identity.
	WebhookID string `json:"webhook_id"`
}

// FromHuman reports whether this message may be acted on at all: a real user
// (non-empty snowflake), not a bot, not a webhook post. Fail-closed shape
// check, the Discord twin of processTGUpdate's "neither a callback nor a
// non-bot message actuates anything".
func (m *DiscordMessage) FromHuman() bool {
	return m != nil && m.Author.ID != "" && !m.Author.Bot && m.WebhookID == ""
}

// DiscordInteraction is the INTERACTION_CREATE payload (subset).
//
// Token is a CREDENTIAL: it authorizes the callback that answers this
// interaction, so it is never logged and never put in an error string (see
// HTTPDiscordSender.AckComponent, which deliberately does not surface the
// request URL on failure because the token is in the path).
type DiscordInteraction struct {
	ID        string `json:"id"`
	Token     string `json:"token"`
	Type      int    `json:"type"`
	ChannelID string `json:"channel_id"`
	Data      struct {
		CustomID      string `json:"custom_id"`
		ComponentType int    `json:"component_type"`
	} `json:"data"`
	// Member is present in a guild, User in a DM. Exactly one carries the
	// tapper's identity; UserID reads whichever is there.
	Member *struct {
		User DiscordUser `json:"user"`
	} `json:"member"`
	User *DiscordUser `json:"user"`
}

// UserID is the snowflake of whoever tapped, from the guild or the DM shape.
// "" means the payload named nobody — no identity, no actuation.
func (i *DiscordInteraction) UserID() string {
	if i == nil {
		return ""
	}
	if i.Member != nil && i.Member.User.ID != "" {
		return i.Member.User.ID
	}
	if i.User != nil {
		return i.User.ID
	}
	return ""
}

// ParseDiscordMessage decodes a MESSAGE_CREATE dispatch payload.
func ParseDiscordMessage(data []byte) (*DiscordMessage, error) {
	var m DiscordMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// ParseDiscordInteraction decodes an INTERACTION_CREATE dispatch payload.
func ParseDiscordInteraction(data []byte) (*DiscordInteraction, error) {
	var i DiscordInteraction
	if err := json.Unmarshal(data, &i); err != nil {
		return nil, err
	}
	return &i, nil
}

// ---------------------------------------------------------------------------
// Reply rendering
// ---------------------------------------------------------------------------

// DiscordComponent is one Discord message component (opaque JSON, the same
// shape Block is for Slack).
type DiscordComponent = map[string]any

// discordLabel truncates a button label to Discord's ceiling, with the same
// ellipsis waTitle uses for WhatsApp's row titles.
func discordLabel(v string) string { return waTitle(v, DiscordMaxButtonLabel) }

// DiscordContent clamps a message body to Discord's content ceiling. Discord
// REJECTS an over-length message rather than trimming it, so an unclamped
// reply would simply not arrive. Exported because the sender applies it to
// everything going out, including text this package did not render.
func DiscordContent(s string) string {
	r := []rune(s)
	if len(r) <= DiscordMaxContent {
		return s
	}
	return strings.TrimRight(string(r[:DiscordMaxContent-1]), " ") + "…"
}

// DiscordGatePicker renders the gate picker as rows of buttons, one button per
// gate, together with the message body that must accompany it.
//
// It returns the body for the reason TelegramGatePicker does: the cap lives
// here, a button grid has nowhere to say "there are more", so the disclosure
// has to ride in the text — and a renderer that silently dropped rows while
// the caller wrote the text is exactly how a truncated list ends up looking
// complete.
//
// verb is REQUIRED and fails closed like every other renderer's (verb.go): the
// custom_id is all that survives the tap, so the verb rides on it or it is
// lost, and a caller that forgets gets buttons that CLOSE rather than ones
// that open.
//
// The ids come from the SHARED selection scheme (SelOpenAP / SelCloseAP,
// whatsapp.go) that WhatsApp and Telegram already mint and ParseSelection
// already validates — deliberately NOT a fourth id scheme. Slack has its own
// only because its buttons predate the shared one and are echoed back verbatim
// from workspace histories; a new rail has no such history to honour, and
// every parallel scheme is another allowlist that can drift out of step with
// SelectionCommandVerb.
//
// ONE button per gate in the verb that was asked for — not an Open/Close pair,
// for the reason both fb01edc rails give: pairing them puts the button that
// grants physical access immediately beside the one that revokes it.
func DiscordGatePicker(verb GateVerb, prompt string, gates []store.AvailableAP, publicURL string) (string, []DiscordComponent) {
	selCmd := verb.SelectionCommand()
	label := verb.Title()
	buttons := make([]DiscordComponent, 0, PickerCapacity)
	for _, g := range gates {
		if len(buttons) >= PickerCapacity || len(buttons) >= DiscordMaxButtons {
			break
		}
		customID := selCmd + ":" + g.APID
		if len(customID) > DiscordMaxCustomID {
			// Cannot be rendered honestly, so it is not rendered at all — and
			// because `shown` counts what was actually built, TruncationNotice
			// reports the list as incomplete rather than hiding the gap.
			continue
		}
		buttons = append(buttons, DiscordComponent{
			"type":      discordComponentButton,
			"style":     discordButtonSecondary,
			"label":     discordLabel(label + " " + g.APName),
			"custom_id": customID,
		})
	}
	rows := make([]DiscordComponent, 0, DiscordMaxActionRows)
	for i := 0; i < len(buttons) && len(rows) < DiscordMaxActionRows; i += DiscordButtonsPerRow {
		end := i + DiscordButtonsPerRow
		if end > len(buttons) {
			end = len(buttons)
		}
		rows = append(rows, DiscordComponent{
			"type":       discordComponentActionRow,
			"components": buttons[i:end],
		})
	}
	return withTruncationNotice(prompt, len(buttons), len(gates), publicURL), rows
}

// DiscordMenu is the help/greeting text.
//
// It names BOTH verbs, for the reason SlackMenu, TelegramMenu and DMTAPMenu
// do: on a rail whose entire interface is a message, a menu that only says
// "open" is a menu on which close does not exist — and "close is never harder
// to reach than open" is a property of what a resident can FIND, not only of
// what the handler would accept.
func DiscordMenu(profileName string) string {
	hello := "Welcome to Aql."
	if profileName != "" {
		hello = "Hi " + profileName + "."
	}
	return hello + "\n\nSend \"open\" or \"close\" for your linked gates."
}
