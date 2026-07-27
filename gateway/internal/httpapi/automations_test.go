package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"testing"

	"github.com/vul-os/aql/gateway/internal/automations"
	"github.com/vul-os/aql/gateway/internal/devices"
	"github.com/vul-os/aql/gateway/internal/keys"
	"github.com/vul-os/aql/gateway/internal/store"
)

// newAutomationsTestServer wires a rule engine over a mock driver, so rules can
// actually resolve a device and the tier checks run for real rather than being
// short-circuited by an empty registry.
func newAutomationsTestServer(t *testing.T, schedulerRunning bool) (http.Handler, *store.Store) {
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

	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	eng, err := automations.NewEngine(automations.Config{
		Registry: reg,
		Store:    automations.NewStore(st.DB()),
		Audit:    st,
	})
	if err != nil {
		t.Fatal(err)
	}

	s := New(Config{
		Version:              "test",
		JWTSecret:            []byte("0123456789abcdef0123456789abcdef"),
		Devices:              reg,
		Automations:          eng,
		AutomationsScheduler: schedulerRunning,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st
}

// Routes must not shadow each other. GET .../automations/runs is the account
// activity feed and GET .../automations/{ruleID} is one rule; a mux that routed
// "runs" to the rule handler would return 404 for a working endpoint. Go's
// specificity rules get this right, but the two patterns were written by hand
// and the failure would be silent.
func TestRunsFeedIsNotShadowedByTheRuleRoute(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-routes")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/automations/runs", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("runs feed: %d %v", rec.Code, out["error"])
	}
	if _, ok := out["runs"]; !ok {
		t.Error("the runs feed was routed to the single-rule handler")
	}
}

// A hub with no rule engine says so, distinctly. Same argument as energy: 404
// sends a caller hunting for a typo, 503 sends them to their configuration.
func TestAutomationsWithoutAnEngineSays503(t *testing.T) {
	h := newTestServer(t, "") // no Automations in Config — the shipped default
	access, _ := register(t, h, "auto-none")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/automations", access, nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", rec.Code)
	}
	if out["error"] != "automations_not_configured" {
		t.Errorf("error %v, want automations_not_configured", out["error"])
	}
}

// Rules can be written with the scheduler off — useful when setting a hub up —
// so the API must say when nothing will fire them. A list of rules that
// silently never run looks exactly like a list of rules that work.
func TestSchedulerStateIsReported(t *testing.T) {
	for _, running := range []bool{true, false} {
		h, _ := newAutomationsTestServer(t, running)
		access, _ := register(t, h, "auto-sched")
		acct, _ := tenantIDs(t, h, access)

		rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/automations", access, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d", rec.Code)
		}
		if out["scheduler_running"] != running {
			t.Errorf("scheduler_running = %v, want %v — a rule nobody will fire "+
				"must not look like a working one", out["scheduler_running"], running)
		}
	}
}

// The whole safety story of this surface: unattended actuation is bounded by a
// compile-time ceiling, and NOTHING over HTTP can move it or route around it.
//
// The target is the mower's blades on purpose. CapBladeJob's start verb sits at
// TierHazardousMotion, above MaxActionTier — it is, per the catalogue's own
// comment, the reason that tier exists. Pointing at a device that simply does
// not support the verb would be refused too, as unresolvable, and would prove
// only that the registry works. This asserts the CEILING refused a verb the
// device genuinely has.
func TestARuleCannotBeSavedAboveTheTierCeiling(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-tier")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/automations", access, map[string]any{
		"name":    "mow the lawn at 3am",
		"enabled": true,
		"trigger": map[string]any{
			"kind":     "schedule",
			"schedule": map[string]any{"minute_of_day": 180, "days": 127},
		},
		"action": map[string]any{"device_key": "mock:mower-1", "verb": "start"},
	})
	if rec.Code == http.StatusCreated {
		t.Fatal("a rule that starts a mower's blades unattended was accepted; " +
			"the tier ceiling is not enforced on the save path")
	}
	// The engine's own vocabulary, passed through verbatim. Not
	// ReasonUnresolvable — the mower HAS this verb, so anything but
	// tier_too_high would mean the test is passing for the wrong reason.
	if out["error"] != automations.ReasonTierTooHigh {
		t.Errorf("error %v, want %s — the refusal must be the ceiling, not a "+
			"missing verb", out["error"], automations.ReasonTierTooHigh)
	}

	// And the control: the SAME device's stop verb is TierReversible and must
	// be perfectly saveable. A ceiling that refused everything would pass the
	// assertion above while making the feature useless.
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+acct+"/automations", access, map[string]any{
		"name":    "stop the mower at dusk",
		"enabled": true,
		"trigger": map[string]any{
			"kind":     "schedule",
			"schedule": map[string]any{"minute_of_day": 1080, "days": 127},
		},
		"action": map[string]any{"device_key": "mock:mower-1", "verb": "stop"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("a reversible action was refused: %d %v %v", rec.Code,
			out["error"], out["detail"])
	}
	if out["action_tier"] == nil || out["max_action_tier"] == nil {
		t.Error("a saved rule did not report its tier and the ceiling; one " +
			"without the other is not interpretable")
	}
}

