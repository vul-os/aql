package store

// Analytics: read-only summaries over the audit rows in access_logs.
//
// THREE RULES, AND THEY ARE THE WHOLE FILE
//
//  1. READ-ONLY, WITHOUT EXCEPTION. access_logs is append-only and hash
//     chained (see audithash.go and migrations/0007), enforced by database
//     triggers, not by convention. Nothing here writes, updates or deletes a
//     row in access_logs or admin_audit_log — every statement below is a
//     SELECT. A summary that mutated the thing it summarises would break the
//     chain for every row after it, which is precisely the failure mode 0007
//     exists to make impossible.
//
//  2. ACCOUNT-SCOPED, WITHOUT EXCEPTION. Every statement filters
//     access_logs.account_id = ?, including the location-keyed ones (which
//     filter on BOTH account and location). An aggregate leaks exactly as
//     much as a detail view does — "3 opens" computed across two tenants is
//     still one tenant learning a fact about another — and a summary is the
//     easiest place to be careless, because nothing in the output looks like
//     another tenant's data. The scope is in the SQL rather than only in the
//     handler so a future caller cannot forget it.
//
//  3. A GAP IS NOT A ZERO. This follows internal/energy's discipline
//     verbatim (see its package doc: "A gap is not a zero"). A day the audit
//     trail cannot speak about reports nil counts, not 0 — 0 means "the log
//     was recording and nothing happened", nil means "we have no record of
//     this period at all". [Coverage] is what tells the two apart, and it is
//     returned alongside every summary so a caller cannot render one without
//     the other being right there.
//
// BOUNDS. Every query is bounded by a half-open [FromTS, ToTS) window of
// whole UTC days, capped at [AnalyticsMaxWindowDays]. This hub runs on a
// Raspberry Pi that also opens gates: an unbounded scan across years of audit
// rows is a denial of service against the physical thing. A caller asking for
// more than the cap is REFUSED ([ErrAnalyticsWindowTooLarge]) rather than
// silently clamped, so a caller never believes it received 365 days of data
// when it received 90.
//
// DENIAL REASONS ARE NEVER SMOOTHED. The reason vocabulary from
// [Store.LogAccess] — rate_limited, quota_exceeded, account_suspended,
// user_disabled — is reported verbatim, grouped by the exact string in the
// error column. Collapsing them into "denied" would delete the only thing
// that makes the number actionable: a quota denial is a policy conversation,
// a suspension is a billing/abuse conversation, and a bad window is a
// configuration bug. When more distinct reasons exist than can be returned,
// the omitted DISTINCT-reason count is reported (never folded into a generic
// bucket).
//
// FOLLOW-UP ROWS ARE NOT DOUBLE-COUNTED. store.RecordDispatchOutcome and
// store.ReconcileLateAck append NEW rows carrying a copy of the original
// row's command/account/etc. and a non-null reconciles_log_id (they cannot
// mutate the original — see openpath.go). Counting them as activity would
// inflate every open by its delivery outcome, so the primary series filters
// reconciles_log_id IS NULL, and the follow-ups are reported separately as
// their own fact ([AccountInsightsData.Followups]) rather than dropped.

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Caps and defaults. These are the published contract for every analytics
// endpoint; the HTTP layer maps the errors below to 400s naming the cap.
const (
	// AnalyticsMaxWindowDays is the widest window any analytics query will
	// answer. Asking for more is refused, not clamped.
	AnalyticsMaxWindowDays = 90
	// AnalyticsDefaultInsightDays is the account-insights default window.
	AnalyticsDefaultInsightDays = 7
	// AnalyticsDefaultLocationDays is the location-summary default window.
	AnalyticsDefaultLocationDays = 30
	// AnalyticsMaxRecentActivity caps the recent-activity feed.
	AnalyticsMaxRecentActivity = 100
	// AnalyticsDefaultRecentActivity is that feed's default length.
	AnalyticsDefaultRecentActivity = 20

	// analyticsTopN bounds every "top X" breakdown (access points, members).
	analyticsTopN = 20
	// analyticsMaxReasons bounds the denial-reason breakdown. The vocabulary
	// LogAccess can produce is far smaller than this; the cap exists so a
	// database that somehow contains many distinct error strings cannot
	// return an unbounded result set.
	analyticsMaxReasons = 50
)

