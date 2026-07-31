package e2e

// The access driver, end to end: a real hub binary, no device config, and a
// gate that appears in the engine's fleet.
//
// Everything about this driver has been covered at some level — accessdev
// against a fake lister, httpapi for the tenancy scope, cmd/hub for the wiring —
// and none of it started the binary. That matters here more than usual, because
// every defect this driver produced lived in composition rather than in the
// package: a duplicated console row, a double-counted fleet, gates offered as
// automation targets, and ownership that resolved to nobody. Each was in a file
// the driver never touched, and each unit suite stayed green through it.
//
// It also pins the one deviation the driver has from every other: `access` is
// the only driver that takes NO -device-config, because it reads the database.
// That path exists nowhere else and is easy to break with a well-meant "require
// a config file" tidy-up.

import (
	"encoding/json"
	"net/http"
	"testing"
)

// engineKeys returns the device keys the engine reports to this tenant.
func engineKeys(t *testing.T, gw *gateway, ten *tenant) map[string]string {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, gw.url+"/v1/engine/devices", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+ten.token)
	st, body, raw := doReq(t, req)
	if st != 200 {
		t.Fatalf("GET /v1/engine/devices: %d %s", st, raw)
	}
	out := map[string]string{}
	devs, _ := body["devices"].([]any)
	for _, d := range devs {
		m, _ := d.(map[string]any)
		key, _ := m["key"].(string)
		kind, _ := m["kind"].(string)
		if key != "" {
			out[key] = kind
		}
	}
	return out
}

func TestAccessDriverSurfacesGatesWithNoDeviceConfig(t *testing.T) {
	dataDir := t.TempDir()

	// A hub with the access driver and NO -device-config. Every other driver
	// requires one; this is the whole of that deviation, exercised.
	gw := startGatewayIn(t, dataDir, []string{"-device-drivers", "access"})
	ten := gw.register(t)
	apID := gw.createAP(t, ten, "Main Gate", "")

	// Discovery runs on an interval, so a gate created after boot is not in the
	// fleet yet. Restarting is what an operator does and what the harness
	// supports; it also proves the driver reads the DATABASE at startup rather
	// than anything cached from the run that created the gate.
	gw.stop(t)
	gw = startGatewayIn(t, dataDir, []string{"-device-drivers", "access"})

	keys := engineKeys(t, gw, ten)
	want := "access:" + apID
	kind, ok := keys[want]
	if !ok {
		got, _ := json.Marshal(keys)
		t.Fatalf(`the engine does not report %s.

The access driver is built from the database rather than a config file, so a hub
started with -device-drivers=access and no -device-config should list every gate
the account owns. Fleet was: %s`, want, got)
	}
	if kind != "access" {
		t.Errorf("%s has kind %q, want access", want, kind)
	}
}

// Opening stays on the signed path. The engine must refuse, in a real process,
// for the gate's own owner — this is docs/ACCESS-ON-THE-ENGINE.md §3.1 asserted
// against the binary rather than against the driver in isolation.
func TestTheEngineRouteWillNotOpenAGateEndToEnd(t *testing.T) {
	dataDir := t.TempDir()
	gw := startGatewayIn(t, dataDir, []string{"-device-drivers", "access"})
	ten := gw.register(t)
	apID := gw.createAP(t, ten, "Main Gate", "")
	gw.stop(t)
	gw = startGatewayIn(t, dataDir, []string{"-device-drivers", "access"})

	key := "access:" + apID
	if _, ok := engineKeys(t, gw, ten)[key]; !ok {
		t.Fatalf("fixture: %s is not in the fleet", key)
	}

	for _, verb := range []string{"open", "unlock", "hold"} {
		st, _, raw := httpJSON(t, http.MethodPost,
			gw.url+"/v1/engine/devices/"+key+"/execute", ten.token,
			map[string]any{"verb": verb, "confirm": true})
		if st >= 200 && st < 300 {
			t.Errorf(`POST execute %s on a gate returned %d.

The device engine actuated an access point. Opening belongs to the signed
Ed25519 path, which verifies membership, time windows, geofences and quotas and
audits in the same transaction as the decision. Response: %s`, verb, st, raw)
		}
	}
}
