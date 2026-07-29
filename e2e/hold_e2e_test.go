package e2e

// `hold` against the real binaries — the first payload-carrying command to be
// proved end to end.
//
// Every other command the hub sends is bare: open, close, and the clock-sync
// ping. `hold` is the first whose PAYLOAD changes what the controller does,
// and the payload is covered by the signature, so this exercises a path
// nothing had: hub signs a map, controller canonicalises the same map, the
// signature matches, and the value inside it reaches the actuation.
//
// That matters beyond hold. `config` retunes a relay through the same
// mechanism and `repair` will eventually replace a pinned key through it. If
// payload canonicalisation disagreed between the two modules by so much as a
// key ordering, every one of them would fail signature verification — and the
// unit tests on each side would still pass, because each side agrees with
// itself.

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestHold_Acked(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	st, body, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/access-points/"+ap+"/hold",
		ten.token, map[string]any{"source": "api"})
	if st != http.StatusOK {
		t.Fatalf("hold: %d %s", st, raw)
	}
	if body["delivery"] != "acked" || body["command"] != "hold" {
		t.Fatalf("hold body = %v, want delivery=acked command=hold", body)
	}
	// `held`, not `opened`: the controller reports a distinct result for a
	// gate left standing open, and flattening it would lose the only fact
	// that distinguishes the two at the audit layer.
	if !c.logs.waitLines(1, 3*time.Second, "msg=command", "cmd=hold", "result=held") {
		t.Fatalf("controller did not record cmd=hold result=held; log:\n%s", c.logs.String())
	}
}

// The payload actually crosses the wire and survives signing.
//
// A `seconds` the controller ignored would be invisible: the gate still holds,
// the ack still says held, and only the release timing — minutes later —
// would differ. So this asserts the controller ACCEPTED the signed envelope
// carrying a payload at all, which is the part that would break if the two
// modules canonicalised it differently.
func TestHold_WithSecondsIsAcceptedAndSigned(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	st, body, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/access-points/"+ap+"/hold",
		ten.token, map[string]any{"source": "api", "seconds": 90})
	if st != http.StatusOK {
		t.Fatalf("hold with seconds: %d %s", st, raw)
	}
	if body["delivery"] != "acked" {
		t.Fatalf("delivery = %v, want acked — a payload that broke the signature would "+
			"show up here as a refusal, not as a wrong duration", body["delivery"])
	}
	if !c.logs.waitLines(1, 3*time.Second, "msg=command", "cmd=hold", "result=held") {
		t.Fatalf("controller refused a hold carrying a payload; log:\n%s", c.logs.String())
	}
	// And no signature failure anywhere in the controller's log. The
	// controller answers a bad signature with a denial rather than an error,
	// so an ack alone does not prove the payload verified — this does.
	if log := c.logs.String(); strings.Contains(log, "badsig") || strings.Contains(log, "bad_sig") {
		t.Fatalf("controller reported a signature failure on a payload-carrying command; log:\n%s", log)
	}
}

// A hold is refused wherever an open is. This is the property the hub-side
// tests assert against a fake; here it is proved against the real binary, and
// with the controller watching — nothing may reach it.
func TestHold_RateLimitNeverReachesController(t *testing.T) {
	// The default per-access-point open cooldown (10s) is enough: the second
	// call lands well inside it, exactly as TestRateLimit_NeverReachesController
	// relies on.
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)

	if st, _, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/access-points/"+ap+"/open",
		ten.token, map[string]any{"source": "api"}); st != http.StatusOK {
		t.Fatalf("first open: %d %s", st, raw)
	}
	st, _, raw := httpJSON(t, http.MethodPost, gw.url+"/v1/access-points/"+ap+"/hold",
		ten.token, map[string]any{"source": "api"})
	if st != http.StatusTooManyRequests {
		t.Fatalf(`hold after an exhausted open budget = %d %s, want 429.

A hold that had its own budget would let someone alternate open and hold and
get through twice as often as either permits.`, st, raw)
	}
	// The denial must happen at the hub. A command that reached the controller
	// and was refused there would still have been signed and dispatched.
	time.Sleep(500 * time.Millisecond)
	if strings.Contains(c.logs.String(), "cmd=hold") {
		t.Fatalf("a rate-limited hold still reached the controller; log:\n%s", c.logs.String())
	}
}
