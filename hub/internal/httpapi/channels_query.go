package httpapi

import (
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/energy"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/store"
)

// Answering a gate question on a chat rail — docs/CHAT-COMMANDS.md §4.
//
// One implementation for every rail. The four rails each hand-rolled their
// actuation branch and a third verb made all of them wrong at once
// (channels/verb.go's ActingWord comment records it); a read path that leaks a
// property map is a worse thing to get wrong in four places, so the disclosure
// rules live here and the rails pass in their authorized set.

// QueriesPerHour caps how many questions one identity may ask in an hour.
//
// Its own budget, not shared with opens — §4.4 rule 4. Thirty is generous for a
// person and cheap to exceed for a script, which is the shape wanted: the cap
// is not really a throttle, it is a floor under which a reconnaissance sweep
// cannot hide in ordinary use.
//
// Not operator-configurable yet, and deliberately not plumbed through
// RateLimitConfig as a half-measure — a limit that appears in the settings UI
// implies the rest of §3.3's table is configurable too, and it is not.
const QueriesPerHour = 30

// queryCaller is who is asking, in the terms the audit and the counter need.
type queryCaller struct {
	// subject scopes the query counter. Same shape as the chat flood throttle's
	// subject ("phone:+27…") so the two are readable side by side.
	subject string
	// source is the channel kind recorded on the audit row.
	source string
	// userFor resolves the member id for one access point, "" when the caller
	// holds a visitor grant rather than a membership. A read by someone with no
	// user row is still audited — the row carries the access point, the time
	// and the channel, which is what makes "who was told what" answerable.
	userFor func(apID string) string
}

// answerGateQuestion returns the reply for a question about a gate, and records
// the disclosure.
//
// Returns "" when nothing should be sent — over the query cap. Going quiet
// rather than replying "too many questions" is the same choice the chat flood
// throttle makes: a reply is itself a signal to whoever is probing, and the
// webhook still 200s.
func (s *Server) answerGateQuestion(ctx contextT, body string, verb channels.GateVerb, aps []store.AvailableAP, c queryCaller) string {
	nowUnix := time.Now().Unix()
	if s.store.NoteChatQuery(ctx, c.subject, QueriesPerHour, nowUnix) {
		s.log.Warn("chat query over cap", "subject", c.subject, "source", c.source)
		return ""
	}

	kind := channels.ClassifyGateQuestion(body)

	// Capped BEFORE the read, not after. Reading the whole fleet and then
	// showing ten of it would audit disclosures that never happened and put the
	// other rows in memory for the next mistake to print.
	total := len(aps)
	shown := aps
	if len(shown) > channels.PickerCapacity {
		shown = shown[:channels.PickerCapacity]
	}

	rows, err := s.store.GateReadSummary(ctx, shown)
	if err != nil {
		s.log.Error("gate read summary", "err", err)
		// No invented answer. A read that failed is not a gate that has never
		// been opened, and the difference is the whole point of this section.
		return "I couldn't read that just now — try again in a moment."
	}

	facts := make([]channels.GateFact, 0, len(rows))
	for _, r := range rows {
		facts = append(facts, channels.GateFact{
			Name:        r.APName,
			LastOpenAt:  r.LastOpenAt.Int64,
			LastCloseAt: r.LastCloseAt.Int64,
			LastSeenAt:  r.LastSeenAt.Int64,
			HasDevice:   r.DeviceID != "",
		})
	}

	// Audited per gate disclosed, after the facts are assembled and only for
	// gates that actually resolved. A row per gate rather than one per message
	// is what makes the log answer "who was told about THIS gate".
	for _, r := range rows {
		var userID string
		if c.userFor != nil {
			userID = c.userFor(r.APID)
		}
		if err := s.store.LogGateRead(ctx, r.APID, r.LocationID, r.AccountID, userID, c.source); err != nil {
			s.log.Error("log gate read", "err", err)
		}
	}

	return channels.QueryAnswer(kind, verb, facts, total, nowUnix, s.channelPublicURL())
}

// answerProfileGateQuestion is the whole question branch for a rail that
// identifies its caller by profile — Telegram, Slack, Discord and DMTAP.
//
// Returns "" when there is nothing to send: the body was not a question, or the
// caller is over the query cap. The two collapse deliberately. A rail asking
// "do I have a reply" should not have to know which of those it was, and the
// alternative — returning a bool alongside — is the shape that gets one branch
// right on three rails and wrong on the fourth. That has already happened here
// once: a third verb made five hand-rolled actuation branches wrong at the same
// time (channels/verb.go's ActingWord).
//
// It reads the authorized set itself rather than taking one, because every
// caller would otherwise fetch it identically two lines earlier, and a rail
// that passed the WRONG set would leak another member's gates with nothing to
// catch it — §4.4 rule 1 is that a query resolves only over the caller's own.
func (s *Server) answerProfileGateQuestion(ctx contextT, body, profileID, source string) string {
	// Energy first. An energy question names no gate, so every gate
	// classification below would miss it and it would reach the welcome menu —
	// and "how much solar have we made today" carries "how", which the gate
	// classifier reads as an interrogative it cannot answer.
	if reply := s.answerEnergyQuestion(ctx, body, profileID, source); reply != "" {
		return reply
	}
	verb, intent := channels.TextGateIntent(body)
	if intent != channels.IntentQuestion {
		return ""
	}
	gates, err := s.store.AvailableAccessPointsByProfile(ctx, profileID)
	if err != nil {
		s.log.Error("available for query", "err", err, "source", source)
		return ""
	}
	return s.answerGateQuestion(ctx, body, verb, gates, queryCaller{
		subject: "profile:" + profileID,
		source:  source,
		userFor: func(string) string { return profileID },
	})
}

