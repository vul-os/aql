package httpapi

// Slack — Events API webhook (+ interactions) AND Socket Mode share this one
// code path: handleSlackSocketEnvelope feeds Socket Mode frames into the same
// processSlackEvent / processSlackInteraction the webhooks use. Port of
// the Workers backend's slack.ts (hardened signature check, block_actions
// open_gate → verdict), with the open running through the shared choke point.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
)

var slackHelpWords = map[string]bool{
	"hi": true, "hello": true, "hey": true, "help": true, "menu": true, "start": true,
}

// POST /webhooks/slack — Events API.
func (s *Server) handleSlackEvents(w http.ResponseWriter, r *http.Request) {
	raw, ok := s.readWebhookBody(w, r)
	if !ok {
		return
	}
	if v := s.slack.Verify(r.Header, raw, time.Now().Unix()); !v.OK {
		writeErr(w, http.StatusForbidden, v.Reason)
		return
	}
	env, err := channels.ParseSlackEnvelope(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json")
		return
	}
	if env.Type == "url_verification" {
		writeJSON(w, http.StatusOK, map[string]any{"challenge": env.Challenge})
		return
	}
	if env.Type == "event_callback" && env.Event != nil {
		s.processSlackEvent(r.Context(), env.TeamID, env.Event)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// POST /webhooks/slack/interactions — button clicks (block_actions).
func (s *Server) handleSlackInteractions(w http.ResponseWriter, r *http.Request) {
	raw, ok := s.readWebhookBody(w, r)
	if !ok {
		return
	}
	// Authenticate BEFORE parsing anything attacker-controlled.
	if v := s.slack.Verify(r.Header, raw, time.Now().Unix()); !v.OK {
		writeErr(w, http.StatusForbidden, v.Reason)
		return
	}
	values, err := url.ParseQuery(string(raw))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json")
		return
	}
	payloadStr := values.Get("payload")
	if payloadStr == "" {
		writeErr(w, http.StatusBadRequest, "missing_payload")
		return
	}
	var inter channels.SlackInteraction
	if err := json.Unmarshal([]byte(payloadStr), &inter); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json")
		return
	}
	s.processSlackInteraction(r.Context(), &inter)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleSlackSocketEnvelope is the Socket Mode entry point (channels.SocketMode
// Handle): the SAME processing as the webhooks, so a LAN-only gateway with no
// public URL runs Slack fully over the outbound WebSocket.
func (s *Server) handleSlackSocketEnvelope(ctx contextT, envType string, payload json.RawMessage) {
	switch envType {
	case "events_api":
		env, err := channels.ParseSlackEnvelope(payload)
		if err != nil {
			return
		}
		if env.Type == "event_callback" && env.Event != nil {
			s.processSlackEvent(ctx, env.TeamID, env.Event)
		}
	case "interactive":
		var inter channels.SlackInteraction
		if err := json.Unmarshal(payload, &inter); err != nil {
			return
		}
		s.processSlackInteraction(ctx, &inter)
	}
}

func (s *Server) processSlackEvent(ctx contextT, teamID string, ev *channels.SlackEvent) {
	if ev.BotID != "" || (ev.Type != "message" && ev.Type != "app_mention") {
		return
	}
	channelID := ev.Channel
	profileID, _ := s.store.ResolveChannelIdentity(ctx, channels.KindSlack, ev.User) // "" if unlinked
	displayName, _ := s.store.ChannelIdentityDisplayName(ctx, channels.KindSlack, ev.User)

	meta := map[string]any{"team_id": teamID}
	chatID, err := s.store.UpsertChannelChat(ctx, channels.KindSlack, channelID, profileID, "", meta)
	if err != nil {
		s.log.Error("slack upsert chat", "err", err)
		return
	}
	kind := "text"
	if ev.Text == "" {
		kind = "system"
	}
	isNew, err := s.store.InsertInboundMessage(ctx, chatID, channels.KindSlack, kind, ev, ev.TS, parseSlackTS(ev.TS))
	if err != nil || !isNew {
		return
	}
	if s.store.NoteChatMessage(ctx, s.cfg.RateLimits, "slack:"+ev.User, time.Now().Unix()) {
		return // quiet
	}

	txt := channels.NormalizeSlackText(ev.Text)
	if txt == "" {
		return
	}
	// Link codes first, before the membership branch: someone linking has no
	// identity row yet, so that branch would answer them instead and the
	// ceremony could never complete. See channellink.go.
	if reply, handled := s.tryChannelLink(ctx, channels.KindSlack, ev.User, txt); handled {
		s.slackReply(ctx, chatID, channelID, reply, nil)
		return
	}

	switch {
	case slackHelpWords[txt]:
		s.slackReply(ctx, chatID, channelID, channels.SlackMenu(displayName), nil)
	case profileID == "":
		s.slackReply(ctx, chatID, channelID, strings.Join([]string{
			"I don't know which Aql profile this Slack user belongs to yet.",
			"In the Aql console, open Settings and generate a Slack link code,",
			"then send it here. It looks like LINK-XXXX-XXXX-XXXX and lasts 10 minutes.",
		}, "\n"), nil)
	// "close" is a first-class command word here, exactly as "open" is. Until
	// now AccessBlocks only ever minted open_gate: buttons and this switch only
	// ever recognised "open", so a resident who could open a gate from Slack had
	// no way to close one from Slack — "close is never harder to reach than
	// open" violated in the one direction that matters. The verb is decided
	// ONCE, here, from an exact word, and threaded into the renderer; "gates"
	// keeps its existing open semantics byte for byte.
	case txt == "open" || txt == "gates" || txt == "close":
		verb := channels.VerbOpen
		if txt == "close" {
			verb = channels.VerbClose
		}
		gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID)
		if err != nil {
			s.log.Error("slack available", "err", err)
			return
		}
		if len(gates) == 0 {
			s.slackReply(ctx, chatID, channelID, "You don't have any active gate access. Please contact the administrator.", nil)
			return
		}
		notify := "Select a gate to " + verb.Infinitive()
		s.slackReply(ctx, chatID, channelID, notify, channels.AccessBlocks(verb, displayName, gates, s.channelPublicURL()))
	default:
		// A question about a gate is ANSWERED (docs/CHAT-COMMANDS.md §4), before
		// the unsupported-verb check and before the menu.
		if reply := s.answerProfileGateQuestion(ctx, txt, profileID, channels.KindSlack); reply != "" {
			s.slackReply(ctx, chatID, channelID, reply, nil)
			return
		}
		// A verb chat cannot serve is answered, not redirected to a gate menu
		// (channels/unsupported.go).
		if v, ok := channels.UnsupportedVerb(txt); ok {
			s.slackReply(ctx, chatID, channelID, s.chatEngineVerbReply(ctx, txt, profileID, channels.KindSlack, chatID, v), nil)
			return
		}
		s.slackReply(ctx, chatID, channelID, channels.SlackMenu(displayName), nil)
	}
}

func (s *Server) processSlackInteraction(ctx contextT, inter *channels.SlackInteraction) {
	if inter.Type != "block_actions" || len(inter.Actions) == 0 {
		return
	}
	act := inter.Actions[0]
	// The verb and the target both come out of the action_id through the
	// allowlist (channels.ParseSlackAction) — never from a prefix test and never
	// from a default. An id outside {open_gate:, close_gate:}, including an id
	// in another rail's scheme, actuates nothing. open_gate: keeps its exact
	// wire value, so every button Slack has already delivered still resolves and
	// still opens, which is what it was rendered to mean.
	verb, apID, ok := channels.ParseSlackAction(act.ActionID)
	if !ok {
		return
	}
	// A gate button carries its access point twice — in the action_id and in
	// value — and both halves are minted here and echoed back verbatim inside
	// Slack's signed payload, so they always agree. A payload where they
	// disagree is not one this gateway wrote: refuse rather than pick one.
	if act.Value != "" && act.Value != apID {
		return
	}
	channelID := inter.Channel.ID
	profileID, err := s.store.ResolveChannelIdentity(ctx, channels.KindSlack, inter.User.ID)
	if err != nil {
		return // unlinked user: no actuation
	}
	chatID, _ := s.store.UpsertChannelChat(ctx, channels.KindSlack, channelID, profileID, "", nil)
	had, v, err := s.profileOpen(ctx, profileID, apID, verb.Command(), channels.KindSlack)
	if err != nil {
		s.log.Error("slack open", "err", err)
		return
	}
	if !had {
		s.slackReply(ctx, chatID, channelID, "❌ Sorry, you no longer have access to this gate.", nil)
		return
	}
	if !v.Allowed {
		s.slackReply(ctx, chatID, channelID, channels.DenialMessage(v.Reason, v.RetryAfterS, s.channelPublicURL()), nil)
		return
	}
	// From the verb's own command string, not a second guess at it: this
	// branch previously read "anything that is not open is a close", which
	// answered a hold with "Closing".
	word := channels.ActingWord(verb.Command())
	s.slackReply(ctx, chatID, channelID, "✅ "+word+" gate...", nil)
}

// slackReply sends a text or blocks reply and logs the outbound row.
func (s *Server) slackReply(ctx contextT, chatID, channelID, text string, blocks []channels.Block) {
	var sent channels.SendResult
	var kind string
	var body any
	if blocks != nil {
		sent = s.slackSend.SendBlocks(ctx, channelID, text, blocks)
		kind, body = "interactive", map[string]any{"blocks": blocks}
	} else {
		sent = s.slackSend.SendText(ctx, channelID, text)
		kind, body = "text", map[string]any{"text": text}
	}
	status := "sent"
	if !sent.OK {
		status = "failed:" + sent.Error
	}
	if err := s.store.InsertOutboundMessage(ctx, chatID, channels.KindSlack, kind, body, sent.ProviderMessageID, status); err != nil {
		s.log.Error("slack log outbound", "err", err)
	}
}

// parseSlackTS turns Slack's "1623456789.000200" ts into a unix second.
func parseSlackTS(ts string) int64 {
	if f, err := strconv.ParseFloat(ts, 64); err == nil {
		return int64(f)
	}
	return 0
}
