package channels

import (
	"fmt"
	"strconv"
	"strings"
)

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// DenialMessage is the honest, user-facing copy for a denied OPEN attempt,
// shared by every channel (backend lib/rate-limit.ts chatDenialMessage). The
// exact strings are a behavioral contract — a denial never pretends the gate
// opened.
func DenialMessage(reason string, retryAfterS int64, publicURL string) string {
	switch reason {
	case "account_suspended":
		return "This account has been suspended by the hub operator — the gate cannot be opened. Contact your operator for help."
	case "user_disabled":
		return "Your Aql user has been disabled by the hub operator — the gate cannot be opened. Contact your operator for help."
	case "quota_exceeded":
		return "Daily limit reached for this location — contact your admin. The web portal: " + trimURL(publicURL) + "/app"
	default: // rate_limited
		mins := (retryAfterS + 59) / 60
		if mins < 1 {
			mins = 1
		}
		return fmt.Sprintf("Too many opens — try again in ~%d min.", mins)
	}
}

func trimURL(u string) string { return strings.TrimRight(u, "/") }

// TruncationNotice is the honest "this list is incomplete" line every picker
// appends when it cannot show every candidate, and "" when it showed them all.
// Every rail caps its picker (PickerCapacity, SlackMaxBlocks); a cap that
// drops rows without saying so leaves a resident looking at a list they have
// no reason to doubt. Same discipline as DenialMessage: the reply never
// implies something it did not do.
func TruncationNotice(shown, total int, publicURL string) string {
	if total <= shown {
		return ""
	}
	msg := fmt.Sprintf("Showing %d of %d — this list is incomplete.", shown, total)
	if u := trimURL(publicURL); u != "" {
		return msg + " See all of them here: " + u + "/app"
	}
	return msg + " See all of them in the web portal."
}

// withTruncationNotice appends the notice to a reply body when one is due.
func withTruncationNotice(body string, shown, total int, publicURL string) string {
	if n := TruncationNotice(shown, total, publicURL); n != "" {
		return body + "\n\n" + n
	}
	return body
}

// UnknownSelectionMessage is the reply to an interactive selection this
// gateway did not mint or no longer recognises (ParseSelection ok=false).
// It actuates nothing and names no gate.
const UnknownSelectionMessage = `Sorry, I didn't recognise that button — nothing was opened. Send "menu" to see your gates.`