// chatFleetFor returns the engine devices a chat caller may see.
//
// The SAME scope rule the console uses (engineScopeForUser), not a chat-shaped
// copy of it. A parallel implementation is how a rail and the console end up
// disagreeing about which devices a member owns, and the direction of that
// disagreement is not predictable — a second copy is as likely to be wider as
// narrower, and wider here means naming a neighbour's devices in a reply.
//
// Returns nil for every failure, including "not engine authority". A refusal
// that names no device is the existing behaviour and is always safe; there is
// nothing a rail should do differently because the engine declined to describe
// itself.
func (s *Server) chatFleetFor(ctx contextT, profileID string) []devices.IndexedDevice {
	reg := s.registry()
	if reg == nil || profileID == "" {
		return nil
	}
	scope, err := s.engineScopeForUser(ctx, profileID)
	if err != nil {
		return nil
	}
	var out []devices.IndexedDevice
	for _, d := range reg.Devices() {
		if scope.permits(d.Key) {
			out = append(out, d)
		}
	}
	return out
}

// unsupportedVerbReply answers a verb chat cannot serve, naming the device the
// member meant when it can work that out.
//
// Chat actuates nothing on the engine and this does not change that. It makes
// the refusal legible — and it puts the resolver in front of real fleets and
// real phrasings in a message that moves nothing, which is the order a
// component whose failure mode is "the wrong device" has to be built in.
// chatEngineVerbReply is the single entry point a rail uses for an engine verb:
// it actuates when everything resolves at T1, and otherwise returns the
// refusal that names what it understood.
//
// One function rather than "try actuate, then maybe refuse" at four call sites.
// The rails already got this shape wrong once — five hand-rolled actuation
// branches, one new verb, five wrong at once — and this is the branch where
// getting it wrong means a message that says nothing happened while something
// did, or the reverse.
func (s *Server) chatEngineVerbReply(ctx contextT, body, profileID, source, chatID string, v devices.Verb) string {
	// A token in the body is a confirmation for the command being repeated
	// alongside it. Extracted here, once, rather than in four rails.
	token, _ := store.ConfirmationTokenIn(body)
	if res, handled := s.chatActuate(ctx, body, profileID, source, chatID, token, v); handled {
		return res.Reply
	}
	return s.unsupportedVerbReply(ctx, body, profileID, v)
}

func (s *Server) unsupportedVerbReply(ctx contextT, body, profileID string, v devices.Verb) string {
	fleet := s.chatFleetFor(ctx, profileID)
	if len(fleet) == 0 {
		return channels.UnsupportedVerbReply(v, s.channelPublicURL())
	}
	return channels.UnsupportedVerbReplyFor(channels.ResolveDevice(body, v, fleet), s.channelPublicURL())
}

// answerEnergyQuestion answers "how much solar today" — docs/CHAT-COMMANDS.md
// §4.2's remaining answerable row.
//
// Returns "" when this is not an energy question, or the hub does not meter, or
// the caller has no single account to answer for. All three collapse into
// "nothing to say here" so the rail falls through to its existing behaviour;
// none of them is an error worth alarming a member about.
//
// Scoped to the caller's account, and only when they have EXACTLY one. Energy
// is an account-wide aggregate rather than a per-device fact, so a member of
// several accounts gives no basis for choosing which site to report — and
// reporting the wrong household's consumption is a disclosure, not a
// mis-answer. The console, where an account can be selected, is the right
// surface for that case.
func (s *Server) answerEnergyQuestion(ctx contextT, body, profileID, source string) string {
	if s.cfg.Energy == nil || !channels.ClassifyEnergyQuestion(body) {
		return ""
	}
	accountID := s.soleAccountFor(ctx, profileID)
	if accountID == "" {
		return ""
	}
	if s.store.NoteChatQuery(ctx, "profile:"+profileID, QueriesPerHour, time.Now().Unix()) {
		return "" // over the query cap: go quiet, as the gate read path does
	}

	// Midnight to now, in the hub's configured zone — "today" is a local-time
	// question and the rollups are keyed by zone, so asking in UTC would answer
	// a different day for most of the world.
	loc := s.cfg.Energy.Location()
	now := time.Now().In(loc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	mix, err := s.cfg.Energy.SourceMix(ctx, accountID, from, now)
	if err != nil {
		s.log.Error("chat energy mix", "err", err, "source", source)
		return "I could not read the meters just now — try again in a moment."
	}

	facts := make([]channels.EnergyFact, 0, len(mix.Totals))
	for _, t := range mix.Totals {
		// Sinks (export, battery charge) are deliberately omitted: the question
		// asked is what was generated or used, and listing "exported" beside
		// "solar" invites reading one as a share of the other when they are
		// different directions.
		if t.Flow != energy.FlowSupply {
			continue
		}
		facts = append(facts, channels.EnergyFact{
			Source:   string(t.Source),
			KWh:      t.KWh,
			Complete: t.Complete(),
		})
	}
	return channels.EnergyAnswer(facts, mix.UnattributedKWh, s.channelPublicURL())
}
