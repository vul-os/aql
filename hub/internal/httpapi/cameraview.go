package httpapi

// The `camera:view` surface: granting it, listing footage behind it, and the
// record of who watched.
//
// docs/CAMERA-RETENTION.md §2.4 and §2.5. Two rules shape every handler here:
//
//   - the permission is NOT implied by owner or admin. An account admin who has
//     not granted themselves `camera:view` gets a 403 from the clip listing,
//     same as anyone else. That is deliberate and it is the one place this
//     product's "admin can configure the thing" pattern is broken on purpose:
//     here it would mean "admin can watch the other residents".
//   - every view is recorded in the hash-chained audit log, and EVERY MEMBER can
//     read that record. Not admins only. The subjects of the footage must not be
//     the only people who cannot check who watched.

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// handleCameraViewGrants lists an account's `camera:view` grants.
//
// Account-admin only: it names members and cameras, and it is the configuration
// side rather than the transparency side. The transparency side —
// handleCameraAccessLog — is open to every member on purpose.
func (s *Server) handleCameraViewGrants(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	grants, err := s.store.CameraViewGrants(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(grants))
	for _, g := range grants {
		m := map[string]any{
			"user_id": g.UserID, "username": g.Username,
			"device_key": g.DeviceKey, "granted_by": g.GrantedBy,
			"revoked": g.RevokedAt != nil,
		}
		// Sent as their own fields rather than folded into one "active" boolean:
		// "not yet" and "no longer" are different answers to "why can they not
		// watch", and an operator debugging a grant needs to tell them apart.
		if g.StartsAt != nil {
			m["starts_at"] = *g.StartsAt
		}
		if g.EndsAt != nil {
			m["ends_at"] = *g.EndsAt
		}
		if g.RevokedAt != nil {
			m["revoked_at"] = *g.RevokedAt
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"grants": out})
}

// handleCameraViewGrant creates or replaces one grant. Account-admin only, and
// audited — §2.4 requires "who gave themselves the ability to watch, and when"
// to be answerable later.
func (s *Server) handleCameraViewGrant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	c := claimsFrom(r)
	if c == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body struct {
		UserID    string `json:"user_id"`
		DeviceKey string `json:"device_key"`
		StartsAt  *int64 `json:"starts_at"`
		EndsAt    *int64 `json:"ends_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	if body.UserID == "" || body.DeviceKey == "" {
		writeErr(w, http.StatusBadRequest, "user_id and device_key are required")
		return
	}
	// A window that ends before it starts would silently never grant anything.
	if body.StartsAt != nil && body.EndsAt != nil && *body.EndsAt <= *body.StartsAt {
		writeErr(w, http.StatusBadRequest, "ends_at must be after starts_at")
		return
	}
	// The grant must name a camera this account actually owns, or it is a way to
	// learn that some other account has a device with a given key.
	owner, err := s.store.DeviceOwnerAccount(r.Context(), body.DeviceKey)
	if err != nil || owner != id {
		writeErr(w, http.StatusNotFound, "device_not_found")
		return
	}
	if err := s.store.GrantCameraView(r.Context(), id, body.UserID, body.DeviceKey, c.Sub, body.StartsAt, body.EndsAt); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "camera_view_grant", "camera", body.DeviceKey, true,
		map[string]any{"account_id": id, "user_id": body.UserID, "starts_at": body.StartsAt, "ends_at": body.EndsAt}); err != nil {
		s.log.Error("audit camera view grant", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"granted": true})
}

// handleCameraViewRevoke withdraws a grant.
func (s *Server) handleCameraViewRevoke(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	c := claimsFrom(r)
	if c == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	userID, deviceKey := r.URL.Query().Get("user_id"), r.URL.Query().Get("device_key")
	if userID == "" || deviceKey == "" {
		writeErr(w, http.StatusBadRequest, "user_id and device_key are required")
		return
	}
	if err := s.store.RevokeCameraView(r.Context(), id, userID, deviceKey); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "camera_view_revoke", "camera", deviceKey, true,
		map[string]any{"account_id": id, "user_id": userID}); err != nil {
		s.log.Error("audit camera view revoke", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": true})
}

// handleCameraClips lists one camera's footage.
//
// This is the handler `camera:view` exists to gate, and the check is NOT a role
// check. An account owner without a grant is refused here, which is the whole
// design: "can configure the hub" and "can watch the other residents" are
// different authorities.
//
// Every successful listing is audited before the response is written. Before,
// not after: a record of watching that is written only when the write succeeds
// is a record that a client disconnect erases.
func (s *Server) handleCameraClips(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	// Membership first — a non-member must not be able to distinguish "no such
	// camera" from "no permission" on someone else's account.
	if _, ok := s.memberRole(w, r, id); !ok {
		return
	}
	c := claimsFrom(r)
	if c == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	deviceKey := r.PathValue("key")
	allowed, err := s.store.MayViewCamera(r.Context(), id, c.Sub, deviceKey, time.Now().Unix())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if !allowed {
		// Audited as a refusal too. "Who tried to watch and could not" is worth
		// as much as who did, and the audit log's `allowed` column exists for
		// exactly this.
		if aerr := s.store.WriteAdminAudit(r.Context(), c.Sub, store.CameraViewAction, "camera", deviceKey, false,
			map[string]any{"account_id": id, "reason": "no_camera_view_grant"}); aerr != nil {
			s.log.Error("audit refused camera view", "err", aerr)
		}
		writeErr(w, http.StatusForbidden, "camera_view_required")
		return
	}

	clips, err := s.store.ClipsByDevice(r.Context(), id, deviceKey, 200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	var from, to int64
	if len(clips) > 0 {
		to = clips[0].StartedAt + int64(clips[0].DurationS)
		from = clips[len(clips)-1].StartedAt
	}
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, store.CameraViewAction, "camera", deviceKey, true,
		map[string]any{"account_id": id, "from": from, "to": to, "clips": len(clips)}); err != nil {
		// The listing is NOT served if it could not be recorded. §2.5's whole
		// claim is that watching is auditable; serving footage whose access
		// could not be written down would quietly make that false.
		s.log.Error("audit camera view; refusing to serve unrecorded access", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	out := make([]map[string]any, 0, len(clips))
	for _, cl := range clips {
		m := map[string]any{
			"id": cl.ID, "started_at": cl.StartedAt,
			"duration_s": cl.DurationS, "size_bytes": cl.SizeBytes,
			"reason": cl.Reason,
		}
		// A dropped clip stays in the list as a gap (§2.6): someone looking for
		// the evening they cared about is told it was dropped and when, rather
		// than shown a list that reads like a camera which never recorded.
		if cl.DeletedAt != nil {
			m["deleted_at"] = *cl.DeletedAt
			m["deleted_why"] = cl.DeletedWhy
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"clips": out})
}

// handleCameraAccessLog serves who watched what.
//
// EVERY MEMBER, not admins only. §2.5: "The audit trail for footage is the one
// log whose subject has the strongest claim to it, and restricting it to admins
// would mean the people most affected are the only ones who cannot check."
func (s *Server) handleCameraAccessLog(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.memberRole(w, r, id); !ok {
		return
	}
	rows, err := s.store.CameraAccessLog(r.Context(), id, 200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, a := range rows {
		out = append(out, map[string]any{
			"at": a.At, "username": a.Username, "device_key": a.DeviceKey,
			"action": a.Action, "detail": a.Detail,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"access": out})
}
