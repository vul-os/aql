package httpapi

// DELETE /v1/accounts/{id}/members/{user_id} at the HTTP boundary.
//
// The store tests prove what a removal DOES. These prove who is allowed to ask
// for one, which is the half an attacker interacts with — and that a refusal
// tells them nothing they did not already know.

import (
	"net/http"
	"testing"
)

// memberIDs maps username → user_id from the roster, which is the only place
// the console learns the id it puts in this URL.
func memberIDs(t *testing.T, h http.Handler, access, accountID string) map[string]string {
	t.Helper()
	rec, out := doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/members", access, nil)
	if rec.Code != 200 {
		t.Fatalf("roster: %d %s", rec.Code, rec.Body)
	}
	ids := map[string]string{}
	for _, m := range out["members"].([]any) {
		mm := m.(map[string]any)
		ids[mm["username"].(string)] = mm["user_id"].(string)
	}
	return ids
}

func TestMemberRemovalAuthorization(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	accessOwner, _ := register(t, h, "owner@rm.com")
	accessCleaner, _ := register(t, h, "cleaner@rm.com")
	accessStranger, _ := register(t, h, "stranger@rm.com")
	acct, _ := tenantIDs(t, h, accessOwner)

	accessHelper, _ := register(t, h, "helper@rm.com")
	for _, u := range []struct{ name, phone, access string }{
		{"cleaner@rm.com", "+27821234567", accessCleaner},
		{"helper@rm.com", "+27821234568", accessHelper},
	} {
		token := inviteAndRecoverToken(t, h, st, accessOwner, acct, u.name, "member", u.phone)
		if rec, _ := doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept", u.access, map[string]any{}); rec.Code != 200 {
			t.Fatalf("accept %s: %d", u.name, rec.Code)
		}
	}
	ids := memberIDs(t, h, accessOwner, acct)
	ownerID, cleanerID := ids["owner@rm.com"], ids["cleaner@rm.com"]
	if ownerID == "" || cleanerID == "" {
		t.Fatalf("roster did not name both members: %v", ids)
	}

	// A non-member gets 404, not 403: the tenancy contract is that an outsider
	// cannot tell an account they may not touch from one that does not exist.
	// A 403 here would confirm the account id and the membership of whoever
	// they aimed at.
	rec, _ := doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+cleanerID, accessStranger, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("non-member removal: %d, want 404", rec.Code)
	}

	// A plain member is inside the account, so 403 leaks nothing new — but they
	// must not be able to evict the owner who invited them.
	rec, out := doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+ownerID, accessCleaner, nil)
	if rec.Code != http.StatusForbidden || out["error"] != "not_account_admin" {
		t.Errorf("member removing owner: %d %v", rec.Code, out)
	}
	// ...and the attempt changed nothing.
	if rec, _ := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/members", accessOwner, nil); rec.Code != 200 {
		t.Error("the refused removal locked the owner out anyway")
	}

	// Nor may they remove a PEER. The owner rule in the store would stop the
	// case above on its own, so without this the admin gate could be deleted
	// and every test still pass — leaving any member able to evict the rest of
	// the household.
	rec, out = doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+ids["helper@rm.com"], accessCleaner, nil)
	if rec.Code != http.StatusForbidden || out["error"] != "not_account_admin" {
		t.Errorf("member removing a peer member: %d %v", rec.Code, out)
	}

	// The owner is the only owner, so removing themselves would leave the
	// account with nobody who can administer it — including nobody who could
	// undo the mistake.
	rec, out = doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+ownerID, accessOwner, nil)
	if rec.Code != http.StatusConflict || out["error"] != "last_owner" {
		t.Errorf("self-removal of the sole owner: %d %v", rec.Code, out)
	}

	// The removal that should work.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+cleanerID, accessOwner, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner removing a member: %d %s", rec.Code, rec.Body)
	}

	// The cleaner's still-valid session now sees the account the way any
	// outsider does. The token was not revoked — it does not have to be,
	// because authority is re-read from the membership on every request.
	for _, path := range []string{"/v1/accounts/" + acct + "/members",
		"/v1/accounts/" + acct + "/locations"} {
		if rec, _ := doJSON(t, h, "GET", path, accessCleaner, nil); rec.Code != http.StatusNotFound {
			t.Errorf("removed member still reads %s: %d", path, rec.Code)
		}
	}

	// Idempotent-looking retries must not report success; a 204 here would
	// write a second audit entry for a removal that already happened.
	rec, out = doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+cleanerID, accessOwner, nil)
	if rec.Code != http.StatusNotFound || out["error"] != "member_not_found" {
		t.Errorf("repeat removal: %d %v", rec.Code, out)
	}

	// The removal is on the audit trail. Offboarding is exactly the event an
	// operator is asked to account for later.
	entries, _, err := st.AdminAuditActions(t.Context(), 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	var seen bool
	for _, e := range entries {
		if e.Action == "member_remove" {
			seen = true
		}
	}
	if !seen {
		t.Error("no member_remove entry in the admin audit log")
	}
}

// Owners must be removable by other owners — the last-owner rule is about the
// account keeping an administrator, not about owners being permanent.
func TestOwnersAreRemovableByOtherOwners(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	accessA, _ := register(t, h, "a@own.com")
	accessB, _ := register(t, h, "b@own.com")
	accessAdmin, _ := register(t, h, "adm@own.com")
	acct, _ := tenantIDs(t, h, accessA)

	for _, u := range []struct {
		name, role, access, phone string
	}{
		{"b@own.com", "owner", accessB, "+27820000011"},
		{"adm@own.com", "admin", accessAdmin, "+27820000012"},
	} {
		token := inviteAndRecoverToken(t, h, st, accessA, acct, u.name, u.role, u.phone)
		if rec, _ := doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept", u.access, map[string]any{}); rec.Code != 200 {
			t.Fatalf("accept %s: %d", u.name, rec.Code)
		}
	}
	ids := memberIDs(t, h, accessA, acct)

	// An admin holds every other power in the account. Letting them evict an
	// owner would make the two roles the same after one request.
	rec, out := doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+ids["b@own.com"], accessAdmin, nil)
	if rec.Code != http.StatusForbidden || out["error"] != "owner_removal_requires_owner" {
		t.Errorf("admin removing owner: %d %v", rec.Code, out)
	}

	// The other owner can.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+ids["b@own.com"], accessA, nil)
	if rec.Code != http.StatusNoContent {
		t.Errorf("owner removing a co-owner: %d %s", rec.Code, rec.Body)
	}

	// And the admin is still removable by the remaining owner, so the rule did
	// not quietly harden into "nobody senior can be removed".
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+acct+"/members/"+ids["adm@own.com"], accessA, nil)
	if rec.Code != http.StatusNoContent {
		t.Errorf("owner removing an admin: %d %s", rec.Code, rec.Body)
	}
}
