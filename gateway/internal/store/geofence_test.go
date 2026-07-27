package store

import (
	"context"
	"errors"
	"math"
	"testing"
)

// ---------------------------------------------------------------------------
// Distance — the cases where naive implementations are wrong
// ---------------------------------------------------------------------------

// The antimeridian. Two points 220-ish metres apart either side of 180 degrees
// longitude are NEAR each other. A `long2 - long1` subtraction says they are
// ~40 000 km apart, which would deny a resident of Fiji at their own gate
// forever, and — worse — would ALLOW an antipodal pair that the same bug
// measures as adjacent.
func TestHaversineAcrossAntimeridian(t *testing.T) {
	// 0.001 degrees of longitude at the equator is ~111.3 m; the pair spans
	// 0.002 degrees, so ~222 m.
	d := HaversineM(0, 179.999, 0, -179.999)
	if d < 200 || d > 250 {
		t.Errorf("across the antimeridian = %.1f m, want ~222 m", d)
	}
	// The same span not crossing the line must measure the same.
	ref := HaversineM(0, 0.001, 0, -0.001)
	if math.Abs(d-ref) > 1 {
		t.Errorf("antimeridian %.3f m vs equivalent span %.3f m — the wrap must not matter", d, ref)
	}
	// And the genuinely far pair is still far: +90 and -90 longitude on the
	// equator is a quarter of the way round.
	if far := HaversineM(0, 90, 0, -90); far < 19e6 {
		t.Errorf("half the equator = %.0f m, want ~2e7", far)
	}
}

// The poles. Longitude converges to a point at 90 degrees, so any formula that
// scales by cos(lat) or divides by it degenerates. Two points a hair from the
// north pole on OPPOSITE meridians are metres apart, not thousands of
// kilometres.
func TestHaversineAtThePoles(t *testing.T) {
	// 89.9999 N on 0 and on 180: the great circle runs over the pole, so the
	// distance is 2 * 0.0001 degrees of latitude ~= 22 m.
	d := HaversineM(89.9999, 0, 89.9999, 180)
	if d < 15 || d > 30 {
		t.Errorf("over the pole = %.2f m, want ~22 m", d)
	}
	// Exactly at the pole, longitude is meaningless: every longitude is the
	// same point. The answer must be zero to within floating point (cos(pi/2)
	// is not exactly 0 in binary), and above all not NaN.
	if d := HaversineM(90, 0, 90, 137); math.IsNaN(d) || d > 1e-6 {
		t.Errorf("the north pole is one place: %v", d)
	}
	if d := HaversineM(-90, 0, -90, -45); math.IsNaN(d) || d > 1e-6 {
		t.Errorf("the south pole is one place: %v", d)
	}
	// Antipodal: half the circumference, and NOT NaN — the clamp in
	// HaversineM exists precisely so a rounding overshoot past a==1 cannot
	// produce a NaN, which would compare false against every threshold and
	// turn a denial into an allow.
	anti := HaversineM(90, 0, -90, 0)
	if math.IsNaN(anti) || anti < 19.9e6 || anti > 20.1e6 {
		t.Errorf("pole to pole = %v, want ~2.0015e7", anti)
	}
	// Identical points are 0, not a NaN from sqrt(-epsilon).
	if d := HaversineM(-26.2041, 28.0473, -26.2041, 28.0473); d != 0 {
		t.Errorf("a point is zero metres from itself: %v", d)
	}
}

// A sanity anchor against a known real-world distance: Johannesburg to Cape
// Town is ~1 260 km great-circle.
func TestHaversineKnownDistance(t *testing.T) {
	d := HaversineM(-26.2041, 28.0473, -33.9249, 18.4241)
	if d < 1.25e6 || d > 1.28e6 {
		t.Errorf("JNB->CPT = %.0f m, want ~1.26e6", d)
	}
}