// Reads are admin-only, unlike energy. A rule says what the hardware does
// unattended and the run history says when — closer to the audit trail than to
// a meter reading. A member who can enumerate every rule and its cooldown knows
// when the house is not being watched.
func TestAutomationsAreAdminOnlyIncludingReads(t *testing.T) {
	h, st := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-owner")
	acct, _ := tenantIDs(t, h, access)

	// A genuine plain member of the SAME account, via the real invite flow —
	// not a stranger. A stranger would be refused by tenancy and would prove
	// nothing about the role check.
	memberAccess, _ := register(t, h, "auto-member")
	token := inviteAndRecoverToken(t, h, st, access, acct, "auto-member", "member", "+27821234500")
	if rec, out := doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept",
		memberAccess, map[string]any{}); rec.Code != http.StatusOK {
		t.Fatalf("accept invite: %d %v", rec.Code, out)
	}

	for _, tc := range []struct{ method, path string }{
		{"GET", ""},
		{"GET", "/runs"},
		{"POST", ""},
	} {
		rec, _ := doJSON(t, h, tc.method, "/v1/accounts/"+acct+"/automations"+tc.path,
			memberAccess, map[string]any{"name": "x"})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: status %d, want 403 for a non-admin member",
				tc.method, tc.path, rec.Code)
		}
	}
}

func TestAutomationsAreAccountScoped(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	accessA, _ := register(t, h, "auto-a")
	accessB, _ := register(t, h, "auto-b")
	acctA, _ := tenantIDs(t, h, accessA)

	rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acctA+"/automations", accessB, nil)
	if rec.Code == http.StatusOK {
		t.Error("account B listed account A's automation rules")
	}
}

// enabled is a pointer in the request so a MISSING field is refused. A bool
// zero value would make "I forgot to send it" mean "disable the rule", which
// is the wrong default for a field whose whole job is turning safety machinery
// back on.
func TestSetEnabledRefusesAMissingField(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-enabled")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "POST",
		"/v1/accounts/"+acct+"/automations/nonexistent/enabled", access,
		map[string]any{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
	if out["error"] != "enabled_required" {
		t.Errorf("error %v; a missing enabled must not silently mean false", out["error"])
	}
}

func TestRunsLimitIsValidatedAndCapped(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-limit")
	acct, _ := tenantIDs(t, h, access)
	base := "/v1/accounts/" + acct + "/automations/runs?limit="

	for _, bad := range []string{"0", "-1", "abc"} {
		rec, _ := doJSON(t, h, "GET", base+bad, access, nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("limit=%s: status %d, want 400", bad, rec.Code)
		}
	}
	rec, out := doJSON(t, h, "GET", base+"100000", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	// Capped, and the cap is REPORTED. A silently truncated result reads as
	// "that is all the history there is".
	if got, ok := out["limit"].(float64); !ok || int(got) != runsLimitMax {
		t.Errorf("limit = %v, want it capped at %d and stated", out["limit"], runsLimitMax)
	}
}

// The engine's refusal vocabulary must not be replaced by one invented here.
// The scheduler logs the same names, so a console that learns them once can
// explain a refusal from either source.
func TestRefusalReasonsArePassedThroughVerbatim(t *testing.T) {
	h, _ := newAutomationsTestServer(t, true)
	access, _ := register(t, h, "auto-refuse")
	acct, _ := tenantIDs(t, h, access)

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/automations", access, map[string]any{
		"name":    "point at nothing",
		"enabled": true,
		"trigger": map[string]any{
			"kind":     "schedule",
			"schedule": map[string]any{"minute_of_day": 60, "days": 127},
		},
		"action": map[string]any{"device_key": "mock:no-such-device", "verb": "set_level", "args": map[string]any{"level": 50}},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
	if out["error"] != automations.ReasonUnresolvable {
		t.Errorf("error %v, want %s", out["error"], automations.ReasonUnresolvable)
	}
	// The engine's message names the device key that could not be resolved,
	// which is the difference between a rule an admin can fix and one they can
	// only delete.
	if out["detail"] == nil || out["detail"] == "" {
		t.Error("the refusal carried no detail; an admin cannot tell which target failed")
	}
}
