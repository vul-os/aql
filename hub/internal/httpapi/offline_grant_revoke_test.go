package httpapi

import (
	"net/http"
	"testing"
)

// End-to-end revocation over HTTP — docs/GRANT-REVOCATION.md §6 step 5.
//
// The store layer proves the deny-list query and the seq rule; this proves the
// path an operator actually walks: issue, see it listed, revoke, and find it on
// the deny-list the controller will be sent.

// issueGrant mints one and returns its id.
func issueGrant(t *testing.T, f *offlineGrantFixture, access string) string {
	t.Helper()
	rec, out := doJSON(t, f.h, "POST", "/v1/offline-grants", access, map[string]any{
		"app_pubkey":       genAppPubkey(t),
		"access_point_ids": []string{f.apID},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("issue: %d %s", rec.Code, rec.Body)
	}
	id, _ := out["grant_id"].(string)
	if id == "" {
		t.Fatalf("issued grant carries no grant_id: %v", out)
	}
	return id
}

// A grant the hub does not remember cannot be revoked, so issuance recording is
// the load-bearing half — and it is invisible at issue time, which is why it is
// checked here rather than assumed.
func TestAnIssuedGrantIsRememberedAndListed(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)

	rec, out := doJSON(t, f.h, "GET", "/v1/offline-grants", f.memberAccess, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	rows, _ := out["grants"].([]any)
	if len(rows) != 1 {
		t.Fatalf("listed %d grants, want 1 — an unremembered grant can never be revoked", len(rows))
	}
	row := rows[0].(map[string]any)
	if row["grant_id"] != id {
		t.Errorf("listed grant_id = %v, want %v", row["grant_id"], id)
	}
	if row["revoked"] != false {
		t.Errorf("a freshly issued grant reads as revoked: %v", row)
	}
}

func TestTheHolderCanRevokeTheirOwnGrant(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)

	rec, out := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", f.memberAccess, map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s — a lost phone is the common case and the holder must "+
			"not have to find an admin first", rec.Code, rec.Body)
	}
	if seq, _ := out["seq"].(float64); seq <= 0 {
		t.Errorf("seq = %v, want > 0 — the controller treats 0 as 'never received a list'", out["seq"])
	}
	// The deny-list must actually be SENT. Recording the revocation and telling
	// the operator it worked, while no controller is ever told, is the failure
	// this whole feature exists to avoid — and it looks identical from the
	// database.
	dispatched, _ := out["dispatched"].([]any)
	if len(dispatched) != 1 || dispatched[0] != f.deviceID {
		t.Fatalf("dispatched = %v, want [%s] — a revocation nothing was told about "+
			"leaves the gate open for the full TTL", out["dispatched"], f.deviceID)
	}

	// It is on the deny-list the controller will be sent.
	entries, err := f.st.DenyListForDevice(t.Context(), f.deviceID, 0)
	if err != nil {
		t.Fatalf("DenyListForDevice: %v", err)
	}
	if len(entries) != 1 || entries[0].GrantID != id {
		t.Fatalf("deny-list = %+v, want the revoked grant", entries)
	}

	// Revoking again is refused rather than silently re-sending, so a repeated
	// click cannot walk the sequence forward.
	rec2, _ := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", f.memberAccess, map[string]any{})
	if rec2.Code != http.StatusConflict {
		t.Errorf("second revoke: %d, want 409", rec2.Code)
	}
}

func TestAnAdminOfTheGatesAccountCanRevokeAMembersGrant(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)

	rec, _ := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", f.accessA, map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("owner revoke: %d %s — it is their gate", rec.Code, rec.Body)
	}
}

// A stranger must not be able to revoke, and must not learn that the id exists.
func TestAStrangerCannotRevokeAndIsNotToldTheGrantExists(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)

	rec, _ := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", f.accessB, map[string]any{})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("stranger revoke: %d, want 404 — a 403 confirms the id is real", rec.Code)
	}
	// And nothing happened.
	entries, err := f.st.DenyListForDevice(t.Context(), f.deviceID, 0)
	if err != nil {
		t.Fatalf("DenyListForDevice: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("a stranger's refused revoke still reached the deny-list: %+v", entries)
	}
}

// The list is scoped to the caller. An admin does not see other members' grants
// here — that is a different screen with a different authorisation question.
func TestTheGrantListIsScopedToTheCaller(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	issueGrant(t, f, f.memberAccess)

	rec, out := doJSON(t, f.h, "GET", "/v1/offline-grants", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner list: %d %s", rec.Code, rec.Body)
	}
	rows, _ := out["grants"].([]any)
	if len(rows) != 0 {
		t.Errorf("the owner sees %d of the member's grants on their own list", len(rows))
	}
}

