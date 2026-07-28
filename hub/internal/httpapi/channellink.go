package httpapi

import (
	"errors"
	"net/http"

	"github.com/vul-os/aql/hub/internal/channels"
	"github.com/vul-os/aql/hub/internal/store"
)

// Channel identity linking — the Telegram/Slack/Discord half of what
// phones.go does for WhatsApp.
//
// Same defect, four more rails: channel_identities had no production writer
// either, so those rails resolved every sender to a non-member and refused
// every open. See migrations/0020_channel_link_codes.sql.
//
// # The asymmetry with the phone flow, restated because it governs this file
//
// A phone code names the number that may spend it. A channel code cannot —
// nobody knows their own Telegram numeric id, and learning it is what the
// inbound message is for. So the code alone authorises the binding, and its
// length is the only thing between a stranger and someone else's gate access.
// That is why store.channelCodeLen is twice the phone length, and why nothing
// here should ever "helpfully" shorten it.

// linkableChannels are the rails where an identity binding is meaningful.
//
// WhatsApp is absent on purpose: its identity is a VERIFIED PHONE NUMBER
// (profile_phone_numbers), not a channel_identities row, and it has its own
// stronger ceremony in phones.go. Offering both would create a second, weaker
// path to the same access.
//
// DMTAP is absent because it is a scaffold with a fail-closed transport (see
// channels/dmtap.go); giving it a linking ceremony would imply a rail that
// works.
var linkableChannels = map[string]bool{
	channels.KindTelegram: true,
	channels.KindSlack:    true,
	channels.KindDiscord:  true,
}

type channelLinkReq struct {
	Channel string `json:"channel"`
}

// POST /v1/channels/me/link — mint a code to send on a rail.
func (s *Server) handleChannelLinkStart(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req channelLinkReq
	if !readJSON(w, r, &req) {
		return
	}
	if !linkableChannels[req.Channel] {
		writeErr(w, http.StatusBadRequest, "unsupported_channel")
		return
	}

	code, err := s.store.MintChannelLinkCode(r.Context(), c.Sub, req.Channel)
	switch {
	case errors.Is(err, store.ErrChannelLinkTooMany):
		writeErr(w, http.StatusTooManyRequests, "too_many_link_codes")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "link_failed")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"code":       code.Code,
		"channel":    code.Channel,
		"expires_at": code.ExpiresAt,
		// Server-side wording, so the instruction cannot drift from what the
		// rail actually recognises.
		"instruction": "Send this code as a direct message to the gate bot on " +
			channelDisplayName(code.Channel) + " to finish linking. Anyone who sees this code " +
			"before you use it could link their own account instead, so do not share it.",
	})
}

// GET /v1/channels/me/identities
func (s *Server) handleChannelIdentitiesList(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	ids, err := s.store.ChannelIdentitiesForUser(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"identities": ids})
}

// DELETE /v1/channels/me/identities/{channel}/{external_id}
func (s *Server) handleChannelIdentityUnlink(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	channel := r.PathValue("channel")
	externalID := r.PathValue("external_id")
	if channel == "" || externalID == "" {
		writeErr(w, http.StatusBadRequest, "missing_identity")
		return
	}
	switch err := s.store.UnlinkChannelIdentity(r.Context(), c.Sub, channel, externalID); {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "identity_not_found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "unlink_failed")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func channelDisplayName(kind string) string {
	switch kind {
	case channels.KindTelegram:
		return "Telegram"
	case channels.KindSlack:
		return "Slack"
	case channels.KindDiscord:
		return "Discord"
	}
	return kind
}

const (
	chLinkReplyOK      = "Account linked. You can now use this chat to open the gates you have access to."
	chLinkReplyBad     = "That link code is not valid. Codes expire after 10 minutes — generate a new one in the console."
	chLinkReplyTaken   = "This account is already linked to another profile. Changing that needs an administrator."
	chLinkReplyFailure = "Something went wrong linking this account. Try again shortly."
)

// tryChannelLink attempts to spend an inbound message as a channel link code.
//
// Called by each identity rail BEFORE its membership lookup, for the same
// reason as the phone flow: someone linking is by definition not yet
// recognised, so every check downstream would answer "no access" and stop.
//
// handled=false means the message was not a link code and the caller should
// route it normally.
func (s *Server) tryChannelLink(ctx contextT, channel, externalID, body string) (reply string, handled bool) {
	if !store.LooksLikeChannelLinkCode(body) {
		return "", false
	}
	userID, err := s.store.RedeemChannelLinkCode(ctx, channel, externalID, body)
	switch {
	case errors.Is(err, store.ErrChannelLinkNotFound):
		return chLinkReplyBad, true
	case errors.Is(err, store.ErrChannelIdentityTaken):
		return chLinkReplyTaken, true
	case err != nil:
		s.log.Error("channel link redemption", "channel", channel, "err", err)
		return chLinkReplyFailure, true
	}
	s.log.Info("channel identity linked", "channel", channel, "user", userID)
	return chLinkReplyOK, true
}
