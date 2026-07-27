package store

// Geofence rules — refuse an open when the requester is not near the gate.
//
// # This is not a security control, and pretending otherwise would be a bug
//
// The position this file tests arrives in the request body. A phone sends it;
// nothing verifies it. There is no signature over it, no second source to
// corroborate it, no physical measurement anywhere in the loop. Any caller who
// wants to claim they are standing at the gate can, with curl, in one line —
// and every mock-location app on every phone platform does it with a toggle.
//
// So state the claim precisely. A geofence rule buys:
//
//   - the resident who taps "open" from the office and expects the gate at
//     home to stay shut,
//   - the automation or script that fires from a laptop three cities away,
//   - the shared household account where someone opens the wrong gate,
//   - a visible, audited record that a request came from somewhere it should
//     not have.
//
// It does not buy: any resistance at all to someone who is deliberately lying
// about where they are. An operator who thinks it does is WORSE off than one
// who never enabled it, because they will trust a fence in place of a control
// that actually holds — a lock, a grant with a short expiry, a rate limit, a
// person. The docs, the API and the audit trail must all keep saying that; a
// convenience that gets remembered as a security boundary is how this feature
// causes harm.
//
// The genuinely load-bearing checks in the choke point are elsewhere and are
// unaffected: membership, account suspension, user status, offline-grant
// signatures, rate limits, quotas, time windows. This runs after all of them
// (openpath.go) precisely because it is the weakest claim in the stack.
//
// # The data was already there
//
// access_logs has carried lat/long since migration 0001 and the open path has
// recorded them for as long as it has existed. Capture with no enforcement is
// the gap this closes. Nothing about the capture side changes.
//
// # A rule is per DOOR, not per person
//
// Time-window rules (timewindows.go) are per (member, target) because a
// schedule is a statement about one person. "You must be near the gate" is a
// statement about the GATE: it binds everyone who opens it, members and
// visitors holding a one-off grant alike. A per-member fence would mean an
// operator hand-writing a row per resident, and a new resident silently
// getting no fence — a default that fails open, quietly, at exactly the moment
// somebody is relying on it.
//
// # Composition: rules narrow, never widen
//
// An access-point rule and a location rule can both apply to one open. When
// they do, BOTH must allow it (AND). Adding a rule can only ever REMOVE
// access, which is what makes "no rule means no restriction" safe to rely on:
// an install that never writes a rule behaves EXACTLY as it did before this
// file existed — one indexed read that returns nothing.
//
// # Absent coordinates are a decision, made in advance, per rule
//
// A request can carry no position at all. That is not exotic: every chat rail
// in this product (WhatsApp, Telegram, Slack, Discord) sends none today, and a
// browser can be refused the permission. Two ways to handle it, both wrong as
// defaults chosen implicitly:
//
//   - pass silently → the fence is bypassed by OMITTING A FIELD, and an
//     operator who enabled it has a fence that does nothing while looking like
//     it works;
//   - refuse silently → every chat-rail user is locked out the instant a rule
//     is written, with no warning.
//
// So it is an explicit per-rule field, OnMissingLocation, and the default is
// DENY. A fence any caller can switch off by leaving a field out is not a
// fence, and the whole reason to build this rather than a comment in the docs
// is that the enforcement is real when it is on. An operator who needs the
// chat rails to keep working sets "allow" deliberately, can see in the rule
// listing that they did, and gets the honest weaker guarantee that goes with
// it. The evaluator treats anything that is not exactly "allow" as deny, so a
// corrupted or unrecognised value fails closed.
//
// # Accuracy is not distance
//
// A phone reports a position with an error radius: 5-15 m outdoors under open
// sky, 30-50 m against a building, over 100 m on a wifi-only fix indoors or in
// a basement parking garage. The anchor has error of its own — it is a pin
// somebody dropped on a map. Comparing a measurement with tens of metres of
// error against a hard cutoff refuses people standing AT the gate, which is
// the failure that gets a safety feature switched off for good.
//
// The fence is therefore `distance <= radius_m + slack_m`, where slack_m is a
// per-rule OPERATOR-set forgiveness band (default 75 m). Deliberately not
// taken from a client-reported accuracy figure: that number is exactly as
// unverifiable as the coordinates themselves, so honouring it would let any
// caller widen any fence to any size by claiming a bad fix — turning the one
// mitigation for GPS error into the easiest way to defeat the feature. Making
// it operator-set also makes the fence deterministic and explainable: "this
// gate forgives 75 m" is a sentence an operator can act on.
//
// # Fail-closed, deliberately unlike the rate limiter
//
// openpath.go's limit check fails OPEN on a counter-store error, with a stated
// argument: a gate is physical access, and availability wins for a VOLUME
// bound. This check denies when it cannot be evaluated — an unparseable rule,
// a failed read, a NaN anchor. It follows timewindows.go, for the same reason:
// a rate limit answers "how often", and skipping it lets through someone who
// was allowed anyway; a fence answers "may this request open this door", and a
// check that cannot run must never be assumed to pass. Each of those denials
// carries its own audit reason, distinct from rate_limited, quota_exceeded and
// every time-window reason, so an operator can tell them apart.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
)

