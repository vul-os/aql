package lanserver_test

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vul-os/aql/controller/internal/grants"
	"github.com/vul-os/aql/controller/internal/lanserver"
	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

// The LAN half of "a refusal at the gate leaves a trace".
//
// See internal/blesession/denied_test.go for the argument. Both transports need
// this and they are wired separately, so both are tested — a hook set on one and
// forgotten on the other is exactly the shape that ships.
func TestLANRecordsAnAttributableRefusalAndNotAnUnauthenticatedOne(t *testing.T) {
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
	if valid == nil {
		t.Fatal("grant-redeem-valid fixture missing")
	}

	type denial struct{ id, reason string }
	var denials []denial
	srv := &lanserver.Server{
		DeviceID: valid.Check.DeviceID,
		Exchange: grants.NewExchange(),
		Env: func() grants.Env {
			return grants.Env{
				Now:             valid.Check.Now,
				LastGatewaySync: valid.Check.LastGatewaySync,
				DeviceID:        valid.Check.DeviceID,
				GatewayKey:      gwPub,
				// The grant is on the deny-list: the refusal an operator most
				// wants to see, and the one that recorded nothing at all.
				Revoked: func(string) bool { return true },
			}
		},
		OnDenied: func(grantID, reason string) {
			denials = append(denials, denial{grantID, reason})
		},
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
		t.Fatalf("bad challenge: %s", chRaw)
	}
	proof := signProof(t, appPriv, "9aa70000-0000-4000-8000-000000000001", ch.Cnonce, "main", valid.Check.Now)

	var res grants.Result
	if err := json.Unmarshal(post("/grant/proof", proof), &res); err != nil {
		t.Fatal(err)
	}
	if res.Result != "denied" || res.Detail != wire.ReasonRevoked {
		t.Fatalf("verdict = %s/%s, want denied/%s", res.Result, res.Detail, wire.ReasonRevoked)
	}
	if len(denials) != 1 {
		t.Fatalf("recorded %d denials, want 1 — a revoked grant presented at a gate is the "+
			"single most security-relevant refusal there is", len(denials))
	}
	if denials[0].reason != wire.ReasonRevoked || denials[0].id == "" {
		t.Errorf("denial = %+v, want the revoked reason and a grant id", denials[0])
	}
	// The wire object must NOT carry the id: it is local plumbing for the audit
	// path, and proto/grants.md defines what goes on the wire.
	var onWire map[string]any
	if err := json.Unmarshal(post("/grant/proof", proof), &onWire); err != nil {
		t.Fatal(err)
	}
	if _, leaked := onWire["grant_id"]; leaked {
		t.Errorf("grant.result carries grant_id on the wire: %v", onWire)
	}

	// THE FLOOD VECTOR, exercised properly.
	//
	// A first attempt used junk with a made-up cnonce, which is refused before
	// the grant is even parsed — so it proved nothing, and a tamper that
	// attributed refusals BEFORE the signature check passed it. The real
	// attack is a forged grant presented with a VALID cnonce: the exchange
	// issues a challenge to anyone who asks, so an attacker gets one for free,
	// and the refusal then happens at the signature check with a parsed grant
	// carrying whatever id they chose.
	//
	// If that refusal were recorded, anyone within reach of the gate could
	// write into a bounded audit ring that evicts the oldest normal event when
	// full — pushing real events out of it with grants nobody ever issued.
	before := len(denials)
	forgedOpen := []byte(`{"v":0,"typ":"grant.open","grant":{"v":0,"typ":"grant",` +
		`"grant_id":"forged-by-an-attacker","member":"nobody","app_pubkey":"AA",` +
		`"devices":["` + valid.Check.DeviceID + `"],"access_points":["main"],` +
		`"windows":[{"days":"mon-sun","from":"00:00","to":"24:00"}],` +
		`"iat":1,"exp":9999999999,"sig":"AA"},"access_point":"main"}`)
	var forgedCh grants.Challenge
	if err := json.Unmarshal(post("/grant/open", forgedOpen), &forgedCh); err != nil {
		t.Fatalf("the forged open did not yield a challenge: %v", err)
	}
	if forgedCh.Cnonce == "" {
		t.Fatal("no cnonce for the forged open — the flood path is not being exercised")
	}
	forgedProof := signProof(t, appPriv, "forged-by-an-attacker", forgedCh.Cnonce, "main", valid.Check.Now)
	var forgedRes grants.Result
	if err := json.Unmarshal(post("/grant/proof", forgedProof), &forgedRes); err != nil {
		t.Fatal(err)
	}
	if forgedRes.Detail != wire.ReasonBadSig {
		t.Fatalf("a forged grant was refused for %q, want %q — this test is not reaching "+
			"the signature check", forgedRes.Detail, wire.ReasonBadSig)
	}
	if len(denials) != before {
		t.Errorf("a forged grant recorded %d denials — anyone at the gate could flood the "+
			"audit ring and push real events out of it", len(denials)-before)
	}
}
