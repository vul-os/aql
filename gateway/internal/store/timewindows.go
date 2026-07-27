package store

// Online time-window rules — WHEN a member may open, not whether.
//
// # The gap this closes
//
// An offline grant has carried weekly windows since proto/grants.md v0: the
// controller evaluates them itself, on its own clock, with no network
// (controller/internal/grants.InAnyWindow, gateway/internal/keys.GrantWindow).
// The ONLINE path had no equivalent — a member with access could open at any
// hour. A cleaner who should only get in on weekday mornings got in at 3am.
// This file is the online half of that check, evaluated at the one place every
// actuation funnels through (openpath.go, LogAccess).
//
// # One window format, not two
//
// TimeWindow is a type ALIAS for keys.GrantWindow, not a copy. A rule's
// windows are therefore literally the same Go type, the same JSON shape and
// the same vocabulary as an offline grant's: days is an inclusive mon..sun
// range in week order with no wrap-around, from/to are "HH:MM" with `to`
// exclusive, and "24:00" means end of day. (The controller keeps its own
// independent copy of that struct because it is a separate Go module with no
// shared dependency; inside THIS module a second copy would be the bug factory
// two window formats in one product always are.)
//
// A window that spans midnight is written as two windows — {fri 22:00-24:00}
// and {sat 00:00-06:00} — because `days` does not wrap. That is the offline
// contract's rule, kept deliberately: a single "22:00-06:00" window is
// REFUSED as contradictory rather than quietly matching nothing, which is the
// failure an operator would never notice until someone was locked out.
//
// # Composition: rules narrow, never widen
//
// An access-point rule and a location rule can both apply to one open. When
// they do, BOTH must allow it (AND), and within one rule any window may match
// (OR). That gives one invariant worth stating plainly: ADDING A RULE CAN ONLY
// EVER REMOVE ACCESS. There is no configuration in which writing a new rule
// hands someone an hour they did not already have, which is what makes "no
// rule means no restriction" safe to rely on — restrictions compose, and the
// empty set of restrictions is the behaviour this product had before this file
// existed.
//
// # Fail-closed, deliberately unlike the rate limiter
//
// openpath.go's limit check fails OPEN on a counter-store error, with a stated
// argument: a gate is physical access, availability wins for a VOLUME bound.
// This check does the opposite and denies when it cannot be evaluated — an
// unparseable rule, an unloadable zone, a failed read. The difference is what
// the check is: a rate limit answers "how often", and skipping it lets someone
// through who was allowed anyway; a window rule answers "may this person open
// this door right now", which is the same class of question as user_disabled,
// and an authorisation check that cannot run must never be assumed to pass.
// Every one of those denials is audited with its own reason, distinct from
// rate_limited, so an operator can tell a lockout from a throttle.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	// Embed the IANA timezone database, for the same reason
	// internal/automations/schedule.go does (see its comment): a rule written
	// in local time is meaningless if time.LoadLocation depends on the HOST
	// carrying /usr/share/zoneinfo. It is imported HERE and not merely relied
	// on from that package because this package must not depend on some other
	// package happening to be linked in — `go test ./internal/store` links
	// neither the automations engine nor main.
	_ "time/tzdata"

	"github.com/vul-os/aql/gateway/internal/keys"
)

// TimeWindow is one weekly window. Alias, not copy — see the file comment.
type TimeWindow = keys.GrantWindow

// Denial reasons this check can produce. All three are distinguishable from
// rate_limited/quota_exceeded in the audit trail, because "you are early",
// "your rule is broken" and "we could not tell" need three different
// operator responses.
const (
	// ReasonOutsideTimeWindow: the rules parsed and now is outside them.
	ReasonOutsideTimeWindow = "outside_time_window"
	// ReasonTimeWindowInvalid: a stored rule is unparseable or contradictory.
	// Fail-closed: refuse and say why, never ignore the rule.
	ReasonTimeWindowInvalid = "time_window_invalid"
	// ReasonTimeWindowUnavailable: the rules could not be read at all.
	ReasonTimeWindowUnavailable = "time_window_unavailable"
)

// MaxRuleWindows bounds one rule's window list. Generous for the real use
// (a weekday pattern plus a weekend one is four), small enough that a rule
// cannot become a denial-of-service against the open path.
const MaxRuleWindows = 32

