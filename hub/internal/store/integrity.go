package store

import (
	"context"
	"fmt"
)

// IntegrityCheck asks SQLite whether the database file is structurally sound,
// returning one string per fault and nil when there are none.
//
// # Why this is not covered by simply opening the database
//
// Opening a torn copy usually works. `aql-hub verify-restore` reads a handful
// of rows — is anything paired, is a rotation in flight — and a page that those
// queries never touch can be entirely zeroed without any of them noticing. That
// was measured, not assumed: a database with 4KiB of zeros written over an
// interior page opened cleanly, answered every question verify-restore asks,
// and was reported as a directory in good order. Truncating the tail instead
// fails at open, so the difference between "caught" and "silently fine" was
// which part of the file the damage happened to land on.
//
// That is the exact failure verify-restore exists to prevent: a data directory
// whose problem is discovered when a hub is pointed at it rather than before.
// Corruption from a `cp` of a live database, a partial write or a bad sector is
// at least as likely as a missing key file, and is harder to reason about
// afterwards because the hub may start and only fail later, on the page that
// was damaged.
//
// # integrity_check rather than quick_check
//
// quick_check skips the index-versus-table cross-checks, which is most of the
// value here — an index disagreeing with its table is precisely the shape of
// damage that lets a hub start and then answer a query wrongly. This runs once,
// by hand, on a copy, before a restore that someone is already waiting on; the
// slower answer is the one worth having. A hub's database is small (clips are
// files on disk, not blobs in here), so "slower" is seconds.
//
// SQLite reports success as a single row containing "ok", which is why the
// no-fault case is an empty slice rather than that string.
func (s *Store) IntegrityCheck(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `PRAGMA integrity_check`)
	if err != nil {
		return nil, fmt.Errorf("integrity_check: %w", err)
	}
	defer rows.Close()

	var faults []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return nil, fmt.Errorf("integrity_check: %w", err)
		}
		if line == "ok" {
			continue
		}
		faults = append(faults, line)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("integrity_check: %w", err)
	}
	return faults, nil
}
