package httpapi

import (
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
)

// Driving an engine device from a chat message — docs/CHAT-COMMANDS.md §3, at
// T1 and no higher.
//
// # What T1 is, and why the ceiling is here rather than in the catalogue
//
// §3.2's T1 is "reversible comfort: no hazard, trivially undone, no cost" — a
// lamp, a fan, `stop`/`pause` of a running job. §3.3 requires of it exactly one
// thing beyond a linked active member: a per-(subject, device, verb) cooldown.
// No confirmation, no step-up, no time window. Those are T2+ requirements and
// the machinery for them (§3.4's intent-bound tokens) does not exist, so
// nothing above T1 may pass here.
//
// The ceiling is a property of THIS SURFACE, not of the verbs. The console
// actuates up to TierHazardousMotion with a confirmation, because a person
// clicking a button in a room is attended in a way a text message is not. Two
// surfaces, two ceilings, one catalogue — and the catalogue stays the single
// authority on what tier a verb carries.
//
// # Fail-closed, per §3.5
//
// "If any of — the sender's identity, the target, the verb, an argument, the
// tier, the authorization, or the confirmation state — is unresolved, ambiguous
// or unverifiable, nothing actuates." Every branch below that cannot establish
// its precondition returns a refusal, and the refusal names what could not be
// established rather than saying "no".
//
// # What is deliberately absent
//
// No group expansion (§2.3 stage 5 permits it at T1; it needs groups, which do
// not exist). No selection context, so a picker reply cannot be resolved by a
// follow-up — an ambiguous body is answered with the candidates and the member
// re-sends naming one. No arguments: `set` takes a value and parsing one from
// free text is a second resolution problem with its own failure modes, so `set`
// is not reachable from chat even though it is T1 on some capabilities.

// chatTierCeiling is the highest tier a chat message may actuate.
//
// TierReversible — T1. Deliberately a constant rather than a config: raising it
// is a change to what a text message can do to a physical space, and that
// belongs in a reviewed diff rather than in an environment variable a
// deployment can set.
const chatTierCeiling = devices.TierReversible

// chatConfirmedTierCeiling is how high a CONFIRMED command may go.
//
// TierConsequential — T2. §3.3's T2 row asks for a confirmation and a per-tier
// daily counter and nothing else; T3 is the gate path, which has its own
// reviewed stack and does not come through here; T4 additionally requires
// step-up on a different rail and an operator-armed time window, neither of
// which exists, so T4 stays refused however many messages are sent.
//
// A confirmation raises the ceiling by exactly one tier. It is not a skeleton
// key.
const chatConfirmedTierCeiling = devices.TierConsequential

// chatT2PerDay is §3.3's "per-tier daily counter" for T2.
//
// Its own scope, like the query counter, so a day of irrigation commands cannot
// exhaust the budget that opens a gate.
const chatT2PerDay = 20

// chatActuationCooldownS is the per-(subject, device, verb) cooldown §3.3's T1
// row requires.
//
// Five seconds. Long enough that a duplicate delivery or a double-tap does not
// actuate twice, short enough that a member turning a lamp off and on again is
// not told to wait. It is not an abuse control — the flood throttle and the
// hourly counters are — it is a debounce on a physical thing.
const chatActuationCooldownS = 5

// chatArgumentlessVerbs is the closed set of verbs chat may send.
//
// A verb that takes a value is excluded even when its tier would allow it:
// `set` at T1 on a dimmer needs a number parsed out of free text, and "dim the
// lounge to 30" against "dim the lounge to 30%" against "dim lounge 30 percent"
// is a resolution problem of its own. Chat sends verbs it can send WITHOUT
// interpreting a quantity, and the console keeps the rest.
var chatArgumentlessVerbs = map[devices.Verb]bool{
	devices.VerbOn:     true,
	devices.VerbOff:    true,
	devices.VerbToggle: true,
	devices.VerbStop:   true,
	devices.VerbPause:  true,
	devices.VerbResume: true,
}

// chatActuationResult is what the rail should say, and whether anything moved.
type chatActuationResult struct {
	Reply string
	// Actuated reports that a device was driven. Rails use it for nothing
	// today; it exists so a test can assert the difference between "refused
	// with a polite message" and "did the thing", which the reply text alone
	// cannot establish.
	Actuated bool
}

