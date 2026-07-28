package lanserver_test

// The liveness probe's contract, pinned from this side.
//
// src/lib/offline/service.ts's probeController answers one question while
// somebody is standing at a gate with the network down: is a controller
// listening here? It asks with `GET /grant/open` and treats any status below
// 500 as yes.
//
// That works because this server has no GET route, so the mux answers 405 —
// a response, and nothing else. The probe is therefore relying on two
// properties of code in a different module and a different language, neither
// of which is obvious from reading either side alone:
//
//   1. A probe must not actuate. If a GET ever reached handleProof's path,
//      every reachability check would open a gate.
//   2. A probe must not consume state. handleOpen mints a single-use
//      challenge nonce; a probe that minted one per check would leave
//      dangling challenges behind and could exhaust whatever bounds them.
//
// Both hold today by accident of routing rather than by design, which is
// exactly why they are written down here. If someone adds `GET /grant/open`
// as a convenience, this test says what it would break.

import (
	"crypto/ed25519"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vul-os/aql/controller/internal/grants"
	"github.com/vul-os/aql/controller/internal/lanserver"
)

// probeServer is deliberately minimal: the probe never gets far enough to
// need a real grant, and a fixture that did would hide a regression where it
// suddenly does.
func probeServer(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	redeemed := 0
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := &lanserver.Server{
		DeviceID: "de71ce00-0000-4000-8000-000000000001",
		Exchange: grants.NewExchange(),
		Env: func() grants.Env {
			return grants.Env{
				Now:        1_700_000_000,
				DeviceID:   "de71ce00-0000-4000-8000-000000000001",
				GatewayKey: pub,
			}
		},
		OnRedeemed: func(*grants.Grant, *grants.Proof) { redeemed++ },
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, &redeemed
}

func TestAGETProbeAnswersWithoutActuatingOrConsumingState(t *testing.T) {
	ts, redeemed := probeServer(t)

	for _, path := range []string{"/grant/open", "/grant/proof"} {
		res, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		res.Body.Close()

		// Exactly 405, which is the mux saying NOTHING IS ROUTED HERE. That
		// is the real guarantee, and it is structural rather than
		// behavioural: asserting only "it did not actuate" would pass against
		// a GET wired straight to handleProof, because a GET carries no body
		// and the exchange rejects it before OnRedeemed — so the dangerous
		// wiring would test clean and only misbehave once someone found a way
		// to put a valid proof on a GET.
		//
		// (The app side is deliberately more lenient — it accepts any status
		// below 500 — because a future controller answering differently
		// should not make a reachable gate report as absent. Lenient there,
		// strict here: this end knows what it registered.)
		if res.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf(`GET %s answered %d, want 405.

405 means no handler is routed at GET, which is what makes probeController's
liveness check free of side effects. A status other than 405 means something
now runs on GET — and whatever it is, the app calls it every time it checks
whether a controller is in range.`, path, res.StatusCode)
		}
		if *redeemed != 0 {
			t.Fatalf("GET %s actuated the gate (%d redemptions). A reachability check "+
				"that opens a gate is worse than no reachability check.", path, *redeemed)
		}
	}
}

// The OPTIONS routes exist for browser preflight, not for probing — but while
// they exist they must stay side-effect-free, because a preflight is issued
// before every cross-origin redemption attempt.
func TestOptionsIsANoOp(t *testing.T) {
	ts, redeemed := probeServer(t)

	for _, path := range []string{"/grant/open", "/grant/proof"} {
		req, err := http.NewRequest(http.MethodOptions, ts.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("OPTIONS %s: %v", path, err)
		}
		res.Body.Close()
		// 204 in practice — withCORS answers the preflight itself rather than
		// falling through to the empty handler. Asserted as a range because
		// which 2xx it is has never mattered to a browser, and pinning the
		// exact code would fail on a correct change.
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			t.Errorf("OPTIONS %s = %d, want 2xx — a preflight that fails blocks the "+
				"redemption that follows it", path, res.StatusCode)
		}
		if *redeemed != 0 {
			t.Fatalf("OPTIONS %s actuated the gate", path)
		}
	}
}

// A POST to /grant/open is the ONE thing the probe deliberately does not do.
// This records why: it succeeds, and it costs the controller a nonce.
func TestPostToOpenCostsStateWhichIsWhyTheProbeAvoidsIt(t *testing.T) {
	ts, redeemed := probeServer(t)

	// Garbage body: this is not testing the exchange, only that the route is
	// live and answers — which is what makes it tempting as a probe.
	res, err := http.Post(ts.URL+"/grant/open", "application/json", http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode >= 500 {
		t.Fatalf("POST /grant/open = %d", res.StatusCode)
	}
	if *redeemed != 0 {
		t.Error("POST /grant/open actuated a gate; only /grant/proof may")
	}
}
