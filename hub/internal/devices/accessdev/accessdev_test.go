package accessdev

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

var fixedNow = time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)

func newTestDriver(t *testing.T, aps []AccessPoint, connected map[string]bool) *Driver {
	t.Helper()
	cfg := Config{
		List: func(context.Context) ([]AccessPoint, error) { return aps, nil },
		Log:  quiet(),
		Now:  func() time.Time { return fixedNow },
	}
	if connected != nil {
		cfg.Connected = func(id string) (bool, bool) { return connected[id], true }
	}
	d, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return d
}

func TestDiscoverMapsAccessPointsOntoEngineDevices(t *testing.T) {
	d := newTestDriver(t, []AccessPoint{
		{ID: "ap-2", AccountID: "acct", Name: "Side Door", Kind: "door", DeviceID: "ctrl-2"},
		{ID: "ap-1", AccountID: "acct", Name: "Main Gate", Kind: "gate", DeviceID: "ctrl-1"},
		{ID: "ap-3", AccountID: "acct", Name: "Unpaired", Kind: "barrier"},
	}, map[string]bool{"ctrl-1": true})

	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d devices, want 3", len(got))
	}
	// Sorted by id, so the order does not depend on the store's ORDER BY.
	if got[0].ID != "ap-1" || got[2].ID != "ap-3" {
		t.Errorf("not sorted by id: %s %s %s", got[0].ID, got[1].ID, got[2].ID)
	}
	for _, dev := range got {
		if dev.Kind != devices.KindAccess {
			t.Errorf("%s kind = %v, want access", dev.ID, dev.Kind)
		}
		if err := dev.Validate(); err != nil {
			t.Errorf("%s does not validate: %v", dev.ID, err)
		}
	}
	if got[0].Availability != devices.AvailOnline {
		t.Errorf("a connected controller should be online, got %v", got[0].Availability)
	}
	if got[1].Availability != devices.AvailOffline {
		t.Errorf("a paired-but-disconnected controller should be offline, got %v", got[1].Availability)
	}
	if got[2].Availability != devices.AvailOffline {
		t.Errorf("an access point with no controller should be offline, got %v", got[2].Availability)
	}
}

// The device key the rest of the hub speaks. Pinned because docs/ACCESS-ON-THE-
// ENGINE.md §3.3 fixes this format and because a key derived from the NAME would
// change when somebody renames a gate — which the Driver contract forbids.
func TestDeviceKeysAreAccessColonAccessPointID(t *testing.T) {
	d := newTestDriver(t, []AccessPoint{{ID: "ap-1", Name: "Main Gate", Kind: "gate"}}, nil)
	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if key := devices.Key(d.ID(), got[0].ID); key != "access:ap-1" {
		t.Errorf("device key = %q, want %q", key, "access:ap-1")
	}
}

// THE test for this package. Not one verb, not a sample: every actuating verb
// the catalogue has must be refused, so that adding a verb somewhere else cannot
// quietly open a route to a gate through the engine.
func TestExecuteRefusesEveryVerbInTheCatalogue(t *testing.T) {
	d := newTestDriver(t, []AccessPoint{{ID: "ap-1", Name: "Main Gate", Kind: "gate", DeviceID: "ctrl-1"}}, nil)

	seen := 0
	for _, capID := range devices.Capabilities() {
		for _, vs := range devices.VerbsOf(capID) {
			seen++
			err := d.Execute(context.Background(), "ap-1", vs.Verb, nil)
			if err == nil {
				t.Fatalf("Execute(%s) returned nil — the device engine actuated an access point", vs.Verb)
			}
			if !errors.Is(err, devices.ErrUnsupported) {
				t.Errorf("Execute(%s) error does not wrap ErrUnsupported (%v); the registry and the "+
					"API classify it by that, and without it a refusal reads as a driver fault", vs.Verb, err)
			}
			if !errors.Is(err, ErrUseSignedPath) {
				t.Errorf("Execute(%s) does not name the signed path; a refusal that does not say "+
					"where to go instead just looks broken", vs.Verb)
			}
		}
	}
	if seen < 20 {
		t.Errorf("only %d verbs exercised; the catalogue is larger, so this test is not covering "+
			"what it claims to", seen)
	}
}

