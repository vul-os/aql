package main

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/sealed"
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

// A sealed key with no data key in the environment is the loss encryption adds,
// and verify-restore has to name it — the file is present, so "missing" would
// be the wrong word and would send an operator looking for a backup they
// already have.
func TestVerifyRestoreReportsASealedKeyWithNoDataKey(t *testing.T) {
	dir := pairedHubDir(t)
	key, err := sealed.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := sealed.ParseKey(key)
	if err != nil {
		t.Fatal(err)
	}
	// Seal it the way the hub would.
	if _, err := keys.Load(dir, keys.WithDataKey(parsed)); err != nil {
		t.Fatal(err)
	}

	t.Setenv("AQL_DATA_KEY", "")
	problems, _, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 1 || !strings.Contains(problems[0], "ENCRYPTED") {
		t.Fatalf("problems = %v, want one naming the encrypted key", problems)
	}

	// With the key to hand it is not a problem, and the pass says so rather
	// than staying silent about a file it did examine.
	t.Setenv("AQL_DATA_KEY", key)
	problems, checked, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 0 {
		t.Fatalf("problems with the data key set: %v", problems)
	}
	if !strings.Contains(strings.Join(checked, "\n"), "encrypted") {
		t.Errorf("the pass does not mention the encrypted key: %v", checked)
	}
}

// Every way AQL_DATA_KEY can be set and still not work.
//
// The first version of this check asked only whether the variable was SET,
// which is the shape of check verify-restore exists to replace: all three of
// these would have read as fine, and the hub would have refused to start
// minutes later for a reason the check had every chance to find.
func TestVerifyRestoreChecksTheDataKeyOpensTheSeed(t *testing.T) {
	dir := pairedHubDir(t)
	keyStr, err := sealed.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	key, err := sealed.ParseKey(keyStr)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := keys.Load(dir, keys.WithDataKey(key)); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		value string
		want  string
	}{
		{"unresolvable file reference", "${file:/nonexistent/aql-data-key}", "cannot be read"},
		{"truncated paste", "c2hvcnQ", "not a usable data key"},
		{"the wrong key", mustNewKey(t), "does NOT open this seed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("AQL_DATA_KEY", c.value)
			problems, _, err := verifyRestore(dir)
			if err != nil {
				t.Fatalf("verifyRestore: %v", err)
			}
			if len(problems) != 1 {
				t.Fatalf("problems = %v, want exactly one", problems)
			}
			if !strings.Contains(problems[0], c.want) {
				t.Errorf("problem = %q, want it to mention %q — the three failures need "+
					"different actions: find the file, fix the paste, find the right key",
					problems[0], c.want)
			}
		})
	}

	// And the key that actually works passes, with the pass saying it OPENED
	// the seed rather than that a variable was set.
	t.Setenv("AQL_DATA_KEY", keyStr)
	problems, checked, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 0 {
		t.Fatalf("the correct key reported problems: %v", problems)
	}
	if !strings.Contains(strings.Join(checked, "\n"), "opens it") {
		t.Errorf("the pass does not say the key OPENS the seed: %v", checked)
	}
}

// A file reference that resolves is accepted, which is the shape an operator
// actually uses in a container.
func TestVerifyRestoreAcceptsAFileReferenceForTheDataKey(t *testing.T) {
	dir := pairedHubDir(t)
	keyStr, err := sealed.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	key, err := sealed.ParseKey(keyStr)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := keys.Load(dir, keys.WithDataKey(key)); err != nil {
		t.Fatal(err)
	}
	keyFile := filepath.Join(t.TempDir(), "aql-data-key")
	if err := os.WriteFile(keyFile, []byte(keyStr+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("AQL_DATA_KEY", "${file:"+keyFile+"}")
	problems, _, err := verifyRestore(dir)
	if err != nil {
		t.Fatalf("verifyRestore: %v", err)
	}
	if len(problems) != 0 {
		t.Fatalf("a working ${file:} reference reported: %v", problems)
	}
}

func mustNewKey(t *testing.T) string {
	t.Helper()
	k, err := sealed.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// A damaged database must not be reported as restorable.
//
// verify-restore checked for missing key files and read a few rows, and a
// database can be corrupt in a way that answers those rows perfectly. Measured
// before this check existed: 4KiB of zeros written over an interior page opened
// cleanly, satisfied every question the command asks, and produced "this
// directory can start a hub without losing anything". Damage to the TAIL failed
// at open, so whether corruption was caught came down to which part of the file
// it landed on.
//
// Both shapes are asserted because they surface differently — SQLite abandons
// the pragma on a malformed image and reports faults as rows otherwise — and
// both must end in a refusal.
func TestVerifyRestoreRefusesADamagedDatabase(t *testing.T) {
	for _, tc := range []struct {
		name string
		bust func(t *testing.T, path string)
	}{
		{"zeroed interior page", func(t *testing.T, p string) {
			f, err := os.OpenFile(p, os.O_RDWR, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			if _, err := f.WriteAt(make([]byte, 4096), 8192); err != nil {
				t.Fatal(err)
			}
		}},
		{"truncated tail", func(t *testing.T, p string) {
			fi, err := os.Stat(p)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Truncate(p, fi.Size()-4096); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			st, err := store.Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			st.Close()

			// The control: intact, this directory verifies, and the integrity
			// line is among what it reports examining. Without it a check that
			// refused everything would pass this test.
			problems, checked, err := verifyRestore(dir)
			if err != nil || len(problems) != 0 {
				t.Fatalf("intact directory: err=%v problems=%v", err, problems)
			}
			if !slices.ContainsFunc(checked, func(s string) bool {
				return strings.Contains(s, "integrity_check clean")
			}) {
				t.Fatalf("intact directory does not report an integrity check:\n%s",
					strings.Join(checked, "\n"))
			}

			tc.bust(t, store.DatabaseFile(dir))

			problems, _, err = verifyRestore(dir)
			if err == nil && len(problems) == 0 {
				t.Fatal("a damaged database was reported as restorable")
			}
			// Whichever path it took, the operator must be told it is the
			// DATABASE that is wrong — not left with a bare SQLite code.
			msg := strings.Join(problems, "\n")
			if err != nil {
				msg = err.Error()
			}
			if !strings.Contains(msg, "integrity") && !strings.Contains(msg, "database") {
				t.Errorf("refusal does not name the database as the problem: %s", msg)
			}
		})
	}
}
