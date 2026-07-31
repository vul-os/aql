package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// Revoking an issued offline grant, and telling the controllers about it —
// docs/GRANT-REVOCATION.md §6 step 5.

// revokeDispatchTTL bounds how long a signed `revoke` stays valid in a queue.
//
// Generous compared with an `open`, and deliberately: an `open` that arrives
// late opens a gate nobody is standing at, while a `revoke` that arrives late
// is still exactly the right thing to apply. The TTL is a replay bound here,
// not a freshness requirement.
const revokeDispatchTTL = 10 * time.Minute

// revokeAckTimeout is how long to wait for a connected controller. An offline
// one is queued and this returns immediately; the operator is told which
// controllers have confirmed rather than being made to wait for all of them.
const revokeAckTimeout = 3 * time.Second

type revokeGrantResponse struct {
	GrantID string `json:"grant_id"`
	Seq     int64  `json:"seq"`
	// Devices the deny-list was sent to. Named rather than counted, because
	// "2 of 3 controllers know" is only actionable if you know WHICH one does
	// not — that is the gate an operator may still need to latch.
	Dispatched []string `json:"dispatched"`
	// Controllers the hub could not even build a command for. A DIFFERENT
	// failure from an unreachable gate and it must not be reported as one:
	// "no controller could be reached" tells an operator to check the network,
	// when the truth may be that the hub cannot sign. This field exists
	// because the first version had no way to say that, and a JCS error in the
	// payload shape produced a cheerful 200 with nothing sent.
	Failed []string `json:"failed,omitempty"`
}

// handleOfflineGrantRevoke revokes one grant and pushes the updated deny-list
// to every controller it named.
//
// Authorisation: the HOLDER may always revoke their own grant — a lost phone is
// the common case and making someone find an admin first is how a lost phone
// stays live — and an admin of an account owning any device the grant names may
// revoke it, because it is their gate.
func (s *Server) handleOfflineGrantRevoke(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	grantID := r.PathValue("id")
	if grantID == "" {
		writeErr(w, http.StatusBadRequest, "grant_required")
		return
	}

	g, devices, err := s.store.OfflineGrantByID(r.Context(), grantID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "grant_not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	if !s.mayRevokeOfflineGrant(r.Context(), c.Sub, g, devices) {
		// 404, not 403: the same rule the issue path uses. Confirming that a
		// grant id exists tells a stranger which ids are real.
		writeErr(w, http.StatusNotFound, "grant_not_found")
		return
	}

	seq, err := s.store.RevokeOfflineGrant(r.Context(), grantID, c.Sub)
	if errors.Is(err, store.ErrNotFound) {
		// Already revoked. Not an error worth failing on — but it must NOT
		// re-dispatch, because a repeated click would otherwise walk the
		// sequence forward and make every controller re-store an identical
		// list.
		writeErr(w, http.StatusConflict, "grant_not_revocable")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "offline_grant_revoke", "grant", grantID, true,
		map[string]any{"devices": devices, "seq": seq}); err != nil {
		s.log.Error("offline grant revoke audit write failed", "grant_id", grantID, "err", err)
	}

	sent, failed := s.pushDenyLists(r.Context(), devices, seq)
	writeJSON(w, http.StatusOK, revokeGrantResponse{
		GrantID: grantID, Seq: seq, Dispatched: sent, Failed: failed})
}

// mayRevokeOfflineGrant is the authorisation rule, kept out of the handler so
// it can be read on its own.
func (s *Server) mayRevokeOfflineGrant(ctx context.Context, userID string, g store.OfflineGrant, devices []string) bool {
	if g.MemberUserID == userID {
		return true
	}
	for _, dev := range devices {
		acct, err := s.store.DeviceAccountID(ctx, dev)
		if err != nil || acct == "" {
			// A device whose account cannot be resolved grants nothing. Not a
			// reason to refuse outright — another device on the same grant may
			// still authorise — but never a reason to allow.
			continue
		}
		role, err := s.store.MemberRole(ctx, acct, userID)
		if err != nil {
			continue
		}
		if role == "owner" || role == "admin" {
			return true
		}
	}
	return false
}