// The engine must not be able to ROUTE an actuating access verb here at all —
// the refusal above is the second line, not the first. These devices declare
// only a status-only capability, so an automation cannot even name `open` on
// one. See the package doc.
func TestAccessDevicesOfferNoActuatingVerb(t *testing.T) {
	d := newTestDriver(t, []AccessPoint{{ID: "ap-1", Name: "Main Gate", Kind: "gate", DeviceID: "c"}}, nil)
	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	dev := got[0]
	for _, v := range []devices.Verb{devices.VerbOpen, devices.VerbUnlock, devices.VerbHold, devices.VerbClose} {
		if _, _, ok := dev.Supports(v); ok {
			t.Errorf("an access device offers %s. It must offer status only: a device that offers "+
				"an actuating access verb can be NAMED by an automation rule, and 'cannot be named' "+
				"is a cheaper defence than 'is refused when named'", v)
		}
	}
	spec, _, ok := dev.Supports(devices.VerbStatus)
	if !ok {
		t.Fatal("an access device does not offer status, so it reports nothing at all")
	}
	if spec.Tier != devices.TierRead {
		t.Errorf("status tier = %v, want TierRead", spec.Tier)
	}
}

// Read returns nothing, and that is a decision rather than an omission: whether
// a barrier is physically open is not known without a sensor most installations
// do not have. A test pins it so a future change to invent one is deliberate.
func TestReadInventsNothing(t *testing.T) {
	d := newTestDriver(t, []AccessPoint{{ID: "ap-1", Name: "Main Gate", Kind: "gate"}}, nil)
	r, err := d.Read(context.Background(), "ap-1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(r) != 0 {
		t.Errorf("Read returned %d readings; this driver measures nothing and must say so", len(r))
	}
}

func TestSummaryNeverClaimsToKnowTheBarrierPosition(t *testing.T) {
	d := newTestDriver(t, []AccessPoint{
		{ID: "ap-1", Name: "Main Gate", Kind: "gate", DeviceID: "ctrl-1"},
		{ID: "ap-2", Name: "Unpaired", Kind: "gate"},
	}, map[string]bool{"ctrl-1": true})
	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, dev := range got {
		low := strings.ToLower(dev.Summary)
		for _, forbidden := range []string{"open", "closed", "shut", "ajar"} {
			if strings.Contains(low, forbidden) {
				t.Errorf("%s summary %q claims a barrier position. Most installations have no "+
					"sensor on the gate, so this is an invention — and inventing is worse here "+
					"than anywhere else in the product", dev.ID, dev.Summary)
			}
		}
	}
}

// The boot window: the device hub is built after the engine is wired, so for a
// moment nothing can answer. A gate must read as UNKNOWN then, not offline —
// "the controller is not connected" and "nobody has looked yet" are different
// things to tell somebody standing at a gate.
func TestAnUntrackedConnectionReadsAsUnknownNotOffline(t *testing.T) {
	d, err := New(Config{
		List: func(context.Context) ([]AccessPoint, error) {
			return []AccessPoint{{ID: "ap-1", Name: "Main Gate", Kind: "gate", DeviceID: "ctrl-1"}}, nil
		},
		Connected: func(string) (bool, bool) { return false, false }, // not known yet
		Log:       quiet(), Now: func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Availability != devices.AvailUnknown {
		t.Errorf("availability = %v, want unknown: reporting a paired gate as offline because "+
			"the device hub is not up yet asserts something nobody checked", got[0].Availability)
	}
}

func TestAListFailureIsReportedAsUnhealthyRatherThanAnEmptyFleet(t *testing.T) {
	boom := errors.New("database is locked")
	d, err := New(Config{
		List: func(context.Context) ([]AccessPoint, error) { return nil, boom },
		Log:  quiet(), Now: func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Discover(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("Discover error = %v, want it to wrap the list failure", err)
	}
	h := d.Health(context.Background())
	if h.OK {
		t.Error("Health reports OK after the access points could not be listed. An empty fleet " +
			"and an unreadable one look identical in the console otherwise")
	}
	if !strings.Contains(h.Detail, "locked") {
		t.Errorf("Health detail %q does not say what went wrong", h.Detail)
	}
}

func TestNewRefusesAnIncompleteConfig(t *testing.T) {
	if _, err := New(Config{Log: quiet()}); err == nil {
		t.Error("New accepted a config with no List; a driver that cannot enumerate its devices " +
			"would report an empty fleet, which reads as 'you have no gates'")
	}
	if _, err := New(Config{List: func(context.Context) ([]AccessPoint, error) { return nil, nil }}); err == nil {
		t.Error("New accepted a config with no logger")
	}
}
