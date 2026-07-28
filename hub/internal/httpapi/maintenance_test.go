package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// GET/POST /v1/access-points/{id}/maintenance — the routes the console's
// maintenance panel has been calling into the void.

type maintFixture struct {
	h      http.Handler
	st     *store.Store
	admin  string // owner of the account
	apID   string
	acctID string
}

func setupMaintenance(t *testing.T) *maintFixture {
	t.Helper()
	h, st := newTestServerWithStore(t, "")
	admin, _ := register(t, h, "owner@maint.com")
	acct, loc := tenantIDs(t, h, admin)

	rec, out := doJSON(t, h, "POST", "/v1/access-points", admin, map[string]any{
		"location_id": loc, "name": "Main Gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("ap create: %d %s", rec.Code, rec.Body)
	}
	return &maintFixture{h: h, st: st, admin: admin, apID: out["id"].(string), acctID: acct}
}

func TestMaintenanceLogRoundTrip(t *testing.T) {
	f := setupMaintenance(t)

	// Empty to start, and an empty LIST, not a 404 — "no maintenance yet" and
	// "no such gate" are different answers.
	rec, out := doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID+"/maintenance", f.admin, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	if got := out["events"].([]any); len(got) != 0 {
		t.Fatalf("a fresh access point had %d events", len(got))
	}

	rec, out = doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind":             "service",
		"technician_name":  "  Sipho Dlamini  ",
		"notes":            "Replaced the limit switch.",
		"cost_zar_cents":   145000,
		"next_due_in_days": 180,
		"parts":            []any{map[string]any{"name": "Limit switch", "qty": 1, "cost_zar_cents": 89000}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	if out["technician_name"] != "Sipho Dlamini" {
		t.Errorf("technician_name = %v, want trimmed", out["technician_name"])
	}
	if out["cost_zar_cents"].(float64) != 145000 {
		t.Errorf("cost = %v", out["cost_zar_cents"])
	}
	// The movement fields are present and null: this hub does not measure it,
	// and saying so beats omitting the field or reporting a confident zero.
	if out["movement_m_at_event"] != nil || out["next_due_movement_m"] != nil {
		t.Errorf("movement fields were not null: %v %v", out["movement_m_at_event"], out["next_due_movement_m"])
	}
	dueAt := out["next_due_at"].(float64)
	if dueAt <= float64(time.Now().Unix()) {
		t.Errorf("next_due_at = %v, expected ~180 days out", dueAt)
	}

	// It persisted, read back through the LIST route rather than the one that
	// wrote it — a handler echoing its own input cannot pass this.
	_, out = doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID+"/maintenance", f.admin, nil)
	events := out["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("list after create: %d events", len(events))
	}
	first := events[0].(map[string]any)
	if first["notes"] != "Replaced the limit switch." {
		t.Errorf("notes did not survive: %v", first["notes"])
	}
	parts := first["parts"].([]any)
	if len(parts) != 1 || parts[0].(map[string]any)["name"] != "Limit switch" {
		t.Errorf("parts did not survive: %v", first["parts"])
	}

	// And the access point's own summary now reflects it, which is the whole
	// point of the block that used to be hardcoded.
	rec, ap := doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID, f.admin, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("ap get: %d", rec.Code)
	}
	m := ap["maintenance"].(map[string]any)
	if m["last_serviced_at"] == nil {
		t.Error("last_serviced_at is still null after a service was logged")
	}
	if m["next_due_at"] == nil {
		t.Error("next_due_at is still null after a service scheduled one")
	}
	if m["due_now"] != false {
		t.Errorf("due_now = %v, but the next service is 180 days out", m["due_now"])
	}
	if m["pct_used"] != nil || m["movement_remaining_m"] != nil {
		t.Errorf("a movement figure was reported by a hub that measures none: %v", m)
	}
}

// An inspection is someone looking at a gate, not someone servicing it.
// Letting it set last_serviced_at would let a walk-past reset a service
// interval.
func TestMaintenanceInspectionDoesNotCountAsService(t *testing.T) {
	f := setupMaintenance(t)

	if rec, out := doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind": "inspection", "notes": "Looked fine.",
	}); rec.Code != http.StatusCreated {
		t.Fatalf("inspection: %d %v", rec.Code, out)
	}

	_, ap := doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID, f.admin, nil)
	m := ap["maintenance"].(map[string]any)
	if m["last_serviced_at"] != nil {
		t.Errorf("an inspection set last_serviced_at to %v", m["last_serviced_at"])
	}

	// A real service does count.
	doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{"kind": "service"})
	_, ap = doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID, f.admin, nil)
	if ap["maintenance"].(map[string]any)["last_serviced_at"] == nil {
		t.Error("a service did not set last_serviced_at")
	}
}

// A past due date must read as due. This is the field an operator acts on.
func TestMaintenanceDueNow(t *testing.T) {
	f := setupMaintenance(t)
	past := time.Now().Add(-48 * time.Hour).Unix()

	if rec, out := doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind":         "service",
		"performed_at": time.Now().Add(-200 * 24 * time.Hour).Format(time.RFC3339),
		"next_due_at":  time.Unix(past, 0).Format(time.RFC3339),
	}); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %v", rec.Code, out)
	}

	_, ap := doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID, f.admin, nil)
	if ap["maintenance"].(map[string]any)["due_now"] != true {
		t.Error("a service due two days ago does not read as due")
	}
}

