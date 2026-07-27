package store

import (
	"context"
	"database/sql"
	"strings"
)

// Webhook persistence.
//
// The one rule this file exists to hold: NO READ PATH RETURNS THE SECRET. The
// listing and get projections below name their columns explicitly and `secret`
// is absent from every one of them, so a handler cannot leak it by forgetting
// to strip a field — there is no field to strip. The only way to obtain a
// secret is SigningSecret, which the dispatcher calls and no HTTP handler does.
//
// Deliveries are recorded out of band. The open path never touches this file:
// a webhook is a notification about something that has already happened and
// already been audited, and no failure to deliver one may affect whether a
// gate opens.

// Webhook is the operator-facing view. It deliberately has no Secret field —
// see the file comment.
type Webhook struct {
	ID             string
	AccountID      string
	Name           string
	URL            string
	Events         []string
	AllowPrivate   bool
	Enabled        bool
	DisabledAt     int64
	DisabledReason string
	CreatedAt      int64
	UpdatedAt      int64
}

// CreateWebhookArgs carries the secret INTO the store. It is the only
// direction that value travels through this API.
type CreateWebhookArgs struct {
	AccountID    string
	Name         string
	URL          string
	Secret       string
	Events       []string
	AllowPrivate bool
}

func (s *Store) CreateWebhook(ctx context.Context, a CreateWebhookArgs) (*Webhook, error) {
	id, t := NewID(), now()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO webhooks (id, account_id, name, url, secret, events, allow_private, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		id, a.AccountID, a.Name, a.URL, a.Secret, strings.Join(a.Events, ","),
		boolInt(a.AllowPrivate), t, t); err != nil {
		return nil, err
	}
	return s.WebhookByID(ctx, a.AccountID, id)
}

// webhookCols is the projection every read path uses. `secret` is not in it,
// and that is the point.
const webhookCols = `id, account_id, name, url, events, allow_private, enabled,
	coalesce(disabled_at, 0), coalesce(disabled_reason, ''), created_at, updated_at`

func scanWebhook(sc interface{ Scan(...any) error }) (*Webhook, error) {
	var w Webhook
	var events string
	var allowPrivate, enabled int
	if err := sc.Scan(&w.ID, &w.AccountID, &w.Name, &w.URL, &events, &allowPrivate,
		&enabled, &w.DisabledAt, &w.DisabledReason, &w.CreatedAt, &w.UpdatedAt); err != nil {
		return nil, err
	}
	if events != "" {
		w.Events = strings.Split(events, ",")
	}
	w.AllowPrivate = allowPrivate == 1
	w.Enabled = enabled == 1
	return &w, nil
}

// WebhooksForAccount lists an account's webhooks. Account-scoped, like every
// other tenant read here.
func (s *Store) WebhooksForAccount(ctx context.Context, accountID string) ([]Webhook, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+webhookCols+` FROM webhooks WHERE account_id = ? ORDER BY created_at DESC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (s *Store) WebhookByID(ctx context.Context, accountID, id string) (*Webhook, error) {
	return scanWebhook(s.db.QueryRowContext(ctx,
		`SELECT `+webhookCols+` FROM webhooks WHERE id = ? AND account_id = ?`, id, accountID))
}

// DeleteWebhook removes a subscription. Its deliveries cascade.
func (s *Store) DeleteWebhook(ctx context.Context, accountID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM webhooks WHERE id = ? AND account_id = ?`, id, accountID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SigningSecret returns a webhook's HMAC key. This is the ONLY accessor for
// it, it is not part of any projection, and nothing in internal/httpapi's
// handler layer calls it — only the dispatcher does.
func (s *Store) SigningSecret(ctx context.Context, id string) (string, error) {
	var secret string
	err := s.db.QueryRowContext(ctx, `SELECT secret FROM webhooks WHERE id = ?`, id).Scan(&secret)
	return secret, err
}

// EnabledWebhooksForEvent returns the endpoints that want this event, for the
// dispatcher. A webhook disabled by the dispatcher itself (disabled_at set)
// stays out until an operator re-enables it, so a dead URL stops costing an
// attempt on every open forever.
func (s *Store) EnabledWebhooksForEvent(ctx context.Context, accountID, event string) ([]Webhook, error) {
	all, err := s.WebhooksForAccount(ctx, accountID)
	if err != nil {
		return nil, err
	}
	out := []Webhook{}
	for _, w := range all {
		if !w.Enabled || w.DisabledAt != 0 {
			continue
		}
		for _, e := range w.Events {
			if e == event {
				out = append(out, w)
				break
			}
		}
	}
	return out, nil
}

// DisableWebhook marks an endpoint dead, with the reason an operator will need
// to fix it. Called by the dispatcher after repeated failure, never by a
// delivery attempt.
func (s *Store) DisableWebhook(ctx context.Context, id, reason string) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE webhooks SET enabled = 0, disabled_at = ?, disabled_reason = ?, updated_at = ?
		 WHERE id = ?`, t, reason, t, id)
	return err
}

// RecordDelivery writes one attempt's outcome.
//
// responseCode is nil when no response arrived at all — deliberately distinct
// from a 500. "The receiver said no" and "the receiver was never reached" are
// different problems with different fixes, and collapsing them costs an
// operator the one clue that tells them which.
func (s *Store) RecordDelivery(ctx context.Context, accountID, webhookID, event, payload string,
	attempt int, status string, responseCode *int, errText string) error {
	t := now()
	var completed any
	if status != "pending" {
		completed = t
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO webhook_deliveries
		   (id, webhook_id, account_id, event, payload, attempt, status, response_code, error, created_at, completed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		NewID(), webhookID, accountID, event, payload, attempt, status, responseCode, errText, t, completed)
	return err
}
