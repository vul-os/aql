package lanserver_test

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/vul-os/aql/controller/internal/grants"
	"github.com/vul-os/aql/controller/internal/lanserver"
	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

// One grant, one open — even when the same proof arrives eight times at once.
//
// # The defect this pins
//
// HandleProof read `used[cnonce]` at the top, released the lock, ran every
// validation step, and only then consumed the cnonce. Two proofs carrying the
// same cnonce could both find it unused, both validate, and both consume.
// Measured before the fix: eight concurrent posts of one proof returned
// "opened" eight times and called OnRedeemed eight times — a single-use
// emergency grant redeemed eight times, with eight relay pulses and eight
// grant_redeemed events behind it.
//
// It is reachable in ordinary operation, not just in a test. A phone can reach
// the same Exchange over BLE and over this LAN server at the same time, and the
// agent wires both to one instance.
//
// # Why this lives here rather than in internal/grants
//
// The exchange is reached through a transport, and this is the transport with a
// test fixture that can build a real signed proof from the shared vectors.
// Testing it here exercises the HTTP handler, the JSON, and the exchange
// together, which is the path a phone actually takes.
func TestOneGrantOpensOnceUnderConcurrentProofs(t *testing.T) {
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	f, err := vectorfile.Load(dir, "grants.json")
	if err != nil {
		t.Fatal(err)
	}
	keys, err := vectorfile.LoadKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	gwPub, err := wire.DecodePub(keys.Keys["gateway"].PublicKeyB64u)
	if err != nil {
		t.Fatal(err)
	}
	appSeed, err := keys.Keys["app"].Seed()
	if err != nil {
		t.Fatal(err)
	}
	appPriv := ed25519.NewKeyFromSeed(appSeed)

	var valid *vectorfile.Vector
	for i := range f.Vectors {
		if f.Vectors[i].Name == "grant-redeem-valid" {
			valid = &f.Vectors[i]
			break
		}
	}
	redeemed := 0
	var mu sync.Mutex
	srv := &lanserver.Server{
		DeviceID: valid.Check.DeviceID,
		Exchange: grants.NewExchange(),
		Env: func() grants.Env {
			return grants.Env{
				Now:             valid.Check.Now,
				LastGatewaySync: valid.Check.LastGatewaySync,
				DeviceID:        valid.Check.DeviceID,
				GatewayKey:      gwPub,
			}
		},
		OnRedeemed: func(g *grants.Grant, p *grants.Proof) { mu.Lock(); redeemed++; mu.Unlock() },
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	post := func(path string, body []byte) []byte {
		t.Helper()
		resp, err := http.Post(ts.URL+path, "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}

	chRaw := post("/grant/open", valid.Transcript.Open.Object)
	var ch grants.Challenge
	if err := json.Unmarshal(chRaw, &ch); err != nil {
		t.Fatal(err)
	}
	proof := signProof(t, appPriv, "9aa70000-0000-4000-8000-000000000001", ch.Cnonce, "main", valid.Check.Now)

	const n = 8
	var wg sync.WaitGroup
	results := make([]string, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			var res grants.Result
			_ = json.Unmarshal(post("/grant/proof", proof), &res)
			if res.Result == "opened" {
				results[i] = "opened"
			} else {
				results[i] = res.Detail
			}
		}(i)
	}
	close(start)
	wg.Wait()

	opened := 0
	for _, r := range results {
		if r == "opened" {
			opened++
		}
	}
	mu.Lock()
	got := redeemed
	mu.Unlock()

	if opened != 1 {
		t.Fatalf("%d of %d concurrent proofs opened the gate: %v — a single-use grant "+
			"must be consumed exactly once", opened, n, results)
	}
	if got != 1 {
		t.Fatalf("OnRedeemed fired %d times for one grant: every extra call is a relay "+
			"pulse and a grant_redeemed event for an open nobody authorised", got)
	}
	// The losers must say REPLAY, not something vague: that is the reason a
	// phone shows, and it is the true one.
	for i, r := range results {
		if r != "opened" && r != wire.ReasonCnonceReplay {
			t.Errorf("proof %d was refused with %q, want %q", i, r, wire.ReasonCnonceReplay)
		}
	}
}
