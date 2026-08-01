package main

// verify-audit must refuse a directory with no database, not create one.
//
// store.Open creates the database when it is absent — right for a hub starting
// up, wrong for a command asked to inspect an existing directory. Before this,
// `verify-audit -data /mnt/backup-typo` created an empty lintel.db, walked its
// two empty hash chains and printed:
//
//	access_logs      OK   (0 rows)
//	admin_audit_log  OK   (0 rows)
//
// A green result for a backup that was not there, and a write to a directory
// hub/README documents as safe to run this against cold.
//
// scripts/verify.sh refuses exactly this for release artifacts, in its own
// header: "a verifier that shrugs at a 404 prints a line that looks like
// verification happened while checking nothing at all, and is strictly worse
// than no verifier: it converts 'I don't know' into 'it's fine'". The audit
// chain is the one place in this product where detecting that something is
// MISSING is the entire job.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/store"
)

func TestVerifyAuditRefusesADirectoryWithNoDatabase(t *testing.T) {
	dir := t.TempDir()

	if code := runVerifyAudit([]string{"-data", dir}); code == 0 {
		t.Error(`verify-audit reported success for a directory with no database.

An operator checking a cold backup — a path that is wrong, or a copy that never
finished — is told the audit chain is intact. That is the failure this command
exists to detect, reported as a pass.`)
	}

	// And it must not have written anything. The directory was to be READ.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("verify-audit created %v in a directory it was asked to verify; running it "+
			"against a cold backup must not modify the backup", names)
	}
}

func TestVerifyAuditStillVerifiesARealDataDirectory(t *testing.T) {
	dir := t.TempDir()
	// A real store, created the way the hub creates one.
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()

	if _, err := os.Stat(filepath.Join(dir, "lintel.db")); err != nil {
		t.Fatalf("fixture: no database was created: %v", err)
	}
	if code := runVerifyAudit([]string{"-data", dir}); code != 0 {
		t.Errorf("verify-audit exited %d on a genuine data directory; a refusal that also "+
			"refuses real input is worse than the bug it fixed", code)
	}
}

// The name the refusal checks for must be the name the store actually uses.
// Two constants agreeing with each other about a third thing is how this breaks.
func TestTheDatabaseNameTheCheckUsesIsTheOneTheStoreCreates(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()
	if _, err := os.Stat(store.DatabaseFile(dir)); err != nil {
		t.Errorf("store.DatabaseFile points at %s, which Open did not create: %v",
			store.DatabaseFile(dir), err)
	}
}

// The head must appear in what the command prints.
//
// README, SECURITY.md and ARCHITECTURE.md now all tell an operator that the
// chain cannot see its own tail being deleted, and that recording the row count
// and head off the box is what makes that noticeable. That instruction is only
// true while the command actually prints the head — and nothing checked it: a
// tamper removing res.Head from the format string was NOT CAUGHT by any test in
// this package, which is how a documented operator procedure quietly becomes
// impossible to follow.
func TestVerifyAuditPrintsTheHeadOperatorsAreToldToRecord(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	code := runVerifyAudit([]string{"-data", dir})
	w.Close()
	os.Stdout = saved

	buf := make([]byte, 8192)
	n, _ := r.Read(buf)
	out := string(buf[:n])

	if code != 0 {
		t.Fatalf("exit %d: %s", code, out)
	}
	// Both chains, each with a head. An empty database still has one — the
	// genesis hash — so there is no "nothing to anchor yet" state for an
	// operator to be confused by.
	head := regexp.MustCompile(`head ([0-9a-f]{64})`)
	found := head.FindAllStringSubmatch(out, -1)
	if len(found) != 2 {
		t.Fatalf("want a 64-hex head for each of the two chains, got %d in:\n%s", len(found), out)
	}
	// The two tables' chains are seeded with distinct genesis hashes precisely
	// so they cannot be spliced; identical heads here would mean that stopped
	// being true.
	if found[0][1] == found[1][1] {
		t.Errorf("both chains report the same head %s — the per-table genesis is not "+
			"distinguishing them", found[0][1])
	}
	if !strings.Contains(out, "rows") {
		t.Errorf("the row count is the other half of the anchor and is missing:\n%s", out)
	}
}
