package httpapi

// Discord — the httpapi half of the dial-out rail
// (hub/internal/channels/discord.go carries the rail's own notes; read it
// first). handleDiscordEvent is wired as channels.Discord.Handle exactly the
// way handleSlackSocketEnvelope is wired as SocketMode.Handle and
// processTGUpdate is wired as TelegramPoller.Handle: whatever the Gateway
// delivers runs through the SAME store.LogAccess choke point + hub dispatch
// every other rail uses (channels_open.go's profileOpen).
//
// This file adds NO authorization logic and NO second copy of the machinery
// that keeps the rails honest. Identity resolution is
// store.ResolveChannelIdentity on (channel, external_id) — the same key Slack
// and Telegram use, so one person on two rails is one member. The verb comes
// from channels.GateVerb / SelectionCommandVerb (verb.go) and never from a
// default. Ambiguity is not a thing this rail resolves. The only Discord-
// specific parts here are conversation shape and reply plumbing.

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
)

var discordHelpWords = map[string]bool{
	"hi": true, "hello": true, "hey": true, "help": true, "menu": true, "start": true,
}

// wireDiscord builds the Discord rail when a bot token is configured. Called
// once from New (the single registration line in server.go); a rail with no
// token is never constructed and never launched — fail-closed, exactly like
// Socket Mode's app token and DMTAP's transport.
func (s *Server) wireDiscord() {
	token := s.cfg.Channels.DiscordBotToken
	if token == "" {
		return
	}
	s.attachDiscord(
		&channels.HTTPDiscordSender{BotToken: token},
		&channels.Discord{BotToken: token, Logger: s.log},
	)
}

// attachDiscord binds a sender and a connection into one rail and registers it
// with StartChannels.
//
// The sender is captured in the Handle closure rather than stored on Server:
// nothing else in the server needs to speak Discord, and a rail that owns its
// own outbound path cannot be half-wired (a connection with no sender would
// answer nothing). Tests call this directly with a recording fake.
func (s *Server) attachDiscord(send channels.DiscordSender, d *channels.Discord) *channels.Discord {
	d.Handle = func(ctx contextT, eventType string, data json.RawMessage) {
		s.handleDiscordEvent(ctx, send, eventType, data)
	}
	s.dial = append(s.dial, d)
	return d
}

// handleDiscordEvent is THE Discord dispatch — the one place a Gateway event
// becomes an intent. Fail-closed on shape: an event this rail did not ask for,
// or a payload that does not decode, actuates nothing and answers nothing.
// There is no "otherwise" branch and no inference.
func (s *Server) handleDiscordEvent(ctx contextT, send channels.DiscordSender, eventType string, data json.RawMessage) {
	switch eventType {
	case channels.DiscordEventMessageCreate:
		msg, err := channels.ParseDiscordMessage(data)
		if err != nil || !msg.FromHuman() || msg.ChannelID == "" {
			return
		}
		s.processDiscordMessage(ctx, send, msg)
	case channels.DiscordEventInteractionCreate:
		inter, err := channels.ParseDiscordInteraction(data)
		if err != nil {
			return
		}
		s.processDiscordInteraction(ctx, send, inter)
	}
}

