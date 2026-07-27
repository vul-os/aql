package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/vul-os/aql/gateway/internal/store"
)

// Analytics: read-only summaries over the append-only audit rows
// (access_logs), serving the three routes the console already has screens for:
//
//	GET /v1/analytics/accounts/{id}/summary   — overview: today vs yesterday + recent feed
//	GET /v1/analytics/accounts/{id}/insights  — the Analytics screen: series, breakdowns, denials
//	GET /v1/analytics/locations/{id}/summary  — one location, bounded window
//
// TENANCY. Every handler resolves membership FIRST (memberRole / locationScope,
// the same gates the rest of this package uses) and a non-member gets 404 —
// indistinguishable from not-found, no existence leak. The store methods
// underneath filter on account_id in SQL as well, including the
// location-keyed ones. An aggregate leaks exactly as much as a detail view;
// the fact that the output is a number rather than a row changes nothing.
//
// VISIBILITY. These reads are member-visible, not admin-only, matching
// GET /v1/locations/{id}/limits which already shows every member their
// co-members' open counts for the day. Nothing here exposes a fact a member
// cannot already obtain from that endpoint or from the access-point meters.
//
// A GAP IS NOT A ZERO. See store/analytics.go and internal/energy's package
// doc — this layer's job is only to keep that distinction visible on the
// wire. It does so in two ways:
//
//   - The day series carries JSON null (not 0) for a day outside coverage.
//     That is the place a confident zero would otherwise be DRAWN, as a bar
//     that says "nothing happened" when the truth is "nothing was recorded".
//   - Scalar totals stay numbers (a chart's headline cannot be nil without
//     the caller crashing), and every one of them travels next to the
//     coverage block plus an explicit `quality` of complete | partial |
//     no_data, and per-period `*_observed` booleans. A partially covered
//     total is a FLOOR, exactly as a partially covered energy rollup is.
//
// BOUNDS. `days` (window width) and `limit` (recent feed) are capped; over
// the cap is a 400 naming the cap, never a silent clamp. See
// store.AnalyticsMaxWindowDays / store.AnalyticsMaxRecentActivity.
//
// READ-ONLY. Nothing here writes anything, to the audit tables or otherwise —
// not even an admin-audit row, because reading a summary of your own account
// is not an administrative act.

// writeErrDetail is writeErr plus the machine-readable specifics of the
// refusal (the cap that was exceeded). Callers that only understand
// {"error": code} keep working unchanged.
func writeErrDetail(w http.ResponseWriter, status int, code string, detail map[string]any) {
	body := map[string]any{"error": code}
	for k, v := range detail {
		body[k] = v
	}
	writeJSON(w, status, body)
}

// analyticsWindow parses ?days= into a bounded window.
//
// Absent → def. Unparseable or < 1 → 400 invalid_days. Above the cap → 400
// range_too_large carrying max_days: the caller is REFUSED, not quietly
// given a narrower window it would then mislabel.
func analyticsWindow(w http.ResponseWriter, r *http.Request, def int) (store.AnalyticsWindow, bool) {
	days := def
	if raw := r.URL.Query().Get("days"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_days")
			return store.AnalyticsWindow{}, false
		}
		days = n
	}
	win, err := store.NewAnalyticsWindow(time.Now().Unix(), days)
	switch {
	case errors.Is(err, store.ErrAnalyticsWindowTooLarge):
		writeErrDetail(w, http.StatusBadRequest, "range_too_large", map[string]any{
			"max_days":       store.AnalyticsMaxWindowDays,
			"requested_days": days,
		})
		return store.AnalyticsWindow{}, false
	case errors.Is(err, store.ErrAnalyticsWindowInvalid):
		writeErr(w, http.StatusBadRequest, "invalid_days")
		return store.AnalyticsWindow{}, false
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal")
		return store.AnalyticsWindow{}, false
	}
	return win, true
}

// analyticsLimit parses ?limit= for the recent-activity feed under the same
// refuse-don't-clamp rule as the window.
func analyticsLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return store.AnalyticsDefaultRecentActivity, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		writeErr(w, http.StatusBadRequest, "invalid_limit")
		return 0, false
	}
	if n > store.AnalyticsMaxRecentActivity {
		writeErrDetail(w, http.StatusBadRequest, "limit_too_large", map[string]any{
			"max_limit":       store.AnalyticsMaxRecentActivity,
			"requested_limit": n,
		})
		return 0, false
	}
	return n, true
}

