package httpapi

// DMTAP — the httpapi side of the dial-out DialChannel scaffold
// (gateway/internal/channels/dmtap.go owns the honest "what is real" note;
// read that file first). handleDMTAPIntent is wired as the DMTAP.Handle
// callback exactly the way handleSlackSocketEnvelope is wired as
// SocketMode.Handle (server.go): whatever the transport delivers is run
// through the SAME store.LogAccess choke point + hub dispatch every other
// channel uses (channels_open.go's profileOpen) — this file adds no new
// authorization logic, only DMTAP-shaped conversation flow (a linked member's
// "open" opens a gate; unlinked or unknown intents get an honest reply, never
// an actuation).

import (
	"strings"
	"time"

	"github.com/vul-os/aql/gateway/internal/channels"
)

var dmtapHelpWords = map[string]bool{
	"hi": true, "hello": true, "help": true, "menu": true, "start": true,
}

// handleDMTAPIntent processes one inbound DMTAP intent (channels.DMTAP.Handle).
func (s *Server) handleDMTAPIntent(ctx contextT, intent channels.DMTAPIntent) {
	profileID, _ := s.store.ResolveChannelIdentity(ctx, channels.KindDMTAP, intent.MemberKeyName) // "" if unlinked
	displayName, _ := s.store.ChannelIdentityDisplayName(ctx, channels.KindDMTAP, intent.MemberKeyName)

	chatID, err := s.store.UpsertChannelChat(ctx, channels.KindDMTAP, intent.GroupID, profileID, "", nil)
	if err != nil {
		s.log.Error("dmtap upsert chat", "err", err)
		return
	}
	kind := "text"
	if intent.Body == "" {
		kind = "system"
	}
	if intent.IntentID != "" {
		// Dedupe on the transport's own id, exactly like WhatsApp's message id /
		// Telegram's message_id — a redelivered intent must not double-open.
		isNew, err := s.store.InsertInboundMessage(ctx, chatID, channels.KindDMTAP, kind, intent, intent.IntentID, intent.TimestampMs/1000)
		if err != nil {
			s.log.Error("dmtap log inbound", "err", err)
			return
		}
		if !isNew {
			return
		}
	}
	if intent.Body == "" {
		return
	}
	if s.store.NoteChatMessage(ctx, s.cfg.RateLimits, "dmtap:"+intent.MemberKeyName, time.Now().Unix()) {
		return // flood throttle: quiet, same contract as every other channel
	}

	if profileID == "" {
		s.dmtapReply(ctx, chatID, intent.GroupID, strings.Join([]string{
			"This DMTAP identity isn't linked to an Aql member yet.",
			"Ask your admin to add key-name " + intent.MemberKeyName + " in the dashboard, then send \"menu\".",
		}, "\n"))
		return
	}

	txt := channels.NormalizeText(intent.Body)
	switch {
	case txt == "open" || txt == "close" || txt == "gates":
		verb := channels.VerbOpen
		if txt == "close" {
			verb = channels.VerbClose
		}
		gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID)
		if err != nil {
			s.log.Error("dmtap available", "err", err)
			return
		}
		switch len(gates) {
		case 0:
			s.dmtapReply(ctx, chatID, intent.GroupID, "You don't have any active gate access. Please contact the administrator.")
		case 1:
			s.dmtapAccessCommand(ctx, chatID, intent.GroupID, profileID, gates[0].APID, gates[0].APName, verb.Command())
		default:
			// The follow-up question carries the verb, because on a text-only
			// rail the answer is parsed on its own: a prompt that invited a bare
			// gate name turned "close" into an open one message later.
			s.dmtapReply(ctx, chatID, intent.GroupID, channels.DMTAPGatePrompt(verb, gates, s.channelPublicURL()))
		}
	case dmtapHelpWords[txt]:
		s.dmtapReply(ctx, chatID, intent.GroupID, channels.DMTAPMenu(displayName))
	default:
		// Free text. The verb is read FIRST and is required: a body that names a
		// gate and no action ("side door", the natural answer to an old-style
		// "reply with its name" prompt) used to resolve to the default verb,
		// which was open. There is no default verb — docs/CHAT-COMMANDS.md §3.5
		// — so a verbless body is a question, answered with the menu. WhatsApp
		// already worked this way (it needs "open"/"close" in the body to reach
		// its actuation branch at all); this makes DMTAP match.
		verb, hasVerb := channels.TextGateVerb(txt)
		if !hasVerb {
			s.dmtapReply(ctx, chatID, intent.GroupID, channels.DMTAPMenu(displayName))
			return
		}
		// Try to resolve a mentioned gate name (mirrors WhatsApp's
		// FindMentionedGate), else fall back to the menu. A body naming more
		// than one gate resolves to none of them: it asks, listing only the
		// gates that matched, and asks in the verb the member used.
		gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID)
		if err == nil {
			m := channels.FindMentionedGate(txt, gates)
			switch {
			case m.Unique():
				s.dmtapAccessCommand(ctx, chatID, intent.GroupID, profileID, m.AP.APID, m.AP.APName, verb.Command())
				return
			case m.Ambiguous():
				s.dmtapReply(ctx, chatID, intent.GroupID,
					channels.DMTAPAmbiguousPrompt(verb, m.Candidates, s.channelPublicURL()))
				return
			}
		}
		s.dmtapReply(ctx, chatID, intent.GroupID, channels.DMTAPMenu(displayName))
	}
}

// dmtapAccessCommand runs one open/close through the shared choke point and
// renders the honest result — same shape as tgAccessCommand/waAccessCommand.
func (s *Server) dmtapAccessCommand(ctx contextT, chatID, groupID, profileID, apID, gateName, command string) {
	had, v, err := s.profileOpen(ctx, profileID, apID, command, channels.KindDMTAP)
	if err != nil {
		s.log.Error("dmtap open", "err", err)
		return
	}
	if !had {
		s.dmtapReply(ctx, chatID, groupID, "Sorry, you no longer have access to this gate.")
		return
	}
	if !v.Allowed {
		s.dmtapReply(ctx, chatID, groupID, channels.DenialMessage(v.Reason, v.RetryAfterS, s.channelPublicURL()))
		return
	}
	verb := "Opening"
	if command == "close" {
		verb = "Closing"
	}
	s.dmtapReply(ctx, chatID, groupID, verb+" "+gateName+"...")
}

// dmtapReply sends a plaintext reply via the transport and logs the outbound
// row. With no transport configured (s.dmtap == nil, or DMTAP disabled) this
// still logs a failed:dmtap_transport_unset row rather than silently dropping
// the reply — an operator can see the channel tried and could not speak.
func (s *Server) dmtapReply(ctx contextT, chatID, groupID, text string) {
	var sent channels.SendResult
	if s.dmtap != nil && s.dmtap.Transport != nil {
		sent = s.dmtap.Transport.Reply(ctx, groupID, channels.DMTAPReply{Text: text})
	} else {
		sent = channels.SendResult{Error: "dmtap_transport_unset"}
	}
	status := "sent"
	if !sent.OK {
		status = "failed:" + sent.Error
	}
	if err := s.store.InsertOutboundMessage(ctx, chatID, channels.KindDMTAP, "text", map[string]any{"text": text}, sent.ProviderMessageID, status); err != nil {
		s.log.Error("dmtap log outbound", "err", err)
	}
}
