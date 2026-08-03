package httpapi

import (
	"context"
	"net/http"
	"testing"
)

// The occupancy-disclosure switch's HTTP surface, both handlers at 0%.
//
// The enforcement side is covered: store/disclosure_test.go exercises
// OccupancyDisclosureLocations, which is what the chat path calls, and
// channels_query.go carries the scar of an end-to-end test that caught an
// earlier version where the switch did nothing. What had no test was the
// console surface that operates it — the GET that reports the position and the
// PATCH that moves it.
//
// That matters more here than for an ordinary setting. The row's PRESENCE is
// the enabled state, so turning the switch off is a DELETE rather than a column
// write. A setter that wrote a column instead would leave every location
// disclosing after an admin turned it off, and the console would show "off"
// while the chat rail kept answering — the switch and the thing it switches
// disagreeing, with the operator reading the reassuring half.

func disclosureFixture(t *testing.T) (h http.Handler, adminA, memberA, adminB, locA string) {
	t.Helper()
	h, st := newTestServerWithStore(t, "")
	adminA, _ = register(t, h, "owner-a@disc.test")
	adminB, _ = register(t, h, "owner-b@disc.test")
	acctA, locA := tenantIDs(t, h, adminA)
	_, _ = tenantIDs(t, h, adminB)
	_, memberA = inviteMember(t, h, st, adminA, acctA, "member-a@disc.test", "+27000000501")
	return h, adminA, memberA, adminB, locA
}

// A plain member may READ the switch but may not move it.
//
// Reading is deliberate: the GET returns who enabled it and when, and a privacy
// control that only admins can see the state of is one the people it affects
// cannot check. Moving it is an admin act, for the reason the file's doc gives
// — enabling it is something somebody should be able to be held to later, not a
// preference.
func TestAPlainMemberCanReadTheDisclosureSwitchButNotMoveIt(t *testing.T) {
	h, _, memberA, _, locA := disclosureFixture(t)

	rec, body := doJSON(t, h, "GET", "/v1/locations/"+locA+"/disclosure", memberA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("member GET: %d, want 200 — the people a disclosure setting affects "+
			"must be able to see its position", rec.Code)
	}
	if body["occupancy"] != false {
		t.Errorf("a location that has never been configured reports occupancy=%v; the "+
			"default must be OFF, or every fresh location discloses until someone notices",
			body["occupancy"])
	}

	rec, _ = doJSON(t, h, "PATCH", "/v1/locations/"+locA+"/disclosure", memberA,
		map[string]any{"occupancy": true})
	if rec.Code != http.StatusForbidden {
		t.Errorf("member PATCH: %d, want 403 — any member could otherwise consent, on "+
			"behalf of everyone in the building, to occupancy questions being answered",
			rec.Code)
	}
}

// Someone with no membership of the location's account reaches neither handler.
func TestAnOutsiderReachesNeitherDisclosureHandler(t *testing.T) {
	h, _, _, adminB, locA := disclosureFixture(t)

	rec, _ := doJSON(t, h, "GET", "/v1/locations/"+locA+"/disclosure", adminB, nil)
	if rec.Code == http.StatusOK {
		t.Error("an owner of another account read this location's disclosure state")
	}
	rec, _ = doJSON(t, h, "PATCH", "/v1/locations/"+locA+"/disclosure", adminB,
		map[string]any{"occupancy": true})
	if rec.Code == http.StatusOK {
		t.Error("an owner of another account moved this location's disclosure switch")
	}
}

