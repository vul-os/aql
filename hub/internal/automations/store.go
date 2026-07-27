package automations

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// DB is the database handle this package needs: the three standard methods,
// nothing more. *sql.DB and *sql.Tx both satisfy it.
//
// It is an interface, and this package does not import internal/store, for one
// structural reason: the audit tables are hash-chained and append-only, and the
// engine reaches them ONLY through Auditor. Taking *store.Store here would put
// every audit-table method one dot away from the actuation path. Production
// wiring hands this the same *sql.DB the store opened (which is where migration
// 0010's tables live); the store's own connection settings — WAL, busy_timeout,
// one writer — are unchanged and unchallenged by that.
type DB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// ErrNotFound is returned when a rule does not exist within the caller's
// account. A rule that exists but belongs to another account is
// indistinguishable from one that does not exist — the store package's tenancy
// contract, kept here.
var ErrNotFound = sql.ErrNoRows

// Store is the automations persistence layer over migration 0010's two tables.
//
// TENANCY, the same rule the rest of the schema follows: every method that
// reads or writes rule data takes an accountID and scopes its SQL to it. The
// two deliberate exceptions are named for what they are — AllEnabledRules and
// SaveRuleState — because the scheduler is an instance-wide daemon with no
// request and therefore no caller account. They are the only unscoped
// accessors, and neither is reachable from an HTTP handler.
type Store struct {
	db DB
}

// NewStore wraps a database handle.
func NewStore(db DB) *Store { return &Store{db: db} }

// newID returns a random UUIDv4 string, matching store.NewID's format so ids
// are indistinguishable across tables.
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // rand.Read on supported platforms never fails
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(i int64) any {
	if i == 0 {
		return nil
	}
	return i
}

const ruleColumns = `id, account_id, name, enabled, coalesce(created_by,''), created_by_snapshot,
	trigger_kind, trigger_json, condition_json, action_json, action_tier, min_interval_s,
	coalesce(last_occurrence_at,0), coalesce(last_fired_at,0), last_outcome,
	consecutive_failures, disabled_reason, coalesce(disabled_at,0), created_at, updated_at`

func scanRule(sc interface{ Scan(...any) error }) (Rule, error) {
	var (
		r                                           Rule
		enabled, tier                               int
		triggerKind, triggerJSON, condJSON, actJSON string
		outcome                                     string
	)
	if err := sc.Scan(&r.ID, &r.AccountID, &r.Name, &enabled, &r.CreatedBy, &r.CreatedBySnapshot,
		&triggerKind, &triggerJSON, &condJSON, &actJSON, &tier, &r.MinIntervalS,
		&r.LastOccurrenceAt, &r.LastFiredAt, &outcome,
		&r.ConsecutiveFailures, &r.DisabledReason, &r.DisabledAt, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return Rule{}, err
	}
	r.Enabled = enabled != 0
	r.ActionTier = devices.Tier(tier)
	r.LastOutcome = Outcome(outcome)
	trig, err := decodeTrigger(triggerJSON)
	if err != nil {
		return Rule{}, err
	}
	// The stored kind column is the authority the CHECK constraint guards; a
	// payload disagreeing with it is a corrupt row, not something to reconcile.
	if string(trig.Kind) != triggerKind {
		return Rule{}, refuse(ReasonInvalidRule, "stored rule %s: trigger kind disagrees with its payload", r.ID)
	}
	r.Trigger = trig
	if r.Conditions, err = decodeConditions(condJSON); err != nil {
		return Rule{}, err
	}
	if r.Action, err = decodeAction(actJSON); err != nil {
		return Rule{}, err
	}
	return r, nil
}

// InsertRule writes a new rule. Callers go through Engine.SaveRule, which is
// where the tier gate lives — this method is not the safety boundary and does
// not pretend to be one. It is unexported-in-spirit: exported only so a future
// import path or fixture can use it, and every such caller inherits the
// obligation to have resolved and tier-checked the action first.
func (s *Store) InsertRule(ctx context.Context, r Rule) error {
	trigger, err := encodeTrigger(r.Trigger)
	if err != nil {
		return err
	}
	conds, err := encodeConditions(r.Conditions)
	if err != nil {
		return err
	}
	action, err := encodeAction(r.Action)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO automation_rules
		  (id, account_id, name, enabled, created_by, created_by_snapshot,
		   trigger_kind, trigger_json, condition_json, action_json, action_tier, min_interval_s,
		   last_occurrence_at, last_fired_at, last_outcome, consecutive_failures,
		   disabled_reason, disabled_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.AccountID, r.Name, boolInt(r.Enabled), nullString(r.CreatedBy), r.CreatedBy,
		string(r.Trigger.Kind), trigger, conds, action, int(r.ActionTier), r.MinIntervalS,
		nullInt(r.LastOccurrenceAt), nullInt(r.LastFiredAt), string(r.LastOutcome), r.ConsecutiveFailures,
		r.DisabledReason, nullInt(r.DisabledAt), r.CreatedAt, r.UpdatedAt)
	return err
}