// A later event that schedules nothing must not erase the due date an earlier
// service established.
func TestMaintenanceLaterEventDoesNotEraseDueDate(t *testing.T) {
	f := setupMaintenance(t)

	doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind":             "service",
		"performed_at":     time.Now().Add(-72 * time.Hour).Format(time.RFC3339),
		"next_due_in_days": 90,
	})
	// A repair the next day, scheduling nothing.
	doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind": "repair", "notes": "Tightened a bracket.",
	})

	_, ap := doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID, f.admin, nil)
	if ap["maintenance"].(map[string]any)["next_due_at"] == nil {
		t.Error("a repair that scheduled nothing erased the service's due date")
	}
}

// The console's error handler has a branch for this that could never fire.
func TestMaintenanceWriteIsAdminOnly(t *testing.T) {
	f := setupMaintenance(t)

	_, member := inviteMember(t, f.h, f.st, f.admin, f.acctID, "member@maint.com", "+27821119999")

	// A member may READ: knowing when the gate you walk through was serviced
	// is a reasonable question.
	if rec, _ := doJSON(t, f.h, "GET", "/v1/access-points/"+f.apID+"/maintenance", member, nil); rec.Code != http.StatusOK {
		t.Errorf("member list: %d, want 200", rec.Code)
	}

	rec, out := doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", member, map[string]any{
		"kind": "service",
	})
	if rec.Code != http.StatusForbidden || out["error"] != "not_account_admin" {
		t.Errorf("member write: %d %v, want 403 not_account_admin", rec.Code, out)
	}
}

// A stranger must not learn that an access point exists, let alone read its
// history.
func TestMaintenanceIsTenantScoped(t *testing.T) {
	f := setupMaintenance(t)
	stranger, _ := register(t, f.h, "stranger@maint.com")

	for _, m := range []string{"GET", "POST"} {
		rec, out := doJSON(t, f.h, m, "/v1/access-points/"+f.apID+"/maintenance", stranger, map[string]any{"kind": "service"})
		if rec.Code != http.StatusNotFound || out["error"] != "access_point_not_found" {
			t.Errorf("stranger %s: %d %v, want 404", m, rec.Code, out)
		}
	}
}

// Movement-based scheduling is refused with a reason. A stored threshold that
// nothing can evaluate is worse than a missing feature: the reminder never
// fires and the operator finds out when the gate fails.
func TestMaintenanceRefusesMovementScheduling(t *testing.T) {
	f := setupMaintenance(t)

	rec, out := doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind": "service", "next_due_movement_m": 5000,
	})
	if rec.Code != http.StatusBadRequest || out["error"] != "movement_not_measured" {
		t.Errorf("movement threshold: %d %v, want 400 movement_not_measured", rec.Code, out)
	}
}

func TestMaintenanceValidation(t *testing.T) {
	f := setupMaintenance(t)
	url := "/v1/access-points/" + f.apID + "/maintenance"

	cases := []struct {
		name string
		body map[string]any
		code string
	}{
		{"unknown kind", map[string]any{"kind": "polish"}, "invalid_kind"},
		{"missing kind", map[string]any{"notes": "hi"}, "invalid_kind"},
		{"future work", map[string]any{
			"kind": "service", "performed_at": time.Now().Add(72 * time.Hour).Format(time.RFC3339),
		}, "performed_at_in_future"},
		{"both scheduling forms", map[string]any{
			"kind": "service", "next_due_in_days": 30, "next_due_at": time.Now().Format(time.RFC3339),
		}, "conflicting_next_due"},
		{"absurd interval", map[string]any{"kind": "service", "next_due_in_days": 40000}, "invalid_next_due_in_days"},
		{"zero interval", map[string]any{"kind": "service", "next_due_in_days": 0}, "invalid_next_due_in_days"},
		{"negative cost", map[string]any{"kind": "service", "cost_zar_cents": -1}, "invalid_cost"},
		{"nameless part", map[string]any{
			"kind": "service", "parts": []any{map[string]any{"name": "  "}},
		}, "invalid_part"},
		{"overlong notes", map[string]any{
			"kind": "service", "notes": strings.Repeat("x", maxNotesLen+1),
		}, "notes_too_long"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, out := doJSON(t, f.h, "POST", url, f.admin, tc.body)
			if rec.Code != http.StatusBadRequest || out["error"] != tc.code {
				t.Errorf("got %d %v, want 400 %s", rec.Code, out, tc.code)
			}
		})
	}
}

// Work is logged after the fact, so the interval runs from when the work
// happened — not from when someone got round to typing it.
func TestMaintenanceIntervalRunsFromTheWork(t *testing.T) {
	f := setupMaintenance(t)
	performed := time.Now().Add(-10 * 24 * time.Hour)

	_, out := doJSON(t, f.h, "POST", "/v1/access-points/"+f.apID+"/maintenance", f.admin, map[string]any{
		"kind":             "service",
		"performed_at":     performed.Format(time.RFC3339),
		"next_due_in_days": 30,
	})
	want := performed.Unix() + 30*86400
	if got := int64(out["next_due_at"].(float64)); got != want {
		t.Errorf("next_due_at = %d, want %d (30 days after the WORK, not after the entry)", got, want)
	}
}
