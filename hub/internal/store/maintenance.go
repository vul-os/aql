package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// The per-access-point maintenance log. See migrations/0017_maintenance.sql for
// the schema rationale — in particular why movement-based scheduling is absent
// rather than stored-and-ignored.
//
// The log is append-only by construction: there is no update or delete here,
// and adding one would need a reason better than "the form has an edit button".
// A wrong entry is corrected by logging another, which is the same discipline
// the audit tables use and for the same reason — a service history that can be
// rewritten is not a service history.

// MaintenanceKinds is the closed vocabulary, matching the CHECK constraint.
// Exported so the HTTP layer validates against the same list the database
// enforces rather than a second copy that can drift from it.
var MaintenanceKinds = map[string]bool{
	"inspection":  true,
	"service":     true,
	"repair":      true,
	"replacement": true,
}

// MaintenanceEvent is one logged piece of work.
type MaintenanceEvent struct {
	ID             string
	AccessPointID  string
	Kind           string
	PerformedAt    int64
	PerformedBy    string // "" when the member has since been removed
	TechnicianName string
	Notes          string
	Parts          string // raw JSON array, "" when none
	CostZARCents   sql.NullInt64
	NextDueAt      sql.NullInt64
	CreatedAt      int64
}

// MaintenanceSummary is the derived answer to "when is this due", read from the
// most recent event.
//
// It carries no movement figures. Nothing measures movement (see the migration),
// so a "42% of service interval used" would be a number with nothing behind it.
type MaintenanceSummary struct {
	LastServicedAt sql.NullInt64
	NextDueAt      sql.NullInt64
	DueNow         bool
}

// ErrAccessPointMissing means the access point does not exist.
var ErrAccessPointMissing = errors.New("store: access point not found")

// MaintenanceList returns one access point's history, newest work first.
//
// Ordered by performed_at rather than created_at: the reader wants the order
// the work happened in, not the order someone got round to typing it. Ties
// break on created_at so the order is total and a list does not reshuffle
// between requests.
func (s *Store) MaintenanceList(ctx context.Context, accessPointID string, limit int) ([]MaintenanceEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, access_point_id, kind, performed_at, performed_by, technician_name,
		        notes, parts, cost_zar_cents, next_due_at, created_at
		   FROM maintenance_events
		  WHERE access_point_id = ?
		  ORDER BY performed_at DESC, created_at DESC
		  LIMIT ?`, accessPointID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]MaintenanceEvent, 0, 16)
	for rows.Next() {
		var e MaintenanceEvent
		var by, tech, notes, parts sql.NullString
		if err := rows.Scan(&e.ID, &e.AccessPointID, &e.Kind, &e.PerformedAt, &by, &tech,
			&notes, &parts, &e.CostZARCents, &e.NextDueAt, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.PerformedBy = by.String
		e.TechnicianName = tech.String
		e.Notes = notes.String
		e.Parts = parts.String
		out = append(out, e)
	}
	return out, rows.Err()
}

// MaintenanceCreate appends one event.
//
// performedBy is the member logging it, which is not necessarily who did the
// work — technicianName carries that, as free text, because a contractor has no
// account here.
func (s *Store) MaintenanceCreate(ctx context.Context, e MaintenanceEvent) (*MaintenanceEvent, error) {
	// Existence is checked rather than left to the foreign key so the caller
	// gets "no such access point" instead of a constraint error it would have
	// to parse a driver string to recognise.
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM access_points WHERE id = ?`, e.AccessPointID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAccessPointMissing
	}
	if err != nil {
		return nil, err
	}

	e.ID = NewID()
	e.CreatedAt = now()
	if e.PerformedAt == 0 {
		e.PerformedAt = e.CreatedAt
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO maintenance_events
		   (id, access_point_id, kind, performed_at, performed_by, technician_name,
		    notes, parts, cost_zar_cents, next_due_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.AccessPointID, e.Kind, e.PerformedAt,
		nullIfBlank(e.PerformedBy), nullIfBlank(e.TechnicianName),
		nullIfBlank(e.Notes), nullIfBlank(e.Parts),
		e.CostZARCents, e.NextDueAt, e.CreatedAt); err != nil {
		return nil, err
	}
	return &e, nil
}

