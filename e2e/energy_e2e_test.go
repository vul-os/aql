package e2e

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// Energy metering, end to end.
//
// internal/energy is thoroughly tested — ingestion, counter wraps, rollups,
// source mix — but always against samples handed to it directly. The path that
// had never been exercised is the one that matters in a running hub: the poller
// asking the REGISTRY for meters, the registry asking a DRIVER, the driver
// reaching a device, and the reading landing somewhere the console can read it.
//
// A hub could have had a perfect metering engine wired to nothing at all, and
// every existing energy test would have passed.

// meterDeviceConfig declares an energy meter — the kind the poller looks for.
func meterDeviceConfig(t *testing.T, deviceURL string) string {
	t.Helper()
	return writeDeviceConfig(t, map[string]any{
		"http": map[string]any{
			"ID": "http",
			"Devices": []map[string]any{{
				"ID":             "meter-1",
				"Name":           "Test meter",
				"Kind":           "energy",
				"Zone":           "Utility",
				"Capabilities":   []string{"energy.meter"},
				"AllowPlaintext": true,
				"Reads": []map[string]any{{
					"URL": deviceURL + "/state",
					// `level` is the fake's counter-ish value; what matters here
					// is that a NUMBER reaches the metering engine from a real
					// device, not what it means.
					"Metrics": []map[string]any{{"Metric": "kw", "Path": "level"}},
				}},
			}},
		},
	})
}

// TestEnergy_PollerReachesARealMeterThroughTheRegistry asserts the whole chain,
// by checking the one thing that can only happen if every link worked: a
// channel the hub was never configured with, auto-created from a reading it
// actually took.
func TestEnergy_PollerReachesARealMeterThroughTheRegistry(t *testing.T) {
	// The poller's default cadence is 60s, which no test should wait for. Set
	// here rather than passed in from outside: a test that only passes when the
	// caller remembers an environment variable is a test that will be reported
	// green on a run where it did nothing.
	t.Setenv("AQL_ENERGY_INTERVAL", "1s")

	dev := newFakeDevice(t)

	// The poller is bound to an account id, which must exist before the hub
	// starts — so a first hub creates the tenant, then a second boots with
	// metering pointed at it. That ordering is the product's own constraint
	// (main.go refuses an -energy-account that names no account), not a test
	// artifact.
	bootstrap := startGateway(t)
	ten := bootstrap.register(t)
	accountID := ten.accountID
	dataDir := bootstrap.dataDir
	bootstrap.stop(t)

	gw := startGatewayIn(t, dataDir, []string{
		"-device-drivers", "http",
		"-device-config", meterDeviceConfig(t, dev.srv.URL),
		"-energy-account", accountID,
	})

	// The poller runs on its own schedule; wait for evidence rather than
	// assuming a tick has happened.
	deadline := time.Now().Add(20 * time.Second)
	var channels struct {
		Channels []struct {
			DeviceKey string `json:"device_key"`
			Metric    string `json:"metric"`
			Source    string `json:"source"`
		} `json:"channels"`
	}
	for {
		st, _, raw := httpJSON(t, http.MethodGet,
			gw.url+"/v1/accounts/"+accountID+"/energy/channels", ten.token, nil)
		if st == 200 {
			_ = json.Unmarshal([]byte(raw), &channels)
			if len(channels.Channels) > 0 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no energy channel appeared in 20s; the poller never reached the "+
				"meter through the registry. hub log:\n%s", gw.logs.String())
		}
		time.Sleep(300 * time.Millisecond)
	}

	c := channels.Channels[0]
	if c.DeviceKey != "http:meter-1" || c.Metric != "kw" {
		t.Fatalf("channel = %+v, want the meter this hub was pointed at", c)
	}
	// Auto-created channels are `unattributed` on purpose: the engine records
	// the energy so it is visible rather than dropped, and refuses to guess
	// whether it was grid, solar or battery. Folding it into a source nobody
	// declared would be the invention internal/energy exists to avoid.
	if c.Source != "unattributed" {
		t.Errorf("source = %q; a channel the operator never declared must not be "+
			"attributed to a source the hub guessed", c.Source)
	}

	if dev.calls.Load() == 0 {
		t.Fatal("a channel exists but the device was never called — the reading did " +
			"not come from the meter")
	}
}