func TestValidateGeofenceRuleRefusesNonsense(t *testing.T) {
	bad := []struct {
		name                     string
		lat, long, radius, slack float64
		onMissing                string
	}{
		{"latitude past the pole", 91, 0, 100, 75, GeofenceOnMissingDeny},
		{"longitude past the line", 0, 181, 100, 75, GeofenceOnMissingDeny},
		{"NaN anchor", math.NaN(), 0, 100, 75, GeofenceOnMissingDeny},
		{"infinite anchor", 0, math.Inf(1), 100, 75, GeofenceOnMissingDeny},
		{"zero radius", 0, 0, 0, 75, GeofenceOnMissingDeny},
		{"negative radius", 0, 0, -100, 75, GeofenceOnMissingDeny},
		{"radius under the floor", 0, 0, MinGeofenceRadiusM - 1, 75, GeofenceOnMissingDeny},
		{"radius over the cap", 0, 0, MaxGeofenceRadiusM + 1, 75, GeofenceOnMissingDeny},
		{"NaN radius", 0, 0, math.NaN(), 75, GeofenceOnMissingDeny},
		{"negative slack", 0, 0, 100, -1, GeofenceOnMissingDeny},
		{"slack over the cap", 0, 0, 100, MaxGeofenceSlackM + 1, GeofenceOnMissingDeny},
		{"NaN slack", 0, 0, 100, math.NaN(), GeofenceOnMissingDeny},
		{"unset missing-location policy", 0, 0, 100, 75, ""},
		{"unrecognised missing-location policy", 0, 0, 100, 75, "maybe"},
	}
	for _, c := range bad {
		if err := ValidateGeofenceRule(c.lat, c.long, c.radius, c.slack, c.onMissing); !errors.Is(err, ErrInvalidGeofenceRule) {
			t.Errorf("%s: want ErrInvalidGeofenceRule, got %v", c.name, err)
		}
	}
	// The legal forms still pass, including zero slack (forgive nothing) and
	// the exact bounds.
	for _, c := range []struct {
		name                     string
		lat, long, radius, slack float64
	}{
		{"typical", -26.2041, 28.0473, 200, DefaultGeofenceSlackM},
		{"zero slack", 0, 0, MinGeofenceRadiusM, 0},
		{"at the caps", -90, 180, MaxGeofenceRadiusM, MaxGeofenceSlackM},
	} {
		if err := ValidateGeofenceRule(c.lat, c.long, c.radius, c.slack, GeofenceOnMissingAllow); err != nil {
			t.Errorf("%s: legal rule refused: %v", c.name, err)
		}
	}
}

// ---------------------------------------------------------------------------
// The choke point
// ---------------------------------------------------------------------------

// The fixture's gate. Johannesburg, because the numbers below were computed
// against a real latitude rather than the equator, where a degree of longitude
// is conveniently but unrepresentatively wide.
const (
	gateLat  = -26.2041
	gateLong = 28.0473
)

func f64(v float64) *float64 { return &v }

// offsetNorth returns a point metresNorth metres due north of the gate. Due
// north so the conversion is exact regardless of latitude: one degree of
// latitude is 1/360th of a meridian everywhere.
func offsetNorth(metresNorth float64) (lat, long float64) {
	return gateLat + (metresNorth/earthRadiusM)*(180/math.Pi), gateLong
}

func addGeofence(t *testing.T, f *openFixture, apID, locID string, radiusM float64, slackM *float64, onMissing string) *GeofenceRule {
	t.Helper()
	r, err := f.s.CreateGeofenceRule(context.Background(), f.acct.ID, CreateGeofenceRuleArgs{
		AccessPointID: apID, LocationID: locID,
		Lat: f64(gateLat), Long: f64(gateLong),
		RadiusM: radiusM, SlackM: slackM, OnMissingLocation: onMissing,
		Note: "test fence", CreatedByUserID: f.owner.ID,
	})
	if err != nil {
		t.Fatalf("CreateGeofenceRule: %v", err)
	}
	return r
}

// openFrom is f.open with a claimed position attached.
func (f *openFixture) openFrom(t *testing.T, userID string, lat, long *float64) *LogAccessResult {
	t.Helper()
	res, err := f.s.LogAccess(context.Background(), f.cfg, LogAccessArgs{
		UserID: userID, AccessPointID: f.ap.ID, Command: "open", Source: "web",
		Lat: lat, Long: long,
	})
	if err != nil {
		t.Fatalf("LogAccess: %v", err)
	}
	return res
}

