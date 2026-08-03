package e2e

import (
	"net/http"
	"testing"
	"time"
)

// A time-window rule that excludes now must deny the open BEFORE anything
// reaches the controller.
//
// # Why this needed an end-to-end test
//
// The store's own tests prove the decision: timewindows_test.go drives real
// rows through the open path and asserts the reason, including the corrupt-row
// case. What none of them can show is WHERE in the sequence the denial happens,
// because none of them has a controller to reach.
//
// That ordering is the whole security property. A hub that refused the request
// after dispatching it would return a clean refusal to the caller while the gate
// opened — the audit row and the physical world disagreeing, with the log
// reading like a successful refusal. The suite already pins this shape for rate
// limiting (TestRateLimit_NeverReachesController) and for revocation
// (TestRevoke_StopsAGrantOpeningARealController); time windows are the third
// rule that can deny an open and had no equivalent.
//
// The rule installed here covers a single minute far from now, so it is
// deterministic without freezing any clock: whatever the wall time, "now" is
// outside it.
func TestTimeWindow_DenialNeverReachesController(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	// Prove the gate works first. Without this the assertions below are
	// satisfied by a controller that was never going to pulse for any reason.
	if st, delivery, body := gw.open(t, ten, ap); st != 200 || delivery != "acked" {
		t.Fatalf("open before any rule: st=%d delivery=%q body=%v", st, delivery, body)
	}
	if !c.logs.waitLines(1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("the gate did not pulse before any rule was installed; log:\n%s", c.logs.String())
	}
	pulseBefore := c.logs.countLines("relay", "state=pulsing")
	cmdBefore := c.logs.countLines("msg=command")

	// A window that never contains now: one minute, on every day, in a fixed
	// zone. UTC so the assertion does not depend on where the test runs.
	st, body, raw := httpJSON(t, http.MethodPost,
		gw.url+"/v1/accounts/"+ten.accountID+"/time-windows", ten.token, map[string]any{
			"user_id":         ten.userID,
			"access_point_id": ap,
			"tz":              "UTC",
			"windows":         []map[string]any{{"days": "mon-sun", "from": "03:00", "to": "03:01"}},
			"note":            "e2e: a minute that is almost never now",
		})
	if st != http.StatusCreated && st != http.StatusOK {
		t.Fatalf("create time-window rule: status %d body %s", st, raw)
	}

	// The one minute the rule allows. If the suite happens to run inside it the
	// open would legitimately succeed, so skip rather than report a failure
	// that is really a coincidence.
	if now := time.Now().UTC(); now.Hour() == 3 && now.Minute() == 0 {
		t.Skip("the test is running inside the one minute the rule permits")
	}

	st, body, raw = httpJSON(t, http.MethodPost,
		gw.url+"/v1/access-points/"+ap+"/open", ten.token, map[string]any{"source": "api"})
	// 429, not 403. open.go sends 403 only for account_suspended and
	// user_disabled; every other denial — including this one — leaves as a 429
	// carrying the seconds until the window next opens, which is a real and
	// useful number here. I expected 403 writing this and the run corrected me.
	if st != http.StatusTooManyRequests {
		t.Fatalf("open outside the window: status %d (want 429); body %s", st, raw)
	}
	if body["error"] != "outside_time_window" {
		t.Fatalf("open outside the window: error = %v, want outside_time_window; body %s",
			body["error"], raw)
	}

	// The controller must not have seen it. Dispatch is synchronous in the
	// handler, which returned the denial without dispatching; a bounded settle
	// catches one that dispatched first and refused afterwards.
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if got := c.logs.countLines("relay", "state=pulsing"); got != pulseBefore {
			t.Fatalf("the relay pulsed on an open denied by a time window (%d → %d). "+
				"The caller was told 403 and the gate opened anyway.", pulseBefore, got)
		}
		if got := c.logs.countLines("msg=command"); got != cmdBefore {
			t.Fatalf("the controller processed a command for an open denied by a time "+
				"window (%d → %d)", cmdBefore, got)
		}
		time.Sleep(40 * time.Millisecond)
	}
}

// And the other direction: a window that DOES contain now still opens the gate.
//
// The control, and it is not optional. Every assertion above is satisfied by a
// hub that refuses every open once any time-window rule exists — which would
// pass as a security property and be a total loss of function, since the rule's
// purpose is to permit access during the window and not merely to deny it
// outside.
func TestTimeWindow_AnOpenInsideTheWindowStillReachesTheController(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	// The whole day, every day, in UTC: now is always inside it.
	st, _, raw := httpJSON(t, http.MethodPost,
		gw.url+"/v1/accounts/"+ten.accountID+"/time-windows", ten.token, map[string]any{
			"user_id":         ten.userID,
			"access_point_id": ap,
			"tz":              "UTC",
			"windows":         []map[string]any{{"days": "mon-sun", "from": "00:00", "to": "24:00"}},
			"note":            "e2e: always open",
		})
	if st != http.StatusCreated && st != http.StatusOK {
		t.Fatalf("create time-window rule: status %d body %s", st, raw)
	}

	if st, delivery, body := gw.open(t, ten, ap); st != 200 || delivery != "acked" {
		t.Fatalf("open inside the window: st=%d delivery=%q body=%v.\n"+
			"A rule whose window contains now must permit the open — a hub that denies "+
			"whenever any rule exists has turned a schedule into a lockout.",
			st, delivery, body)
	}
	if !c.logs.waitLines(1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("the gate did not pulse for an open inside its window; log:\n%s", c.logs.String())
	}
}