var (
	// ErrAnalyticsWindowTooLarge is returned for a window wider than
	// AnalyticsMaxWindowDays. The request is refused, never truncated.
	ErrAnalyticsWindowTooLarge = errors.New("store: analytics window exceeds cap")
	// ErrAnalyticsWindowInvalid is returned for a window of less than one day.
	ErrAnalyticsWindowInvalid = errors.New("store: analytics window must be at least one day")
	// ErrAnalyticsLimitTooLarge is returned for a row limit above
	// AnalyticsMaxRecentActivity.
	ErrAnalyticsLimitTooLarge = errors.New("store: analytics row limit exceeds cap")
)

// AnalyticsWindow is a half-open [FromTS, ToTS) range of whole UTC days.
// UTC, not local time, because the enforcement counters this data comes from
// use UTC fixed windows (FixedWindowStart) — reporting on a different day
// boundary than the one the quotas are enforced on would produce a chart that
// disagrees with the limits page for no visible reason.
type AnalyticsWindow struct {
	Days   int
	FromTS int64
	ToTS   int64 // exclusive; the end of the day containing nowUnix
}

// NewAnalyticsWindow builds the window of `days` whole UTC days ending with
// (and including) the day containing nowUnix.
//
// days <= 0 → ErrAnalyticsWindowInvalid; days > AnalyticsMaxWindowDays →
// ErrAnalyticsWindowTooLarge. Refusal, not clamping: a caller must never
// believe it got a wider window than it did.
func NewAnalyticsWindow(nowUnix int64, days int) (AnalyticsWindow, error) {
	if days <= 0 {
		return AnalyticsWindow{}, ErrAnalyticsWindowInvalid
	}
	if days > AnalyticsMaxWindowDays {
		return AnalyticsWindow{}, ErrAnalyticsWindowTooLarge
	}
	end := FixedWindowStart(nowUnix, DayS) + DayS
	return AnalyticsWindow{Days: days, FromTS: end - int64(days)*DayS, ToTS: end}, nil
}

// Previous returns the window of equal length immediately before w — the
// comparison period for week-over-week style deltas.
func (w AnalyticsWindow) Previous() AnalyticsWindow {
	span := int64(w.Days) * DayS
	return AnalyticsWindow{Days: w.Days, FromTS: w.FromTS - span, ToTS: w.FromTS}
}

// checkRecentLimit validates a feed limit against the cap.
func checkRecentLimit(limit int) (int, error) {
	if limit <= 0 {
		return AnalyticsDefaultRecentActivity, nil
	}
	if limit > AnalyticsMaxRecentActivity {
		return 0, ErrAnalyticsLimitTooLarge
	}
	return limit, nil
}

// ---------------------------------------------------------------------------
// Coverage — what the audit trail can actually speak about
// ---------------------------------------------------------------------------

// Coverage is the honesty record attached to every summary: it says from when
// this subject's audit trail is able to distinguish "nothing happened" from
// "nothing was recorded".
//
// ObservedFrom is min(subject creation, first recorded row). Creation time is
// used because access_logs is append-only and undeletable in THIS database
// (0007's triggers), so once an account exists here, the absence of a row
// after that instant is real evidence of no activity. The first recorded row
// is used as well, and takes over when it is EARLIER, because imported or
// backfilled history can predate the row it belongs to.
//
// Before ObservedFrom nothing is asserted: counts are nil, not zero.
type Coverage struct {
	// CreatedAt is when the subject (account or location) came into
	// existence in this database.
	CreatedAt int64
	// FirstRecordedAt / LastRecordedAt bound the audit rows that actually
	// exist for this subject. Invalid when the subject has never recorded
	// anything at all.
	FirstRecordedAt sql.NullInt64
	LastRecordedAt  sql.NullInt64
	// ObservedFrom is the earliest instant a zero may honestly be reported.
	ObservedFrom int64
}

