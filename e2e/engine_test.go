package e2e

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// The device engine, end to end: a real hub binary, a real driver, a real
// device, and the engine's own HTTP API.
//
// Everything about the engine has been tested at one level or another —
// internal/devices covers the registry and the tier catalogue, each driver
// package covers its own protocol against a fake, internal/httpapi covers the
// routes. Nothing put those together. A hub could have shipped with a driver
// that built, an API that answered and a registry that never actually reached a
// device, and every one of those suites would have stayed green.
//
// This is the missing seam. httpdev is the driver used because a REST device is
// the one a test can BE — no broker, no radio, no camera — so the thing being
// exercised is the engine and its wiring rather than a protocol mock.

// fakeDevice is a lamp with a REST API, of the shape httpdev is built for.
type fakeDevice struct {
	srv *httptest.Server
	// on and level are the device's actual state, changed only by a real
	// request arriving from the hub. That is the point: the assertions below
	// read this, not a mock's call log, so "the engine actuated it" means the
	// device moved.
	on    atomic.Bool
	level atomic.Int64
	calls atomic.Int64
}

func newFakeDevice(t *testing.T) *fakeDevice {
	t.Helper()
	d := &fakeDevice{}
	d.level.Store(40)
	mux := http.NewServeMux()
	mux.HandleFunc("/state", func(w http.ResponseWriter, r *http.Request) {
		d.calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"power": map[string]any{"on": d.on.Load()},
			"level": d.level.Load(),
		})
	})
	mux.HandleFunc("/on", func(w http.ResponseWriter, r *http.Request) {
		d.calls.Add(1)
		d.on.Store(true)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/off", func(w http.ResponseWriter, r *http.Request) {
		d.calls.Add(1)
		d.on.Store(false)
		w.WriteHeader(http.StatusNoContent)
	})
	d.srv = httptest.NewServer(mux)
	t.Cleanup(d.srv.Close)
	return d
}

// deviceConfigFile writes the JSON the hub's -device-config flag reads.
//
// Written from the Go structs' own field names rather than a hand-kept copy:
// httpdev's Config has no json tags, so the file keys ARE the Go field names,
// and a rename there breaks this test rather than silently producing a hub with
// no devices.
func deviceConfigFile(t *testing.T, deviceURL string) string {
	t.Helper()
	cfg := map[string]any{
		"http": map[string]any{
			"ID": "http",
			"Devices": []map[string]any{{
				"ID":           "lamp-1",
				"Name":         "Test lamp",
				"Kind":         "lighting",
				"Zone":         "Lab",
				"Capabilities": []string{"light.switch"},
				// The fake listens on plain HTTP on loopback, which the driver
				// refuses unless told the operator meant it.
				"AllowPlaintext": true,
				"Actions": map[string]any{
					"on":  map[string]any{"Method": "POST", "URL": deviceURL + "/on", "Idempotent": true},
					"off": map[string]any{"Method": "POST", "URL": deviceURL + "/off", "Idempotent": true},
				},
				"Reads": []map[string]any{{
					"URL": deviceURL + "/state",
					"Metrics": []map[string]any{
						// A DOTTED path, so the test covers the extraction and
						// not just a flat lookup.
						{"Metric": "on", "Path": "power.on"},
						{"Metric": "level", "Path": "level"},
					},
				}},
			}},
		},
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "devices.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestDeviceEngine_DrivesARealDeviceEndToEnd is the assertion the engine has
// never had: a command entering the hub's HTTP API comes out as a request at a
// device, and the device's own state changes.
func TestDeviceEngine_DrivesARealDeviceEndToEnd(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithDevices(t, deviceConfigFile(t, dev.srv.URL))
	ten := gw.register(t)

	// The fleet, as the console would fetch it.
	var fleet struct {
		Engine  bool `json:"engine"`
		Devices []struct {
			Key          string `json:"key"`
			Name         string `json:"name"`
			Kind         string `json:"kind"`
			Availability string `json:"availability"`
		} `json:"devices"`
	}
	st, _, raw := httpJSON(t, http.MethodGet, gw.url+"/v1/engine/devices", ten.token, nil)
	if st != 200 {
		t.Fatalf("engine devices: %d %s", st, raw)
	}
	if err := json.Unmarshal([]byte(raw), &fleet); err != nil {
		t.Fatalf("decode fleet: %v", err)
	}
	if !fleet.Engine {
		t.Fatal("the hub reports no device engine despite being started with a driver")
	}
	if len(fleet.Devices) != 1 || fleet.Devices[0].Key != "http:lamp-1" {
		t.Fatalf("fleet = %+v, want one device keyed http:lamp-1", fleet.Devices)
	}

	// READ: the hub reaches the device and reports its actual state.
	before := dev.calls.Load()
	st, _, raw = httpJSON(t, http.MethodGet,
		gw.url+"/v1/engine/devices/http:lamp-1/readings", ten.token, nil)
	if st != 200 {
		t.Fatalf("readings: %d %s", st, raw)
	}
	if dev.calls.Load() == before {
		t.Fatal("a readings request reached no device; the engine answered from nothing")
	}
	if !containsMetric(raw, "level", 40) {
		t.Fatalf("readings did not carry the device's real level: %s", raw)
	}

	// EXECUTE: the command comes out the other side as a real request.
	if dev.on.Load() {
		t.Fatal("the fake lamp started on")
	}
	st, _, raw = httpJSON(t, http.MethodPost,
		gw.url+"/v1/engine/devices/http:lamp-1/execute", ten.token,
		map[string]any{"verb": "on", "args": map[string]float64{}, "confirm": false})
	if st != 200 {
		t.Fatalf("execute on: %d %s", st, raw)
	}
	if !dev.on.Load() {
		t.Fatal("the hub reported success and the device never turned on — the engine " +
			"acked a command it did not deliver, which is the one failure the whole " +
			"seam exists to make impossible")
	}

	// And the new state is visible through the same API.
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, _, raw = httpJSON(t, http.MethodGet,
			gw.url+"/v1/engine/devices/http:lamp-1/readings", ten.token, nil)
		if containsMetric(raw, "on", 1) || time.Now().After(deadline) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !containsMetric(raw, "on", 1) {
		t.Fatalf("the device is on but the engine still reports it off: %s", raw)
	}
}

// A verb a device does not declare must be refused by the REGISTRY, before any
// driver is asked — that is what makes the capability catalogue a control
// rather than documentation.
func TestDeviceEngine_RefusesAVerbTheDeviceDoesNotHave(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithDevices(t, deviceConfigFile(t, dev.srv.URL))
	ten := gw.register(t)

	before := dev.calls.Load()
	// `open` belongs to access.barrier. This lamp declares light.switch, and
	// every access verb sits above the automation ceiling besides.
	st, _, raw := httpJSON(t, http.MethodPost,
		gw.url+"/v1/engine/devices/http:lamp-1/execute", ten.token,
		map[string]any{"verb": "open", "args": map[string]float64{}, "confirm": false})
	if st == 200 {
		t.Fatalf("a lamp accepted `open`: %s", raw)
	}
	if dev.calls.Load() != before {
		t.Fatal("a refused verb still produced a request at the device; the refusal " +
			"happened after the driver was asked, not before")
	}
}

func containsMetric(raw, metric string, want float64) bool {
	var body struct {
		Readings []struct {
			Metric string  `json:"metric"`
			Value  float64 `json:"value"`
		} `json:"readings"`
	}
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		return false
	}
	for _, r := range body.Readings {
		if r.Metric == metric && r.Value == want {
			return true
		}
	}
	return false
}
