package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// Step-up intents for T4 chat commands — schema and reasoning in
// migrations/0034_chat_stepup_intents.sql.
//
// # The one property everything here exists to hold
//
// An intent is APPROVED AT MOST ONCE, and the caller that wins the approval is
// the only one that actuates. Everything else — expiry, the account scope, the
// requester/approver split — bounds who can reach that moment; this is the
// moment itself.
//
// So ApproveIntent is a single conditional UPDATE that returns the row it
// changed, and the caller executes only if it got one. A read-then-write would
// let two console tabs both see `pending`, both decide to proceed, and start a
// mower twice.

// StepUpIntent is one T4 command awaiting approval on the console rail.
type StepUpIntent struct {
	ID                string
	AccountID         string
	RequestedByUserID string
	Source            string
	ChatID            string
	DeviceKey         string
	Verb              string
	CreatedAt         int64
	ExpiresAt         int64
	Status            string // pending | approved | rejected (stored)
	DecidedByUserID   sql.NullString
	DecidedAt         sql.NullInt64
	T4WindowID        sql.NullString
	Outcome           string
	OutcomeDetail     string
}

// EffectiveStatus derives what an intent is now: rejected > approved > expired >
// pending.
//
// Approved outranks expired because an approved intent has already actuated (or
// tried to), and reporting that as "expired" would hide the fact that something
// happened.
func (i *StepUpIntent) EffectiveStatus(nowUnix int64) string {
	switch {
	case i.Status == "rejected":
		return "rejected"
	case i.Status == "approved":
		return "approved"
	case i.ExpiresAt <= nowUnix:
		return "expired"
	default:
		return "pending"
	}
}

// ErrIntentInvalid is returned for an intent that could never be approved.
var ErrIntentInvalid = errors.New("store: invalid step-up intent")

// StepUpIntentArgs is what the chat rail records when it refuses to act alone.
type StepUpIntentArgs struct {
	AccountID         string
	RequestedByUserID string
	Source            string
	ChatID            string
	DeviceKey         string
	Verb              string
	CreatedAt         int64
	ExpiresAt         int64
}

