package httpapi

import (
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
)

// Zone fan-out over chat: one message, every device in a place.
//
// # The rules this path holds, and why each one is here
//
// This is the only chat surface where one message moves more than one thing, so
// every limit below is doing real work rather than being cautious for its own
// sake.
//
//  1. An EXPLICIT QUANTIFIER is required, and that check lives in
//     channels.ResolveZone rather than here. Without it every ambiguity the
//     device picker answers today would silently become an N-device actuation.
//
//  2. T1 ONLY, with NO CONFIRMATION ROUTE. A confirmation proves intent for the
//     thing it names, and ConfirmationPrompt names ONE device. Accepting a
//     confirmation as cover for a fan-out would be treating agreement about a
//     lamp as agreement about four. This is the same argument that keeps
//     quantity verbs off the confirmation route in chatactuate.go, and it is
//     stronger here: there, the unnamed part was a number; here it is devices.
//
//  3. ARGLESS VERBS ONLY. `set` across a zone is not obviously wrong, but it
//     multiplies the two things that are already hardest to get right — a
//     parsed quantity and a widened blast radius — and the reply would have to
//     carry a count and a value and a per-device outcome. Narrowed on purpose,
//     and narrow is a decision that can be widened later with evidence; it is
//     not a claim that the thing is impossible.
//
//  4. ALL-OR-NOTHING BEFORE ANYTHING IS SENT. Every member is resolved and
//     tier-checked first, and one failure refuses the whole command. This
//     matches the automations engine, which refuses a zone action outright when
//     any member cannot resolve, and it matters because the alternative — send
//     what works, skip what does not — means the member's mental model of the
//     zone quietly diverges from the hub's.
//
//  5. ONE COOLDOWN FOR THE ZONE, not one per device. A per-device cooldown
//     would let a member re-send a zone command immediately as long as the
//     membership shifted by one, and the thing being rate-limited is the
//     command, not the devices.
//
// What is NOT guaranteed is all-or-nothing at EXECUTION. Once commands are
// going out there is no rollback; a device that fails after two have already
// changed cannot un-change them. That case is reported as a partial with both
// numbers rather than being flattened into success or failure, because both of
// those would be false in the direction the member most needs to be right
// about.
func (s *Server) chatActuateZone(
	ctx contextT,
	body, profileID, source string,
	v devices.Verb,
	fleet []devices.IndexedDevice,
) (chatActuationResult, bool) {
	reg := s.registry()
	if reg == nil {
		return chatActuationResult{}, false
	}

	zm := channels.ResolveZone(body, v, fleet)
	if zm.Ambiguous() {
		return chatActuationResult{Reply: channels.ZoneAmbiguous(v, zm.Candidates)}, true
	}
	if !zm.Unique() {
		// Not a zone command. Falls through so the caller's existing device
		// refusal — which already words both "ambiguous" and "nothing named" —
		// is the one message the member sees.
		return chatActuationResult{}, false
	}

	n := len(zm.Members)

	// Rule 3, before any resolution: a verb that takes an argument does not fan
	// out. Asked of the DEVICE rather than assumed from the verb, because
	// whether a verb carries an argument is a property the catalogue declares
	// per device.
	for _, d := range zm.Members {
		spec, _, ok := d.Device.Supports(v)
		if ok && spec.Arg != "" {
			return chatActuationResult{
				Reply: channels.ZoneActuationRefused(zm.Zone, v, n,
					"that verb takes a value, and I only send it to one device at a time from chat"),
			}, true
		}
	}

	// Rule 4. Resolve and tier-check EVERY member before sending anything.
	plans := make([]devices.Plan, 0, n)
	for _, d := range zm.Members {
		plan, err := reg.Resolve(d.Key, v, nil)
		if err != nil {
			return chatActuationResult{
				Reply: channels.ZoneActuationRefused(zm.Zone, v, n,
					d.Device.Name+" would not accept it, so I sent nothing"),
			}, true
		}
		if plan.Tier > chatTierCeiling {
			// Rule 2. No confirmedOrPrompt branch: a confirmation naming one
			// device cannot authorise a fan-out.
			return chatActuationResult{
				Reply: channels.ZoneActuationRefused(zm.Zone, v, n,
					d.Device.Name+" is a "+plan.Tier.String()+
						" command and chat only fans out reversible ones, so I sent nothing"),
			}, true
		}
		plans = append(plans, plan)
	}

	// Rule 5, and LAST among the checks so a refused attempt never restarts
	// anyone's cooldown — the same ordering chatActuate and openpath.go use.
	subject := chatZoneCooldownSubject(profileID, zm.Zone, v)
	claimed, err := s.store.ClaimActuationCooldown(ctx, subject, time.Now().Unix(), chatActuationCooldownS)
	if err != nil {
		// Fail CLOSED, matching chatActuate. A fan-out is the last place to
		// take the open path's fail-open bargain.
		s.log.Error("chat zone actuation cooldown", "err", err)
		return chatActuationResult{
			Reply: channels.ZoneActuationRefused(zm.Zone, v, n,
				"I couldn't check the rate limit, so I sent nothing"),
		}, true
	}
	if !claimed {
		return chatActuationResult{
			Reply: channels.ZoneActuationRefused(zm.Zone, v, n,
				"that was only just sent — give it a moment"),
		}, true
	}

	// Everything below this line has already passed every check. From here the
	// only question is what the devices did.
	accountID := s.soleAccountFor(ctx, profileID)
	var failed []string
	done := 0
	for i, plan := range plans {
		execErr := reg.ExecutePlan(ctx, plan)

		// §3.8: every attempt at every tier goes in access_logs, one row per
		// DEVICE. A single row naming the zone would lose which device took the
		// command, which is the question the log exists to answer.
		if err := s.store.LogDeviceCommand(ctx, store.DeviceCommandLog{
			DeviceKey: zm.Members[i].Key,
			AccountID: accountID,
			UserID:    profileID,
			Command:   string(v),
			Source:    source,
			Success:   execErr == nil,
			Err:       errText(execErr),
		}); err != nil {
			s.log.Error("log device command", "err", err)
		}

		if execErr != nil {
			failed = append(failed, zm.Members[i].Device.Name)
			continue
		}
		done++
	}

	if len(failed) == n {
		return chatActuationResult{
			Reply: channels.ZoneActuationRefused(zm.Zone, v, n, "none of them accepted it"),
		}, true
	}
	if len(failed) > 0 {
		return chatActuationResult{
			Reply: channels.ZoneActuationPartial(zm.Zone, v, done, failed),
			// Actuated: something DID move. Reporting false because part of it
			// failed would make the flag mean "everything worked", and the
			// callers that will eventually branch on it need to know a device
			// changed state.
			Actuated: true,
		}, true
	}
	return chatActuationResult{
		Reply:    channels.ZoneActuationDone(zm.Zone, v, done),
		Actuated: true,
	}, true
}

// chatZoneCooldownSubject keys the cooldown per (subject, zone, verb).
//
// A distinct prefix from chatCooldownSubject, which keys per device: the two
// share a table, and a zone command must not consume the cooldown of a device
// that happens to be in it, nor be blocked by one. They are different
// commands with different blast radii and they rate-limit separately.
func chatZoneCooldownSubject(profileID, zone string, v devices.Verb) string {
	return "chat-zone:" + profileID + ":" + zone + ":" + string(v)
}
