package store

import (
	"io/fs"
	"regexp"
	"strings"
	"testing"
)

// New state gets a new TABLE, never a column bolted onto a shipped one.
//
// # Why this is a rule and not a preference
//
// A column added to a table that already has rows is a change every existing
// row silently participates in, and the migration has to invent a value for
// all of them. That invented value is a claim about the past: 0028 makes the
// argument at length for a consent flag, where a backfilled 1 would assert
// that locations had agreed to something nobody asked them, and 0032 makes it
// again for a revocation sequence, where a backfilled 0 would claim every
// controller holds a revocation none of them may have.
//
// A new table starts empty. There is no default to get wrong, because there is
// nothing to default.
//
// # Why it was worth mechanising
//
// The rule was written down four times — in the comments of 0028, 0029, 0031
// and 0032 — which is four places nobody reads BEFORE writing a migration. A
// house rule that lives only in the thing it produced is one the next
// contributor discovers by breaking it in review, or not at all.
//
// # What stays allowed, and why
//
// `ALTER TABLE … RENAME TO`, as the last step of a table REBUILD. SQLite cannot
// widen a CHECK constraint in place, so 0029 creates a replacement, copies row
// by row, drops the original and renames — the rename is the swap, not a way to
// smuggle a column in. Nothing is added and every column is 0010's.
func TestNoMigrationAltersAShippedTable(t *testing.T) {
	// Anything that changes a table's SHAPE in place. RENAME TO is absent on
	// purpose; see the header.
	banned := regexp.MustCompile(`(?i)ALTER\s+TABLE\s+\S+\s+(ADD|DROP|ALTER|MODIFY|CHANGE|RENAME\s+COLUMN)\b`)

	names, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	// A glob that matched nothing would pass forever.
	if len(names) < 20 {
		t.Fatalf("only %d migrations found — the embed moved", len(names))
	}

	var offenders []string
	for _, name := range names {
		body, err := migrationsFS.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		// Comments discuss the rule by name — this file's own subject matter is
		// the phrase it searches for — so a raw scan would report every
		// migration that EXPLAINS the rule as breaking it.
		for i, line := range strings.Split(string(body), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "--") {
				continue
			}
			if banned.MatchString(line) {
				offenders = append(offenders,
					name+":"+itoa(i+1)+"  "+strings.TrimSpace(line))
			}
		}
	}

	if len(offenders) > 0 {
		t.Errorf("these change a shipped table's shape in place:\n  %s\n\n"+
			"New state gets a new table. A column added to a table that already has rows "+
			"forces a value for every one of them, and that value is a claim about the past "+
			"— see 0028 and 0032 for what a wrong one asserts. A table rebuild "+
			"(create, copy, drop, RENAME TO) is the supported way to change a constraint.",
			strings.Join(offenders, "\n  "))
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
