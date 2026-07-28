package httpapi

import (
	"errors"

	"github.com/vul-os/aql/hub/internal/store"
)

// The channel half of phone linking — docs/PHONE-LINKING.md § 4.3, "the one
// that deserves an adversarial read before it merges". So, the read:
//
// # Why this runs before the membership check
//
// Someone linking a number is BY DEFINITION not yet recognised: their phone
// has no verified row, so every access lookup returns nothing and the rail
// would answer "you have no access here" and stop. The redemption attempt
// therefore has to happen before any of that, which means this is the one
// code path a complete stranger can reach by messaging the bot.
//
// What a stranger can do with it, exhaustively:
//
//   - Send a string that is not a link code. LooksLikeLinkCode rejects it
//     without touching the database, so ordinary chatter cannot burn attempts
//     against a code that happens to exist.
//   - Send a well-formed code that does not exist. One indexed lookup, then a
//     uniform refusal.
//   - Send a well-formed code that DOES exist but was minted for a different
//     number. Refused identically to the previous case — the redemption is
//     bound to the number that sends it. This is the check the whole ceremony
//     rests on: without it, anyone could mint a code against a victim's number
//     and redeem it from their own handset, which is precisely the squatting
//     attack that made invite-accept stop auto-verifying phones.
//   - Guess repeatedly. Bounded twice over: NoteChatMessage throttles this
//     sender to ChatMsgsPerMin (10 by default) BEFORE the message reaches
//     here, and each code dies after PhoneLinkMaxAttempts. A code also lives
//     only ten minutes.
//
// What a stranger cannot do is make anything happen to a number they do not
// hold, which is the property that matters: the inbound webhook's signature
// is what proves the sender's number, and that check has already run in the
// caller.
//
// # Why the failure replies are uniform
//
// "No such code", "expired", "already used" and "that code is not for this
// number" are one message. The differences would tell a sender whether a code
// exists — and the last one in particular would confirm that some OTHER
// number is mid-link, which is information about a third party.
//
// The single exception is a number already verified to another profile. The
// design calls for failing loudly there, and it leaks nothing: the sender has
// just proven they hold the number, so they are entitled to know it is spoken
// for, and a silent refusal would read as a broken product rather than as the
// support case it is.
//
// # Why WhatsApp only
//
// Telegram, Slack and Discord identify a sender by a platform account id, not
// a phone number, so there is no number for a code to be bound to and this
// ceremony says nothing about them. Their identity binding is a separate
// unsolved problem; pretending this covers it would be worse than leaving it
// open.

const (
	linkReplyOK      = "Number linked. You can now use this chat to open the gates you have access to."
	linkReplyBad     = "That link code is not valid. Codes expire after 10 minutes — generate a new one in the console and send it from this number."
	linkReplyTaken   = "That number is already verified on another profile. Moving it needs an administrator, not a code."
	linkReplyFailure = "Something went wrong linking that number. Try again shortly."
)

// tryPhoneLink attempts to spend an inbound message as a link code.
//
// handled=false means the message was not a link code at all and the caller
// should carry on with its normal routing. handled=true means the message was
// consumed here and reply is what to send back.
func (s *Server) tryPhoneLink(ctx contextT, senderPhone, body string) (reply string, handled bool) {
	if !store.LooksLikeLinkCode(body) {
		return "", false
	}
	userID, err := s.store.RedeemPhoneLinkCode(ctx, senderPhone, body)
	switch {
	case errors.Is(err, store.ErrPhoneLinkNotFound):
		return linkReplyBad, true
	case errors.Is(err, store.ErrPhoneTakenByAnother):
		return linkReplyTaken, true
	case err != nil:
		s.log.Error("phone link redemption", "err", err)
		return linkReplyFailure, true
	}
	// Logged without the code: it is single-use and now spent, but there is
	// no reason for a credential to reach a log line at all.
	s.log.Info("phone linked via chat", "user", userID)
	return linkReplyOK, true
}
