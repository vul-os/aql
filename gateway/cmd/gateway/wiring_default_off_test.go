package main

import (
	"log/slog"
	"strings"
	"testing"
)

// captureLogger records what the hub told the operator, so a test can assert
// that "stayed off" was explained rather than silent.
func captureLogger(into *strings.Builder) *slog.Logger {
	return slog.New(slog.NewTextHandler(into, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// The guarantee every existing install depends on: adding the device engine,
// the energy poller and the automations runner must not change the behaviour of
// a hub that has not asked for any of them.
//
// These tests exist because the failure they guard against is silent. A hub
// that starts a poller nobody configured does not crash — it opens a connection
// once a minute forever, logs errors that look like a device fault, and burns
// battery on a Pi at a gate. The access path would keep working, so nobody
// would look. The only honest way to hold the line is to assert the default is
// inert rather than to assume it.

// newBareHub builds the hub the way an operator with no device configuration
// gets it: a zero config, nothing named, nothing on disk.
func newBareHub(t *testing.T) (*hub, config) {
	t.Helper()
	return &hub{log: discardLogger()}, config{}
}

func TestDefaultConfigStartsNoDeviceEngine(t *testing.T) {
	h, cfg := newBareHub(t)
	h.wireDevices(cfg)
	if h.reg != nil {
		t.Fatal("a hub with no -device-drivers built a device registry; " +
			"an install that never asked for the device engine must not get one")
	}
	if len(h.workers) != 0 {
		t.Fatalf("device wiring started %d background worker(s) with no config; want 0",
			len(h.workers))
	}
}

func TestDefaultConfigStartsNoEnergyPoller(t *testing.T) {
	h, cfg := newBareHub(t)
	h.wireEnergy(cfg)
	if len(h.workers) != 0 {
		t.Fatalf("energy wiring started %d worker(s) with no -energy-account; want 0. "+
			"A poller nobody configured fails once a minute forever and looks like a "+
			"device fault", len(h.workers))
	}
}

func TestDefaultConfigStartsNoAutomationsRunner(t *testing.T) {
	h, cfg := newBareHub(t)
	h.wireAutomations(cfg)
	if len(h.workers) != 0 {
		t.Fatalf("automations wiring started %d worker(s) with no config; want 0",
			len(h.workers))
	}
}

// Energy depends on the device engine for its meters. Asking for one without
// the other is an operator mistake, and the honest response is to say so and
// stay off — not to start a loop that can never read anything.
func TestEnergyWithoutADeviceEngineStaysOffAndSaysWhy(t *testing.T) {
	var logged strings.Builder
	h := &hub{log: captureLogger(&logged)}
	h.wireEnergy(config{energyAccount: "acct_test"})

	if len(h.workers) != 0 {
		t.Fatalf("energy poller started with no device registry; it has no meters to read")
	}
	if got := logged.String(); !strings.Contains(got, "energy") {
		t.Errorf("staying off must be explained to the operator, or it reads as a "+
			"silent no-op; log was %q", got)
	}
}

// The whole point of the gate: naming drivers but giving no config file is a
// misconfiguration, and it must leave the hub in the same state as naming
// nothing at all — off, with an explanation.
func TestDriversNamedWithoutConfigStayOff(t *testing.T) {
	var logged strings.Builder
	h := &hub{log: captureLogger(&logged)}
	h.wireDevices(config{deviceDrivers: "http", deviceConfig: ""})

	if h.reg != nil {
		t.Fatal("drivers were named with no -device-config and a registry was built anyway")
	}
	if got := logged.String(); !strings.Contains(got, "device-config") {
		t.Errorf("the operator must be told why their drivers did not start; log was %q", got)
	}
}
