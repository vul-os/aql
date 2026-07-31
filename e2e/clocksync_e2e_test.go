package e2e

import (
	"net/http"
	"testing"
	"time"
)

// A controller's clock proof reaches the hub over real binaries.
//
// This is the flow that decides, fourteen days later, whether a gate honours an
// offline grant at all. The controller's stale-clock rule is step 1 of grant
// verification — before lockdown, before the grant is even examined — so a
// broken sync path does not degrade anything gradually. It works perfectly for
// a fortnight and then refuses every emergency grant, at the gate, with the
// person standing there, during exactly the outage those grants exist for.
//
// Both halves are unit-tested. What is not, until here, is a real hub minting a
// ping, a real controller acking it, and the hub recording that as proof.
//
// The assertion is `synced_at` going non-nil, and it cannot be faked by a
// controller that merely answered: RecordAckIfPing records only when the ack's
// nonce matches a ping THIS HUB minted, so a recorded proof intrinsically means
// the signed nonce round-tripped. That is the same argument the money path
// makes for delivery=="acked", and it is the reason this test does not need to
// reach into the controller.
func TestClockSync_AControllersProofReachesTheHub(t *testing.T) {
	// The default cadence is six hours, which no test should wait for. Set the
	// same way the energy poller's is, and for the reason that comment gives:
	// a test that only passes when the caller remembers an environment
	// variable is one that will be reported green on a run where it did
	// nothing.
	t.Setenv("AQL_CLOCK_SYNC_INTERVAL", "1s")

	gw := startGateway(t)
	ten := gw.register(t)
	dev, claim := gw.createDevice(t, ten, "gate-controller")
	ap := gw.createAP(t, ten, "Main Gate", dev)
	c := startController(t, gw, ten, dev, claim, ap)
	gw.waitDeviceConnected(t, ten, dev, 10*time.Second)

	freshness := func() (map[string]any, bool) {
		t.Helper()
		st, body, raw := httpJSON(t, http.MethodGet,
			gw.url+"/v1/accounts/"+ten.accountID+"/controllers/clock-freshness", ten.token, nil)
		if st != http.StatusOK {
			t.Fatalf("clock-freshness: %d %s", st, raw)
		}
		rows, _ := body["controllers"].([]any)
		for _, r := range rows {
			m, _ := r.(map[string]any)
			if m != nil && m["device_id"] == dev {
				return m, true
			}
		}
		return nil, false
	}

	// It must start UNPROVEN. Without this the test could pass on a hub that
	// reports every controller as synced regardless — proving the field is
	// populated, not that a ping round-tripped.
	row, ok := freshness()
	if !ok {
		t.Fatalf("the paired controller is absent from clock-freshness entirely")
	}
	if row["synced_at"] != nil {
		t.Fatalf("synced_at is %v before any ping could have been acked — a controller that "+
			"has never proved its clock must read as never having proved it", row["synced_at"])
	}

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		row, _ = freshness()
		if row != nil && row["synced_at"] != nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("no clock proof was ever recorded: %v — after fourteen days this controller "+
		"refuses every offline grant it holds; controller log:\n%s", row, c.logs.String())
}
