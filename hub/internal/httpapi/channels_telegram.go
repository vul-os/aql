package httpapi

// Telegram webhook — fail-closed secret-token check, inbound dedupe, and (this
// EXCEEDS the backend stub, which only logged + replied "success"/"failed") a
// REAL open channel: a linked user's "open" runs the shared verdict → sign →
// dispatch choke point, with an inline-keyboard picker when several gates are
// available. Callback taps re-enter the same open path.

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
)

var tgHelpWords = map[string]bool{
	"hi": true, "hello": true, "help": true, "menu": true, "start": true, "/start": true,
}

// POST /webhooks/telegram
func (s *Server) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	raw, ok := s.readWebhookBody(w, r)
	if !ok {
		return
	}
	if v := s.tg.Verify(r.Header, raw, time.Now().Unix()); !v.OK {
		writeErr(w, http.StatusForbidden, v.Reason)
		return
	}
	update, err := channels.ParseTGUpdate(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json")
		return
	}
	s.processTGUpdate(r.Context(), update)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// processTGUpdate is THE Telegram dispatch — the one place an update becomes an
// intent, whichever transport carried it. The webhook route calls it after its
// secret-token check; the long-polling loop
// (channels.TelegramPoller.Handle, see channels_telegram_polling.go) calls it
// with what getUpdates returned. Everything that decides anything — identity
// resolution, the inbound dedupe, the verb/picker logic and the fail-closed
// GateVerb machinery — hangs below this function precisely so there is exactly
// one copy of it. A transport that grew its own copy of the open path is how
// the two drift and how one of them ends up missing a safety fix.
//
// Fail-closed on shape: an update that is neither a callback nor a non-bot
// message actuates nothing. There is no "otherwise" branch and no inference.
func (s *Server) processTGUpdate(ctx contextT, update *channels.TGUpdate) {
	if update == nil {
		return
	}
	switch {
	case update.CallbackQuery != nil:
		s.processTGCallback(ctx, update.CallbackQuery)
	case update.Message != nil && update.Message.From != nil && !update.Message.From.IsBot:
		s.processTGMessage(ctx, update.Message)
	}
}

func (s *Server) processTGMessage(ctx contextT, msg *channels.TGMessage) {
	externalKey := strconv.FormatInt(msg.Chat.ID, 10)
	userKey := strconv.FormatInt(msg.From.ID, 10)
	profileID, _ := s.store.ResolveChannelIdentity(ctx, channels.KindTelegram, userKey)
	displayName, _ := s.store.ChannelIdentityDisplayName(ctx, channels.KindTelegram, userKey)

	meta := map[string]any{"username": msg.Chat.Username, "first_name": msg.Chat.FirstName, "last_name": msg.Chat.LastName}
	chatID, err := s.store.UpsertChannelChat(ctx, channels.KindTelegram, externalKey, profileID, "", meta)
	if err != nil {
		s.log.Error("tg upsert chat", "err", err)
		return
	}
	kind := "text"
	if msg.Text == "" {
		kind = "system"
	}
	isNew, err := s.store.InsertInboundMessage(ctx, chatID, channels.KindTelegram, kind, msg, strconv.FormatInt(msg.MessageID, 10), msg.Date)
	if err != nil || !isNew {
		return
	}
	if s.store.NoteChatMessage(ctx, s.cfg.RateLimits, "tg:"+externalKey, time.Now().Unix()) {
		return // quiet
	}
	if msg.Text == "" {
		return
	}
	txt := channels.NormalizeText(msg.Text)

	// Link codes first, before the membership branch below: someone linking
	// has no identity row yet, so that branch would answer them instead and
	// the ceremony could never complete. See channellink.go.
	if reply, handled := s.tryChannelLink(ctx, channels.KindTelegram, userKey, txt); handled {
		s.tgSendText(ctx, msg.Chat.ID, chatID, reply)
		return
	}

	if profileID == "" {
		s.tgSendText(ctx, msg.Chat.ID, chatID, strings.Join([]string{
			"This Telegram account isn't linked to an Aql member yet.",
			"In the Aql console, open Settings and generate a Telegram link code,",
			"then send it here. It looks like LINK-XXXX-XXXX-XXXX and lasts 10 minutes.",
		}, "\n"))
		return
	}

	switch {
	// "close" is a first-class command word here, exactly as "open" is. It was
	// not, and the whole verb only existed on Telegram as something the handler
	// would have refused anyway: the text matcher accepted neither the word nor
	// a callback carrying it, so a resident who could open a gate from Telegram
	// could not close it from Telegram. That is "close is never harder to reach
	// than open" violated in the one direction that matters.
	//
	// The verb is decided ONCE, here, from an exact word — never inferred later
	// and never defaulted. "gates" keeps its existing open semantics byte for
	// byte (a listing word acting as a verb is a real, separately recorded
	// defect on this rail; widening close is not the change that should quietly
	// alter what "gates" does).
	case txt == "open" || txt == "gates" || txt == "close":
		verb := channels.VerbOpen
		if txt == "close" {
			verb = channels.VerbClose
		}
		gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID)
		if err != nil {
			s.log.Error("tg available", "err", err)
			return
		}
		switch len(gates) {
		case 0:
			s.tgSendText(ctx, msg.Chat.ID, chatID, "You don't have any active gate access. Please contact the administrator.")
		case 1:
			s.tgAccessCommand(ctx, msg.Chat.ID, chatID, profileID, gates[0].APID, gates[0].APName, verb.Command())
		default:
			prompt := "Which gate would you like to open?"
			if verb != channels.VerbOpen {
				prompt = verb.NothingMovedYet() + " Which gate would you like to " + verb.Infinitive() + "?"
			}
			body, kb := channels.TelegramGatePicker(verb, prompt, gates, s.channelPublicURL())
			s.tgSendKeyboard(ctx, msg.Chat.ID, chatID, body, kb)
		}
	case tgHelpWords[txt]:
		s.tgSendText(ctx, msg.Chat.ID, chatID, channels.TelegramMenu(displayName))
	default:
		// A verb chat cannot serve is answered, not redirected to a gate menu
		// (channels/unsupported.go).
		if v, ok := channels.UnsupportedVerb(txt); ok {
			s.tgSendText(ctx, msg.Chat.ID, chatID, channels.UnsupportedVerbReply(v, s.channelPublicURL()))
			return
		}
		s.tgSendText(ctx, msg.Chat.ID, chatID, channels.TelegramMenu(displayName))
	}
}