// EverRecorded reports whether this subject has ANY audit row. False means
// every count in the response is a statement about an empty log, which is a
// materially different thing from a quiet week.
func (c Coverage) EverRecorded() bool { return c.FirstRecordedAt.Valid }

// DayObserved reports whether the UTC day starting at dayStart overlaps the
// covered period at all.
func (c Coverage) DayObserved(dayStart int64) bool { return dayStart+DayS > c.ObservedFrom }

// DayPartial reports whether an observed day is only partly covered — either
// coverage begins part-way into it, or it is the day currently in progress.
func (c Coverage) DayPartial(dayStart, nowUnix int64) bool {
	if !c.DayObserved(dayStart) {
		return false
	}
	return c.ObservedFrom > dayStart || nowUnix < dayStart+DayS
}

func (s *Store) coverage(ctx context.Context, createdAtSQL string, minMaxSQL string, args ...any) (Coverage, error) {
	var c Coverage
	if err := s.db.QueryRowContext(ctx, createdAtSQL, args...).Scan(&c.CreatedAt); err != nil {
		return Coverage{}, err // ErrNotFound: subject does not exist (in this account)
	}
	if err := s.db.QueryRowContext(ctx, minMaxSQL, args...).Scan(&c.FirstRecordedAt, &c.LastRecordedAt); err != nil {
		return Coverage{}, err
	}
	c.ObservedFrom = c.CreatedAt
	if c.FirstRecordedAt.Valid && c.FirstRecordedAt.Int64 < c.ObservedFrom {
		c.ObservedFrom = c.FirstRecordedAt.Int64
	}
	return c, nil
}

// AccountCoverage reports the observable period for one account.
func (s *Store) AccountCoverage(ctx context.Context, accountID string) (Coverage, error) {
	return s.coverage(ctx,
		`SELECT created_at FROM accounts WHERE id = ?`,
		`SELECT min(ts), max(ts) FROM access_logs WHERE account_id = ?`,
		accountID)
}

