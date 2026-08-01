package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
)

// The approval half of T4 step-up — the console rail. The request half is
// chatstepup.go.
//
// # This is the only place in the product where a T4 verb actuates from chat
//
// Everything the chat rail did was record a request. The device moves here, in
// an authenticated console session, and only after four things have all held:
// the role (checked when the request was made AND again here), a live
// operator-armed window, a chat-side confirmation, and this approval.
//
// # Ordering, which is the part that has to be right
//
// The claim commits BEFORE the device is touched. If the status change and the
// actuation shared one transaction, a hub that died mid-command would roll back
// to `pending` and the same command could be approved again — after it had
// already gone out. So the order is: claim (atomic, single-winner), spend a
// window use, execute, record the outcome. A crash between any two of those
// leaves an intent marked approved with no outcome, which reads as "we do not
// know", and that is the honest state to be left in.
//
// The window is spent AFTER the claim and BEFORE execution, and refunded if the
// device refuses. Spending it at request time would let a member exhaust an
// operator's window by asking repeatedly and never approving.

type stepUpDecisionReq struct {
	// Approve is explicit rather than inferred from the route, so a client
	// cannot turn a rejection into an approval by dropping a path segment.
	Approve bool `json:"approve"`
}

func stepUpIntentJSON(i store.StepUpIntent, nowUnix int64) map[string]any {
	out := map[string]any{
		"id":           i.ID,
		"requested_by": i.RequestedByUserID,
		"source":       i.Source,
		"device_key":   i.DeviceKey,
		"verb":         i.Verb,
		"created_at":   i.CreatedAt,
		"expires_at":   i.ExpiresAt,
		// DERIVED, never the stored column: an intent past its expiry still says
		// `pending` on disk, and a console reading the column would offer an
		// approve button for something that can no longer be approved.
		"status":  i.EffectiveStatus(nowUnix),
		"outcome": i.Outcome,
	}
	if i.OutcomeDetail != "" {
		out["outcome_detail"] = i.OutcomeDetail
	}
	if i.DecidedByUserID.Valid {
		out["decided_by"] = i.DecidedByUserID.String
	}
	return out
}

// GET /v1/accounts/{id}/stepup-intents
//
// Admin-only, like the windows list: it shows which hazardous commands have been
// asked for and by whom, which is not something to hand every linked member.
func (s *Server) handleStepUpIntentsList(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	intents, err := s.store.StepUpIntentsByAccount(r.Context(), accountID, 50)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	nowUnix := time.Now().Unix()
	out := make([]map[string]any, 0, len(intents))
	for _, i := range intents {
		out = append(out, stepUpIntentJSON(i, nowUnix))
	}
	writeJSON(w, http.StatusOK, map[string]any{"stepup_intents": out})
}

