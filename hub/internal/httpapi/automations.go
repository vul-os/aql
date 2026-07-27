package httpapi

// Automation-rule management.
//
// # Why this file exists
//
// internal/automations has been complete for a while: rule object, schedule
// arithmetic across DST, an execution engine with a tier ceiling, a failure
// breaker, and an audit trail. It ran as a background scheduler and no rule
// could be created, because nothing served it over HTTP. This is the third
// instance of that shape found in a row — see internal/httpapi/energy.go and
// cmd/hub/devicewiring_test.go for the other two.
//
// # This layer decides almost nothing
//
// Read internal/automations/automations.go before changing anything here. Every
// safety property — the MaxActionTier ceiling, the cooldown, the breaker that
// disables a rule after repeated failure, the refusal to save a rule whose
// action resolves above the ceiling — lives in the engine, where the scheduler
// enforces it too. Duplicating any of it here would create a second copy that
// can drift, and the copy the console talks to is the one that would rot.
//
// So these handlers do three things: check the caller's role, translate JSON
// into a Rule, and map the engine's refusal reason onto a status code. When a
// rule is refused, the reason string comes from automations.RefusalReason and
// is passed through verbatim rather than re-worded — the engine's vocabulary is
// the API's vocabulary, and inventing a parallel one here is how the console
// ends up explaining a refusal it does not actually understand.
//
// # Admin-only, all of it, including reads
//
// Writes, obviously: a rule actuates hardware with nobody watching.
//
// Reads too, which differs from the energy surface and is worth the sentence.
// A rule is a statement about what the household's hardware does unattended,
// and the run history says when it did it. That is closer to the audit trail
// than to a meter reading, and the audit trail is admin-only. A member who
// wants to know why the lights came on can ask an admin; a member who can
// enumerate every rule and its cooldown knows exactly when the house is not
// being watched.
//
// # What is deliberately NOT here
//
// No endpoint that raises MaxActionTier, per-rule or otherwise. The ceiling is
// a compile-time constant precisely so that no request can move it, and an
// override endpoint would make "unattended actuation is bounded" a claim about
// configuration rather than about the code.

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/vul-os/aql/hub/internal/automations"
)

// runsLimitDefault and runsLimitMax bound the history a caller can pull in one
// request. History is unbounded and grows on a schedule.
const (
	runsLimitDefault = 50
	runsLimitMax     = 500
)

type ruleReq struct {
	Name        string                  `json:"name"`
	Enabled     bool                    `json:"enabled"`
	Trigger     automations.Trigger     `json:"trigger"`
	Conditions  []automations.Condition `json:"conditions"`
	Action      automations.Action      `json:"action"`
	MinInterval int64                   `json:"min_interval_seconds"`
}

func ruleJSON(r automations.Rule) map[string]any {
	m := map[string]any{
		"id":                   r.ID,
		"name":                 r.Name,
		"enabled":              r.Enabled,
		"trigger":              r.Trigger,
		"conditions":           r.Conditions,
		"action":               r.Action,
		"min_interval_seconds": r.MinIntervalS,
		"created_at":           r.CreatedAt,
		"updated_at":           r.UpdatedAt,

		// The resolved tier of the action, and the ceiling it was checked
		// against. Both are emitted because one without the other is not
		// interpretable: "tier: consequential" means nothing to a console that
		// does not know where the line is, and hard-coding the line in the
		// frontend is how the two drift apart.
		"action_tier":     r.ActionTier.String(),
		"max_action_tier": automations.MaxActionTier.String(),

		// Who wrote it, and who they were at the time. The snapshot survives
		// the user being renamed or removed, which is the case where an
		// automation's provenance matters most.
		"created_by":          r.CreatedBy,
		"created_by_snapshot": r.CreatedBySnapshot,
	}

	// Execution state. Present always, including the zero values: a rule that
	// has never fired and a rule whose history was not loaded look identical
	// to a caller otherwise.
	m["last_outcome"] = string(r.LastOutcome)
	m["last_fired_at"] = r.LastFiredAt
	m["last_occurrence_at"] = r.LastOccurrenceAt
	m["consecutive_failures"] = r.ConsecutiveFailures

	// Only when the breaker actually tripped, and then always with the reason.
	// A rule that went quiet without one leaves an admin nothing to act on —
	// the same argument webhooks.go makes for a disabled endpoint.
	if r.DisabledAt != 0 {
		m["disabled_at"] = r.DisabledAt
		m["disabled_reason"] = r.DisabledReason
	}
	return m
}

