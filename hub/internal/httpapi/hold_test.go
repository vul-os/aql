package httpapi

// A hold is an open that lasts, and the whole risk is forgetting that.
//
// `hold` leaves a gate standing open until the controller's hold_max releases
// it. Every gate that refuses an open must therefore refuse a hold — a
// suspended account, a disabled user, an exhausted quota, a closed time
// window, a phone outside its geofence. The alternative is a permission that
// cannot open a gate but can hold one open, which is a strictly worse version
// of the same permission and would look like a working refusal in every test
// that only tried `open`.
//
// store.LogAccess routes both through opensTheWay for exactly that reason.
// These tests exist because that function is one word away from being wrong in
// a way nothing else would notice: widening the allowed-command list without
// widening the denial branches lets `hold` through every one of them.

import (
	"net/http"
	"testing"
)

func TestHoldIsRefusedEverywhereAnOpenIsRefused(t *testing.T) {
	h, st := newTestServerWithStore(t, "op-token")
	adminAccess := claimAdmin(t, h, "op@hold.com")
	access, _ := register(t, h, "resident@hold.com")
	acct, _ := tenantIDs(t, h, access)
	ap := firstAccessPoint(t, h, access, acct)

	// Baseline: a hold works before any denial applies. Only one call — a
	// second would hit the per-access-point open cooldown, which `hold` shares
	// (see TestHoldSharesTheOpenCooldown, where that is the point rather than
	// an obstacle).
	if rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
		map[string]any{"source": "web"}); rec.Code != http.StatusOK {
		t.Fatalf("fixture: hold refused before any denial applied: %d %v", rec.Code, out)
	}

	// Suspend the account. `open` is denied; `hold` must be denied for the
	// same reason and with the same status.
	if _, err := st.SetAccountStatus(t.Context(), acct, "suspended"); err != nil {
		t.Fatal(err)
	}
	_ = adminAccess

	openRec, openOut := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/open", access,
		map[string]any{"source": "web"})
	holdRec, holdOut := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
		map[string]any{"source": "web"})

	if openRec.Code == http.StatusOK {
		t.Fatal("fixture: a suspended account could still open; the denial under test did not fire")
	}
	if holdRec.Code != openRec.Code || holdOut["error"] != openOut["error"] {
		t.Fatalf(`hold answered %d %v where open answered %d %v.

A gate that cannot be opened but can be HELD open is a worse version of the
same permission. Every denial in the open path has to cover both, which is what
store.LogAccess's opensTheWay is for — widening the allowed-command list
without widening the denial branches produces exactly this.`,
			holdRec.Code, holdOut, openRec.Code, openOut)
	}
}

// `close` must stay the safe direction. Someone who got in has to be able to
// get out, and a hold's denial must not accidentally have been implemented by
// denying everything that is not `open`.
func TestCloseStaysAllowedWhileHoldIsDenied(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	access, _ := register(t, h, "resident@close.com")
	acct, _ := tenantIDs(t, h, access)
	ap := firstAccessPoint(t, h, access, acct)

	if _, err := st.SetAccountStatus(t.Context(), acct, "suspended"); err != nil {
		t.Fatal(err)
	}
	if rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
		map[string]any{"source": "web"}); rec.Code == http.StatusOK {
		t.Fatalf("hold succeeded on a suspended account: %d %v", rec.Code, out)
	}
	if rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/close", access,
		map[string]any{"source": "web"}); rec.Code != http.StatusOK {
		t.Errorf(`close was denied on a suspended account: %d %v

close is the safe direction and is never denied — the person inside has to be
able to leave. If adding hold made this fail, the denial was written as "not
open" rather than "opens the way".`, rec.Code, out)
	}
}

// The duration is bounded by this API before it is bounded by the controller,
// so a client typo is refused with a number rather than silently capped
// somewhere the caller cannot see.
func TestHoldDurationIsBounded(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "resident@dur.com")
	acct, _ := tenantIDs(t, h, access)
	ap := firstAccessPoint(t, h, access, acct)

	for _, secs := range []int64{-1, maxHoldSeconds + 1, 86400} {
		rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
			map[string]any{"source": "web", "seconds": secs})
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_hold_seconds" {
			t.Errorf("seconds=%d accepted: %d %v", secs, rec.Code, out)
		}
		if out["max"] == nil {
			t.Errorf("seconds=%d refusal does not name the bound: %v", secs, out)
		}
	}

	// Omitted means "the controller's own hold_max", which is the honest
	// default — the hub does not know what that site was configured with.
	// One accepted call only: the cooldown is real and shared.
	if rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
		map[string]any{"source": "web"}); rec.Code != http.StatusOK {
		t.Errorf("a hold with no duration was refused: %d %v", rec.Code, out)
	}
}

// The per-access-point open cooldown applies to holds, and to the two
// interchangeably. Found by writing a test that did an open and a hold
// back-to-back and being rate-limited — which is the correct answer: a hold
// that had its own separate budget would let someone alternate open/hold and
// double their allowance through a gate.
func TestHoldSharesTheOpenCooldown(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "resident@cool.com")
	acct, _ := tenantIDs(t, h, access)
	ap := firstAccessPoint(t, h, access, acct)

	if rec, _ := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/open", access,
		map[string]any{"source": "web"}); rec.Code != http.StatusOK {
		t.Fatal("fixture: the first open was refused")
	}
	rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
		map[string]any{"source": "web"})
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf(`a hold immediately after an open was allowed: %d %v

It must draw on the same budget. A separate one would let someone alternate
open and hold to get through twice as often as either alone permits.`, rec.Code, out)
	}
}

// The audit row says `hold`, not `open`. A reader has to be able to tell that
// a gate was left standing open rather than pulsed.
func TestHoldIsAuditedAsAHold(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	access, _ := register(t, h, "resident@audit.com")
	acct, _ := tenantIDs(t, h, access)
	ap := firstAccessPoint(t, h, access, acct)

	if rec, _ := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/hold", access,
		map[string]any{"source": "web", "seconds": 60}); rec.Code != http.StatusOK {
		t.Fatal("hold failed")
	}
	logs, err := st.AccessLogsByAccount(t.Context(), acct, 20)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, l := range logs {
		if l.Command == "hold" {
			found = true
		}
	}
	if !found {
		t.Error("no `hold` row in the access log; a hold recorded as an open loses the " +
			"one fact that distinguishes it")
	}
}

// firstAccessPoint returns the account's anchor access point, creating one if
// the fixture did not.
func firstAccessPoint(t *testing.T, h http.Handler, access, accountID string) string {
	t.Helper()
	_, out := doJSON(t, h, "GET", "/v1/access-points?account_id="+accountID, access, nil)
	if aps, _ := out["access_points"].([]any); len(aps) > 0 {
		return aps[0].(map[string]any)["id"].(string)
	}
	_, locOut := doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/locations", access, nil)
	locs, _ := locOut["locations"].([]any)
	if len(locs) == 0 {
		t.Fatal("no location to attach an access point to")
	}
	locID := locs[0].(map[string]any)["id"].(string)
	rec, apOut := doJSON(t, h, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locID, "name": "Front gate", "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create access point: %d %s", rec.Code, rec.Body)
	}
	return apOut["id"].(string)
}