// ---------------------------------------------------------------------------
// JSON shapes
// ---------------------------------------------------------------------------

func windowJSON(w store.AnalyticsWindow) map[string]any {
	return map[string]any{
		"days":     w.Days,
		"from":     w.FromTS,
		"to":       w.ToTS, // exclusive
		"timezone": "UTC",  // day boundaries match the quota counters (FixedWindowStart)
		"max_days": store.AnalyticsMaxWindowDays,
	}
}

// coverageJSON is the honesty block. It is emitted on EVERY analytics
// response, never conditionally: a consumer must not have to ask for the
// thing that tells it whether a zero means anything.
func coverageJSON(c store.Coverage, observedDays, windowDays int, quality string) map[string]any {
	return map[string]any{
		"observed_from":     c.ObservedFrom,
		"created_at":        c.CreatedAt,
		"first_recorded_at": nullInt64(c.FirstRecordedAt),
		"last_recorded_at":  nullInt64(c.LastRecordedAt),
		// false = this subject has NEVER recorded an audit row. Materially
		// different from a quiet week, and the only way to say so.
		"ever_recorded": c.EverRecorded(),
		"observed_days": observedDays,
		"window_days":   windowDays,
		"quality":       quality, // complete | partial | no_data
		"note": "counts are null for days before observed_from: no record of that period exists, " +
			"which is not the same as nothing having happened",
	}
}

// dayJSON emits one bucket. opens/denied/closes are null — not 0 — outside
// coverage.
func dayJSON(d store.DayActivity) map[string]any {
	return map[string]any{
		"day":           d.Day, // YYYY-MM-DD, UTC
		"day_start":     d.DayStart,
		"observed":      d.Observed,
		"partial":       d.Partial, // counts are a floor: day in progress, or coverage began mid-day
		"opens":         nullableInt64(d.Opens),
		"denied":        nullableInt64(d.Denied),
		"closes":        nullableInt64(d.Closes),
		"denied_closes": nullableInt64(d.DeniedCloses),
	}
}

func nullableInt64(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}

func observedDayCount(days []store.DayActivity) int {
	n := 0
	for _, d := range days {
		if d.Observed {
			n++
		}
	}
	return n
}

// denialsJSON keeps every reason verbatim. "denied" as a single number is
// useless to an operator: a quota trip, a suspended account and a disabled
// user are three different problems with three different fixes.
func denialsJSON(rs []store.DenialReason, omitted int) map[string]any {
	list := make([]map[string]any, 0, len(rs))
	for _, r := range rs {
		list = append(list, map[string]any{"reason": r.Reason, "count": r.Count})
	}
	return map[string]any{
		"reasons": list,
		// Reasons beyond the cap are COUNTED as omitted rather than folded
		// into a catch-all bucket that would look like a real reason.
		"reasons_omitted": omitted,
	}
}

func followupsJSON(fs []store.FollowupOutcome) []map[string]any {
	list := make([]map[string]any, 0, len(fs))
	for _, f := range fs {
		list = append(list, map[string]any{"tag": f.Tag, "count": f.Count})
	}
	return list
}

func recentJSON(rs []store.RecentActivity) []map[string]any {
	list := make([]map[string]any, 0, len(rs))
	for _, a := range rs {
		list = append(list, map[string]any{
			"id":                a.ID,
			"ts":                a.TS,
			"command":           a.Command,
			"success":           a.Success,
			"error":             nilIfEmpty(a.Error),
			"source":            nilIfEmpty(a.Source),
			"access_point_id":   nilIfEmpty(a.AccessPointID),
			"access_point_name": nilIfEmpty(a.AccessPointName),
			"location_id":       nilIfEmpty(a.LocationID),
			"location_name":     nilIfEmpty(a.LocationName),
			"actor_user_id":     nilIfEmpty(a.UserID),
			// Identity on this hub is a local username, deliberately not an
			// email address (see migrations/0001's users comment), so that is
			// what is reported. There is no actor_email field because there
			// is no email.
			"actor_username":     nilIfEmpty(a.Username),
			"actor_display_name": nilIfEmpty(a.DisplayName),
			// Non-null = this row is a follow-up (delivery outcome or late
			// cmd.ack) appended against the id it corrects, not a second
			// command. Excluded from every count for that reason.
			"reconciles_log_id": nilIfEmpty(a.ReconcilesLogID),
		})
	}
	return list
}

