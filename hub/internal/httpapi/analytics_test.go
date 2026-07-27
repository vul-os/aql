package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// analyticsHTTPFixture: two tenants over one hub, each with an access point,
// plus the store handle so audit rows can be seeded at chosen timestamps
// (LogAccess stamps "now", which cannot exercise a multi-day window).
type analyticsHTTPFixture struct {
	h        http.Handler
	st       *store.Store
	accessA  string
	accessB  string
	acctA    string
	locA     string
	apA      string
	acctB    string
	locB     string
	apB      string
	userA    string
	dayStart int64
}

func setupAnalyticsHTTP(t *testing.T) *analyticsHTTPFixture {
	t.Helper()
	h, st := newTestServerWithStore(t, "")
	f := &analyticsHTTPFixture{h: h, st: st, dayStart: store.FixedWindowStart(time.Now().Unix(), store.DayS)}
	f.accessA, _ = register(t, h, "a@ana.com")
	f.accessB, _ = register(t, h, "b@ana.com")
	f.acctA, f.locA = tenantIDs(t, h, f.accessA)
	f.acctB, f.locB = tenantIDs(t, h, f.accessB)

	mkAP := func(access, locID, name string) string {
		rec, out := doJSON(t, h, "POST", "/v1/access-points", access, map[string]any{
			"location_id": locID, "name": name, "kind": "gate",
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("ap create: %d %s", rec.Code, rec.Body)
		}
		return out["id"].(string)
	}
	f.apA = mkAP(f.accessA, f.locA, "Gate A")
	f.apB = mkAP(f.accessB, f.locB, "Gate B")

	_, me := doJSON(t, h, "GET", "/v1/auth/me", f.accessA, nil)
	f.userA = me["user"].(map[string]any)["id"].(string)

	// Back-date both accounts so the windows under test are fully covered.
	for _, id := range []string{f.acctA, f.acctB} {
		if err := backdateAccount(st, id, f.dayStart-90*store.DayS); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func backdateAccount(st *store.Store, accountID string, createdAt int64) error {
	_, err := st.DB().ExecContext(context.Background(),
		`UPDATE accounts SET created_at = ? WHERE id = ?`, createdAt, accountID)
	return err
}

func (f *analyticsHTTPFixture) seed(t *testing.T, acct, loc, ap, userID, command string, success bool, errTag string, ts int64) {
	t.Helper()
	if _, err := f.st.InsertAccessLog(context.Background(), store.AccessLog{
		AccessPointID: ap, LocationID: loc, AccountID: acct, UserID: userID,
		Command: command, Source: "web", Success: success, Error: errTag, TS: ts,
	}); err != nil {
		t.Fatal(err)
	}
}

// TestAnalyticsRoutesAreTenantScoped: account B's analytics are 404 for A —
// the same not-found-not-forbidden answer every other cross-tenant probe in
// this package gets, so membership cannot be enumerated through the
// analytics surface either.
func TestAnalyticsRoutesAreTenantScoped(t *testing.T) {
	f := setupAnalyticsHTTP(t)
	f.seed(t, f.acctB, f.locB, f.apB, "", "open", true, "", f.dayStart+10)

	for _, path := range []string{
		"/v1/analytics/accounts/" + f.acctB + "/summary",
		"/v1/analytics/accounts/" + f.acctB + "/insights",
		"/v1/analytics/locations/" + f.locB + "/summary",
	} {
		rec, out := doJSON(t, f.h, "GET", path, f.accessA, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("cross-tenant GET %s: %d %v (want 404)", path, rec.Code, out)
		}
	}

	// Unauthenticated is 401 everywhere.
	rec, _ := doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/insights", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous insights: %d, want 401", rec.Code)
	}
}

// TestAnalyticsSummaryExcludesOtherTenants: the numbers themselves, not just
// the gate. A leak in an aggregate is the same leak as in a detail view.
func TestAnalyticsSummaryExcludesOtherTenants(t *testing.T) {
	f := setupAnalyticsHTTP(t)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", true, "", f.dayStart+10)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", false, "quota_exceeded", f.dayStart+20)
	for i := range 25 {
		f.seed(t, f.acctB, f.locB, f.apB, "", "open", true, "", f.dayStart+int64(i))
	}

	rec, out := doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/summary", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("summary: %d %s", rec.Code, rec.Body)
	}
	if out["opens_today"].(float64) != 1 || out["denied_today"].(float64) != 1 {
		t.Errorf("summary counts contaminated: %v", out)
	}
	recent := out["recent_activity"].([]any)
	if len(recent) != 2 {
		t.Fatalf("recent_activity has %d rows, want 2 (only tenant A's)", len(recent))
	}
	first := recent[0].(map[string]any)
	if first["access_point_name"] != "Gate A" {
		t.Errorf("recent row not tenant A's: %v", first)
	}
	if _, ok := out["coverage"].(map[string]any); !ok {
		t.Errorf("summary must always carry the coverage block: %v", out)
	}

	// And the insights view of the same data.
	rec, out = doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/insights", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("insights: %d %s", rec.Code, rec.Body)
	}
	totals := out["totals"].(map[string]any)
	if totals["opens_7d"].(float64) != 1 || totals["denied_7d"].(float64) != 1 {
		t.Errorf("insights totals contaminated: %v", totals)
	}
	breakdown := out["breakdown"].([]any)
	if len(breakdown) != 1 || breakdown[0].(map[string]any)["access_point_name"] != "Gate A" {
		t.Errorf("breakdown contaminated: %v", breakdown)
	}
	denials := out["denials"].(map[string]any)["reasons"].([]any)
	if len(denials) != 1 || denials[0].(map[string]any)["reason"] != "quota_exceeded" {
		t.Errorf("denial reasons wrong or smoothed: %v", denials)
	}
}