// The switch an admin sets is the switch the chat path reads — in both
// directions.
//
// This is the assertion the feature exists for, and it deliberately crosses the
// two halves rather than checking the handler against itself. The console
// writes through SetOccupancyDisclosure; the chat rail reads through
// OccupancyDisclosureLocations, which is a different query against the same
// table. Turning the switch OFF is a DELETE, so a regression there is not a
// wrong value but a row that never goes away, and only asking the READER can
// see it.
func TestTurningTheSwitchOffChangesWhatTheChatPathReads(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	admin, _ := register(t, h, "owner@disc2.test")
	_, loc := tenantIDs(t, h, admin)
	ctx := context.Background()

	readAsChatPath := func() bool {
		t.Helper()
		m, err := st.OccupancyDisclosureLocations(ctx, []string{loc})
		if err != nil {
			t.Fatal(err)
		}
		return m[loc]
	}

	if readAsChatPath() {
		t.Fatal("a location discloses occupancy before anyone enabled it")
	}

	rec, _ := doJSON(t, h, "PATCH", "/v1/locations/"+loc+"/disclosure", admin,
		map[string]any{"occupancy": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("admin enable: %d, want 200", rec.Code)
	}
	if !readAsChatPath() {
		t.Fatal("the admin enabled disclosure and the chat path still refuses; the " +
			"console switch and the gate it operates are looking at different state")
	}

	// And the half that a column-write regression would break.
	rec, _ = doJSON(t, h, "PATCH", "/v1/locations/"+loc+"/disclosure", admin,
		map[string]any{"occupancy": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("admin disable: %d, want 200", rec.Code)
	}
	if readAsChatPath() {
		t.Fatal("the admin turned disclosure OFF and the chat path still discloses. " +
			"The console would report it off while occupancy questions kept being " +
			"answered, which is the worst arrangement of the two.")
	}
	// The console agrees.
	_, body := doJSON(t, h, "GET", "/v1/locations/"+loc+"/disclosure", admin, nil)
	if body["occupancy"] != false {
		t.Errorf("GET reports occupancy=%v after it was turned off", body["occupancy"])
	}
	if _, present := body["enabled_by"]; present {
		t.Error("the cleared switch still reports who enabled it; the consent record " +
			"should be gone, not stale")
	}
}

// Enabling records who and when, and both directions are audited with distinct
// actions.
//
// The consent row answers "who turned this on"; the admin-audit entry is the
// tamper-evident copy, and it has to distinguish enable from disable — a
// disclosure that was available for a period and then withdrawn is a fact about
// what could have been asked during that period, and one action name for both
// would lose it.
func TestEnablingRecordsWhoAndWhenAndBothDirectionsAreAudited(t *testing.T) {
	h, st := newTestServerWithStore(t, "")
	admin, _ := register(t, h, "owner@disc3.test")
	_, loc := tenantIDs(t, h, admin)
	ctx := context.Background()

	if rec, _ := doJSON(t, h, "PATCH", "/v1/locations/"+loc+"/disclosure", admin,
		map[string]any{"occupancy": true}); rec.Code != http.StatusOK {
		t.Fatalf("enable: %d", rec.Code)
	}
	_, body := doJSON(t, h, "GET", "/v1/locations/"+loc+"/disclosure", admin, nil)
	if body["enabled_by"] == nil {
		t.Error("no enabled_by after enabling; a privacy control that cannot say who " +
			"turned it on is not auditable")
	}
	if body["enabled_at"] == nil {
		t.Error("no enabled_at after enabling")
	}

	if rec, _ := doJSON(t, h, "PATCH", "/v1/locations/"+loc+"/disclosure", admin,
		map[string]any{"occupancy": false}); rec.Code != http.StatusOK {
		t.Fatalf("disable: %d", rec.Code)
	}

	actions := map[string]int{}
	rows, err := st.DB().QueryContext(ctx,
		`SELECT action FROM admin_audit_log WHERE target_id = ? AND target_kind = 'location'`, loc)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			t.Fatal(err)
		}
		actions[a]++
	}
	if actions["occupancy_disclosure_enable"] != 1 {
		t.Errorf("enable audited %d times, want 1 (all: %v)", actions["occupancy_disclosure_enable"], actions)
	}
	if actions["occupancy_disclosure_disable"] != 1 {
		t.Errorf("disable audited %d times, want 1 — withdrawing a disclosure is as much "+
			"a fact as granting it (all: %v)", actions["occupancy_disclosure_disable"], actions)
	}
}

// A body with no occupancy field is refused rather than read as false.
//
// `{}` meaning "turn it off" would let a client that forgot the field silently
// withdraw consent, and the zero value of a *bool is exactly what makes that
// possible to get wrong.
func TestAMissingOccupancyFieldIsRefusedRatherThanReadAsOff(t *testing.T) {
	h, _ := newTestServerWithStore(t, "")
	admin, _ := register(t, h, "owner@disc4.test")
	_, loc := tenantIDs(t, h, admin)

	if rec, _ := doJSON(t, h, "PATCH", "/v1/locations/"+loc+"/disclosure", admin,
		map[string]any{"occupancy": true}); rec.Code != http.StatusOK {
		t.Fatalf("enable: %d", rec.Code)
	}
	rec, _ := doJSON(t, h, "PATCH", "/v1/locations/"+loc+"/disclosure", admin, map[string]any{})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("PATCH with an empty body: %d, want 400", rec.Code)
	}
	_, body := doJSON(t, h, "GET", "/v1/locations/"+loc+"/disclosure", admin, nil)
	if body["occupancy"] != true {
		t.Error("an empty body switched disclosure off")
	}
}
