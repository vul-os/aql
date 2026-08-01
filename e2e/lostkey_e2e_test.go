package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A hub that has lost its signing key must refuse to start, not mint a new one.
//
// This is the whole point of the guard, over real binaries: the unit tests
// prove the predicate and the refusal separately, and neither shows that a hub
// process actually stops. Before this, deleting gateway_ed25519.seed from a
// data directory and restarting produced a hub that came up cleanly, served
// happily, and was no longer trusted by a single controller it had paired —
// each pins the old public key, so every command fails badsig, and the `repair`
// that would move them must be signed by the key that is gone.
func TestLostSigningKey_HubRefusesToStartRatherThanOrphanItsFleet(t *testing.T) {
	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)

	// Pair a controller for real, so the hub has something to orphan.
	c := startController(t, gw, ten, dev, claim, ap)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)
	if st, delivery, body := gw.open(t, ten, ap); st != 200 || delivery != "acked" {
		t.Fatalf("baseline open: %d %q %v", st, delivery, body)
	}
	_ = c

	seed := filepath.Join(gw.dataDir, "gateway_ed25519.seed")
	if _, err := os.Stat(seed); err != nil {
		t.Fatalf("no seed file at %s: %v — this test is not exercising what it thinks", seed, err)
	}
	gw.stop(t)
	if err := os.Remove(seed); err != nil {
		t.Fatalf("remove seed: %v", err)
	}

	// Restart against the SAME data directory. It must fail, and say why.
	out, err := startGatewayExpectingFailure(t, gw.dataDir)
	if err == nil {
		t.Fatalf("the hub started without its signing key. It has minted a new identity and "+
			"every paired controller is now refusing its commands.\nhub output:\n%s", out)
	}
	if !strings.Contains(out, "orphan") || !strings.Contains(out, "backup") {
		t.Errorf("the hub refused but did not say what happened or what to do:\n%s", out)
	}
}
