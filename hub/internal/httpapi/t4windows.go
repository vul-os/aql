package httpapi

// Arming and disarming T4 chat windows — the operator surface for "the mower
// may be started from chat for the next 30 minutes". Storage and the atomic
// claim live in internal/store/t4window.go; the schema rationale is in
// migrations/0033_chat_t4_windows.sql.
//
// ARMING IS ADMIN-ONLY, and this is the least negotiable gate in the file. A
// window decides whether a text message can start a mower blade. §3.3's T4 row
// asks for "a member holding an explicit operator-granted role", and admin is
// the role this product has; inventing a second notion of privilege here would
// mean two answers to "who may do this" and eventually a disagreement.
//
// READS ARE ADMIN-ONLY TOO, unlike time-window rules.
//
// That difference is deliberate rather than an oversight of the pattern. A
// time-window rule is about the reader — "may I get in at 3am" — and a member
// reading their own schedule learns nothing about anyone else. A T4 window is
// about a DEVICE, and the list answers "which hazardous verbs are currently
// reachable from chat, and until when". That is a map of what is briefly
// possible, and it is not the sort of thing to hand to every linked member.
//
// WHAT THIS DOES NOT DO. Arming a window does not make T4 reachable over chat.
// The chat surface refuses every T4 verb today — chatSendableVerbs does not
// carry one, and chatTierCeiling is TierReversible — and it will keep refusing
// until step-up on a second rail exists. §3.3 requires the operator role, the
// confirmation and the step-up independently, so a window is one of three and
// on its own is inert. Said out loud because a route that appears to arm
// something dangerous invites the reading that it did.

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
)

// t4WindowMaxDurationS caps how long a window may be armed for.
//
// Four hours. A window is a deliberate, attended act — "I am about to mow" —
// and the failure this bounds is the one that actually happens: an operator
// arms something to get on with the afternoon and forgets. An unbounded window
// is a permanent permission wearing a temporary name.
//
// A constant rather than configuration, for the same reason chatTierCeiling is:
// raising it changes how long a text message can start a blade, and that
// belongs in a reviewed diff.
const t4WindowMaxDurationS = 4 * 60 * 60

type t4WindowArmReq struct {
	DeviceKey string `json:"device_key"`
	Verb      string `json:"verb"`
	// Seconds from now. A DURATION rather than an end timestamp: an operator
	// arming from a browser means "for the next half hour", and a client clock
	// that is wrong would otherwise arm a window the hub reads differently from
	// the person who set it.
	DurationS int64 `json:"duration_s"`
	// Optional cap on how many times the window may be used. Absent means no
	// cap within the duration.
	MaxUses int64  `json:"max_uses"`
	Notes   string `json:"notes"`
}

func t4WindowJSON(w store.T4Window, nowUnix int64) map[string]any {
	var maxUses any
	if w.MaxUses.Valid {
		maxUses = w.MaxUses.Int64
	}
	return map[string]any{
		"id":         w.ID,
		"device_key": w.DeviceKey,
		"verb":       w.Verb,
		"armed_by":   w.ArmedByUserID,
		"starts_at":  w.StartsAt,
		"ends_at":    w.EndsAt,
		"max_uses":   maxUses,
		"uses_count": w.UsesCount,
		// The DERIVED status, not the stored one. A console showing "active"
		// for a window that ended an hour ago would be reporting the column
		// rather than the truth, and the column is deliberately not the truth
		// here — see t4window.go on why expiry is not written back.
		"status":     w.EffectiveStatus(nowUnix),
		"notes":      w.Notes,
		"created_at": w.CreatedAt,
	}
}

// GET /v1/accounts/{id}/t4-windows
func (s *Server) handleT4WindowsList(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	windows, err := s.store.T4WindowsByAccount(r.Context(), accountID, 100)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	nowUnix := time.Now().Unix()
	out := make([]map[string]any, 0, len(windows))
	for _, win := range windows {
		out = append(out, t4WindowJSON(win, nowUnix))
	}
	writeJSON(w, http.StatusOK, map[string]any{"t4_windows": out})
}

