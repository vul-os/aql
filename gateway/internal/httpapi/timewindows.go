package httpapi

// Time-window rule management — the operator surface for "this member may only
// open on weekday mornings" (enforcement lives in internal/store/timewindows.go
// and runs inside the LogAccess choke point).
//
// WRITES ARE ADMIN-ONLY. A rule decides when a person can get through a door;
// that is account policy, and it uses the same isAdminRole gate as the rest of
// the account surface rather than inventing a second notion of privilege.
//
// READS ARE NOT, QUITE. An admin sees every rule in the account; an ordinary
// member sees only the rules that name THEM. Being refused at 3am with no way
// to find out why is how a working safety feature gets remembered as a broken
// gate, and a member reading their own schedule learns nothing about anyone
// else's.
//
// NOTE ON THE LOCKOUT ESCAPE HATCH: this API is never window-restricted, only
// the gate is. An owner who writes themselves a rule and then needs in at an
// hour it forbids deletes the rule (see store.DeleteTimeWindowRule).

import (
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/gateway/internal/store"
)

type timeWindowCreateReq struct {
	UserID        string             `json:"user_id"`
	AccessPointID string             `json:"access_point_id"`
	LocationID    string             `json:"location_id"`
	TZ            string             `json:"tz"`
	Windows       []store.TimeWindow `json:"windows"`
	Note          string             `json:"note"`
}

func timeWindowRuleJSON(r store.TimeWindowRule) map[string]any {
	ws := make([]map[string]any, 0, len(r.Windows))
	for _, w := range r.Windows {
		ws = append(ws, map[string]any{"days": w.Days, "from": w.From, "to": w.To})
	}
	return map[string]any{
		"id":              r.ID,
		"user_id":         r.UserID,
		"access_point_id": nilIfEmpty(r.AccessPointID),
		"location_id":     nilIfEmpty(r.LocationID),
		"tz":              r.TZ,
		"windows":         ws,
		"note":            r.Note,
		"created_at":      r.CreatedAt,
	}
}

// GET /v1/accounts/{id}/time-windows
func (s *Server) handleTimeWindowsList(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	// Non-admins are narrowed to their own rules in the QUERY, not filtered
	// after the fact: there is no moment at which another member's rule is in
	// this handler's hands.
	scopeUser := ""
	if !isAdminRole(role) {
		scopeUser = claimsFrom(r).Sub
	}
	rules, err := s.store.TimeWindowRulesForAccount(r.Context(), accountID, scopeUser)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(rules))
	for _, rule := range rules {
		out = append(out, timeWindowRuleJSON(rule))
	}
	writeJSON(w, http.StatusOK, map[string]any{"time_windows": out})
}

// POST /v1/accounts/{id}/time-windows
func (s *Server) handleTimeWindowCreate(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	var req timeWindowCreateReq
	if !readJSON(w, r, &req) {
		return
	}
	rule, err := s.store.CreateTimeWindowRule(r.Context(), accountID, store.CreateTimeWindowRuleArgs{
		UserID:          req.UserID,
		AccessPointID:   req.AccessPointID,
		LocationID:      req.LocationID,
		TZ:              strings.TrimSpace(req.TZ),
		Windows:         req.Windows,
		Note:            req.Note,
		CreatedByUserID: claimsFrom(r).Sub,
	})
	switch {
	case errors.Is(err, store.ErrInvalidTimeWindowRule):
		// The refusal names the specific problem — an unknown zone, a window
		// that never occurs — because "invalid" alone leaves an operator
		// guessing, and guessing at an access rule is how someone gets locked
		// out. The detail describes only what the caller just sent.
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid_time_window", "detail": strings.TrimPrefix(err.Error(), "invalid time window rule: "),
		})
		return
	case errors.Is(err, store.ErrTimeWindowRuleExists):
		writeErr(w, http.StatusConflict, "time_window_rule_exists")
		return
	case errors.Is(err, store.ErrNotFound):
		// Unknown member, unknown door, or one belonging to another account —
		// all indistinguishable, per the tenancy contract.
		writeErr(w, http.StatusNotFound, "not_found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// Audit: restricting when someone may enter is exactly the class of admin
	// action WriteAdminAudit exists for, and the same one grant issuance uses.
	// Best-effort per its contract — never blocks the write.
	if err := s.store.WriteAdminAudit(r.Context(), claimsFrom(r).Sub, "time_window_create", "time_window_rule", rule.ID, true,
		map[string]any{
			"account_id":      accountID,
			"user_id":         rule.UserID,
			"access_point_id": rule.AccessPointID,
			"location_id":     rule.LocationID,
			"tz":              rule.TZ,
			"windows":         rule.Windows,
		}); err != nil {
		s.log.Error("time window create audit write failed", "rule_id", rule.ID, "err", err)
	}
	writeJSON(w, http.StatusCreated, timeWindowRuleJSON(*rule))
}

// DELETE /v1/accounts/{id}/time-windows/{ruleID}
func (s *Server) handleTimeWindowDelete(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	ruleID := r.PathValue("ruleID")
	// Read first, so the audit row can say WHOSE restriction was lifted.
	// Removing a rule widens access; that must leave the same durable trace
	// creating it did.
	rule, err := s.store.TimeWindowRuleByID(r.Context(), accountID, ruleID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.DeleteTimeWindowRule(r.Context(), accountID, ruleID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), claimsFrom(r).Sub, "time_window_delete", "time_window_rule", ruleID, true,
		map[string]any{
			"account_id":      accountID,
			"user_id":         rule.UserID,
			"access_point_id": rule.AccessPointID,
			"location_id":     rule.LocationID,
		}); err != nil {
		s.log.Error("time window delete audit write failed", "rule_id", ruleID, "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}
