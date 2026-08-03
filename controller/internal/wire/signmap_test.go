package wire

import (
	"crypto/ed25519"
	"encoding/json"
	"strings"
	"testing"

	"github.com/vul-os/aql/controller/internal/jcs"
)

func testKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return priv
}

// SignMap refuses a map that already carries "sig".
//
// The failure this prevents is silent and remote. Canonicalizing a map that
// still has a "sig" member signs bytes that INCLUDE it, while every verifier
// canonicalizes the envelope MINUS sig — so the signature covers something no
// verifier reconstructs, every message of that type reads as badsig on the far
// side of the link, and nothing at the signer says why.
//
// The second half of the test is the part worth having: it demonstrates that
// the old behaviour really did produce an unverifiable envelope, rather than
// asserting an error message and calling the hazard established.
func TestSignMapRefusesAMapThatAlreadyHasASig(t *testing.T) {
	priv := testKey(t)
	pub := priv.Public().(ed25519.PublicKey)

	_, err := SignMap(priv, map[string]any{
		"v": 0, "typ": "cmd.ack", "device_id": "dev-1", "sig": "not-mine",
	})
	if err == nil {
		t.Fatal("a map carrying \"sig\" was signed")
	}
	if !strings.Contains(err.Error(), "sig") {
		t.Errorf("refused, but not for the sig member: %v", err)
	}

	// What the refusal is worth: sign the same content the old way — over a
	// map that includes the stale sig — and confirm no verifier accepts it.
	stale := map[string]any{
		"v": 0, "typ": "cmd.ack", "device_id": "dev-1", "sig": "not-mine",
	}
	canonical, cerr := jcs.Canonicalize(stale)
	if cerr != nil {
		t.Fatal(cerr)
	}
	stale["sig"] = Sign(priv, canonical)
	raw, merr := json.Marshal(stale)
	if merr != nil {
		t.Fatal(merr)
	}
	if err := VerifyRaw(pub, raw); err == nil {
		t.Fatal("an envelope signed over its own stale sig verified — then the refusal " +
			"above is guarding nothing and this test proves the wrong thing")
	}
}

// The control: an ordinary signable map still signs and still verifies.
//
// The test above asserts only a refusal, so a SignMap that returned an error
// unconditionally would satisfy it while silencing every controller on the
// fleet — no acks, no events, no ws.auth. The verify is the assertion that
// matters: producing bytes is not the same as producing bytes the hub accepts.
func TestSignMapStillSignsAnOrdinaryMap(t *testing.T) {
	priv := testKey(t)
	pub := priv.Public().(ed25519.PublicKey)

	raw, err := SignMap(priv, map[string]any{
		"v": 0, "typ": "cmd.ack", "device_id": "dev-1", "nonce": "n1",
		"result": "opened", "ts": int64(1_700_000_000),
	})
	if err != nil {
		t.Fatalf("an ordinary signable map was refused: %v", err)
	}
	if err := VerifyRaw(pub, raw); err != nil {
		t.Fatalf("SignMap produced an envelope its own verifier rejects: %v", err)
	}
}

// SignMap must not leave "sig" behind in the caller's map.
//
// It adds the member, marshals, and deletes it on the way out. A caller that
// signs the same map twice — a retry, a re-send after a reconnect — would
// otherwise hit the refusal above on the second attempt and stop sending, which
// would turn a guard into an outage.
func TestSigningTheSameMapTwiceStillWorks(t *testing.T) {
	priv := testKey(t)
	pub := priv.Public().(ed25519.PublicKey)
	m := map[string]any{
		"v": 0, "typ": "cmd.ack", "device_id": "dev-1", "nonce": "n1",
		"result": "opened", "ts": int64(1_700_000_000),
	}
	for attempt := 1; attempt <= 2; attempt++ {
		raw, err := SignMap(priv, m)
		if err != nil {
			t.Fatalf("attempt %d: %v — SignMap left \"sig\" in the caller's map", attempt, err)
		}
		if err := VerifyRaw(pub, raw); err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
	}
}

// Every Signable() constructor omits "sig" — the invariant SignMap's
// precondition rests on.
//
// The four production callers all pass a freshly-built Signable() map, so the
// refusal above should never fire in normal operation. That is a property of
// these constructors, and nothing checked it: a Signable() that copied fields
// from a parsed envelope rather than naming them would carry "sig" through and
// take that envelope type off the wire entirely.
func TestNoSignableConstructorEmitsASigMember(t *testing.T) {
	ack := (&Ack{V: 0, Typ: "cmd.ack", DeviceID: "d", Nonce: "n", Result: "opened", TS: 1, Sig: "leftover"}).Signable()
	ev := (&Event{
		V: 0, Typ: "event", EventID: "e", DeviceID: "d", Kind: "opened", TS: 1,
		// A "sig" INSIDE data is fine and must stay: it is at data.sig, not
		// top level, so it cannot collide with the member SignMap adds. If
		// this ever starts failing, something began flattening data upward.
		Data: map[string]any{"sig": "inner", "cause": "cmd"},
		Sig:  "leftover",
	}).Signable()

	for name, m := range map[string]map[string]any{
		"Ack.Signable":      ack,
		"Event.Signable":    ev,
		"WSAuthSignable":    WSAuthSignable("d", "cnonce", 1),
		"CtlReportSignable": CtlReportSignable("d", "1.0.0", 1, nil, nil),
	} {
		if _, present := m["sig"]; present {
			t.Errorf("%s emits a \"sig\" member; SignMap will refuse it and that envelope "+
				"type stops going out", name)
		}
	}
	if _, present := ev["data"].(map[string]any)["sig"]; !present {
		t.Error("Event.Signable dropped a \"sig\" key from data — that one is legitimate " +
			"payload and is covered by the signature")
	}
}