// TestAnalyticsInsightsShape checks the console's contract (days/totals/
// breakdown/members) plus the honesty fields it does not read yet.
func TestAnalyticsInsightsShape(t *testing.T) {
	f := setupAnalyticsHTTP(t)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", true, "", f.dayStart+30)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", false, "rate_limited", f.dayStart-2*store.DayS)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "close", true, "", f.dayStart-store.DayS)

	rec, out := doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/insights", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("insights: %d %s", rec.Code, rec.Body)
	}
	days := out["days"].([]any)
	if len(days) != 7 {
		t.Fatalf("default window is %d days, want 7", len(days))
	}
	last := days[len(days)-1].(map[string]any)
	if last["opens"].(float64) != 1 || last["partial"] != true {
		t.Errorf("today's bucket: %v (want 1 open, partial=true)", last)
	}
	if _, err := time.Parse("2006-01-02", last["day"].(string)); err != nil {
		t.Errorf("day label %q is not YYYY-MM-DD: %v", last["day"], err)
	}
	totals := out["totals"].(map[string]any)
	if totals["opens_7d"].(float64) != 1 || totals["denied_7d"].(float64) != 1 || totals["closes_7d"].(float64) != 1 {
		t.Errorf("totals: %v", totals)
	}
	if totals["quality"] != "partial" {
		t.Errorf("quality = %v, want partial (today is in progress)", totals["quality"])
	}
	members := out["members"].(map[string]any)
	if members["member_count"].(float64) != 1 || members["active_members_7d"].(float64) != 1 {
		t.Errorf("members block: %v", members)
	}
	win := out["window"].(map[string]any)
	if win["days"].(float64) != 7 || win["max_days"].(float64) != float64(store.AnalyticsMaxWindowDays) {
		t.Errorf("window block must state the cap: %v", win)
	}
	// A wider explicit window is honoured, up to the cap.
	rec, out = doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/insights?days=30", f.accessA, nil)
	if rec.Code != http.StatusOK || len(out["days"].([]any)) != 30 {
		t.Errorf("days=30: %d, %d buckets", rec.Code, len(out["days"].([]any)))
	}
}

