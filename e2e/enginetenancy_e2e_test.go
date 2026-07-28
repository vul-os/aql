package e2e

import (
	"net/http"
	"testing"
)

// The device engine tenancy gate, end to end.
//
// hub/internal/httpapi/engine.go's requireEngineAuthority /
// engineScopeFor close a real hole: all four engine routes used to be
// `requireAuth` only, so any signed-in member of ANY account on a hub could
// enumerate every device and actuate it — proven by driving a mock mower to a
// 200 at tier hazardous-motion from an unrelated account. The fix is covered
// by hub/internal/httpapi/enginetenancy_test.go at the in-process level. This
// file is the missing seam: the same story against the REAL hub binary, over
// real HTTP, with a real device behind it (httpdev, the same driver
// engine_test.go uses, for the same reason — a REST device is the one a test
// can BE).
//
// See TestEngineTenancy_SecondAccountDeviceListIsEmptyNotForbidden below for
// one place this suite's findings disagree with the in-process unit tests'
// expectations — that is reported, not papered over.

// engineRouteProbes lists every route the tenancy gate covers. All four,
// deliberately: the hole was that the gate did not exist on ANY of them, and
// a test of a single route would pass against a fix applied to only that one
// (same reasoning as hub/internal/httpapi/enginetenancy_test.go's
// engineProbes, mirrored here because that helper lives behind hub/internal
// and cannot be imported — see README.md).
func engineRouteProbes(key string) []struct {
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
		{"POST", "/v1/engine/devices/" + key + "/execute",
			map[string]any{"verb": "on", "args": map[string]float64{}, "confirm": false}},
	}
}

// TestEngineTenancy_SecondAccountRefused is the e2e proof of the hole
// engine.go's file comment describes as "run, not deduced": a second account,
// registered on the same real hub and with no relationship to the first, is
// refused on the engine's per-device routes and cannot make the fake device
// answer.
//
// GET /v1/engine/devices (the bare listing) is asserted separately below —
// see TestEngineTenancy_SecondAccountDeviceListIsEmptyNotForbidden.
func TestEngineTenancy_SecondAccountRefused(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithDevices(t, deviceConfigFile(t, dev.srv.URL))

	// Neither claims platform admin — both are ordinary members. That is
	// deliberate: it isolates the "member of one account among several" case
	// from the separate "instance admin" bypass, which
	// TestTheInstanceAdminDrivesTheEngineOnAMultiAccountHub already covers at
	// the hub's in-process level and is not what this test is about.
	tenA := gw.registerNoClaim(t) // the hub's first account
	tenB := gw.registerNoClaim(t) // a second, unrelated account

	// This hub now serves two accounts, so "everyone on this hub" is no
	// longer "everyone in this account" — the exact condition the gate exists
	// to police.
	before := dev.calls.Load()
	for _, p := range engineRouteProbes("http:lamp-1") {
		if p.path == "/v1/engine/devices" {
			continue // asserted separately; see below
		}
		st, body, raw := httpJSON(t, p.method, gw.url+p.path, tenB.token, p.body)
		if st != http.StatusForbidden || body["error"] != "not_engine_authority" {
			t.Errorf("%s %s as second account = %d %s, want 403 not_engine_authority",
				p.method, p.path, st, raw)
		}
	}
	if dev.calls.Load() != before {
		t.Fatal("a refused engine request still reached the real device — the gate ran " +
			"after dispatch, not before it")
	}

	// tenA (first-registered, still an ordinary member) keeps no special
	// standing either. The rule is hub-wide authority, not "whoever
	// registered first".
	st, body, raw := httpJSON(t, http.MethodGet, gw.url+"/v1/engine/devices/http:lamp-1/readings", tenA.token, nil)
	if st != http.StatusForbidden || body["error"] != "not_engine_authority" {
		t.Errorf("first-registered account kept engine access on a two-account hub: %d %s", st, raw)
	}
}

