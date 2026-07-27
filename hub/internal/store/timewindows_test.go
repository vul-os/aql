package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// The evaluator, on the cases that are actually hard
// ---------------------------------------------------------------------------

// mustEval parses a rule and answers whether ts (RFC3339) falls inside it.
func mustEval(t *testing.T, tz string, ws []TimeWindow, ts string) bool {
	t.Helper()
	loc, parsed, err := ValidateTimeWindows(tz, ws)
	if err != nil {
		t.Fatalf("ValidateTimeWindows(%s, %+v): %v", tz, ws, err)
	}
	at, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t.Fatal(err)
	}
	return parsedRule{id: "r", loc: loc, ws: parsed}.allows(at)
}

// A window across midnight is TWO windows, because `days` does not wrap — the
// same contract offline grants have always had. This pins both halves and the
// edges either side of them.
func TestTimeWindowSpanningMidnight(t *testing.T) {
	ws := []TimeWindow{
		{Days: "fri", From: "22:00", To: "24:00"},
		{Days: "sat", From: "00:00", To: "06:00"},
	}
	// 2026-07-03 is a Friday, 2026-07-04 a Saturday.
	cases := []struct {
		ts   string
		want bool
	}{
		{"2026-07-03T21:59:00Z", false}, // a minute early
		{"2026-07-03T22:00:00Z", true},  // `from` inclusive
		{"2026-07-03T23:59:00Z", true},
		{"2026-07-04T00:00:00Z", true}, // rolled into the second window
		{"2026-07-04T05:59:00Z", true},
		{"2026-07-04T06:00:00Z", false}, // `to` exclusive
		{"2026-07-04T22:00:00Z", false}, // Saturday night is not Friday night
	}
	for _, c := range cases {
		if got := mustEval(t, "UTC", ws, c.ts); got != c.want {
			t.Errorf("%s: inside=%v want %v", c.ts, got, c.want)
		}
	}
}

// The mistake the midnight case invites — one window written 22:00-06:00 —
// can never match anything under no-wrap semantics. It is REFUSED, not stored
// as a rule that silently denies forever.
func TestTimeWindowContradictionRefused(t *testing.T) {
	bad := []struct {
		name string
		tz   string
		ws   []TimeWindow
	}{
		{"across midnight in one window", "UTC", []TimeWindow{{Days: "mon", From: "22:00", To: "06:00"}}},
		{"from equals to", "UTC", []TimeWindow{{Days: "mon", From: "08:00", To: "08:00"}}},
		{"day range runs backwards", "UTC", []TimeWindow{{Days: "fri-mon", From: "08:00", To: "09:00"}}},
		{"unknown day", "UTC", []TimeWindow{{Days: "funday", From: "08:00", To: "09:00"}}},
		{"not HH:MM", "UTC", []TimeWindow{{Days: "mon", From: "8:00", To: "09:00"}}},
		{"hour out of range", "UTC", []TimeWindow{{Days: "mon", From: "25:00", To: "26:00"}}},
		{"minute out of range", "UTC", []TimeWindow{{Days: "mon", From: "08:60", To: "09:00"}}},
		{"non-numeric", "UTC", []TimeWindow{{Days: "mon", From: "ab:cd", To: "09:00"}}},
		{"no windows", "UTC", nil},
		{"no timezone", "", []TimeWindow{{Days: "mon", From: "08:00", To: "09:00"}}},
		{"unknown timezone", "Mars/Olympus", []TimeWindow{{Days: "mon", From: "08:00", To: "09:00"}}},
	}
	for _, c := range bad {
		if _, _, err := ValidateTimeWindows(c.tz, c.ws); !errors.Is(err, ErrInvalidTimeWindowRule) {
			t.Errorf("%s: want ErrInvalidTimeWindowRule, got %v", c.name, err)
		}
	}
	// ...and the legal forms still pass, including the end-of-day sentinel.
	ok := []TimeWindow{{Days: "mon-fri", From: "00:00", To: "24:00"}, {Days: "sun", From: "23:59", To: "24:00"}}
	if _, _, err := ValidateTimeWindows("Africa/Johannesburg", ok); err != nil {
		t.Errorf("legal rule refused: %v", err)
	}
	if len(ok) > MaxRuleWindows {
		t.Fatal("fixture exceeds the cap")
	}
	tooMany := make([]TimeWindow, MaxRuleWindows+1)
	for i := range tooMany {
		tooMany[i] = TimeWindow{Days: "mon", From: "08:00", To: "09:00"}
	}
	if _, _, err := ValidateTimeWindows("UTC", tooMany); !errors.Is(err, ErrInvalidTimeWindowRule) {
		t.Errorf("window cap not enforced: %v", err)
	}
}