// Denial reasons this check can produce. All four are distinguishable in the
// audit trail from rate_limited, quota_exceeded and the time-window reasons,
// because "you are not there", "you did not say where you are", "your rule is
// broken" and "we could not tell" need four different operator responses.
const (
	// ReasonOutsideGeofence: a position was supplied and it is further from
	// the anchor than radius + slack.
	ReasonOutsideGeofence = "outside_geofence"
	// ReasonGeofenceLocationRequired: a rule applies, the request carried no
	// usable position, and the rule says deny in that case.
	ReasonGeofenceLocationRequired = "geofence_location_required"
	// ReasonGeofenceInvalid: a stored rule is out of range or unusable.
	// Fail-closed: refuse and say why, never ignore the rule.
	ReasonGeofenceInvalid = "geofence_invalid"
	// ReasonGeofenceUnavailable: the rules could not be read at all.
	ReasonGeofenceUnavailable = "geofence_unavailable"
)

// on_missing_location values. Anything that is not exactly
// GeofenceOnMissingAllow denies — see the file comment.
const (
	GeofenceOnMissingDeny  = "deny"
	GeofenceOnMissingAllow = "allow"
)

// Radius and slack bounds. Re-checked on every read, not only at write time,
// so a hand-edited row or a downgrade cannot install a nonsense fence.
const (
	// MinGeofenceRadiusM: below this a fence is smaller than the error of the
	// measurement it is tested against, so it would deny at random.
	MinGeofenceRadiusM = 10.0
	// MaxGeofenceRadiusM: 50 km. Larger than any site; past this the rule is
	// not expressing "near the gate" and is almost certainly a units mistake.
	MaxGeofenceRadiusM = 50000.0
	// DefaultGeofenceSlackM forgives ordinary phone/anchor error without
	// making a modest radius meaningless.
	DefaultGeofenceSlackM = 75.0
	// MaxGeofenceSlackM caps the forgiveness band. Past a kilometre the slack
	// IS the fence, and the radius stops meaning anything.
	MaxGeofenceSlackM = 1000.0
)

// ErrInvalidGeofenceRule wraps every shape/validation refusal so handlers can
// answer 400 instead of 500. The wrapped text names the specific problem.
var ErrInvalidGeofenceRule = errors.New("invalid geofence rule")

// ErrGeofenceRuleExists is the one-rule-per-target collision.
var ErrGeofenceRuleExists = errors.New("geofence rule already exists for this target")

// ErrGeofenceAnchorRequired means the caller supplied no anchor and the target
// has no map pin to seed one from. Distinct from ErrInvalidGeofenceRule
// because the fix is different: drop a pin on the location (or pass lat/long),
// rather than correct a number that was sent.
var ErrGeofenceAnchorRequired = errors.New("geofence anchor required: the target has no map pin, so pass lat and long")

func invalidGeofence(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidGeofenceRule, fmt.Sprintf(format, args...))
}

