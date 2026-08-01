package httpapi

import "net/http"

// The occupancy-disclosure switch — docs/CHAT-COMMANDS.md §4.4 rule 6,
// migration 0028.
//
// This is the control that decides whether a chat message may report something
// about the people in a building. §4.3 is blunt about why it exists: "which
// lights are on" is an occupancy question, and reporting an away-state
// automation reports occupancy whether or not anyone meant it to.
//
// Admin-only and audited, for the reason §2.4 gives about camera:view — enabling
// it is an act somebody should be able to attribute later, not a preference.
// The consent row itself records who and when; the admin-audit entry is the
// tamper-evident copy.

type disclosureReq struct {
	// Occupancy is the whole payload. A single named field rather than a bare
	// boolean so a second disclosure class can be added later without changing
	// what this one means — a body of `true` would have to be reinterpreted.
	Occupancy *bool `json:"occupancy"`
}

func (s *Server) handleLocationDisclosureGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, _, ok := s.locationScope(w, r, id); !ok {
		return
	}
	d, err := s.store.OccupancyDisclosureFor(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := map[string]any{"occupancy": d.Enabled}
	// Who and when, so the console can show more than a switch position. A
	// privacy control that cannot say who turned it on is not auditable.
	if d.EnabledBy.Valid {
		out["enabled_by"] = d.EnabledBy.String
	}
	if d.EnabledAt.Valid {
		out["enabled_at"] = d.EnabledAt.Int64
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleLocationDisclosurePatch(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	var req disclosureReq
	if !readJSON(w, r, &req) {
		return
	}
	if req.Occupancy == nil {
		writeErr(w, http.StatusBadRequest, "occupancy is required")
		return
	}
	_, role, ok := s.locationScope(w, r, id)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "not_account_admin")
		return
	}
	if err := s.store.SetOccupancyDisclosure(r.Context(), id, c.Sub, *req.Occupancy); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// Both directions are audited. Turning it OFF matters as much as on: a
	// disclosure that was available for a period and then withdrawn is a fact
	// about what could have been asked during that period.
	action := "occupancy_disclosure_disable"
	if *req.Occupancy {
		action = "occupancy_disclosure_enable"
	}
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, action, "location", id, true,
		map[string]any{"location_id": id}); err != nil {
		s.log.Error("audit occupancy disclosure", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"occupancy": *req.Occupancy})
}