// A rule means local wall-clock time in ITS OWN zone, so the same absolute
// instant is inside on one side of a DST transition and outside on the other.
// America/New_York springs forward 2026-03-08 and falls back 2026-11-01.
func TestTimeWindowDSTSpringForward(t *testing.T) {
	ws := []TimeWindow{{Days: "mon-sun", From: "09:00", To: "10:00"}}
	// 14:00 UTC is 09:00 EST on Saturday and 10:00 EDT on Sunday — one hour
	// of UTC, two different answers, which is the entire reason the zone is
	// stored per rule instead of guessed from the host.
	if !mustEval(t, "America/New_York", ws, "2026-03-07T14:00:00Z") {
		t.Error("Sat 09:00 EST should be inside")
	}
	if mustEval(t, "America/New_York", ws, "2026-03-08T14:00:00Z") {
		t.Error("Sun 10:00 EDT should be outside — the rule follows the wall clock, not the offset")
	}
	if !mustEval(t, "America/New_York", ws, "2026-03-08T13:00:00Z") {
		t.Error("Sun 09:00 EDT should be inside")
	}

	// The hour that does not exist. 02:00-03:00 local is skipped entirely on
	// 2026-03-08: no instant that day is inside it, and the next opportunity
	// is the following morning. Denying an hour that never happens is correct,
	// and worth pinning so nobody "fixes" it into a silent allow.
	lost := []TimeWindow{{Days: "mon-sun", From: "02:00", To: "03:00"}}
	for _, ts := range []string{"2026-03-08T06:30:00Z", "2026-03-08T07:00:00Z", "2026-03-08T07:30:00Z"} {
		if mustEval(t, "America/New_York", lost, ts) {
			t.Errorf("%s: the skipped local hour must never be inside", ts)
		}
	}
	loc, parsed, err := ValidateTimeWindows("America/New_York", lost)
	if err != nil {
		t.Fatal(err)
	}
	from, _ := time.Parse(time.RFC3339, "2026-03-08T06:30:00Z")
	secs := nextAllowedIn([]parsedRule{{id: "r", loc: loc, ws: parsed}}, from)
	next := from.Add(time.Duration(secs) * time.Second).In(loc)
	if next.Day() != 9 || next.Hour() != 2 {
		t.Errorf("next allowed after the lost hour = %s, want 2026-03-09 02:00 local", next)
	}
}

func TestTimeWindowDSTFallBack(t *testing.T) {
	// 01:00-02:00 local happens TWICE on 2026-11-01: once at 05:00 UTC (EDT)
	// and again at 06:00 UTC (EST). Both are inside, and that is the honest
	// answer — the member's rule says "between one and two", and on that day
	// the wall clock says it twice.
	ws := []TimeWindow{{Days: "sun", From: "01:00", To: "02:00"}}
	for _, ts := range []string{"2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"} {
		if !mustEval(t, "America/New_York", ws, ts) {
			t.Errorf("%s: the repeated local hour is inside both times", ts)
		}
	}
	if mustEval(t, "America/New_York", ws, "2026-11-01T07:30:00Z") {
		t.Error("02:30 EST is outside")
	}
}

