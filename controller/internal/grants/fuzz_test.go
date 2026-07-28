package grants_test

import (
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/vul-os/aql/controller/internal/grants"
)

// The LAN grant endpoints are the controller's most exposed parser.
//
// lanserver POSTs whatever arrives at /grant/open and /grant/proof straight
// into these two functions — no authentication, because authentication IS the
// signed grant they are being asked to check. Anyone who can reach the
// controller's port can hand them arbitrary bytes, and that port is advertised
// over mDNS to the whole LAN. A panic here does not leak anything; it kills the
// process that opens the gate.
//
// So the property is availability, not correctness: no input may panic. What
// counts as a valid grant is settled by the conformance vectors, which check
// far more than a fuzzer could express.
//
// Both handlers are driven with a REAL Env — a live key, a plausible clock —
// because a zero Env short-circuits verification early and would leave most of
// the parser unexplored while looking like coverage.

func fuzzEnv(t *testing.T) grants.Env {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return grants.Env{
		Now:             time.Now().Unix(),
		LastGatewaySync: time.Now().Unix(),
		DeviceID:        "de71ce00-0000-4000-8000-000000000001",
		GatewayKey:      pub,
	}
}

func FuzzHandleOpen(f *testing.F) {
	f.Add([]byte(`{"v":0,"typ":"grant.open","grant":{"v":0},"access_point":"main"}`))
	f.Add([]byte(`{"typ":"grant.open","grant":{}}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(``))
	f.Add([]byte(`null`))
	// Deep nesting: the shape that overflows a recursive-descent decoder.
	f.Add([]byte(`{"typ":"grant.open","grant":` + deepArray(200) + `}`))

	f.Fuzz(func(t *testing.T, raw []byte) {
		x := grants.NewExchange()
		ch, err := x.HandleOpen(raw, fuzzEnv(t))

		// A challenge is a promise the controller will honour later, so it must
		// never be handed back half-built. Either an error, or a usable one.
		if err == nil {
			if ch == nil {
				t.Fatal("HandleOpen returned no error and no challenge")
			}
			if ch.Cnonce == "" {
				t.Fatalf("issued a challenge with an empty cnonce: %+v", ch)
			}
			if ch.EXP <= ch.IAT {
				t.Fatalf("issued a challenge that expires before it is issued: %+v", ch)
			}
		}
	})
}

func FuzzHandleProof(f *testing.F) {
	f.Add([]byte(`{"v":0,"typ":"grant.proof","cnonce":"aaaa","sig":"bbbb"}`))
	f.Add([]byte(`{"typ":"grant.proof"}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(``))
	f.Add([]byte(`[]`))
	f.Add([]byte(`{"typ":"grant.proof","cnonce":` + deepArray(200) + `}`))

	f.Fuzz(func(t *testing.T, raw []byte) {
		x := grants.NewExchange()
		res, _, _ := x.HandleProof(raw, fuzzEnv(t))

		// HandleProof answers on the wire whatever happens, so a nil result
		// would be a nil dereference in lanserver rather than a denial.
		if res == nil {
			t.Fatal("HandleProof returned a nil result; the LAN server writes it directly")
		}
		// FAIL CLOSED. Nothing a fuzzer produces is a validly signed proof
		// against a key it has never seen, so any "opened" here is a
		// catastrophic verification bypass rather than a lucky guess.
		if res.Result == "opened" {
			t.Fatalf("unsigned fuzz input was ACCEPTED and opened the gate: %+v", res)
		}
	})
}

// deepArray builds `[[[...]]]`, n deep.
func deepArray(n int) string {
	s := make([]byte, 0, 2*n)
	for i := 0; i < n; i++ {
		s = append(s, '[')
	}
	for i := 0; i < n; i++ {
		s = append(s, ']')
	}
	return string(s)
}
