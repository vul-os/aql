package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// analyticsFixture builds TWO tenants with identical-looking activity. Every
// test below asserts against tenant A and uses tenant B as the thing that
// must never appear in A's numbers — an aggregate leaks exactly as much as a
// detail view does.
type analyticsFixture struct {
	s          *Store
	now        int64
	acctA      *Account
	locA       *Location
	apA        *AccessPointDetail
	ownerA     *User
	acctB      *Account
	locB       *Location
	apB        *AccessPointDetail
	ownerB     *User
	dayStart   int64 // start of the UTC day containing now
	backdateTo int64 // how far back the fixtures pre-date account creation
}

func newAnalyticsFixture(t *testing.T) *analyticsFixture {
	t.Helper()
	s := openTest(t)
	ctx := context.Background()
	f := &analyticsFixture{s: s, now: time.Now().Unix()}
	f.dayStart = FixedWindowStart(f.now, DayS)

	mk := func(username, name string) (*Account, *Location, *AccessPointDetail, *User) {
		u, err := s.CreateUser(ctx, username, "h", "O", "")
		if err != nil {
			t.Fatal(err)
		}
		acct, loc, err := s.CreateAccountWithOwner(ctx, u.ID, name, "ZA")
		if err != nil {
			t.Fatal(err)
		}
		ap, err := s.CreateAccessPointFull(ctx, acct.ID, loc.ID, name+" gate", "gate", "", nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		return acct, loc, ap, u
	}
	f.acctA, f.locA, f.apA, f.ownerA = mk("a@an.com", "Account A")
	f.acctB, f.locB, f.apB, f.ownerB = mk("b@an.com", "Account B")

	// Back-date both accounts so "the account did not exist yet" is not what
	// every assertion below is actually measuring. 30 days is comfortably
	// wider than the windows under test.
	f.backdateTo = f.dayStart - 30*DayS
	for _, id := range []string{f.acctA.ID, f.acctB.ID} {
		if _, err := s.db.ExecContext(ctx, `UPDATE accounts SET created_at = ? WHERE id = ?`, f.backdateTo, id); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{f.locA.ID, f.locB.ID} {
		if _, err := s.db.ExecContext(ctx, `UPDATE locations SET created_at = ? WHERE id = ?`, f.backdateTo, id); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

// log appends one audit row directly (InsertAccessLog is the only writer;
// nothing in analytics.go writes anything).
func (f *analyticsFixture) log(t *testing.T, acct *Account, loc *Location, ap *AccessPointDetail,
	userID, command string, success bool, errTag string, ts int64) string {
	t.Helper()
	id, err := f.s.InsertAccessLog(context.Background(), AccessLog{
		AccessPointID: ap.ID, LocationID: loc.ID, AccountID: acct.ID, UserID: userID,
		Command: command, Source: "web", Success: success, Error: errTag, TS: ts,
	})
	if err != nil {
		t.Fatalf("InsertAccessLog: %v", err)
	}
	return id
}

func (f *analyticsFixture) window(t *testing.T, days int) AnalyticsWindow {
	t.Helper()
	w, err := NewAnalyticsWindow(f.now, days)
	if err != nil {
		t.Fatalf("NewAnalyticsWindow(%d): %v", days, err)
	}
	return w
}

func mustInsights(t *testing.T, f *analyticsFixture, accountID string, days int) *AccountInsightsData {
	t.Helper()
	d, err := f.s.AccountInsights(context.Background(), accountID, f.window(t, days), f.now)
	if err != nil {
		t.Fatalf("AccountInsights: %v", err)
	}
	return d
}

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

// TestAnalyticsNeverCrossesTenants is the load-bearing test in this file:
// account B's rows must be invisible in every single one of account A's
// numbers, series, breakdowns and denial reasons.
func TestAnalyticsNeverCrossesTenants(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()

	// A: 2 opens, 1 quota denial, 1 close — today.
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+100)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+200)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", false, "quota_exceeded", f.dayStart+300)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "close", true, "", f.dayStart+400)
	// B: 50 opens and a distinctive denial reason A must never learn about.
	for i := range 50 {
		f.log(t, f.acctB, f.locB, f.apB, f.ownerB.ID, "open", true, "", f.dayStart+int64(i))
	}
	f.log(t, f.acctB, f.locB, f.apB, f.ownerB.ID, "open", false, "account_suspended", f.dayStart+900)

	d := mustInsights(t, f, f.acctA.ID, 7)
	if d.Totals.Opens != 2 || d.Totals.Denied != 1 || d.Totals.Closes != 1 {
		t.Errorf("account A totals contaminated: %+v", d.Totals)
	}
	for _, day := range d.Days {
		if day.Opens != nil && *day.Opens > 2 {
			t.Errorf("day %s counts %d opens — account B's rows leaked", day.Day, *day.Opens)
		}
	}
	for _, ap := range d.AccessPoints {
		if ap.AccessPointID == f.apB.ID {
			t.Errorf("account B's access point appears in A's breakdown: %+v", ap)
		}
	}
	for _, m := range d.Members {
		if m.UserID == f.ownerB.ID {
			t.Errorf("account B's member appears in A's breakdown: %+v", m)
		}
	}
	for _, r := range d.Denials {
		if r.Reason == "account_suspended" {
			t.Errorf("account B's denial reason leaked into A: %+v", d.Denials)
		}
	}

	// And the mirror image: B sees only B.
	db := mustInsights(t, f, f.acctB.ID, 7)
	if db.Totals.Opens != 50 || db.Totals.Denied != 1 || db.Totals.Closes != 0 {
		t.Errorf("account B totals contaminated: %+v", db.Totals)
	}

	// Summary + recent feed are scoped too.
	sum, err := f.s.AccountActivitySummary(ctx, f.acctA.ID, 100, f.now)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Today.Opens != 2 || sum.Today.Denied != 1 {
		t.Errorf("summary today contaminated: %+v", sum.Today)
	}
	if len(sum.Recent) != 4 {
		t.Errorf("recent feed has %d rows, want A's 4", len(sum.Recent))
	}
	for _, a := range sum.Recent {
		if a.LocationID == f.locB.ID || a.AccessPointID == f.apB.ID {
			t.Errorf("account B row in A's recent feed: %+v", a)
		}
	}
}

// TestLocationAnalyticsScopedToOwningAccount: a location id is not a
// capability. Asking for another tenant's location — even with a valid
// account of your own — is not-found, and the rows counted are filtered on
// account_id as well as location_id.
func TestLocationAnalyticsScopedToOwningAccount(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()
	f.log(t, f.acctB, f.locB, f.apB, f.ownerB.ID, "open", true, "", f.dayStart+10)

	if _, err := f.s.LocationActivitySummary(ctx, f.acctA.ID, f.locB.ID, f.window(t, 7), f.now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant location summary: want ErrNotFound, got %v", err)
	}
	if _, err := f.s.LocationCoverage(ctx, f.acctA.ID, f.locB.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant location coverage: want ErrNotFound, got %v", err)
	}
	own, err := f.s.LocationActivitySummary(ctx, f.acctB.ID, f.locB.ID, f.window(t, 7), f.now)
	if err != nil {
		t.Fatal(err)
	}
	if own.Totals.Opens != 1 {
		t.Errorf("own location summary: %+v", own.Totals)
	}
}

// ---------------------------------------------------------------------------
// A gap is not a zero
// ---------------------------------------------------------------------------

// TestEmptyPeriodReportsZeroNotNullWhenObserved: an account that demonstrably
// existed and recorded nothing gets real zeros — that IS "nothing happened".
func TestEmptyPeriodReportsZeroWhenObserved(t *testing.T) {
	f := newAnalyticsFixture(t)
	d := mustInsights(t, f, f.acctA.ID, 7)

	if len(d.Days) != 7 {
		t.Fatalf("want 7 buckets, got %d", len(d.Days))
	}
	for _, day := range d.Days {
		if !day.Observed {
			t.Errorf("day %s unobserved although the account pre-dates the window", day.Day)
			continue
		}
		if day.Opens == nil || *day.Opens != 0 || day.Denied == nil || *day.Denied != 0 {
			t.Errorf("day %s: want observed zeros, got opens=%v denied=%v", day.Day, day.Opens, day.Denied)
		}
	}
	if d.Totals != (WindowTotals{}) {
		t.Errorf("empty period totals: %+v", d.Totals)
	}
	if d.Coverage.EverRecorded() {
		t.Error("EverRecorded true for an account with no audit rows")
	}
	// Six whole days plus today-in-progress: never "complete".
	if q := SeriesQuality(d.Days); q != "partial" {
		t.Errorf("quality = %q, want partial (today is still in progress)", q)
	}
}

// TestUnobservedDaysAreNullNotZero: days before the subject could have been
// recording report nil counts. This is the distinction the whole file exists
// for — a nil cannot be drawn as a confident zero bar without dereferencing
// it first (internal/energy makes the same guarantee with a nil KWh).
func TestUnobservedDaysAreNullNotZero(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()

	// Move account A's existence to two days ago: everything before that is
	// a period this hub has no record of, not a period of no activity.
	created := f.dayStart - 2*DayS
	if _, err := f.s.db.ExecContext(ctx, `UPDATE accounts SET created_at = ? WHERE id = ?`, created, f.acctA.ID); err != nil {
		t.Fatal(err)
	}
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+60)

	d := mustInsights(t, f, f.acctA.ID, 7)
	nullDays, zeroDays := 0, 0
	for _, day := range d.Days {
		switch {
		case day.DayStart < created && day.DayStart+DayS <= created:
			if day.Observed || day.Opens != nil {
				t.Errorf("day %s pre-dates coverage but reports %v", day.Day, day.Opens)
			}
			nullDays++
		default:
			if !day.Observed || day.Opens == nil {
				t.Errorf("day %s is covered but reports nil", day.Day)
			}
			zeroDays++
		}
	}
	if nullDays == 0 || zeroDays == 0 {
		t.Fatalf("expected a mix of unobserved and observed days, got %d/%d", nullDays, zeroDays)
	}
	if q := SeriesQuality(d.Days); q != "partial" {
		t.Errorf("quality = %q, want partial", q)
	}
	if d.Coverage.ObservedFrom != created {
		t.Errorf("ObservedFrom = %d, want account creation %d", d.Coverage.ObservedFrom, created)
	}
	// The comparison window is entirely before coverage: no baseline exists,
	// and reporting 0 there would invent a week-over-week rise.
	if d.PrevObserved {
		t.Error("PrevObserved true for a comparison window predating coverage")
	}
	if d.PrevTotals != (WindowTotals{}) {
		t.Errorf("unobserved comparison window carries counts: %+v", d.PrevTotals)
	}
}

// TestCoverageStartsAtEarliestEvidence: imported history that pre-dates the
// account row moves coverage back — the earliest evidence wins.
func TestCoverageStartsAtEarliestEvidence(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()
	old := f.backdateTo - 5*DayS
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", old)

	cov, err := f.s.AccountCoverage(ctx, f.acctA.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !cov.EverRecorded() || cov.FirstRecordedAt.Int64 != old {
		t.Fatalf("FirstRecordedAt = %+v, want %d", cov.FirstRecordedAt, old)
	}
	if cov.ObservedFrom != old {
		t.Errorf("ObservedFrom = %d, want the earlier recorded row %d", cov.ObservedFrom, old)
	}
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

// TestAnalyticsWindowRefusesUnboundedRanges: over the cap is a refusal, not a
// silent clamp. A caller must never believe it received a year of data.
func TestAnalyticsWindowRefusesUnboundedRanges(t *testing.T) {
	nowUnix := time.Now().Unix()
	if _, err := NewAnalyticsWindow(nowUnix, AnalyticsMaxWindowDays+1); !errors.Is(err, ErrAnalyticsWindowTooLarge) {
		t.Errorf("days=%d: want ErrAnalyticsWindowTooLarge, got %v", AnalyticsMaxWindowDays+1, err)
	}
	if _, err := NewAnalyticsWindow(nowUnix, 3650); !errors.Is(err, ErrAnalyticsWindowTooLarge) {
		t.Errorf("days=3650: want ErrAnalyticsWindowTooLarge, got %v", err)
	}
	for _, bad := range []int{0, -1} {
		if _, err := NewAnalyticsWindow(nowUnix, bad); !errors.Is(err, ErrAnalyticsWindowInvalid) {
			t.Errorf("days=%d: want ErrAnalyticsWindowInvalid, got %v", bad, err)
		}
	}
	w, err := NewAnalyticsWindow(nowUnix, AnalyticsMaxWindowDays)
	if err != nil {
		t.Fatalf("days at the cap must be allowed: %v", err)
	}
	if w.ToTS-w.FromTS != int64(AnalyticsMaxWindowDays)*DayS {
		t.Errorf("window span %d, want %d", w.ToTS-w.FromTS, int64(AnalyticsMaxWindowDays)*DayS)
	}

	// A hand-built oversized window is refused by the query methods too —
	// the bound is not only in the constructor.
	f := newAnalyticsFixture(t)
	huge := AnalyticsWindow{Days: 400, FromTS: 0, ToTS: f.now}
	if _, err := f.s.AccountInsights(context.Background(), f.acctA.ID, huge, f.now); !errors.Is(err, ErrAnalyticsWindowTooLarge) {
		t.Errorf("AccountInsights with an oversized window: want refusal, got %v", err)
	}
	if _, err := f.s.LocationActivitySummary(context.Background(), f.acctA.ID, f.locA.ID, huge, f.now); !errors.Is(err, ErrAnalyticsWindowTooLarge) {
		t.Errorf("LocationActivitySummary with an oversized window: want refusal, got %v", err)
	}
	if _, err := f.s.AccountActivitySummary(context.Background(), f.acctA.ID, AnalyticsMaxRecentActivity+1, f.now); !errors.Is(err, ErrAnalyticsLimitTooLarge) {
		t.Errorf("recent limit over the cap: want refusal, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Denial reasons stay distinct
// ---------------------------------------------------------------------------

// TestDenialReasonsAreNotSmoothed: the point of the number is knowing whether
// it was a quota, a suspension, a rate limit or a disabled user.
func TestDenialReasonsAreNotSmoothed(t *testing.T) {
	f := newAnalyticsFixture(t)
	reasons := map[string]int{
		"quota_exceeded":    3,
		"rate_limited":      2,
		"account_suspended": 1,
		"user_disabled":     1,
	}
	ts := f.dayStart + 10
	for reason, n := range reasons {
		for range n {
			f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", false, reason, ts)
			ts++
		}
	}
	d := mustInsights(t, f, f.acctA.ID, 7)
	got := map[string]int64{}
	for _, r := range d.Denials {
		got[r.Reason] = r.Count
	}
	for reason, want := range reasons {
		if got[reason] != int64(want) {
			t.Errorf("denial %q = %d, want %d (full breakdown %+v)", reason, got[reason], want, d.Denials)
		}
	}
	if len(d.Denials) != len(reasons) {
		t.Errorf("got %d distinct reasons, want %d — reasons must not be collapsed", len(d.Denials), len(reasons))
	}
	if d.DenialReasonsOmitted != 0 {
		t.Errorf("DenialReasonsOmitted = %d, want 0", d.DenialReasonsOmitted)
	}
	if d.Totals.Denied != 7 {
		t.Errorf("denied total = %d, want 7", d.Totals.Denied)
	}
}

// ---------------------------------------------------------------------------
// Follow-up rows
// ---------------------------------------------------------------------------

// TestFollowupRowsAreNotCountedAsActivity: RecordDispatchOutcome and
// ReconcileLateAck append rows carrying a COPY of the original command. They
// are the same event, seen later — counting them would inflate every open by
// its delivery outcome.
func TestFollowupRowsAreNotCountedAsActivity(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()
	orig := f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+10)
	if _, err := f.s.RecordDispatchOutcome(ctx, orig, "undelivered"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.ReconcileLateAck(ctx, orig, "denied", "obstruction", f.dayStart+20); err != nil {
		t.Fatal(err)
	}

	d := mustInsights(t, f, f.acctA.ID, 7)
	if d.Totals.Opens != 1 {
		t.Errorf("opens = %d, want 1 — follow-up rows were counted as activity", d.Totals.Opens)
	}
	if d.Totals.Denied != 0 {
		t.Errorf("denied = %d, want 0 — a late-ack row is not a policy denial", d.Totals.Denied)
	}
	tags := map[string]int64{}
	for _, fu := range d.Followups {
		tags[fu.Tag] = fu.Count
	}
	if tags["undelivered"] != 1 || tags["late_ack:denied:obstruction"] != 1 {
		t.Errorf("follow-up outcomes not reported separately: %+v", d.Followups)
	}
	if len(d.Denials) != 0 {
		t.Errorf("late-ack row leaked into denial reasons: %+v", d.Denials)
	}
}

// ---------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------

// TestAnalyticsIsReadOnly: access_logs is append-only and hash chained. Every
// analytics call must leave both the row count and the chain untouched — the
// triggers would abort a write, but this asserts the intent directly rather
// than relying on a test that would only fail loudly by accident.
func TestAnalyticsIsReadOnly(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()
	orig := f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+10)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", false, "rate_limited", f.dayStart+20)
	if _, err := f.s.RecordDispatchOutcome(ctx, orig, "undelivered"); err != nil {
		t.Fatal(err)
	}

	count := func() (int, string) {
		t.Helper()
		var n int
		var last string
		if err := f.s.db.QueryRowContext(ctx, `SELECT count(*) FROM access_logs`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if err := f.s.db.QueryRowContext(ctx,
			`SELECT row_hash FROM access_logs ORDER BY rowid DESC LIMIT 1`).Scan(&last); err != nil {
			t.Fatal(err)
		}
		return n, last
	}
	beforeN, beforeHash := count()

	if _, err := f.s.AccountInsights(ctx, f.acctA.ID, f.window(t, 30), f.now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.AccountActivitySummary(ctx, f.acctA.ID, 50, f.now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.LocationActivitySummary(ctx, f.acctA.ID, f.locA.ID, f.window(t, 30), f.now); err != nil {
		t.Fatal(err)
	}

	afterN, afterHash := count()
	if afterN != beforeN || afterHash != beforeHash {
		t.Fatalf("analytics mutated access_logs: rows %d→%d, head hash %q→%q", beforeN, afterN, beforeHash, afterHash)
	}
	res, err := f.s.VerifyAccessLogHashChain(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK {
		t.Fatalf("hash chain broken after analytics reads: %+v", res.Break)
	}
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

func TestAnalyticsBreakdownsAndMembers(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()
	second, err := f.s.CreateAccessPointFull(ctx, f.acctA.ID, f.locA.ID, "Side door", "door", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	member, err := f.s.CreateUser(ctx, "m@an.com", "h", "M", "")
	if err != nil {
		t.Fatal(err)
	}

	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+10)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+20)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+25)
	f.log(t, f.acctA, f.locA, second, member.ID, "open", true, "", f.dayStart+30)
	// A visitor open (temporary grant / chat visitor): no user id at all.
	f.log(t, f.acctA, f.locA, second, "", "open", true, "", f.dayStart+40)

	d := mustInsights(t, f, f.acctA.ID, 7)
	if len(d.AccessPoints) != 2 {
		t.Fatalf("access point breakdown: %+v", d.AccessPoints)
	}
	if d.AccessPoints[0].AccessPointID != f.apA.ID || d.AccessPoints[0].Opens != 3 {
		t.Errorf("breakdown not ordered by opens: %+v", d.AccessPoints)
	}
	if d.AccessPoints[0].AccessPointName == "" || d.AccessPoints[0].LocationName == "" {
		t.Errorf("breakdown missing names: %+v", d.AccessPoints[0])
	}

	var visitor, ownerRow *MemberActivity
	for i := range d.Members {
		switch d.Members[i].UserID {
		case "":
			visitor = &d.Members[i]
		case f.ownerA.ID:
			ownerRow = &d.Members[i]
		}
	}
	if visitor == nil || visitor.Opens != 1 {
		t.Errorf("visitor activity dropped from the member breakdown: %+v", d.Members)
	}
	if ownerRow == nil || ownerRow.Opens != 3 || ownerRow.Username == "" {
		t.Errorf("owner row: %+v", ownerRow)
	}
	// active_members counts identified members only — the visitor is real
	// activity but is not a member.
	if d.ActiveMembers != 2 {
		t.Errorf("ActiveMembers = %d, want 2", d.ActiveMembers)
	}
	if d.MemberCount != 1 {
		t.Errorf("MemberCount = %d, want 1 (only the owner joined the account)", d.MemberCount)
	}
}

func TestAnalyticsPreviousWindowComparison(t *testing.T) {
	f := newAnalyticsFixture(t)
	// 2 opens in the current 7-day window, 5 in the one before it.
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart+10)
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart-DayS)
	for i := range 5 {
		f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.dayStart-int64(8+i)*DayS)
	}
	d := mustInsights(t, f, f.acctA.ID, 7)
	if d.Totals.Opens != 2 {
		t.Errorf("current window opens = %d, want 2", d.Totals.Opens)
	}
	if !d.PrevObserved || d.PrevTotals.Opens != 5 {
		t.Errorf("previous window: observed=%v totals=%+v, want 5 opens", d.PrevObserved, d.PrevTotals)
	}
}

// Past the cap, the breakdown says it was capped.
//
// # Why this was worth writing
//
// accessPointBreakdown fetches analyticsTopN+1 rows precisely so it can tell
// the difference between "these are all of them" and "these are the busiest
// twenty", and returns a bool saying which. Nothing asserted that bool on
// either side of the wire: the flag reached the response, the console's type
// never named it, and a capped list rendered as the complete list.
//
// docs/CHAT-COMMANDS.md states the rule the hub is obeying here — "Aggregate,
// cap and say so" — and a table that simply ends says the opposite of that.
func TestTheAccessPointBreakdownReportsItsOwnCap(t *testing.T) {
	f := newAnalyticsFixture(t)
	ctx := context.Background()

	// Under the cap: complete, and it says so by NOT claiming truncation.
	f.log(t, f.acctA, f.locA, f.apA, f.ownerA.ID, "open", true, "", f.now-60)
	d := mustInsights(t, f, f.acctA.ID, 7)
	if d.AccessPointsTruncated {
		t.Fatalf("a single access point reported as truncated")
	}
	if len(d.AccessPoints) != 1 {
		t.Fatalf("breakdown has %d rows, want 1", len(d.AccessPoints))
	}

	// One more access point than the cap, each with an open so it appears.
	for i := 0; i < analyticsTopN+1; i++ {
		ap, err := f.s.CreateAccessPointFull(ctx, f.acctA.ID, f.locA.ID,
			fmt.Sprintf("Gate %02d", i), "gate", "", nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		f.log(t, f.acctA, f.locA, ap, f.ownerA.ID, "open", true, "", f.now-60)
	}

	d = mustInsights(t, f, f.acctA.ID, 7)
	if len(d.AccessPoints) != analyticsTopN {
		t.Errorf("breakdown returned %d rows, want the cap of %d", len(d.AccessPoints), analyticsTopN)
	}
	if !d.AccessPointsTruncated {
		t.Fatal("more access points than the cap and the breakdown does not say it was " +
			"capped — the caller cannot tell the busiest twenty from all of them")
	}
}
