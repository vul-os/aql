package store

import (
	"context"
	"fmt"
	"os"
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
