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
