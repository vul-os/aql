package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// pairedHubDir builds a data directory that looks like a hub which has paired
// a controller: a real database, a real key, and a redeemed claim.
func pairedHubDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "owner@example.test", "x", "Owner", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, "Estate", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, "Gate", "hash", 1<<40); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RedeemClaim(ctx, "hash", "cGFpcmVkLXB1YmtleS0zMi1ieXRlcy1sb25nISE"); err != nil {
		t.Fatal(err)
	}
	st.Close()
	if _, err := keys.Load(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestVerifyRestoreAcceptsACompleteDirectory(t *testing.T) {
	dir := pairedHubDir(t)
	problems, checked, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 0 {
		t.Fatalf("a complete directory reported problems: %v", problems)
	}
	if len(checked) < 3 {
		t.Errorf("only %d things examined: %v — an operator cannot tell a thorough pass "+
			"from a check that did nothing", len(checked), checked)
	}
}

// The failure this exists for. It must be found from the COPY, not at a gate.
func TestVerifyRestoreCatchesAMissingSigningKey(t *testing.T) {
	dir := pairedHubDir(t)
	if err := os.Remove(filepath.Join(dir, "gateway_ed25519.seed")); err != nil {
		t.Fatal(err)
	}
	problems, _, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 1 {
		t.Fatalf("problems = %v, want exactly one about the signing key", problems)
	}
	// The text has to say what it costs. "Missing file" would read as something
	// to regenerate, which is the belief that causes the outage.
	if !strings.Contains(problems[0], "re-pair") {
		t.Errorf("the problem does not say what it costs: %q", problems[0])
	}
}

// A hub that has never paired may legitimately have no key: it will mint one on
// first boot. Reporting that as a problem would send an operator hunting for a
// backup of something that does not exist yet.
func TestVerifyRestoreAllowsAMissingKeyOnAHubThatNeverPaired(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()

	problems, checked, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 0 {
		t.Fatalf("a never-paired hub with no key reported: %v", problems)
	}
	if !strings.Contains(strings.Join(checked, "\n"), "nothing has paired") {
		t.Errorf("the pass does not say WHY the missing key is fine: %v", checked)
	}
}

func TestVerifyRestoreCatchesAMissingRetainedKeyDuringARotation(t *testing.T) {
	dir := pairedHubDir(t)
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	previous := ks.PublicKeyB64()
	newPub, err := ks.Rotate()
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.BeginKeyRotation(context.Background(), "rot-1", previous, newPub, "test"); err != nil {
		t.Fatal(err)
	}
	st.Close()

	// A backup taken before the rotation, restored over one taken after — or
	// simply a partial copy.
	if err := os.Remove(filepath.Join(dir, "gateway_ed25519.previous.seed")); err != nil {
		t.Fatal(err)
	}

	problems, _, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 1 || !strings.Contains(problems[0], "unrepairable") {
		t.Fatalf("problems = %v, want one naming the unrepairable controllers", problems)
	}
}

// Pointing it at something that is not a hub must say so rather than inventing
// a database and reporting on it — the same refusal openExistingStore makes.
func TestVerifyRestoreRefusesADirectoryWithNoHubInIt(t *testing.T) {
	_, _, err := verifyRestore(t.TempDir())
	if err == nil {
		t.Fatal("an empty directory passed — it would have created a database to check")
	}
	if !strings.Contains(err.Error(), "not a hub data directory") {
		t.Errorf("err = %q, want it to say this is not a hub directory", err)
	}
}

// And the property the read-only opener exists for: checking must not change
// the database or any key.
//
// SQLite's -wal and -shm sidecars are excluded deliberately, not to make this
// pass: opening a WAL database creates them, and the alternative (immutable=1)
// would give wrong answers against a live directory, which an operator will
// certainly point this at. The claim is "does not modify the database or a
// key", and that is what is asserted.
//
// WHAT THIS CANNOT PROVE, and it is worth knowing before trusting it: swapping
// store.OpenReadOnly for store.Open passes. The fixture's database is already
// fully migrated, so Open has nothing to apply and changes no file. Catching
// that behaviourally would need a database at an OLDER schema, which cannot be
// built without an older binary. The structural test below is the backstop —
// weaker than behaviour, and better than believing this covers it.
func TestVerifyRestoreDoesNotModifyTheDirectory(t *testing.T) {
	dir := pairedHubDir(t)
	before := snapshotDir(t, dir)
	if _, _, err := verifyRestore(dir); err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	after := snapshotDir(t, dir)
	for name, sz := range before {
		if after[name] != sz {
			t.Errorf("%s changed size %d → %d — the directory being checked may be the only "+
				"copy an operator has", name, sz, after[name])
		}
	}
	for name := range after {
		if strings.HasSuffix(name, "-wal") || strings.HasSuffix(name, "-shm") {
			continue // SQLite's own sidecars; see the comment above
		}
		if _, existed := before[name]; !existed {
			t.Errorf("checking created %s", name)
		}
	}
}

func snapshotDir(t *testing.T, dir string) map[string]int64 {
	t.Helper()
	out := map[string]int64{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			t.Fatal(err)
		}
		out[e.Name()] = info.Size()
	}
	return out
}

// verifyRestore must use the READ-ONLY opener.
//
// A structural assertion, which this file otherwise avoids. The behavioural
// test above cannot separate the two openers against a current-schema fixture,
// and the property matters most in the case it cannot build: a backup from an
// older version, where store.Open would migrate the operator's only copy while
// answering a question about it.
func TestVerifyRestoreUsesTheReadOnlyOpener(t *testing.T) {
	src, err := os.ReadFile("verifyrestore.go")
	if err != nil {
		t.Fatal(err)
	}
	code := string(src)
	if !strings.Contains(code, "store.OpenReadOnly(dataDir)") {
		t.Error("verifyRestore does not use store.OpenReadOnly")
	}
	if strings.Contains(code, "store.Open(dataDir)") {
		t.Error("verifyRestore uses store.Open, which APPLIES MIGRATIONS to the directory " +
			"it was asked to inspect — for a backup from an older version that rewrites the " +
			"only copy the operator has")
	}
}