// TestEngineTenancy_SecondAccountDeviceListIsEmptyNotForbidden documents a
// real finding from building this suite, not a workaround for it.
//
// hub/internal/httpapi/engine.go's own file comment for handleEngineDevices
// promises: "A distinct code, not an empty fleet: 'you may not see these' and
// 'there are none' are different answers." But handleEngineDevices is wired
// through engineScopeFor, whose "several accounts" branch computes an
// `owned` set and returns ok=true with it empty rather than writing a 403 —
// it 403s only a caller who is a member of NO account at all. A caller who is
// a member of some OTHER account on the hub is scoped, not refused: the
// handler then filters reg.Devices() by scope.permits and returns 200 with
// whatever survives, which for an unrelated second account is an empty list.
//
// That is confirmed here against the real binary (this test would go red if
// it asserted 403, exactly as hub/internal/httpapi/enginetenancy_test.go's
// TestASecondAccountCannotSeeOrDriveTheHubsDevices,
// TestADisabledUserLosesTheEngine and
// TestTheSoleAccountShortcutRequiresActualMembership currently do in this
// checkout — `go test ./internal/httpapi/ -run TestASecondAccountCannot` in
// hub/ fails today for exactly this route, on code this suite is
// instructed not to edit).
//
// The security property the gate exists for still holds on this route: the
// second account's device list does NOT name http:lamp-1 (or anything else),
// so no enumeration happens. What is inconsistent is the STATUS CODE and
// ERROR VOCABULARY, not the access decision — "empty fleet" instead of the
// promised "distinct code". This test pins that real, current behavior so a
// change either way (tightened to 403, as the file comment and the hub's own
// unit tests say it should be, or loosened back to actually leaking the
// device) is caught.
func TestEngineTenancy_SecondAccountDeviceListIsEmptyNotForbidden(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithDevices(t, deviceConfigFile(t, dev.srv.URL))

	gw.registerNoClaim(t) // the hub's first account
	tenB := gw.registerNoClaim(t)

	st, body, raw := httpJSON(t, http.MethodGet, gw.url+"/v1/engine/devices", tenB.token, nil)
	if st != http.StatusOK {
		t.Fatalf("GET /v1/engine/devices as second account = %d %s; this pins CURRENT hub "+
			"behavior (200, filtered) — if this now 403s, the hub's own gate was tightened to "+
			"match its file comment and this assertion should be updated to match, not skipped",
			st, raw)
	}
	devs, _ := body["devices"].([]any)
	if len(devs) != 0 {
		t.Fatalf("second account's device list named %d device(s), want none: %s", len(devs), raw)
	}
	for _, d := range devs {
		dm, _ := d.(map[string]any)
		if dm["key"] == "http:lamp-1" {
			t.Fatalf("second account's device list named the first account's device: %s", raw)
		}
	}
}

// TestEngineTenancy_SoleAccountMemberKeepsFullAccess is the regression guard:
// on a hub with exactly one account — the deployment this product is
// actually for — a member keeps exactly the access they always had. All four
// routes, PLUS a real actuation, so a future change to the gate that
// accidentally tightens the sole-account shortcut is caught by a device
// failing to turn on, not only by a status code.
func TestEngineTenancy_SoleAccountMemberKeepsFullAccess(t *testing.T) {
	dev := newFakeDevice(t)
	gw := startGatewayWithDevices(t, deviceConfigFile(t, dev.srv.URL))
	// Not gw.register: this deliberately does NOT claim platform admin, so
	// the access proven here comes from the soleAccount member path in
	// engine.go, not the separate admin bypass.
	ten := gw.registerNoClaim(t) // the hub's ONLY account

	for _, p := range engineRouteProbes("http:lamp-1") {
		st, _, raw := httpJSON(t, p.method, gw.url+p.path, ten.token, p.body)
		if st != http.StatusOK {
			t.Fatalf("%s %s as sole account member = %d %s, want 200 — a single-account hub's "+
				"member must keep full engine access", p.method, p.path, st, raw)
		}
	}

	if !dev.on.Load() {
		t.Fatal("the sole member's execute reported success (200) but the real device never " +
			"turned on — the engine acked a command it did not deliver")
	}
}
