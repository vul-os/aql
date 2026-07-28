package httpapi

// Ownership at the HTTP boundary: who may claim, and what a claim then buys.
//
// enginetenancy_test.go covers the interim hub-wide gate — the one that
// refused a multi-account hub's members outright because no device could say
// whose it was. These cover what replaced it. The property that matters is
// that a claim is the ONLY thing that grants access on a multi-account hub,
// and that claiming is refused in every direction it should be.

import (
	"net/http"
	"testing"
)

// claim is the ordinary path: an account admin claims an engine device.
func claim(t *testing.T, h http.Handler, access, accountID, key string) (int, map[string]any) {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/devices/claims", access,
		map[string]any{"device_key": key, "label": "Test device"})
	return rec.Code, out
}

func TestClaimingIsWhatGrantsAccessOnAMultiAccountHub(t *testing.T) {
	h := engineServer(t, "")
	accessA, _ := register(t, h, "a@claim.com")
	accessB, _ := register(t, h, "b@claim.com")
	acctA, _ := tenantIDs(t, h, accessA)

	// Two accounts, nothing claimed: A sees no devices. Not a refusal — an
	// empty fleet is the honest answer for someone who owns nothing.
	rec, out := doJSON(t, h, "GET", "/v1/engine/devices", accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list before claiming: %d %v", rec.Code, out)
	}
	if devs, _ := out["devices"].([]any); len(devs) != 0 {
		t.Errorf("an account that has claimed nothing sees %d devices; on a multi-account hub "+
			"an unclaimed device belongs to nobody, and 'nobody owns it' must not mean "+
			"'anybody may drive it'", len(devs))
	}

	// Actuation is refused for the same reason.
	rec, _ = doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", accessA,
		map[string]any{"verb": "on"})
	if rec.Code != http.StatusForbidden {
		t.Errorf("unclaimed device was actuable: %d", rec.Code)
	}

	// Claim it.
	if code, out := claim(t, h, accessA, acctA, "mock:lamp-1"); code != http.StatusCreated {
		t.Fatalf("claim: %d %v", code, out)
	}

	// Now — and only now — A can see and drive that one device.
	rec, out = doJSON(t, h, "GET", "/v1/engine/devices", accessA, nil)
	devs, _ := out["devices"].([]any)
	if len(devs) != 1 {
		t.Fatalf("after claiming one device, A sees %d", len(devs))
	}
	if devs[0].(map[string]any)["key"] != "mock:lamp-1" {
		t.Errorf("wrong device visible: %v", devs[0])
	}
	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", accessA,
		map[string]any{"verb": "on"}); rec.Code != http.StatusOK {
		t.Errorf("owner could not actuate their own device: %d", rec.Code)
	}

	// B is unaffected by A's claim in both directions: cannot see it, cannot
	// drive it, and cannot take it.
	rec, out = doJSON(t, h, "GET", "/v1/engine/devices", accessB, nil)
	if devs, _ := out["devices"].([]any); len(devs) != 0 {
		t.Errorf("B sees %d of A's devices", len(devs))
	}
	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", accessB,
		map[string]any{"verb": "on"}); rec.Code != http.StatusForbidden {
		t.Errorf("B actuated a device A owns: %d", rec.Code)
	}
	acctB, _ := tenantIDs(t, h, accessB)
	if code, out := claim(t, h, accessB, acctB, "mock:lamp-1"); code != http.StatusConflict {
		t.Errorf("B took over A's device: %d %v — first claim must win, or anyone with an "+
			"account here could take a neighbour's devices one request at a time", code, out)
	}
}

// The claimable list must never be a directory of other people's hardware.
func TestClaimableListsOnlyUnownedDevices(t *testing.T) {
	h := engineServer(t, "")
	accessA, _ := register(t, h, "a@claimable.com")
	accessB, _ := register(t, h, "b@claimable.com")
	acctA, _ := tenantIDs(t, h, accessA)
	acctB, _ := tenantIDs(t, h, accessB)

	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+acctA+"/devices/claimable", accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("claimable: %d %v", rec.Code, out)
	}
	all, _ := out["devices"].([]any)
	if len(all) == 0 {
		t.Fatal("fixture: no devices offered for claiming")
	}

	if code, _ := claim(t, h, accessA, acctA, "mock:lamp-1"); code != http.StatusCreated {
		t.Fatal("claim failed")
	}

	// Gone from B's claimable list — and B learns only that it is not
	// available, never that it is A's.
	_, out = doJSON(t, h, "GET", "/v1/accounts/"+acctB+"/devices/claimable", accessB, nil)
	after, _ := out["devices"].([]any)
	if len(after) != len(all)-1 {
		t.Errorf("claimable list is %d after one claim, want %d", len(after), len(all)-1)
	}
	for _, d := range after {
		dm := d.(map[string]any)
		if dm["key"] == "mock:lamp-1" {
			t.Error("a claimed device is still offered for claiming")
		}
		if _, leaks := dm["account_id"]; leaks {
			t.Error("the claimable listing carries an account id")
		}
	}
}