// THE DEFAULT. An install that does not use this feature must be bit-for-bit
// unaffected by its existence: no rule, no restriction, no extra denial — with
// a position, without one, from anywhere on the planet.
func TestOpenPathNoGeofenceRuleMeansNoRestriction(t *testing.T) {
	f := newOpenFixture(t)
	m := f.addMember(t, "nofence@open.com")
	cases := []struct {
		name      string
		lat, long *float64
	}{
		{"no position at all", nil, nil},
		{"at the gate", f64(gateLat), f64(gateLong)},
		{"the other side of the planet", f64(26.2041), f64(-151.9527)},
		{"garbage coordinates", f64(999), f64(-999)},
	}
	for _, c := range cases {
		if res := f.openFrom(t, m.ID, c.lat, c.long); !res.Allowed || res.Reason != "" {
			t.Fatalf("%s with no rule stored: %+v", c.name, res)
		}
	}
	// And nothing was written to the rules table by merely opening.
	var n int
	if err := f.s.db.QueryRow(`SELECT count(*) FROM geofence_rules`).Scan(&n); err != nil || n != 0 {
		t.Errorf("the open path must not write rules: %d %v", n, err)
	}
}

// THE HEADLINE CASE, and the reason slack_m exists. A phone standing AT the
// gate reports a position 120 m off — utterly ordinary against a building or
// on a wifi-only fix. A hard cutoff at exactly radius_m refuses that person,
// which is how a safety feature gets switched off for good. The fence is
// radius + slack, so they get in; someone genuinely down the road does not.
func TestOpenPathGeofenceForgivesGPSErrorButNotDistance(t *testing.T) {
	f := newOpenFixture(t)
	m := f.addMember(t, "atthegate@open.com")
	// 50 m radius, default 75 m slack -> the fence actually tests 125 m.
	rule := addGeofence(t, f, f.ap.ID, "", 50, nil, GeofenceOnMissingDeny)
	if rule.AllowanceM() != 50+DefaultGeofenceSlackM {
		t.Fatalf("allowance = %v, want %v", rule.AllowanceM(), 50+DefaultGeofenceSlackM)
	}

	// 120 m out: OUTSIDE the 50 m radius, INSIDE the accuracy band. Allowed.
	lat, long := offsetNorth(120)
	if res := f.openFrom(t, m.ID, f64(lat), f64(long)); !res.Allowed {
		t.Fatalf("a phone at the gate reporting a 120 m error was refused by a 50 m + 75 m fence: %+v", res)
	}
	// 200 m out: past radius + slack. Refused.
	lat, long = offsetNorth(200)
	res := f.openFrom(t, m.ID, f64(lat), f64(long))
	if res.Allowed || res.Reason != ReasonOutsideGeofence {
		t.Fatalf("200 m from a 125 m fence must be refused: %+v", res)
	}

	// A rule that forgives nothing is expressible, and 0 is not silently
	// replaced by the default.
	f2 := newOpenFixture(t)
	m2 := f2.addMember(t, "strict@open.com")
	strict := addGeofence(t, f2, f2.ap.ID, "", 50, f64(0), GeofenceOnMissingDeny)
	if strict.SlackM != 0 {
		t.Fatalf("explicit zero slack was replaced by the default: %v", strict.SlackM)
	}
	lat, long = offsetNorth(120)
	if res := f2.openFrom(t, m2.ID, f64(lat), f64(long)); res.Allowed {
		t.Error("with zero slack, 120 m from a 50 m fence must be refused")
	}
}

// A geofence denial is audited, with a reason distinguishable from a rate
// limit, a quota and a time window — and it consumes no counter, because it
// runs before the limit block.
func TestOpenPathOutsideGeofenceDeniesAndAudits(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "faraway@open.com")
	addGeofence(t, f, f.ap.ID, "", 200, nil, GeofenceOnMissingDeny)

	res := f.openFrom(t, m.ID, f64(-33.9249), f64(18.4241)) // Cape Town
	if res.Allowed || res.Reason != ReasonOutsideGeofence {
		t.Fatalf("an open from 1 260 km away: %+v", res)
	}
	for _, other := range []string{"rate_limited", "quota_exceeded", ReasonOutsideTimeWindow} {
		if res.Reason == other {
			t.Fatalf("a geofence denial must not be reported as %s", other)
		}
	}
	// No retry-after: waiting does not move you.
	if res.RetryAfterS != 0 {
		t.Errorf("a geofence denial has no retry-after, got %d", res.RetryAfterS)
	}
	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 10)
	if err != nil || len(logs) != 1 || logs[0].Success || logs[0].Error != ReasonOutsideGeofence {
		t.Fatalf("denial audit: %v %+v", err, logs)
	}
	var n int
	if err := f.s.db.QueryRow(
		`SELECT count(*) FROM rate_limit_counters WHERE subject = ?`, "user:"+m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("a geofence denial consumed %d rate-limit counter rows; denials must never consume", n)
	}
}

