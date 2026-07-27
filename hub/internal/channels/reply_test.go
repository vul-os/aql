package channels

import (
	"strings"
	"testing"
)

// A denial reason a resident reads has to be the real one. Before this, a
// schedule denial fell through to the rate-limit default and said "Too many
// opens" — the minutes were right and the cause was a lie, which sends someone
// to argue with the wrong person or to keep retrying something that will not
// work until Monday.
func TestScheduleDenialDoesNotMasqueradeAsARateLimit(t *testing.T) {
	for _, reason := range []string{"outside_time_window", "time_window_invalid", "time_window_unavailable"} {
		msg := DenialMessage(reason, 600, "https://x")
		if strings.Contains(strings.ToLower(msg), "too many") {
			t.Errorf("%s reads as a rate limit: %q", reason, msg)
		}
		if msg == DenialMessage("rate_limited", 600, "https://x") {
			t.Errorf("%s is indistinguishable from a rate limit", reason)
		}
	}
}

// The two failure kinds must not read the same either: "you are not allowed in
// now" is the resident's problem to wait out, "the schedule could not be
// checked" is the operator's to fix.
func TestUnevaluableScheduleReadsAsASetupFault(t *testing.T) {
	broken := DenialMessage("time_window_invalid", 0, "https://x")
	if !strings.Contains(strings.ToLower(broken), "admin") {
		t.Errorf("a schedule that could not be evaluated should point at the operator: %q", broken)
	}
	if broken == DenialMessage("outside_time_window", 600, "https://x") {
		t.Error("a broken schedule and a closed one are different problems")
	}
}

// The same bug the schedule reasons had: without a case, every geofence denial
// fell through to "Too many opens — try again in ~1 min." Waiting does not move
// you closer to a gate, so that message is not merely wrong about the cause, it
// tells the resident to do something that cannot possibly work.
func TestGeofenceDenialsDoNotReadAsRateLimits(t *testing.T) {
	for _, reason := range []string{
		"outside_geofence", "geofence_location_required",
		"geofence_invalid", "geofence_unavailable",
	} {
		msg := DenialMessage(reason, 0, "https://x")
		low := strings.ToLower(msg)
		if strings.Contains(low, "too many") {
			t.Errorf("%s reads as a rate limit: %q", reason, msg)
		}
		if strings.Contains(low, "try again in") {
			t.Errorf("%s tells the resident to wait, which cannot help: %q", reason, msg)
		}
	}
}

// "You are in the wrong place" and "you sent no location at all" are different
// problems with different fixes — one is solved by walking to the gate, the
// other by turning location on.
func TestMissingLocationIsDistinctFromBeingTooFarAway(t *testing.T) {
	if DenialMessage("geofence_location_required", 0, "https://x") ==
		DenialMessage("outside_geofence", 0, "https://x") {
		t.Fatal("a missing location and a distant one must not read the same")
	}
}

// The structural fix. Three features shipped a denial that read as a rate
// limit, because DenialMessage's default branch silently absorbed any reason it
// did not know. This asserts every reason the open path can produce has copy of
// its own — so the fourth one fails here rather than in front of a resident.
func TestEveryDenialReasonHasItsOwnMessage(t *testing.T) {
	rateLimited := DenialMessage("rate_limited", 600, "https://x")
	seen := map[string]string{}
	for _, reason := range DenialReasons() {
		msg := DenialMessage(reason, 600, "https://x")

		if strings.Contains(msg, reason) {
			t.Errorf("%s falls through to the unknown-reason fallback — it has no "+
				"message of its own, so a resident is shown a reason code", reason)
		}
		if reason != "rate_limited" && msg == rateLimited {
			t.Errorf("%s is word-for-word the rate-limit message; that is the bug "+
				"this test exists to prevent", reason)
		}
		if prev, dup := seen[msg]; dup && !deliberatelyShared(reason, prev) {
			t.Errorf("%s and %s render identically, so a resident cannot tell "+
				"which happened: %q", reason, prev, msg)
		}
		seen[msg] = reason
	}
}

// The fallback must not invent a cause. It can say the gate did not open,
// because that is certainly true, and nothing else.
func TestUnknownReasonFallbackInventsNothing(t *testing.T) {
	msg := DenialMessage("some_future_reason", 600, "https://x")
	low := strings.ToLower(msg)
	for _, lie := range []string{"too many", "try again in", "limit reached", "suspended"} {
		if strings.Contains(low, lie) {
			t.Errorf("the fallback claims %q for an unknown reason: %q", lie, msg)
		}
	}
	if !strings.Contains(msg, "some_future_reason") {
		t.Error("the fallback should surface the reason code, so an operator " +
			"reading a screenshot can act on it")
	}
}

// Two pairs share copy on purpose: from the resident's side, a rule that is
// invalid and one that could not be evaluated are the same problem — the gate
// did not open and an operator has to fix something. They cannot act on the
// difference, so splitting the message would be detail for its own sake. The
// distinction is preserved where it is useful, in the audit row.
func deliberatelyShared(a, b string) bool {
	pairs := [][2]string{
		{"time_window_invalid", "time_window_unavailable"},
		{"geofence_invalid", "geofence_unavailable"},
	}
	for _, p := range pairs {
		if (a == p[0] && b == p[1]) || (a == p[1] && b == p[0]) {
			return true
		}
	}
	return false
}
