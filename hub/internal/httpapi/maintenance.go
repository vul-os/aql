package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// The per-access-point maintenance log:
//
//	GET  /v1/access-points/{id}/maintenance   — any member of the account
//	POST /v1/access-points/{id}/maintenance   — account admins only
//
// The console has shipped this panel for a long time, pointed at routes the hub
// did not serve: listing rendered an error and logging failed for everyone. See
// migrations/0017_maintenance.sql for the schema, and in particular for why
// movement-based scheduling is refused rather than stored.
//
// # Who may read, who may write
//
// Reading is open to any member. A resident who wants to know when the gate was
// last serviced is asking a reasonable question about the thing they walk
// through, and there is nothing sensitive in the answer.
//
// Writing is admin-only, and the console already knows it — its error handler
// has a branch for "not_account_admin" that until now could never fire. A
// service record is a claim about work that was done, which becomes evidence in
// an argument about a failure; letting any member append to it would make it
// worth nothing.

const (
	// maxNotesLen bounds free text. Long enough for a real technician's note,
	// short enough that the log cannot become a file store.
	maxNotesLen = 4000
	// maxTechnicianLen matches an ordinary person's name with room to spare.
	maxTechnicianLen = 120
	// maxParts bounds the parts array. A gate service is a handful of parts;
	// this is far above any real entry and stops one request from writing an
	// unbounded blob.
	maxParts = 50
	// maxNextDueDays bounds date-based scheduling at ten years. A due date
	// beyond that is a typo, and storing it produces a reminder nobody alive
	// at this site will see.
	maxNextDueDays = 3650
)

type maintenancePart struct {
	Name         string `json:"name"`
	Qty          *int   `json:"qty,omitempty"`
	CostZARCents *int64 `json:"cost_zar_cents,omitempty"`
}

type createMaintenanceReq struct {
	Kind           string            `json:"kind"`
	PerformedAt    string            `json:"performed_at"`
	TechnicianName string            `json:"technician_name"`
	Notes          string            `json:"notes"`
	Parts          []maintenancePart `json:"parts"`
	CostZARCents   *int64            `json:"cost_zar_cents"`
	NextDueAt      string            `json:"next_due_at"`
	NextDueInDays  *int              `json:"next_due_in_days"`

	// Accepted so the request is REFUSED with a reason rather than 400ing on
	// an unknown field (readJSON disallows unknown keys). A client that sends
	// a movement threshold is asking for something this hub cannot do, and
	// "movement_not_measured" says that; a bare "invalid JSON" would send
	// someone looking for a typo.
	NextDueMovementM *float64 `json:"next_due_movement_m"`
}