// ABSENT LOCATION IS A DECISION. The default is deny — a fence any caller can
// switch off by omitting a field is not a fence — and 'allow' is available for
// the operator who needs the chat rails (which send no coordinates at all) to
// keep working, with the honest weaker guarantee that goes with it.
func TestOpenPathGeofenceMissingLocationIsAnExplicitChoice(t *testing.T) {
	ctx := context.Background()

	// Default: deny, with its own reason.
	f := newOpenFixture(t)
	m := f.addMember(t, "nogps@open.com")
	addGeofence(t, f, f.ap.ID, "", 200, nil, "") // "" -> deny
	res := f.openFrom(t, m.ID, nil, nil)
	if res.Allowed || res.Reason != ReasonGeofenceLocationRequired {
		t.Fatalf("no coordinates with a deny rule: %+v", res)
	}
	if res.Reason == ReasonOutsideGeofence {
		t.Fatal("'you did not say where you are' and 'you are not there' are different facts")
	}
	logs, _ := f.s.AccessLogsByAccount(ctx, f.acct.ID, 1)
	if len(logs) != 1 || logs[0].Error != ReasonGeofenceLocationRequired {
		t.Errorf("denial not audited with its own reason: %+v", logs)
	}
	// A half-position is no position: one coordinate alone cannot be tested,
	// and must not be treated as (lat, 0) somewhere off the coast of Ghana.
	if res := f.openFrom(t, m.ID, f64(gateLat), nil); res.Allowed || res.Reason != ReasonGeofenceLocationRequired {
		t.Errorf("lat with no long: %+v", res)
	}
	// Nor is an impossible one. Garbage folds into "unknown" and the rule's
	// own declared policy decides, rather than getting a third, unconfigured
	// behaviour of its own.
	for _, c := range [][2]float64{{999, -999}, {math.NaN(), 0}, {math.Inf(1), math.Inf(-1)}} {
		if res := f.openFrom(t, m.ID, f64(c[0]), f64(c[1])); res.Allowed || res.Reason != ReasonGeofenceLocationRequired {
			t.Errorf("impossible coordinates %v: %+v", c, res)
		}
	}

	// Opted in to 'allow': the same request passes, because the operator said
	// so in advance and can see that they did.
	f2 := newOpenFixture(t)
	m2 := f2.addMember(t, "chatrail@open.com")
	r := addGeofence(t, f2, f2.ap.ID, "", 200, nil, GeofenceOnMissingAllow)
	if r.OnMissingLocation != GeofenceOnMissingAllow {
		t.Fatalf("stored policy = %q", r.OnMissingLocation)
	}
	if res := f2.openFrom(t, m2.ID, nil, nil); !res.Allowed {
		t.Fatalf("an allow-on-missing rule must let a positionless open through: %+v", res)
	}
	// ...but it is still a fence for anyone who DOES report a position.
	if res := f2.openFrom(t, m2.ID, f64(-33.9249), f64(18.4241)); res.Allowed || res.Reason != ReasonOutsideGeofence {
		t.Errorf("allow-on-missing must not disable the fence itself: %+v", res)
	}
}

