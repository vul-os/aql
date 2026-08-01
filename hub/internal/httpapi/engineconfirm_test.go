package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// The confirmation gate on the engine's actuation path.
//
// `engineConfirmAbove` is TierPhysicalAccess, so anything above it — which
// today means TierHazardousMotion, the tier the catalogue says exists BECAUSE
// of a mower's blades — needs `confirm: true`. engine.go's own comment says
// why: "a script that has not considered it fails closed rather than starting
// something with blades".
//
// Nothing tested it. `confirm_required` appeared in the console, in api.ts and
// in three comments, and in no assertion anywhere — so the gate between an
// unconsidered POST and a spinning blade was the one part of this path with no
// evidence behind it.
//
// Every case asserts what the DRIVER received, not just the status code. A 409
// that still actuated would be the worst outcome available here and would look
// identical from the response.
func TestAHazardousVerbNeedsAnExplicitConfirm(t *testing.T) {
	h, mock := engineServerWithDriver(t)
	access, _ := register(t, h, "confirm-owner")
	const key = "mock:mower-1"

	rec, out := doJSON(t, h, "POST", "/v1/engine/devices/"+key+"/execute", access,
		map[string]any{"verb": "start"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("unconfirmed start: %d %v, want 409", rec.Code, out)
	}
	if out["error"] != "confirm_required" {
		t.Errorf("error = %v, want confirm_required — a client cannot offer a confirmation "+
			"step for a refusal it cannot name", out["error"])
	}
	// The assertion that matters.
	if n := len(mock.Calls); n != 0 {
		t.Fatalf("the driver received %d calls for a refused command: %+v — the blades moved "+
			"and the caller was told to confirm", n, mock.Calls)
	}
}

func TestAConfirmedHazardousVerbRuns(t *testing.T) {
	h, mock := engineServerWithDriver(t)
	access, _ := register(t, h, "confirm-owner")
	const key = "mock:mower-1"

	rec, out := doJSON(t, h, "POST", "/v1/engine/devices/"+key+"/execute", access,
		map[string]any{"verb": "start", "confirm": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("confirmed start: %d %v", rec.Code, out)
	}
	if len(mock.Calls) != 1 || string(mock.Calls[0].Verb) != "start" {
		t.Fatalf("driver calls = %+v, want one start — a confirmation that does not actuate "+
			"trains people to click through it", mock.Calls)
	}
}

// The control. If every verb needed a confirm, the gate would be noise and the
// first thing anyone did would be to send confirm unconditionally — which is
// the same as not having it.
func TestAReversibleVerbNeedsNoConfirm(t *testing.T) {
	h, mock := engineServerWithDriver(t)
	access, _ := register(t, h, "confirm-owner")

	rec, out := doJSON(t, h, "POST", "/v1/engine/devices/mock:mower-1/execute", access,
		map[string]any{"verb": "stop"})
	if rec.Code != http.StatusOK {
		t.Fatalf("stop: %d %v — stopping a mower is TierReversible and must not be gated", rec.Code, out)
	}
	if len(mock.Calls) != 1 || string(mock.Calls[0].Verb) != "stop" {
		t.Fatalf("driver calls = %+v, want one stop", mock.Calls)
	}
}

// The threshold itself, so a catalogue change that moved a verb across it is
// visible here rather than only in the tier table.
func TestTheConfirmThresholdIsWhereTheCatalogueSaysItIs(t *testing.T) {
	if engineConfirmAbove != devices.TierPhysicalAccess {
		t.Fatalf("engineConfirmAbove = %v, want TierPhysicalAccess", engineConfirmAbove)
	}
	if engineTierCeiling != devices.TierHazardousMotion {
		t.Fatalf("engineTierCeiling = %v, want TierHazardousMotion", engineTierCeiling)
	}
	// And the two are ordered: a ceiling at or below the confirm threshold
	// would make the confirm unreachable — every verb it applies to would
	// already be refused, and the gate would read as working while testing
	// nothing.
	if engineTierCeiling <= engineConfirmAbove {
		t.Fatalf("ceiling %v <= confirm threshold %v: nothing can ever require a confirm",
			engineTierCeiling, engineConfirmAbove)
	}
}

// engineServerWithDriver is engineServer plus a handle on the mock, so a test
// can assert what the DRIVER received rather than only what the API answered.
//
// The existing helper returns the router and the store and drops the driver,
// which is why the cooldown tests can only check status codes. For a
// confirmation gate that is not enough: the failure worth catching is a refusal
// that actuated anyway, and it is invisible from the response.
func engineServerWithDriver(t *testing.T) (http.Handler, *devices.MockDriver) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	mock := devices.NewMockDriver("mock")
	reg := devices.NewRegistry()
	if err := reg.Register(mock); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	s := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), mock
}
