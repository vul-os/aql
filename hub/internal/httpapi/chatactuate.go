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
// ambiguous, out of tier, cooled down, failed — is handled with a reply.
func (s *Server) chatActuate(ctx contextT, body, profileID, source string, v devices.Verb) (chatActuationResult, bool) {
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
		return chatActuationResult{
			Reply: channels.ActuationOutOfTier(m.Device.Device.Name, v, plan.Tier.String(), s.channelPublicURL()),
		}, true
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
