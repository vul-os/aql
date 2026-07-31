package e2e

import (
	"net/http"
	"testing"
	"time"
)

// Rotating the hub's signing key must not orphan a controller.
//
// This is the highest-stakes flow across the two binaries and it had no e2e
// coverage. Both halves are unit-tested — the hub signs a `repair` with the key
// the controller currently PINS, the controller applies it through the one
// permitted door — and neither test can see the failure that matters: the hub
// moving to a new key while a controller is still pinned to the old one. That
// controller then rejects every command it is sent, cannot be repaired (the
// repair itself would be signed by a key it does not trust), and is recoverable
// only by physically factory-resetting it.
//
// "The gate still opens" is NOT sufficient on its own, and finding that out is
// most of what this test taught. The hub signs every command for the key that
// controller currently PINS, so an unrepaired controller keeps working — which
// is the point of two-key retention and is exactly right. Both tampers below
// (a repair signed with the wrong key, a controller ignoring repairs entirely)
// therefore left the gate opening happily, and the first version of this test
// passed through both.
//
// So it asserts three things together: the controller is RECORDED as repaired,
// the hub's key actually changed, and the gate still opens. The first is what
// makes the other two mean anything.
func TestKeyRotation_TheGateStillOpensAfterwards(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "sim-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)

	// startController, not startSim: the sim serves the fixed access points
	// "main"/"pedestrian", so an open addressed to this AP's id comes back
	// wrong_access_point — which still ACKS, and so still looked like success
	// until this test started asserting the relay.
	s := startController(t, gw, ten, dev, claim, ap)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)

	// Baseline. Without it a rotation that bricks the controller looks the same
	// as one that works, because both end with a gate that will not open for a
	// reason this test never established.
	if st, delivery, body := gw.open(t, ten, ap); st != http.StatusOK || delivery != "acked" {
		t.Fatalf("open before rotation: status=%d delivery=%q body=%v", st, delivery, body)
	}
	// The relay log is written asynchronously, so this waits rather than
	// counting immediately — an immediate count reads 0 and makes the baseline
	// look like a gate that never opened.
	if !s.logs.waitLines(1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("the baseline open never pulsed the relay; sim log:\n%s", s.logs.String())
	}

	st, before, raw := httpJSON(t, http.MethodGet, gw.url+"/v1/admin/gateway-key/rotation", ten.token, nil)
	if st != http.StatusOK {
		t.Fatalf("rotation status: %d %s", st, raw)
	}
	oldPub, _ := before["current_pubkey"].(string)
	if oldPub == "" {
		t.Fatalf("no current_pubkey before rotation: %v", before)
	}

	st, _, raw = httpJSON(t, http.MethodPost, gw.url+"/v1/admin/gateway-key/rotation", ten.token,
		map[string]any{"reason": "e2e"})
	if st != http.StatusOK && st != http.StatusCreated && st != http.StatusAccepted {
		t.Fatalf("start rotation: %d %s", st, raw)
	}

	// Wait for the controller to be recorded as repaired. The hub dispatches
	// the repair and marks it on the ack, so this is the hub observing the
	// CONTROLLER move, not the hub asserting its own success.
	deadline := time.Now().Add(20 * time.Second)
	var status map[string]any
	repaired := false
	for time.Now().Before(deadline) {
		_, status, _ = httpJSON(t, http.MethodGet, gw.url+"/v1/admin/gateway-key/rotation", ten.token, nil)
		// A rotation that has CLEARED is the strongest form of done: the hub
		// destroys the retained key only when nothing pins it any more, so
		// `rotating: false` after a start means every controller moved.
		if status["rotating"] == false {
			repaired = true
			break
		}
		if ctls, ok := status["controllers"].([]any); ok && len(ctls) > 0 {
			m, _ := ctls[0].(map[string]any)
			if m != nil && m["repaired"] == true {
				repaired = true
				break
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !repaired {
		t.Fatalf("the controller never repaired: %v\nsim log:\n%s", status, s.logs.String())
	}

	newPub, _ := status["current_pubkey"].(string)
	if newPub == "" {
		_, st2, _ := httpJSON(t, http.MethodGet, gw.url+"/v1/admin/gateway-key/rotation", ten.token, nil)
		newPub, _ = st2["current_pubkey"].(string)
	}
	if newPub != "" && newPub == oldPub {
		t.Fatalf("the hub is still signing with the old key %q — nothing rotated", oldPub)
	}

	// THE ASSERTION, and it must be the RELAY, not the delivery.
	//
	// `delivery == "acked"` says the controller answered — and a controller
	// that rejects the command as badsig answers too, with a refusal. So an
	// orphaned controller acks exactly like a healthy one at that level, and
	// the first version of this test checked precisely that and passed through
	// both tampers below.
	//
	// The relay pulsing cannot be faked by a refusal: it is the gate moving.
	pulsesBefore := s.logs.countLines("relay", "state=pulsing")
	if pulsesBefore < 1 {
		t.Fatalf("the baseline open never pulsed the relay (%d) — this test has no "+
			"before-state to compare against", pulsesBefore)
	}
	deadline = time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		gw.open(t, ten, ap)
		if s.logs.countLines("relay", "state=pulsing") > pulsesBefore {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatalf("after rotation the relay never pulsed again — the controller is refusing the "+
		"hub's commands, which for a real gate means orphaned and recoverable only by a "+
		"physical factory reset; sim log:\n%s", s.logs.String())
}