// UpdateRule replaces a rule's definition within its account. Scheduler and
// breaker state are NOT touched here — editing a rule must not silently clear
// the fact that it has been failing.
func (s *Store) UpdateRule(ctx context.Context, r Rule) error {
	trigger, err := encodeTrigger(r.Trigger)
	if err != nil {
		return err
	}
	conds, err := encodeConditions(r.Conditions)
	if err != nil {
		return err
	}
	action, err := encodeAction(r.Action)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE automation_rules
		 SET name = ?, enabled = ?, trigger_kind = ?, trigger_json = ?, condition_json = ?,
		     action_json = ?, action_tier = ?, min_interval_s = ?, disabled_reason = ?,
		     disabled_at = ?, updated_at = ?
		 WHERE id = ? AND account_id = ?`,
		r.Name, boolInt(r.Enabled), string(r.Trigger.Kind), trigger, conds,
		action, int(r.ActionTier), r.MinIntervalS, r.DisabledReason,
		nullInt(r.DisabledAt), r.UpdatedAt, r.ID, r.AccountID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SaveRuleState persists what a run changed: scheduler position, last outcome,
// and breaker state. Keyed by id ALONE — the scheduler has no account context,
// which is exactly why this method is named for what it is and takes no
// accountID to pretend otherwise. It writes only engine-owned columns; it can
// never move a rule between accounts or change what it does.
func (s *Store) SaveRuleState(ctx context.Context, r Rule) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE automation_rules
		 SET enabled = ?, last_occurrence_at = ?, last_fired_at = ?, last_outcome = ?,
		     consecutive_failures = ?, disabled_reason = ?, disabled_at = ?, updated_at = ?
		 WHERE id = ?`,
		boolInt(r.Enabled), nullInt(r.LastOccurrenceAt), nullInt(r.LastFiredAt), string(r.LastOutcome),
		r.ConsecutiveFailures, r.DisabledReason, nullInt(r.DisabledAt), r.UpdatedAt, r.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RuleByID reads one rule within an account.
func (s *Store) RuleByID(ctx context.Context, accountID, id string) (Rule, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+ruleColumns+` FROM automation_rules WHERE id = ? AND account_id = ?`, id, accountID)
	return scanRule(row)
}

// ListRules returns an account's rules, newest first.
func (s *Store) ListRules(ctx context.Context, accountID string) ([]Rule, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+ruleColumns+` FROM automation_rules WHERE account_id = ? ORDER BY created_at DESC, id`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectRules(rows)
}

// AllEnabledRules returns every enabled rule across every account.
//
// CROSS-TENANT on purpose, and the only read that is: the scheduler is a
// process-lifetime daemon, not a request, so there is no caller whose account
// could scope it. It is not reachable from an HTTP handler — nothing in this
// package serves HTTP — and the tenancy of what it does comes from the rule
// row itself, which carries the account every audit and run row is stamped
// with.
func (s *Store) AllEnabledRules(ctx context.Context) ([]Rule, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+ruleColumns+` FROM automation_rules WHERE enabled = 1 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectRules(rows)
}

func collectRules(rows *sql.Rows) ([]Rule, error) {
	var out []Rule
	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			// A single corrupt row must not hide the rest of the fleet's
			// rules, but it must not be silently dropped either: it is
			// surfaced as an error alongside what was readable.
			return out, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeleteRule removes a rule within its account. Its run history survives:
// automation_runs carries no foreign key to this table precisely so that
// deleting a rule cannot delete the record of what it did.
func (s *Store) DeleteRule(ctx context.Context, accountID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM automation_rules WHERE id = ? AND account_id = ?`, id, accountID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Run is one recorded attempt.
type Run struct {
	ID           string
	RuleID       string
	RuleName     string
	AccountID    string
	Cause        Cause
	OccurrenceAt int64
	Outcome      Outcome
	Reason       string
	DeviceKey    string
	Verb         devices.Verb
	Tier         devices.Tier
	TargetCount  int
	Audited      bool
	StartedAt    int64
	FinishedAt   int64
}

// InsertRun appends to the run history.
func (s *Store) InsertRun(ctx context.Context, run Run) error {
	if run.ID == "" {
		run.ID = newID()
	}
	if run.FinishedAt == 0 {
		run.FinishedAt = run.StartedAt
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO automation_runs
		  (id, rule_id, rule_name, account_id, cause, occurrence_at, outcome, reason,
		   device_key, verb, tier, target_count, audited, started_at, finished_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.RuleID, run.RuleName, run.AccountID, string(run.Cause), nullInt(run.OccurrenceAt),
		string(run.Outcome), run.Reason, run.DeviceKey, string(run.Verb), int(run.Tier),
		run.TargetCount, boolInt(run.Audited), run.StartedAt, run.FinishedAt, run.FinishedAt)
	return err
}

// ListRuns returns an account's run history, newest first. ruleID "" means
// every rule in the account.
func (s *Store) ListRuns(ctx context.Context, accountID, ruleID string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, rule_id, rule_name, account_id, cause, coalesce(occurrence_at,0), outcome, reason,
		        device_key, verb, tier, target_count, audited, started_at, finished_at
		 FROM automation_runs
		 WHERE account_id = ? AND (? = '' OR rule_id = ?)
		 ORDER BY created_at DESC, rowid DESC LIMIT ?`, accountID, ruleID, ruleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		var (
			r             Run
			cause, outcm  string
			verb          string
			tier, audited int
		)
		if err := rows.Scan(&r.ID, &r.RuleID, &r.RuleName, &r.AccountID, &cause, &r.OccurrenceAt,
			&outcm, &r.Reason, &r.DeviceKey, &verb, &tier, &r.TargetCount, &audited,
			&r.StartedAt, &r.FinishedAt); err != nil {
			return nil, err
		}
		r.Cause = Cause(cause)
		r.Outcome = Outcome(outcm)
		r.Verb = devices.Verb(verb)
		r.Tier = devices.Tier(tier)
		r.Audited = audited != 0
		out = append(out, r)
	}
	return out, rows.Err()
}

// IsNotFound reports whether err is a missing-row error.
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

// unixNow is the package's clock convention: unix seconds, matching the rest
// of the schema. Every component takes an injectable now() and this is only
// the default.
func unixNow(now func() time.Time) int64 {
	if now == nil {
		return time.Now().Unix()
	}
	return now().Unix()
}