func TestTimeWindowNextAllowed(t *testing.T) {
	loc, parsed, err := ValidateTimeWindows("UTC", []TimeWindow{{Days: "mon-fri", From: "08:00", To: "12:00"}})
	if err != nil {
		t.Fatal(err)
	}
	rules := []parsedRule{{id: "r", loc: loc, ws: parsed}}
	at := func(ts string) time.Time {
		v, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	// Wednesday 06:00 → two hours.
	if got := nextAllowedIn(rules, at("2026-07-01T06:00:00Z")); got != 7200 {
		t.Errorf("same-day wait = %d, want 7200", got)
	}
	// Saturday 06:00 → Monday 08:00, two days and two hours away.
	if got := nextAllowedIn(rules, at("2026-07-04T06:00:00Z")); got != 2*86400+7200 {
		t.Errorf("weekend wait = %d, want %d", got, 2*86400+7200)
	}
	// A rule nothing can satisfy within the lookahead reports 0 rather than
	// inventing a number.
	loc2, parsed2, err := ValidateTimeWindows("UTC", []TimeWindow{{Days: "mon", From: "08:00", To: "09:00"}})
	if err != nil {
		t.Fatal(err)
	}
	both := []parsedRule{{id: "a", loc: loc, ws: parsed},
		{id: "b", loc: loc2, ws: parsed2}}
	// Monday 08:00 is the only instant BOTH rules allow: from Wednesday that
	// is five days and two hours, not the two hours rule A alone would give.
	if got := nextAllowedIn(both, at("2026-07-01T06:00:00Z")); got != 5*86400+7200 {
		t.Errorf("intersection wait = %d, want %d", got, 5*86400+7200)
	}
}

// ---------------------------------------------------------------------------
// The choke point
// ---------------------------------------------------------------------------

// alwaysWindows/neverWindows build rules that are unambiguous no matter what
// the wall clock says when the test runs: "every day, all day" and "a weekday
// three days from now, which is never today".
func alwaysWindows() []TimeWindow {
	return []TimeWindow{{Days: "mon-sun", From: "00:00", To: "24:00"}}
}

func neverWindows() []TimeWindow {
	d := weekdayNames[weekdayIndexMonFirst(time.Now().UTC().AddDate(0, 0, 3).Weekday())]
	return []TimeWindow{{Days: d, From: "00:00", To: "24:00"}}
}

func addRule(t *testing.T, f *openFixture, userID, apID, locID string, ws []TimeWindow) *TimeWindowRule {
	t.Helper()
	r, err := f.s.CreateTimeWindowRule(context.Background(), f.acct.ID, CreateTimeWindowRuleArgs{
		UserID: userID, AccessPointID: apID, LocationID: locID, TZ: "UTC", Windows: ws,
		Note: "test rule", CreatedByUserID: f.owner.ID,
	})
	if err != nil {
		t.Fatalf("CreateTimeWindowRule: %v", err)
	}
	return r
}

// THE DEFAULT. An install that does not use this feature must be bit-for-bit
// unaffected by its existence: no rule, no restriction, no extra denial.
func TestOpenPathNoTimeWindowRuleMeansNoRestriction(t *testing.T) {
	f := newOpenFixture(t)
	m := f.addMember(t, "norule@open.com")
	for i := 0; i < 3; i++ {
		if res := f.open(t, m.ID); !res.Allowed || res.Reason != "" {
			t.Fatalf("open %d with no rule stored: %+v", i, res)
		}
	}
	// And nothing was written to the rules table by merely opening.
	var n int
	if err := f.s.db.QueryRow(`SELECT count(*) FROM time_window_rules`).Scan(&n); err != nil || n != 0 {
		t.Errorf("open path must not write rules: %d %v", n, err)
	}
}

func TestOpenPathOutsideTimeWindowDeniesAndAudits(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "cleaner@open.com")
	addRule(t, f, m.ID, f.ap.ID, "", neverWindows())

	res := f.open(t, m.ID)
	if res.Allowed || res.Reason != ReasonOutsideTimeWindow {
		t.Fatalf("outside window: %+v", res)
	}
	if res.Reason == "rate_limited" || res.Reason == "quota_exceeded" {
		t.Fatal("a schedule denial must not be reported as a limit denial")
	}
	if res.RetryAfterS <= 0 || res.RetryAfterS > maxLookaheadDays*86400 {
		t.Errorf("retry-after should point at the next allowed instant: %d", res.RetryAfterS)
	}
	// Audited through the existing choke point, with its own reason.
	logs, err := f.s.AccessLogsByAccount(ctx, f.acct.ID, 10)
	if err != nil || len(logs) != 1 || logs[0].Success || logs[0].Error != ReasonOutsideTimeWindow {
		t.Fatalf("denial audit: %v %+v", err, logs)
	}
	// The denial ran BEFORE the limit block, so it consumed no counter and
	// claimed no cooldown — the invariant openpath.go states outright.
	var n int
	if err := f.s.db.QueryRow(
		`SELECT count(*) FROM rate_limit_counters WHERE subject = ?`, "user:"+m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("a window denial consumed %d rate-limit counter rows; denials must never consume", n)
	}
}