// close is NEVER geofence-restricted. Someone who got in must be able to get
// out, wherever their phone thinks they are — the same guarantee close already
// has against rate limits, quotas and time windows.
func TestOpenPathCloseIsNeverGeofenced(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "inside@fence.com")
	addGeofence(t, f, f.ap.ID, "", 50, f64(0), GeofenceOnMissingDeny)

	// Precondition: an open from Cape Town is refused.
	if res := f.openFrom(t, m.ID, f64(-33.9249), f64(18.4241)); res.Allowed {
		t.Fatal("precondition: the open must be denied")
	}
	// The same coordinates on a close: allowed.
	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: f.ap.ID, Command: "close", Source: "web",
		Lat: f64(-33.9249), Long: f64(18.4241),
	})
	if err != nil || !res.Allowed || res.Reason != "" {
		t.Fatalf("close from outside the fence must be allowed: %v %+v", err, res)
	}
	// ...and with no position at all, which a deny-on-missing rule would
	// otherwise refuse.
	res, err = f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: f.ap.ID, Command: "close", Source: "whatsapp",
	})
	if err != nil || !res.Allowed {
		t.Fatalf("close with no coordinates must be allowed: %v %+v", err, res)
	}
	logs, _ := f.s.AccessLogsByAccount(ctx, f.acct.ID, 10)
	closes := 0
	for _, l := range logs {
		if l.Command == "close" && l.Success {
			closes++
		}
	}
	if closes != 2 {
		t.Errorf("both closes should be in the audit trail as successes, found %d", closes)
	}
}

