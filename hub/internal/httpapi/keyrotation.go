package httpapi

// Rotating the hub's signing key.
//
// `repair` was the last command in proto/commands.md with no sender: the
// controller implements it (ApplyRepair), the conformance vectors cover it, and
// nothing on this side could issue one. So the hub's signing key was, in
// practice, permanent — a key believed compromised could not be replaced
// without physically resetting every controller.
//
// See keys/rotation.go for why two keys must be retained, and
// store/migrations/0023 for what is written down.
//
// # What a rotation does to outstanding offline grants, and why that is right
//
// It invalidates them. An offline grant is signed by the hub and verified by a
// controller against the key it pins; once a controller is repaired onto the new
// key, a grant signed with the old one is refused at the gate. Grants last up to
// keys.DefaultGrantTTL, so a rotation can strand up to a week of them.
//
// That is the correct behaviour rather than a limitation to work around. The
// reason to rotate is almost always that the old key is not trusted any more,
// and a grant signed with an untrusted key is exactly the thing that should stop
// opening doors. Making outstanding grants survive a rotation would mean keeping
// the compromised key authoritative for another week.
//
// What matters is that nobody is surprised by it, so the count of affected
// grants is reported BEFORE a rotation starts, not discovered afterwards at a
// gate.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// repairTTL is how long a dispatched repair stays valid.
//
// The command envelope maximum, because a repair is worth retrying for as long
// as the protocol allows: the controllers that need one most are the ones that
// answer slowly.
const repairTTL = keys.MaxCommandTTL

// handleKeyRotationStatus reports the rotation in flight, or that none is.
func (s *Server) handleKeyRotationStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rot, err := s.store.OpenKeyRotation(ctx)
	if errors.Is(err, store.ErrNoOpenRotation) {
		// Not an error and not an empty rotation object: a client has to be able
		// to tell "no rotation" from "a rotation with nothing done yet", and an
		// object full of zeroes reads as the second.
		writeJSON(w, http.StatusOK, map[string]any{
			"rotating":       false,
			"current_pubkey": s.keys.PublicKeyB64(),
		})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	pins, err := s.store.DevicePins(ctx, rot.NewPub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(pins))
	repaired := 0
	for _, p := range pins {
		if p.Repaired {
			repaired++
		}
		m := map[string]any{
			"device_id": p.DeviceID,
			"label":     p.Label,
			"repaired":  p.Repaired,
		}
		// Distinguished from "not repaired" because they call for different
		// actions: a repair outstanding since a minute ago is working, and one
		// outstanding since yesterday is a controller that has not come back.
		if p.PendingSince != nil {
			m["pending_since"] = *p.PendingSince
		}
		out = append(out, m)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"rotating":        true,
		"rotation_id":     rot.ID,
		"started_at":      rot.StartedAt,
		"reason":          rot.Reason,
		"previous_pubkey": rot.PreviousPub,
		"new_pubkey":      rot.NewPub,
		"current_pubkey":  s.keys.PublicKeyB64(),
		"controllers":     out,
		"repaired":        repaired,
		"remaining":       len(pins) - repaired,
	})
}

// handleKeyRotationPreview reports what starting a rotation would cost, without
// starting one.
//
// Separate from the POST because the cost is a fact someone should read before
// deciding, and a confirmation dialogue that has to POST to find out what it is
// about is a dialogue that has already done the thing.
func (s *Server) handleKeyRotationPreview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if _, err := s.store.OpenKeyRotation(ctx); err == nil {
		writeErr(w, http.StatusConflict, "rotation_in_flight")
		return
	} else if !errors.Is(err, store.ErrNoOpenRotation) {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	devices, err := s.store.PairedDeviceIDs(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// An upper bound, not a count of live grants: the hub keeps no record of
	// which are still held, because a grant lives on someone's phone until it
	// expires. Issuances inside one TTL window bound it from above — see
	// store.OfflineGrantsIssuedSince. Named accordingly in the response so
	// nobody reads it as exact.
	grants, err := s.store.OfflineGrantsIssuedSince(ctx,
		time.Now().Add(-keys.DefaultGrantTTL).Unix())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"controllers_to_repair": len(devices),
		// The number that surprises people. Every one of these stops working at
		// a gate the moment its controller is repaired — see the file comment
		// for why that is the intended behaviour and not a defect.
		"offline_grants_invalidated_max": grants,
		"current_pubkey":                 s.keys.PublicKeyB64(),
	})
}

