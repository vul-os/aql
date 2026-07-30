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
