package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// Access points (and, from stage 3, the open path + temporary grants),
// porting the Workers backend's access.ts.

var apKinds = map[string]bool{"gate": true, "door": true, "barrier": true, "other": true}

// accessPointJSON is the wire shape for an access point.
//
// The meter is derived from access_logs. movement_m is NULL: a controller
// reports that a relay pulsed, not how far a leaf travelled, and nothing here
// measures distance.
//
// It was a literal 0, defended in this comment as "what the hub actually
// knows". That was wrong, and the contradiction sat ten lines apart in one
// function: the maintenance block below sends null for the same quantity and
// explains why — "0 m remaining" and "42% used" would both be confident answers
// to a question this hub cannot answer. The hub does not know a gate moved zero
// metres. It knows nothing about distance, and zero is a measurement.
//
// The console proved the point: it rendered "Movement 0 m" on the devices page,
// presenting a fabricated reading as a measured one, which is precisely what the
// maintenance comment was written to prevent.
//
// The KEY stays, so this is not the silent shape change the old comment feared —
// a client that parses the field still finds it, now carrying the honest answer.
//
// The maintenance block used to be a hardcoded "nothing recorded", permanently
// true because no route could record anything. It now reflects the log
// (0017_maintenance.sql). Its movement fields are null for the same reason.
func accessPointJSON(d store.AccessPointDetail, m store.MaintenanceSummary) map[string]any {
	return map[string]any{
		"id":          d.ID,
		"location_id": d.LocationID,
		"name":        d.Name,
		"kind":        d.Kind,
		"device_id":   nilIfEmpty(d.DeviceID),
		"status":      d.Status,
		"meter": map[string]any{
			"movement_m":   nil,
			"total_opens":  d.TotalOpens,
			"total_closes": d.TotalCloses,
			"last_op_at":   nullInt64(d.LastOpAt),
		},
		"maintenance": map[string]any{
			"last_serviced_at": nullInt64(m.LastServicedAt),
			"next_due_at":      nullInt64(m.NextDueAt),
			"due_now":          m.DueNow,
			// Null, not zero, and not omitted. Nothing measures movement, so
			// "0 m remaining" and "42% used" would both be confident answers
			// to a question this hub cannot answer — the same distinction
			// internal/energy draws between an unmeasured hour and an hour of
			// zero.
			"last_service_movement_m": nil,
			"next_due_movement_m":     nil,
			"movement_remaining_m":    nil,
			"pct_used":                nil,
		},
	}
}

// GET /v1/access-points[?account_id=] — with account_id the listing is
// scoped to that tenant (member gate); without it, every access point across
// the caller's accounts (backend RLS default view).
func (s *Server) handleAccessPointsList(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	accountID := r.URL.Query().Get("account_id")
	var accountIDs []string
	if accountID != "" {
		if _, ok := s.memberRole(w, r, accountID); !ok {
			return
		}
		accountIDs = []string{accountID}
	} else {
		accounts, err := s.store.AccountsForUser(r.Context(), c.Sub)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		for _, a := range accounts {
			accountIDs = append(accountIDs, a.ID)
		}
	}
	list := make([]map[string]any, 0)
	nowUnix := time.Now().Unix()
	for _, aid := range accountIDs {
		aps, err := s.store.AccessPointsByAccountDetailed(r.Context(), aid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		// One batched read per account rather than two queries per access
		// point, so a site with twenty gates does not turn a list render into
		// forty round trips against a SQLite file on an SD card.
		ids := make([]string, 0, len(aps))
		for _, ap := range aps {
			ids = append(ids, ap.ID)
		}
		sums, err := s.store.MaintenanceSummaryBatch(r.Context(), ids, nowUnix)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		for _, ap := range aps {
			list = append(list, accessPointJSON(ap, sums[ap.ID]))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"access_points": list})
}

// accessPointScope resolves an access point to its owning account/location
// and the caller's role. Non-members get 404 access_point_not_found.
func (s *Server) accessPointScope(w http.ResponseWriter, r *http.Request, apID string) (apc *store.AccessPointContext, role string, ok bool) {
	c := claimsFrom(r)
	apc, err := s.store.AccessPointContextByID(r.Context(), apID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "access_point_not_found")
		return nil, "", false
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return nil, "", false
	}
	role, err = s.store.MemberRole(r.Context(), apc.AccountID, c.Sub)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "access_point_not_found")
		return nil, "", false
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return nil, "", false
	}
	return apc, role, true
}

// GET /v1/access-points/{id}
func (s *Server) handleAccessPointGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	apc, _, ok := s.accessPointScope(w, r, id)
	if !ok {
		return
	}
	d, err := s.store.AccessPointDetailByID(r.Context(), apc.AccountID, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	sum, err := s.store.MaintenanceSummaryFor(r.Context(), id, time.Now().Unix())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, accessPointJSON(*d, sum))
}

type createAccessPointReq struct {
	LocationID string   `json:"location_id"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	DeviceID   *string  `json:"device_id"`
	Lat        *float64 `json:"lat"`
	Long       *float64 `json:"long"`
}

// POST /v1/access-points — admin of the account owning the location (the
// access_points WITH CHECK policy, pre-checked for a clean 403/404).
func (s *Server) handleAccessPointCreate(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req createAccessPointReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.LocationID == "" || req.Name == "" || len(req.Name) > 120 || !apKinds[req.Kind] {
		writeErr(w, http.StatusBadRequest, "invalid_access_point")
		return
	}
	accountID, role, ok := s.locationScope(w, r, req.LocationID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "not_account_admin")
		return
	}
	deviceID := ""
	if req.DeviceID != nil {
		deviceID = *req.DeviceID
	}
	d, err := s.store.CreateAccessPointFull(r.Context(), accountID, req.LocationID, req.Name, req.Kind, deviceID, req.Lat, req.Long)
	switch {
	case errors.Is(err, store.ErrDeviceNotAtLocation):
		writeErr(w, http.StatusBadRequest, "device_not_at_location")
		return
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "location_not_found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// Durable trail for access-point creation, including which controller
	// (if any) it was bound to — the finding's "pair a rogue controller...
	// and leave no queryable trace" gap applies just as much to binding an
	// already-paired device to a NEW access point as it does to the pairing
	// itself.
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "access_point_create", "access_point", d.ID, true,
		map[string]any{"account_id": accountID, "location_id": req.LocationID, "name": req.Name,
			"kind": req.Kind, "device_id": nilIfEmpty(deviceID)}); err != nil {
		s.log.Error("access point create audit write failed", "access_point_id", d.ID, "err", err)
	}
	writeJSON(w, http.StatusCreated, accessPointJSON(*d, store.MaintenanceSummary{}))
}

// ---------------------------------------------------------------------------
// null helpers shared by the /v1 shapes
// ---------------------------------------------------------------------------

func nullInt64(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}