// LocationCoverage reports the observable period for one location, scoped to
// its account: a location id from another tenant reads as not-found, and the
// audit rows counted are filtered on account_id as well as location_id.
func (s *Store) LocationCoverage(ctx context.Context, accountID, locationID string) (Coverage, error) {
	var c Coverage
	if err := s.db.QueryRowContext(ctx,
		`SELECT created_at FROM locations WHERE id = ? AND account_id = ?`, locationID, accountID).
		Scan(&c.CreatedAt); err != nil {
		return Coverage{}, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT min(ts), max(ts) FROM access_logs WHERE account_id = ? AND location_id = ?`,
		accountID, locationID).Scan(&c.FirstRecordedAt, &c.LastRecordedAt); err != nil {
		return Coverage{}, err
	}
	c.ObservedFrom = c.CreatedAt
	if c.FirstRecordedAt.Valid && c.FirstRecordedAt.Int64 < c.ObservedFrom {
		c.ObservedFrom = c.FirstRecordedAt.Int64
	}
	return c, nil
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

// WindowTotals is the four-way split of attempts in a period. The two denied
// counts are kept apart from the two successful ones AND from each other:
// a denied close is a different fact from a denied open, and neither is
// allowed to disappear into a total.
type WindowTotals struct {
	Opens        int64 // command=open, success
	Denied       int64 // command=open, denied
	Closes       int64 // command=close, success
	DeniedCloses int64 // command=close, denied (rare: close is never rate limited)
}

// DayActivity is one UTC day of the series. Opens/Denied/Closes/DeniedCloses
// are nil — NOT zero — for a day the audit trail cannot speak about (see
// [Coverage]). Partial marks a day that is only partly covered: the day
// currently in progress, or the day coverage began part-way through. Its
// counts are a FLOOR, exactly as a partially covered energy bucket is.
type DayActivity struct {
	Day          string // YYYY-MM-DD, UTC
	DayStart     int64
	Observed     bool
	Partial      bool
	Opens        *int64
	Denied       *int64
	Closes       *int64
	DeniedCloses *int64
}

// SeriesQuality summarises a day series the way energy.Quality summarises a
// rollup: "no_data" when nothing in the range is observable, "partial" when
// some of it is, "complete" when all of it is.
func SeriesQuality(days []DayActivity) string {
	observed, partial := 0, false
	for _, d := range days {
		if d.Observed {
			observed++
			if d.Partial {
				partial = true
			}
		}
	}
	switch {
	case observed == 0:
		return "no_data"
	case observed < len(days) || partial:
		return "partial"
	default:
		return "complete"
	}
}

// AccessPointActivity is one row of the per-access-point breakdown. Deleted
// is true when the access point itself is gone (access_points is ON DELETE
// SET NULL against access_logs) and the row is identified by its permanent
// insert-time snapshot instead — history survives deletes, and saying so is
// better than showing an unnamed bar.
type AccessPointActivity struct {
	AccessPointID   string
	AccessPointName string // "" when deleted
	LocationID      string
	LocationName    string
	Deleted         bool
	Opens           int64
	Denied          int64
}

// MemberActivity is one row of the per-member breakdown. UserID "" is the
// visitor path (temporary grants, chat visitors) — real activity by someone
// who is not a member, reported as its own row rather than dropped.
type MemberActivity struct {
	UserID      string
	Username    string // "" when the user row is gone, or for visitors
	DisplayName string
	Deleted     bool
	Opens       int64
	Denied      int64
}

// DenialReason is one exact denial reason and its count. Reason is the raw
// access_logs.error value ("rate_limited", "quota_exceeded",
// "account_suspended", "user_disabled", ...) and is never rewritten.
type DenialReason struct {
	Reason string
	Count  int64
}

// FollowupOutcome is one delivery/reconciliation tag from the append-only
// follow-up rows (reconciles_log_id IS NOT NULL): "undelivered",
// "ack:denied:...", "late_ack:opened", and so on. These are excluded from the
// activity counts (they would double-count the original attempt) and reported
// here instead.
type FollowupOutcome struct {
	Tag   string
	Count int64
}

// RecentActivity is one audit row, resolved for display. ReconcilesLogID is
// non-empty for a follow-up row, so a reader can see why two lines describe
// one command instead of guessing.
type RecentActivity struct {
	ID              string
	TS              int64
	Command         string
	Source          string
	Success         bool
	Error           string
	AccessPointID   string
	AccessPointName string
	LocationID      string
	LocationName    string
	UserID          string
	Username        string
	DisplayName     string
	ReconcilesLogID string
}

// AccountInsightsData is the account-level analytics answer.
type AccountInsightsData struct {
	Window       AnalyticsWindow
	Coverage     Coverage
	Days         []DayActivity
	Totals       WindowTotals
	PrevWindow   AnalyticsWindow
	PrevTotals   WindowTotals
	PrevObserved bool // false = the comparison period predates coverage

	AccessPoints          []AccessPointActivity
	AccessPointsTruncated bool
	Members               []MemberActivity
	MembersTruncated      bool
	Denials               []DenialReason
	DenialReasonsOmitted  int
	Followups             []FollowupOutcome

	MemberCount   int
	ActiveMembers int // distinct members with a successful open in the window
}

// AccountSummaryData is the overview answer: today vs yesterday, the counts
// the console header shows, and the recent feed.
type AccountSummaryData struct {
	Coverage          Coverage
	TodayStart        int64
	YesterdayStart    int64
	Today             WindowTotals
	Yesterday         WindowTotals
	TodayObserved     bool
	YesterdayObserved bool
	LocationCount     int
	MemberCount       int
	Recent            []RecentActivity
	RecentLimit       int
}

// LocationSummaryData is the per-location answer, bounded to a window like
// everything else here.
type LocationSummaryData struct {
	Window               AnalyticsWindow
	Coverage             Coverage
	Totals               WindowTotals
	Days                 []DayActivity
	TodayStart           int64
	TodayOpens           int64
	TodayObserved        bool
	Denials              []DenialReason
	DenialReasonsOmitted int
	Followups            []FollowupOutcome
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// activityTotals is the four-way split over one window. Follow-up rows are
// excluded (see the file header).
const activityTotalsCols = `
	   count(*) FILTER (WHERE command = 'open'  AND success = 1),
	   count(*) FILTER (WHERE command = 'open'  AND success = 0),
	   count(*) FILTER (WHERE command = 'close' AND success = 1),
	   count(*) FILTER (WHERE command = 'close' AND success = 0)`

func (s *Store) windowTotals(ctx context.Context, extraWhere string, args ...any) (WindowTotals, error) {
	var t WindowTotals
	err := s.db.QueryRowContext(ctx,
		`SELECT`+activityTotalsCols+`
		 FROM access_logs
		 WHERE account_id = ? AND reconciles_log_id IS NULL AND ts >= ? AND ts < ?`+extraWhere,
		args...).Scan(&t.Opens, &t.Denied, &t.Closes, &t.DeniedCloses)
	return t, err
}

// dailySeries builds the full calendar of the window: every day present,
// counts filled from the audit rows, and days outside coverage left nil.
func (s *Store) dailySeries(ctx context.Context, w AnalyticsWindow, cov Coverage, nowUnix int64,
	extraWhere string, args ...any) ([]DayActivity, error) {

	rows, err := s.db.QueryContext(ctx,
		`SELECT (ts / 86400) * 86400 AS day_start,`+activityTotalsCols+`
		 FROM access_logs
		 WHERE account_id = ? AND reconciles_log_id IS NULL AND ts >= ? AND ts < ?`+extraWhere+`
		 GROUP BY day_start`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type counts struct{ opens, denied, closes, deniedCloses int64 }
	byDay := map[int64]counts{}
	for rows.Next() {
		var ds int64
		var c counts
		if err := rows.Scan(&ds, &c.opens, &c.denied, &c.closes, &c.deniedCloses); err != nil {
			return nil, err
		}
		byDay[ds] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]DayActivity, 0, w.Days)
	for ds := w.FromTS; ds < w.ToTS; ds += DayS {
		d := DayActivity{
			Day:      time.Unix(ds, 0).UTC().Format("2006-01-02"),
			DayStart: ds,
			Observed: cov.DayObserved(ds),
			Partial:  cov.DayPartial(ds, nowUnix),
		}
		if d.Observed {
			// Zero here is a real zero: the log was recording and nothing
			// happened. Outside coverage the fields stay nil.
			c := byDay[ds]
			opens, denied, closes, deniedCloses := c.opens, c.denied, c.closes, c.deniedCloses
			d.Opens, d.Denied, d.Closes, d.DeniedCloses = &opens, &denied, &closes, &deniedCloses
		}
		out = append(out, d)
	}
	return out, nil
}

// denialReasons groups denied attempts by their EXACT error string.
func (s *Store) denialReasons(ctx context.Context, extraWhere string, args ...any) ([]DenialReason, int, error) {
	where := `WHERE account_id = ? AND reconciles_log_id IS NULL AND success = 0 AND ts >= ? AND ts < ?` + extraWhere
	var distinct int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(DISTINCT coalesce(nullif(error, ''), 'unspecified')) FROM access_logs `+where,
		args...).Scan(&distinct); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT coalesce(nullif(error, ''), 'unspecified') AS reason, count(*) AS n
		 FROM access_logs `+where+`
		 GROUP BY reason ORDER BY n DESC, reason ASC LIMIT ?`,
		append(args, analyticsMaxReasons)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []DenialReason
	for rows.Next() {
		var d DenialReason
		if err := rows.Scan(&d.Reason, &d.Count); err != nil {
			return nil, 0, err
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	omitted := distinct - len(out)
	if omitted < 0 {
		omitted = 0
	}
	return out, omitted, nil
}

// followupOutcomes groups the append-only follow-up rows by their tag.
func (s *Store) followupOutcomes(ctx context.Context, extraWhere string, args ...any) ([]FollowupOutcome, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT coalesce(nullif(error, ''), 'unspecified') AS tag, count(*) AS n
		 FROM access_logs
		 WHERE account_id = ? AND reconciles_log_id IS NOT NULL AND ts >= ? AND ts < ?`+extraWhere+`
		 GROUP BY tag ORDER BY n DESC, tag ASC LIMIT ?`,
		append(args, analyticsMaxReasons)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FollowupOutcome
	for rows.Next() {
		var f FollowupOutcome
		if err := rows.Scan(&f.Tag, &f.Count); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Account insights
// ---------------------------------------------------------------------------

// AccountInsights summarises one account's audit rows over w. Read-only, and
// every statement it runs is filtered on account_id.
//
// nowUnix is the clock to interpret the window against (0 = wall clock),
// injectable so tests can pin it.
func (s *Store) AccountInsights(ctx context.Context, accountID string, w AnalyticsWindow, nowUnix int64) (*AccountInsightsData, error) {
	if w.Days <= 0 {
		return nil, ErrAnalyticsWindowInvalid
	}
	if w.Days > AnalyticsMaxWindowDays {
		return nil, ErrAnalyticsWindowTooLarge
	}
	if nowUnix == 0 {
		nowUnix = now()
	}
	cov, err := s.AccountCoverage(ctx, accountID)
	if err != nil {
		return nil, err
	}
	d := &AccountInsightsData{Window: w, Coverage: cov, PrevWindow: w.Previous()}

	args := []any{accountID, w.FromTS, w.ToTS}

	if d.Days, err = s.dailySeries(ctx, w, cov, nowUnix, "", args...); err != nil {
		return nil, err
	}
	// Totals come from the same rows the series does — one source, so the
	// bars and the headline can never disagree.
	for _, day := range d.Days {
		if day.Opens != nil {
			d.Totals.Opens += *day.Opens
			d.Totals.Denied += *day.Denied
			d.Totals.Closes += *day.Closes
			d.Totals.DeniedCloses += *day.DeniedCloses
		}
	}

	prev := d.PrevWindow
	// The comparison window is only meaningful where it is covered; when it
	// predates coverage the counts are reported as unobserved rather than as
	// a zero baseline that would invent a 100% week-over-week rise.
	d.PrevObserved = cov.DayObserved(prev.ToTS - DayS)
	if d.PrevObserved {
		if d.PrevTotals, err = s.windowTotals(ctx, "", accountID, prev.FromTS, prev.ToTS); err != nil {
			return nil, err
		}
	}

	if d.AccessPoints, d.AccessPointsTruncated, err = s.accessPointBreakdown(ctx, accountID, w); err != nil {
		return nil, err
	}
	if d.Members, d.MembersTruncated, err = s.memberBreakdown(ctx, accountID, w); err != nil {
		return nil, err
	}
	if d.Denials, d.DenialReasonsOmitted, err = s.denialReasons(ctx, "", args...); err != nil {
		return nil, err
	}
	if d.Followups, err = s.followupOutcomes(ctx, "", args...); err != nil {
		return nil, err
	}

	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM account_members WHERE account_id = ? AND status = 'active'`,
		accountID).Scan(&d.MemberCount); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(DISTINCT coalesce(user_id, user_id_snapshot))
		 FROM access_logs
		 WHERE account_id = ? AND reconciles_log_id IS NULL AND command = 'open' AND success = 1
		   AND ts >= ? AND ts < ? AND coalesce(user_id, user_id_snapshot, '') <> ''`,
		args...).Scan(&d.ActiveMembers); err != nil {
		return nil, err
	}
	return d, nil
}

// accessPointBreakdown groups the window's opens/denials by access point.
// Identity falls back to access_point_id_snapshot so a deleted access point
// keeps its own row instead of collapsing into one anonymous bucket.
func (s *Store) accessPointBreakdown(ctx context.Context, accountID string, w AnalyticsWindow) ([]AccessPointActivity, bool, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT coalesce(al.access_point_id, al.access_point_id_snapshot, '') AS ap_key,
		        al.access_point_id IS NULL AS deleted,
		        coalesce(ap.name, ''),
		        coalesce(al.location_id, al.location_id_snapshot, ''),
		        coalesce(l.name, ''),
		        count(*) FILTER (WHERE al.command = 'open' AND al.success = 1) AS opens,
		        count(*) FILTER (WHERE al.command = 'open' AND al.success = 0) AS denied
		 FROM access_logs al
		 LEFT JOIN access_points ap ON ap.id = al.access_point_id
		 LEFT JOIN locations l ON l.id = al.location_id
		 WHERE al.account_id = ? AND al.reconciles_log_id IS NULL AND al.ts >= ? AND al.ts < ?
		 GROUP BY ap_key
		 ORDER BY opens DESC, denied DESC, ap_key ASC
		 LIMIT ?`,
		accountID, w.FromTS, w.ToTS, analyticsTopN+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []AccessPointActivity
	for rows.Next() {
		var a AccessPointActivity
		var deleted int
		if err := rows.Scan(&a.AccessPointID, &deleted, &a.AccessPointName,
			&a.LocationID, &a.LocationName, &a.Opens, &a.Denied); err != nil {
			return nil, false, err
		}
		a.Deleted = deleted != 0
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(out) > analyticsTopN
	if truncated {
		out = out[:analyticsTopN]
	}
	return out, truncated, nil
}

// memberBreakdown groups the window's opens/denials by who did them. The
// visitor bucket (no user id) is kept as its own row.
func (s *Store) memberBreakdown(ctx context.Context, accountID string, w AnalyticsWindow) ([]MemberActivity, bool, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT coalesce(al.user_id, al.user_id_snapshot, '') AS user_key,
		        (al.user_id IS NULL AND coalesce(al.user_id_snapshot, '') <> '') AS deleted,
		        coalesce(u.username, ''), coalesce(p.display_name, ''),
		        count(*) FILTER (WHERE al.command = 'open' AND al.success = 1) AS opens,
		        count(*) FILTER (WHERE al.command = 'open' AND al.success = 0) AS denied
		 FROM access_logs al
		 LEFT JOIN users u ON u.id = al.user_id
		 LEFT JOIN profiles p ON p.id = al.user_id
		 WHERE al.account_id = ? AND al.reconciles_log_id IS NULL AND al.ts >= ? AND al.ts < ?
		 GROUP BY user_key
		 ORDER BY opens DESC, denied DESC, user_key ASC
		 LIMIT ?`,
		accountID, w.FromTS, w.ToTS, analyticsTopN+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []MemberActivity
	for rows.Next() {
		var m MemberActivity
		var deleted int
		if err := rows.Scan(&m.UserID, &deleted, &m.Username, &m.DisplayName, &m.Opens, &m.Denied); err != nil {
			return nil, false, err
		}
		m.Deleted = deleted != 0
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(out) > analyticsTopN
	if truncated {
		out = out[:analyticsTopN]
	}
	return out, truncated, nil
}

// ---------------------------------------------------------------------------
// Account summary (overview)
// ---------------------------------------------------------------------------

// AccountActivitySummary is today vs yesterday plus the recent feed, all
// account-scoped. recentLimit above AnalyticsMaxRecentActivity is refused.
func (s *Store) AccountActivitySummary(ctx context.Context, accountID string, recentLimit int, nowUnix int64) (*AccountSummaryData, error) {
	limit, err := checkRecentLimit(recentLimit)
	if err != nil {
		return nil, err
	}
	if nowUnix == 0 {
		nowUnix = now()
	}
	cov, err := s.AccountCoverage(ctx, accountID)
	if err != nil {
		return nil, err
	}
	todayStart := FixedWindowStart(nowUnix, DayS)
	yesterdayStart := todayStart - DayS
	d := &AccountSummaryData{
		Coverage: cov, TodayStart: todayStart, YesterdayStart: yesterdayStart,
		RecentLimit: limit,
		// Observed flags travel WITH the counts: a zero next to
		// observed=false is "we have no record of that day", not "nothing
		// happened". Both fields are always emitted for exactly that reason.
		TodayObserved:     cov.DayObserved(todayStart),
		YesterdayObserved: cov.DayObserved(yesterdayStart),
	}
	if d.Today, err = s.windowTotals(ctx, "", accountID, todayStart, todayStart+DayS); err != nil {
		return nil, err
	}
	if d.Yesterday, err = s.windowTotals(ctx, "", accountID, yesterdayStart, todayStart); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM locations WHERE account_id = ?`, accountID).Scan(&d.LocationCount); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM account_members WHERE account_id = ? AND status = 'active'`,
		accountID).Scan(&d.MemberCount); err != nil {
		return nil, err
	}
	if d.Recent, err = s.accountRecentActivity(ctx, accountID, limit); err != nil {
		return nil, err
	}
	return d, nil
}

// accountRecentActivity is the account-scoped feed. Follow-up rows are
// INCLUDED here (unlike in the counts) because they are real events an
// operator needs to see — each carries its reconciles_log_id so the linkage
// is visible rather than looking like a duplicate.
func (s *Store) accountRecentActivity(ctx context.Context, accountID string, limit int) ([]RecentActivity, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT al.id, al.ts, coalesce(al.command, ''), coalesce(al.source, ''), al.success,
		        coalesce(al.error, ''),
		        coalesce(al.access_point_id, al.access_point_id_snapshot, ''), coalesce(ap.name, ''),
		        coalesce(al.location_id, al.location_id_snapshot, ''), coalesce(l.name, ''),
		        coalesce(al.user_id, al.user_id_snapshot, ''), coalesce(u.username, ''),
		        coalesce(p.display_name, ''), coalesce(al.reconciles_log_id, '')
		 FROM access_logs al
		 LEFT JOIN access_points ap ON ap.id = al.access_point_id
		 LEFT JOIN locations l ON l.id = al.location_id
		 LEFT JOIN users u ON u.id = al.user_id
		 LEFT JOIN profiles p ON p.id = al.user_id
		 WHERE al.account_id = ?
		 ORDER BY al.ts DESC, al.rowid DESC
		 LIMIT ?`, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RecentActivity
	for rows.Next() {
		var a RecentActivity
		var success int
		if err := rows.Scan(&a.ID, &a.TS, &a.Command, &a.Source, &success, &a.Error,
			&a.AccessPointID, &a.AccessPointName, &a.LocationID, &a.LocationName,
			&a.UserID, &a.Username, &a.DisplayName, &a.ReconcilesLogID); err != nil {
			return nil, err
		}
		a.Success = success != 0
		out = append(out, a)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Location summary
// ---------------------------------------------------------------------------

// LocationActivitySummary summarises one location over w. It takes the
// account id as well as the location id and filters on BOTH: the handler has
// already resolved the location's owner, and this is the second lock.
func (s *Store) LocationActivitySummary(ctx context.Context, accountID, locationID string, w AnalyticsWindow, nowUnix int64) (*LocationSummaryData, error) {
	if w.Days <= 0 {
		return nil, ErrAnalyticsWindowInvalid
	}
	if w.Days > AnalyticsMaxWindowDays {
		return nil, ErrAnalyticsWindowTooLarge
	}
	if nowUnix == 0 {
		nowUnix = now()
	}
	cov, err := s.LocationCoverage(ctx, accountID, locationID)
	if err != nil {
		return nil, err
	}
	const locWhere = ` AND location_id = ?`
	args := []any{accountID, w.FromTS, w.ToTS, locationID}

	d := &LocationSummaryData{Window: w, Coverage: cov, TodayStart: FixedWindowStart(nowUnix, DayS)}
	d.TodayObserved = cov.DayObserved(d.TodayStart)

	if d.Totals, err = s.windowTotals(ctx, locWhere, args...); err != nil {
		return nil, err
	}
	if d.Days, err = s.dailySeries(ctx, w, cov, nowUnix, locWhere, args...); err != nil {
		return nil, err
	}
	if d.Denials, d.DenialReasonsOmitted, err = s.denialReasons(ctx, locWhere, args...); err != nil {
		return nil, err
	}
	if d.Followups, err = s.followupOutcomes(ctx, locWhere, args...); err != nil {
		return nil, err
	}
	today, err := s.windowTotals(ctx, locWhere, accountID, d.TodayStart, d.TodayStart+DayS, locationID)
	if err != nil {
		return nil, err
	}
	d.TodayOpens = today.Opens
	return d, nil
}
