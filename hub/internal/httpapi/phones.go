package httpapi

import (
	"errors"
	"net/http"

	"github.com/vul-os/aql/hub/internal/store"
)

// The caller's own phone numbers, and the ceremony that verifies one
// (docs/PHONE-LINKING.md).
//
// Why this matters more than a settings screen usually would: every chat-rail
// lookup requires a VERIFIED number, and until migration 0018 nothing in
// production could produce one — store.AddVerifiedPhone had test callers and
// no others. The WhatsApp, Telegram and Slack rails were built, tested and
// documented as shipped, and on a real deployment every one of them refused
// every open, because no member could ever be recognised. These three routes
// are the missing half.
//
// The ceremony, in one line: the console shows a code (proving an
// authenticated session on this account) and the member sends it to the bot
// from the number being linked (proving control of the number, via the
// provider's signature on the inbound webhook). No SMS and no email — this
// hub sends neither, deliberately.

type linkPhoneReq struct {
	PhoneE164 string `json:"phone_e164"`
}

// POST /v1/phones/me/link — mint a code for a number.
//
// Minting deliberately requires no proof that the caller controls the number.
// It cannot: proving that is what the ceremony exists for. What makes this
// safe is that the code it returns can only ever be spent BY that number
// (store.RedeemPhoneLinkCode), so a code minted against someone else's phone
// is useless to the person who minted it.
func (s *Server) handlePhoneLinkStart(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req linkPhoneReq
	if !readJSON(w, r, &req) {
		return
	}
	if !phoneE164Re.MatchString(req.PhoneE164) {
		writeErr(w, http.StatusBadRequest, "invalid_phone")
		return
	}

	code, err := s.store.MintPhoneLinkCode(r.Context(), c.Sub, req.PhoneE164)
	switch {
	case errors.Is(err, store.ErrPhoneTakenByAnother):
		// The design's "fail loudly". Moving a verified number between
		// profiles is a support operation with a human in it, not an API
		// call, and saying so is more useful than a generic refusal.
		writeErr(w, http.StatusConflict, "phone_verified_elsewhere")
		return
	case errors.Is(err, store.ErrPhoneLinkTooMany):
		writeErr(w, http.StatusTooManyRequests, "too_many_link_codes")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "link_failed")
		return
	}

	// The plaintext code exists only here — it is stored hashed and cannot be
	// re-read, so a lost code means minting another.
	writeJSON(w, http.StatusCreated, map[string]any{
		"code":       code.Code,
		"phone_e164": code.PhoneE164,
		"expires_at": code.ExpiresAt,
		// The exact instruction the console shows, kept server-side so the
		// wording cannot drift from the channel that has to recognise it.
		"instruction": "Send this code to the gate bot from " + code.PhoneE164 + " to finish linking.",
	})
}

// GET /v1/phones/me/phones — the caller's own numbers.
//
// Unverified rows are included on purpose: a number linked by accepting an
// invite is real and unverified, and hiding it would leave the member with no
// way to understand why their chat messages are ignored.
func (s *Server) handlePhonesList(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	phones, err := s.store.PhonesForUser(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"phones": phones})
}

// DELETE /v1/phones/me/phones/{id} — unlink one of the caller's numbers.
//
// "The easy half, and it must not be forgotten": a number you can add and
// never remove is worse than one you cannot add. Ownership is enforced inside
// the DELETE rather than by a prior read, so another member's row is
// unreachable and indistinguishable from a nonexistent one.
func (s *Server) handlePhoneUnlink(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "missing_id")
		return
	}
	switch err := s.store.UnlinkPhone(r.Context(), c.Sub, id); {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "phone_not_found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "unlink_failed")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