// CreateStepUpIntent records a T4 command awaiting console approval.
//
// Creating one actuates nothing and consumes nothing — in particular it does NOT
// consume a T4 window use. An intent that is never approved must not cost the
// operator a use, or a member could exhaust a window by asking repeatedly and
// never approving.
func (s *Store) CreateStepUpIntent(ctx context.Context, a StepUpIntentArgs) (*StepUpIntent, error) {
	if strings.TrimSpace(a.DeviceKey) == "" || strings.TrimSpace(a.Verb) == "" {
		return nil, ErrIntentInvalid
	}
	if a.ExpiresAt <= a.CreatedAt {
		return nil, ErrIntentInvalid
	}
	id := NewID()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO chat_stepup_intents
		   (id, account_id, requested_by_user_id, source, chat_id, device_key, verb,
		    created_at, expires_at, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
		id, a.AccountID, a.RequestedByUserID, a.Source, a.ChatID, a.DeviceKey, a.Verb,
		a.CreatedAt, a.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return s.StepUpIntentByID(ctx, a.AccountID, id)
}

const stepUpIntentColumns = `id, account_id, requested_by_user_id, source, chat_id,
	device_key, verb, created_at, expires_at, status, decided_by_user_id, decided_at,
	t4_window_id, outcome, outcome_detail`

func scanStepUpIntent(sc interface{ Scan(...any) error }) (*StepUpIntent, error) {
	var i StepUpIntent
	if err := sc.Scan(&i.ID, &i.AccountID, &i.RequestedByUserID, &i.Source, &i.ChatID,
		&i.DeviceKey, &i.Verb, &i.CreatedAt, &i.ExpiresAt, &i.Status,
		&i.DecidedByUserID, &i.DecidedAt, &i.T4WindowID, &i.Outcome, &i.OutcomeDetail); err != nil {
		return nil, err
	}
	return &i, nil
}

// StepUpIntentByID reads one intent, scoped to its account.
func (s *Store) StepUpIntentByID(ctx context.Context, accountID, id string) (*StepUpIntent, error) {
	return scanStepUpIntent(s.db.QueryRowContext(ctx,
		`SELECT `+stepUpIntentColumns+` FROM chat_stepup_intents WHERE id = ? AND account_id = ?`,
		id, accountID))
}

// StepUpIntentsByAccount lists intents for an account, newest first.
//
// Includes decided and expired ones. The console's question is "what has been
// asked for here", and an approval screen that showed only what is live would
// make a rejected request indistinguishable from one that was never made.
func (s *Store) StepUpIntentsByAccount(ctx context.Context, accountID string, limit int) ([]StepUpIntent, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+stepUpIntentColumns+` FROM chat_stepup_intents
		 WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StepUpIntent{}
	for rows.Next() {
		i, err := scanStepUpIntent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

// ClaimStepUpIntent moves a pending, unexpired intent to `approved` and returns
// it — or returns nil when it was already decided, has expired, or is not this
// account's.
//
// THE atomic step. Every condition is in the WHERE, and the row is returned by
// the same statement that changed it, so exactly one caller can ever be handed
// an intent to act on. Two console tabs pressing approve at the same instant
// produce one actuation and one "already decided".
//
// nowUnix is passed rather than read here so the expiry comparison uses the same
// clock the caller already used to decide what to show.
func (s *Store) ClaimStepUpIntent(ctx context.Context, accountID, id, byUserID string, nowUnix int64) (*StepUpIntent, error) {
	if nowUnix == 0 {
		nowUnix = now()
	}
	i, err := scanStepUpIntent(s.db.QueryRowContext(ctx,
		`UPDATE chat_stepup_intents
		 SET status = 'approved', decided_by_user_id = ?, decided_at = ?
		 WHERE id = ? AND account_id = ? AND status = 'pending' AND expires_at > ?
		 RETURNING `+stepUpIntentColumns,
		byUserID, nowUnix, id, accountID, nowUnix))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return i, nil
}

// RejectStepUpIntent declines an intent. Same conditional shape as the claim, so
// a reject racing an approve resolves to exactly one outcome.
func (s *Store) RejectStepUpIntent(ctx context.Context, accountID, id, byUserID string, nowUnix int64) (bool, error) {
	if nowUnix == 0 {
		nowUnix = now()
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE chat_stepup_intents
		 SET status = 'rejected', decided_by_user_id = ?, decided_at = ?
		 WHERE id = ? AND account_id = ? AND status = 'pending' AND expires_at > ?`,
		byUserID, nowUnix, id, accountID, nowUnix)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// RecordStepUpOutcome writes what the device did, and which window paid for it.
//
// Separate from the claim because the claim must commit BEFORE the device is
// touched: if actuation and the status change shared one transaction, a hub that
// died mid-command would roll back to `pending` and the same command could be
// approved again — after it had already gone out.
func (s *Store) RecordStepUpOutcome(ctx context.Context, accountID, id, windowID, outcome, detail string) error {
	var w any
	if windowID != "" {
		w = windowID
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE chat_stepup_intents
		 SET outcome = ?, outcome_detail = ?, t4_window_id = ?
		 WHERE id = ? AND account_id = ?`,
		outcome, detail, w, id, accountID)
	return err
}

// TryConsumeT4Window claims one use of a live operator-armed window for this
// (device, verb), returning the window id it consumed or "" when there is none.
//
// Lives here rather than in t4window.go because this is where its only caller
// is: a window is spent at the moment an approved intent actuates, and nowhere
// else. It was written with t4window.go and removed before that commit, because
// at the time nothing in production called it — the store's reachability guard
// refuses code that runs only in tests, and it was right to.
//
// The claim is ATOMIC, one `UPDATE … RETURNING` with every liveness condition in
// the sub-select. A read-then-write would let two approvals of two intents both
// pass a max_uses of 1.
//
// Ordered by ends_at ASC, matching TryConsumeGrant: when two windows would admit
// the same command, spend the one expiring soonest so the longer one survives.
func (s *Store) TryConsumeT4Window(ctx context.Context, accountID, deviceKey, verb string, nowUnix int64) (string, error) {
	if nowUnix == 0 {
		nowUnix = now()
	}
	var id string
	err := s.db.QueryRowContext(ctx,
		`UPDATE chat_t4_windows
		 SET uses_count = uses_count + 1, updated_at = ?
		 WHERE id = (
		   SELECT w.id FROM chat_t4_windows w
		   WHERE w.account_id = ? AND w.device_key = ? AND w.verb = ?
		     AND w.status = 'active'
		     AND w.starts_at <= ? AND w.ends_at > ?
		     AND (w.max_uses IS NULL OR w.uses_count < w.max_uses)
		   ORDER BY w.ends_at ASC LIMIT 1
		 )
		 RETURNING id`,
		nowUnix, accountID, deviceKey, verb, nowUnix, nowUnix).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return id, nil
}

// AnyLiveT4Window reports whether a window would admit this (device, verb) right
// now, WITHOUT spending a use.
//
// The chat rail needs this to answer honestly at the moment a command arrives —
// "no window is armed for that" is a different refusal from "approve it in the
// console" — and asking must not cost the operator a use. Consumption happens
// only when an approved intent actuates.
func (s *Store) AnyLiveT4Window(ctx context.Context, accountID, deviceKey, verb string, nowUnix int64) (bool, error) {
	if nowUnix == 0 {
		nowUnix = now()
	}
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM chat_t4_windows
		 WHERE account_id = ? AND device_key = ? AND verb = ?
		   AND status = 'active' AND starts_at <= ? AND ends_at > ?
		   AND (max_uses IS NULL OR uses_count < max_uses)
		 LIMIT 1`,
		accountID, deviceKey, verb, nowUnix, nowUnix).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// RefundT4WindowUse hands one use back.
//
// A window spent for a command the device then refused must not cost the
// operator a use. The max(…, 0) floor is there because a refund arriving twice
// must not push the counter negative and quietly grant an extra use.
func (s *Store) RefundT4WindowUse(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE chat_t4_windows
		 SET uses_count = max(uses_count - 1, 0), updated_at = ?
		 WHERE id = ?`, now(), id)
	return err
}
