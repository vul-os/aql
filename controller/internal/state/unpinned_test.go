package state_test

import (
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/controller/internal/command"
	"github.com/vul-os/aql/controller/internal/state"
	"github.com/vul-os/aql/controller/internal/wire"
)

// An UNPINNED controller must refuse, not crash.
//
// pairing.go's package doc is the claim: "The redeem response is the ONLY
// moment a gateway key is accepted." TestOnlyTwoDoorsWriteThePinnedGatewayKey
// and TestRePairingWithADifferentKeyIsRefused cover the two ways a key gets
// written. This covers the state those tests do not reach: a controller that
// IS paired according to its state file, but whose pinned key cannot be
// decoded — a truncated write, a half-flushed SD card, a hand-edited
// state.json, any of the ordinary ways a file on a device in a wall goes bad.
//
// state.GatewayKey() returns nil there. Before this test, nil went straight
// into ed25519.Verify, which PANICS on a wrong-sized key rather than returning
// false ("ed25519: bad public key length: 0"). The controller daemon died on
// the first command it received, at a physical gate, and nothing in the suite
// covered it: every other key on the wire arrives through wire.DecodePub,
// which enforces 32 bytes, so the only unguarded key was the pinned one.
//
// "Refuse" is not a softening of the pin. It is the pin taken literally: with
// no usable pinned key there is nothing to verify against, so nothing may be
// accepted — including a perfectly valid command from the real gateway.
func TestAnUndecodablePinnedKeyRefusesInsteadOfPanicking(t *testing.T) {
	dir := t.TempDir()

	// Pair legitimately, then corrupt the persisted key the way a bad write
	// does — through the file, not through the API, because the API refuses
	// this by design (SavePairing validates it) and that refusal is exactly
	// why the in-memory path had never been exercised.
	st, err := state.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SavePairing(state.Pairing{
		DeviceID:      "de71ce00-0000-4000-8000-000000000001",
		GatewayPubkey: testPub(t, "gateway"),
	}); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	pairing, ok := doc["pairing"].(map[string]any)
	if !ok {
		t.Fatalf("state.json has no pairing object: %s", raw)
	}
	pairing["gateway_pubkey"] = "not-a-key" // truncated / garbled on disk
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "state.json"), out, 0o600); err != nil {
		t.Fatal(err)
	}

	reopened, err := state.Open(dir)
	if err != nil {
		t.Fatalf("a controller with a corrupt pinned key could not even start: %v", err)
	}
	if reopened.Pairing() == nil {
		t.Fatal("the controller no longer considers itself paired; " +
			"this test is not reaching the state it is about")
	}
	pub := reopened.GatewayKey()
	if pub != nil {
		t.Fatalf("GatewayKey decoded %q as a key; the corruption did not take", pub)
	}

	// 1. The signature primitive. This is where the panic was.
	if wire.Verify(pub, []byte("anything"), "AAAA") {
		t.Error("wire.Verify accepted a signature against an unusable pinned key")
	}
	if err := wire.VerifyRaw(pub, []byte(`{"v":0,"typ":"cmd","sig":"AAAA"}`)); err == nil {
		t.Error("wire.VerifyRaw accepted an envelope against an unusable pinned key")
	}

	// 2. The full command pipeline, with a WELL-FORMED, correctly signed
	//    envelope — the case that matters. A controller that cannot identify
	//    its gateway must refuse the real gateway too, because it has no way
	//    to tell the real one from anyone else.
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := wire.SignMap(priv, map[string]any{
		"v": 0, "typ": "cmd", "cmd": "open",
		"device_id":    "de71ce00-0000-4000-8000-000000000001",
		"access_point": "main",
		"nonce":        "AAAAAAAAAAAAAAAAAAAAAA",
		"iat":          int64(1789000000), "exp": int64(1789000030),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = command.Verify(pub, signed, command.Context{
		Now:          1789000010,
		DeviceID:     "de71ce00-0000-4000-8000-000000000001",
		AccessPoints: []string{"main"},
		Nonces:       nil, // irrelevant: this must never get as far as the nonce store
	})
	if err == nil {
		t.Fatal("a command was ACCEPTED by a controller with no usable pinned key")
	}
	rej, ok := err.(*wire.Reject)
	if !ok || rej.Reason != wire.ReasonBadSig {
		t.Errorf("refusal reason = %v; an unauthenticatable command is badsig", err)
	}
}
