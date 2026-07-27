package httpapi

// Geofence rule management — the operator surface for "this gate only opens
// when the requester is near it" (enforcement lives in
// internal/store/geofence.go and runs inside the LogAccess choke point).
//
// READ internal/store/geofence.go's package comment before extending anything
// here. The short version, because it governs every response below: the
// position a geofence is tested against comes from the client and nothing
// verifies it. This is a convenience and a mistake-preventer, NOT a security
// control, and no copy this API emits may imply otherwise.
//
// WRITES ARE ADMIN-ONLY. A fence decides whether a person gets through a door;
// that is account policy, and it uses the same isAdminRole gate as the rest of
// the account surface rather than inventing a second notion of privilege.
//
// READS ARE NOT. Every member of the account sees every rule, which is the
// opposite of the time-window surface — deliberately, because the thing being
// described is different. A time window is a statement about ONE PERSON and
// another member's schedule is none of your business. A fence is a property of
// the DOOR: it binds everybody identically, so there is nothing private in it,
// and a resident refused at the gate needs to be able to find out that a fence
// exists and how big it is. Being denied with no way to learn why is how a
// working safety feature gets remembered as a broken gate.
//
// NOTE ON THE LOCKOUT ESCAPE HATCH: this API is never geofence-restricted,
// only the gate is. A fence denies on evidence nobody can check, so being
// wrongly refused is ordinary rather than exceptional — an admin standing
// outside a gate their own rule will not open can delete the rule from
// anywhere (see store.DeleteGeofenceRule).

import (
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/hub/internal/store"
)

type geofenceCreateReq struct {
	AccessPointID string   `json:"access_point_id"`
	LocationID    string   `json:"location_id"`
	Lat           *float64 `json:"lat"`
	Long          *float64 `json:"long"`
	RadiusM       float64  `json:"radius_m"`
	SlackM        *float64 `json:"slack_m"`
	// OnMissingLocation: "deny" (default) or "allow" — what happens when an
	// open request carries no coordinates at all, which is EVERY chat-rail
	// open today. Omitting it means deny, and the create response echoes the
	// stored value back so an operator can see which they got rather than
	// assume.
	OnMissingLocation string `json:"on_missing_location"`
	Note              string `json:"note"`
}

func geofenceRuleJSON(r store.GeofenceRule) map[string]any {
	return map[string]any{
		"id":              r.ID,
		"access_point_id": nilIfEmpty(r.AccessPointID),
		"location_id":     nilIfEmpty(r.LocationID),
		"lat":             r.AnchorLat,
		"long":            r.AnchorLong,
		"radius_m":        r.RadiusM,
		// slack_m and the allowance are both returned because the number that
		// actually decides an open is their SUM, and an operator who only
		// sees radius_m will mis-tune the fence forever.
		"slack_m":             r.SlackM,
		"effective_radius_m":  r.AllowanceM(),
		"on_missing_location": r.OnMissingLocation,
		"note":                r.Note,
		"created_at":          r.CreatedAt,
	}
}

// GET /v1/accounts/{id}/geofences
func (s *Server) handleGeofencesList(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}
	rules, err := s.store.GeofenceRulesForAccount(r.Context(), accountID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(rules))
	for _, rule := range rules {
		out = append(out, geofenceRuleJSON(rule))
	}
	writeJSON(w, http.StatusOK, map[string]any{"geofences": out})
}

// POST /v1/accounts/{id}/geofences
func (s *Server) handleGeofenceCreate(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	var req geofenceCreateReq
	if !readJSON(w, r, &req) {
		return
	}
	rule, err := s.store.CreateGeofenceRule(r.Context(), accountID, store.CreateGeofenceRuleArgs{
		AccessPointID:     req.AccessPointID,
		LocationID:        req.LocationID,
		Lat:               req.Lat,
		Long:              req.Long,
		RadiusM:           req.RadiusM,
		SlackM:            req.SlackM,
		OnMissingLocation: strings.TrimSpace(req.OnMissingLocation),
		Note:              req.Note,
		CreatedByUserID:   claimsFrom(r).Sub,
	})
	switch {
	case errors.Is(err, store.ErrGeofenceAnchorRequired):
		// Its own code, not a generic 400: the fix is "drop a pin on the
		// location, or send lat/long", which is a different action from
		// correcting a number that was sent.
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "geofence_anchor_required", "detail": err.Error(),
		})
		return
	case errors.Is(err, store.ErrInvalidGeofenceRule):
		// The refusal names the specific problem, for the same reason the
		// time-window one does: an operator guessing at an access rule is how
		// somebody gets locked out. The detail describes only what the caller
		// just sent.
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid_geofence", "detail": strings.TrimPrefix(err.Error(), "invalid geofence rule: "),
		})
		return
	case errors.Is(err, store.ErrGeofenceRuleExists):
		writeErr(w, http.StatusConflict, "geofence_rule_exists")
		return
	case errors.Is(err, store.ErrNotFound):
		// Unknown door, unknown location, or one belonging to another
		// account — all indistinguishable, per the tenancy contract.
		writeErr(w, http.StatusNotFound, "not_found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// Audit: restricting where someone may open from is the class of admin
	// action WriteAdminAudit exists for. Best-effort per its contract — never
	// blocks the write. on_missing_location is recorded because it is the
	// field that decides whether the fence binds the chat rails at all.
	if err := s.store.WriteAdminAudit(r.Context(), claimsFrom(r).Sub, "geofence_create", "geofence_rule", rule.ID, true,
		map[string]any{
			"account_id":          accountID,
			"access_point_id":     rule.AccessPointID,
			"location_id":         rule.LocationID,
			"lat":                 rule.AnchorLat,
			"long":                rule.AnchorLong,
			"radius_m":            rule.RadiusM,
			"slack_m":             rule.SlackM,
			"on_missing_location": rule.OnMissingLocation,
		}); err != nil {
		s.log.Error("geofence create audit write failed", "rule_id", rule.ID, "err", err)
	}
	writeJSON(w, http.StatusCreated, geofenceRuleJSON(*rule))
}

// DELETE /v1/accounts/{id}/geofences/{ruleID}
func (s *Server) handleGeofenceDelete(w http.ResponseWriter, r *http.Request) {
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
	// Read first, so the audit row can say WHICH fence was lifted. Removing a
	// rule widens access; that must leave the same durable trace creating it
	// did.
	rule, err := s.store.GeofenceRuleByID(r.Context(), accountID, ruleID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.DeleteGeofenceRule(r.Context(), accountID, ruleID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), claimsFrom(r).Sub, "geofence_delete", "geofence_rule", ruleID, true,
		map[string]any{
			"account_id":      accountID,
			"access_point_id": rule.AccessPointID,
			"location_id":     rule.LocationID,
			"radius_m":        rule.RadiusM,
		}); err != nil {
		s.log.Error("geofence delete audit write failed", "rule_id", ruleID, "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}