// close is NEVER window-restricted. Someone who got in must be able to get
// out, whatever the hour — the same guarantee close already has against rate
// limits and quotas.
func TestOpenPathCloseIsNeverWindowRestricted(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "inside@open.com")
	addRule(t, f, m.ID, f.ap.ID, "", neverWindows())

	if res := f.open(t, m.ID); res.Allowed {
		t.Fatal("precondition: the open must be denied")
	}
	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: f.ap.ID, Command: "close", Source: "web",
	})
	if err != nil || !res.Allowed || res.Reason != "" {
		t.Fatalf("close during a denied window must be allowed: %v %+v", err, res)
	}
	// ...and recorded as the success it was.
	logs, _ := f.s.AccessLogsByAccount(ctx, f.acct.ID, 10)
	found := false
	for _, l := range logs {
		if l.Command == "close" && l.Success {
			found = true
		}
	}
	if !found {
		t.Error("the close is missing from the audit trail")
	}
}

// A rule binds to ONE target. The same member can be allowed at the front door
// and refused at the side gate at the same instant.
func TestOpenPathWindowIsPerAccessPoint(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	side, err := f.s.CreateAccessPointFull(ctx, f.acct.ID, f.loc.ID, "Side gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	m := f.addMember(t, "split@open.com")
	addRule(t, f, m.ID, f.ap.ID, "", alwaysWindows()) // front door: any time
	addRule(t, f, m.ID, side.ID, "", neverWindows())  // side gate: not now

	if res := f.open(t, m.ID); !res.Allowed {
		t.Errorf("front door should be open to them: %+v", res)
	}
	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: side.ID, Command: "open", Source: "web",
	})
	if err != nil || res.Allowed || res.Reason != ReasonOutsideTimeWindow {
		t.Errorf("side gate should refuse at this hour: %v %+v", err, res)
	}
}

// A location rule covers every access point in the location, and an
// access-point rule composes with it by AND — a rule can only ever NARROW.
func TestOpenPathWindowRulesNarrowNeverWiden(t *testing.T) {
	f := newOpenFixture(t)
	m := f.addMember(t, "narrow@open.com")

	// Location-wide: allowed at any hour, anywhere on site.
	addRule(t, f, m.ID, "", f.loc.ID, alwaysWindows())
	if res := f.open(t, m.ID); !res.Allowed {
		t.Fatalf("location rule allowing everything must allow: %+v", res)
	}
	// Adding a door rule that excludes now must DENY, not widen back to the
	// location rule's permissive answer.
	addRule(t, f, m.ID, f.ap.ID, "", neverWindows())
	res := f.open(t, m.ID)
	if res.Allowed || res.Reason != ReasonOutsideTimeWindow {
		t.Fatalf("the narrower rule must win: %+v", res)
	}
}

func TestOpenPathLocationRuleAppliesToEveryAccessPoint(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	side, err := f.s.CreateAccessPointFull(ctx, f.acct.ID, f.loc.ID, "Back door", "door", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	m := f.addMember(t, "site@open.com")
	addRule(t, f, m.ID, "", f.loc.ID, neverWindows())

	for _, apID := range []string{f.ap.ID, side.ID} {
		res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
			UserID: m.ID, AccessPointID: apID, Command: "open", Source: "web",
		})
		if err != nil || res.Allowed || res.Reason != ReasonOutsideTimeWindow {
			t.Errorf("ap %s: %v %+v", apID, err, res)
		}
	}
}