// GeofenceRule is one stored rule. Exactly one of AccessPointID/LocationID is
// set; "" means "not this kind of target".
type GeofenceRule struct {
	ID                    string
	AccountID             string
	AccessPointID         string
	LocationID            string
	AnchorLat, AnchorLong float64
	RadiusM               float64
	SlackM                float64
	OnMissingLocation     string
	Note                  string
	CreatedByUserID       string
	CreatedAt             int64
	UpdatedAt             int64
}

// AllowanceM is the distance the rule actually tests against: the radius the
// operator asked for, plus the error they chose to forgive.
func (r GeofenceRule) AllowanceM() float64 { return r.RadiusM + r.SlackM }

// DeniesOnMissingLocation reports what this rule does with a request that
// carries no usable position. Written as "not allow" rather than "is deny" on
// purpose: a value nobody recognises must refuse, not open the gate.
func (r GeofenceRule) DeniesOnMissingLocation() bool {
	return r.OnMissingLocation != GeofenceOnMissingAllow
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

// earthRadiusM is the IUGG mean radius. The sphere approximation costs up to
// ~0.5% against the WGS84 ellipsoid, which on a 200 m fence is about a metre —
// two orders of magnitude below the GPS error slack_m already forgives, so a
// geodesic solver here would be precision theatre.
const earthRadiusM = 6371008.8

// HaversineM returns the great-circle distance in metres between two WGS84
// points given in degrees.
//
// Haversine and not the "flat earth over short distances" shortcut, which is
// where this kind of code usually breaks:
//
//   - THE ANTIMERIDIAN. A naive `dLong = long2 - long1` between +179.999 and
//     -179.999 gives ~360 degrees and a distance most of the way round the
//     planet, for two points 200 m apart. Here the difference only ever
//     reaches trigonometry as sin(dLong/2), which is periodic, so ±180 needs
//     no special case at all.
//   - THE POLES. Scaling longitude by cos(lat) — the equirectangular
//     approximation — collapses as cos(lat) approaches zero, and any formula
//     dividing by it produces infinities at 90 degrees. Nothing here divides
//     by cos(lat); it appears only as a bounded multiplier.
func HaversineM(lat1, long1, lat2, long2 float64) float64 {
	const rad = math.Pi / 180
	sinLat := math.Sin((lat2 - lat1) * rad / 2)
	sinLong := math.Sin((long2 - long1) * rad / 2)
	a := sinLat*sinLat + math.Cos(lat1*rad)*math.Cos(lat2*rad)*sinLong*sinLong
	// a is mathematically in [0,1], but rounding near-identical or near-
	// antipodal points can push it a hair outside, and math.Sqrt of a
	// negative is NaN. A NaN distance compares false against EVERY threshold,
	// which would silently turn a denial into an allow — the one arithmetic
	// slip in this file that would be a fail-open.
	if a < 0 {
		a = 0
	} else if a > 1 {
		a = 1
	}
	return 2 * earthRadiusM * math.Asin(math.Sqrt(a))
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ValidateGeofenceRule checks a rule's numbers without touching the database —
// the write path's gate, and the same code the read path re-runs on every open
// so a hand-edited row denies instead of misbehaving.
func ValidateGeofenceRule(anchorLat, anchorLong, radiusM, slackM float64, onMissing string) error {
	if !finite(anchorLat) || !finite(anchorLong) {
		return invalidGeofence("anchor is not a finite coordinate")
	}
	if anchorLat < -90 || anchorLat > 90 {
		return invalidGeofence("anchor latitude %v is outside -90..90", anchorLat)
	}
	if anchorLong < -180 || anchorLong > 180 {
		return invalidGeofence("anchor longitude %v is outside -180..180", anchorLong)
	}
	if !finite(radiusM) || radiusM < MinGeofenceRadiusM || radiusM > MaxGeofenceRadiusM {
		return invalidGeofence("radius_m must be between %g and %g metres (got %v)",
			MinGeofenceRadiusM, MaxGeofenceRadiusM, radiusM)
	}
	if !finite(slackM) || slackM < 0 || slackM > MaxGeofenceSlackM {
		return invalidGeofence("slack_m must be between 0 and %g metres (got %v)", MaxGeofenceSlackM, slackM)
	}
	if onMissing != GeofenceOnMissingDeny && onMissing != GeofenceOnMissingAllow {
		return invalidGeofence(
			"on_missing_location must be %q or %q (got %q) — what happens when a request carries no coordinates is not something this code may guess",
			GeofenceOnMissingDeny, GeofenceOnMissingAllow, onMissing)
	}
	return nil
}

func finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// reportedPosition normalises the position the request claims. A missing half,
// a non-finite number or an out-of-range degree value all mean the same thing
// and are handled the same way: WE DO NOT KNOW WHERE THIS REQUEST CAME FROM.
// Folding malformed input into "unknown" rather than into a distance is what
// keeps the rule's own OnMissingLocation setting the single place that decides
// what happens next — a garbage coordinate must not get its own, unconfigured,
// third behaviour.
func reportedPosition(lat, long *float64) (float64, float64, bool) {
	if lat == nil || long == nil {
		return 0, 0, false
	}
	la, lo := *lat, *long
	if !finite(la) || !finite(lo) {
		return 0, 0, false
	}
	if la < -90 || la > 90 || lo < -180 || lo > 180 {
		return 0, 0, false
	}
	return la, lo, true
}

// ---------------------------------------------------------------------------
// Evaluation — what openpath.go calls
// ---------------------------------------------------------------------------

// GeofenceDecision is the verdict for one open attempt.
type GeofenceDecision struct {
	Allowed bool
	// Reason is "" when allowed, else one of the four Reason* constants.
	Reason string
	// RuleID names the rule that denied (or failed to validate), so an
	// operator reading a log has somewhere to go.
	RuleID string
	// Detail is operator-facing prose for the invalid/unavailable cases.
	// Never shown to the person at the gate.
	Detail string
	// DistanceM and AllowanceM are set only on ReasonOutsideGeofence: how far
	// the claimed position was, and what it was tested against. Both are
	// measurements of an UNVERIFIED input — useful for an operator tuning a
	// radius, never evidence of anything.
	DistanceM  float64
	AllowanceM float64
}

// CheckGeofence is the open-path verdict: do this door's geofence rules permit
// an open from the position this request claims?
//
// No rule → allowed, with nothing recorded and nothing to interpret. That is
// the default and it is the whole point: an install that does not use this
// feature behaves EXACTLY as it did before it existed.
//
// It returns a decision rather than an error even when the read fails, because
// the choke point's contract is that a refusal is audited with a reason. A
// database broken enough to fail this read will fail the audit insert too, and
// LogAccess surfaces that as an error — but a single failed read must never
// become a silent allow.
//
// lat/long are the position the REQUEST CLAIMS. They are not evidence. See the
// file comment; every caller of this function is relying on a number a phone
// chose to send.
func (s *Store) CheckGeofence(ctx context.Context, accountID, accessPointID, locationID string, lat, long *float64) GeofenceDecision {
	rules, err := s.GeofenceRulesForTarget(ctx, accountID, accessPointID, locationID)
	if err != nil {
		return GeofenceDecision{Reason: ReasonGeofenceUnavailable, Detail: err.Error()}
	}
	if len(rules) == 0 {
		return GeofenceDecision{Allowed: true}
	}

	// Validate EVERY applicable rule before doing anything else, including
	// before looking at whether a position was supplied. A broken rule must
	// deny even when a second, well-formed rule would have allowed the
	// request on its missing-location setting: "one of your fences is
	// unreadable" is the fact the operator needs, and skipping it is exactly
	// how a typo becomes an unrestricted open.
	for _, r := range rules {
		if err := ValidateGeofenceRule(r.AnchorLat, r.AnchorLong, r.RadiusM, r.SlackM, r.OnMissingLocation); err != nil {
			return GeofenceDecision{Reason: ReasonGeofenceInvalid, RuleID: r.ID, Detail: err.Error()}
		}
	}

	posLat, posLong, known := reportedPosition(lat, long)
	if !known {
		for _, r := range rules {
			if r.DeniesOnMissingLocation() {
				return GeofenceDecision{Reason: ReasonGeofenceLocationRequired, RuleID: r.ID}
			}
		}
		// Every applicable rule was written with "allow" — the operator chose
		// this, in advance, per rule.
		return GeofenceDecision{Allowed: true}
	}

	for _, r := range rules {
		d := HaversineM(r.AnchorLat, r.AnchorLong, posLat, posLong)
		if allowance := r.AllowanceM(); d > allowance {
			return GeofenceDecision{
				Reason: ReasonOutsideGeofence, RuleID: r.ID,
				DistanceM: d, AllowanceM: allowance,
			}
		}
	}
	return GeofenceDecision{Allowed: true}
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const geofenceRuleCols = `id, account_id, coalesce(access_point_id, ''), coalesce(location_id, ''),
	anchor_lat, anchor_long, radius_m, slack_m, on_missing_location, note,
	coalesce(created_by_user_id, ''), created_at, updated_at`

func scanGeofenceRule(sc interface{ Scan(...any) error }) (*GeofenceRule, error) {
	var r GeofenceRule
	if err := sc.Scan(&r.ID, &r.AccountID, &r.AccessPointID, &r.LocationID,
		&r.AnchorLat, &r.AnchorLong, &r.RadiusM, &r.SlackM, &r.OnMissingLocation,
		&r.Note, &r.CreatedByUserID, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

// GeofenceRulesForTarget returns the rules that apply to one open attempt:
// this door, and any rule covering the location it sits in. This is the query
// the choke point runs, and the only one it runs.
//
// accountID is redundant with the access point (a rule's target already fixes
// its account, checked at write time) and is in the WHERE clause anyway — the
// package's tenancy rule is that account-scoping is not something a reader
// infers, it is something the SQL states.
func (s *Store) GeofenceRulesForTarget(ctx context.Context, accountID, accessPointID, locationID string) ([]GeofenceRule, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+geofenceRuleCols+` FROM geofence_rules
		 WHERE account_id = ? AND (access_point_id = ? OR location_id = ?)
		 ORDER BY created_at ASC`, accountID, accessPointID, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GeofenceRule{}
	for rows.Next() {
		r, err := scanGeofenceRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// GeofenceRulesForAccount lists an account's rules, newest first.
func (s *Store) GeofenceRulesForAccount(ctx context.Context, accountID string) ([]GeofenceRule, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+geofenceRuleCols+` FROM geofence_rules WHERE account_id = ?
		 ORDER BY created_at DESC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GeofenceRule{}
	for rows.Next() {
		r, err := scanGeofenceRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// GeofenceRuleByID is the account-scoped read. A rule in another account is
// indistinguishable from one that does not exist (the tenancy contract).
func (s *Store) GeofenceRuleByID(ctx context.Context, accountID, id string) (*GeofenceRule, error) {
	return scanGeofenceRule(s.db.QueryRowContext(ctx,
		`SELECT `+geofenceRuleCols+` FROM geofence_rules WHERE id = ? AND account_id = ?`,
		id, accountID))
}

// CreateGeofenceRuleArgs is the write shape. Exactly one of AccessPointID and
// LocationID may be set.
type CreateGeofenceRuleArgs struct {
	AccessPointID string
	LocationID    string
	// Lat/Long: nil means "seed the anchor from the target's map pin". Both
	// must be given together; one alone is a refusal, not half an anchor.
	Lat, Long *float64
	RadiusM   float64
	// SlackM: nil means DefaultGeofenceSlackM. Explicitly a pointer so that
	// "forgive nothing" (0) is expressible and is not silently replaced by
	// the default.
	SlackM *float64
	// OnMissingLocation: "" means GeofenceOnMissingDeny. The default is
	// applied HERE, once, so every caller gets the same safe answer, and the
	// stored value is always one of the two literals — the evaluator never
	// has to interpret an empty string.
	OnMissingLocation string
	Note              string
	CreatedByUserID   string
}

// CreateGeofenceRule validates the rule, checks the target belongs to
// accountID, seeds the anchor from the target's map pin when none was given,
// and inserts.
//
// Everything is verified BEFORE the insert: a refused rule must not leave a
// half-made restriction behind, and — more importantly — a rule pointing at
// another account's door would be a cross-tenant denial primitive.
func (s *Store) CreateGeofenceRule(ctx context.Context, accountID string, a CreateGeofenceRuleArgs) (*GeofenceRule, error) {
	if (a.AccessPointID == "") == (a.LocationID == "") {
		return nil, invalidGeofence("set exactly one of access_point_id or location_id")
	}
	if (a.Lat == nil) != (a.Long == nil) {
		return nil, invalidGeofence("lat and long must be given together")
	}
	if len(a.Note) > 2000 {
		return nil, invalidGeofence("note is too long")
	}

	// Target ownership, and the map pin the anchor may be seeded from. Both
	// reads are account-scoped, so a target in another account is ErrNotFound
	// and leaks nothing.
	var pinLat, pinLong sql.NullFloat64
	if a.AccessPointID != "" {
		ap, err := s.AccessPointDetailByID(ctx, accountID, a.AccessPointID)
		if err != nil {
			return nil, err
		}
		pinLat, pinLong = ap.Lat, ap.Long
		if !pinLat.Valid || !pinLong.Valid {
			// An access point usually has no pin of its own; fall back to the
			// site it sits in, which is the pin operators actually drop.
			if loc, err := s.LocationDetailByID(ctx, accountID, ap.LocationID); err == nil {
				pinLat, pinLong = loc.Lat, loc.Long
			}
		}
	} else {
		loc, err := s.LocationDetailByID(ctx, accountID, a.LocationID)
		if err != nil {
			return nil, err
		}
		pinLat, pinLong = loc.Lat, loc.Long
	}

	anchorLat, anchorLong := 0.0, 0.0
	switch {
	case a.Lat != nil:
		anchorLat, anchorLong = *a.Lat, *a.Long
	case pinLat.Valid && pinLong.Valid:
		anchorLat, anchorLong = pinLat.Float64, pinLong.Float64
	default:
		// No anchor and nothing to derive one from. Refusing is the only
		// honest outcome: a fence centred on (0,0) — the Gulf of Guinea, the
		// classic null-island bug — would deny every open on the planet and
		// look like a working rule.
		return nil, ErrGeofenceAnchorRequired
	}

	slack := DefaultGeofenceSlackM
	if a.SlackM != nil {
		slack = *a.SlackM
	}
	onMissing := a.OnMissingLocation
	if onMissing == "" {
		onMissing = GeofenceOnMissingDeny
	}
	if err := ValidateGeofenceRule(anchorLat, anchorLong, a.RadiusM, slack, onMissing); err != nil {
		return nil, err
	}

	id, t := NewID(), now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO geofence_rules
		   (id, account_id, access_point_id, location_id, anchor_lat, anchor_long,
		    radius_m, slack_m, on_missing_location, note, created_by_user_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, accountID, nullIfEmptyStr(a.AccessPointID), nullIfEmptyStr(a.LocationID),
		anchorLat, anchorLong, a.RadiusM, slack, onMissing, a.Note,
		nullIfEmptyStr(a.CreatedByUserID), t, t)
	if err != nil {
		if strings.Contains(strings.ToUpper(err.Error()), "UNIQUE") {
			return nil, ErrGeofenceRuleExists
		}
		return nil, err
	}
	return s.GeofenceRuleByID(ctx, accountID, id)
}

// DeleteGeofenceRule removes a restriction. Account-scoped.
//
// This is the escape hatch and it must stay one. A fence denies on evidence
// nobody can check, so the case where it is wrong — a phone with a bad fix, a
// rail that sends no coordinates at all, an anchor pinned on the wrong side of
// a complex — is ORDINARY, not exceptional. The management API is never
// geofence-restricted, only the gate is: an admin locked out at the gate can
// still delete the rule from anywhere.
func (s *Store) DeleteGeofenceRule(ctx context.Context, accountID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM geofence_rules WHERE id = ? AND account_id = ?`, id, accountID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
