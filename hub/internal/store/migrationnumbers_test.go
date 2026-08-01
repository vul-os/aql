package store

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"testing"
)

// Migration numbering, and the embed that decides which migrations exist.
//
// # Why numbering is worth a test
//
// Migrations are claimed by number before they are written, so that two people
// working at once do not both write `0035_`. Nothing enforced that. Two files
// sharing a number both apply — the runner keys `schema_migrations` on the
// FILENAME, not the number — in whatever order `sort.Strings` puts them, which
// is alphabetical by the part after the number. Neither author would see a
// failure, and the ordering they each assumed would be decided by their choice
// of noun.
//
// # Why a GAP is worth failing on
//
// A missing number means one of two things. Either a number was reserved and
// never used, which is harmless and needs recording, or a migration file was
// DELETED after shipping — and that one is serious: every hub that already
// applied it carries state nothing in the tree describes, and a fresh install
// gets a different schema from an upgraded one. Those two are indistinguishable
// from the filenames alone, so the rule is that a gap must be written down.

var migrationNameRe = regexp.MustCompile(`^([0-9]{4})_[a-z0-9_]+\.sql$`)

// knownGaps are numbers that were never used, with the evidence that they were
// never used.
//
// Not a list of migrations that may be missing — a list of numbers that never
// named a file. The distinction is the whole point: if a number here ever turns
// out to have shipped, the entry is wrong and hubs are carrying orphan state.
var knownGaps = map[int]string{
	8: "reserved but never written. docs/CHAT-COMMANDS.md §1248 told an implementer to " +
		"claim `0008_*.sql` as the next number; that work landed later under its own " +
		"number and 0008 was never taken. Verified 2026-08-01: `git log --all` shows no " +
		"file matching migrations/0008* has ever existed, so no hub can have applied one.",
}

func migrationFilenames(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join("migrations"))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func TestEveryMigrationIsNumberedAndNamedTheSameWay(t *testing.T) {
	names := migrationFilenames(t)
	if len(names) < 20 {
		t.Fatalf("found %d migration files — the directory read is not seeing them", len(names))
	}
	for _, name := range names {
		if !migrationNameRe.MatchString(name) {
			t.Errorf("%q does not match NNNN_lower_snake.sql — the runner sorts by filename, "+
				"so a name outside the convention applies in an order nobody chose", name)
		}
	}
}

// The collision this repository's working agreement exists to prevent.
func TestNoTwoMigrationsShareANumber(t *testing.T) {
	seen := map[int]string{}
	checked := 0
	for _, name := range migrationFilenames(t) {
		m := migrationNameRe.FindStringSubmatch(name)
		if m == nil {
			continue // reported by the name test
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			t.Fatalf("%q: %v", name, err)
		}
		checked++
		if prev, dup := seen[n]; dup {
			t.Errorf("migrations %q and %q both claim number %04d — both will apply, in "+
				"alphabetical order of the name after the number, which is an ordering "+
				"neither author chose", prev, name, n)
		}
		seen[n] = name
	}
	if checked < 20 {
		t.Fatalf("parsed %d numbered migrations; the pattern has drifted", checked)
	}
}

// A gap is either a reserved-and-unused number or a deleted migration, and only
// one of those is safe.
func TestMigrationNumbersAreContiguousOrTheGapIsRecorded(t *testing.T) {
	var nums []int
	for _, name := range migrationFilenames(t) {
		if m := migrationNameRe.FindStringSubmatch(name); m != nil {
			n, _ := strconv.Atoi(m[1])
			nums = append(nums, n)
		}
	}
	sort.Ints(nums)
	if len(nums) == 0 {
		t.Fatal("no numbered migrations parsed")
	}
	have := map[int]bool{}
	for _, n := range nums {
		have[n] = true
	}
	for n := 1; n <= nums[len(nums)-1]; n++ {
		if have[n] {
			continue
		}
		if _, ok := knownGaps[n]; !ok {
			t.Errorf("no migration numbered %04d. If it was reserved and never written, add it "+
				"to knownGaps with the evidence. If a file was DELETED, put it back: every hub "+
				"that applied it carries state nothing here describes, and a fresh install "+
				"would get a different schema from an upgraded one", n)
		}
	}
	// An entry that stops being a gap is a stale exemption, and a silent one:
	// it would sit there claiming a number was never used while a file uses it.
	for n := range knownGaps {
		if have[n] {
			t.Errorf("knownGaps records %04d as never written, but a migration now claims it — "+
				"remove the entry", n)
		}
	}
}

// The embedded set must be exactly the directory.
//
// `//go:embed migrations/*.sql` is what decides which migrations a BINARY has,
// and the directory is what a person reads. Narrow the pattern — or add a file
// the pattern misses — and those two diverge with nothing to say so: tests pass
// because they run the same embed, and the missing table only appears on a real
// hub.
func TestTheEmbeddedMigrationsAreExactlyTheDirectory(t *testing.T) {
	embedded, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	inEmbed := map[string]bool{}
	for _, e := range embedded {
		inEmbed[filepath.Base(e)] = true
	}

	onDisk := migrationFilenames(t)
	if len(embedded) != len(onDisk) {
		t.Errorf("%d migrations are embedded but %d are on disk", len(embedded), len(onDisk))
	}
	for _, name := range onDisk {
		if !inEmbed[name] {
			t.Errorf("%q is in migrations/ and NOT embedded — it will never run on a real hub, "+
				"while every test here passes", name)
		}
	}
	if len(embedded) < 20 {
		t.Fatalf("only %d migrations embedded; the glob is not seeing the directory", len(embedded))
	}
}