// A stored rule that cannot be parsed DENIES and says so. It is never skipped:
// skipping is exactly how a typo becomes an unrestricted 3am open. The row is
// written straight to SQLite here because the write path refuses it — which is
// the point: this covers hand-edited databases, downgrades and corruption.
func TestOpenPathUnparseableRuleFailsClosed(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "broken@open.com")

	insert := func(tz, windowsJSON string) {
		t.Helper()
		if _, err := f.s.db.Exec(
			`INSERT INTO time_window_rules (id, account_id, user_id, access_point_id, tz, windows, note, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
			NewID(), f.acct.ID, m.ID, f.ap.ID, tz, windowsJSON, now(), now()); err != nil {
			t.Fatal(err)
		}
	}
	clear := func() {
		t.Helper()
		if _, err := f.s.db.Exec(`DELETE FROM time_window_rules`); err != nil {
			t.Fatal(err)
		}
	}

	for _, c := range []struct{ name, tz, ws string }{
		{"unparseable json", "UTC", "not json at all"},
		{"empty window list", "UTC", "[]"},
		{"window that never occurs", "UTC", `[{"days":"mon","from":"22:00","to":"06:00"}]`},
		{"unknown timezone", "Mars/Olympus", `[{"days":"mon-sun","from":"00:00","to":"24:00"}]`},
	} {
		clear()
		insert(c.tz, c.ws)
		res := f.open(t, m.ID)
		if res.Allowed || res.Reason != ReasonTimeWindowInvalid {
			t.Errorf("%s: want %s, got %+v", c.name, ReasonTimeWindowInvalid, res)
		}
		logs, _ := f.s.AccessLogsByAccount(ctx, f.acct.ID, 1)
		if len(logs) != 1 || logs[0].Error != ReasonTimeWindowInvalid {
			t.Errorf("%s: denial not audited with its own reason: %+v", c.name, logs)
		}
	}
	// ...and close still gets out, even with a broken rule in the table.
	res, err := f.s.LogAccess(ctx, f.cfg, LogAccessArgs{
		UserID: m.ID, AccessPointID: f.ap.ID, Command: "close", Source: "web",
	})
	if err != nil || !res.Allowed {
		t.Errorf("close must survive a broken rule: %v %+v", err, res)
	}
}

// Visitors carry their windows on the grant itself (proto/grants.md); member
// rules are not consulted for them and must not accidentally block them.
func TestOpenPathVisitorNotSubjectToMemberWindows(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "visitorpeer@open.com")
	addRule(t, f, m.ID, f.ap.ID, "", neverWindows())

	five := int64(5)
	if _, err := f.s.CreateGrant(ctx, f.acct.ID, CreateGrantArgs{
		GrantedByUserID: f.owner.ID, PhoneE164: "+27825550009", VisitorName: "Plumber",
		StartsAt: now() - 10, EndsAt: now() + 3600, MaxUses: &five,
		AccessPointIDs: []string{f.ap.ID},
	}); err != nil {
		t.Fatal(err)
	}
	res, gid, err := f.s.VisitorOpenWithGrant(ctx, f.cfg, "+27825550009", f.ap.ID, "whatsapp")
	if err != nil || gid == "" || res == nil || !res.Allowed {
		t.Fatalf("visitor open must be unaffected by another member's rule: %v %q %+v", err, gid, res)
	}
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

func TestCreateTimeWindowRuleGuards(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "guards@open.com")

	bad := []struct {
		name string
		args CreateTimeWindowRuleArgs
	}{
		{"no target", CreateTimeWindowRuleArgs{UserID: m.ID, TZ: "UTC", Windows: alwaysWindows()}},
		{"two targets", CreateTimeWindowRuleArgs{UserID: m.ID, AccessPointID: f.ap.ID, LocationID: f.loc.ID, TZ: "UTC", Windows: alwaysWindows()}},
		{"no user", CreateTimeWindowRuleArgs{AccessPointID: f.ap.ID, TZ: "UTC", Windows: alwaysWindows()}},
		{"no timezone", CreateTimeWindowRuleArgs{UserID: m.ID, AccessPointID: f.ap.ID, Windows: alwaysWindows()}},
		{"no windows", CreateTimeWindowRuleArgs{UserID: m.ID, AccessPointID: f.ap.ID, TZ: "UTC"}},
	}
	for _, c := range bad {
		if _, err := f.s.CreateTimeWindowRule(ctx, f.acct.ID, c.args); !errors.Is(err, ErrInvalidTimeWindowRule) {
			t.Errorf("%s: want ErrInvalidTimeWindowRule, got %v", c.name, err)
		}
	}

	// A non-member, and another account's door, are both simply not found —
	// the tenancy contract, so a rule cannot be aimed across accounts.
	stranger, err := f.s.CreateUser(ctx, "stranger@open.com", "h", "S", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.CreateTimeWindowRule(ctx, f.acct.ID, CreateTimeWindowRuleArgs{
		UserID: stranger.ID, AccessPointID: f.ap.ID, TZ: "UTC", Windows: alwaysWindows(),
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("non-member: want ErrNotFound, got %v", err)
	}
	acctB, locB, err := f.s.CreateAccountWithOwner(ctx, stranger.ID, "B House", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	apB, err := f.s.CreateAccessPointFull(ctx, acctB.ID, locB.ID, "Their gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.CreateTimeWindowRule(ctx, f.acct.ID, CreateTimeWindowRuleArgs{
		UserID: m.ID, AccessPointID: apB.ID, TZ: "UTC", Windows: alwaysWindows(),
	}); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-account access point: want ErrNotFound, got %v", err)
	}

	// One rule per (member, target): the second is a collision, not a silent
	// second restriction nobody can see.
	addRule(t, f, m.ID, f.ap.ID, "", alwaysWindows())
	if _, err := f.s.CreateTimeWindowRule(ctx, f.acct.ID, CreateTimeWindowRuleArgs{
		UserID: m.ID, AccessPointID: f.ap.ID, TZ: "UTC", Windows: alwaysWindows(),
	}); !errors.Is(err, ErrTimeWindowRuleExists) {
		t.Errorf("duplicate target: want ErrTimeWindowRuleExists, got %v", err)
	}
	// A location rule for the same member is a DIFFERENT target and is fine.
	addRule(t, f, m.ID, "", f.loc.ID, alwaysWindows())
}

func TestTimeWindowRuleListingAndDelete(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m1 := f.addMember(t, "list1@open.com")
	m2 := f.addMember(t, "list2@open.com")
	r1 := addRule(t, f, m1.ID, f.ap.ID, "", alwaysWindows())
	addRule(t, f, m2.ID, f.ap.ID, "", alwaysWindows())

	all, err := f.s.TimeWindowRulesForAccount(ctx, f.acct.ID, "")
	if err != nil || len(all) != 2 {
		t.Fatalf("account listing: %v %+v", err, all)
	}
	mine, err := f.s.TimeWindowRulesForAccount(ctx, f.acct.ID, m1.ID)
	if err != nil || len(mine) != 1 || mine[0].ID != r1.ID {
		t.Fatalf("member listing: %v %+v", err, mine)
	}
	if mine[0].TZ != "UTC" || len(mine[0].Windows) != 1 || mine[0].Windows[0].Days != "mon-sun" {
		t.Errorf("round trip lost the rule shape: %+v", mine[0])
	}

	// Cross-tenant reads and deletes are not-found, never someone else's rule.
	other, _ := f.s.CreateUser(ctx, "otheracct@open.com", "h", "O", "")
	acctB, _, _ := f.s.CreateAccountWithOwner(ctx, other.ID, "B House", "ZA")
	if _, err := f.s.TimeWindowRuleByID(ctx, acctB.ID, r1.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-tenant read: %v", err)
	}
	if err := f.s.DeleteTimeWindowRule(ctx, acctB.ID, r1.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-tenant delete: %v", err)
	}

	// Deleting lifts the restriction — the lockout escape hatch.
	deny := addRule(t, f, f.owner.ID, f.ap.ID, "", neverWindows())
	if res := f.open(t, f.owner.ID); res.Allowed {
		t.Fatal("precondition: the owner is locked out by their own rule")
	}
	if err := f.s.DeleteTimeWindowRule(ctx, f.acct.ID, deny.ID); err != nil {
		t.Fatal(err)
	}
	if res := f.open(t, f.owner.ID); !res.Allowed {
		t.Errorf("deleting the rule must restore the default: %+v", res)
	}
	if err := f.s.DeleteTimeWindowRule(ctx, f.acct.ID, deny.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("double delete: %v", err)
	}
}

// Deleting the door deletes the rule about the door — a stale rule must never
// outlive its target and deny at something that no longer means what it did.
func TestTimeWindowRuleCascadesWithItsTarget(t *testing.T) {
	f := newOpenFixture(t)
	ctx := context.Background()
	m := f.addMember(t, "cascade@open.com")
	side, err := f.s.CreateAccessPointFull(ctx, f.acct.ID, f.loc.ID, "Temp gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	addRule(t, f, m.ID, side.ID, "", neverWindows())
	if _, err := f.s.db.ExecContext(ctx, `DELETE FROM access_points WHERE id = ?`, side.ID); err != nil {
		t.Fatal(err)
	}
	rules, err := f.s.TimeWindowRulesForAccount(ctx, f.acct.ID, "")
	if err != nil || len(rules) != 0 {
		t.Errorf("rule outlived its access point: %v %+v", err, rules)
	}
}
