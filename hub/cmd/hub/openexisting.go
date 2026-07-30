package main

import (
	"fmt"
	"os"

	"github.com/vul-os/aql/hub/internal/store"
)

// openExistingStore — the one way a SUBCOMMAND opens a hub's data directory.
//
// store.Open creates the database when it is absent. That is right for a hub
// starting up and wrong for every subcommand here, all of which were given a
// directory that is supposed to already contain a hub. Without this, a typo in
// -data does not fail: it makes an empty database and then answers a question
// about it.
//
// All three subcommands had that, and each rendered it as a different wrong
// answer:
//
//   - verify-audit: "access_logs OK (0 rows)" — a green audit-chain result for a
//     backup that was not there.
//   - 2fa disable: "no such user: alice" — an admin unlocking somebody in a
//     hurry is told the ACCOUNT is gone, when the truth is the path is wrong.
//   - energy rebucket: "no account … on this hub" — same shape.
//
// The last two fail, so they are less dangerous than the first, but a wrong
// diagnosis sends the operator to fix the wrong thing. And all three wrote a
// database into whatever directory they were pointed at, including a cold
// backup that hub/README says is safe to run these against.
func openExistingStore(dataDir, subcommand string) (*store.Store, error) {
	dbPath := store.DatabaseFile(dataDir)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("%s: no hub database at %s\n\n"+
			"NOTHING WAS DONE. This is a refusal, not a result: the directory has no hub in\n"+
			"it, so any answer about its contents would be about a database this command had\n"+
			"just created. Check -data points at a hub data directory (it contains lintel.db)",
			subcommand, dbPath)
	}
	return store.Open(dataDir)
}
