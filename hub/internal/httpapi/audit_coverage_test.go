package httpapi

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
)

// auditActions fetches the admin-action trail and returns just the
// "action" strings, for simple membership checks below.
func auditActions(t *testing.T, h http.Handler, adminAccess string) []string {
	t.Helper()
	rec, out := doJSON(t, h, "GET", "/v1/admin/audit/actions?limit=200", adminAccess, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("audit actions: %d %v", rec.Code, out)
	}
	var actions []string
	for _, a := range out["actions"].([]any) {
		actions = append(actions, a.(map[string]any)["action"].(string))
	}
	return actions
}

func containsAction(actions []string, want string) bool {
	for _, a := range actions {
		if a == want {
			return true
		}
	}
	return false
}

// TestAuditCoverageDeviceLocationAccessPointInvite is fix 4's regression
// test: before this change, WriteAdminAudit had only ~6 call sites and
// NONE of device creation, claim-token issuance, pairing redemption,
// member invites, or location/access-point CRUD wrote anything durable —
// only a transient slog line (or nothing at all). Every action exercised
// here must now appear in GET /v1/admin/audit/actions.
func TestAuditCoverageDeviceLocationAccessPointInvite(t *testing.T) {
	h, st := newTestServerWithStore(t, "op-token")
	adminAccess := claimAdmin(t, h, "audit-admin@x.com")
	acctA, locA := tenantIDs(t, h, adminAccess)

	// --- devices.go: device create + claim issuance ---
	rec, out := doJSON(t, h, "POST", "/v1/devices", adminAccess, map[string]any{
		"location_id": locA, "label": "front-controller",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("device create: %d %v", rec.Code, out)
	}
	claimToken := out["claim_token"].(string)

	// --- devices.go: pairing redemption (unauthenticated route) ---
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	rec, out = doJSON(t, h, "POST", "/api/pair/redeem", "", map[string]any{
		"v": 0, "typ": "pair.redeem", "claim_token": claimToken,
		"controller_pubkey": base64.RawURLEncoding.EncodeToString(pub),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("pair redeem: %d %v", rec.Code, out)
	}

	// --- accounts.go: invite create + accept ---
	token := inviteAndRecoverToken(t, h, st, adminAccess, acctA, "invitee@x.com", "member", "+27821230000")
	inviteeAccess, _ := register(t, h, "invitee@x.com")
	rec, out = doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept", inviteeAccess, map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("invite accept: %d %v", rec.Code, out)
	}

	// --- locations.go: nested create, patch, limits patch, delete ---
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+acctA+"/locations", adminAccess, map[string]any{
		"type": "building", "name": "Annex",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("location create: %d %v", rec.Code, out)
	}
	annexID := out["id"].(string)
	rec, _ = doJSON(t, h, "PATCH", "/v1/locations/"+annexID, adminAccess, map[string]any{"name": "Annex 2"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("location patch: %d", rec.Code)
	}
	rec, out = doJSON(t, h, "PATCH", "/v1/locations/"+annexID+"/limits", adminAccess, map[string]any{
		"max_opens_per_member_per_day": 5,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("location limits patch: %d %v", rec.Code, out)
	}
	rec, out = doJSON(t, h, "DELETE", "/v1/locations/"+annexID, adminAccess, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("location delete: %d %v", rec.Code, out)
	}

	// --- access.go: access point create ---
	rec, out = doJSON(t, h, "POST", "/v1/access-points", adminAccess, map[string]any{
		"location_id": locA, "name": "Gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("access point create: %d %v", rec.Code, out)
	}

	actions := auditActions(t, h, adminAccess)
	for _, want := range []string{
		"device_claim_create",
		"device_pair_redeem",
		"invite_create",
		"invite_accept",
		"location_create",
		"location_update",
		"location_limits_update",
		"location_delete",
		"access_point_create",
	} {
		if !containsAction(actions, want) {
			t.Errorf("expected %q in the admin audit trail, got: %v", want, actions)
		}
	}
}

// TestAuditCoverageOnlineVisitorGrants is the online-grant counterpart of
// the above: before this change, open.go's handleGrantCreate/handleGrantRevoke
// wrote no admin-audit row at all — unlike offline_grants.go's
// handleOfflineGrantIssue, which already did (see its own comment on why:
// "so an operator can see who holds what"). Issuing or revoking someone's
// physical access is exactly the kind of action that trail exists for.
func TestAuditCoverageOnlineVisitorGrants(t *testing.T) {
	h, _ := newTestServerWithStore(t, "op-token")
	adminAccess := claimAdmin(t, h, "grant-audit-admin@x.com")
	_, locA := tenantIDs(t, h, adminAccess)

	rec, out := doJSON(t, h, "POST", "/v1/access-points", adminAccess, map[string]any{
		"location_id": locA, "name": "Main gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("ap create: %d %v", rec.Code, out)
	}
	apID := out["id"].(string)

	endsAt := "2099-01-01T00:00:00Z"
	rec, out = doJSON(t, h, "POST", "/v1/grants", adminAccess, map[string]any{
		"phone_e164": "+27825550099", "ends_at": endsAt, "access_point_ids": []string{apID},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("grant create: %d %v", rec.Code, out)
	}
	grantID := out["id"].(string)

	rec, out = doJSON(t, h, "POST", "/v1/grants/"+grantID+"/revoke", adminAccess, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("grant revoke: %d %v", rec.Code, out)
	}

	actions := auditActions(t, h, adminAccess)
	for _, want := range []string{"grant_create", "grant_revoke"} {
		if !containsAction(actions, want) {
			t.Errorf("expected %q in the admin audit trail, got: %v", want, actions)
		}
	}
}

// No route may drop an audit write on the floor without saying why.
//
// 55 call sites write the admin trail; 46 of them log on failure with the same
// shape — s.log.Error("<action> audit write failed", ...). Four in adminops.go
// discarded it with `_ =` and no comment: account suspend, user status,
// PLATFORM ADMIN GRANT, and the instance limits update. The highest-privilege
// actions this hub has, and a failed audit write on any of them was invisible
// — the action succeeded, the response said 200, and nothing anywhere recorded
// that the trail had a hole in it.
//
// Returning 500 would be wrong: the action already happened, and failing the
// response would make the answer disagree with the world. Logging is the
// convention the other 46 already follow, so this pins it.
//
// automations/engine.go is deliberately NOT covered. Its discards carry a
// stated reason — "the save did not happen, so a failed audit write cannot
// leave the trail disagreeing with the world" — and that is a different
// package with a different rule. A guard that swept it up would be asserting a
// policy nobody chose.
func TestNoHandlerDiscardsAnAuditWrite(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	discarded := []string{}
	checked := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(body), "\n") {
			if !strings.Contains(line, "WriteAdminAudit(") {
				continue
			}
			checked++
			if strings.Contains(line, "_ = ") {
				discarded = append(discarded, fmt.Sprintf("%s:%d", name, i+1))
			}
		}
	}

	// A floor, so a rename of the method silently reduces this to "no
	// discards found" rather than failing.
	if checked < 20 {
		t.Fatalf("only %d WriteAdminAudit call sites found in this package; the "+
			"scan has drifted and would report clean either way", checked)
	}
	if len(discarded) > 0 {
		t.Errorf("these audit writes discard their error with no handling: %v\n"+
			"Log it the way the rest of this package does — the action has already "+
			"happened, so a 500 would be wrong, but an unwritten trail row must not "+
			"be silent.", discarded)
	}
}
