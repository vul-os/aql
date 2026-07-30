package httpapi

// Tenancy for the access driver's devices.
//
// Access points reach the engine through the read-only `access` driver, and they
// carry NO device_ownership row: nothing claims a gate, because a gate is
// already owned through its location's account. engineScope resolves ownership
// from device_ownership, so without deriving the access-point half every gate
// reads as UNCLAIMED — and on a multi-account hub `permits` denies an unclaimed
// device to everyone but the instance admin.
//
// That failure is silent and fail-closed: a member simply does not see their own
// gates, no error anywhere, and the console hides engine access rows anyway (they
// duplicate the hub's richer row), so nothing on screen would look wrong either.
// docs/ACCESS-ON-THE-ENGINE.md §3.5 specified the derivation and the first
// implementation did not do it. This is the test that would have said so.

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/devices/accessdev"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// accessEngineServer is engineServer with a real access driver over the store,
// so the fleet it serves is the one a hub with -device-drivers=access serves.
func accessEngineServer(t *testing.T) (http.Handler, *store.Store, *devices.Registry) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
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
	s := New(Config{
		Version:   "test",
		JWTSecret: []byte("0123456789abcdef0123456789abcdef"),
		Devices:   reg,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st, reg
}

func mkGate(t *testing.T, h http.Handler, access, locID, name string) string {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locID, "name": name, "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create access point: %d %s", rec.Code, rec.Body)
	}
	return out["id"].(string)
}

func engineDeviceKeys(t *testing.T, h http.Handler, access string) map[string]bool {
	t.Helper()
	rec, out := doJSON(t, h, "GET", "/v1/engine/devices", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list engine devices: %d %v", rec.Code, out)
	}
	keys := map[string]bool{}
	devs, _ := out["devices"].([]any)
	for _, d := range devs {
		m, _ := d.(map[string]any)
		if k, _ := m["key"].(string); k != "" {
			keys[k] = true
		}
	}
	return keys
}

// The whole point, in one test: my gate yes, yours no.
func TestOnAMultiAccountHubAMemberSeesTheirOwnGatesAndNoOthers(t *testing.T) {
	h, _, reg := accessEngineServer(t)
	accessA, _ := register(t, h, "a@gates.com")
	accessB, _ := register(t, h, "b@gates.com")
	_, locA := tenantIDs(t, h, accessA)
	_, locB := tenantIDs(t, h, accessB)

	apA := mkGate(t, h, accessA, locA, "Gate A")
	apB := mkGate(t, h, accessB, locB, "Gate B")
	// The driver reads at Discover, so the fleet has to be refreshed after the
	// gates exist — a hub does this on its discovery tick.
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}

	keyA, keyB := devices.Key(accessdev.DriverID, apA), devices.Key(accessdev.DriverID, apB)

	seenByA := engineDeviceKeys(t, h, accessA)
	if !seenByA[keyA] {
		t.Errorf(`account A cannot see its own gate %s in the engine fleet.

Access points carry no device_ownership row, so without deriving ownership from
the access point's location they read as unclaimed — and an unclaimed device is
denied to everyone but the instance admin on a multi-account hub. The failure is
fail-closed and therefore silent: no error, just a fleet that never mentions the
gates. See docs/ACCESS-ON-THE-ENGINE.md §3.5.`, keyA)
	}
	if seenByA[keyB] {
		t.Errorf("account A can see account B's gate %s. AllAccessPoints is deliberately "+
			"cross-account for the DRIVER; the request path must narrow it back down", keyB)
	}

	seenByB := engineDeviceKeys(t, h, accessB)
	if !seenByB[keyB] {
		t.Errorf("account B cannot see its own gate %s", keyB)
	}
	if seenByB[keyA] {
		t.Errorf("account B can see account A's gate %s", keyA)
	}
}

// The per-device routes must narrow the same way the listing does. A fleet that
// hides a gate while the readings route still answers for it would be the more
// dangerous half of the same bug.
func TestOneAccountCannotReadAnotherAccountsGateThroughTheEngine(t *testing.T) {
	h, _, reg := accessEngineServer(t)
	accessA, _ := register(t, h, "a@probe.com")
	accessB, _ := register(t, h, "b@probe.com")
	_, locA := tenantIDs(t, h, accessA)
	_, _ = tenantIDs(t, h, accessB)

	apA := mkGate(t, h, accessA, locA, "Gate A")
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	keyA := devices.Key(accessdev.DriverID, apA)

	for _, p := range engineProbes(keyA)[2:] { // the per-device routes only
		rec, out := doJSON(t, h, p.method, p.path, accessB, p.body)
		if rec.Code != http.StatusForbidden || out["error"] != "not_engine_authority" {
			t.Errorf("%s %s as a stranger = %d %v, want 403 not_engine_authority",
				p.method, p.path, rec.Code, out)
		}
	}
}

// Even the owner cannot actuate one. The engine route must refuse an access verb
// on a gate belonging to the caller, because opening lives on the signed path —
// this is the HTTP-level statement of accessdev's refusal.
func TestTheEngineRouteWillNotOpenAGateEvenForItsOwner(t *testing.T) {
	h, _, reg := accessEngineServer(t)
	access, _ := register(t, h, "owner@gates.com")
	_, loc := tenantIDs(t, h, access)
	ap := mkGate(t, h, access, loc, "Main Gate")
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	key := devices.Key(accessdev.DriverID, ap)

	for _, verb := range []string{"open", "unlock", "hold", "close"} {
		rec, out := doJSON(t, h, "POST", "/v1/engine/devices/"+key+"/execute", access,
			map[string]any{"verb": verb, "confirm": true})
		if rec.Code >= 200 && rec.Code < 300 {
			t.Errorf("POST execute %s on a gate returned %d — the device engine actuated an "+
				"access point. Opening belongs to the signed Ed25519 path; see "+
				"docs/ACCESS-ON-THE-ENGINE.md §3.1", verb, rec.Code)
		}
		_ = out
	}
}
