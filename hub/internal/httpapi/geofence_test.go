package httpapi

import (
	"net/http"
	"testing"
)

// The gate's anchor, and a point far from it.
const (
	fenceLat  = -26.2041
	fenceLong = 28.0473
	farLat    = -33.9249 // Cape Town, ~1 260 km away
	farLong   = 18.4241
)

func TestGeofenceRoutes(t *testing.T) {
	// Claimed as the platform admin so the admin-action trail is readable at
	// the end; the account role under test is still plain account ownership.
	h, st := newTestServerWithStore(t, "op-token")
	adminAccess := claimAdmin(t, h, "gfadmin@x.com")
	accountID, locationID := tenantIDs(t, h, adminAccess)
	_, memberAccess := inviteMember(t, h, st, adminAccess, accountID, "gfmember@x.com", "+27821112001")

	rec, out := doJSON(t, h, "POST", "/v1/access-points", adminAccess, map[string]any{
		"location_id": locationID, "name": "Front gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("access point: %d %v", rec.Code, out)
	}
	apID := out["id"].(string)

	// --- create ------------------------------------------------------------
	body := map[string]any{
		"access_point_id": apID, "lat": fenceLat, "long": fenceLong,
		"radius_m": 200, "note": "front gate",
	}
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", adminAccess, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %v", rec.Code, out)
	}
	ruleID := out["id"].(string)
	// The defaults are visible in the response, not implied. on_missing_location
	// in particular decides whether the fence binds the chat rails at all, and
	// an operator must be able to see which way it went rather than assume.
	if out["on_missing_location"] != "deny" {
		t.Errorf("absent-location default must be deny, got %v", out["on_missing_location"])
	}
	if out["slack_m"].(float64) != 75 || out["effective_radius_m"].(float64) != 275 {
		t.Errorf("the number that actually decides an open is radius+slack: %v", out)
	}

	// One rule per target.
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", adminAccess, body)
	if rec.Code != http.StatusConflict || out["error"] != "geofence_rule_exists" {
		t.Errorf("duplicate: %d %v", rec.Code, out)
	}

	// A refused rule names the problem — an operator guessing at an access
	// rule is how somebody gets locked out.
	for _, bad := range []map[string]any{
		{"location_id": locationID, "lat": fenceLat, "long": fenceLong, "radius_m": 1},   // under the floor
		{"location_id": locationID, "lat": fenceLat, "long": fenceLong, "radius_m": 1e9}, // over the cap
		{"location_id": locationID, "lat": 91.0, "long": fenceLong, "radius_m": 200},     // off the planet
		{"lat": fenceLat, "long": fenceLong, "radius_m": 200},                            // no target
		{"location_id": locationID, "lat": fenceLat, "radius_m": 200},                    // half an anchor
		{"location_id": locationID, "lat": fenceLat, "long": fenceLong, "radius_m": 200, // unrecognised policy
			"on_missing_location": "sometimes"},
	} {
		rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", adminAccess, bad)
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_geofence" || out["detail"] == "" {
			t.Errorf("invalid rule %v: %d %v", bad, rec.Code, out)
		}
	}

	// No anchor and no map pin to seed one from: its own code, because the
	// fix ("drop a pin") differs from correcting a number that was sent.
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", adminAccess, map[string]any{
		"location_id": locationID, "radius_m": 200,
	})
	if rec.Code != http.StatusBadRequest || out["error"] != "geofence_anchor_required" {
		t.Errorf("no anchor: %d %v", rec.Code, out)
	}
	// ...and once the location HAS a pin, the anchor is seeded from it.
	rec, _ = doJSON(t, h, "PATCH", "/v1/locations/"+locationID, adminAccess, map[string]any{
		"lat": fenceLat, "long": fenceLong,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("location patch: %d", rec.Code)
	}
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", adminAccess, map[string]any{
		"location_id": locationID, "radius_m": 5000, "on_missing_location": "allow",
	})
	if rec.Code != http.StatusCreated || out["lat"].(float64) != fenceLat {
		t.Fatalf("seeded anchor: %d %v", rec.Code, out)
	}
	siteRuleID := out["id"].(string)

	// --- listing -----------------------------------------------------------
	// Every member sees every rule, unlike time windows: a fence is a property
	// of the door and binds everyone identically, so there is nothing private
	// in it — and a resident refused at the gate needs to be able to find out
	// that a fence exists and how big it is.
	for _, access := range []string{adminAccess, memberAccess} {
		rec, out = doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/geofences", access, nil)
		if rec.Code != http.StatusOK || len(out["geofences"].([]any)) != 2 {
			t.Fatalf("list: %d %v", rec.Code, out)
		}
	}

	// --- writes are admin-only --------------------------------------------
	rec, _ = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", memberAccess, body)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member create: %d", rec.Code)
	}
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+accountID+"/geofences/"+ruleID, memberAccess, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member delete: %d", rec.Code)
	}

	// --- cross-tenant ------------------------------------------------------
	// A rule pointing at another account's door would be a denial primitive
	// against a stranger. Indistinguishable from not found.
	otherAccess, _ := register(t, h, "gfother@x.com")
	otherAccount, _ := tenantIDs(t, h, otherAccess)
	rec, _ = doJSON(t, h, "POST", "/v1/accounts/"+otherAccount+"/geofences", otherAccess, map[string]any{
		"access_point_id": apID, "lat": fenceLat, "long": fenceLong, "radius_m": 200,
	})
	if rec.Code != http.StatusNotFound {
		t.Errorf("cross-tenant create: %d", rec.Code)
	}
	rec, _ = doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/geofences", otherAccess, nil)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusForbidden {
		t.Errorf("cross-tenant list: %d", rec.Code)
	}

	// --- enforcement, end to end ------------------------------------------
	// The site rule allows positionless opens; the door rule denies them. Drop
	// the site rule so the door rule is the only thing speaking.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+accountID+"/geofences/"+siteRuleID, adminAccess, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete site rule: %d", rec.Code)
	}

	// At the gate: allowed.
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/open", adminAccess, map[string]any{
		"source": "web", "lat": fenceLat, "long": fenceLong,
	})
	if rec.Code != http.StatusOK || out["ok"] != true {
		t.Fatalf("open at the gate: %d %v", rec.Code, out)
	}
	// 1 260 km away: refused, with the fence's own reason in the body.
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/open", adminAccess, map[string]any{
		"source": "web", "lat": farLat, "long": farLong,
	})
	if out["error"] != "outside_geofence" {
		t.Errorf("open from another city: %d %v", rec.Code, out)
	}
	// No coordinates at all, against a deny-on-missing rule: refused, and with
	// a DIFFERENT reason. "You did not say where you are" and "you are not
	// there" send an operator to two different places.
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/open", adminAccess, map[string]any{
		"source": "web",
	})
	if out["error"] != "geofence_location_required" {
		t.Errorf("open with no coordinates: %d %v", rec.Code, out)
	}
	// open.go maps every non-suspension denial onto 429 + Retry-After; the
	// BODY carries the honest reason. A geofence denial has no meaningful
	// retry (waiting does not move you), so the hint is 0 — which is exactly
	// why this reason wants its own status and its own chat copy. Both live
	// outside this change's file scope; see the report. Pinned here so the
	// current behaviour is a recorded fact rather than an assumption.
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("current mapping is 429: %d", rec.Code)
	}
	if v, ok := out["retry_after_s"].(float64); !ok || v != 0 {
		t.Errorf("a geofence denial carries no retry hint: %v", out["retry_after_s"])
	}

	// close is NEVER geofence-restricted — the safe direction, from anywhere,
	// including with no position at all. Someone who got in must get out.
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/close", adminAccess, map[string]any{
		"source": "web", "lat": farLat, "long": farLong,
	})
	if rec.Code != http.StatusOK || out["ok"] != true {
		t.Errorf("close from outside the fence must succeed: %d %v", rec.Code, out)
	}
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/close", adminAccess, map[string]any{
		"source": "web",
	})
	if rec.Code != http.StatusOK || out["ok"] != true {
		t.Errorf("close with no coordinates must succeed: %d %v", rec.Code, out)
	}

	// --- the default, at the route level -----------------------------------
	// A door with no rule of its own, in an account that uses the feature
	// elsewhere, behaves exactly as it did before the feature existed: no
	// position needed, no restriction. (A separate access point rather than
	// the fenced one, because the per-(user, door) open cooldown would
	// otherwise answer first and prove nothing.)
	rec, out = doJSON(t, h, "POST", "/v1/access-points", adminAccess, map[string]any{
		"location_id": locationID, "name": "Unfenced side gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("second access point: %d %v", rec.Code, out)
	}
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+out["id"].(string)+"/open", adminAccess, map[string]any{
		"source": "web",
	})
	if rec.Code != http.StatusOK || out["ok"] != true {
		t.Errorf("no rule means no restriction: %d %v", rec.Code, out)
	}
	// ...and deleting the last rule is a real delete.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+accountID+"/geofences/"+ruleID, adminAccess, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete door rule: %d", rec.Code)
	}
	rec, out = doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/geofences", adminAccess, nil)
	if rec.Code != http.StatusOK || len(out["geofences"].([]any)) != 0 {
		t.Errorf("after deleting every rule: %d %v", rec.Code, out)
	}

	// --- both writes are audited ------------------------------------------
	actions := auditActions(t, h, adminAccess)
	for _, want := range []string{"geofence_create", "geofence_delete"} {
		if !containsAction(actions, want) {
			t.Errorf("missing audit action %q in %v", want, actions)
		}
	}
	// Deleting an unknown rule is a 404, not a silent success.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+accountID+"/geofences/nope", adminAccess, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("delete unknown: %d", rec.Code)
	}
}