// pushDenyLists sends each named controller the list as it now stands, and
// returns the devices a signed command was actually dispatched for.
//
// The list is rebuilt PER DEVICE rather than composed once: a controller must
// be told about the grants naming it and no others, both because that is the
// only set it can act on and because the rest are other gates' business.
//
// One `seq` across all of them. The counter is hub-wide, and a controller only
// requires the number to increase — so two controllers holding the same seq
// with different entries is correct, not a collision.
func (s *Server) pushDenyLists(ctx context.Context, devices []string, seq int64) ([]string, []string) {
	now := time.Now().Unix()
	sent := []string{}
	failed := []string{}
	for _, dev := range devices {
		entries, err := s.store.DenyListForDevice(ctx, dev, now)
		if err != nil {
			s.log.Error("build deny-list", "device_id", dev, "err", err)
			failed = append(failed, dev)
			continue
		}
		payload := map[string]any{
			"seq":       seq,
			"issued_at": now,
			"entries":   denyListPayload(entries),
		}
		// signForDevice, NOT keys.SignCommandWithPayload. During a key rotation
		// the hub's current key is the NEW one while an unrepaired controller
		// still pins the old, so signing with the current key produces a
		// badsig at that gate — and this command silently reaching nothing is
		// the worst case available, because a rotation is exactly when an
		// operator is revoking things.
		//
		// This called the current-key signer for two commits. The rule is
		// stated on signForDevice — "every command to a controller must go
		// through here" — and prose did not stop me; TestEveryControllerCommandIsSignedForItsPin
		// does.
		env, err := s.signForDevice(ctx, "revoke", dev, "", payload, revokeDispatchTTL,
			map[string]any{"source": "gateway", "reason": "grant_revocation"})
		if err != nil {
			s.log.Error("sign revoke", "device_id", dev, "err", err)
			failed = append(failed, dev)
			continue
		}
		s.hub.Dispatch(ctx, dev, env, revokeAckTimeout, "")
		sent = append(sent, dev)
	}
	return sent, failed
}

// denyListPayload renders entries as the wire shape proto/commands.md defines.
//
// Always a slice, never nil: `entries` must marshal to `[]` and not `null`, or
// the controller refuses the whole command — which would mean a hub with
// nothing left revoked could never deliver a list saying so.
//
// `[]any`, NOT `[]map[string]any`. The canonicaliser that produces the bytes
// the signature covers accepts only the JSON value types, and a typed slice is
// not one of them — it returned "jcs: unsupported type", the sign failed, the
// loop logged and continued, and the operator got a 200 saying the revocation
// worked with nothing sent anywhere.
func denyListPayload(entries []store.RevocationEntry) []any {
	out := make([]any, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]any{"grant_id": e.GrantID, "exp": e.EXP})
	}
	return out
}

// handleOfflineGrantList returns the grants the caller holds.
//
// Scoped to the caller, always. An admin wanting to see somebody else's grants
// is a different screen with a different authorisation question, and answering
// both from one route is how the narrower one gets widened by accident.
func (s *Server) handleOfflineGrantList(w http.ResponseWriter, req *http.Request) {
	c := claimsFrom(req)
	grants, err := s.store.OfflineGrantsForMember(req.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	type gate struct {
		DeviceID string `json:"device_id"`
		// Reported false = this gate has never said which deny-list it holds.
		// NOT the same as Enforcing false, which is a gate that HAS reported
		// and is behind. One is unknown, the other is known.
		Reported  bool `json:"reported"`
		Enforcing bool `json:"enforcing"`
	}
	type row struct {
		GrantID   string `json:"grant_id"`
		IssuedAt  int64  `json:"issued_at"`
		ExpiresAt int64  `json:"expires_at"`
		Revoked   bool   `json:"revoked"`
		RevokedAt int64  `json:"revoked_at,omitempty"`
		// Which of this grant's gates are actually refusing it. Absent for an
		// active grant, and for one revoked before the hub recorded the
		// sequence — in both cases there is no honest comparison to make, and
		// an empty array would read as "no gates", which is a different claim.
		Gates []gate `json:"gates,omitempty"`
	}
	out := make([]row, 0, len(grants))
	for _, g := range grants {
		r := row{
			GrantID: g.GrantID, IssuedAt: g.IssuedAt, ExpiresAt: g.ExpiresAt,
			Revoked: g.Revoked(), RevokedAt: g.RevokedAt.Int64,
		}
		if g.Revoked() {
			gates, ok, err := s.store.RevocationConvergence(req.Context(), g.GrantID)
			if err != nil {
				s.log.Error("revocation convergence", "grant_id", g.GrantID, "err", err)
			} else if ok {
				for _, e := range gates {
					r.Gates = append(r.Gates, gate{
						DeviceID: e.DeviceID, Reported: e.Reported, Enforcing: e.Enforcing,
					})
				}
			}
		}
		out = append(out, r)
	}
	writeJSON(w, http.StatusOK, map[string]any{"grants": out})
}

var _ = json.Marshal

// pushDenyListOnConnect sends a freshly connected controller the deny-list as
// it stands.
//
// Sent unconditionally, including when the list is EMPTY. An empty list at a
// higher seq is meaningful — it says "nothing is revoked" — and skipping it
// would leave a controller holding stale entries for grants that have since
// expired or whose holder was reinstated, with no way to learn otherwise.
//
// Silent on failure beyond a log line: a controller that misses this keeps the
// list it had, which is the safe direction (absence is never denial, §3.3), and
// it will be offered again on the next reconnect.
func (s *Server) pushDenyListOnConnect(ctx context.Context, deviceID string) {
	seq, err := s.store.RevocationSeq(ctx)
	if err != nil {
		s.log.Error("read revocation seq", "device_id", deviceID, "err", err)
		return
	}
	if seq == 0 {
		// Nothing has ever been revoked on this hub. Seq 0 is the controller's
		// "never received a list" sentinel and it refuses it, so sending one
		// would be a guaranteed-refused command on every connect.
		return
	}
	s.pushDenyLists(ctx, []string{deviceID}, seq)
}
