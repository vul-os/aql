package httpapi

import (
	"net/http"
	"testing"
)

// A 429 carries a retry hint only when there is one to give.
//
// # The defect
//
// open.go answers every non-suspension denial with 429, and it used to attach
// `Retry-After: <verdict.RetryAfterS>` unconditionally. openpath.go
// deliberately returns no seconds for a geofence denial, and says why in the
// code: "waiting does not fix being in the wrong place, and inventing a number
// here would render as 'try again in ~N min' on every chat rail."
//
// The handler undid that one layer up. `Retry-After: 0` is not "no hint" — RFC
// 9110 reads it as RETRY IMMEDIATELY, which is the worst available advice for
// someone standing outside a fence, and unlike the chat-rail copy it went to
// every API consumer rather than only to a surface we control.
//
// Omitting the header is safe for any client: absence is a case they must
// already handle.

func TestAGeofenceDenialCarriesNoRetryHint(t *testing.T) {
	h, st := newTestServerWithStore(t, "op-token")
	admin := claimAdmin(t, h, "rh-admin@x.com")
	accountID, locationID := tenantIDs(t, h, admin)
	_ = st

	rec, out := doJSON(t, h, "POST", "/v1/access-points", admin, map[string]any{
		"location_id": locationID, "name": "Front gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("access point: %d %v", rec.Code, out)
	}
	apID := out["id"].(string)

	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/geofences", admin, map[string]any{
		"access_point_id": apID, "lat": fenceLat, "long": fenceLong,
		"radius_m": 200, "note": "front gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("geofence: %d %v", rec.Code, out)
	}

	// An open from a long way away: denied for being in the wrong place.
	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/open", admin, map[string]any{
		"source": "api", "lat": fenceLat + 5, "long": fenceLong + 5,
	})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("open from outside the fence: %d %v", rec.Code, out)
	}
	if out["error"] != "outside_geofence" {
		t.Fatalf("error = %v, want outside_geofence", out["error"])
	}

	if got := rec.Header().Get("Retry-After"); got != "" {
		t.Errorf(`Retry-After: %q on a geofence denial.

Zero is not "no hint" — RFC 9110 reads it as retry immediately, and retrying
from the same place fails identically, forever. The store refuses to invent a
number here on purpose; this header is where that refusal gets undone.`, got)
	}
	if v, present := out["retry_after_s"]; present {
		t.Errorf("retry_after_s: %v present on a geofence denial; a client reading it "+
			"as seconds is told to try again at once", v)
	}
}

// And the other direction: a denial that DOES know when still says so.
//
// The control. A handler that simply stopped sending the header would satisfy
// the test above and destroy the one case where "come back later" is true and
// computable — a time window knows exactly when it next opens, and a member
// told nothing has to guess.
func TestATimeWindowDenialStillCarriesItsRetryHint(t *testing.T) {
	h, st := newTestServerWithStore(t, "op-token")
	admin := claimAdmin(t, h, "rh-tw@x.com")
	accountID, locationID := tenantIDs(t, h, admin)
	userID := meID(t, h, admin)
	_ = st

	rec, out := doJSON(t, h, "POST", "/v1/access-points", admin, map[string]any{
		"location_id": locationID, "name": "Front gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("access point: %d %v", rec.Code, out)
	}
	apID := out["id"].(string)

	// A one-minute window, so now is outside it whenever this runs.
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/time-windows", admin, map[string]any{
		"user_id": userID, "access_point_id": apID, "tz": "UTC",
		"windows": []map[string]any{{"days": "mon-sun", "from": "03:00", "to": "03:01"}},
	})
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("time window: %d %v", rec.Code, out)
	}

	rec, out = doJSON(t, h, "POST", "/v1/access-points/"+apID+"/open", admin, map[string]any{"source": "api"})
	if rec.Code != http.StatusTooManyRequests || out["error"] != "outside_time_window" {
		if out["error"] == nil {
			t.Skip("the run is inside the permitted minute")
		}
		t.Fatalf("open outside the window: %d %v", rec.Code, out)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("a schedule denial dropped its retry hint; this is the one denial that " +
			"genuinely knows when it next opens, and the member is left guessing")
	}
	if v, ok := out["retry_after_s"].(float64); !ok || v <= 0 {
		t.Errorf("retry_after_s = %v, want the seconds until the window reopens", out["retry_after_s"])
	}
}
