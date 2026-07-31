package store

import (
	"context"
	"database/sql"
)

// Per-location occupancy-disclosure consent — docs/CHAT-COMMANDS.md §4.4 rule
// 6, migration 0028.

// OccupancyDisclosureAllowed reports whether a location has opted in to having
// occupancy proxies disclosed over a chat rail.
//
// A missing row is FALSE, and an error is FALSE. Both collapse deliberately:
// this gates whether the product will say something about the people in a
// building, and the only safe answer to "I could not determine consent" is the
// one that discloses nothing. Every other limit in this codebase that fails
// open does so with a stated reason about availability at a gate; there is no
// availability argument for answering a question about who is home.
func (s *Store) OccupancyDisclosureAllowed(ctx context.Context, locationID string) bool {
	if locationID == "" {
		return false
	}
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM location_disclosure WHERE location_id = ?`, locationID).Scan(&one)
	return err == nil && one == 1
}

// OccupancyDisclosureLocations returns the subset of the given locations that
// have opted in, preserving order.
//
// Takes the caller's list rather than querying by account, so the answer cannot
// be wider than what the caller was already entitled to see — the same shape
// GateReadSummary uses, and for the same reason.
func (s *Store) OccupancyDisclosureLocations(ctx context.Context, locationIDs []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(locationIDs) == 0 {
		return out, nil
	}
	args := make([]any, 0, len(locationIDs))
	for _, id := range locationIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT location_id FROM location_disclosure WHERE location_id IN (`+placeholders(len(args))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// SetOccupancyDisclosure records or withdraws consent for one location.
//
// Withdrawing DELETES the row rather than writing a false: the table means
// "these locations have consented", and the absence of a row is the same answer
// a location that never opted in gives. Keeping a "no" row would create two
// representations of off, which is two chances to read one of them wrong.
func (s *Store) SetOccupancyDisclosure(ctx context.Context, locationID, byUserID string, enabled bool) error {
	if !enabled {
		_, err := s.db.ExecContext(ctx,
			`DELETE FROM location_disclosure WHERE location_id = ?`, locationID)
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO location_disclosure (location_id, enabled_by, enabled_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT (location_id) DO UPDATE SET
		     enabled_by = excluded.enabled_by, enabled_at = excluded.enabled_at`,
		locationID, nullable(byUserID), now())
	return err
}

// OccupancyDisclosure is one location's consent record, for the console.
type OccupancyDisclosure struct {
	Enabled   bool
	EnabledBy sql.NullString
	EnabledAt sql.NullInt64
}

// OccupancyDisclosureFor reads one location's consent, including who set it —
// so the console can show "enabled by X on Y" rather than a bare switch. A
// privacy control that does not say who turned it on is a control nobody can
// audit.
func (s *Store) OccupancyDisclosureFor(ctx context.Context, locationID string) (OccupancyDisclosure, error) {
	var d OccupancyDisclosure
	err := s.db.QueryRowContext(ctx,
		`SELECT enabled_by, enabled_at FROM location_disclosure WHERE location_id = ?`, locationID).
		Scan(&d.EnabledBy, &d.EnabledAt)
	if err == sql.ErrNoRows {
		return OccupancyDisclosure{}, nil
	}
	if err != nil {
		return OccupancyDisclosure{}, err
	}
	d.Enabled = true
	return d, nil
}
