package httpapi

import (
	"net/http"
	"testing"
)

// A new location gets the type the caller asked for.
//
// CreateAccountWithOwner has no type parameter — it always makes a house — so
// any other type depends on a follow-up UpdateLocationType landing. That call
// discarded its error, one line above a sibling call that returns 500 for the
// same class of failure, so a storage failure answered 201 with the location
// silently left a house. The response carries only id and account_id, so
// nothing would contradict the caller until the console showed the wrong kind
// of place.
//
// Asserted by READING THE TYPE BACK rather than trusting the 201: the status
// was never the thing at risk.
//
// Two mutations, because the two failures are different and only one of them
// this test can see directly:
//
//	handler passes "house" instead of req.Type → "the follow-up update did not land"
//	the UPDATE matches no row                  → "create complex: 500"
//
// The second lands on the CREATE assertion rather than the type one, and that
// is the fix rather than a gap: a storage failure is now loud. Before it, the
// same mutation produced a 201 and a location quietly left a house.
func TestANewAccountsAnchorGetsTheRequestedType(t *testing.T) {
	h, _ := newTestServerWithStore(t, "")
	access, _ := register(t, h, "loctype@op.com")

	for _, want := range []string{"complex", "building", "other"} {
		rec, out := doJSON(t, h, "POST", "/v1/locations", access, map[string]any{
			"name": "Place " + want, "type": want, "country_code": "ZA",
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create %s: %d %s", want, rec.Code, rec.Body)
		}
		locID, _ := out["id"].(string)
		acctID, _ := out["account_id"].(string)
		if locID == "" || acctID == "" {
			t.Fatalf("no location/account id in %s", rec.Body)
		}

		rec, listOut := doJSON(t, h, "GET", "/v1/accounts/"+acctID+"/locations", access, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d", rec.Code)
		}
		got := ""
		for _, l := range listOut["locations"].([]any) {
			m := l.(map[string]any)
			if m["id"] == locID {
				got, _ = m["type"].(string)
			}
		}
		if got != want {
			t.Errorf("anchor type is %q, want %q — the account was created as a house "+
				"and the follow-up update did not land", got, want)
		}
	}

	// The premise: "house" is what CreateAccountWithOwner makes on its own, so
	// a run where every type came back "house" would pass the loop above only
	// if the loop were empty. Assert the default explicitly.
	rec, out := doJSON(t, h, "POST", "/v1/locations", access, map[string]any{
		"name": "Plain", "country_code": "ZA",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create default: %d %s", rec.Code, rec.Body)
	}
	defID := out["id"].(string)
	defAcct := out["account_id"].(string)
	_, listOut := doJSON(t, h, "GET", "/v1/accounts/"+defAcct+"/locations", access, nil)
	for _, l := range listOut["locations"].([]any) {
		m := l.(map[string]any)
		if m["id"] == defID && m["type"] != "house" {
			t.Errorf("a request with no type produced %v, want house", m["type"])
		}
	}
}