// TestAnalyticsEmptyPeriodDistinguishesGapFromZero: the whole point. A day
// with no rows inside coverage is 0; a day before this account existed is
// null, and the coverage block says which is which.
func TestAnalyticsEmptyPeriodDistinguishesGapFromZero(t *testing.T) {
	f := setupAnalyticsHTTP(t)

	// Fully covered, entirely empty week: real zeros.
	rec, out := doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/insights", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("insights: %d %s", rec.Code, rec.Body)
	}
	for _, raw := range out["days"].([]any) {
		day := raw.(map[string]any)
		if day["observed"] != true {
			t.Errorf("day %v should be observed: %v", day["day"], day)
		}
		if day["opens"] != float64(0) || day["denied"] != float64(0) {
			t.Errorf("observed empty day should report 0, got %v", day)
		}
	}
	cov := out["coverage"].(map[string]any)
	if cov["ever_recorded"] != false || cov["first_recorded_at"] != nil {
		t.Errorf("an account with no rows must say so: %v", cov)
	}
	if out["totals"].(map[string]any)["opens_7d"].(float64) != 0 {
		t.Errorf("empty week totals: %v", out["totals"])
	}

	// Now make the account young: the days before it existed are NOT zeros.
	if err := backdateAccount(f.st, f.acctA, f.dayStart-2*store.DayS); err != nil {
		t.Fatal(err)
	}
	rec, out = doJSON(t, f.h, "GET", "/v1/analytics/accounts/"+f.acctA+"/insights", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("insights: %d %s", rec.Code, rec.Body)
	}
	nulls, zeros := 0, 0
	for _, raw := range out["days"].([]any) {
		day := raw.(map[string]any)
		switch day["observed"] {
		case false:
			if day["opens"] != nil || day["denied"] != nil || day["closes"] != nil {
				t.Errorf("unobserved day drew a number instead of null: %v", day)
			}
			nulls++
		default:
			if day["opens"] == nil {
				t.Errorf("observed day reported null: %v", day)
			}
			zeros++
		}
	}
	if nulls != 4 || zeros != 3 {
		t.Errorf("want 4 unobserved + 3 observed days, got %d + %d", nulls, zeros)
	}
	cov = out["coverage"].(map[string]any)
	if cov["quality"] != "partial" || cov["observed_days"].(float64) != 3 || cov["window_days"].(float64) != 7 {
		t.Errorf("coverage block: %v", cov)
	}
	if cov["note"] == nil || cov["note"] == "" {
		t.Errorf("coverage must state what a null means: %v", cov)
	}
	totals := out["totals"].(map[string]any)
	if totals["partial"] != true {
		t.Errorf("a partially covered window's totals are a floor: %v", totals)
	}
	if totals["opens_prev_7d"] != nil || totals["prev_window_observed"] != false {
		t.Errorf("comparison window predates coverage: it must be null, got %v", totals)
	}
}

// TestAnalyticsRefusesUnboundedRange: over the cap is a 400 that NAMES the
// cap — never a silent clamp, because a caller must not believe it received
// a year of data.
func TestAnalyticsRefusesUnboundedRange(t *testing.T) {
	f := setupAnalyticsHTTP(t)
	over := store.AnalyticsMaxWindowDays + 1

	for _, path := range []string{
		"/v1/analytics/accounts/" + f.acctA + "/insights?days=",
		"/v1/analytics/locations/" + f.locA + "/summary?days=",
	} {
		rec, out := doJSON(t, f.h, "GET", path+strconv.Itoa(over), f.accessA, nil)
		if rec.Code != http.StatusBadRequest || out["error"] != "range_too_large" {
			t.Errorf("GET %s%d: %d %v (want 400 range_too_large)", path, over, rec.Code, out)
		}
		if out["max_days"] != float64(store.AnalyticsMaxWindowDays) {
			t.Errorf("refusal must name the cap: %v", out)
		}
		// A decade is refused just as flatly.
		rec, out = doJSON(t, f.h, "GET", path+"3650", f.accessA, nil)
		if rec.Code != http.StatusBadRequest || out["error"] != "range_too_large" {
			t.Errorf("GET %s3650: %d %v", path, rec.Code, out)
		}
		// At the cap: allowed.
		rec, _ = doJSON(t, f.h, "GET", path+strconv.Itoa(store.AnalyticsMaxWindowDays), f.accessA, nil)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s%d (at the cap): %d", path, store.AnalyticsMaxWindowDays, rec.Code)
		}
		// Nonsense is a 400, not a default.
		for _, bad := range []string{"0", "-5", "abc"} {
			rec, out = doJSON(t, f.h, "GET", path+bad, f.accessA, nil)
			if rec.Code != http.StatusBadRequest || out["error"] != "invalid_days" {
				t.Errorf("GET %s%s: %d %v (want 400 invalid_days)", path, bad, rec.Code, out)
			}
		}
	}

	// The recent-activity feed is bounded the same way.
	rec, out := doJSON(t, f.h, "GET",
		"/v1/analytics/accounts/"+f.acctA+"/summary?limit="+strconv.Itoa(store.AnalyticsMaxRecentActivity+1), f.accessA, nil)
	if rec.Code != http.StatusBadRequest || out["error"] != "limit_too_large" {
		t.Errorf("over-cap limit: %d %v", rec.Code, out)
	}
	if out["max_limit"] != float64(store.AnalyticsMaxRecentActivity) {
		t.Errorf("refusal must name the cap: %v", out)
	}
	rec, _ = doJSON(t, f.h, "GET",
		"/v1/analytics/accounts/"+f.acctA+"/summary?limit="+strconv.Itoa(store.AnalyticsMaxRecentActivity), f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("limit at the cap: %d", rec.Code)
	}
}

