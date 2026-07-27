package httpapi

// Out-of-band delivery seam for account-recovery secrets.
//
// READ THIS BEFORE DEPLOYING FOR MORE THAN ONE PERSON.
//
// This gateway has no mail sender, and this file does not add one. It adds
// the INTERFACE a mail sender would satisfy (RecoveryMailer) plus a default
// implementation, LogRecoveryMailer, that does exactly one thing: it writes
// the recovery link to the operator's own console log and says, in the same
// breath, that it is not delivering anything to anyone.
//
// THE DEFAULT IS NOT A DELIVERY MECHANISM FOR A MULTI-USER INSTALL. On a
// single-operator self-hosted box — the shape this project is built for —
// the person who requests the reset is the person reading the log, so the
// loop genuinely closes and a self-hoster can complete a password reset
// today with no SMTP anywhere. The moment a second person has an account on
// an instance, that stops being true in a specific and dangerous way: the
// operator would be reading OTHER USERS' account-takeover credentials out of
// their own log, and anyone with log access (a shipped log aggregator, a
// support bundle, a `journalctl` on a shared host, a screen-shared terminal)
// silently becomes able to take over any account on the instance. A
// multi-user deployment must inject a real RecoveryMailer via
// Config.RecoveryMailer before enabling account recovery for anyone but the
// operator.
//
// WHY A LOGGING DEFAULT AT ALL, rather than failing closed? Because the
// alternative failure modes are worse. A hard failure would make
// POST /v1/auth/forgot-password return an error only when the account
// EXISTS (there is nothing to send for an account that doesn't), which is
// precisely the user-enumeration oracle the whole endpoint is designed not
// to be. A silent no-op default would leave a self-hoster with a reset flow
// that appears to work and never does. Logging loudly is the only option
// that keeps the endpoint's response uniform AND keeps the operator honestly
// informed about what did and did not happen.
//
// This is also the ONLY place in this codebase where a recovery token is
// permitted to be written anywhere outside the (hashed) database row. No
// handler logs one, no response body carries one, no audit detail records
// one. If a token ever appears in a log line that is not from this file,
// that is a bug.

import (
	"context"
	"log/slog"
	"net/url"
	"strings"
	"time"
)

// RecoveryMailer delivers account-recovery secrets out of band. The two
// methods are separate rather than one generic Send because the two
// messages have genuinely different security meaning — one is an
// account-takeover credential, one is a reachability check — and a real
// implementation will want to word, throttle and possibly route them
// differently.
//
// Implementations MUST treat token as a credential: no persistence, no
// third-party analytics, no inclusion in an error string that propagates
// back to a caller. An error returned here is logged by the caller and
// otherwise swallowed — it never changes the HTTP response, because a
// delivery failure that is visible to the requester is an enumeration
// oracle (see this file's doc comment).
type RecoveryMailer interface {
	// SendPasswordReset delivers a password-reset token to username. expiresAt
	// is the token's hard expiry, for the message body.
	SendPasswordReset(ctx context.Context, username, token string, expiresAt time.Time) error
}

// LogRecoveryMailer is the default RecoveryMailer: it prints the recovery
// link to the operator console, prefixed with an unmissable statement that
// nothing was sent. See this file's doc comment for the exact bound on when
// this is acceptable.
type LogRecoveryMailer struct {
	// Log receives the link. nil falls back to slog.Default().
	Log *slog.Logger
	// PublicURL is the console's base URL, used to build a clickable link.
	// Empty means only the raw token is printed (still usable — the console
	// accepts a pasted token).
	PublicURL string
}

// NoDeliveryWarning is the fixed banner every LogRecoveryMailer line
// carries. Exported so a startup path or a test can assert on it verbatim
// rather than re-typing a string that could drift.
const NoDeliveryWarning = "NO EMAIL WAS SENT — this gateway has no mail sender configured. " +
	"The recovery link below was printed here and NOWHERE ELSE. Anyone who can read this " +
	"log can take over the account it belongs to. Configure a real RecoveryMailer before " +
	"any account other than the operator's exists on this instance."

func (m *LogRecoveryMailer) logger() *slog.Logger {
	if m.Log != nil {
		return m.Log
	}
	return slog.Default()
}

// link builds "<PublicURL><path>?token=<token>", or the bare token when no
// public URL is configured.
func (m *LogRecoveryMailer) link(path, token string) string {
	if strings.TrimSpace(m.PublicURL) == "" {
		return ""
	}
	return strings.TrimRight(m.PublicURL, "/") + path + "?token=" + url.QueryEscape(token)
}

// SendPasswordReset prints the reset link. The console route is
// /reset-password (src/routes.tsx).
func (m *LogRecoveryMailer) SendPasswordReset(_ context.Context, username, token string, expiresAt time.Time) error {
	m.logger().Warn(NoDeliveryWarning,
		"kind", "password_reset",
		"username", username,
		"token", token,
		"link", m.link("/reset-password", token),
		"expires_at", expiresAt.UTC().Format(time.RFC3339),
	)
	return nil
}