func (s *Server) processDiscordMessage(ctx contextT, send channels.DiscordSender, msg *channels.DiscordMessage) {
	userKey := msg.Author.ID
	profileID, _ := s.store.ResolveChannelIdentity(ctx, channels.KindDiscord, userKey) // "" if unlinked
	displayName, _ := s.store.ChannelIdentityDisplayName(ctx, channels.KindDiscord, userKey)

	meta := map[string]any{"username": msg.Author.Username, "guild_id": msg.GuildID}
	chatID, err := s.store.UpsertChannelChat(ctx, channels.KindDiscord, msg.ChannelID, profileID, "", meta)
	if err != nil {
		s.log.Error("discord upsert chat", "err", err)
		return
	}
	kind := "text"
	if msg.Content == "" {
		kind = "system"
	}
	// Dedupe on Discord's message id, exactly like WhatsApp's message id and
	// Telegram's message_id: a redelivered dispatch (every RESUME replays what
	// we missed, and may replay what we already handled) must not double-open.
	isNew, err := s.store.InsertInboundMessage(ctx, chatID, channels.KindDiscord, kind, msg, msg.ID, discordMessageTS(msg))
	if err != nil || !isNew {
		return
	}
	if s.store.NoteChatMessage(ctx, s.cfg.RateLimits, "discord:"+userKey, time.Now().Unix()) {
		return // flood throttle: quiet, same contract as every other rail
	}
	if msg.Content == "" {
		// No MESSAGE CONTENT intent, or genuinely empty (an attachment-only
		// post). Either way there is no command here to read.
		return
	}
	txt := channels.NormalizeText(msg.Content)

	// Link codes first, before the membership branch below: someone linking
	// has no identity row yet, so that branch would answer them instead and
	// the ceremony could never complete. See channellink.go.
	if reply, handled := s.tryChannelLink(ctx, channels.KindDiscord, userKey, txt); handled {
		s.discordText(ctx, send, chatID, msg.ChannelID, reply)
		return
	}

	if profileID == "" {
		s.discordText(ctx, send, chatID, msg.ChannelID, strings.Join([]string{
			"This Discord account isn't linked to an Aql member yet.",
			"In the Aql console, open Settings and generate a Discord link code,",
			"then send it here. It looks like LINK-XXXX-XXXX-XXXX and lasts 10 minutes.",
		}, "\n"))
		return
	}

	switch {
	// "close" is a first-class command word, exactly as "open" is — this rail
	// ships with the property fb01edc had to retrofit onto Telegram and Slack.
	// The verb is decided ONCE, here, from an exact word, and threaded into the
	// renderer; it is never inferred later and never defaulted. "gates" keeps
	// the open semantics it has on the other rails.
	case txt == "open" || txt == "gates" || txt == "close":
		verb := channels.VerbOpen
		if txt == "close" {
			verb = channels.VerbClose
		}
		gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID)
		if err != nil {
			s.log.Error("discord available", "err", err)
			return
		}
		switch len(gates) {
		case 0:
			s.discordText(ctx, send, chatID, msg.ChannelID, "You don't have any active gate access. Please contact the administrator.")
		case 1:
			s.discordAccessCommand(ctx, send, chatID, msg.ChannelID, profileID, gates[0].APID, gates[0].APName, verb.Command())
		default:
			prompt := "Which gate would you like to open?"
			if verb != channels.VerbOpen {
				prompt = "I haven't closed anything. Which gate would you like to close?"
			}
			body, components := channels.DiscordGatePicker(verb, prompt, gates, s.channelPublicURL())
			s.discordComponents(ctx, send, chatID, msg.ChannelID, body, components)
		}
	case discordHelpWords[txt]:
		s.discordText(ctx, send, chatID, msg.ChannelID, channels.DiscordMenu(displayName))
	default:
		// A verb the engine knows and chat cannot serve gets said plainly; a
		// menu here would answer a question about lights with a list of gates.
		if v, ok := channels.UnsupportedVerb(txt); ok {
			s.discordText(ctx, send, chatID, msg.ChannelID,
				channels.UnsupportedVerbReply(v, s.channelPublicURL()))
			return
		}
		// A body that names no command word is a question, not an instruction.
		// There is no default verb and no most-likely-intent fallback
		// (docs/CHAT-COMMANDS.md §3.5), so the honest answer is the menu.
		s.discordText(ctx, send, chatID, msg.ChannelID, channels.DiscordMenu(displayName))
	}
}

