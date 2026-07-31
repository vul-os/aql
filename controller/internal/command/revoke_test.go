package command_test

import (
	"testing"

	"github.com/vul-os/aql/controller/internal/command"
	"github.com/vul-os/aql/controller/internal/vectorfile"
	"github.com/vul-os/aql/controller/internal/wire"
)

// A `revoke` command must actually reach the deny-list the verification core
// consults — docs/GRANT-REVOCATION.md, proto/commands.md § Revocation list.
//
// This is the reachability half. The state layer's own tests prove the seq rule
// and the pruning; none of that matters if the command never arrives, and a
// command handler that parses a payload and drops it would pass every one of
// them.
func TestRevokeCommandReachesTheDenyList(t *testing.T) {
	_, gwPriv, _, gwPubB64, ctrlPriv := testKeys(t)
	check := vectorfile.Check{
		Now:          1789000010,
		DeviceID:     "de71ce00-0000-4000-8000-000000000001",
		AccessPoints: []string{"main"},
	}
	p, fake, _ := newProcessor(t, check, gwPubB64, ctrlPriv)

	nonceN := 0
	cmd := func(payload map[string]any) map[string]any {
		nonceN++
		m := map[string]any{
			"v": 0, "typ": "cmd", "cmd": "revoke",
			"device_id": check.DeviceID,
			"nonce":     wire.B64u([]byte{byte(nonceN), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}),
			"iat":       fake.NowSec, "exp": fake.NowSec + 30,
			"payload": payload,
		}
		return m
	}
	run := func(payload map[string]any) wire.Ack {
		t.Helper()
		raw, err := p.Process(signCmd(t, gwPriv, cmd(payload)))
		if err != nil {
			t.Fatal(err)
		}
		return parseAck(t, raw)
	}

	// Nothing is revoked before the first list — the shipped-before-this
	// behaviour, and the thing a controller that never receives one keeps.
	if p.State.RevokedAt("grant-a", check.Now) {
		t.Fatal("a grant was revoked before any list arrived")
	}

	if a := run(map[string]any{
		"seq": 4, "issued_at": check.Now - 60,
		"entries": []any{map[string]any{"grant_id": "grant-a", "exp": check.Now + 3600}},
	}); a.Result != command.ResultOK {
		t.Fatalf("revoke: %+v", a)
	}
	if !p.State.RevokedAt("grant-a", check.Now) {
		t.Fatal("the command was acknowledged and the deny-list did not change — " +
			"an operator would be told the revocation landed when it had not")
	}
	if p.State.RevokedAt("grant-b", check.Now) {
		t.Error("an unlisted grant became revoked")
	}

	// §3.5. The replay an attacker can mount: a genuine, signed, OLDER list.
	// It must be refused AND reported, not swallowed as success — a hub told
	// "ok" would stop resending and the operator would never learn.
	a := run(map[string]any{"seq": 3, "entries": []any{}})
	if a.Result == command.ResultOK {
		t.Fatal("an older list was accepted — the revocation is undone")
	}
	if a.Detail != command.DetailRevokeStale {
		t.Errorf("detail = %q, want %q", a.Detail, command.DetailRevokeStale)
	}
	if !p.State.RevokedAt("grant-a", check.Now) {
		t.Fatal("the rollback took effect despite being refused")
	}

	// A newer list replaces rather than accumulates, so reinstating a member is
	// the hub simply not listing them.
	if a := run(map[string]any{
		"seq": 5, "entries": []any{},
	}); a.Result != command.ResultOK {
		t.Fatalf("newer empty list: %+v", a)
	}
	if p.State.RevokedAt("grant-a", check.Now) {
		t.Error("an empty newer list did not clear the previous one")
	}
}

