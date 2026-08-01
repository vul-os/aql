package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// Operator-armed T4 windows — CHAT-COMMANDS.md §3.4, schema in
// migrations/0033_chat_t4_windows.sql.
//
// # What a window is worth
//
// A live window makes a T4 verb ELIGIBLE to be considered over chat. It is not
// authorization, not a confirmation, and not a step-up. §3.3's T4 row requires
// all of those independently, and a window that actuated anything on its own
// would collapse three checks into one.
//
// That is why nothing here executes and nothing here knows what a device is.
// The only thing this file can do is answer "did an operator arm this exact
// (device, verb), and is that window live" — and consume one use when the
// answer is yes.
//
// # Why expiry is derived rather than stored
//
// Status on disk is 'active' or 'disarmed'. Expired and exhausted are computed.
// A stored 'expired' would be a claim someone has to keep true — a sweeper — and
// a sweeper that stops running turns every expired window into a live one, which
// is the failure that opens a gate. Derivation cannot fail that way: the
// timestamps are the truth and every read applies them.

// T4Window is one operator-armed window.
//
// Field names mirror Grant deliberately so the two read alike; see the
// migration's header for why they are nonetheless separate tables.
type T4Window struct {
	ID               string
	AccountID        string
	DeviceKey        string
	Verb             string
	ArmedByUserID    string
	StartsAt         int64
	EndsAt           int64
	MaxUses          sql.NullInt64
	UsesCount        int64
	Status           string // active | disarmed (stored)
	DisarmedAt       sql.NullInt64
	DisarmedByUserID sql.NullString
	Notes            string
	CreatedAt        int64
	UpdatedAt        int64
}

// EffectiveStatus derives the live status, in the same precedence order
// Grant.EffectiveStatus uses: disarmed > exhausted > pending > expired > active.
//
// The order is the point. A window that was disarmed AND has expired reports
// "disarmed", because that is the fact an operator asked for and the one they
// will look for when auditing.
func (w *T4Window) EffectiveStatus(nowUnix int64) string {
	switch {
	case w.Status == "disarmed":
		return "disarmed"
	case w.MaxUses.Valid && w.UsesCount >= w.MaxUses.Int64:
		return "exhausted"
	case w.StartsAt > nowUnix:
		return "pending"
	case w.EndsAt <= nowUnix:
		return "expired"
	default:
		return "active"
	}
}

// Live reports whether this window would admit a use right now.
func (w *T4Window) Live(nowUnix int64) bool { return w.EffectiveStatus(nowUnix) == "active" }

// ErrWindowInvalid is returned when the requested window could never be
// consumed. Distinct from a database error so a handler can answer 400 rather
// than 500 — a caller asking for a window that ends before it starts has made a
// mistake, not found a fault.
var ErrWindowInvalid = errors.New("store: invalid t4 window")

// ArmT4WindowArgs is what an operator states when arming.
type T4WindowArgs struct {
	AccountID     string
	DeviceKey     string
	Verb          string
	ArmedByUserID string
	StartsAt      int64
	EndsAt        int64
	MaxUses       sql.NullInt64
	Notes         string
}

// ArmT4Window records a window an operator has armed.
//
// Deliberately does NOT check that device_key names a real device or that verb
// is a real verb. The store is not the authority on either — the registry is —
// and a second copy of that judgement here would be a second thing to disagree
// with the first. A window naming a device that does not exist is inert: the
// consume path is only ever reached with a key the registry resolved.
func (s *Store) ArmT4Window(ctx context.Context, a T4WindowArgs) (*T4Window, error) {
	if strings.TrimSpace(a.DeviceKey) == "" || strings.TrimSpace(a.Verb) == "" {
		return nil, ErrWindowInvalid
	}
	if a.EndsAt <= a.StartsAt {
		return nil, ErrWindowInvalid
	}
	// A cap of zero is not "no cap" — it is a window that can never be used, and
	// almost certainly a caller that meant to leave it unset. Refused rather
	// than stored, because a window that silently never works is worse than an
	// error at the moment of arming.
	if a.MaxUses.Valid && a.MaxUses.Int64 <= 0 {
		return nil, ErrWindowInvalid
	}

	id := NewID()
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO chat_t4_windows
		   (id, account_id, device_key, verb, armed_by_user_id,
		    starts_at, ends_at, max_uses, uses_count, status, notes,
		    created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
		id, a.AccountID, a.DeviceKey, a.Verb, a.ArmedByUserID,
		a.StartsAt, a.EndsAt, a.MaxUses, a.Notes, ts, ts)
	if err != nil {
		return nil, err
	}
	return s.T4WindowByID(ctx, a.AccountID, id)
}