// maxLookaheadDays bounds the "when may I next open" search. Eight, not seven:
// a weekly pattern needs a full week PLUS today's remainder to be sure it has
// seen every candidate.
const maxLookaheadDays = 8

// ErrInvalidTimeWindowRule wraps every shape/validation refusal so handlers can
// answer 400 instead of 500. The wrapped text names the specific problem.
var ErrInvalidTimeWindowRule = errors.New("invalid time window rule")

// ErrTimeWindowRuleExists is the one-rule-per-(member, target) collision.
var ErrTimeWindowRuleExists = errors.New("time window rule already exists for this member and target")

func invalidRule(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidTimeWindowRule, fmt.Sprintf(format, args...))
}

// TimeWindowRule is one stored rule. Exactly one of AccessPointID/LocationID
// is set; "" means "not this kind of target".
type TimeWindowRule struct {
	ID              string
	AccountID       string
	UserID          string
	AccessPointID   string
	LocationID      string
	TZ              string
	Windows         []TimeWindow
	Note            string
	CreatedByUserID string
	CreatedAt       int64
	UpdatedAt       int64
}

// ---------------------------------------------------------------------------
// Parsing + validation — the same vocabulary the controller already speaks
// ---------------------------------------------------------------------------

var weekdayNames = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

// weekdayIndexMonFirst maps Go's Sunday-first weekday onto the contract's
// mon..sun 0..6.
func weekdayIndexMonFirst(d time.Weekday) int { return (int(d) + 6) % 7 }

// parseWindowDays parses "mon-fri" / "sat" — an inclusive range in week order,
// no wrap-around ("fri-mon" is a refusal, not "Friday through Monday").
func parseWindowDays(s string) (lo, hi int, ok bool) {
	idx := func(name string) int {
		for i, d := range weekdayNames {
			if d == name {
				return i
			}
		}
		return -1
	}
	if a, b, found := strings.Cut(s, "-"); found {
		lo, hi = idx(a), idx(b)
	} else {
		lo = idx(s)
		hi = lo
	}
	return lo, hi, lo >= 0 && hi >= lo
}

// parseWindowHM parses "HH:MM" into minutes since midnight; "24:00" = 1440.
func parseWindowHM(s string) (int, bool) {
	if len(s) != 5 || s[2] != ':' {
		return 0, false
	}
	for _, i := range []int{0, 1, 3, 4} {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
	}
	h := int(s[0]-'0')*10 + int(s[1]-'0')
	m := int(s[3]-'0')*10 + int(s[4]-'0')
	if h == 24 && m == 0 {
		return 1440, true
	}
	if h > 23 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// window is a parsed, validated TimeWindow.
type window struct {
	lo, hi     int // inclusive mon..sun day indices
	from, to   int // minutes since local midnight, `to` exclusive
	sourceDays string
}

func parseWindow(w TimeWindow) (window, error) {
	lo, hi, ok := parseWindowDays(w.Days)
	if !ok {
		return window{}, invalidRule("days %q is not an inclusive mon..sun range in week order", w.Days)
	}
	from, ok := parseWindowHM(w.From)
	if !ok {
		return window{}, invalidRule("from %q is not HH:MM", w.From)
	}
	to, ok := parseWindowHM(w.To)
	if !ok {
		return window{}, invalidRule("to %q is not HH:MM", w.To)
	}
	if from >= to {
		// The midnight-spanning mistake, refused loudly. "22:00"-"06:00" can
		// never match anything under no-wrap semantics, so accepting it would
		// mean storing a rule that denies forever and looks correct.
		return window{}, invalidRule(
			"window %s %s-%s never occurs: from must be before to; a window across midnight is written as two windows (…-24:00 and 00:00-…)",
			w.Days, w.From, w.To)
	}
	return window{lo: lo, hi: hi, from: from, to: to, sourceDays: w.Days}, nil
}

// contains reports whether t — ALREADY in the rule's own zone — falls inside
// this window. Weekday and minute-of-day both come from the local calendar,
// which is what makes the answer DST-correct by construction: it asks what the
// clock on the wall says, not what offset from UTC applies.
func (w window) contains(t time.Time) bool {
	day := weekdayIndexMonFirst(t.Weekday())
	if day < w.lo || day > w.hi {
		return false
	}
	minute := t.Hour()*60 + t.Minute()
	return minute >= w.from && minute < w.to
}

// ValidateTimeWindows checks a zone + window list without touching the
// database — the write path's gate, and the same code the read path re-runs.
func ValidateTimeWindows(tz string, ws []TimeWindow) (*time.Location, []window, error) {
	if strings.TrimSpace(tz) == "" {
		// Never defaulted. A window with no zone is an opinion about where the
		// server is, and silently choosing UTC would shift every decision for
		// most of the planet.
		return nil, nil, invalidRule("timezone is required (an IANA name, e.g. \"Africa/Johannesburg\")")
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, nil, invalidRule("unknown timezone %q", tz)
	}
	if len(ws) == 0 {
		// A rule with no windows would deny always. An operator who wants that
		// removes the member, they do not write an empty rule; accepting one
		// would make a serialisation bug indistinguishable from a policy.
		return nil, nil, invalidRule("a rule needs at least one window")
	}
	if len(ws) > MaxRuleWindows {
		return nil, nil, invalidRule("at most %d windows per rule (got %d)", MaxRuleWindows, len(ws))
	}
	out := make([]window, 0, len(ws))
	for _, w := range ws {
		p, err := parseWindow(w)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, p)
	}
	return loc, out, nil
}