// chatActuate attempts a device command from a chat message.
//
// handled is false when the body is not an engine command at all, so the caller
// falls through to its existing behaviour. Every other outcome — refused,
// ambiguous, out of tier, unconfirmed, cooled down, failed — is handled with a
// reply.
//
// chatID and confirmToken carry §3.4's two additional requirements: the
// conversation the message arrived in, and any token the body carried. Both are
// passed rather than derived here because only the rail knows them.
func (s *Server) chatActuate(ctx contextT, body, profileID, source, chatID, confirmToken string, v devices.Verb) (chatActuationResult, bool) {
	reg := s.registry()
	if reg == nil {
		return chatActuationResult{}, false
	}
	if !chatArgumentlessVerbs[v] {
		// Not refused here — the caller's existing refusal already explains
		// that chat does not do this, and duplicating that copy would put two
		// wordings of the same refusal in the product.
		return chatActuationResult{}, false
	}

	fleet := s.chatFleetFor(ctx, profileID)
	if len(fleet) == 0 {
		return chatActuationResult{}, false
	}

	m := channels.ResolveDevice(body, v, fleet)
	if !m.Unique() {
		// Ambiguous or unresolved: nothing actuates and the reply says which.
		// Falls through to the caller so the existing resolving refusal, which
		// already words both cases, is the one message a member sees.
		return chatActuationResult{}, false
	}

	// The registry is the authority on tier. This never re-derives one and
	// never widens one — it only refuses.
	plan, err := reg.Resolve(m.Device.Key, v, nil)
	if err != nil {
		return chatActuationResult{
			Reply: channels.ActuationRefused(m.Device.Device.Name, v, "that device would not accept it"),
		}, true
	}
	if plan.Tier > chatTierCeiling {
		// Above T1: a confirmation may raise the ceiling by one tier, and only
		// if the member is holding one for THIS intent.
		res, ok := s.confirmedOrPrompt(ctx, plan, m, v, profileID, source, chatID, confirmToken)
		if !ok {
			return res, true
		}
	}

	// Cooldown LAST among the checks, so a refused attempt never restarts
	// anyone's cooldown — the same ordering openpath.go uses and for the same
	// reason. The claim is atomic: two deliveries of one message race here and
	// exactly one wins.
	subject := chatCooldownSubject(profileID, m.Device.Key, v)
	claimed, err := s.store.ClaimActuationCooldown(ctx, subject, time.Now().Unix(), chatActuationCooldownS)
	if err != nil {
		// Fail CLOSED, unlike the open path. openpath.go's fail-open is a
		// reviewed decision for a member standing at their own gate; there is
		// no equivalent stakes argument for a lamp, and §3.5 names refusal as
		// the direction the generalised path diverges in.
		s.log.Error("chat actuation cooldown", "err", err)
		return chatActuationResult{
			Reply: channels.ActuationRefused(m.Device.Device.Name, v, "I couldn't check the rate limit, so I didn't send it"),
		}, true
	}
	if !claimed {
		return chatActuationResult{
			Reply: channels.ActuationRefused(m.Device.Device.Name, v, "that was only just sent — give it a moment"),
		}, true
	}

	execErr := reg.ExecutePlan(ctx, plan)

	// §3.8: every attempt at every tier goes in access_logs. Written after the
	// attempt so success reflects what happened, and written even on failure —
	// a command that was sent and failed is a different fact from one never
	// sent, and both matter when a member says "I turned it off".
	if err := s.store.LogDeviceCommand(ctx, store.DeviceCommandLog{
		DeviceKey: m.Device.Key,
		// The actor's account, used only when the device is unclaimed — the
		// normal state on a one-household hub, where claiming is unnecessary
		// and an unowned device still belongs to the only account there is.
		AccountID: s.soleAccountFor(ctx, profileID),
		UserID:    profileID,
		Command:   string(v),
		Source:    source,
		Success:   execErr == nil,
		Err:       errText(execErr),
	}); err != nil {
		s.log.Error("log device command", "err", err)
	}

	if execErr != nil {
		return chatActuationResult{
			Reply: channels.ActuationRefused(m.Device.Device.Name, v, "the device did not accept it"),
		}, true
	}
	return chatActuationResult{
		Reply:    channels.ActuationDone(m.Device.Device.Name, v),
		Actuated: true,
	}, true
}

