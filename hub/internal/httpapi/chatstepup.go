package httpapi

import (
	"time"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
)

// T4 over chat: the request half. The approval half is stepupapi.go.
//
// # What happens, in order
//
// A T4 verb — mower `start`, `resume` on a blade job — reaching chat does NOT
// actuate. Four things must all hold, and §3.3 lists them as independent
// requirements rather than alternatives, so each is checked on its own:
//
//  1. The sender holds an operator role. Not "is a linked member": T4 is the
//     one tier where the ordinary member gate is not enough.
//  2. An operator has ARMED a window for this exact (device, verb) — 0033. This
//     is READ here, never spent: asking must not cost a use, or a member could
//     exhaust a window by asking repeatedly and never approving.
//  3. The member holds a confirmation for this intent — the existing
//     chat_confirmations machinery, unchanged.
//  4. Step-up on a SECOND RAIL. That is what this file adds: an intent is
//     recorded and the reply says to approve it in the console.
//
// # Why the console and not a code in the thread
//
// The console's TOTP is a second FACTOR, not a second RAIL. A code typed into
// the same chat thread travels the same path as the command, so whoever
// controls the chat account controls both halves — and the requirement exists
// precisely because compromising the chat account alone must not be enough.
//
// An approval that must happen in an authenticated console session is a
// different path with a different credential. Someone holding the member's
// WhatsApp can ask. They cannot approve.
//
// # What this deliberately does not do
//
// It does not tell the chat rail when the command finally runs. The approval
// happens in the console and its result is shown there. Sending an unsolicited
// message back down a rail the member may share with a household is a
// disclosure decision (§4) that has not been made, and inventing one here to
// round off the flow would be making it silently.

// chatStepUpTTLS is how long an intent stays approvable.
//
// Ten minutes. An intent is a thing a person is standing next to — they asked,
// they are walking to a laptop. One still approvable an hour later is a stored
// permission, which is what the operator-armed window already is and what this
// deliberately is not.
const chatStepUpTTLS = 10 * 60

// chatT4Verbs is the closed set of T4 verbs chat will take a request for.
//
// Separate from chatSendableVerbs on purpose. That map answers "may chat SEND
// this", and the answer for these is still no — nothing here ever calls
// ExecutePlan. This map answers "may chat RECORD a request for this", which is
// a different question with a different consequence.
//
// `start` and `resume` only: they are the argless T4 verbs the catalogue
// carries. A T4 verb taking a value would need the number echoed in the
// approval and re-checked at execution, and that is not built.
var chatT4Verbs = map[devices.Verb]bool{
	devices.VerbStart:  true,
	devices.VerbResume: true,
}

// chatRequestT4 handles a T4 verb arriving over chat.
//
// handled is false when this is not a T4 request at all, so the caller falls
// through to its existing behaviour.
func (s *Server) chatRequestT4(
	ctx contextT, body, profileID, source, chatID, confirmToken string,
	v devices.Verb, fleet []devices.IndexedDevice,
) (chatActuationResult, bool) {
	if !chatT4Verbs[v] {
		return chatActuationResult{}, false
	}
	reg := s.registry()
	if reg == nil {
		return chatActuationResult{}, false
	}

	m := channels.ResolveDevice(body, v, fleet)
	if !m.Unique() {
		// Nothing resolved. Falls through so the caller's existing refusal —
		// which words both "ambiguous" and "nothing named" — is the one message
		// a member sees. No zone fan-out here either: chatzone.go is T1 only,
		// and a fan-out of hazardous motion is not a thing this product does.
		return chatActuationResult{}, false
	}
	name := m.Device.Device.Name

	// The registry stays the authority on tier. If the verb is NOT T4 on this
	// device, this is not our path — a `resume` on a plain job robot is T2 and
	// belongs to the ordinary confirmation route.
	plan, err := reg.Resolve(m.Device.Key, v, nil)
	if err != nil {
		return chatActuationResult{
			Reply: channels.ActuationRefused(name, v, "that device would not accept it"),
		}, true
	}
	if plan.Tier < devices.TierHazardousMotion {
		return chatActuationResult{}, false
	}

	accountID := s.soleAccountFor(ctx, profileID)
	if accountID == "" {
		return chatActuationResult{
			Reply: channels.ActuationRefused(name, v, "I could not tell which account that belongs to"),
		}, true
	}

	// (1) The operator role. Checked BEFORE the window is looked up, so a member
	// without the role learns nothing about what an operator has armed.
	role, err := s.store.MemberRole(ctx, accountID, profileID)
	if err != nil || !isAdminRole(role) {
		if err != nil {
			s.log.Error("role for t4 chat request", "err", err)
		}
		return chatActuationResult{
			Reply: channels.T4NotAnOperator(name, v, s.channelPublicURL()),
		}, true
	}

	// (2) The window. READ, not spent.
	nowUnix := time.Now().Unix()
	live, err := s.store.AnyLiveT4Window(ctx, accountID, m.Device.Key, string(v), nowUnix)
	if err != nil {
		s.log.Error("t4 window lookup", "err", err)
		return chatActuationResult{
			Reply: channels.ActuationRefused(name, v, "I could not check whether that is armed, so I did nothing"),
		}, true
	}
	if !live {
		return chatActuationResult{
			Reply: channels.T4NoWindow(name, v, s.channelPublicURL()),
		}, true
	}

	// (3) The confirmation, on the chat rail, using the machinery that already
	// exists. Unchanged and not folded into the approval below: §3.3 asks for
	// both, and one act standing for two decisions is how a requirement quietly
	// stops being one.
	// confirmationHeld, not confirmedOrPrompt: that function's ceiling is T2 and
	// would refuse this verb before minting anything. The exchange is the same
	// one — same tokens, same mismatch rule, same daily counter — and the tier
	// judgement stays where it belongs, which for T4 is the four checks in this
	// function rather than a single ceiling.
	if res, ok := s.confirmationHeld(ctx, m, v, profileID, source, chatID, confirmToken); !ok {
		return res, true
	}

	// (4) The second rail. Record the intent; actuate nothing.
	if _, err := s.store.CreateStepUpIntent(ctx, store.StepUpIntentArgs{
		AccountID:         accountID,
		RequestedByUserID: profileID,
		Source:            source,
		ChatID:            chatID,
		DeviceKey:         m.Device.Key,
		Verb:              string(v),
		CreatedAt:         nowUnix,
		ExpiresAt:         nowUnix + chatStepUpTTLS,
	}); err != nil {
		s.log.Error("create step-up intent", "err", err)
		return chatActuationResult{
			Reply: channels.ActuationRefused(name, v, "I could not record the request, so I did nothing"),
		}, true
	}

	// Logged as a REQUEST, never as the verb. A line reading `start` against a
	// mower that has not moved is the worst kind of entry to find later.
	if err := s.store.LogDeviceCommand(ctx, store.DeviceCommandLog{
		DeviceKey: m.Device.Key,
		AccountID: accountID,
		UserID:    profileID,
		Command:   "t4-request:" + string(v),
		Source:    source,
		Success:   true,
	}); err != nil {
		s.log.Error("log t4 request", "err", err)
	}

	return chatActuationResult{
		Reply: channels.T4AwaitingApproval(name, v, chatStepUpTTLS/60, s.channelPublicURL()),
		// Actuated stays FALSE. Nothing moved. A rail branching on this must not
		// be told that something did because a record was written.
		Actuated: false,
	}, true
}