const t4WindowColumns = `id, account_id, device_key, verb, armed_by_user_id,
	starts_at, ends_at, max_uses, uses_count, status, disarmed_at,
	disarmed_by_user_id, notes, created_at, updated_at`

func scanT4Window(sc interface{ Scan(...any) error }) (*T4Window, error) {
	var w T4Window
	if err := sc.Scan(&w.ID, &w.AccountID, &w.DeviceKey, &w.Verb, &w.ArmedByUserID,
		&w.StartsAt, &w.EndsAt, &w.MaxUses, &w.UsesCount, &w.Status, &w.DisarmedAt,
		&w.DisarmedByUserID, &w.Notes, &w.CreatedAt, &w.UpdatedAt); err != nil {
		return nil, err
	}
	return &w, nil
}

// T4WindowByID reads one window, scoped to its account.
//
// The account is a PARAMETER rather than something checked afterwards: a lookup
// that finds the row first and compares the account second is one forgotten
// comparison away from cross-account read, and this is the kind of row where
// that matters.
func (s *Store) T4WindowByID(ctx context.Context, accountID, id string) (*T4Window, error) {
	return scanT4Window(s.db.QueryRowContext(ctx,
		`SELECT `+t4WindowColumns+` FROM chat_t4_windows WHERE id = ? AND account_id = ?`,
		id, accountID))
}

// T4WindowsByAccount lists every window for an account, newest first.
//
// Returns disarmed and expired windows too. The console's question is "what has
// been armed here", and a list that hid the answer would make a forgotten
// standing window invisible — which is exactly the thing an operator reviewing
// this page is looking for.
func (s *Store) T4WindowsByAccount(ctx context.Context, accountID string, limit int) ([]T4Window, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+t4WindowColumns+` FROM chat_t4_windows
		 WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T4Window{}
	for rows.Next() {
		w, err := scanT4Window(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// DisarmT4Window closes a window early.
//
// Idempotent by the WHERE clause rather than by reading first: disarming an
// already-disarmed window reports false, and two operators racing to disarm the
// same window both succeed in the only sense that matters.
func (s *Store) DisarmT4Window(ctx context.Context, accountID, id, byUserID string) (bool, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE chat_t4_windows
		 SET status = 'disarmed', disarmed_at = ?, disarmed_by_user_id = ?, updated_at = ?
		 WHERE id = ? AND account_id = ? AND status = 'active'`,
		now(), byUserID, now(), id, accountID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// The CONSUME half is deliberately not here yet.
//
// TryConsumeT4Window and RefundT4WindowUse were written alongside this file --
// an atomic `UPDATE ... RETURNING` claim so a use cap holds under the duplicate
// delivery chat rails produce, and a refund with a max(..., 0) floor. They were
// then removed before commit, because their only caller is the chat T4 path and
// that path refuses every T4 verb today.
//
// The store's reachability guard is what forced the issue, and it was right to.
// Its rule: a method reachable only from tests is either an exception with a
// durable reason, or unfinished work -- and "we never finished wiring it up" is
// explicitly not a reason. Every previous instance it caught was a feature that
// did not work while its tests passed, because the code was correct and never
// executed.
//
// So what remains here is the half that has a caller: an operator can arm a
// window, see it, and close it. Nothing consumes one. That is a record, not a
// permission, and the routes in httpapi/t4windows.go say so.
