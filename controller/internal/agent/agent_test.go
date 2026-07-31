package agent_test

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/vul-os/aql/controller/internal/agent"
	"github.com/vul-os/aql/controller/internal/state"
)

// The agent's pairing precondition and the snapshot every offline grant
// decision reads. Both were at zero — found by the controller coverage audit.

func newAgent(t *testing.T, opts agent.Options) *agent.Agent {
	t.Helper()
	if opts.StateDir == "" {
		opts.StateDir = t.TempDir()
	}
	a, err := agent.New(opts)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// GrantEnv is the whole context an offline redemption is judged against. Every
// field is load-bearing and a dropped one fails in a different direction, so
// each is checked against a state deliberately set to a non-default value —
// a zero-valued Env would satisfy a test that only asserted "no error".
func TestGrantEnvCarriesEveryFieldTheDecisionNeeds(t *testing.T) {
	a := newAgent(t, agent.Options{})

	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	// The key is PINNED as base64url on disk and decoded on read, so this also
	// exercises the round trip GrantEnv depends on.
	if err := a.St.SavePairing(state.Pairing{
		DeviceID:      "dev-7",
		GatewayPubkey: base64.RawURLEncoding.EncodeToString(pub),
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.St.SetLockdown(true); err != nil {
		t.Fatal(err)
	}
	a.Clock.SyncFromGateway(1_700_000_500)

	env := a.GrantEnv()

	// The one that opens a gate during a lockdown if it is dropped.
	if !env.Lockdown {
		t.Error("GrantEnv reports no lockdown while the controller is locked down — " +
			"an offline grant would open a gate that is supposed to be sealed")
	}
	if env.DeviceID != "dev-7" {
		t.Errorf("DeviceID = %q, want dev-7 — a grant bound to this device would not match", env.DeviceID)
	}
	if string(env.GatewayKey) != string(pub) {
		t.Error("GatewayKey is not the pinned key — grant signatures would be checked against the wrong key")
	}
	// Times come from the controller's synced clock, which is what the
	// stale-clock rule is evaluated against.
	if env.Now < 1_700_000_500 || env.Now > 1_700_000_505 {
		t.Errorf("Now = %d, want the synced base ~1700000500", env.Now)
	}
	if env.LastGatewaySync != 1_700_000_500 {
		t.Errorf("LastGatewaySync = %d, want 1700000500", env.LastGatewaySync)
	}
}

// An unpaired controller still produces a usable Env — with an EMPTY device id
// rather than a panic or a borrowed one. The verifier fails closed on it, which
// is the correct outcome for a controller that does not yet know who it is.
func TestGrantEnvOnAnUnpairedControllerIsEmptyNotInvented(t *testing.T) {
	a := newAgent(t, agent.Options{})
	env := a.GrantEnv()
	if env.DeviceID != "" {
		t.Errorf("DeviceID = %q on an unpaired controller", env.DeviceID)
	}
	if env.LastGatewaySync != 0 {
		t.Errorf("LastGatewaySync = %d before any sync, want 0 so the stale rule fires", env.LastGatewaySync)
	}
}

// Lockdown is read at snapshot time, not cached at construction. A controller
// put into lockdown while running must be in lockdown for the very next
// redemption.
func TestGrantEnvReflectsALockdownSetAfterStartup(t *testing.T) {
	a := newAgent(t, agent.Options{})
	if a.GrantEnv().Lockdown {
		t.Fatal("a fresh controller reports lockdown")
	}
	if err := a.St.SetLockdown(true); err != nil {
		t.Fatal(err)
	}
	if !a.GrantEnv().Lockdown {
		t.Error("a lockdown set after startup is not visible to the next redemption")
	}
}

// EnsurePaired is idempotent: an already-paired controller does no network I/O
// and does not re-pair. The options are absent here, so anything that tried to
// pair would fail — which is what makes this test meaningful rather than
// merely green.
func TestEnsurePairedDoesNothingWhenAlreadyPaired(t *testing.T) {
	a := newAgent(t, agent.Options{})
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	// A pairing without a valid pinned key is refused by the store — which is
	// itself worth knowing, and is why this fixture carries a real one.
	if err := a.St.SavePairing(state.Pairing{
		DeviceID:      "dev-1",
		GatewayPubkey: base64.RawURLEncoding.EncodeToString(pub),
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.EnsurePaired(context.Background()); err != nil {
		t.Fatalf("an already-paired controller tried to pair again: %v", err)
	}
	if p := a.St.Pairing(); p == nil || p.DeviceID != "dev-1" {
		t.Errorf("pairing was replaced: %+v", p)
	}
}

// An unpaired controller with no hub and no claim token refuses with an
// actionable message rather than dialling something.
func TestEnsurePairedRefusesWithoutTheFirstRunOptions(t *testing.T) {
	a := newAgent(t, agent.Options{})
	err := a.EnsurePaired(context.Background())
	if err == nil {
		t.Fatal("an unpaired controller with no options claimed to be paired")
	}
	if !strings.Contains(err.Error(), "--hub") || !strings.Contains(err.Error(), "--claim-token") {
		t.Errorf("the refusal does not name what is missing: %v", err)
	}

	// A half-configured first run is refused too — a hub with no token cannot
	// pair, and trying would surface as a confusing network error instead.
	b := newAgent(t, agent.Options{GatewayURL: "http://hub.invalid"})
	if err := b.EnsurePaired(context.Background()); err == nil {
		t.Error("pairing proceeded with a hub URL and no claim token")
	}
}