// A revocation is an admin-audit fact, like the issuance it undoes.
func TestRevocationIsAudited(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)
	if rec, _ := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", f.memberAccess, map[string]any{}); rec.Code != 200 {
		t.Fatalf("revoke: %d", rec.Code)
	}
	rows, _, err := f.st.AdminAuditActions(t.Context(), 50, 0)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	for _, r := range rows {
		if r.Action == "offline_grant_revoke" && r.TargetID == id {
			return
		}
	}
	t.Errorf("no offline_grant_revoke audit row for %s among %d rows", id, len(rows))
}

// A plain member of the gate's account must NOT be able to revoke someone
// else's grant.
//
// The rule is holder-or-admin, and the difference between "is a member here"
// and "is an admin here" is the whole rule: everyone at a shared house is a
// member, and a housemate revoking another housemate's emergency access is not
// something the hub should allow on the strength of living there.
//
// Written because widening the check from admin to any-membership passed every
// other test — the only unauthorised caller they exercised was a stranger from
// a different account, who has no membership at all and is refused by a
// different branch.
func TestAPlainMemberCannotRevokeAnotherMembersGrant(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)

	// A second plain member of the SAME account as the gate.
	other, _ := register(t, f.h, "other-member-og@op.com")
	token := inviteAndRecoverToken(t, f.h, f.st, f.accessA, f.acctA, "other-member-og@op.com", "member", "+27821110002")
	if rec, _ := doJSON(t, f.h, "POST", "/v1/accounts/invites/"+token+"/accept", other, map[string]any{}); rec.Code != 200 {
		t.Fatalf("second member accept: %d", rec.Code)
	}

	rec, _ := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", other, map[string]any{})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("plain member revoke: %d, want 404 — membership is not authority over "+
			"another member's access", rec.Code)
	}
	entries, err := f.st.DenyListForDevice(t.Context(), f.deviceID, 0)
	if err != nil {
		t.Fatalf("DenyListForDevice: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("a refused revoke still reached the deny-list: %+v", entries)
	}
}

// The grant list says which gates are actually refusing a revoked grant.
//
// "Revoked" is a fact about the hub. Whether a given gate will still open for
// the person is a fact about that gate, and before this the only answer was
// which controllers a command had been SENT to — which says nothing about one
// that never came back.
func TestTheGrantListReportsWhichGatesAreRefusingIt(t *testing.T) {
	f := setupOfflineGrantFixture(t)
	id := issueGrant(t, f, f.memberAccess)

	list := func() map[string]any {
		t.Helper()
		rec, out := doJSON(t, f.h, "GET", "/v1/offline-grants", f.memberAccess, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body)
		}
		rows, _ := out["grants"].([]any)
		if len(rows) != 1 {
			t.Fatalf("listed %d grants, want 1", len(rows))
		}
		return rows[0].(map[string]any)
	}

	// An ACTIVE grant reports no gates: there is no revocation to have
	// converged, and an empty array would read as "no gates", a different claim.
	if g, present := list()["gates"]; present {
		t.Fatalf("an active grant carries gates: %v", g)
	}

	if rec, _ := doJSON(t, f.h, "POST", "/v1/offline-grants/"+id+"/revoke", f.memberAccess, map[string]any{}); rec.Code != 200 {
		t.Fatalf("revoke: %d", rec.Code)
	}

	// The gate has said nothing, so it is UNREPORTED — not "not enforcing".
	gates, _ := list()["gates"].([]any)
	if len(gates) != 1 {
		t.Fatalf("gates = %v, want one", gates)
	}
	g0 := gates[0].(map[string]any)
	if g0["device_id"] != f.deviceID {
		t.Errorf("device_id = %v, want %v", g0["device_id"], f.deviceID)
	}
	if g0["reported"] != false || g0["enforcing"] != false {
		t.Errorf("a silent gate = %v, want reported false and enforcing false — nothing "+
			"confirms it is refusing this grant", g0)
	}

	// Now the controller reports the list it holds.
	seq, err := f.st.RevocationSeq(t.Context())
	if err != nil {
		t.Fatalf("RevocationSeq: %v", err)
	}
	if err := f.st.SaveRevocationReport(t.Context(), f.deviceID, seq, 1, 1000); err != nil {
		t.Fatalf("SaveRevocationReport: %v", err)
	}
	g1 := list()["gates"].([]any)[0].(map[string]any)
	if g1["reported"] != true || g1["enforcing"] != true {
		t.Errorf("after the gate reported the current list: %v, want reported and enforcing", g1)
	}
}
