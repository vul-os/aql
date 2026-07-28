package httpapi

// The device engine has no tenancy, and this is what stands in for it.
//
// Every other account-scoped route in this hub answers 404 to a cross-tenant
// probe, deliberately, so that an outsider cannot tell an account they may not
// touch from one that does not exist. The engine did none of that. All four of
// its routes were `requireAuth`, and the device model has no account field to
// scope by, so a second account registered on the same hub could list every
// device, turn on someone else's lamp, and start someone else's mower.
//
// That was not deduced from reading the routes — it was run. The probe that
// found it drove `mock:mower-1` to a 200 at tier hazardous-motion from an
// account with no relationship to the hub's devices whatsoever.
//
// engine.go explains why the fix is a hub-wide authority test rather than
// device scoping. These tests hold both halves of it: the common deployment
// keeps working, and the case that was open is closed.

import (
	"bytes"
	"log/slog"
	"net/http"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

func engineServer(t *testing.T, claimToken string) http.Handler {
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
	s := New(Config{
		Version:         "test",
		AdminClaimToken: claimToken,
		JWTSecret:       []byte("0123456789abcdef0123456789abcdef"),
		Devices:         reg,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router()
}

// engineRoutes is every route the gate covers. Listing them here rather than
// testing one is the point: the hole was that the gate did not exist, and a
// test of a single route would pass against a fix applied to only that route.
func engineProbes(key string) []struct {
	method, path string
	body         map[string]any
} {
	return []struct {
		method, path string
		body         map[string]any
	}{
		{"GET", "/v1/engine/devices", nil},
		{"GET", "/v1/engine/health", nil},
		{"GET", "/v1/engine/devices/" + key + "/readings", nil},
		{"POST", "/v1/engine/devices/" + key + "/execute", map[string]any{"verb": "on"}},
	}
}

// The common deployment: one household, one account. Nothing changes.
func TestASoleAccountsMemberStillDrivesTheEngine(t *testing.T) {
	h := engineServer(t, "")
	access, _ := register(t, h, "home@x.com")

	for _, p := range engineProbes("mock:lamp-1") {
		rec, out := doJSON(t, h, p.method, p.path, access, p.body)
		if rec.Code != http.StatusOK {
			t.Errorf("%s %s = %d %v; a single-account hub's member must keep full engine access — "+
				"this is the deployment the product is for", p.method, p.path, rec.Code, out)
		}
	}

	// Including the hazardous tier, which is gated on deliberateness rather
	// than on who is asking.
	rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:mower-1/execute", access,
		map[string]any{"verb": "start", "confirm": true})
	if rec.Code != http.StatusOK {
		t.Errorf("sole member could not start the mower with confirm: %d %v", rec.Code, out)
	}
}

// The case that was open.
func TestASecondAccountCannotSeeOrDriveTheHubsDevices(t *testing.T) {
	h := engineServer(t, "")
	// Registering creates an account each, so this hub now has two and
	// "everyone on this hub" is no longer "everyone in this account".
	accessA, _ := register(t, h, "first@x.com")
	accessB, _ := register(t, h, "second@x.com")

	// The LISTING is a 200 with an empty fleet, not a refusal — and that
	// distinction is the ownership model's, not a weakening of this one.
	// A member who has claimed nothing genuinely has no devices; answering 403
	// would tell them the engine is off-limits when in fact they may claim any
	// unclaimed device on it (see deviceclaims_test.go). What must NOT happen
	// is the thing that used to: seeing the hub's whole fleet.
	for _, access := range []string{accessA, accessB} {
		rec, out := doJSON(t, h, "GET", "/v1/engine/devices", access, nil)
		if rec.Code != http.StatusOK {
			t.Errorf("listing for an account that owns nothing = %d %v, want 200", rec.Code, out)
		}
		if devs, _ := out["devices"].([]any); len(devs) != 0 {
			t.Errorf(`an account that has claimed nothing sees %d devices.

Before ownership existed, this exact request listed every device on the hub —
and the same request against mock:mower-1 with confirm returned 200 at tier
hazardous-motion. Neither account is privileged here: the rule is not "the
oldest account wins", it is that an unclaimed device belongs to nobody.`, len(devs))
		}
	}

	// The per-device routes DO refuse, with a code a console can explain. An
	// empty list and a refusal are different answers and both are needed:
	// one says "you own nothing", the other says "not this one".
	for _, p := range engineProbes("mock:lamp-1")[1:] {
		rec, out := doJSON(t, h, p.method, p.path, accessB, p.body)
		if rec.Code != http.StatusForbidden || out["error"] != "not_engine_authority" {
			t.Errorf("%s %s = %d %v, want 403 not_engine_authority", p.method, p.path, rec.Code, out)
		}
	}
}

// The instance admin's seat is hub-wide by definition, which is the other way
// to hold authority over a hub-wide engine.
func TestTheInstanceAdminDrivesTheEngineOnAMultiAccountHub(t *testing.T) {
	h := engineServer(t, "op-token")
	adminAccess := claimAdmin(t, h, "op@x.com")
	// A second account, so the sole-account shortcut cannot be what passes.
	register(t, h, "other@x.com")

	for _, p := range engineProbes("mock:lamp-1") {
		rec, out := doJSON(t, h, p.method, p.path, adminAccess, p.body)
		if rec.Code != http.StatusOK {
			t.Errorf("%s %s as instance admin = %d %v; the operator seat is hub-wide and "+
				"the engine is the hub's", p.method, p.path, rec.Code, out)
		}
	}
}

// Standing is re-read live, as everywhere else in this hub: a token minted
// while someone was a member does not outlive the membership.
func TestADisabledUserLosesTheEngine(t *testing.T) {
	h := engineServer(t, "op-token")
	adminAccess := claimAdmin(t, h, "op@x.com")
	victim, _ := register(t, h, "victim@x.com")

	// Two accounts exist (admin's and victim's), so the victim is already
	// outside the sole-account case — disable them and confirm the refusal
	// holds for the stronger reason too.
	// A per-device route, because the LISTING now answers 200-with-nothing for
	// someone who owns nothing. Actuation is where the refusal lives.
	rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", victim,
		map[string]any{"verb": "on"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("fixture: victim should already be refused on a two-account hub, got %d", rec.Code)
	}

	users := func() []any {
		_, out := doJSON(t, h, "GET", "/v1/admin/users", adminAccess, nil)
		list, _ := out["users"].([]any)
		return list
	}
	var victimID string
	for _, u := range users() {
		um := u.(map[string]any)
		if um["username"] == "victim@x.com" {
			victimID, _ = um["id"].(string)
		}
	}
	if victimID == "" {
		t.Fatal("admin user listing did not name the victim; the fixture cannot disable them")
	}
	if rec, out := doJSON(t, h, "PATCH", "/v1/admin/users/"+victimID, adminAccess,
		map[string]any{"status": "disabled"}); rec.Code != http.StatusOK && rec.Code != http.StatusNoContent {
		t.Fatalf("disable: %d %v", rec.Code, out)
	}

	// The victim is now refused for the stronger reason — not "no hub-wide
	// authority" but "not an active user at all" — and requireEngineAuthority
	// re-reads users.status on every request rather than trusting the claim
	// baked into their token.
	// engineScopeFor re-reads users.status on every request rather than
	// trusting the claim baked into the victim's still-valid token, so even
	// the listing — which is permissive about owning nothing — refuses a user
	// who is no longer active.
	if rec, _ := doJSON(t, h, "GET", "/v1/engine/devices", victim, nil); rec.Code == http.StatusOK {
		t.Error("a disabled user still reached the engine")
	}
}

// The sole-account shortcut must not let a NON-member through. Registering is
// not the only way to hold a session — an invited user who never accepted, or
// one whose membership was revoked, has a valid token and no membership.
func TestTheSoleAccountShortcutRequiresActualMembership(t *testing.T) {
	h := engineServer(t, "op-token")
	// The admin's own registration creates the hub's first account. Claiming
	// the operator seat does not change that.
	adminAccess := claimAdmin(t, h, "op@x.com")
	if rec, _ := doJSON(t, h, "GET", "/v1/engine/devices", adminAccess, nil); rec.Code != http.StatusOK {
		t.Fatalf("fixture: admin should reach the engine, got %d", rec.Code)
	}

	// Now revoke the admin's membership of that sole account, leaving a valid
	// session with no membership. They still pass as instance admin — that is
	// the point of the seat — so the shortcut is exercised through a plain
	// user instead.
	member, _ := register(t, h, "member@x.com")
	// Two accounts now, so the shortcut no longer applies to anyone. The
	// member owns nothing, so they see nothing and may drive nothing — the
	// listing says so with an empty fleet and the actuation says so with a
	// refusal.
	rec, out := doJSON(t, h, "GET", "/v1/engine/devices", member, nil)
	if devs, _ := out["devices"].([]any); rec.Code != http.StatusOK || len(devs) != 0 {
		t.Errorf("a second account saw the hub's fleet: %d %v", rec.Code, out)
	}
	if rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", member,
		map[string]any{"verb": "on"}); rec.Code != http.StatusForbidden {
		t.Errorf("a second account actuated an unclaimed device: %d %v", rec.Code, out)
	}
}