// POST /v1/accounts/{id}/t4-windows
func (s *Server) handleT4WindowArm(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	var req t4WindowArmReq
	if !readJSON(w, r, &req) {
		return
	}

	// The REGISTRY is the authority on what a device is and what tier a verb
	// carries. This handler re-derives neither; it asks, and refuses when the
	// answer is not the one that would make a window meaningful.
	reg := s.registry()
	if reg == nil {
		writeErr(w, http.StatusServiceUnavailable, "engine_unavailable")
		return
	}
	dev, found := reg.Get(strings.TrimSpace(req.DeviceKey))
	if !found {
		writeErr(w, http.StatusBadRequest, "unknown_device")
		return
	}
	verb := devices.Verb(strings.TrimSpace(req.Verb))
	spec, _, supported := dev.Device.Supports(verb)
	if !supported {
		writeErr(w, http.StatusBadRequest, "unsupported_verb")
		return
	}

	// A window below T4 is refused rather than quietly allowed.
	//
	// It would be harmless in the sense that nothing consults a window for a T1
	// verb — but an operator who armed one would believe they had done
	// something, and a list full of windows that mean nothing is how the ones
	// that DO mean something stop being read. The refusal names the tier so the
	// message is "you did not need to" rather than "no".
	// Two-sided, and the upper bound is not decoration. `TierRefused` sits ABOVE
	// TierHazardousMotion in the ladder — it means "never actuable from a remote
	// surface, whatever the caller" — so `< TierHazardousMotion` alone lets it
	// through. Nothing would ever actuate (Registry.Resolve refuses anything
	// Tier.Allowed() rejects, and the chat path resolves before it does
	// anything), but an operator could arm a window that can never be consumed,
	// which is exactly the state ArmT4Window's zero-use-cap check exists to
	// refuse: a window that silently never works is worse than an error here.
	//
	// Latent today — no capability in the catalogue declares TierRefused, and
	// devices/tierinvariants_test.go holds that. Written two-sided anyway,
	// because the cost is one clause and the failure would be silent.
	if !spec.Tier.Allowed() {
		writeErr(w, http.StatusBadRequest, "verb_not_actuable")
		return
	}
	if spec.Tier < devices.TierHazardousMotion {
		writeErr(w, http.StatusBadRequest, "verb_below_t4")
		return
	}

	if req.DurationS <= 0 || req.DurationS > t4WindowMaxDurationS {
		writeErr(w, http.StatusBadRequest, "invalid_duration")
		return
	}
	if req.MaxUses < 0 {
		writeErr(w, http.StatusBadRequest, "invalid_max_uses")
		return
	}
	maxUses := sql.NullInt64{}
	if req.MaxUses > 0 {
		maxUses = sql.NullInt64{Int64: req.MaxUses, Valid: true}
	}

	// Starts NOW. There is no scheduled-arming form, and adding one would mean
	// a window an operator armed and then walked away from before it opened —
	// the attended-act property is the whole argument for the feature.
	startsAt := time.Now().Unix()
	win, err := s.store.ArmT4Window(r.Context(), store.T4WindowArgs{
		AccountID:     accountID,
		DeviceKey:     dev.Key,
		Verb:          string(verb),
		ArmedByUserID: claimsFrom(r).Sub,
		StartsAt:      startsAt,
		EndsAt:        startsAt + req.DurationS,
		MaxUses:       maxUses,
		Notes:         strings.TrimSpace(req.Notes),
	})
	if errors.Is(err, store.ErrWindowInvalid) {
		writeErr(w, http.StatusBadRequest, "invalid_window")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	// Arming is an operator decision about a hazardous verb, so it goes in the
	// audit trail with everything else that opens something.
	if err := s.store.LogDeviceCommand(r.Context(), store.DeviceCommandLog{
		DeviceKey: dev.Key,
		AccountID: accountID,
		UserID:    claimsFrom(r).Sub,
		// Not the verb itself: nothing was actuated, and a log line reading
		// `start` against a mower that never moved would be the worst kind of
		// wrong entry to find later.
		Command: "t4-window:arm:" + string(verb),
		Source:  "console",
		Success: true,
	}); err != nil {
		s.log.Error("log t4 window arm", "err", err)
	}

	writeJSON(w, http.StatusCreated, t4WindowJSON(*win, startsAt))
}

// POST /v1/accounts/{id}/t4-windows/{windowID}/disarm
func (s *Server) handleT4WindowDisarm(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	if !isAdminRole(role) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	windowID := r.PathValue("windowID")

	// Read first only to distinguish "no such window" from "already closed".
	// The disarm itself is still conditional in its own WHERE, so this read is
	// not load-bearing and two operators racing here both get a correct answer.
	existing, err := s.store.T4WindowByID(r.Context(), accountID, windowID)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	disarmed, err := s.store.DisarmT4Window(r.Context(), accountID, windowID, claimsFrom(r).Sub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if disarmed {
		if err := s.store.LogDeviceCommand(r.Context(), store.DeviceCommandLog{
			DeviceKey: existing.DeviceKey,
			AccountID: accountID,
			UserID:    claimsFrom(r).Sub,
			Command:   "t4-window:disarm:" + existing.Verb,
			Source:    "console",
			Success:   true,
		}); err != nil {
			s.log.Error("log t4 window disarm", "err", err)
		}
	}

	// 200 either way. Disarming an already-closed window is not an error — the
	// operator wanted it shut and it is shut — and answering 409 would invite a
	// console to show a failure for an outcome that is exactly what was asked
	// for.
	fresh, err := s.store.T4WindowByID(r.Context(), accountID, windowID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, t4WindowJSON(*fresh, time.Now().Unix()))
}