// TestAnalyticsLocationSummary covers the third route: window-bounded totals,
// today's quota context, and denial reasons kept distinct.
func TestAnalyticsLocationSummary(t *testing.T) {
	f := setupAnalyticsHTTP(t)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", true, "", f.dayStart+10)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "close", true, "", f.dayStart+20)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", false, "account_suspended", f.dayStart+30)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", false, "user_disabled", f.dayStart+40)
	// Outside the default 30-day window: must not be counted.
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", true, "", f.dayStart-40*store.DayS)

	rec, out := doJSON(t, f.h, "GET", "/v1/analytics/locations/"+f.locA+"/summary", f.accessA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("location summary: %d %s", rec.Code, rec.Body)
	}
	if out["opens"].(float64) != 1 || out["closes"].(float64) != 1 || out["total"].(float64) != 2 {
		t.Errorf("windowed totals: %v", out)
	}
	if out["denied"].(float64) != 2 {
		t.Errorf("denied: %v", out["denied"])
	}
	today := out["today"].(map[string]any)
	if today["opens"].(float64) != 1 || today["observed"] != true {
		t.Errorf("today block: %v", today)
	}
	if _, ok := today["max_opens_per_location_per_day"]; !ok {
		t.Errorf("today block must carry the quota context: %v", today)
	}
	if _, err := time.Parse(time.RFC3339, today["day_start"].(string)); err != nil {
		t.Errorf("day_start is not RFC3339: %v", today["day_start"])
	}
	reasons := out["denials"].(map[string]any)["reasons"].([]any)
	seen := map[string]float64{}
	for _, raw := range reasons {
		r := raw.(map[string]any)
		seen[r["reason"].(string)] = r["count"].(float64)
	}
	if seen["account_suspended"] != 1 || seen["user_disabled"] != 1 {
		t.Errorf("denial reasons must stay distinct, got %v", seen)
	}
	// The out-of-window open is visible in the wider window, proving the
	// bound is what excluded it rather than a scoping mistake.
	rec, out = doJSON(t, f.h, "GET", "/v1/analytics/locations/"+f.locA+"/summary?days=60", f.accessA, nil)
	if rec.Code != http.StatusOK || out["opens"].(float64) != 2 {
		t.Errorf("days=60: %d opens=%v", rec.Code, out["opens"])
	}
}

// TestAnalyticsNeverWritesAudit: analytics is a read. It must not append to
// the append-only tables (not even an admin-audit row) — the hash chains must
// be exactly where they were.
func TestAnalyticsNeverWritesAudit(t *testing.T) {
	f := setupAnalyticsHTTP(t)
	f.seed(t, f.acctA, f.locA, f.apA, f.userA, "open", true, "", f.dayStart+10)
	ctx := context.Background()

	counts := func() (int, int) {
		t.Helper()
		var a, b int
		if err := f.st.DB().QueryRowContext(ctx, `SELECT count(*) FROM access_logs`).Scan(&a); err != nil {
			t.Fatal(err)
		}
		if err := f.st.DB().QueryRowContext(ctx, `SELECT count(*) FROM admin_audit_log`).Scan(&b); err != nil {
			t.Fatal(err)
		}
		return a, b
	}
	beforeLogs, beforeAudit := counts()

	for _, path := range []string{
		"/v1/analytics/accounts/" + f.acctA + "/summary",
		"/v1/analytics/accounts/" + f.acctA + "/insights",
		"/v1/analytics/locations/" + f.locA + "/summary",
	} {
		if rec, _ := doJSON(t, f.h, "GET", path, f.accessA, nil); rec.Code != http.StatusOK {
			t.Fatalf("GET %s: %d", path, rec.Code)
		}
	}

	afterLogs, afterAudit := counts()
	if afterLogs != beforeLogs || afterAudit != beforeAudit {
		t.Errorf("analytics wrote rows: access_logs %d→%d, admin_audit_log %d→%d",
			beforeLogs, afterLogs, beforeAudit, afterAudit)
	}
	results, err := f.st.VerifyHashChains(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range results {
		if !r.OK {
			t.Errorf("%s chain broken after analytics reads: %+v", r.Table, r.Break)
		}
	}
}
