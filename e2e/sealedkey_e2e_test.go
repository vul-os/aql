package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A hub with its signing key sealed still pairs controllers and opens gates,
// and keeps the same identity across a restart.
//
// Every part of sealing is unit-tested. What none of that shows is a real hub
// process starting with AQL_DATA_KEY set, a real controller pinning the public
// key it serves, and the gate still opening after a restart — which is where an
// identity change would surface, and an identity change here means every paired
// controller is orphaned.
//
// This session has twice found a defect that every unit test agreed was fine,
// both times in the seam between two running things. Encryption on the signing
// key is the last place to take that on trust.
func TestSealedSigningKey_PairsOpensAndSurvivesARestart(t *testing.T) {
	key, err := newDataKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("AQL_DATA_KEY", key)

	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)

	c := startController(t, gw, ten, dev, claim, ap)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)
	if st, delivery, body := gw.open(t, ten, ap); st != http.StatusOK || delivery != "acked" {
		t.Fatalf("open with a sealed key: %d %q %v", st, delivery, body)
	}
	if !c.logs.waitLines(1, 5*time.Second, "relay", "state=pulsing") {
		t.Fatalf("the relay never pulsed; controller log:\n%s", c.logs.String())
	}

	// The file on disk is actually ciphertext — otherwise this test proves the
	// hub works, not that it sealed anything.
	raw, err := os.ReadFile(filepath.Join(gw.dataDir, "gateway_ed25519.seed"))
	if err != nil {
		t.Fatal(err)
	}
	if !isSealedFile(raw) {
		t.Fatal("the seed is plaintext on disk — AQL_DATA_KEY did not reach the hub")
	}

	// Restart against the same directory. The identity must survive: a
	// controller that paired before the restart pins the old public key.
	before := gw.pubB64
	gw.stop(t)
	gw2 := startGatewayIn(t, gw.dataDir, nil)
	if after := gw2.pubB64; after != before {
		t.Fatalf("the identity changed across a restart: %q → %q — every paired controller "+
			"is now refusing this hub", before, after)
	}
}

// And the refusal, over a real process: no data key means the hub stops rather
// than minting a replacement.
func TestSealedSigningKey_HubRefusesToStartWithoutTheDataKey(t *testing.T) {
	key, err := newDataKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("AQL_DATA_KEY", key)

	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)
	_ = c
	gw.stop(t)

	// The operator forgot the variable — a new shell, a redeployed container.
	t.Setenv("AQL_DATA_KEY", "")
	out, err := startGatewayExpectingFailure(t, gw.dataDir)
	if err == nil {
		t.Fatalf("the hub started without its data key. If it minted a replacement identity, "+
			"every paired controller is now refusing it.\nhub output:\n%s", out)
	}
	if !contains(out, "AQL_DATA_KEY") {
		t.Errorf("the refusal does not name the missing variable:\n%s", out)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