// ---------------------------------------------------------------------------
// GET /v1/analytics/accounts/{id}/summary
// ---------------------------------------------------------------------------

func (s *Server) handleAnalyticsAccountSummary(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}
	limit, ok := analyticsLimit(w, r)
	if !ok {
		return
	}
	d, err := s.store.AccountActivitySummary(r.Context(), accountID, limit, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	// today/yesterday stay numeric (the console header formats them
	// directly), and each carries its own observed flag + the coverage block
	// so a 0 for an unrecorded day is never mistaken for a quiet one.
	writeJSON(w, http.StatusOK, map[string]any{
		"account_id":       accountID,
		"opens_today":      d.Today.Opens,
		"opens_yesterday":  d.Yesterday.Opens,
		"denied_today":     d.Today.Denied,
		"denied_yesterday": d.Yesterday.Denied,
		"closes_today":     d.Today.Closes,
		"today": map[string]any{
			"day_start":      time.Unix(d.TodayStart, 0).UTC().Format(time.RFC3339),
			"day_start_unix": d.TodayStart,
			"observed":       d.TodayObserved,
			"partial":        true, // the day is still in progress; counts are a floor
		},
		"yesterday": map[string]any{
			"day_start":      time.Unix(d.YesterdayStart, 0).UTC().Format(time.RFC3339),
			"day_start_unix": d.YesterdayStart,
			"observed":       d.YesterdayObserved,
		},
		"location_count":  d.LocationCount,
		"member_count":    d.MemberCount,
		"recent_activity": recentJSON(d.Recent),
		"recent_limit":    map[string]any{"limit": d.RecentLimit, "max_limit": store.AnalyticsMaxRecentActivity},
		"coverage":        coverageJSON(d.Coverage, observedTwoDay(d), 2, twoDayQuality(d)),
	})
}

// observedTwoDay / twoDayQuality describe the today+yesterday pair the
// summary reports on, in the same vocabulary the series uses. The pair is
// never "complete": today is still in progress, so its counts are a floor.
func observedTwoDay(d *store.AccountSummaryData) int {
	n := 0
	if d.TodayObserved {
		n++
	}
	if d.YesterdayObserved {
		n++
	}
	return n
}

func twoDayQuality(d *store.AccountSummaryData) string {
	if observedTwoDay(d) == 0 {
		return "no_data"
	}
	return "partial"
}

// ---------------------------------------------------------------------------
// GET /v1/analytics/accounts/{id}/insights
// ---------------------------------------------------------------------------