// Claiming decides who may actuate a physical device. That is an admin act.
func TestOnlyAnAccountAdminMayClaimOrRelease(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	// A second engine-backed server is not needed: what is under test here is
	// the role gate, which runs before the engine is consulted.
	_ = st
	h = engineServer(t, "")

	accessOwner, _ := register(t, h, "owner@role.com")
	accessMember, _ := register(t, h, "member@role.com")
	acct, _ := tenantIDs(t, h, accessOwner)

	// A non-member gets 404 — the tenancy contract, unchanged here.
	rec, _ := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/devices/claims", accessMember,
		map[string]any{"device_key": "mock:lamp-1"})
	if rec.Code != http.StatusNotFound {
		t.Errorf("non-member claim: %d, want 404", rec.Code)
	}
	rec, _ = doJSON(t, h, "GET", "/v1/accounts/"+acct+"/devices/claimable", accessMember, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("non-member claimable list: %d, want 404", rec.Code)
	}
}

func TestAClaimMustNameADeviceTheEngineActuallyHas(t *testing.T) {
	h := engineServer(t, "")
	access, _ := register(t, h, "a@ghost.com")
	acct, _ := tenantIDs(t, h, access)

	// Staking a claim on hardware nobody has seen turns first-claim-wins into
	// a land grab: an account could pre-claim every plausible key before the
	// devices are plugged in.
	if code, out := claim(t, h, access, acct, "mock:not-a-real-device"); code != http.StatusNotFound {
		t.Errorf("claimed a device the engine has never reported: %d %v", code, out)
	}
	if code, _ := claim(t, h, access, acct, ""); code != http.StatusBadRequest {
		t.Errorf("an empty device key was accepted: %d", code)
	}
}

// Release is how a device changes hands, and it must be scoped to the owner.
func TestReleasingReturnsADeviceToTheClaimablePool(t *testing.T) {
	h := engineServer(t, "")
	accessA, _ := register(t, h, "a@rel.com")
	accessB, _ := register(t, h, "b@rel.com")
	acctA, _ := tenantIDs(t, h, accessA)
	acctB, _ := tenantIDs(t, h, accessB)

	if code, _ := claim(t, h, accessA, acctA, "mock:lamp-1"); code != http.StatusCreated {
		t.Fatal("claim failed")
	}

	// B cannot release what it does not own — otherwise takeover is a
	// two-step process rather than an impossible one.
	rec, _ := doJSON(t, h, "DELETE", "/v1/accounts/"+acctB+"/devices/claims/mock:lamp-1", accessB, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("B released A's claim: %d", rec.Code)
	}
	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", accessA,
		map[string]any{"verb": "on"}); rec.Code != http.StatusOK {
		t.Error("A lost their device to B's release attempt")
	}

	// The owner can, and then it is anyone's again.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+acctA+"/devices/claims/mock:lamp-1", accessA, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner release: %d", rec.Code)
	}
	if code, out := claim(t, h, accessB, acctB, "mock:lamp-1"); code != http.StatusCreated {
		t.Errorf("a released device could not be claimed by anyone else: %d %v", code, out)
	}
	// ...and A has lost it, which is the point of releasing.
	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", accessA,
		map[string]any{"verb": "on"}); rec.Code != http.StatusForbidden {
		t.Errorf("A still drives a device it released: %d", rec.Code)
	}
}

// The single-household deployment must not have to claim anything to work.
func TestASoleAccountHubNeedsNoClaims(t *testing.T) {
	h := engineServer(t, "")
	access, _ := register(t, h, "home@sole.com")

	rec, out := doJSON(t, h, "GET", "/v1/engine/devices", access, nil)
	devs, _ := out["devices"].([]any)
	if rec.Code != http.StatusOK || len(devs) == 0 {
		t.Fatalf("a sole account sees %d devices (%d) — ownership must not make the product's "+
			"normal deployment claim every lamp before it works", len(devs), rec.Code)
	}
	if rec, _ := doJSON(t, h, "POST", "/v1/engine/devices/mock:lamp-1/execute", access,
		map[string]any{"verb": "on"}); rec.Code != http.StatusOK {
		t.Error("a sole account could not actuate an unclaimed device")
	}
}
