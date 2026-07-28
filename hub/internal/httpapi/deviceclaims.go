package httpapi

// Claiming a device for an account.
//
// The ownership model (store/migrations/0021_device_ownership.sql) records an
// assertion: a human with admin rights over an account says "this device is
// ours". These are the routes through which that assertion is made, and
// without them the table could never be populated — an ownership model nobody
// can reach is the "built but unreachable" shape this codebase has shipped
// five times and does not intend to ship a sixth.
//
// # Why claiming is an admin act
//
// A claim decides who may actuate a physical device from then on. That is the
// same class of decision as inviting a member or creating an access point,
// both of which are already admin-only. A plain member claiming the household
// lamp for a side account they own would be a quiet privilege transfer.
//
// # What is offered for claiming, and what is not
//
// Only UNCLAIMED devices. A device another account owns is not listed, not
// distinguishable from one that does not exist, and cannot be claimed — the
// refusal is the same either way, because telling an outsider "that one is
// taken" confirms the existence of a device on an account they cannot see.

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/vul-os/aql/hub/internal/store"
)

type claimDeviceReq struct {
	DeviceKey string `json:"device_key"`
	Label     string `json:"label"`
}

// GET /v1/accounts/{id}/devices/claimable — engine devices no account owns.
//
// Account admins only, and it deliberately reveals nothing about claimed
// devices beyond their absence from this list.
func (s *Server) handleClaimableDevices(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	reg := s.registry()
	if reg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"devices": []any{}, "engine": false})
		return
	}
	claimed, err := s.store.ClaimedDeviceKeys(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0)
	for _, d := range reg.Devices() {
		if claimed[d.Key] {
			continue
		}
		out = append(out, engineDeviceJSON(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out, "engine": true})
}

// POST /v1/accounts/{id}/devices/claims — assert that this account owns a device.
func (s *Server) handleDeviceClaimCreate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	c := claimsFrom(r)

	var req claimDeviceReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	key := strings.TrimSpace(req.DeviceKey)
	if key == "" || len(key) > 256 {
		writeErr(w, http.StatusBadRequest, "invalid_device_key")
		return
	}
	label := strings.TrimSpace(req.Label)
	if len(label) > 120 {
		writeErr(w, http.StatusBadRequest, "invalid_label")
		return
	}

	// The device must actually exist in the engine. Claiming a key the engine
	// has never reported would let an account stake a claim on a device before
	// it is plugged in — first-claim-wins turned into a land grab against
	// hardware nobody has seen yet.
	reg := s.registry()
	if reg == nil {
		writeErr(w, http.StatusNotFound, "no_device_engine")
		return
	}
	var known bool
	for _, d := range reg.Devices() {
		if d.Key == key {
			known = true
			if label == "" {
				label = d.Device.Name
			}
			break
		}
	}
	if !known {
		writeErr(w, http.StatusNotFound, "unknown_device")
		return
	}

	switch err := s.store.ClaimDevice(r.Context(), key, id, c.Sub, label); {
	case errors.Is(err, store.ErrDeviceAlreadyClaimed):
		// 409, and no hint about who holds it.
		writeErr(w, http.StatusConflict, "device_already_claimed")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "device_claim", "device", key, true,
		map[string]any{"account_id": id, "device_key": key, "label": label}); err != nil {
		s.log.Error("device claim audit write failed", "device_key", key, "err", err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"device_key": key, "label": label})
}

// DELETE /v1/accounts/{id}/devices/claims/{key} — give a device up.
//
// This is how a device legitimately changes hands: released by its owner, then
// claimable by anyone. There is no transfer, because a transfer would need the
// receiving account to consent to something it cannot see yet.
func (s *Server) handleDeviceClaimDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	c := claimsFrom(r)
	key := strings.TrimSpace(r.PathValue("key"))

	switch err := s.store.ReleaseDevice(r.Context(), key, id); {
	case errors.Is(err, store.ErrDeviceNotClaimed):
		// Covers both "unclaimed" and "somebody else's", deliberately.
		writeErr(w, http.StatusNotFound, "device_claim_not_found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "device_release", "device", key, true,
		map[string]any{"account_id": id, "device_key": key}); err != nil {
		s.log.Error("device release audit write failed", "device_key", key, "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}
