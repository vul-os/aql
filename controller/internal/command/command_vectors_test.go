package command_test

import (
	"crypto/ed25519"
	"encoding/json"
	"testing"

	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/command"
	"github.com/vul-os/aql/controller/internal/jcs"
	"github.com/vul-os/aql/controller/internal/noncestore"
	"github.com/vul-os/aql/controller/internal/relay"
	"github.com/vul-os/aql/controller/internal/state"
	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

func testKeys(t *testing.T) (dir string, gwPriv ed25519.PrivateKey, gwPub ed25519.PublicKey, gwPubB64 string, ctrlPriv ed25519.PrivateKey) {
	t.Helper()
	dir, err := vectorfile.FindDir("")
	if err != nil {
		t.Fatal(err)
	}
	keys, err := vectorfile.LoadKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	gseed, _ := keys.Keys["gateway"].Seed()
	cseed, _ := keys.Keys["controller"].Seed()
	gwPriv = ed25519.NewKeyFromSeed(gseed)
	ctrlPriv = ed25519.NewKeyFromSeed(cseed)
	return dir, gwPriv, gwPriv.Public().(ed25519.PublicKey), keys.Keys["gateway"].PublicKeyB64u, ctrlPriv
}

// newProcessor builds a REAL pipeline: durable state + persistent nonce
// store in a temp dir, fake clock, mock relay.
func newProcessor(t *testing.T, check vectorfile.Check, gwPubB64 string, ctrlPriv ed25519.PrivateKey) (*command.Processor, *clock.Fake, *relay.Mock) {
	t.Helper()
	tmp := t.TempDir()
	st, err := state.Open(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SavePairing(state.Pairing{
		DeviceID: check.DeviceID, GatewayPubkey: gwPubB64,
		WSURL: "wss://gate.example/ws", PollInterval: 30,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetAccessPoints(check.AccessPoints); err != nil {
		t.Fatal(err)
	}
	if err := st.SetLockdown(check.Lockdown); err != nil {
		t.Fatal(err)
	}
	nonces, err := noncestore.Open(tmp)
	if err != nil {
		t.Fatal(err)
	}
	fake := &clock.Fake{NowSec: check.Now}
	mock := relay.NewMock(nil)
	return &command.Processor{
		Priv: ctrlPriv, State: st, Nonces: nonces, Clock: fake, Relay: mock,
	}, fake, mock
}

func parseAck(t *testing.T, raw []byte) wire.Ack {
	t.Helper()
	var a wire.Ack
	if err := json.Unmarshal(raw, &a); err != nil {
		t.Fatalf("unparseable ack: %v (%s)", err, raw)
	}
	if a.Typ != "cmd.ack" || a.Sig == "" {
		t.Fatalf("malformed ack: %s", raw)
	}
	return a
}

// TestCommandVectorsThroughPipeline drives the FULL accept/reject matrix in
// commands.json through Processor.Process — real durable nonce store, real
// state store, fake clock — asserting the ack result and first-failure
// reason of every vector, including the 2-step replay flow.
func TestCommandVectorsThroughPipeline(t *testing.T) {
	dir, _, _, gwPubB64, ctrlPriv := testKeys(t)
	f, err := vectorfile.Load(dir, "commands.json")
	if err != nil {
		t.Fatal(err)
	}
	ran := 0
	for _, v := range f.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			p, _, mockRelay := newProcessor(t, v.Check, gwPubB64, ctrlPriv)

			assert := func(raw json.RawMessage, expect, reason string) {
				t.Helper()
				ackRaw, err := p.Process(raw)
				if err != nil {
					t.Fatalf("process: %v", err)
				}
				ack := parseAck(t, ackRaw)
				if expect == "accept" {
					if ack.Result == command.ResultDenied || ack.Result == command.ResultError {
						t.Fatalf("expected accept, ack=%s", ackRaw)
					}
				} else {
					if ack.Result != command.ResultDenied {
						t.Fatalf("expected denied(%s), ack=%s", reason, ackRaw)
					}
					if ack.Detail != reason {
						t.Fatalf("expected reason %q, got %q", reason, ack.Detail)
					}
				}
			}

			if len(v.Steps) > 0 {
				for _, st := range v.Steps {
					assert(st.Object, st.Expect, st.Reason)
				}
				ran++
				return
			}
			assert(v.Object, v.Expect, v.Reason)
			ran++

			// Denied envelopes must never actuate the relay.
			if v.Expect == "reject" && mockRelay.State() != "idle" {
				t.Fatalf("relay actuated on rejected command (%s)", mockRelay.State())
			}
		})
	}
	if ran != 23 {
		t.Errorf("expected 23 command vectors, ran %d", ran)
	}
}

// signCmd builds and signs a fresh command envelope with the hub key.
func signCmd(t *testing.T, priv ed25519.PrivateKey, m map[string]any) []byte {
	t.Helper()
	canonical, err := jcs.Canonicalize(m)
	if err != nil {
		t.Fatal(err)
	}
	m["sig"] = wire.Sign(priv, canonical)
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	delete(m, "sig")
	return raw
}

// TestLockdownStateMachine exercises the latch end-to-end: lockdown latches
// durably, open/hold/close are denied, lift/ping/config/repair pass, lift
// unlatches, and the latch survives a state-store reopen.
func TestLockdownStateMachine(t *testing.T) {
	_, gwPriv, _, gwPubB64, ctrlPriv := testKeys(t)
	check := vectorfile.Check{
		Now:          1789000010,
		DeviceID:     "de71ce00-0000-4000-8000-000000000001",
		AccessPoints: []string{"main"},
	}
	p, fake, mockRelay := newProcessor(t, check, gwPubB64, ctrlPriv)

	nonceN := 0
	cmd := func(name, ap string) map[string]any {
		nonceN++
		m := map[string]any{
			"v": 0, "typ": "cmd", "cmd": name,
			"device_id": check.DeviceID,
			"nonce":     wire.B64u([]byte{byte(nonceN), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}),
			"iat":       fake.NowSec, "exp": fake.NowSec + 30,
		}
		if ap != "" {
			m["access_point"] = ap
		}
		return m
	}
	run := func(m map[string]any) wire.Ack {
		t.Helper()
		raw, err := p.Process(signCmd(t, gwPriv, m))
		if err != nil {
			t.Fatal(err)
		}
		return parseAck(t, raw)
	}

	if a := run(cmd("open", "main")); a.Result != "opened" {
		t.Fatalf("open before lockdown: %+v", a)
	}
	if a := run(cmd("lockdown", "")); a.Result != command.ResultOK {
		t.Fatalf("lockdown: %+v", a)
	}
	if !p.State.Lockdown() {
		t.Fatal("lockdown not latched")
	}
	// Snapshot the relay before the denied phase; the earlier legitimate
	// open may still be mid-pulse (async), so assert the denied commands
	// leave the relay UNCHANGED rather than assuming a specific state.
	relayBefore := mockRelay.State()
	for _, c := range []struct{ name, ap string }{{"open", "main"}, {"hold", "main"}, {"close", "main"}} {
		if a := run(cmd(c.name, c.ap)); a.Result != "denied" || a.Detail != wire.ReasonLockdown {
			t.Fatalf("%s under lockdown: %+v", c.name, a)
		}
	}
	if mockRelay.State() != relayBefore {
		t.Fatalf("relay moved under lockdown: %s → %s", relayBefore, mockRelay.State())
	}
	for _, name := range []string{"ping", "config"} {
		m := cmd(name, "")
		if name == "config" {
			m["payload"] = map[string]any{"pulse_ms": 500}
		}
		if a := run(m); a.Result != command.ResultOK {
			t.Fatalf("%s under lockdown: %+v", name, a)
		}
	}
	// Latch survives reopen (state.json).
	st2, err := state.Open(p.State.Dir())
	if err != nil {
		t.Fatal(err)
	}
	if !st2.Lockdown() {
		t.Fatal("lockdown latch not durable")
	}
	if a := run(cmd("lift", "")); a.Result != command.ResultOK {
		t.Fatalf("lift: %+v", a)
	}
	if a := run(cmd("open", "main")); a.Result != "opened" {
		t.Fatalf("open after lift: %+v", a)
	}
	if cfg := p.State.Config(); cfg["pulse_ms"] != 500 {
		t.Fatalf("config not applied: %v", cfg)
	}
}

// TestRepairRotatesPinnedKey: a repair signed by the CURRENT key re-pins to
// next_pubkey; afterwards old-key commands are badsig and new-key commands
// verify.
func TestRepairRotatesPinnedKey(t *testing.T) {
	dir, gwPriv, _, gwPubB64, ctrlPriv := testKeys(t)
	keys, _ := vectorfile.LoadKeys(dir)
	nseed, _ := keys.Keys["gateway_next"].Seed()
	nextPriv := ed25519.NewKeyFromSeed(nseed)
	nextPubB64 := keys.Keys["gateway_next"].PublicKeyB64u

	check := vectorfile.Check{Now: 1789000010, DeviceID: "de71ce00-0000-4000-8000-000000000001", AccessPoints: []string{"main"}}
	p, _, _ := newProcessor(t, check, gwPubB64, ctrlPriv)

	repair := map[string]any{
		"v": 0, "typ": "cmd", "cmd": "repair", "device_id": check.DeviceID,
		"nonce": wire.B64u([]byte("repair-nonce-01!")),
		"iat":   check.Now, "exp": check.Now + 30,
		"payload": map[string]any{"next_pubkey": nextPubB64},
	}
	raw, err := p.Process(signCmd(t, gwPriv, repair))
	if err != nil {
		t.Fatal(err)
	}
	if a := parseAck(t, raw); a.Result != command.ResultOK {
		t.Fatalf("repair: %+v", a)
	}
	if got := p.State.Pairing().GatewayPubkey; got != nextPubB64 {
		t.Fatalf("key not rotated: %s", got)
	}
	// Old key now fails…
	oldCmd := map[string]any{
		"v": 0, "typ": "cmd", "cmd": "open", "device_id": check.DeviceID,
		"access_point": "main", "nonce": wire.B64u([]byte("old-key-nonce-1!")),
		"iat": check.Now, "exp": check.Now + 30,
	}
	raw, _ = p.Process(signCmd(t, gwPriv, oldCmd))
	if a := parseAck(t, raw); a.Result != "denied" || a.Detail != wire.ReasonBadSig {
		t.Fatalf("old key accepted after repair: %+v", a)
	}
	// …and the new key verifies.
	newCmd := map[string]any{
		"v": 0, "typ": "cmd", "cmd": "open", "device_id": check.DeviceID,
		"access_point": "main", "nonce": wire.B64u([]byte("new-key-nonce-1!")),
		"iat": check.Now, "exp": check.Now + 30,
	}
	raw, _ = p.Process(signCmd(t, nextPriv, newCmd))
	if a := parseAck(t, raw); a.Result != "opened" {
		t.Fatalf("new key rejected after repair: %+v", a)
	}
}

// TestNonceStoreFullFailsClosed fills the store with live nonces and
// expects fresh, otherwise-valid commands to be rejected as replay.
func TestNonceStoreFullFailsClosed(t *testing.T) {
	_, gwPriv, _, gwPubB64, ctrlPriv := testKeys(t)
	check := vectorfile.Check{Now: 1789000010, DeviceID: "de71ce00-0000-4000-8000-000000000001", AccessPoints: []string{"main"}}
	p, _, _ := newProcessor(t, check, gwPubB64, ctrlPriv)

	// Fill via the store directly (live horizon far in the future).
	ns := p.Nonces.(*noncestore.Store)
	for i := 0; i < noncestore.Capacity; i++ {
		if err := ns.Mark(wire.B64u([]byte{byte(i), byte(i >> 8), 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}), check.Now+1000, check.Now); err != nil {
			t.Fatal(err)
		}
	}
	m := map[string]any{
		"v": 0, "typ": "cmd", "cmd": "open", "device_id": check.DeviceID,
		"access_point": "main", "nonce": wire.B64u([]byte("fresh-nonce-full")),
		"iat": check.Now, "exp": check.Now + 30,
	}
	raw, err := p.Process(signCmd(t, gwPriv, m))
	if err != nil {
		t.Fatal(err)
	}
	if a := parseAck(t, raw); a.Result != "denied" || a.Detail != wire.ReasonReplay {
		t.Fatalf("full nonce store must fail closed: %+v", a)
	}
}

// TestRepairIsRefusedUnlessSignedByTheCurrentlyPinnedKey.
//
// proto/pairing.md is explicit that `repair` must be signed by the CURRENTLY
// pinned key, and equally explicit about the consequence: a hub that has lost
// its old private key "cannot author a valid `repair` for any controller it
// hasn't already migrated… This is deliberate, not an oversight. The pinned key
// is the *entire* trust anchor."
//
// TestRepairRotatesPinnedKey covers the happy path. Nothing covered the attack,
// and the attack is the whole point of the rule: a repair names the key that
// replaces the trust anchor, so accepting one signed by anything else hands the
// controller to whoever sent it. There is no gate left to check afterwards —
// every later command verifies against the key the attacker installed.
//
// The second case is the one worth having a named test for. Verifying a repair
// against the key it INSTALLS is a self-signed rotation, and it is exactly the
// shape of a well-meant fix for the limitation the spec describes: "the hub lost
// its key and cannot recover, so let it sign the repair with the new one". That
// change looks like a recovery feature and is a complete bypass.
func TestRepairIsRefusedUnlessSignedByTheCurrentlyPinnedKey(t *testing.T) {
	dir, _, _, gwPubB64, ctrlPriv := testKeys(t)
	keys, err := vectorfile.LoadKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	nextPubB64 := keys.Keys["gateway_next"].PublicKeyB64u
	nextSeed, _ := keys.Keys["gateway_next"].Seed()
	nextPriv := ed25519.NewKeyFromSeed(nextSeed)
	attackerSeed, _ := keys.Keys["attacker"].Seed()
	attackerPriv := ed25519.NewKeyFromSeed(attackerSeed)

	check := vectorfile.Check{
		Now: 1789000010, DeviceID: "de71ce00-0000-4000-8000-000000000001",
		AccessPoints: []string{"main"},
	}

	for _, tc := range []struct {
		name string
		priv ed25519.PrivateKey
		why  string
	}{
		{
			name: "signed by an unrelated key",
			priv: attackerPriv,
			why:  "anyone who can reach the controller could otherwise re-pin it to their own hub",
		},
		{
			name: "self-signed by the key it installs",
			priv: nextPriv,
			why: "verifying a repair against next_pubkey makes the rotation self-authorising, " +
				"which is the shape a well-meant fix for the lost-key limitation would take",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, _, _ := newProcessor(t, check, gwPubB64, ctrlPriv)

			repair := map[string]any{
				"v": 0, "typ": "cmd", "cmd": "repair", "device_id": check.DeviceID,
				"nonce": wire.B64u([]byte("repair-nonce-02!")),
				"iat":   check.Now, "exp": check.Now + 30,
				"payload": map[string]any{"next_pubkey": nextPubB64},
			}
			raw, err := p.Process(signCmd(t, tc.priv, repair))
			if err != nil {
				t.Fatalf("Process: %v", err)
			}
			a := parseAck(t, raw)
			if a.Result != "denied" || a.Detail != wire.ReasonBadSig {
				t.Errorf("repair %s was not refused as badsig: %+v — %s", tc.name, a, tc.why)
			}

			// The assertion that matters most: the trust anchor is unchanged.
			// A refusal that still rotated would be worse than an acceptance,
			// because the ack would say denied.
			if got := p.State.Pairing().GatewayPubkey; got != gwPubB64 {
				t.Fatalf("the pinned key CHANGED after a refused repair: %s (was %s) — %s",
					got, gwPubB64, tc.why)
			}

			// And the original key still works, so the controller has not been
			// left unable to talk to its real hub.
			open := map[string]any{
				"v": 0, "typ": "cmd", "cmd": "open", "device_id": check.DeviceID,
				"access_point": "main", "nonce": wire.B64u([]byte("after-refuse-01!")),
				"iat": check.Now, "exp": check.Now + 30,
			}
			gwSeed, _ := keys.Keys["gateway"].Seed()
			raw, _ = p.Process(signCmd(t, ed25519.NewKeyFromSeed(gwSeed), open))
			if a := parseAck(t, raw); a.Result != "opened" {
				t.Errorf("the real hub could no longer open after a refused repair: %+v", a)
			}
		})
	}
}
