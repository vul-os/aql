package main

// The rollup timezone warning.
//
// AQL_ENERGY_TZ defaults to UTC, and a hub that runs on that default produces
// daily and monthly energy totals split at UTC midnight. For anywhere that is
// not UTC those are wrong, and they are wrong in the way that does not get
// noticed: the shape of the chart is right, the magnitudes are right, and only
// the boundaries are off.
//
// What makes it worth warning about rather than documenting once is that the
// mistake hardens. `tz` is part of energy_rollups' primary key, every read
// filters on the CURRENT zone, and rollups are recomputed only from the dirty
// queue ingest marks — reads never do that work, deliberately. So an operator
// who runs for six months on the default and then sets their real timezone does
// not get their history re-bucketed. The old rows stay in the table, correct,
// and stop appearing in any query. There is no backfill command.

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/store"
)

// Returns the hub, its captured log, the account id, and the data directory —
// the last so a subcommand test can point -data at the same store.
func energyHub(t *testing.T) (*hub, *bytes.Buffer, string, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "meter@x.com", "x", "Meter", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	buf := &bytes.Buffer{}
	h := &hub{
		store: st, reg: reg,
		log: slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}
	h.energy = h.newEnergyStore(config{})
	return h, buf, acct.ID, dir
}

func TestAnUnsetRollupTimezoneIsSaidOutLoudWhenMeteringStarts(t *testing.T) {
	h, logs, acct, _ := energyHub(t)
	h.wireEnergy(config{energyAccount: acct, energyTZ: ""})

	out := logs.String()
	if !strings.Contains(out, "AQL_ENERGY_TZ") {
		t.Fatalf(`metering started with no rollup timezone and said nothing.

Every daily and monthly total will split at UTC midnight, which is wrong for
anywhere that is not UTC and looks entirely plausible. Logs were:
%s`, out)
	}
	// The warning has to carry the part that makes it urgent. "Set this" is a
	// preference; "setting it later will not fix what you already have" is the
	// reason to act now, and without it an operator reasonably defers.
	for _, phrase := range []string{"does not re-bucket", "UTC"} {
		if !strings.Contains(out, phrase) {
			t.Errorf("the warning omits %q, so it does not say why this cannot simply be "+
				"fixed later:\n%s", phrase, out)
		}
	}
}

func TestASetTimezoneWarnsAboutNothing(t *testing.T) {
	h, logs, acct, _ := energyHub(t)
	h.wireEnergy(config{energyAccount: acct, energyTZ: "Africa/Johannesburg"})

	if strings.Contains(logs.String(), "AQL_ENERGY_TZ is not set") {
		t.Errorf("a hub with a configured timezone was warned anyway; a warning that fires "+
			"when nothing is wrong is one operators learn to skip:\n%s", logs.String())
	}
}

// The warning must not fire on a hub that is not metering at all. Most hubs are
// not, and a startup warning about a subsystem nobody enabled is noise that
// teaches people to ignore the log.
func TestAHubThatIsNotMeteringIsNotWarned(t *testing.T) {
	h, logs, _, _ := energyHub(t)
	h.wireEnergy(config{energyAccount: "", energyTZ: ""})

	if strings.Contains(logs.String(), "AQL_ENERGY_TZ") {
		t.Errorf("a hub with metering off was warned about the rollup timezone:\n%s", logs.String())
	}
}