// MaintenanceSummaryFor derives the due state for one access point.
//
// last_serviced_at deliberately ignores inspections: an inspection is someone
// looking at a gate, not someone servicing it, and treating the two alike would
// let a walk-past reset a service interval.
//
// next_due_at comes from the most recent event that SET one, in performed_at
// order — so a later repair that scheduled nothing does not erase the due date
// a service established.
func (s *Store) MaintenanceSummaryFor(ctx context.Context, accessPointID string, nowUnix int64) (MaintenanceSummary, error) {
	var sum MaintenanceSummary

	err := s.db.QueryRowContext(ctx,
		`SELECT MAX(performed_at) FROM maintenance_events
		  WHERE access_point_id = ? AND kind <> 'inspection'`, accessPointID).Scan(&sum.LastServicedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return sum, err
	}

	err = s.db.QueryRowContext(ctx,
		`SELECT next_due_at FROM maintenance_events
		  WHERE access_point_id = ? AND next_due_at IS NOT NULL
		  ORDER BY performed_at DESC, created_at DESC
		  LIMIT 1`, accessPointID).Scan(&sum.NextDueAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return sum, err
	}

	sum.DueNow = sum.NextDueAt.Valid && sum.NextDueAt.Int64 <= nowUnix
	return sum, nil
}

// MaintenanceSummaryBatch answers the same question for many access points in
// one pass, for the listing endpoint.
//
// Written as a batch because the alternative is two queries per access point in
// a list render — the shape that turns a 20-gate site into 40 round trips
// against a SQLite file on an SD card.
func (s *Store) MaintenanceSummaryBatch(ctx context.Context, accessPointIDs []string, nowUnix int64) (map[string]MaintenanceSummary, error) {
	out := make(map[string]MaintenanceSummary, len(accessPointIDs))
	if len(accessPointIDs) == 0 {
		return out, nil
	}
	// Scoped by an IN list rather than read whole and filtered in Go. The
	// difference matters on the box this runs on: an operator with many sites
	// asking for one site's listing should not make SQLite walk every event
	// ever logged on an SD card. A SQL window function would fold this into
	// the query too, but SQLite's availability depends on the host build, and
	// one indexed pass folded in Go needs no version check.
	ph := make([]string, len(accessPointIDs))
	args := make([]any, len(accessPointIDs))
	for i, id := range accessPointIDs {
		ph[i] = "?"
		args[i] = id
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT access_point_id, kind, performed_at, next_due_at
		   FROM maintenance_events
		  WHERE access_point_id IN (`+strings.Join(ph, ",")+`)
		  ORDER BY performed_at DESC, created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var apID, kind string
		var performedAt int64
		var nextDue sql.NullInt64
		if err := rows.Scan(&apID, &kind, &performedAt, &nextDue); err != nil {
			return nil, err
		}
		sum := out[apID]
		if kind != "inspection" && (!sum.LastServicedAt.Valid || performedAt > sum.LastServicedAt.Int64) {
			sum.LastServicedAt = sql.NullInt64{Int64: performedAt, Valid: true}
		}
		// Rows arrive newest-first, so the first due date seen for an access
		// point is the one from its most recent scheduling event.
		if nextDue.Valid && !sum.NextDueAt.Valid {
			sum.NextDueAt = nextDue
		}
		out[apID] = sum
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for id, sum := range out {
		sum.DueNow = sum.NextDueAt.Valid && sum.NextDueAt.Int64 <= nowUnix
		out[id] = sum
	}
	return out, nil
}

// nullIfBlank keeps empty strings out of the database, so "" and NULL do not
// both end up meaning "not set" in the same column.
func nullIfBlank(s string) any {
	if s == "" {
		return nil
	}
	return s
}