// A stored rule whose numbers are unusable DENIES and says so. It is never
// skipped: skipping is how a corrupt row becomes an unrestricted open. Rows
// are written straight to SQLite here because the write path refuses them —
// which is the point: this covers hand-edited databases and downgrades.
func TestOpenPathUnparseableGeofenceFailsClosed(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "brokenfence@open.com")

	// The table's own CHECK constraints refuse every row below, which is the
	// belt to Go's braces and exactly what should happen through the write
	// path. They are suspended here for the same reason this test exists: the
	// rows a fail-closed path has to survive are the ones that got in ANOTHER
	// way — a hand edit with the sqlite3 shell, a restored backup from before
	// a constraint existed, a downgrade. The evaluator must not assume the
	// schema was enforcing anything.
	if _, err := f.s.db.Exec(`PRAGMA ignore_check_constraints = 1`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.s.db.Exec(`PRAGMA ignore_check_constraints = 0`) })

	insert := func(lat, long, radius, slack float64, onMissing string) {
		t.Helper()
		if _, err := f.s.db.Exec(
			`INSERT INTO geofence_rules (id, account_id, access_point_id, anchor_lat, anchor_long,
			   radius_m, slack_m, on_missing_location, note, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
			NewID(), f.acct.ID, f.ap.ID, lat, long, radius, slack, onMissing, now(), now()); err != nil {
			t.Fatal(err)
		}
	}
	clear := func() {
		t.Helper()
		if _, err := f.s.db.Exec(`DELETE FROM geofence_rules`); err != nil {
			t.Fatal(err)
		}
	}

	for _, c := range []struct {
		name                     string
		lat, long, radius, slack float64
		onMissing                string
	}{
		{"radius of zero", gateLat, gateLong, 0, 75, GeofenceOnMissingDeny},
		{"negative radius", gateLat, gateLong, -100, 75, GeofenceOnMissingDeny},
		{"anchor past the pole", 91, gateLong, 200, 75, GeofenceOnMissingDeny},
		{"slack past the cap", gateLat, gateLong, 200, MaxGeofenceSlackM + 1, GeofenceOnMissingDeny},
		{"unrecognised missing-location policy", gateLat, gateLong, 200, 75, "sometimes"},
	} {
		clear()
		insert(c.lat, c.long, c.radius, c.slack, c.onMissing)
		// Fails closed even when the request is standing exactly on the anchor.
		res := f.openFrom(t, m.ID, f64(gateLat), f64(gateLong))
		if res.Allowed || res.Reason != ReasonGeofenceInvalid {
			t.Errorf("%s: want %s, got %+v", c.name, ReasonGeofenceInvalid, res)
		}
		logs, _ := f.s.AccessLogsByAccount(ctx, f.acct.ID, 1)
		if len(logs) != 1 || logs[0].Error != ReasonGeofenceInvalid {
			t.Errorf("%s: denial not audited with its own reason: %+v", c.name, logs)
		}
	}

	// A broken rule denies even when a SECOND, well-formed rule would have
	// allowed the request on its missing-location setting. "One of your
	// fences is unreadable" is the fact the operator needs.
	clear()
	insert(gateLat, gateLong, 0, 75, GeofenceOnMissingDeny) // broken, on the AP
	addGeofence(t, f, "", f.loc.ID, 200, nil, GeofenceOnMissingAllow)
	if res := f.openFrom(t, m.ID, nil, nil); res.Allowed || res.Reason != ReasonGeofenceInvalid {
		t.Errorf("a broken rule must not be skipped in favour of a permissive one: %+v", res)
	}

	// ...and close still gets out, with a broken rule in the table.
	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: f.ap.ID, Command: "close", Source: "web",
	})
	if err != nil || !res.Allowed {
		t.Errorf("close must survive a broken rule: %v %+v", err, res)
	}
}

// A fence binds to ONE target, and an access-point rule composes with a
// location rule by AND — adding a rule can only ever NARROW.
func TestOpenPathGeofenceRulesNarrowNeverWiden(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "narrowfence@open.com")

	// Site-wide: a generous 5 km fence. A position 1 km north is inside it.
	addGeofence(t, f, "", f.loc.ID, 5000, nil, GeofenceOnMissingDeny)
	lat, long := offsetNorth(1000)
	if res := f.openFrom(t, m.ID, f64(lat), f64(long)); !res.Allowed {
		t.Fatalf("1 km inside a 5 km site fence must be allowed: %+v", res)
	}
	// Adding a tight door fence must DENY, not widen back to the site rule's
	// permissive answer.
	addGeofence(t, f, f.ap.ID, "", 50, f64(0), GeofenceOnMissingDeny)
	if res := f.openFrom(t, m.ID, f64(lat), f64(long)); res.Allowed || res.Reason != ReasonOutsideGeofence {
		t.Fatalf("the narrower fence must win: %+v", res)
	}
	// The door itself still opens from the door.
	if res := f.openFrom(t, m.ID, f64(gateLat), f64(gateLong)); !res.Allowed {
		t.Fatalf("standing on the anchor must be allowed: %+v", res)
	}

	// A location fence covers every access point in the location.
	side, err := f.s.CreateAccessPointFull(ctx, f.acct.ID, f.loc.ID, "Side gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: side.ID, Command: "open", Source: "web",
		Lat: f64(-33.9249), Long: f64(18.4241),
	})
	if err != nil || res.Allowed || res.Reason != ReasonOutsideGeofence {
		t.Errorf("the site fence must cover a door with no fence of its own: %v %+v", err, res)
	}
}

// A fence is a property of the DOOR, so it binds visitors holding a one-off
// grant exactly as it binds members. This is the deliberate difference from
// time-window rules, which are per-member and skip visitors entirely.
func TestOpenPathGeofenceAppliesToVisitors(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	const phone = "+27820001111"
	five := int64(5)
	if _, err := f.s.CreateGrant(ctx, f.acct.ID, CreateGrantArgs{
		GrantedByUserID: f.owner.ID, PhoneE164: phone, VisitorName: "Plumber",
		StartsAt: now() - 10, EndsAt: now() + 3600, MaxUses: &five,
		AccessPointIDs: []string{f.ap.ID},
	}); err != nil {
		t.Fatalf("CreateGrant: %v", err)
	}
	addGeofence(t, f, f.ap.ID, "", 200, nil, GeofenceOnMissingDeny)

	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		PhoneE164: phone, AccessPointID: f.ap.ID, Command: "open", Source: "whatsapp",
		Lat: f64(-33.9249), Long: f64(18.4241),
	})
	if err != nil || res.Allowed || res.Reason != ReasonOutsideGeofence {
		t.Fatalf("a visitor opening from another city must be refused: %v %+v", err, res)
	}
	// ...and from the gate, allowed.
	res, err = f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		PhoneE164: phone, AccessPointID: f.ap.ID, Command: "open", Source: "whatsapp",
		Lat: f64(gateLat), Long: f64(gateLong),
	})
	if err != nil || !res.Allowed {
		t.Fatalf("a visitor at the gate must be allowed: %v %+v", err, res)
	}
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

func TestCreateGeofenceRuleShapeAndAnchorSeeding(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()

	// No anchor and no map pin anywhere: refused, rather than a fence centred
	// on null island that denies every open on the planet while looking fine.
	_, err := f.s.CreateGeofenceRule(ctx, f.acct.ID, CreateGeofenceRuleArgs{
		AccessPointID: f.ap.ID, RadiusM: 200,
	})
	if !errors.Is(err, ErrGeofenceAnchorRequired) {
		t.Fatalf("want ErrGeofenceAnchorRequired, got %v", err)
	}

	// With a pin on the LOCATION, an access-point rule seeds its anchor from
	// it — the pin operators actually drop.
	if err := f.s.UpdateLocation(ctx, f.acct.ID, f.loc.ID, LocationPatch{
		Lat: f64(gateLat), Long: f64(gateLong),
	}); err != nil {
		t.Fatal(err)
	}
	r, err := f.s.CreateGeofenceRule(ctx, f.acct.ID, CreateGeofenceRuleArgs{
		AccessPointID: f.ap.ID, RadiusM: 200,
	})
	if err != nil {
		t.Fatalf("seeding from the location pin: %v", err)
	}
	if r.AnchorLat != gateLat || r.AnchorLong != gateLong {
		t.Errorf("anchor %v,%v want %v,%v", r.AnchorLat, r.AnchorLong, gateLat, gateLong)
	}
	if r.SlackM != DefaultGeofenceSlackM || r.OnMissingLocation != GeofenceOnMissingDeny {
		t.Errorf("defaults: slack=%v on_missing=%q", r.SlackM, r.OnMissingLocation)
	}

	// One rule per target.
	if _, err := f.s.CreateGeofenceRule(ctx, f.acct.ID, CreateGeofenceRuleArgs{
		AccessPointID: f.ap.ID, RadiusM: 300,
	}); !errors.Is(err, ErrGeofenceRuleExists) {
		t.Errorf("duplicate target: %v", err)
	}

	// Shape refusals.
	for _, c := range []struct {
		name string
		args CreateGeofenceRuleArgs
	}{
		{"no target", CreateGeofenceRuleArgs{RadiusM: 200, Lat: f64(0), Long: f64(0)}},
		{"both targets", CreateGeofenceRuleArgs{AccessPointID: f.ap.ID, LocationID: f.loc.ID, RadiusM: 200, Lat: f64(0), Long: f64(0)}},
		{"half an anchor", CreateGeofenceRuleArgs{LocationID: f.loc.ID, RadiusM: 200, Lat: f64(0)}},
		{"radius out of range", CreateGeofenceRuleArgs{LocationID: f.loc.ID, RadiusM: 1, Lat: f64(0), Long: f64(0)}},
		{"bad missing-location policy", CreateGeofenceRuleArgs{LocationID: f.loc.ID, RadiusM: 200, Lat: f64(0), Long: f64(0), OnMissingLocation: "shrug"}},
	} {
		if _, err := f.s.CreateGeofenceRule(ctx, f.acct.ID, c.args); !errors.Is(err, ErrInvalidGeofenceRule) {
			t.Errorf("%s: want ErrInvalidGeofenceRule, got %v", c.name, err)
		}
	}

	// Cross-tenant: a rule pointing at another account's door would be a
	// denial primitive against a stranger. Indistinguishable from not found.
	other, err := f.s.CreateUser(ctx, "other@fence.com", "h", "X", "")
	if err != nil {
		t.Fatal(err)
	}
	otherAcct, _, err := f.s.CreateAccountWithOwner(ctx, other.ID, "Other House", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.CreateGeofenceRule(ctx, otherAcct.ID, CreateGeofenceRuleArgs{
		AccessPointID: f.ap.ID, RadiusM: 200, Lat: f64(gateLat), Long: f64(gateLong),
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-tenant create: want ErrNotFound, got %v", err)
	}

	// Delete is the escape hatch, and it is account-scoped.
	if err := f.s.DeleteGeofenceRule(ctx, otherAcct.ID, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-tenant delete: want ErrNotFound, got %v", err)
	}
	if err := f.s.DeleteGeofenceRule(ctx, f.acct.ID, r.ID); err != nil {
		t.Errorf("delete: %v", err)
	}
	rules, err := f.s.GeofenceRulesForAccount(ctx, f.acct.ID)
	if err != nil || len(rules) != 0 {
		t.Errorf("after delete: %v %+v", err, rules)
	}
}
