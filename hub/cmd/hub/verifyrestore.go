package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// runVerifyRestore implements `aql-hub verify-restore`.
//
// # Why this exists
//
// Two outages in this codebase have the same shape: a data directory that is
// missing a file the hub cannot regenerate, discovered at the moment it
// matters. Losing gateway_ed25519.seed makes the hub mint a new identity that
// no paired controller trusts; losing the retained key mid-rotation strands
// every controller that has not repaired. Both are unrecoverable without a
// backup, and both used to be found at a gate.
//
// The hub now refuses the first and alarms on the second. That is late. An
// operator restoring a backup wants to know BEFORE pointing a hub at it, and
// wants to know from the copy rather than by starting a server against
// production.
//
// # What it deliberately does not do
//
// It does not open the store through store.Open. verify-audit does, and its own
// comment concedes that this applies pending migrations — "a real, if small,
// mutation" — and tells you to run it against a copy. A restore check that
// modifies the thing being checked is the wrong shape: the file may be the only
// copy someone has, and the answer must not depend on having written to it.
// So this reads the database read-only and touches nothing.
func runVerifyRestore(args []string) int {
	fs := flag.NewFlagSet("verify-restore", flag.ExitOnError)
	dataDir := fs.String("data", envOr("AQL_DATA_DIR", "./data"), "data directory to check")
	fs.Parse(args)

	problems, checked, err := verifyRestore(*dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "verify-restore: %v\n", err)
		return 1
	}
	for _, line := range checked {
		fmt.Println(line)
	}
	if len(problems) == 0 {
		fmt.Println("\nthis directory can start a hub without losing anything.")
		return 0
	}
	fmt.Fprintln(os.Stderr, "")
	for _, p := range problems {
		fmt.Fprintf(os.Stderr, "PROBLEM: %s\n", p)
	}
	return 1
}

// verifyRestore is the checking half, separated so it can be tested without a
// process.
//
// Returns the problems, the lines describing what was examined, and an error
// only for faults that prevent checking at all. A directory with problems is
// not an error: it is the answer.
func verifyRestore(dataDir string) (problems []string, checked []string, err error) {
	dbPath := filepath.Join(dataDir, "lintel.db")
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("%s has no lintel.db — this is not a hub data directory", dataDir)
		}
		return nil, nil, err
	}
	checked = append(checked, "lintel.db          present")

	st, err := store.OpenReadOnly(dataDir)
	if err != nil {
		return nil, nil, err
	}
	defer st.Close()
	ctx := context.Background()

	paired, err := st.AnyDevicePaired(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("read devices: %w", err)
	}

	// The signing key. Absent is fine ONLY for a hub that has never paired —
	// exactly the rule the server enforces at startup, applied here so the
	// answer arrives before anyone is standing at a gate.
	if err := keys.RequireExisting(dataDir); err != nil {
		if paired {
			problems = append(problems, "gateway_ed25519.seed is MISSING and this hub has "+
				"paired controllers. Starting it would mint a new identity that none of them "+
				"trusts, and the repair that would move them must be signed by the key that "+
				"is gone. Restore that file, or plan to re-pair every controller physically.")
		} else {
			checked = append(checked, "gateway key        absent (fine: nothing has paired)")
		}
	} else {
		checked = append(checked, "gateway key        present")
	}

	// The retained key, which only matters while a rotation is open.
	rot, rotErr := st.OpenKeyRotation(ctx)
	switch {
	case rotErr == nil:
		_, statErr := os.Stat(filepath.Join(dataDir, "gateway_ed25519.previous.seed"))
		if statErr != nil {
			problems = append(problems, fmt.Sprintf("a key rotation started %d is recorded "+
				"and gateway_ed25519.previous.seed is MISSING. Every controller that had not "+
				"repaired when the backup was taken is unreachable and unrepairable without "+
				"it.", rot.StartedAt))
		} else {
			checked = append(checked, "retained key       present (a rotation is in flight)")
		}
	default:
		checked = append(checked, "retained key       not needed (no rotation in flight)")
	}

	// The JWT secret is deliberately NOT a problem. Losing it logs everyone out
	// and they sign in again; nothing is unrecoverable. Saying so beats leaving
	// an operator to wonder why it is not in the list.
	if _, err := os.Stat(filepath.Join(dataDir, "jwt_secret")); err != nil {
		checked = append(checked, "jwt_secret         absent (harmless: sessions end, people sign in again)")
	} else {
		checked = append(checked, "jwt_secret         present")
	}

	return problems, checked, nil
}