// handleKeyRotationStart generates a new signing key and begins repairing
// controllers onto it.
func (s *Server) handleKeyRotationStart(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body struct {
		Reason string `json:"reason"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}

	if _, err := s.store.OpenKeyRotation(ctx); err == nil {
		writeErr(w, http.StatusConflict, "rotation_in_flight")
		return
	} else if !errors.Is(err, store.ErrNoOpenRotation) {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	previous := s.keys.PublicKeyB64()
	// The seeds move first. Everything after this is bookkeeping that can be
	// retried; this step cannot, so a failure here must leave nothing recorded.
	newPub, err := s.keys.Rotate()
	if err != nil {
		if errors.Is(err, keys.ErrRotationInFlight) {
			// The seed files say a rotation is in flight and the database does
			// not. Reported rather than repaired automatically: the two
			// disagreeing is a state someone has to look at, and guessing which
			// is right is how a retained key gets destroyed.
			s.log.Error("a retained key exists on disk with no open rotation recorded")
			writeErr(w, http.StatusConflict, "rotation_in_flight")
			return
		}
		s.log.Error("rotate gateway key", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	rot, err := s.store.BeginKeyRotation(ctx, uuid.NewString(), previous, newPub, body.Reason)
	if err != nil {
		// The keys have rotated and the bookkeeping has not. Not rolled back:
		// controllers still pin the previous key, which is retained on disk, so
		// signing still works for all of them — and the retained key is what a
		// second attempt needs. Rolling the seeds back would be the destructive
		// option.
		s.log.Error("record key rotation; the seeds have rotated and the record has not",
			"err", err, "previous_pubkey", previous, "new_pubkey", newPub)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	s.log.Warn("gateway signing key rotated",
		"rotation_id", rot.ID, "previous_pubkey", previous, "new_pubkey", newPub,
		"reason", body.Reason)

	// Dispatch immediately so a fleet that is entirely online finishes in one
	// step, then let the sweep pick up whatever did not answer.
	sent := s.dispatchRepairs(ctx, rot)

	writeJSON(w, http.StatusOK, map[string]any{
		"rotation_id":     rot.ID,
		"previous_pubkey": previous,
		"new_pubkey":      newPub,
		"repairs_sent":    sent,
	})
}

// handleKeyRotationRetry re-dispatches repairs to controllers that have not
// acknowledged one.
//
// A rotation completes by itself when the last controller answers, so this
// exists for the fleet where one has been offline: someone brings it back and
// wants the repair sent now rather than at the next sweep.
func (s *Server) handleKeyRotationRetry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rot, err := s.store.OpenKeyRotation(ctx)
	if errors.Is(err, store.ErrNoOpenRotation) {
		writeErr(w, http.StatusNotFound, "no_rotation")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	sent := s.dispatchRepairs(ctx, rot)
	done, _ := s.finishIfComplete(ctx, rot)
	writeJSON(w, http.StatusOK, map[string]any{"repairs_sent": sent, "completed": done})
}

// dispatchRepairs sends a signed `repair` to every controller still pinning the
// previous key, and returns how many were sent.
func (s *Server) dispatchRepairs(ctx context.Context, rot store.KeyRotation) int {
	pins, err := s.store.DevicePins(ctx, rot.NewPub)
	if err != nil {
		s.log.Error("enumerate device pins for repair dispatch", "err", err)
		return 0
	}
	sent := 0
	for _, p := range pins {
		if p.Repaired {
			continue
		}
		// Signed with the key this controller PINS, which during a rotation is
		// the retained one. A repair signed with the new key is a repair the
		// controller cannot verify — it has never seen that key, which is the
		// whole reason it is being sent one.
		env, err := s.keys.SignCommandForPin(p.PinnedPub, "repair", p.DeviceID, "",
			map[string]any{"next_pubkey": rot.NewPub},
			repairTTL,
			map[string]any{"source": "gateway", "reason": "key_rotation", "rotation_id": rot.ID})
		if err != nil {
			s.log.Error("sign repair", "device_id", p.DeviceID, "err", err)
			continue
		}
		// The nonce is recorded BEFORE dispatch, for the same reason the clock
		// sweep does it: a controller can ack faster than this write would
		// otherwise happen, and an ack whose nonce is not yet recorded proves
		// nothing — the repair would be silently lost for the healthiest
		// controllers.
		if err := s.store.RecordRepairDispatched(ctx, p.DeviceID, env.Nonce); err != nil {
			s.log.Error("record repair nonce", "device_id", p.DeviceID, "err", err)
			continue
		}
		// Dispatch rather than fire-and-forget: Dispatch queues for an offline
		// controller and waits for an ack from a connected one, which is what
		// lets an all-online fleet finish the rotation in a single request.
		s.hub.Dispatch(ctx, p.DeviceID, env, repairAckTimeout, "")
		sent++
	}
	return sent
}

// noteRepairAck records a repair acknowledgement and completes the rotation if
// it was the last one outstanding.
//
// Called from both ack paths for the same reason RecordAckIfPing is: a repair
// queued for an offline controller has no waiter, so the WS and HTTP paths must
// each account for it.
func (s *Server) noteRepairAck(ctx context.Context, deviceID, nonce string) {
	rot, err := s.store.OpenKeyRotation(ctx)
	if err != nil {
		return // no rotation in flight is the overwhelmingly common case
	}
	moved, err := s.store.RecordRepairAck(ctx, deviceID, nonce, rot.NewPub)
	if err != nil {
		s.log.Error("record repair ack", "device_id", deviceID, "err", err)
		return
	}
	if !moved {
		return
	}
	s.log.Info("controller repaired onto the new signing key",
		"device_id", deviceID, "rotation_id", rot.ID)
	if _, err := s.finishIfComplete(ctx, rot); err != nil {
		s.log.Error("complete key rotation", "rotation_id", rot.ID, "err", err)
	}
}

// finishIfComplete destroys the retained key once nothing pins it.
//
// The order is deliberate and not reversible: the DATABASE is updated first, in
// a transaction that re-checks the count, and only then is the key file removed.
// Destroying the key first and failing to close the rotation would leave a hub
// that believes it must sign for controllers with a key it no longer has.
func (s *Server) finishIfComplete(ctx context.Context, rot store.KeyRotation) (bool, error) {
	if err := s.store.CompleteKeyRotation(ctx, rot.ID, rot.NewPub); err != nil {
		var incomplete *store.RotationIncompleteError
		if errors.As(err, &incomplete) {
			return false, nil // controllers remain; not an error
		}
		return false, err
	}
	if err := s.keys.RetirePrevious(); err != nil {
		// The rotation is closed and the old seed is still on disk. Harmless to
		// correctness — nothing pins it, so nothing will be signed with it — but
		// it is a private key that was meant to be gone, so it is logged loudly
		// rather than swallowed.
		s.log.Error("the key rotation completed but the retained key could not be destroyed",
			"rotation_id", rot.ID, "err", err)
		return true, err
	}
	s.log.Warn("key rotation complete; the previous signing key has been destroyed",
		"rotation_id", rot.ID, "new_pubkey", rot.NewPub)
	return true, nil
}

// sweepKeyRotation re-dispatches repairs on a timer, so a controller that comes
// back online is repaired without anyone pressing anything.
//
// A rotation that only progressed when someone was watching would sit open for
// as long as one controller stayed offline, and an open rotation means a
// superseded private key still on disk.
func (s *Server) sweepKeyRotation(ctx context.Context) {
	rot, err := s.store.OpenKeyRotation(ctx)
	if err != nil {
		return
	}
	if n := s.dispatchRepairs(ctx, rot); n > 0 {
		s.log.Info("key rotation sweep re-dispatched repairs", "rotation_id", rot.ID, "sent", n)
	}
	if _, err := s.finishIfComplete(ctx, rot); err != nil {
		s.log.Error("complete key rotation from sweep", "rotation_id", rot.ID, "err", err)
	}
}

// keyRotationSweepInterval is how often an open rotation retries.
//
// Five minutes: often enough that bringing a controller back online repairs it
// while someone is still standing next to it, rare enough that a fleet with one
// permanently dead controller is not signing a repair every few seconds forever.
const keyRotationSweepInterval = 5 * time.Minute

// repairAckTimeout is how long a dispatch waits for a connected controller to
// acknowledge a repair.
//
// Generous compared with an open, because nobody is standing at a gate waiting
// for it and a repair that times out is re-sent by the sweep anyway. The cost of
// waiting is a goroutine; the cost of giving up early is a controller that stays
// on the old key for another five minutes.
const repairAckTimeout = 15 * time.Second

// RunKeyRotationSweep re-dispatches outstanding repairs until ctx is cancelled.
//
// Always on, and it does nothing at all when no rotation is in flight — one
// indexed query per interval. That is the right trade: the alternative is a
// worker started only when a rotation begins, which would not survive the hub
// restarting, and a hub restarting mid-rotation is exactly the case where
// controllers are left pinning a key nobody is trying to move them off.
func (s *Server) RunKeyRotationSweep(ctx context.Context) {
	t := time.NewTicker(keyRotationSweepInterval)
	defer t.Stop()
	for {
		s.sweepKeyRotation(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// signForDevice signs a command with whichever key the target controller pins.
//
// Every command to a controller must go through here rather than through
// keys.SignCommand directly. During a rotation the hub's CURRENT key is the new
// one, and a controller that has not been repaired yet still pins the old one —
// so signing an ordinary open with the current key would produce a badsig at the
// gate, for a resident standing in front of it, for as long as the rotation took
// to reach that controller.
//
// That is the failure two-key retention exists to prevent, and it is not
// confined to repairs: a rotation that only signed its own repairs correctly
// would break every other command in the fleet meanwhile.
//
// A store that cannot answer is treated as "no pin recorded", which signs with
// the current key. That is the pre-rotation behaviour and the right fallback:
// outside a rotation it is exactly correct, and inside one it fails the same way
// the code did before this file existed rather than refusing to open anything.
func (s *Server) signForDevice(ctx context.Context, cmd, deviceID, accessPoint string, payload map[string]any, ttl time.Duration, cause map[string]any) (*keys.Envelope, error) {
	pinned := ""
	if s.keys.HasPrevious() {
		// Only consulted while a rotation is in flight. Outside one there is a
		// single key, every pin matches it, and a query per command would buy
		// nothing.
		p, err := s.store.PinnedKey(ctx, deviceID)
		if err != nil {
			s.log.Error("read pinned key; signing with the current one",
				"device_id", deviceID, "err", err)
		} else {
			pinned = p
		}
	}
	return s.keys.SignCommandForPin(pinned, cmd, deviceID, accessPoint, payload, ttl, cause)
}
