package store

import (
	"context"
	"database/sql"
)

// What deny-list each controller says it is enforcing — migration 0031,
// docs/GRANT-REVOCATION.md §5.

// RevocationReport is one controller's reported deny-list state.
type RevocationReport struct {
	Seq        int64
	Entries    int
	ReportedAt int64
	ReceivedAt int64
}

// SaveRevocationReport records what a controller reported.
//
// Older reports are IGNORED rather than stored. A controller reconnecting on a
// flaky link can deliver two reports out of order, and letting the older one
// win would show an operator a gate falling behind a revocation it had already
// applied — which is the one thing this table exists to get right.
func (s *Store) SaveRevocationReport(ctx context.Context, deviceID string, seq int64, entries int, reportedAt int64) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO controller_revocation_reports
		   (device_id, seq, entries, reported_at, received_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (device_id) DO UPDATE SET
		     seq         = excluded.seq,
		     entries     = excluded.entries,
		     reported_at = excluded.reported_at,
		     received_at = excluded.received_at
		 WHERE excluded.seq >= controller_revocation_reports.seq`,
		deviceID, seq, entries, reportedAt, now())
	return err
}

// RevocationReportFor returns what a controller last reported, or false when it
// has reported nothing.
//
// The bool is load-bearing and is not the same as seq 0. Seq 0 means the
// controller told us it holds no list; no row means it has told us nothing —
// firmware predating the field, or a gate that has not connected since. Only
// the second leaves an operator unable to confirm anything.
func (s *Store) RevocationReportFor(ctx context.Context, deviceID string) (RevocationReport, bool, error) {
	var r RevocationReport
	err := s.db.QueryRowContext(ctx,
		`SELECT seq, entries, reported_at, received_at
		   FROM controller_revocation_reports WHERE device_id = ?`, deviceID).
		Scan(&r.Seq, &r.Entries, &r.ReportedAt, &r.ReceivedAt)
	if err == sql.ErrNoRows {
		return RevocationReport{}, false, nil
	}
	if err != nil {
		return RevocationReport{}, false, err
	}
	return r, true, nil
}
