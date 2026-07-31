package httpapi

// The bounds, because nothing downstream has any.
//
// The controller's `config` handler takes any key with a non-negative integer
// and writes it straight into its persisted config map. So every check that
// exists, exists here — and the one that matters most is `pulse_ms`, because
// exceeding the relay's maximum does not make the gate open for longer. The
// relay REFUSES an out-of-range pulse rather than clamping it, so the gate
// stops opening at all, and nothing in that failure points back at the config
// change that caused it.

import (
	"net/http"
	"strings"
	"testing"
)

// configDevice pairs a controller and returns its device id, because the
// config route resolves the owning account from the device rather than taking
// one in the path.
func configDevice(t *testing.T, h http.Handler, access, locationID string) string {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/devices", access, map[string]any{
		"location_id": locationID, "label": "Gate controller",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create device: %d %s", rec.Code, rec.Body)
	}
	id, _ := out["id"].(string)
	if id == "" {
		t.Fatalf("device create returned no id: %v", out)
	}
	return id
}

func TestConfigRefusesValuesThatWouldStopTheGateOpening(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "admin@cfg.com")
	_, locID := tenantIDs(t, h, access)
	dev := configDevice(t, h, access, locID)

	// The critical one. The relay's own default maximum is 5000ms and it
	// refuses anything above it outright, so a hub that forwarded this would
	// leave a controller that acknowledges every open and fires nothing.
	rec, out := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"pulse_ms": 9000}})
	if rec.Code != http.StatusBadRequest || out["error"] != "config_out_of_range" {
		t.Fatalf(`pulse_ms=9000 was accepted: %d %v

The relay refuses a pulse outside its range rather than clamping it, so this
value does not make the gate open for longer — it makes every subsequent open
fail at the hardware call, with nothing in the failure naming this change.`,
			rec.Code, out)
	}
	// The refusal has to be actionable: a number to pick instead, and why.
	// writeErrDetail flattens its fields onto the error object rather than
	// nesting them, so they are read from the top level.
	if out["max"] == nil || out["min"] == nil || out["message"] == nil {
		t.Errorf("refusal carries no bound or explanation: %v", out)
	}

	// Zero is refused too — a pulse of nothing is a gate that never fires.
	rec, _ = doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"pulse_ms": 0}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("pulse_ms=0 accepted: %d", rec.Code)
	}

	// And a sane value goes through.
	rec, out = doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"pulse_ms": 900}})
	if rec.Code != http.StatusOK {
		t.Fatalf("pulse_ms=900 refused: %d %v", rec.Code, out)
	}
	// The controller is not connected in this test, so the honest answer is
	// "queued", not "done". Flattening that to success would tell an operator
	// their gate had been retuned when it has not.
	if out["delivery"] != "queued" {
		t.Errorf("delivery = %v, want queued for an offline controller", out["delivery"])
	}
}

// An unrecognised key is refused rather than forwarded, because the controller
// would persist it forever doing nothing and a typo is invisible: a missing
// key and an unset one read identically on that side.
func TestConfigRefusesKeysTheHubDoesNotKnow(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "admin@cfgkey.com")
	_, locID := tenantIDs(t, h, access)
	dev := configDevice(t, h, access, locID)

	for _, key := range []string{"pluse_ms", "pulse_msec", "arbitrary", "hold_maximum"} {
		rec, out := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
			map[string]any{"config": map[string]any{key: 100}})
		if rec.Code != http.StatusBadRequest || out["error"] != "unknown_config_key" {
			t.Errorf("%q was forwarded to the controller: %d %v", key, rec.Code, out)
		}
		// The refusal should say what IS accepted, or an operator is left
		// guessing at spelling.
		if out["accepted"] == nil {
			t.Errorf("%q refusal does not list the accepted keys: %v", key, out)
		}
	}

	// An empty change is refused rather than signed as a no-op command.
	rec, _ := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("empty config accepted: %d", rec.Code)
	}
}

// One bad key must reject the WHOLE request. A partial apply would leave the
// operator's mental model and the controller's state disagreeing, and the
// controller merges — so there is no way to undo half of it.
func TestOneBadKeyRejectsTheWholeChange(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "admin@cfgatomic.com")
	_, locID := tenantIDs(t, h, access)
	dev := configDevice(t, h, access, locID)

	rec, out := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"pulse_ms": 900, "hold_max": 99999999}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a change with one out-of-range key was accepted: %d %v", rec.Code, out)
	}
}

