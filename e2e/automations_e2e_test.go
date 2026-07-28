package e2e

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// The automations runtime, end to end — and in particular the one safety claim
// this product makes loudest.
//
// "An automation cannot open a gate" is enforced by MaxActionTier, a
// compile-time constant checked when a rule is saved and again immediately
// before the driver call. internal/automations tests that against a mock
// registry; internal/httpapi tests the handler. Nothing had ever asserted it
// through a running hub with a real driver and a real device — which is the
// only arrangement where "the ceiling holds" means what a reader thinks it
// means.

// gateDeviceConfig declares a device with an ACCESS capability, so the ceiling
// has something real to refuse. It is the same fake HTTP device; what changes
// is what it claims to be.
func gateDeviceConfig(t *testing.T, deviceURL string) string {
	t.Helper()
	return writeDeviceConfig(t, map[string]any{
		"http": map[string]any{
			"ID": "http",
			"Devices": []map[string]any{{
				"ID":             "gate-1",
				"Name":           "Test barrier",
				"Kind":           "access",
				"Zone":           "Yard",
				"Capabilities":   []string{"access.barrier"},
				"AllowPlaintext": true,
				"Actions": map[string]any{
					"open":  map[string]any{"Method": "POST", "URL": deviceURL + "/on", "Idempotent": true},
					"close": map[string]any{"Method": "POST", "URL": deviceURL + "/off", "Idempotent": true},
				},
				"Reads": []map[string]any{{
					"URL":     deviceURL + "/state",
					"Metrics": []map[string]any{{"Metric": "on", "Path": "power.on"}},
				}},
			}},
		},
	})
}

// TestAutomations_CannotBeGivenAGate is the claim, asserted where it counts.
func TestAutomations_CannotBeGivenAGate(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithAutomations(t, gateDeviceConfig(t, dev.srv.URL))
	ten := gw.register(t)

	before := dev.calls.Load()
	st, body, raw := httpJSON(t, http.MethodPost,
		gw.url+"/v1/accounts/"+ten.accountID+"/automations", ten.token,
		map[string]any{
			"name":    "open the gate at 3am",
			"enabled": true,
			"trigger": map[string]any{
				"kind":     "schedule",
				"schedule": map[string]any{"minute_of_day": 180, "days": 127, "tz": "UTC"},
			},
			"action":               map[string]any{"device_key": "http:gate-1", "verb": "open"},
			"conditions":           []any{},
			"min_interval_seconds": 0,
		})

	if st == 201 {
		t.Fatalf("a hub ACCEPTED an unattended rule that opens a gate: %s", raw)
	}
	// The engine's own vocabulary, not a code invented at the HTTP layer — the
	// scheduler logs the same name, so a console that learns it once recognises
	// it from either source.
	if got, _ := body["error"].(string); got != "tier_too_high" {
		t.Fatalf("refusal = %q, want tier_too_high (the ceiling), not a different "+
			"reason that happens to also refuse", got)
	}
	if dev.calls.Load() != before {
		t.Fatal("a refused rule still reached the device")
	}
}

// The control: the SAME device's close verb is below the ceiling and must save,
// or the assertion above would pass on a hub that simply refuses everything.
func TestAutomations_AReversibleActionOnTheSameDeviceIsAccepted(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithAutomations(t, gateDeviceConfig(t, dev.srv.URL))
	ten := gw.register(t)

	st, body, raw := httpJSON(t, http.MethodPost,
		gw.url+"/v1/accounts/"+ten.accountID+"/automations", ten.token,
		map[string]any{
			"name":    "close the gate at dusk",
			"enabled": true,
			"trigger": map[string]any{
				"kind":     "schedule",
				"schedule": map[string]any{"minute_of_day": 1080, "days": 127, "tz": "UTC"},
			},
			"action":               map[string]any{"device_key": "http:gate-1", "verb": "close"},
			"conditions":           []any{},
			"min_interval_seconds": 0,
		})
	if st != 201 {
		t.Fatalf("a reversible action was refused: %d %s", st, raw)
	}
	if body["action_tier"] == nil || body["max_action_tier"] == nil {
		t.Errorf("the saved rule reports no tier and ceiling: %s", raw)
	}
}

// A rule that fires must actually move the device. This is the automations
// equivalent of the engine test: proof the runtime reaches hardware rather than
// only recording that it meant to.
func TestAutomations_AFiredRuleActuatesTheDevice(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithAutomations(t, deviceConfigFile(t, dev.srv.URL))
	ten := gw.register(t)

	// A lamp, not a gate — the ceiling permits this one, which is the point.
	st, body, raw := httpJSON(t, http.MethodPost,
		gw.url+"/v1/accounts/"+ten.accountID+"/automations", ten.token,
		map[string]any{
			"name":    "lights on",
			"enabled": true,
			"trigger": map[string]any{
				"kind":     "schedule",
				"schedule": map[string]any{"minute_of_day": 60, "days": 127, "tz": "UTC"},
			},
			"action":               map[string]any{"device_key": "http:lamp-1", "verb": "on"},
			"conditions":           []any{},
			"min_interval_seconds": 0,
		})
	if st != 201 {
		t.Fatalf("create rule: %d %s", st, raw)
	}
	ruleID, _ := body["id"].(string)
	if ruleID == "" {
		t.Fatalf("no rule id: %s", raw)
	}

	if dev.on.Load() {
		t.Fatal("the lamp started on")
	}
	// RunNow goes through Fire — same conditions, same tier gate, same audit
	// row as a scheduled firing. A "test run" that bypassed any of those would
	// be a way to launder a hazardous action through a button.
	st, _, raw = httpJSON(t, http.MethodPost,
		gw.url+"/v1/accounts/"+ten.accountID+"/automations/"+ruleID+"/run", ten.token, nil)
	if st != 200 {
		t.Fatalf("run now: %d %s", st, raw)
	}

	var run struct {
		Outcome string `json:"outcome"`
		Verb    string `json:"verb"`
	}
	_ = json.Unmarshal([]byte(raw), &run)
	if !dev.on.Load() {
		t.Fatalf("the rule reported %q and the lamp never switched — the runtime "+
			"recorded an action it did not deliver", run.Outcome)
	}

	// And the run is visible in the history the console reads.
	st, _, raw = httpJSON(t, http.MethodGet,
		gw.url+"/v1/accounts/"+ten.accountID+"/automations/"+ruleID+"/runs", ten.token, nil)
	if st != 200 {
		t.Fatalf("runs: %d %s", st, raw)
	}
	if !strings.Contains(raw, `"verb":"on"`) {
		t.Errorf("the fired run is missing from the rule's history: %s", raw)
	}
}