// chatCooldownSubject keys the cooldown per (subject, device, verb), which is
// what §3.3's T1 row asks for.
//
// All three, not just the subject: a member turning off the kitchen light must
// not be told to wait because they turned on the porch light a second earlier,
// and turning a lamp ON then OFF is a legitimate sequence rather than a
// repeat. The prefix keeps these out of the gate cooldowns, which share the
// table.
func chatCooldownSubject(profileID, deviceKey string, v devices.Verb) string {
	return "chat-act:" + profileID + ":" + deviceKey + ":" + string(v)
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// confirmedOrPrompt decides whether an above-T1 command may proceed.
//
// ok=true means proceed. ok=false means the returned result is the reply and
// nothing actuates.
//
// # The re-resolution is the point
//
// A token names an intent hash; this recomputes the hash from the intent
// resolved on THIS message and compares. That is not belt-and-braces — the
// fleet can change between the two messages, and without it a token minted for
// "resume the cleaning bot" would authorize whatever "resume the cleaning bot"
// resolves to a minute later, which after a device rename or a driver reload
// may be a different machine. The token authorizes an ACTION, not a sentence.
//
// # Why T4 cannot be reached from here at all
//
// The confirmed ceiling is T2. §3.3 requires step-up on a different rail and an
// operator-armed time window for T4, and neither exists; a confirmation is not
// a substitute for either. Sending a token at a T4 verb refuses exactly as
// sending nothing does.
func (s *Server) confirmedOrPrompt(
	ctx contextT, plan devices.Plan, m channels.DeviceMatch, v devices.Verb,
	profileID, source, chatID, confirmToken string,
) (chatActuationResult, bool) {
	name := m.Device.Device.Name
	if plan.Tier > chatConfirmedTierCeiling {
		return chatActuationResult{
			Reply: channels.ActuationOutOfTier(name, v, plan.Tier.String(), s.channelPublicURL()),
		}, false
	}

	want := store.IntentHash(m.Device.Key, string(v), nil)
	subject := "profile:" + profileID

	if confirmToken == "" {
		tok, err := s.store.MintConfirmation(ctx, store.PendingConfirmation{
			Subject: subject, Channel: source, ChatID: chatID,
			IntentHash: want, DeviceKey: m.Device.Key, Verb: string(v),
		}, time.Now().Unix())
		if err != nil {
			s.log.Error("mint confirmation", "err", err)
			return chatActuationResult{
				Reply: channels.ActuationRefused(name, v, "I could not set up a confirmation, so I did not send it"),
			}, false
		}
		return chatActuationResult{Reply: channels.ConfirmationPrompt(name, v, tok)}, false
	}

	p, err := s.store.RedeemConfirmation(ctx, confirmToken, subject, source, chatID, time.Now().Unix())
	if err != nil {
		// One reply for unknown, expired, spent and wrong-conversation. Naming
		// which would tell whoever is guessing how far they got, and none of
		// the distinctions change what a member should do: ask again.
		return chatActuationResult{Reply: channels.ConfirmationRejected(s.channelPublicURL())}, false
	}
	if p.IntentHash != want {
		// The token was valid and is now SPENT, and it did not match. That is
		// the interleaved-exchange case §3.4 names: a confirmation for one
		// action arriving against another. Refuse, and say what it was for.
		return chatActuationResult{Reply: channels.ConfirmationMismatch(p.Verb, p.DeviceKey, name, v)}, false
	}

	// §3.3's T2 row: a per-tier daily counter, its own scope so it cannot
	// exhaust the budget that opens a gate.
	over := s.store.NoteChatQuery(ctx, "t2:"+subject, chatT2PerDay, time.Now().Unix())
	if over {
		return chatActuationResult{
			Reply: channels.ActuationRefused(name, v, "that is today's limit for commands like this"),
		}, false
	}
	return chatActuationResult{}, true
}

// soleAccountFor returns the actor's account when they have exactly one.
//
// Exactly one, deliberately. A member of several accounts acting on an
// UNCLAIMED device gives no basis for choosing which account's log the row
// belongs in, and picking one would file a real event under a possibly wrong
// tenant — worse than filing it under none, because it would look right. With
// several accounts the row keeps whatever the device claim says, and an
// unclaimed device on a multi-account hub is already unreachable: permits()
// denies it, so this path is not taken.
func (s *Server) soleAccountFor(ctx contextT, userID string) string {
	accounts, err := s.store.AccountsForUser(ctx, userID)
	if err != nil || len(accounts) != 1 {
		return ""
	}
	return accounts[0].ID
}
