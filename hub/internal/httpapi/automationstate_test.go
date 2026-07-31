package httpapi

import (
	"net/http"
	"testing"
)

// A state condition must survive the wire.
//
// The console loads a rule, edits it and PUTs the whole thing back — a save is
// a full replace, never a partial patch. So every field the engine understands
// has to survive JSON in BOTH directions, or the console silently rewrites the
// rule it was only meant to display. Condition.Metric/Op/Value are all
// `omitempty` now that the state form exists, which is exactly the shape of
// change that quietly drops a field nobody wrote a wire test for.
func TestAStateConditionSurvivesTheWire(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-state")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/automations", access, map[string]any{
		"name":    "porch light while the mower runs",
		"enabled": true,
		"trigger": map[string]any{
			"kind":     "schedule",
			"schedule": map[string]any{"minute_of_day": 1140, "days": 127},
		},
		"conditions": []any{
			map[string]any{"device_key": "mock:mower-1", "state": "active"},
		},
		"action": map[string]any{"device_key": "mock:lamp-1", "verb": "on"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("a state condition was refused on save: %d %v %v", rec.Code, out["error"], out["detail"])
	}

	conds, ok := out["conditions"].([]any)
	if !ok || len(conds) != 1 {
		t.Fatalf("conditions did not come back as one item: %#v", out["conditions"])
	}
	c, ok := conds[0].(map[string]any)
	if !ok {
		t.Fatalf("condition is not an object: %#v", conds[0])
	}
	if c["state"] != "active" {
		t.Errorf("state came back as %#v, want \"active\" — the console would "+
			"read this rule as a numeric condition and rewrite it on save", c["state"])
	}
	// The numeric half must be ABSENT, not zero-valued. A condition carrying
	// both shapes is refused by the engine, so if these were emitted the
	// console would fail to save the very rule it just loaded.
	for _, k := range []string{"metric", "op", "value"} {
		if v, present := c[k]; present {
			t.Errorf("a state condition emitted %q = %#v; it must be absent, or a "+
				"round-trip through the console sends both shapes and is refused", k, v)
		}
	}
}

// The control: the numeric form must be unaffected by the state form existing.
// A test that only proved state conditions work would pass just as well if
// `omitempty` had broken every numeric condition instead.
func TestANumericConditionStillSurvivesTheWire(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-numeric")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/automations", access, map[string]any{
		"name":    "lamp on when the tank is low",
		"enabled": true,
		"trigger": map[string]any{
			"kind":     "schedule",
			"schedule": map[string]any{"minute_of_day": 600, "days": 127},
		},
		"conditions": []any{
			map[string]any{"device_key": "mock:tank-1", "metric": "percent", "op": "below", "value": 20},
		},
		"action": map[string]any{"device_key": "mock:lamp-1", "verb": "on"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("a numeric condition was refused: %d %v %v", rec.Code, out["error"], out["detail"])
	}
	conds, _ := out["conditions"].([]any)
	if len(conds) != 1 {
		t.Fatalf("conditions did not round-trip: %#v", out["conditions"])
	}
	c, _ := conds[0].(map[string]any)
	if c["metric"] != "percent" || c["op"] != "below" {
		t.Errorf("numeric condition came back as %#v", c)
	}
	if v, _ := c["value"].(float64); v != 20 {
		t.Errorf("value came back as %#v, want 20", c["value"])
	}
	if _, present := c["state"]; present {
		t.Errorf("a numeric condition emitted a state field: %#v", c["state"])
	}
}

// A condition carrying BOTH shapes is refused at the API boundary rather than
// resolved into one of them. The engine decides; this proves the refusal
// actually reaches a client instead of being swallowed into a 500.
func TestAConditionCarryingBothShapesIsRefused(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-both")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/automations", access, map[string]any{
		"name":    "ambiguous",
		"enabled": true,
		"trigger": map[string]any{
			"kind":     "schedule",
			"schedule": map[string]any{"minute_of_day": 600, "days": 127},
		},
		"conditions": []any{
			map[string]any{"device_key": "mock:mower-1", "state": "active",
				"metric": "state", "op": "below", "value": 1},
		},
		"action": map[string]any{"device_key": "mock:lamp-1", "verb": "on"},
	})
	if rec.Code == http.StatusCreated {
		t.Fatal("a condition asking for a state AND a metric comparison was accepted; " +
			"it has two possible meanings and the engine must pick neither")
	}
	if rec.Code >= 500 {
		t.Errorf("status %d — a bad rule is a refusal, not a server error", rec.Code)
	}
	if out["error"] == nil {
		t.Error("refused without naming a reason")
	}
}