func (s *Server) processDiscordInteraction(ctx contextT, send channels.DiscordSender, inter *channels.DiscordInteraction) {
	// Only a component tap. A slash command, an autocomplete or a modal submit
	// is a different interaction type this rail never rendered, so it actuates
	// nothing.
	if inter.Type != channels.DiscordInteractionMessageComponent {
		return
	}
	// Acknowledge first, unconditionally: Discord expires an unacknowledged
	// interaction in ~3s and the open path may honestly take longer. This
	// changes nothing visible and claims nothing about the gate.
	send.AckComponent(ctx, inter.ID, inter.Token)

	// The verb and the target both come out of the custom_id through the
	// SHARED allowlist — never from a prefix test and never from a default.
	// ParseSelection refuses an id this gateway did not mint;
	// SelectionCommandVerb answers only for open_ap/close_ap, so a narrowing
	// id (select_loc:, minted by another rail) actuates nothing here.
	cmd, apID, ok := channels.ParseSelection(inter.Data.CustomID)
	if !ok {
		return
	}
	command, ok := channels.SelectionCommandVerb(cmd)
	if !ok {
		return
	}
	userKey := inter.UserID()
	if userKey == "" {
		return // a payload naming nobody actuates nothing
	}
	profileID, err := s.store.ResolveChannelIdentity(ctx, channels.KindDiscord, userKey)
	if err != nil || profileID == "" {
		return // unlinked user: no actuation
	}
	channelID := inter.ChannelID
	chatID, _ := s.store.UpsertChannelChat(ctx, channels.KindDiscord, channelID, profileID, "", nil)

	gateName := ""
	if gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID); err == nil {
		for _, g := range gates {
			if g.APID == apID {
				gateName = g.APName
			}
		}
	}
	s.discordAccessCommand(ctx, send, chatID, channelID, profileID, apID, gateName, command)
}

// discordAccessCommand runs one open/close through the shared choke point and
// renders the honest result — same shape as tgAccessCommand/waAccessCommand.
// command is the open-path vocabulary ("open"/"close") and reaches
// store.LogAccess unchanged; nothing here re-derives it.
func (s *Server) discordAccessCommand(ctx contextT, send channels.DiscordSender, chatID, channelID, profileID, apID, gateName, command string) {
	had, v, err := s.profileOpen(ctx, profileID, apID, command, channels.KindDiscord)
	if err != nil {
		s.log.Error("discord open", "err", err)
		return
	}
	if !had {
		s.discordText(ctx, send, chatID, channelID, "Sorry, you no longer have access to this gate.")
		return
	}
	if !v.Allowed {
		s.discordText(ctx, send, chatID, channelID, channels.DenialMessage(v.Reason, v.RetryAfterS, s.channelPublicURL()))
		return
	}
	if gateName == "" {
		gateName = "the gate"
	}
	word := "Opening"
	if command == "close" {
		word = "Closing"
	}
	s.discordText(ctx, send, chatID, channelID, word+" "+gateName+"...")
}

func (s *Server) discordText(ctx contextT, send channels.DiscordSender, chatID, channelID, text string) {
	sent := send.SendText(ctx, channelID, text)
	s.discordLog(ctx, chatID, "text", map[string]any{"text": text}, sent)
}

func (s *Server) discordComponents(ctx contextT, send channels.DiscordSender, chatID, channelID, text string, components []channels.DiscordComponent) {
	sent := send.SendComponents(ctx, channelID, text, components)
	s.discordLog(ctx, chatID, "interactive", map[string]any{"text": text, "components": components}, sent)
}

func (s *Server) discordLog(ctx contextT, chatID, kind string, body any, sent channels.SendResult) {
	status := "sent"
	if !sent.OK {
		status = "failed:" + sent.Error
	}
	if err := s.store.InsertOutboundMessage(ctx, chatID, channels.KindDiscord, kind, body, sent.ProviderMessageID, status); err != nil {
		s.log.Error("discord log outbound", "err", err)
	}
}

// discordMessageTS reads a message's own clock as a unix second. Discord sends
// an ISO-8601 timestamp; an unparseable one yields 0 rather than a guess, the
// same way parseSlackTS does.
func discordMessageTS(msg *channels.DiscordMessage) int64 {
	t, err := time.Parse(time.RFC3339, msg.Timestamp)
	if err != nil {
		return 0
	}
	return t.Unix()
}