func (s *Server) handleAnalyticsAccountInsights(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}
	win, ok := analyticsWindow(w, r, store.AnalyticsDefaultInsightDays)
	if !ok {
		return
	}
	d, err := s.store.AccountInsights(r.Context(), accountID, win, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	days := make([]map[string]any, 0, len(d.Days))
	for _, day := range d.Days {
		days = append(days, dayJSON(day))
	}

	breakdown := make([]map[string]any, 0, len(d.AccessPoints))
	for _, a := range d.AccessPoints {
		breakdown = append(breakdown, map[string]any{
			"access_point_id":   nilIfEmpty(a.AccessPointID),
			"access_point_name": nilIfEmpty(a.AccessPointName),
			"location_id":       nilIfEmpty(a.LocationID),
			"location_name":     nilIfEmpty(a.LocationName),
			// The access point was deleted; the row survives via its
			// insert-time snapshot (access_logs is append-only).
			"deleted": a.Deleted,
			"opens":   a.Opens,
			"denied":  a.Denied,
		})
	}

	memberRows := make([]map[string]any, 0, len(d.Members))
	for _, m := range d.Members {
		memberRows = append(memberRows, map[string]any{
			"user_id":      nilIfEmpty(m.UserID),
			"username":     nilIfEmpty(m.Username),
			"display_name": nilIfEmpty(m.DisplayName),
			"deleted":      m.Deleted,
			// user_id null = the visitor path (temporary grant / chat
			// visitor): real activity by a non-member, kept as its own row.
			"visitor": m.UserID == "",
			"opens":   m.Opens,
			"denied":  m.Denied,
		})
	}

	quality := store.SeriesQuality(d.Days)
	totals := map[string]any{
		// *_7d names are the console's contract; the window is whatever
		// `days` asked for, and window.days states it.
		"opens_7d":  d.Totals.Opens,
		"denied_7d": d.Totals.Denied,
		"closes_7d": d.Totals.Closes,
		// Denied closes are broken out rather than dropped — a close that was
		// refused is a fact, and 'close' is the safe direction so it should
		// essentially never happen.
		"denied_closes_7d": d.Totals.DeniedCloses,
		"quality":          quality,
		// A partial window's totals are a FLOOR, not a total.
		"partial": quality != "complete",
	}
	if d.PrevObserved {
		totals["opens_prev_7d"] = d.PrevTotals.Opens
		totals["denied_prev_7d"] = d.PrevTotals.Denied
	} else {
		// The comparison period predates coverage: there is no baseline, and
		// pretending it is 0 would render as "first week of activity" or an
		// invented percentage rise.
		totals["opens_prev_7d"] = nil
		totals["denied_prev_7d"] = nil
	}
	totals["prev_window_observed"] = d.PrevObserved

	writeJSON(w, http.StatusOK, map[string]any{
		"account_id": accountID,
		"window":     windowJSON(win),
		"prev_window": map[string]any{
			"from": d.PrevWindow.FromTS, "to": d.PrevWindow.ToTS, "observed": d.PrevObserved,
		},
		"coverage":            coverageJSON(d.Coverage, observedDayCount(d.Days), len(d.Days), quality),
		"days":                days,
		"breakdown":           breakdown,
		"breakdown_truncated": d.AccessPointsTruncated,
		"totals":              totals,
		"members": map[string]any{
			"member_count":      d.MemberCount,
			"active_members_7d": d.ActiveMembers,
			"top":               memberRows,
			"top_truncated":     d.MembersTruncated,
		},
		"denials":   denialsJSON(d.Denials, d.DenialReasonsOmitted),
		"followups": followupsJSON(d.Followups),
	})
}

// ---------------------------------------------------------------------------
// GET /v1/analytics/locations/{id}/summary
// ---------------------------------------------------------------------------

func (s *Server) handleAnalyticsLocationSummary(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	accountID, _, ok := s.locationScope(w, r, id)
	if !ok {
		return
	}
	win, ok := analyticsWindow(w, r, store.AnalyticsDefaultLocationDays)
	if !ok {
		return
	}
	d, err := s.store.LocationActivitySummary(r.Context(), accountID, id, win, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	quotas, err := s.store.LocationQuotas(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	days := make([]map[string]any, 0, len(d.Days))
	for _, day := range d.Days {
		days = append(days, dayJSON(day))
	}
	quality := store.SeriesQuality(d.Days)
	writeJSON(w, http.StatusOK, map[string]any{
		"location_id": id,
		"window":      windowJSON(win),
		// opens/closes/total are the counts WITHIN the window, not lifetime
		// figures: an unbounded count over years of audit rows is a scan this
		// hub cannot afford (it also opens gates). window.days says exactly
		// what period they cover.
		"opens":         d.Totals.Opens,
		"closes":        d.Totals.Closes,
		"denied":        d.Totals.Denied,
		"denied_closes": d.Totals.DeniedCloses,
		"total":         d.Totals.Opens + d.Totals.Closes,
		"today": map[string]any{
			"day_start":                      time.Unix(d.TodayStart, 0).UTC().Format(time.RFC3339),
			"day_start_unix":                 d.TodayStart,
			"opens":                          d.TodayOpens,
			"observed":                       d.TodayObserved,
			"partial":                        true, // in progress
			"max_opens_per_member_per_day":   quotas.MaxOpensPerMemberPerDay,
			"max_opens_per_location_per_day": quotas.MaxOpensPerLocationPerDay,
		},
		"days":      days,
		"coverage":  coverageJSON(d.Coverage, observedDayCount(d.Days), len(d.Days), quality),
		"denials":   denialsJSON(d.Denials, d.DenialReasonsOmitted),
		"followups": followupsJSON(d.Followups),
	})
}