func runJSON(run automations.Run) map[string]any {
	return map[string]any{
		"id":            run.ID,
		"rule_id":       run.RuleID,
		"rule_name":     run.RuleName,
		"cause":         string(run.Cause),
		"occurrence_at": run.OccurrenceAt,
		"outcome":       string(run.Outcome),
		"reason":        run.Reason,
		"device_key":    run.DeviceKey,
		"verb":          string(run.Verb),
		"tier":          run.Tier.String(),
		"target_count":  run.TargetCount,
		"started_at":    run.StartedAt,
		"finished_at":   run.FinishedAt,

		// Whether the run made it into the access audit trail. A caller
		// comparing this view against the audit log needs to know which rows
		// to expect to find there; silently omitting it would make an
		// unaudited run look like a missing audit entry.
		"audited": run.Audited,
	}
}

// automationsEngine resolves the engine, or answers 503 when this hub has none.
//
// Not 404, for the reason energy.go gives: "not found" sends a caller hunting
// for a typo in their URL, "unavailable" sends them to their configuration.
func (s *Server) automationsEngine(w http.ResponseWriter) (*automations.Engine, bool) {
	if s.automations == nil {
		writeErr(w, http.StatusServiceUnavailable, "automations_not_configured")
		return nil, false
	}
	return s.automations, true
}

// requireAutomationsAdmin bundles the two checks every handler here starts
// with, so a new handler cannot be written that forgets one.
func (s *Server) requireAutomationsAdmin(w http.ResponseWriter, r *http.Request) (
	*automations.Engine, string, bool) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return nil, "", false
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return nil, "", false
	}
	eng, ok := s.automationsEngine(w)
	if !ok {
		return nil, "", false
	}
	return eng, accountID, true
}

func (s *Server) handleAutomationsList(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	rules, err := eng.Store().ListRules(r.Context(), accountID)
	if err != nil {
		s.log.Error("automation rules could not be read", "account", accountID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(rules))
	for _, rule := range rules {
		out = append(out, ruleJSON(rule))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rules": out,
		// Emitted on the collection too, so a console can render the ceiling
		// in a rule EDITOR — before any rule exists to carry it.
		"max_action_tier": automations.MaxActionTier.String(),

		// Whether anything will actually fire these. Rules can be written with
		// the scheduler off, which is useful when setting a hub up and
		// dangerous to leave unsaid: a list of rules that quietly never run
		// looks identical to a list of rules that work.
		"scheduler_running": s.cfg.AutomationsScheduler,
	})
}

func (s *Server) handleAutomationGet(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	rule, err := eng.Store().RuleByID(r.Context(), accountID, r.PathValue("ruleID"))
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, ruleJSON(rule))
}

func (s *Server) handleAutomationCreate(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	var req ruleReq
	if !readJSON(w, r, &req) {
		return
	}
	rule, err := eng.SaveRule(r.Context(), automations.Rule{
		AccountID:    accountID,
		Name:         strings.TrimSpace(req.Name),
		Enabled:      req.Enabled,
		CreatedBy:    claimsFrom(r).Sub,
		Trigger:      req.Trigger,
		Conditions:   req.Conditions,
		Action:       req.Action,
		MinIntervalS: req.MinInterval,
	})
	if err != nil {
		writeRuleErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ruleJSON(rule))
}