// ---------------------------------------------------------------------------
// Evaluation — what openpath.go calls
// ---------------------------------------------------------------------------

// TimeWindowDecision is the verdict for one open attempt.
type TimeWindowDecision struct {
	Allowed bool
	// Reason is "" when allowed, else one of the three Reason* constants.
	Reason string
	// RuleID names the rule that denied (or failed to parse), so an operator
	// reading a log has somewhere to go.
	RuleID string
	// Detail is operator-facing prose for the invalid/unavailable cases. Never
	// shown to the person at the gate.
	Detail string
	// RetryAfterS is the wait until the next instant EVERY applicable rule
	// allows, or 0 when there is none within maxLookaheadDays. It is exact,
	// not an estimate: the start of an allowed stretch is always the start of
	// some window, so the candidates below are the only instants worth testing.
	RetryAfterS int64
}

// parsedRule pairs a stored rule with its resolved zone and windows.
type parsedRule struct {
	id  string
	loc *time.Location
	ws  []window
}

func (p parsedRule) allows(t time.Time) bool {
	local := t.In(p.loc)
	for _, w := range p.ws {
		if w.contains(local) {
			return true
		}
	}
	return false
}

// CheckTimeWindows is the open-path verdict: do this member's window rules
// permit opening this access point at nowUnix (0 = wall clock)?
//
// No rule → allowed, with no query result to interpret and nothing recorded.
// That is the default and it is the whole point: an install that does not use
// this feature behaves EXACTLY as it did before it existed.
//
// It returns a decision rather than an error even when the read fails, because
// the choke point's contract is that a refusal is audited with a reason. A
// database broken enough to fail this read will fail the audit insert too, and
// LogAccess surfaces that as an error — but a single failed read must not
// become a silent allow.
func (s *Store) CheckTimeWindows(ctx context.Context, accountID, userID, accessPointID, locationID string, nowUnix int64) TimeWindowDecision {
	if userID == "" {
		// Visitors have no member rules; their offline/temporary grants carry
		// their own windows (grants.go, keys.Grant).
		return TimeWindowDecision{Allowed: true}
	}
	rules, err := s.TimeWindowRulesForTarget(ctx, accountID, userID, accessPointID, locationID)
	if err != nil {
		return TimeWindowDecision{Reason: ReasonTimeWindowUnavailable, Detail: err.Error()}
	}
	if len(rules) == 0 {
		return TimeWindowDecision{Allowed: true}
	}
	if nowUnix == 0 {
		nowUnix = now()
	}
	t := time.Unix(nowUnix, 0)

	parsed := make([]parsedRule, 0, len(rules))
	for _, r := range rules {
		loc, ws, err := ValidateTimeWindows(r.TZ, r.Windows)
		if err != nil {
			// One broken rule denies the whole attempt. It cannot be skipped:
			// skipping is exactly the behaviour that turns a typo into an
			// unrestricted 3am open.
			return TimeWindowDecision{Reason: ReasonTimeWindowInvalid, RuleID: r.ID, Detail: err.Error()}
		}
		parsed = append(parsed, parsedRule{id: r.ID, loc: loc, ws: ws})
	}

	for _, p := range parsed {
		if !p.allows(t) {
			return TimeWindowDecision{
				Reason:      ReasonOutsideTimeWindow,
				RuleID:      p.id,
				RetryAfterS: nextAllowedIn(parsed, t),
			}
		}
	}
	return TimeWindowDecision{Allowed: true}
}