// POST /v1/accounts/{id}/stepup-intents/{intentID}/decide
func (s *Server) handleStepUpIntentDecide(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	// The role is re-checked HERE and not taken on trust from the moment the
	// request was made. A member whose operator role was removed in between must
	// not be able to approve, and the earlier check cannot know that.
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	intentID := r.PathValue("intentID")

	var req stepUpDecisionReq
	if !readJSON(w, r, &req) {
		return
	}

	// Read first only to tell "no such intent" from "already decided". The
	// claim below is still conditional in its own WHERE, so this read is not
	// load-bearing and two approvals racing here both get a correct answer.
	if _, err := s.store.StepUpIntentByID(r.Context(), accountID, intentID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	nowUnix := time.Now().Unix()
	approverID := claimsFrom(r).Sub

	if !req.Approve {
		rejected, err := s.store.RejectStepUpIntent(r.Context(), accountID, intentID, approverID, nowUnix)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		if !rejected {
			writeErr(w, http.StatusConflict, "already_decided")
			return
		}
		s.writeIntent(w, r, accountID, intentID)
		return
	}

	// THE atomic step. Exactly one caller is ever handed the intent, so two
	// console tabs pressing approve produce one actuation and one conflict.
	claimed, err := s.store.ClaimStepUpIntent(r.Context(), accountID, intentID, approverID, nowUnix)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if claimed == nil {
		// Already decided, or expired. One answer for both: the console reads
		// the fresh row to see which, and a distinct code for "expired" would
		// tell a caller who lost the race something about timing they did not
		// need to know.
		writeErr(w, http.StatusConflict, "not_approvable")
		return
	}

	s.executeApprovedIntent(r, accountID, claimed, nowUnix)
	s.writeIntent(w, r, accountID, intentID)
}

// executeApprovedIntent spends a window use and drives the device.
//
// Every failure path records an OUTCOME rather than returning an error to the
// caller. The intent has already been approved and that fact is committed; the
// question the console asks next is "what happened", and an HTTP error would
// leave an approved intent with no answer in it.
func (s *Server) executeApprovedIntent(r *http.Request, accountID string, intent *store.StepUpIntent, nowUnix int64) {
	ctx := r.Context()
	record := func(outcome, detail, windowID string) {
		if err := s.store.RecordStepUpOutcome(ctx, accountID, intent.ID, windowID, outcome, detail); err != nil {
			s.log.Error("record step-up outcome", "err", err)
		}
	}

	reg := s.registry()
	if reg == nil {
		record("refused", "the device engine was not available", "")
		return
	}

	// The window is re-checked by SPENDING it, not by asking again. Between the
	// chat request and this approval an operator may have disarmed it or it may
	// have expired, and a consume that finds nothing is exactly that answer.
	windowID, err := s.store.TryConsumeT4Window(ctx, accountID, intent.DeviceKey, intent.Verb, nowUnix)
	if err != nil {
		s.log.Error("consume t4 window", "err", err)
		record("refused", "I could not check the armed window, so I sent nothing", "")
		return
	}
	if windowID == "" {
		record("refused", "no armed window covers that any more", "")
		return
	}

	plan, err := reg.Resolve(intent.DeviceKey, devices.Verb(intent.Verb), nil)
	if err != nil {
		// Refund: the operator's window must not pay for a command that never
		// left the hub.
		if rerr := s.store.RefundT4WindowUse(ctx, windowID); rerr != nil {
			s.log.Error("refund t4 window", "err", rerr)
		}
		record("refused", "that device would not accept it", "")
		return
	}
	// The tier is re-derived from the registry at the moment of execution. A
	// catalogue reloaded since the request could have moved this verb, and
	// acting on the tier recorded earlier would be acting on a stale judgement.
	if plan.Tier < devices.TierHazardousMotion {
		if rerr := s.store.RefundT4WindowUse(ctx, windowID); rerr != nil {
			s.log.Error("refund t4 window", "err", rerr)
		}
		record("refused", "that verb is no longer a hazardous command on that device", "")
		return
	}

	execErr := reg.ExecutePlan(ctx, plan)

	if err := s.store.LogDeviceCommand(ctx, store.DeviceCommandLog{
		DeviceKey: intent.DeviceKey,
		AccountID: accountID,
		UserID:    claimsFrom(r).Sub,
		Command:   intent.Verb,
		// The rail that CARRIED the command, which is the console — the chat
		// message only asked. An audit reading `telegram` here would say a text
		// message drove a mower, which is the thing this whole design prevents.
		Source:  "console",
		Success: execErr == nil,
		Err:     errText(execErr),
	}); err != nil {
		s.log.Error("log t4 command", "err", err)
	}

	if execErr != nil {
		if rerr := s.store.RefundT4WindowUse(ctx, windowID); rerr != nil {
			s.log.Error("refund t4 window", "err", rerr)
		}
		record("failed", "the device did not accept it", windowID)
		return
	}
	record("sent", "", windowID)
}

func (s *Server) writeIntent(w http.ResponseWriter, r *http.Request, accountID, intentID string) {
	fresh, err := s.store.StepUpIntentByID(r.Context(), accountID, intentID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, stepUpIntentJSON(*fresh, time.Now().Unix()))
}