func (s *Server) handleAutomationUpdate(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	ruleID := r.PathValue("ruleID")
	// Confirm it exists and belongs to this account BEFORE the engine sees it.
	// SaveRule with a non-empty ID would otherwise surface a bare sql.ErrNoRows
	// as a 500, and a missing rule is a 404.
	if _, err := eng.Store().RuleByID(r.Context(), accountID, ruleID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	var req ruleReq
	if !readJSON(w, r, &req) {
		return
	}
	// A full replace, not a patch. A rule is a small object read as a whole,
	// and a partial update of a trigger or an action is how you end up with a
	// coherent-looking rule nobody meant to write — a new threshold against
	// the previous device key, for instance.
	rule, err := eng.SaveRule(r.Context(), automations.Rule{
		ID:           ruleID,
		AccountID:    accountID,
		Name:         strings.TrimSpace(req.Name),
		Enabled:      req.Enabled,
		CreatedBy:    claimsFrom(r).Sub,
		Trigger:      req.Trigger,
		Conditions:   req.Conditions,
		Action:       req.Action,
		MinIntervalS: req.MinInterval,
	})
	if err != nil {
		writeRuleErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ruleJSON(rule))
}

type enabledReq struct {
	Enabled *bool `json:"enabled"`
}

// handleAutomationSetEnabled is separate from update on purpose. Turning a
// tripped rule back on is the one event that clears the failure breaker, so it
// is a distinct act with its own audit entry — not a side effect of an edit
// that happened to leave `enabled` true.
func (s *Server) handleAutomationSetEnabled(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	var req enabledReq
	if !readJSON(w, r, &req) {
		return
	}
	if req.Enabled == nil {
		// A pointer, so that a missing field is refused rather than silently
		// meaning "disable" — which is what a bool zero value would do.
		writeErr(w, http.StatusBadRequest, "enabled_required")
		return
	}
	rule, err := eng.SetEnabled(r.Context(), accountID, r.PathValue("ruleID"),
		claimsFrom(r).Sub, *req.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeRuleErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ruleJSON(rule))
}

func (s *Server) handleAutomationDelete(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	err := eng.DeleteRule(r.Context(), accountID, r.PathValue("ruleID"), claimsFrom(r).Sub)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAutomationRunNow fires a rule immediately.
//
// This is safe for the same reason the scheduler is: RunNow goes through Fire,
// which re-resolves the action and re-checks it against MaxActionTier. It
// cannot reach a verb the scheduler could not, so "test my rule" does not
// become a way to actuate something unattended actuation is not allowed to
// touch. Every access verb in the catalogue sits above the ceiling, so this
// can never open a gate.
//
// It is still a real actuation and it is still audited, so it is admin-only
// like everything else here.
func (s *Server) handleAutomationRunNow(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	run, err := eng.RunNow(r.Context(), accountID, r.PathValue("ruleID"))
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	// A REFUSAL is not an HTTP error. Fire returns a Refusal alongside a fully
	// populated Run for a rule that was correctly declined — cooldown, unmet
	// condition, tier ceiling — and that is the system working. The Run's
	// outcome and reason say what happened. Only a persistence failure, where
	// there is no trustworthy Run to report, becomes a status code.
	if err != nil && !automations.IsRefusal(err) {
		writeRuleErr(w, err)
		return
	}
	// 200 with the run, not 202: Fire is synchronous and the outcome is
	// already known. A refused run — cooldown, unmet condition — is a
	// successful REQUEST that produced a refusal, and the outcome field says
	// which. Turning that into an HTTP error would conflate "the hub would not
	// do it" with "the hub could not be asked".
	writeJSON(w, http.StatusOK, runJSON(run))
}

func (s *Server) handleAutomationRuns(w http.ResponseWriter, r *http.Request) {
	eng, accountID, ok := s.requireAutomationsAdmin(w, r)
	if !ok {
		return
	}
	limit := runsLimitDefault
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = min(n, runsLimitMax)
	}
	// An empty ruleID means "every rule in the account", which is what the
	// store's own query already means — the activity feed, not one rule's
	// history.
	runs, err := eng.Store().ListRuns(r.Context(), accountID, r.PathValue("ruleID"), limit)
	if err != nil {
		s.log.Error("automation runs could not be read", "account", accountID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(runs))
	for _, run := range runs {
		out = append(out, runJSON(run))
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": out, "limit": limit})
}

// writeRuleErr maps an engine refusal onto a status code.
//
// The reason string is the engine's, passed through verbatim. This layer does
// not invent a vocabulary: automations.RefusalReason already names every way a
// rule can be refused, the scheduler logs the same names, and a console that
// learns them once can explain a refusal from either source.
func writeRuleErr(w http.ResponseWriter, err error) {
	reason := automations.RefusalReason(err)
	status := http.StatusBadRequest
	switch reason {
	case automations.ReasonDriverError, automations.ReasonIndeterminate,
		automations.ReasonAuditUnavailable:
		// Not the caller's fault: the rule was well-formed and something
		// downstream would not answer.
		status = http.StatusBadGateway
	case "":
		// RefusalReason did not recognise it, so it is not a refusal at all —
		// a store failure, most likely. Do not guess a 400: telling a caller
		// their input was wrong when it was not sends them to fix the one
		// thing that is fine.
		writeErrDetail(w, http.StatusInternalServerError, "internal", nil)
		return
	}
	writeErrDetail(w, status, reason, map[string]any{
		// The engine's own message. It names the device key or the verb that
		// could not be resolved, which is the difference between a rule an
		// admin can fix and one they can only delete.
		"detail": err.Error(),
	})
}
