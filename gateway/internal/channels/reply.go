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
	case "outside_time_window":
		// Distinct from a rate limit on purpose. The retry-after is the same
		// shape, but "too many opens" would tell a resident they tried too
		// often when the truth is that they are not allowed in at this hour —
		// a wrong reason sends someone to argue with the wrong person.
		mins := (retryAfterS + 59) / 60
		if mins < 1 {
			return "Your access to this gate is not open right now. Contact your admin if that looks wrong."
		}
		if mins < 90 {
			return fmt.Sprintf("Your access to this gate is not open right now — it opens again in ~%d min.", mins)
		}
		return fmt.Sprintf("Your access to this gate is not open right now — it opens again in ~%d h.", (mins+59)/60)
	case "outside_geofence":
		// retryAfterS is always 0 here: waiting does not move you, so the
		// "~N min" phrasing every other denial uses would be actively
		// misleading. Tell them the one thing that changes the outcome.
		return "This gate only opens when you're near it, and your phone says you're not. Try again at the gate."
	case "geofence_location_required":
		// The denial every chat-rail user hits, because no rail sends
		// coordinates. Name the fix rather than the fault.
		return "This gate needs your location to open, and none was sent. Open it from the app with location on, or ask your admin."
	case "geofence_invalid", "geofence_unavailable":
		return "This gate's location rule could not be checked, so the gate was not opened. This is a setup problem — contact your admin."
	case "time_window_invalid", "time_window_unavailable":
		// The schedule could not be evaluated, so the open was refused rather
		// than let through. Say that it is a configuration fault and not the
		// resident's, because otherwise they will keep trying.
		return "This gate's access schedule could not be checked, so the gate was not opened. This is a setup problem — contact your admin."
	case "rate_limited":
		mins := (retryAfterS + 59) / 60
		if mins < 1 {
			mins = 1
		}
		return fmt.Sprintf("Too many opens — try again in ~%d min.", mins)
	}

	// UNKNOWN REASON. This branch used to be `default: // rate_limited`, and
	// three separate features shipped through it: schedule denials, then
	// geofence denials, each telling a resident "Too many opens — try again in
	// ~N min." The minutes were right and the cause was a lie, and in the
	// geofence case it told them to do the one thing that could not possibly
	// work, because waiting does not move you closer to a gate.
	//
	// A default that silently absorbs new reasons is a fail-open in the copy.
	// So the fallback now says only what is certainly true — the gate did not
	// open, and here is the reason code — rather than inventing a cause. It is
	// worse prose and it cannot lie. DenialReasons() plus the test in
	// reply_test.go make a missing case a build-time failure rather than a
	// message a resident acts on.
	if reason == "" {
		return "The gate was not opened. Contact your admin if that looks wrong."
	}
	return fmt.Sprintf("The gate was not opened (%s). Contact your admin if that looks wrong.", reason)
}

// DenialReasons is every reason the open path can produce. It exists so a test
// can assert each one has a message, which is the only thing that stops a
// fourth feature quietly reusing someone else's copy.
func DenialReasons() []string {
	return []string{
		"account_suspended", "user_disabled", "quota_exceeded", "rate_limited",
		"outside_time_window", "time_window_invalid", "time_window_unavailable",
		"outside_geofence", "geofence_location_required",
		"geofence_invalid", "geofence_unavailable",
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
