package store

import (
	"database/sql"
	"fmt"
	"path/filepath"
)

// OpenReadOnly opens an existing database without migrating or writing to it.
//
// Open() applies pending migrations, which is right for a hub starting up and
// wrong for anything INSPECTING a file. verify-audit's own comment concedes the
// point — "a real, if small, mutation ... run this against a COPY, never the
// original evidence file" — and a restore check has the sharper version of the
// same problem: the directory it is asked about may be the only copy an
// operator has, and an answer that required writing to it is an answer that
// could destroy what it was checking.
//
// `mode=ro` rather than a promise. The driver refuses writes, so a query that
// would migrate fails loudly instead of succeeding quietly.
//
// Precisely: this does not modify the DATABASE or any key file. It can still
// create SQLite's own `-wal` and `-shm` sidecars beside a database left in WAL
// mode, because that is how SQLite opens one at all. `immutable=1` would avoid
// even that and was rejected: it tells SQLite the file cannot change, which is
// true of a quiescent backup and false of a live hub's directory — and an
// operator will point this at a live directory. A wrong answer is worse than a
// sidecar.
//
// The caller must handle a schema OLDER than this binary: a backup predating a
// table will make that table's query fail, and the right response is to say
// what could not be checked rather than to treat it as a fault in the backup.
func OpenReadOnly(dir string) (*Store, error) {
	path := filepath.Join(dir, "lintel.db")
	dsn := "file:" + path + "?mode=ro&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite read-only: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("open %s read-only: %w", path, err)
	}
	return &Store{db: db}, nil
}