// GET /v1/access-points/{id}/maintenance
func (s *Server) handleMaintenanceList(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, _, ok := s.accessPointScope(w, r, id); !ok {
		return
	}
	events, err := s.store.MaintenanceList(r.Context(), id, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(events))
	for _, e := range events {
		out = append(out, maintenanceJSON(e))
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
}

// POST /v1/access-points/{id}/maintenance
func (s *Server) handleMaintenanceCreate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	apc, role, ok := s.accessPointScope(w, r, id)
	if !ok {
		return
	}
	if role != "owner" && role != "admin" {
		writeErr(w, http.StatusForbidden, "not_account_admin")
		return
	}
	_ = apc

	var req createMaintenanceReq
	if !readJSON(w, r, &req) {
		return
	}

	// Refused, not silently dropped. Storing a threshold nothing can evaluate
	// would mean an operator sets "service after 5000 m", the counter never
	// moves because nothing measures movement, and the reminder never fires.
	if req.NextDueMovementM != nil {
		writeErr(w, http.StatusBadRequest, "movement_not_measured")
		return
	}

	if !store.MaintenanceKinds[req.Kind] {
		writeErr(w, http.StatusBadRequest, "invalid_kind")
		return
	}

	now := time.Now().Unix()
	e := store.MaintenanceEvent{AccessPointID: id, Kind: req.Kind, PerformedAt: now}

	if req.PerformedAt != "" {
		t, err := parseWireTime(req.PerformedAt)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_performed_at")
			return
		}
		// A future service date is a typo or a plan, and either way it is not
		// a record of work done. One day of slack absorbs a client clock that
		// is merely wrong rather than lying.
		if t > now+86400 {
			writeErr(w, http.StatusBadRequest, "performed_at_in_future")
			return
		}
		e.PerformedAt = t
	}

	if name := strings.TrimSpace(req.TechnicianName); name != "" {
		if len([]rune(name)) > maxTechnicianLen {
			writeErr(w, http.StatusBadRequest, "invalid_technician_name")
			return
		}
		e.TechnicianName = name
	}
	if notes := strings.TrimSpace(req.Notes); notes != "" {
		if len([]rune(notes)) > maxNotesLen {
			writeErr(w, http.StatusBadRequest, "notes_too_long")
			return
		}
		e.Notes = notes
	}

	if len(req.Parts) > 0 {
		if len(req.Parts) > maxParts {
			writeErr(w, http.StatusBadRequest, "too_many_parts")
			return
		}
		for i := range req.Parts {
			req.Parts[i].Name = strings.TrimSpace(req.Parts[i].Name)
			if req.Parts[i].Name == "" || len([]rune(req.Parts[i].Name)) > 200 {
				writeErr(w, http.StatusBadRequest, "invalid_part")
				return
			}
			if req.Parts[i].Qty != nil && (*req.Parts[i].Qty < 1 || *req.Parts[i].Qty > 10000) {
				writeErr(w, http.StatusBadRequest, "invalid_part")
				return
			}
			if req.Parts[i].CostZARCents != nil && *req.Parts[i].CostZARCents < 0 {
				writeErr(w, http.StatusBadRequest, "invalid_part")
				return
			}
		}
		raw, err := json.Marshal(req.Parts)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_part")
			return
		}
		e.Parts = string(raw)
	}

	if req.CostZARCents != nil {
		if *req.CostZARCents < 0 {
			writeErr(w, http.StatusBadRequest, "invalid_cost")
			return
		}
		e.CostZARCents = sql.NullInt64{Int64: *req.CostZARCents, Valid: true}
	}

	// Two ways to say the same thing, because the console offers "in N days"
	// and an integration would rather send a date. Both, together, is
	// ambiguous — refuse rather than pick one and be quietly wrong.
	if req.NextDueAt != "" && req.NextDueInDays != nil {
		writeErr(w, http.StatusBadRequest, "conflicting_next_due")
		return
	}
	switch {
	case req.NextDueAt != "":
		t, err := parseWireTime(req.NextDueAt)
		if err != nil || t <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid_next_due_at")
			return
		}
		e.NextDueAt = sql.NullInt64{Int64: t, Valid: true}
	case req.NextDueInDays != nil:
		d := *req.NextDueInDays
		if d < 1 || d > maxNextDueDays {
			writeErr(w, http.StatusBadRequest, "invalid_next_due_in_days")
			return
		}
		// Counted from when the work was done, not from now: a service logged
		// on Monday for work done on Friday is due six months after the work.
		e.NextDueAt = sql.NullInt64{Int64: e.PerformedAt + int64(d)*86400, Valid: true}
	}

	c := claimsFrom(r)
	e.PerformedBy = c.Sub

	saved, err := s.store.MaintenanceCreate(r.Context(), e)
	if err != nil {
		if errors.Is(err, store.ErrAccessPointMissing) {
			writeErr(w, http.StatusNotFound, "access_point_not_found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, maintenanceJSON(*saved))
}

// maintenanceJSON is the single place an event becomes wire shape.
//
// movement_m_at_event and next_due_movement_m are present and always null.
// They are in the console's type and dropping them from the response would be
// a silent shape change; emitting null says "this hub does not measure that",
// which is the true answer and the one the field's absence would not give.
func maintenanceJSON(e store.MaintenanceEvent) map[string]any {
	var parts any
	if e.Parts != "" {
		var decoded []maintenancePart
		if err := json.Unmarshal([]byte(e.Parts), &decoded); err == nil {
			parts = decoded
		}
	}
	return map[string]any{
		"id":                  e.ID,
		"access_point_id":     e.AccessPointID,
		"kind":                e.Kind,
		"performed_at":        e.PerformedAt,
		"performed_by":        nilIfEmpty(e.PerformedBy),
		"technician_name":     nilIfEmpty(e.TechnicianName),
		"notes":               nilIfEmpty(e.Notes),
		"parts":               parts,
		"cost_zar_cents":      nullInt64(e.CostZARCents),
		"movement_m_at_event": nil,
		"next_due_movement_m": nil,
		"next_due_at":         nullInt64(e.NextDueAt),
		"created_at":          e.CreatedAt,
	}
}

// parseWireTime accepts either Unix seconds or RFC 3339, because the console
// sends a date string and every other timestamp on this API is an integer.
// Accepting both here costs one function and saves a class of 400 that reads
// like a server bug from the client's side.
func parseWireTime(v string) (int64, error) {
	v = strings.TrimSpace(v)
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.Unix(), nil
	}
	if t, err := time.Parse("2006-01-02", v); err == nil {
		return t.Unix(), nil
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
		return n, nil
	}
	return 0, errors.New("unparseable time")
}
