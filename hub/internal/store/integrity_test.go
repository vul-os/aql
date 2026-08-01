package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A clean database reports nothing, and SQLite's "ok" row is not a fault.
func TestIntegrityCheckIsQuietOnACleanDatabase(t *testing.T) {
	s := openTest(t)
	faults, err := s.IntegrityCheck(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(faults) != 0 {
		t.Fatalf("a freshly created database reports %d fault(s): %v", len(faults), faults)
	}
}

// Damage that SQLite reports as ROWS rather than as a failed query.
//
// This is the branch verify-restore's own tests could not reach: both damage
// shapes they use — a zeroed interior page and a truncated tail — make SQLite
// abandon the pragma and return an error, so the row-collecting path here was
// never executed by anything. A tamper that dropped every collected fault on
// the floor was NOT CAUGHT until this existed.
//
// The fixture writes a table with an index and enough rows to fill pages, then
// flips bytes at the START of successive pages — the b-tree page header, which
// SQLite reports as "Tree N page N: btreeInitPage() returns error code 11"
// rather than refusing the whole file. Damage to a page's cell content at the
// far end tends to be fatal at open instead, which is how the first version of
// this fixture found nothing at all.
//
// Which page yields rows depends on layout, so it searches rather than
// hard-coding an offset — but it insists on finding one, because a search that
// quietly found nothing would leave this asserting only that corruption is
// possible.
func TestIntegrityCheckCollectsRowShapedFaults(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE probe(k TEXT, v TEXT);
		CREATE INDEX probe_k ON probe(k)`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 800; i++ {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO probe(k,v) VALUES(?,?)`,
			fmt.Sprintf("key-%05d", i), fmt.Sprintf("value-%05d-padding-padding", i)); err != nil {
			t.Fatal(err)
		}
	}
	s.Close()

	path := DatabaseFile(dir)
	orig, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const pageSize = 4096
	pages := int64(len(orig)) / pageSize

	var got []string
	for page := pages / 4; page < pages && got == nil; page++ {
		if err := os.WriteFile(path, orig, 0o600); err != nil {
			t.Fatal(err)
		}
		off := page * pageSize // the page header; page 1 is the file header and is skipped by the start index
		f, err := os.OpenFile(path, os.O_RDWR, 0)
		if err != nil {
			t.Fatal(err)
		}
		buf := make([]byte, 32)
		if _, err := f.ReadAt(buf, off); err != nil {
			f.Close()
			continue
		}
		for i := range buf {
			buf[i] ^= 0x5a
		}
		if _, err := f.WriteAt(buf, off); err != nil {
			t.Fatal(err)
		}
		f.Close()

		ro, err := OpenReadOnly(dir)
		if err != nil {
			continue // this page's damage is fatal at open; keep looking
		}
		faults, err := ro.IntegrityCheck(ctx)
		ro.Close()
		if err == nil && len(faults) > 0 {
			got = faults
		}
	}

	if got == nil {
		t.Fatal("no page produced row-shaped faults, so the branch that collects them " +
			"is still untested — the fixture needs fixing, not deleting")
	}
	// The point of collecting them is that they say WHERE. A fault list that
	// came back empty of detail would be no better than a boolean.
	joined := strings.Join(got, "\n")
	if !strings.Contains(joined, "page") && !strings.Contains(joined, "index") &&
		!strings.Contains(joined, "database") {
		t.Errorf("faults carry no locating detail: %q", joined)
	}
	for _, f := range got {
		if f == "ok" {
			t.Error(`"ok" was collected as a fault`)
		}
	}
}

// Where a running hub's data actually is, and what a db-only copy loses.
//
// The hub opens SQLite with journal_mode(WAL), so writes land in lintel.db-wal
// until a checkpoint moves them. Minutes into a hub's life that file can hold
// essentially everything: this fixture writes 50 rows and finds a 4 KiB
// lintel.db beside a WAL measured in megabytes.
//
// That makes "back up the database" a data-loss instruction, and it fails
// silently in the worst way — the resulting file opens and passes
// integrity_check with no faults, because an empty database is a perfectly
// valid one. hub/README therefore tells operators to copy the directory rather
// than the file, and verify-restore reports the WAL's size when it is there;
// this is the measurement both of those rest on.
func TestTheWriteAheadLogHoldsDataADatabaseCopyWouldLose(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE probe(k TEXT)`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO probe(k) VALUES(?)`,
			fmt.Sprintf("row-%d", i)); err != nil {
			t.Fatal(err)
		}
	}

	walPath := DatabaseFile(dir) + "-wal"
	wal, err := os.Stat(walPath)
	if err != nil {
		t.Fatalf("no write-ahead log beside a live database — has journal_mode changed? %v", err)
	}
	if wal.Size() == 0 {
		t.Fatal("the write-ahead log is empty while 50 uncheckpointed rows exist")
	}

	// Copy both ways, from the LIVE directory, which is what an operator does.
	dbOnly, whole := t.TempDir(), t.TempDir()
	for _, name := range []string{"lintel.db", "lintel.db-wal", "lintel.db-shm"} {
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		if name == "lintel.db" {
			if err := os.WriteFile(filepath.Join(dbOnly, name), body, 0o600); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(whole, name), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	s.Close()

	// The whole directory carries the data.
	full, err := OpenReadOnly(whole)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := full.db.QueryRowContext(ctx, `SELECT count(*) FROM probe`).Scan(&n); err != nil {
		t.Fatalf("a complete copy cannot be read: %v", err)
	}
	if n != 50 {
		t.Errorf("complete copy has %d rows, want 50", n)
	}
	if faults, err := full.IntegrityCheck(ctx); err != nil || len(faults) != 0 {
		t.Errorf("complete copy: faults=%v err=%v", faults, err)
	}
	full.Close()

	// The database alone does not — and nothing about it looks wrong.
	partial, err := OpenReadOnly(dbOnly)
	if err != nil {
		t.Fatalf("db-only copy will not open, which would at least be loud: %v", err)
	}
	defer partial.Close()
	faults, ferr := partial.IntegrityCheck(ctx)
	if ferr != nil || len(faults) != 0 {
		t.Fatalf("db-only copy reports damage; the point is that it does NOT: %v %v", faults, ferr)
	}
	var lost int
	err = partial.db.QueryRowContext(ctx, `SELECT count(*) FROM probe`).Scan(&lost)
	if err == nil && lost == 50 {
		t.Fatal("the db-only copy has every row, so this hub is not using a " +
			"write-ahead log and hub/README's backup instructions can be simplified")
	}
	t.Logf("db-only copy: rows=%d err=%v, integrity clean — %d bytes of db beside %s of WAL",
		lost, err, fileSize(t, filepath.Join(dbOnly, "lintel.db")), humanish(wal.Size()))
}

func fileSize(t *testing.T, p string) int64 {
	t.Helper()
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	return fi.Size()
}

func humanish(n int64) string { return fmt.Sprintf("%.1f MiB", float64(n)/(1<<20)) }
