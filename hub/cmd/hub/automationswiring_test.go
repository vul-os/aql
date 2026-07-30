package main

// The automations engine's ownership wiring, exercised against a REAL store.
//
// Every other test of this rule uses a fake owner function. That proves
// checkDeviceOwnership refuses what it is told to refuse; it cannot prove the
// binary asks the right question. The question changed when the access driver
// landed: a gate is never CLAIMED, so DeviceOwnerAccount reports it as belonging
// to nobody, and "unclaimed is permitted" would let a rule in one account name
// another account's gate.
//
// This is the shape this repository keeps getting caught by — a correct
// component wired to the wrong source, or to nothing — so the wiring gets its
// own test rather than being inferred from the two halves passing separately.

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/vul-os/aql/hub/internal/automations"
	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/devices/accessdev"
	"github.com/vul-os/aql/hub/internal/store"
)

// gateHub builds a hub with a real store and a real access driver, and returns
// it alongside the two accounts' gate keys.
func gateHub(t *testing.T) (h *hub, keyA, keyB, acctA string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()

	mk := func(username, gate string) (accountID, apID string) {
		t.Helper()
		u, err := st.CreateUser(ctx, username, "x", username, "ZA")
		if err != nil {
			t.Fatal(err)
		}
		acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, username+"'s place", "ZA")
		if err != nil {
			t.Fatal(err)
		}
		ap, err := st.CreateAccessPointFull(ctx, acct.ID, loc.ID, gate, "gate", "", nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		return acct.ID, ap.ID
	}
	aID, apA := mk("alice", "Alice's Gate")
	_, apB := mk("bob", "Bob's Gate")

	drv, err := accessdev.New(accessdev.Config{
		List: func(ctx context.Context) ([]accessdev.AccessPoint, error) {
			rows, err := st.AllAccessPoints(ctx)
			if err != nil {
				return nil, err
			}
			out := make([]accessdev.AccessPoint, 0, len(rows))
			for _, r := range rows {
				out = append(out, accessdev.AccessPoint{
					ID: r.ID, AccountID: r.AccountID, Name: r.Name,
					Kind: r.Kind, DeviceID: r.DeviceID, Status: r.Status,
				})
			}
			return out, nil
		},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	reg := devices.NewRegistry()
	if err := reg.Register(drv); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	h = &hub{store: st, reg: reg, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	return h, devices.Key(accessdev.DriverID, apA), devices.Key(accessdev.DriverID, apB), aID
}

// THE test. The binary must resolve a gate to the account that owns its
// location, not to "nobody".
func TestARuleCannotNameAnotherAccountsGate(t *testing.T) {
	h, keyA, keyB, acctA := gateHub(t)
	eng := h.newAutomationsEngine()
	if eng == nil {
		t.Fatal("no automations engine was built")
	}
	ctx := context.Background()

	// Alice's own gate resolves to Alice, so a rule naming it is not refused
	// for ownership. `status` is the only verb an access device offers.
	own := automations.Rule{
		AccountID: acctA, Name: "watch my gate", Enabled: true,
		Trigger: automations.Trigger{
			Kind:     automations.TriggerSchedule,
			Schedule: &automations.Schedule{MinuteOfDay: 18 * 60, Days: automations.EveryDay},
		},
		Action: automations.Action{DeviceKey: keyA, Verb: devices.VerbStatus},
	}
	if _, err := eng.SaveRule(ctx, own); automations.RefusalReason(err) == automations.ReasonForeignDevice {
		t.Errorf(`a rule naming its OWN account's gate was refused as foreign: %v

The gate resolved to nobody, which means the binary is still asking
DeviceOwnerAccount — where a gate has no row, because nothing claims a gate.`, err)
	}

	// Bob's gate must be refused, and the refusal must not describe Bob.
	foreign := own
	foreign.Name = "watch Bob's gate"
	foreign.Action.DeviceKey = keyB
	_, err := eng.SaveRule(ctx, foreign)
	if automations.RefusalReason(err) != automations.ReasonForeignDevice {
		t.Fatalf(`a rule naming ANOTHER account's gate was accepted (err = %v).

A gate carries no device_ownership row, so it reads as unclaimed — and the
automations engine permits unclaimed devices deliberately, for hubs that predate
ownership. With the access driver on, that made every gate on the hub nameable by
every account.`, err)
	}
	if err != nil && (contains(err.Error(), "Bob") || contains(err.Error(), "bob")) {
		t.Errorf("the refusal names the other tenant: %v", err)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	}()
}