// Retuning a relay is an admin act, and it is scoped to the device's account.
func TestConfigIsAdminOnlyAndTenantScoped(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	accessOwner, _ := register(t, h, "owner@cfgt.com")
	accessOther, _ := register(t, h, "other@cfgt.com")
	acct, locID := tenantIDs(t, h, accessOwner)
	dev := configDevice(t, h, accessOwner, locID)

	// Another account gets 404 — indistinguishable from a device that does not
	// exist, so a stranger cannot enumerate this hub's controllers.
	rec, _ := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", accessOther,
		map[string]any{"config": map[string]any{"pulse_ms": 900}})
	if rec.Code != http.StatusNotFound {
		t.Errorf("a foreign account reached this device's config: %d", rec.Code)
	}

	// A plain member of the SAME account is refused with 403: they are inside
	// the account, so hiding its existence buys nothing, but retuning a relay
	// is not theirs to do.
	token := inviteAndRecoverToken(t, h, st, accessOwner, acct, "member@cfgt.com", "member", "+27821234599")
	accessMember, _ := register(t, h, "member@cfgt.com")
	if rec, _ := doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept", accessMember, map[string]any{}); rec.Code != 200 {
		t.Fatalf("accept: %d", rec.Code)
	}
	rec, out := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", accessMember,
		map[string]any{"config": map[string]any{"pulse_ms": 900}})
	if rec.Code != http.StatusForbidden || out["error"] != "not_account_admin" {
		t.Errorf("a plain member retuned a relay: %d %v", rec.Code, out)
	}
}

// The act has to leave a trail: it changes how a physical gate behaves, and
// the change is invisible afterwards unless something recorded it.
func TestConfigIsAudited(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	access, _ := register(t, h, "admin@cfgaudit.com")
	_, locID := tenantIDs(t, h, access)
	dev := configDevice(t, h, access, locID)

	if rec, _ := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"pulse_ms": 1200}}); rec.Code != http.StatusOK {
		t.Fatalf("config: %d", rec.Code)
	}

	entries, _, err := st.AdminAuditActions(t.Context(), 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, e := range entries {
		if e.Action == "device_config" {
			found = true
			// The VALUES must be in the record. "config changed" tells a later
			// reader nothing about why the gate started behaving differently.
			if !contains(string(e.Detail), "1200") {
				t.Errorf("audit detail does not carry the value sent: %s", e.Detail)
			}
		}
	}
	if !found {
		t.Error("no device_config entry in the admin audit log")
	}
}

func contains(hay, needle string) bool {
	return len(hay) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(hay); i++ {
			if hay[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}

// A key nothing reads is refused, and the refusal says where the setting really
// lives.
//
// sensor_debounce_ms was in the accepted set. The controller stores it and no
// code path resolves it — the debounce that applies comes from the relay wiring
// — so sending it produced an ack, which reads as "applied" for a change that
// never occurred. The generic unknown-key refusal would be wrong here in a way
// that matters: the key is not a typo and not unknown, and an operator told
// "this hub does not know that key" would go looking for a spelling mistake
// instead of at the controller's -relay flag.
func TestConfigRefusesAKeyTheControllerNeverReads(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "admin@cfgdead.com")
	_, locID := tenantIDs(t, h, access)
	dev := configDevice(t, h, access, locID)

	rec, out := doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"sensor_debounce_ms": 50}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("sensor_debounce_ms was sent to a controller that ignores it: %d %v", rec.Code, out)
	}
	if out["error"] != "config_key_not_configurable" {
		t.Errorf("error = %v, want config_key_not_configurable — it is not an unknown key", out["error"])
	}
	msg, _ := out["message"].(string)
	if !strings.Contains(msg, "-relay") {
		t.Errorf("refusal does not point at where the debounce is actually set: %q", msg)
	}

	// It must not be listed as accepted anywhere, or the console will offer it
	// again from the hub's own answer.
	accepted, _ := out["accepted"].([]any)
	if len(accepted) == 0 {
		t.Fatalf("refusal lists no accepted keys: %v", out)
	}
	for _, k := range accepted {
		if k == "sensor_debounce_ms" {
			t.Errorf("refused key is still advertised as accepted: %v", accepted)
		}
	}

	// A mixed request is refused whole. Sending the half that works would leave
	// the operator with a partial apply reported as an error.
	rec, _ = doJSON(t, h, "PATCH", "/v1/devices/"+dev+"/config", access,
		map[string]any{"config": map[string]any{"pulse_ms": 900, "sensor_debounce_ms": 50}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a request mixing a good key with a dead one was partly applied: %d", rec.Code)
	}
}
