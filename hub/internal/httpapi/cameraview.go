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
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

// handleCameraClipPlay serves one clip's bytes.
//
// This is the watching that §2.5 is about — the listing above tells you footage
// exists, this hands it over — so it is gated by the same per-camera grant and
// written to the same hash-chained log.
//
// Each clip file is a self-contained fragmented MP4 (ftyp+moov+moof+mdat), which
// is what the container choice was for: a browser plays it from a URL with no
// plugin, no transcoding and no media-source plumbing. http.ServeContent does
// the Range handling a <video> element requires.
func (s *Server) handleCameraClipPlay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.memberRole(w, r, id); !ok {
		return
	}
	c := claimsFrom(r)
	if c == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	deviceKey, clipID := r.PathValue("key"), r.PathValue("clip")

	// No configured root, no playback. Resolving a stored relative path against
	// an empty root would resolve it against the process's working directory,
	// which is a way to serve a file that is not a clip.
	if s.cfg.RecordingsRoot == "" {
		writeErr(w, http.StatusNotFound, "recording_not_configured")
		return
	}

	allowed, err := s.store.MayViewCamera(r.Context(), id, c.Sub, deviceKey, time.Now().Unix())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if !allowed {
		if aerr := s.store.WriteAdminAudit(r.Context(), c.Sub, store.CameraViewAction, "camera", deviceKey, false,
			map[string]any{"account_id": id, "clip": clipID, "reason": "no_camera_view_grant"}); aerr != nil {
			s.log.Error("audit refused clip playback", "err", aerr)
		}
		writeErr(w, http.StatusForbidden, "camera_view_required")
		return
	}

	clip, err := s.store.ClipByID(r.Context(), id, deviceKey, clipID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "clip_not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if clip.DeletedAt != nil {
		// 410, not 404. §2.6: someone looking for the evening they cared about
		// is told it was dropped and when — "gone" and "never existed" are
		// different answers and this is the one place the difference is the
		// whole point.
		writeJSON(w, http.StatusGone, map[string]any{
			"error": "clip_gone", "deleted_at": *clip.DeletedAt, "deleted_why": clip.DeletedWhy,
		})
		return
	}

	// rel_path comes from this hub's own database, but it is still joined and
	// then re-checked against the root. A stored path is only as trustworthy as
	// everything that has ever written to that column, and "it came from our
	// database" is the assumption behind a long line of traversal bugs.
	full := filepath.Join(s.cfg.RecordingsRoot, filepath.Clean("/"+clip.RelPath))
	if !strings.HasPrefix(full, filepath.Clean(s.cfg.RecordingsRoot)+string(os.PathSeparator)) {
		s.log.Error("clip path escapes the recordings root", "clip", clip.ID, "rel", clip.RelPath)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	f, err := os.Open(full)
	if err != nil {
		// The index says it exists and the disk disagrees. §2.1 makes that a
		// SUPPORTED state — the layout is deliberately walkable so a human can
		// delete their own footage — so it is 410 with the same shape as an
		// expired clip rather than a 500.
		writeJSON(w, http.StatusGone, map[string]any{
			"error": "clip_gone", "deleted_why": store.ClipMissing,
		})
		return
	}
	defer f.Close()

	// Audited once per playback, not once per range request. A <video> element
	// issues many partial requests for one viewing, and a log with forty rows
	// for one watch is a log nobody reads. The first request for a clip is the
	// one without a Range header or with one starting at zero.
	rng := r.Header.Get("Range")
	if rng == "" || strings.HasPrefix(rng, "bytes=0-") {
		if aerr := s.store.WriteAdminAudit(r.Context(), c.Sub, store.CameraViewAction, "camera", deviceKey, true,
			map[string]any{
				"account_id": id, "clip": clip.ID,
				"from": clip.StartedAt, "to": clip.StartedAt + int64(clip.DurationS),
			}); aerr != nil {
			s.log.Error("audit clip playback; refusing to serve unrecorded access", "err", aerr)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
	}

	w.Header().Set("Content-Type", "video/mp4")
	// Footage must not sit in a shared cache, and a browser re-asking is cheap
	// next to a proxy holding somebody's hallway.
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, clip.ID+".mp4", time.Unix(clip.StartedAt, 0), f)
}
