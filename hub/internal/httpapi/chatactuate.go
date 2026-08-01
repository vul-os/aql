package httpapi

import (
	"fmt"
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
// # Group expansion
//
// Present, at T1 only, and ONLY when the member wrote an explicit
// quantifier. "Turn off all the shed lamps" fans out; "turn off the shed lamps"
// does not, and is answered with the picker, because a plural noun is how
// people name a single fixture at least as often as a set. The full rule set
// and the reasoning behind each limit is in chatzone.go; the ordering rule --
// device first, zone only when no device resolved -- is at the call site below,
// where it can be read next to the thing it constrains.
//
// What this comment said until recently is worth recording, because it was
// wrong for a long time and wrong in the expensive direction: it said group
// expansion "needs groups, which do not exist". Groups existed the whole time.
// Device.Zone is a field and automations/engine.go has always fanned out over
// one. A blocker that names the wrong obstacle does not merely mislead -- it
// stops anyone from checking whether the obstacle is real.
//
// # What is still deliberately absent
//
// No selection context, so a picker reply cannot be resolved by a
// follow-up — an ambiguous body is answered with the candidates and the member
// re-sends naming one.
//
// Arguments ARE read now, for one verb and no further: `set`. The objection
// this paragraph used to make — that parsing a value out of free text is a
// resolution problem of its own — was true about parsing and did not settle the
// question, because the three phrasings it named all contain exactly one number
// and channels.Quantity insists on exactly one. What settled it was the tier
// table; see chatSendableVerbs.

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

// chatSendableVerbs is the closed set of verbs chat may send.
//
// It was chatArgumentlessVerbs, and excluded every verb taking a value on the
// grounds that "dim the lounge to 30" against "…to 30%" against "…30 percent"
// is a resolution problem of its own. That was true about parsing and did not
// settle the question: all three contain exactly ONE number, and a parser that
// insists on exactly one reads them identically (channels.Quantity).
//
// What settled it was the TIER TABLE. `set` is TierReversible on a dimmer and
// TierConsequential on a thermostat, and this surface's ceiling is
// TierReversible — so allowing it reaches a lamp's brightness and nothing else.
// A misparse there is a light at the wrong level, which is the definition of
// the tier it sits in; a thermostat stays out by machinery that was already
// here rather than by the parser being careful. The ceiling does the safety
// work, as it is supposed to.
var chatSendableVerbs = map[devices.Verb]bool{
	devices.VerbSet:    true,
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
	fleet := s.chatFleetFor(ctx, profileID)
	if len(fleet) == 0 {
		return chatActuationResult{}, false
	}

	// T4 first, and it does NOT go through the rest of this function. A
	// hazardous verb is never sent from here at any tier: chatRequestT4 records
	// a request and the device moves only when the console approves it. Placed
	// before the sendable-verb gate because `start` is deliberately absent from
	// chatSendableVerbs — chat may ask for it, and may not send it.
	if res, handled := s.chatRequestT4(ctx, body, profileID, source, chatID, confirmToken, v, fleet); handled {
		return res, true
	}

	if !chatSendableVerbs[v] {
		// Not refused here — the caller's existing refusal already explains
		// that chat does not do this, and duplicating that copy would put two
		// wordings of the same refusal in the product.
		return chatActuationResult{}, false
	}

	m := channels.ResolveDevice(body, v, fleet)
	if !m.Unique() {
		// A device did not resolve. Before falling through, ask whether this is
		// a ZONE command — "turn off all the shed lamps" reaches here because a
		// zone word alone is deliberately below the device floor.
		//
		// Device FIRST and zone only on non-unique, never the other way round.
		// A device NAMED for a place ("Exterior Lights") scores on its name,
		// above the floor, so it is claimed here and the zone path never sees
		// it. Reverse the order and the place would swallow the device — the
		// more specific reading would be the one that lost.
		if res, handled := s.chatActuateZone(ctx, body, profileID, source, v, fleet); handled {
			return res, true
		}
		// Ambiguous or unresolved: nothing actuates and the reply says which.
		// Falls through to the caller so the existing resolving refusal, which
		// already words both cases, is the one message a member sees.
		return chatActuationResult{}, false
	}

	// An argument, when the verb takes one. Fail-closed per §3.5: exactly one
	// number in the body or nothing happens, and the refusal says which problem
	// it is — none supplied, or too many to tell apart.
	//
	// The RANGE is not checked here. Resolve validates against the catalogue's
	// own Min/Max and produces the message naming them, and a second copy of a
	// bound is a second thing to disagree with the first.
	args, argRefusal := chatVerbArgs(reg, m.Device.Key, v, body)
	if argRefusal != "" {
		return chatActuationResult{
			Reply: channels.ActuationRefused(m.Device.Device.Name, v, argRefusal),
		}, true
	}

	// The registry is the authority on tier. This never re-derives one and
	// never widens one — it only refuses.
	plan, err := reg.Resolve(m.Device.Key, v, args)
	if err != nil {
		return chatActuationResult{
			Reply: channels.ActuationRefused(m.Device.Device.Name, v, "that device would not accept it"),
		}, true
	}
	if plan.Tier > chatTierCeiling {
		// A verb carrying a PARSED QUANTITY never takes the confirmation route,
		// even though its tier would be within reach of one.
		//
		// A confirmation proves intent. It does not prove the number was read
		// correctly, because ConfirmationPrompt echoes the device and the verb
		// and NOT the argument — so confirming "set the thermostat to 21" that
		// this parsed as 2 is confirming a value the member never saw. Raising
		// a ceiling on the strength of a check that does not cover the new
		// failure mode is how a safety property gets hollowed out.
		//
		// So `set` reaches exactly what the unconfirmed ceiling allows: a
		// dimmer at TierReversible. A thermostat is TierConsequential and is
		// refused here, which is what it was before this verb was allowed at
		// all — the console keeps it.
		if len(args) > 0 {
			return chatActuationResult{
				Reply: channels.ActuationOutOfTier(
					m.Device.Device.Name, v, plan.Tier.String(), s.channelPublicURL()),
			}, true
		}
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
	// A verb that carried a quantity echoes it back. That echo is the member's
	// only evidence the number was read correctly — "is now updated" reads the
	// same whether this understood 30 or 3 — and it is the same argument that
	// keeps a quantity verb off the confirmation route. Refusing a confirmation
	// for not showing the number and then not showing it on success would be
	// the two halves disagreeing.
	//
	// plan.Args rather than the parsed map, so what is echoed is what the device
	// GOT rather than what this asked for. Today the two are identical —
	// Resolve copies the one declared argument and the parser only ever sets
	// that one — so no test can tell them apart, and swapping them passes.
	// Said out loud rather than left as an implied property: it is defensive
	// against Resolve gaining a normalisation (a clamp, a rounding) that would
	// otherwise be invisible in the reply, and nobody should read the choice as
	// something the tests hold.
	for arg, val := range plan.Args {
		return chatActuationResult{
			Reply:    channels.ActuationDoneWithValue(m.Device.Device.Name, arg, val),
			Actuated: true,
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
	if plan.Tier > chatConfirmedTierCeiling {
		return chatActuationResult{
			Reply: channels.ActuationOutOfTier(
				m.Device.Device.Name, v, plan.Tier.String(), s.channelPublicURL()),
		}, false
	}
	return s.confirmationHeld(ctx, m, v, profileID, source, chatID, confirmToken)
}

// confirmationHeld is the confirmation exchange itself, with NO tier ceiling of
// its own.
//
// Split out of confirmedOrPrompt because T4 needs the same exchange and must not
// go through that function's T2 ceiling — chatstepup.go asks for a confirmation
// on a verb the confirmed ceiling would refuse, and then still refuses to send
// it. The ceiling stays where it was, in the caller that owns it; duplicating
// the mint/redeem/mismatch/counter sequence into a second copy is how the two
// would eventually disagree about what a valid confirmation is.
//
// Returns ok=true only when the caller holds a VALID, MATCHING, unspent
// confirmation for this exact (device, verb).
func (s *Server) confirmationHeld(
	ctx contextT, m channels.DeviceMatch, v devices.Verb,
	profileID, source, chatID, confirmToken string,
) (chatActuationResult, bool) {
	name := m.Device.Device.Name
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

// chatVerbArgs reads the argument a verb needs out of the message body.
//
// Returns nil args and an empty refusal for a verb that takes none, which is
// every verb chat sent before `set` existed — so the common path is unchanged
// and does not depend on a body containing no digits.
//
// The catalogue is asked what the verb needs rather than a list here deciding:
// a capability that gains an argument gets this behaviour without an edit, and
// one that loses it stops asking for a number the same way.
func chatVerbArgs(reg *devices.Registry, key string, v devices.Verb, body string) (map[string]float64, string) {
	// Device.Supports is what Resolve itself calls, so the two cannot disagree
	// about which argument a verb takes. A new registry method would have been
	// a second path to the same answer.
	dev, ok := reg.Get(key)
	if !ok {
		return nil, ""
	}
	spec, _, ok := dev.Device.Supports(v)
	if !ok || spec.Arg == "" {
		return nil, ""
	}
	switch channels.QuantityCount(body) {
	case 1:
		val, _ := channels.Quantity(body)
		return map[string]float64{spec.Arg: val}, ""
	case 0:
		return nil, fmt.Sprintf("that needs a %s between %v and %v, and I didn't see a number",
			spec.Arg, spec.Min, spec.Max)
	default:
		return nil, "there is more than one number in that and I can't tell which is the level"
	}
}
