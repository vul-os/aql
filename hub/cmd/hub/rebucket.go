package main

// `aql-hub energy rebucket` — rebuild energy rollups under the current timezone.
//
// # What this is for
//
// Rollup buckets carry their timezone in their identity: `tz` is part of
// energy_rollups' primary key, and every read filters on the zone the hub is
// configured with now. The incremental engine recomputes only what ingest marked
// dirty, and reads never do that work — a deliberate property, so that a chart
// asking for last year does not re-derive last year.
//
// The consequence is that changing AQL_ENERGY_TZ silently orphans the history. It
// is not deleted; it is keyed to a zone nothing asks about any more, so the
// console shows a hub that has been metering for months as having no past. This
// command is the way back: it marks the retained span dirty under the current
// zone and lets the ordinary rollup path rebuild it from the samples.
//
// # What it cannot do, and says so
//
// Rollups are rebuilt from raw samples, and samples are pruned on a window
// (AQL_ENERGY_SAMPLE_RETENTION, 30 days by default). Anything older than the
// oldest surviving sample cannot be recomputed in any zone, by this command or
// by anything else. So the report leads with the span it CAN cover and names the
// span it cannot, because a recovery tool that prints a success line over a
// partial result is worse than one that refuses: the operator stops looking.
//
// # Why it is safe to run
//
// Additive and idempotent. It writes no rollup itself — it queues work — and the
// buckets under the previous timezone are left exactly where they are. A rebuild
// that deleted them would turn a recoverable mistake into an unrecoverable one if
// the new zone were also wrong. Running it twice does nothing the first run did
// not already do.

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/vul-os/aql/hub/internal/energy"
	"github.com/vul-os/aql/hub/internal/store"
)

func runEnergyRebucket(args []string) int {
	fs := flag.NewFlagSet("energy rebucket", flag.ExitOnError)
	dataDir := fs.String("data", envOr("AQL_DATA_DIR", "./data"), "hub data directory")
	account := fs.String("account", "", "account id whose rollups to rebuild (required)")
	tz := fs.String("tz", envOr("AQL_ENERGY_TZ", ""), "IANA timezone to rebuild under; defaults to AQL_ENERGY_TZ")
	dryRun := fs.Bool("dry-run", false, "report what would be rebuilt and change nothing")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *account == "" {
		fmt.Fprintln(os.Stderr, "energy rebucket: -account is required")
		return 2
	}

	loc := time.UTC
	if *tz != "" {
		l, err := time.LoadLocation(*tz)
		if err != nil {
			fmt.Fprintf(os.Stderr, "energy rebucket: %q is not a timezone this system knows: %v\n", *tz, err)
			return 2
		}
		loc = l
	}

	st, err := store.Open(*dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "energy rebucket: open %s: %v\n", *dataDir, err)
		return 1
	}
	defer st.Close()

	ctx := context.Background()
	if _, err := st.AdminAccountByID(ctx, *account); err != nil {
		fmt.Fprintf(os.Stderr, "energy rebucket: no account %q on this hub: %v\n", *account, err)
		return 1
	}

	es := energy.NewStore(st.DB(), energy.WithLocation(loc))
	first, last, ok, err := es.SampleSpan(ctx, *account)
	if err != nil {
		fmt.Fprintf(os.Stderr, "energy rebucket: %v\n", err)
		return 1
	}
	if !ok {
		fmt.Printf("No samples are retained for account %s, so there is nothing to rebuild.\n", *account)
		fmt.Println("Rollups are rebuilt from raw samples; without them no zone can be recomputed.")
		return 0
	}

	fmt.Printf("Rebuilding energy rollups under %s.\n\n", loc)
	fmt.Printf("  Retained samples: %s → %s\n",
		first.In(loc).Format(time.RFC3339), last.In(loc).Format(time.RFC3339))

	// The part an operator actually needs. Stated before the work, not after,
	// so a long run does not bury it.
	fmt.Printf("\n  This rebuilds ONLY that span. Any rollup older than %s cannot be\n"+
		"  recomputed in this or any timezone — the samples it would be rebuilt from have\n"+
		"  been pruned (AQL_ENERGY_SAMPLE_RETENTION). Those buckets remain in the database\n"+
		"  under the timezone they were written in, and nothing will query them again.\n",
		first.In(loc).Format(time.RFC3339))

	if *dryRun {
		fmt.Println("\n-dry-run: nothing was changed.")
		return 0
	}

	marked, err := es.MarkRangeDirty(ctx, *account, first, last)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\nenergy rebucket: queueing work failed: %v\n", err)
		return 1
	}
	fmt.Printf("\n  Queued %d hour buckets.\n", marked)

	// Drain to completion. A budget exists for the background pass, where a
	// long rollup must not starve the poller; here the operator is waiting for
	// exactly this and a partial drain would leave them unable to tell whether
	// it worked.
	total := energy.RollupResult{}
	for {
		res, err := es.Rollup(ctx, *account, 0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "\nenergy rebucket: rollup failed after %d hours: %v\n", total.Hours, err)
			return 1
		}
		total.Hours += res.Hours
		total.Days += res.Days
		total.Months += res.Months
		if res.Remaining == 0 {
			break
		}
	}
	fmt.Printf("  Rebuilt %d hours, %d days, %d months.\n", total.Hours, total.Days, total.Months)

	pending, err := es.PendingRollups(ctx, *account)
	if err == nil && pending > 0 {
		fmt.Fprintf(os.Stderr, "\n  WARNING: %d buckets are still queued. Re-run this command.\n", pending)
		return 1
	}
	fmt.Println("\nDone. The console will now show this span under the current timezone.")
	return 0
}
