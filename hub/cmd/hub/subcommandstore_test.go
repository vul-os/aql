package main

// Subcommands must not create the hub they were asked to inspect.
//
// store.Open creates the database when it is absent — right for a hub starting
// up, wrong for every subcommand, each of which was handed a directory that is
// supposed to already contain one. All three had this, and each rendered it as a
// different wrong answer:
//
//   - verify-audit printed "access_logs OK (0 rows)": a green audit-chain result
//     for a backup that was not there.
//   - 2fa disable printed "no such user: alice": an admin unlocking somebody in
//     a hurry is told the ACCOUNT is gone when the path is wrong.
//   - energy rebucket printed "no account … on this hub": the same shape.
//
// And all three wrote a database into whatever directory they were pointed at,
// including the cold backup hub/README says these are safe to run against.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every subcommand entry point, invoked the way main invokes it.
var subcommandRuns = []struct {
	name string
	run  func(dataDir string) int
}{
	{"verify-audit", func(d string) int { return runVerifyAudit([]string{"-data", d}) }},
	{"2fa disable", func(d string) int {
		return runTwoFactorDisable([]string{"-user", "alice", "-reason", "lost device", "-data", d})
	}},
	{"energy rebucket", func(d string) int {
		return runEnergyRebucket([]string{"-account", "acct-1", "-data", d})
	}},
}

func TestNoSubcommandCreatesTheHubItWasAskedToInspect(t *testing.T) {
	for _, sc := range subcommandRuns {
		t.Run(sc.name, func(t *testing.T) {
			dir := t.TempDir()
			if code := sc.run(dir); code == 0 {
				t.Errorf("%s reported success against a directory with no hub in it", sc.name)
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				var names []string
				for _, e := range entries {
					names = append(names, e.Name())
				}
				t.Errorf(`%s created %v in a directory it was asked to READ.

hub/README documents these as safe to run against a cold backup. Writing a
database into one is exactly what a person running a recovery command on a copy
of their data is trying not to do.`, sc.name, names)
			}
		})
	}
}

// The structural half: only the server may call store.Open directly.
//
// The three subcommands go through openExistingStore, which refuses an absent
// database. A fourth that called store.Open itself would silently get the old
// behaviour back, and nothing above would notice because this list is written by
// hand. This is what makes the door a door.
func TestOnlyTheServerOpensTheStoreDirectly(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	scanned := 0
	var offenders []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		// openexisting.go IS the door, and main.go's server boot is the one
		// caller that must create a database — a hub starting for the first
		// time has no other way to exist.
		if name == "openexisting.go" {
			continue
		}
		body, err := os.ReadFile(filepath.Join(".", name))
		if err != nil {
			t.Fatal(err)
		}
		scanned++
		src := string(body)
		for _, line := range strings.Split(src, "\n") {
			if !strings.Contains(line, "store.Open(") {
				continue
			}
			// The server's own boot, identified by the config it opens from.
			if strings.Contains(line, "cfg.dataDir") {
				continue
			}
			offenders = append(offenders, name+": "+strings.TrimSpace(line))
		}
	}
	if scanned < 3 {
		t.Fatalf("scanned only %d sources; the walk is broken, not the code", scanned)
	}
	if len(offenders) > 0 {
		t.Errorf(`these call store.Open directly instead of openExistingStore:

%s

store.Open CREATES the database when it is absent. A subcommand that uses it
answers questions about a hub it just invented — which is how verify-audit came
to print "OK (0 rows)" for a backup that did not exist.`, strings.Join(offenders, "\n"))
	}
}