func (s *Server) processTGCallback(ctx contextT, cq *channels.TGCallbackQuery) {
	// Always dismiss the button spinner, even on a no-op.
	s.tgSend.AnswerCallback(ctx, cq.ID)
	cmd, apID, ok := channels.ParseSelection(cq.Data)
	if !ok {
		return // unrecognised callback data actuates nothing
	}
	// The verb comes from the allowlist, never from the id's text, and there is
	// no fallback: SelectionCommandVerb answers only for open_ap/close_ap, so a
	// narrowing id (select_loc:, minted by another rail) and anything else this
	// gateway did not write actuate nothing. Previously this compared against
	// SelOpenAP alone, which is why a close button rendered here would have been
	// a dead button — and why no close button was rendered here at all.
	command, ok := channels.SelectionCommandVerb(cmd)
	if !ok {
		return
	}
	userKey := strconv.FormatInt(cq.From.ID, 10)
	profileID, err := s.store.ResolveChannelIdentity(ctx, channels.KindTelegram, userKey)
	if err != nil {
		return // unlinked: no actuation
	}
	var chatNum int64
	if cq.Message != nil {
		chatNum = cq.Message.Chat.ID
	} else {
		chatNum = cq.From.ID
	}
	chatID, _ := s.store.UpsertChannelChat(ctx, channels.KindTelegram, strconv.FormatInt(chatNum, 10), profileID, "", nil)

	gateName := ""
	if gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID); err == nil {
		for _, g := range gates {
			if g.APID == apID {
				gateName = g.APName
			}
		}
	}
	s.tgAccessCommand(ctx, chatNum, chatID, profileID, apID, gateName, command)
}

// tgAccessCommand runs one open/close through the shared choke point and
// replies — same shape as waAccessCommand/dmtapAccessCommand. command is the
// open-path vocabulary ("open"/"close") and reaches store.LogAccess unchanged;
// nothing here re-derives it, and nothing here touches the limit handling that
// deliberately exempts close.
func (s *Server) tgAccessCommand(ctx contextT, chatNum int64, chatID, profileID, apID, gateName, command string) {
	had, v, err := s.profileOpen(ctx, profileID, apID, command, channels.KindTelegram)
	if err != nil {
		s.log.Error("tg open", "err", err)
		return
	}
	if !had {
		s.tgSendText(ctx, chatNum, chatID, "Sorry, you no longer have access to this gate.")
		return
	}
	if !v.Allowed {
		s.tgSendText(ctx, chatNum, chatID, channels.DenialMessage(v.Reason, v.RetryAfterS, s.channelPublicURL()))
		return
	}
	if gateName == "" {
		gateName = "the gate"
	}
	word := channels.ActingWord(command)
	s.tgSendText(ctx, chatNum, chatID, word+" "+gateName+"...")
}

func (s *Server) tgSendText(ctx contextT, chatNum int64, chatID, body string) {
	sent := s.tgSend.SendText(ctx, chatNum, body)
	s.tgLog(ctx, chatID, "text", map[string]any{"text": body}, sent)
}

func (s *Server) tgSendKeyboard(ctx contextT, chatNum int64, chatID, body string, kb channels.InlineKeyboard) {
	sent := s.tgSend.SendInlineKeyboard(ctx, chatNum, body, kb)
	s.tgLog(ctx, chatID, "interactive", map[string]any{"text": body}, sent)
}

func (s *Server) tgLog(ctx contextT, chatID, kind string, body any, sent channels.SendResult) {
	status := "sent"
	if !sent.OK {
		status = "failed:" + sent.Error
	}
	if err := s.store.InsertOutboundMessage(ctx, chatID, channels.KindTelegram, kind, body, sent.ProviderMessageID, status); err != nil {
		s.log.Error("tg log outbound", "err", err)
	}
}