// A malformed payload fails the whole command rather than applying part of it.
// A partially-applied deny-list is the worst outcome available: the operator is
// told the revocation landed while some of it did not.
func TestAMalformedRevokeIsRefusedWhole(t *testing.T) {
	_, gwPriv, _, gwPubB64, ctrlPriv := testKeys(t)
	check := vectorfile.Check{
		Now:          1789000010,
		DeviceID:     "de71ce00-0000-4000-8000-000000000001",
		AccessPoints: []string{"main"},
	}
	p, fake, _ := newProcessor(t, check, gwPubB64, ctrlPriv)

	nonceN := 0
	run := func(payload map[string]any) wire.Ack {
		t.Helper()
		nonceN++
		m := map[string]any{
			"v": 0, "typ": "cmd", "cmd": "revoke",
			"device_id": check.DeviceID,
			"nonce":     wire.B64u([]byte{byte(nonceN), 9, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}),
			"iat":       fake.NowSec, "exp": fake.NowSec + 30,
			"payload": payload,
		}
		raw, err := p.Process(signCmd(t, gwPriv, m))
		if err != nil {
			t.Fatal(err)
		}
		return parseAck(t, raw)
	}

	cases := []struct {
		name    string
		payload map[string]any
	}{
		{"no seq", map[string]any{"entries": []any{}}},
		{"seq zero", map[string]any{"seq": 0, "entries": []any{}}},
		{"negative seq", map[string]any{"seq": -1, "entries": []any{}}},
		{"no entries key", map[string]any{"seq": 1}},
		{"entries not an array", map[string]any{"seq": 1, "entries": "grant-a"}},
		{"entry not an object", map[string]any{"seq": 1, "entries": []any{"grant-a"}}},
		{"entry with no id", map[string]any{"seq": 1, "entries": []any{map[string]any{"exp": 99}}}},
		{"one good entry, one bad", map[string]any{"seq": 1, "entries": []any{
			map[string]any{"grant_id": "good", "exp": 99999999999},
			map[string]any{"exp": 99},
		}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a := run(c.payload)
			if a.Result == command.ResultOK {
				t.Fatalf("malformed payload accepted: %+v", a)
			}
			// The detail matters, and distinguishes this from the stale case.
			// A hub that sent seq 0 has a BUG; a hub whose seq is merely lower
			// than the stored one may be an attacker replaying it. Collapsing
			// both to one detail would leave the state layer's rollback rule
			// as the only thing checking either — and it would then be a
			// backstop masking this guard rather than a second opinion.
			if a.Detail != command.DetailRevokeBad {
				t.Errorf("detail = %q, want %q", a.Detail, command.DetailRevokeBad)
			}
		})
	}
	// Nothing from any of those landed — in particular the good entry that
	// shared a payload with a bad one.
	if p.State.RevokedAt("good", check.Now) {
		t.Error("half a malformed list was applied")
	}
	if got := p.State.Revocations().Seq; got != 0 {
		t.Errorf("seq = %d after only malformed lists, want 0", got)
	}
}

// A revocation must land WHILE lockdown is latched.
//
// docs/GRANT-REVOCATION.md §3.8. The sequence that motivates this is the one an
// operator actually performs: someone is fired, the operator latches lockdown
// because it is the only lever that works instantly, and now needs to narrow it
// to that one person so everybody else can get back in. If `revoke` were
// refused under lockdown, the only route to a targeted revocation would be to
// LIFT first — opening every gate to everyone, including the person just fired,
// which is precisely the state the freeze exists to prevent.
//
// Allowing it costs nothing: the list actuates nothing and can only add
// denials, so it cannot weaken the freeze it arrives during.
func TestARevocationLandsWhileLockdownIsLatched(t *testing.T) {
	_, gwPriv, _, gwPubB64, ctrlPriv := testKeys(t)
	check := vectorfile.Check{
		Now:          1789000010,
		DeviceID:     "de71ce00-0000-4000-8000-000000000001",
		AccessPoints: []string{"main"},
	}
	p, fake, _ := newProcessor(t, check, gwPubB64, ctrlPriv)

	n := 0
	run := func(name string, payload map[string]any) wire.Ack {
		t.Helper()
		n++
		m := map[string]any{
			"v": 0, "typ": "cmd", "cmd": name,
			"device_id": check.DeviceID,
			"nonce":     wire.B64u([]byte{byte(n), 4, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}),
			"iat":       fake.NowSec, "exp": fake.NowSec + 30,
		}
		if payload != nil {
			m["payload"] = payload
		}
		raw, err := p.Process(signCmd(t, gwPriv, m))
		if err != nil {
			t.Fatal(err)
		}
		return parseAck(t, raw)
	}

	if a := run("lockdown", nil); a.Result != command.ResultOK {
		t.Fatalf("lockdown: %+v", a)
	}
	if a := run("revoke", map[string]any{"seq": 1, "entries": []any{
		map[string]any{"grant_id": "fired-worker", "exp": check.Now + 3600},
	}}); a.Result != command.ResultOK {
		t.Fatalf("revoke under lockdown: %+v — an operator would have to lift the freeze "+
			"to install a targeted revocation", a)
	}
	if !p.State.RevokedAt("fired-worker", check.Now) {
		t.Fatal("the revocation was acknowledged under lockdown and did not land")
	}
	// And the freeze itself is untouched: revoke is not a back door to lifting.
	if !p.State.Lockdown() {
		t.Fatal("revoke cleared the lockdown latch")
	}
	if a := run("open", nil); a.Result == "opened" {
		t.Fatal("a gate opened while lockdown was latched")
	}
}
