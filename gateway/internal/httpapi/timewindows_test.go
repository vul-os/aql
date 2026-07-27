package httpapi

import (
	"net/http"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/store"
)

// inviteMember adds a second user to the admin's account and returns their
// id + access token, so a rule can be written about somebody who is not the
// person writing it.
func inviteMember(t *testing.T, h http.Handler, st *store.Store, adminAccess, accountID, username, phone string) (userID, access string) {
	t.Helper()
	memberAccess, _ := register(t, h, username)
	token := inviteAndRecoverToken(t, h, st, adminAccess, accountID, username, "member", phone)
	rec, out := doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept", memberAccess, map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("invite accept: %d %v", rec.Code, out)
	}
	_, me := doJSON(t, h, "GET", "/v1/auth/me", memberAccess, nil)
	return me["user"].(map[string]any)["id"].(string), memberAccess
}

func TestTimeWindowRoutes(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	adminAccess, _ := register(t, h, "twadmin@x.com")
	accountID, locationID := tenantIDs(t, h, adminAccess)
	memberID, memberAccess := inviteMember(t, h, st, adminAccess, accountID, "twmember@x.com", "+27821110001")

	rec, out := doJSON(t, h, "POST", "/v1/access-points", adminAccess, map[string]any{
		"location_id": locationID, "name": "Front gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("access point: %d %v", rec.Code, out)
	}
	apID := out["id"].(string)

	// --- create ------------------------------------------------------------
	body := map[string]any{
		"user_id": memberID, "access_point_id": apID, "tz": "Africa/Johannesburg",
		"windows": []map[string]string{{"days": "mon-fri", "from": "07:00", "to": "11:00"}},
		"note":    "cleaner",
	}
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", adminAccess, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %v", rec.Code, out)
	}
	ruleID := out["id"].(string)
	if out["tz"] != "Africa/Johannesburg" || len(out["windows"].([]any)) != 1 {
		t.Errorf("create response: %v", out)
	}

	// One rule per (member, target).
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", adminAccess, body)
	if rec.Code != http.StatusConflict || out["error"] != "time_window_rule_exists" {
		t.Errorf("duplicate: %d %v", rec.Code, out)
	}

	// A refused rule names the problem — an operator guessing at an access
	// rule is how somebody gets locked out.
	for _, bad := range []map[string]any{
		{"user_id": memberID, "location_id": locationID, "tz": "", // no zone, never defaulted
			"windows": []map[string]string{{"days": "mon", "from": "07:00", "to": "11:00"}}},
		{"user_id": memberID, "location_id": locationID, "tz": "UTC", // spans midnight in one window
			"windows": []map[string]string{{"days": "mon", "from": "22:00", "to": "06:00"}}},
		{"user_id": memberID, "tz": "UTC", // no target
			"windows": []map[string]string{{"days": "mon", "from": "07:00", "to": "11:00"}}},
	} {
		rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", adminAccess, bad)
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_time_window" || out["detail"] == "" {
			t.Errorf("invalid rule %v: %d %v", bad, rec.Code, out)
		}
	}

	// --- listing -----------------------------------------------------------
	rec, out = doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/time-windows", adminAccess, nil)
	if rec.Code != http.StatusOK || len(out["time_windows"].([]any)) != 1 {
		t.Fatalf("admin list: %d %v", rec.Code, out)
	}
	// A member sees their OWN rule — being refused at 3am with no way to find
	// out why is how a safety feature gets remembered as a broken gate.
	rec, out = doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/time-windows", memberAccess, nil)
	if rec.Code != http.StatusOK || len(out["time_windows"].([]any)) != 1 {
		t.Fatalf("member list: %d %v", rec.Code, out)
	}
	// ...and only their own.
	otherID, otherAccess := inviteMember(t, h, st, adminAccess, accountID, "twother@x.com", "+27821110002")
	rec, _ = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", adminAccess, map[string]any{
		"user_id": otherID, "location_id": locationID, "tz": "UTC",
		"windows": []map[string]string{{"days": "sat-sun", "from": "08:00", "to": "09:00"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatal("second rule")
	}
	rec, out = doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/time-windows", memberAccess, nil)
	if rec.Code != http.StatusOK || len(out["time_windows"].([]any)) != 1 {
		t.Errorf("member must not see co-members' rules: %d %v", rec.Code, out)
	}

	// --- writes are admin-only --------------------------------------------
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", memberAccess, map[string]any{
		"user_id": otherID, "access_point_id": apID, "tz": "UTC",
		"windows": []map[string]string{{"days": "mon", "from": "00:00", "to": "24:00"}},
	})
	if rec.Code != http.StatusForbidden {
		t.Errorf("member create: %d %v", rec.Code, out)
	}
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+accountID+"/time-windows/"+ruleID, otherAccess, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member delete: %d", rec.Code)
	}

	// --- enforcement, end to end ------------------------------------------
	// The member's rule is Mon-Fri 07:00-11:00 SAST. Replace it with one that
	// cannot include now, and the open route must refuse.
	rec, _ = doJSON(t, h, "DELETE", "/v1/accounts/"+accountID+"/time-windows/"+ruleID, adminAccess, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	future := time.Now().UTC().AddDate(0, 0, 3).Weekday().String()[:3]
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", adminAccess, map[string]any{
		"user_id": memberID, "access_point_id": apID, "tz": "UTC",
		"windows": []map[string]string{{"days": lowerASCII(future), "from": "00:00", "to": "24:00"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("enforcement rule: %d %v", rec.Code, out)
	}
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/open", memberAccess, map[string]any{"source": "web"})
	if out["error"] != "outside_time_window" {
		t.Errorf("open outside the window: %d %v", rec.Code, out)
	}
	// The retry hint is the real wait until this member's next allowed
	// instant, so the refusal is actionable rather than just negative.
	// (open.go maps every non-suspension reason onto 429 + Retry-After; the
	// BODY carries the honest reason. Giving a schedule denial its own status
	// would mean editing open.go, which is outside this change's file scope —
	// see the report.)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Errorf("denial should carry a retry hint: %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	if v, ok := out["retry_after_s"].(float64); !ok || v <= 0 {
		t.Errorf("retry_after_s: %v", out["retry_after_s"])
	}
	// close is never window-restricted — the safe direction, at any hour.
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/close", memberAccess, map[string]any{"source": "web"})
	if rec.Code != http.StatusOK || out["ok"] != true {
		t.Errorf("close during a denied window must succeed: %d %v", rec.Code, out)
	}
}

func lowerASCII(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}