// nextAllowedIn returns the seconds until the first instant after t at which
// EVERY rule allows, or 0 if there is none within maxLookaheadDays.
//
// Exactness argument: each rule's allowed set is a union of windows, and the
// intersection of unions can only START where one of those windows starts (the
// start of an intersection is the latest of the starts that form it). So
// enumerating every window start in the lookahead and testing each against all
// rules finds the true answer — no minute-by-minute scan needed.
func nextAllowedIn(rules []parsedRule, t time.Time) int64 {
	var candidates []time.Time
	for _, p := range rules {
		local := t.In(p.loc)
		y, m, d := local.Date()
		for _, w := range p.ws {
			for off := 0; off <= maxLookaheadDays; off++ {
				// time.Date normalises a local time that does not exist (the
				// hour skipped on a spring-forward day), so a candidate can
				// land outside its own window. It is tested below like any
				// other, which is the correct outcome: an hour that does not
				// happen is not an hour anybody may open in.
				cand := time.Date(y, m, d+off, 0, w.from, 0, 0, p.loc)
				if !cand.After(t) {
					continue
				}
				candidates = append(candidates, cand)
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Before(candidates[j]) })
	limit := t.Add(maxLookaheadDays * 24 * time.Hour)
	for _, c := range candidates {
		if c.After(limit) {
			break
		}
		ok := true
		for _, p := range rules {
			if !p.allows(c) {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		secs := int64(c.Sub(t).Seconds())
		if secs < 1 {
			secs = 1
		}
		return secs
	}
	return 0
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const timeWindowRuleCols = `id, account_id, user_id, coalesce(access_point_id, ''),
	coalesce(location_id, ''), tz, windows, note, coalesce(created_by_user_id, ''),
	created_at, updated_at`

func scanTimeWindowRule(sc interface{ Scan(...any) error }) (*TimeWindowRule, error) {
	var r TimeWindowRule
	var raw string
	if err := sc.Scan(&r.ID, &r.AccountID, &r.UserID, &r.AccessPointID, &r.LocationID,
		&r.TZ, &raw, &r.Note, &r.CreatedByUserID, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	// A row whose JSON will not decode is left with NO windows on purpose:
	// ValidateTimeWindows then refuses it and the open is denied with
	// time_window_invalid. Returning an error here instead would make a single
	// corrupt row break listing for everyone, which is a worse failure and
	// hides the one row an operator needs to see.
	if err := json.Unmarshal([]byte(raw), &r.Windows); err != nil {
		r.Windows = nil
	}
	return &r, nil
}

// TimeWindowRulesForTarget returns the rules that apply to one open attempt:
// this member, at this access point or anywhere in its location. This is the
// query the choke point runs, and the only one it runs.
//
// accountID is redundant with the access point (a rule's target already fixes
// its account, checked at write time) and is in the WHERE clause anyway — the
// package's tenancy rule is that account-scoping is not something a reader
// infers, it is something the SQL states.
func (s *Store) TimeWindowRulesForTarget(ctx context.Context, accountID, userID, accessPointID, locationID string) ([]TimeWindowRule, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+timeWindowRuleCols+` FROM time_window_rules
		 WHERE account_id = ? AND user_id = ? AND (access_point_id = ? OR location_id = ?)
		 ORDER BY created_at ASC`, accountID, userID, accessPointID, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TimeWindowRule{}
	for rows.Next() {
		r, err := scanTimeWindowRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// TimeWindowRulesForAccount lists an account's rules; userID != "" narrows to
// one member (the projection an ordinary member is allowed to see).
func (s *Store) TimeWindowRulesForAccount(ctx context.Context, accountID, userID string) ([]TimeWindowRule, error) {
	q := `SELECT ` + timeWindowRuleCols + ` FROM time_window_rules WHERE account_id = ?`
	args := []any{accountID}
	if userID != "" {
		q += ` AND user_id = ?`
		args = append(args, userID)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TimeWindowRule{}
	for rows.Next() {
		r, err := scanTimeWindowRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// TimeWindowRuleByID is the account-scoped read. A rule in another account is
// indistinguishable from one that does not exist (the tenancy contract).
func (s *Store) TimeWindowRuleByID(ctx context.Context, accountID, id string) (*TimeWindowRule, error) {
	return scanTimeWindowRule(s.db.QueryRowContext(ctx,
		`SELECT `+timeWindowRuleCols+` FROM time_window_rules WHERE id = ? AND account_id = ?`,
		id, accountID))
}

// CreateTimeWindowRuleArgs is the write shape. Exactly one of AccessPointID
// and LocationID may be set.
type CreateTimeWindowRuleArgs struct {
	UserID          string
	AccessPointID   string
	LocationID      string
	TZ              string
	Windows         []TimeWindow
	Note            string
	CreatedByUserID string
}

// CreateTimeWindowRule validates the rule, checks that the member and the
// target both belong to accountID, and inserts.
//
// Everything is verified BEFORE the insert: a refused rule must not leave a
// half-made restriction behind, and — more importantly — a rule pointing at
// another account's door would be a cross-tenant denial primitive.
func (s *Store) CreateTimeWindowRule(ctx context.Context, accountID string, a CreateTimeWindowRuleArgs) (*TimeWindowRule, error) {
	if (a.AccessPointID == "") == (a.LocationID == "") {
		return nil, invalidRule("set exactly one of access_point_id or location_id")
	}
	if a.UserID == "" {
		return nil, invalidRule("user_id is required")
	}
	if len(a.Note) > 2000 {
		return nil, invalidRule("note is too long")
	}
	if _, _, err := ValidateTimeWindows(a.TZ, a.Windows); err != nil {
		return nil, err
	}
	// The member must be an ACTIVE member of this account. A rule naming
	// somebody who is not would be dead config that suddenly bites the day
	// they are invited.
	if _, err := s.MemberRole(ctx, accountID, a.UserID); err != nil {
		return nil, err // ErrNotFound → handler 404s, no existence leak
	}
	// Target ownership.
	if a.AccessPointID != "" {
		apc, err := s.AccessPointContextByID(ctx, a.AccessPointID)
		if err != nil {
			return nil, err
		}
		if apc.AccountID != accountID {
			return nil, ErrNotFound
		}
	} else {
		if _, err := s.LocationByID(ctx, accountID, a.LocationID); err != nil {
			return nil, err
		}
	}

	raw, err := json.Marshal(a.Windows)
	if err != nil {
		return nil, invalidRule("windows cannot be encoded: %v", err)
	}
	id, t := NewID(), now()
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO time_window_rules
		   (id, account_id, user_id, access_point_id, location_id, tz, windows, note,
		    created_by_user_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, accountID, a.UserID, nullIfEmptyStr(a.AccessPointID), nullIfEmptyStr(a.LocationID),
		a.TZ, string(raw), a.Note, nullIfEmptyStr(a.CreatedByUserID), t, t)
	if err != nil {
		if strings.Contains(strings.ToUpper(err.Error()), "UNIQUE") {
			return nil, ErrTimeWindowRuleExists
		}
		return nil, err
	}
	return s.TimeWindowRuleByID(ctx, accountID, id)
}

// DeleteTimeWindowRule removes a restriction. Account-scoped.
//
// This is the escape hatch, and it must stay one: a rule applies to whoever it
// names, INCLUDING an owner or admin (a per-member rule is an explicit
// statement about one person, unlike a location quota, which is blanket policy
// admins are exempt from). An owner who writes themselves a weekday-mornings
// rule and then needs in at 3am deletes it — the management API is not
// window-restricted, only the gate is.
func (s *Store) DeleteTimeWindowRule(ctx context.Context, accountID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM time_window_rules WHERE id = ? AND account_id = ?`, id, accountID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// nullIfEmptyStr keeps "" out of nullable columns, so the partial-target CHECK
// and the coalesce()d unique index both see what they expect.
func nullIfEmptyStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
