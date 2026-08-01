package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// The operator surface for T4 chat windows.
//
// Nothing here makes a T4 verb reachable over chat — see t4windows.go. What
// these hold is that arming is admin-only, that it refuses anything that would
// be meaningless, and that the status a console reads is the DERIVED one rather
// than the stored column.

// t4Server is a server with a device registry, which the shared harness does
// not build. Without one every arm attempt answers 503 and the tests below
// would pass while exercising a single early return.
func t4Server(t *testing.T) (http.Handler, *store.Store) {
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
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	s := New(Config{
		Version:   "test",
		JWTSecret: []byte("0123456789abcdef0123456789abcdef"),
		Devices:   reg,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st
}

func TestArmingListingAndDisarmingAT4Window(t *testing.T) {
	h, _ := t4Server(t)
	admin, _ := register(t, h, "t4admin@x.com")
	accountID, _ := tenantIDs(t, h, admin)
	base := "/v1/accounts/" + accountID + "/t4-windows"

	// The seeded mock mower carries CapBladeJob, whose `start` is
	// TierHazardousMotion — the only tier a window is for.
	rec, out := doJSON(t, h, "POST", base, admin, map[string]any{
		"device_key": "mock:mower-1", "verb": "start",
		"duration_s": 1800, "max_uses": 1, "notes": "mowing the top field",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("arm: %d %v", rec.Code, out)
	}
	windowID, _ := out["id"].(string)
	if windowID == "" {
		t.Fatalf("no window id in %v", out)
	}
	if out["status"] != "active" {
		t.Errorf("a freshly armed window reports %v", out["status"])
	}
	if out["device_key"] != "mock:mower-1" || out["verb"] != "start" {
		t.Errorf("armed the wrong target: %v", out)
	}
	if out["armed_by"] == nil || out["armed_by"] == "" {
		t.Error("the window does not record who armed it")
	}

	rec, out = doJSON(t, h, "GET", base, admin, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %v", rec.Code, out)
	}
	list, _ := out["t4_windows"].([]any)
	if len(list) != 1 {
		t.Fatalf("list returned %d windows, want 1: %v", len(list), out)
	}

	rec, out = doJSON(t, h, "POST", base+"/"+windowID+"/disarm", admin, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("disarm: %d %v", rec.Code, out)
	}
	if out["status"] != "disarmed" {
		t.Errorf("after disarm the window reports %v", out["status"])
	}

	// Disarming again is not an error: the operator wanted it shut and it is
	// shut. A 409 here would make a console show a failure for exactly the
	// outcome that was asked for.
	rec, out = doJSON(t, h, "POST", base+"/"+windowID+"/disarm", admin, nil)
	if rec.Code != http.StatusOK || out["status"] != "disarmed" {
		t.Errorf("second disarm: %d %v", rec.Code, out)
	}

	// An unknown window is a 404, not a silent success.
	rec, _ = doJSON(t, h, "POST", base+"/no-such-window/disarm", admin, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("disarming an unknown window answered %d", rec.Code)
	}
}

// Arming decides whether a text message can start a mower blade. A plain member
// must not be able to do it, and must not be able to read the list either — the
// list is a map of which hazardous verbs are briefly reachable.
func TestOnlyAnAdminMayArmOrReadT4Windows(t *testing.T) {
	h, st := t4Server(t)
	admin, _ := register(t, h, "t4owner@x.com")
	accountID, _ := tenantIDs(t, h, admin)
	_, memberAccess := inviteMember(t, h, st, admin, accountID, "t4member@x.com", "+27821110042")
	base := "/v1/accounts/" + accountID + "/t4-windows"

	rec, _ := doJSON(t, h, "POST", base, memberAccess, map[string]any{
		"device_key": "mock:mower-1", "verb": "start", "duration_s": 600,
	})
	if rec.Code != http.StatusForbidden {
		t.Errorf("a plain member armed a T4 window: %d", rec.Code)
	}
	rec, _ = doJSON(t, h, "GET", base, memberAccess, nil)
	if rec.Code != http.StatusForbidden {
		t.Errorf("a plain member read the T4 window list: %d", rec.Code)
	}

	// And a member of a DIFFERENT account gets nothing at all.
	strangerAccess, _ := register(t, h, "stranger@x.com")
	rec, _ = doJSON(t, h, "GET", base, strangerAccess, nil)
	if rec.Code == http.StatusOK {
		t.Error("another account's member read the T4 window list")
	}

	// The admin can, so the refusals above are about the role rather than about
	// the route being broken for everyone.
	rec, _ = doJSON(t, h, "GET", base, admin, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("the admin could not read the list either: %d", rec.Code)
	}
}

// Everything that would produce a window that means nothing is refused, and the
// refusal names which problem it is.
func TestAT4WindowRequestThatWouldMeanNothingIsRefused(t *testing.T) {
	h, _ := t4Server(t)
	admin, _ := register(t, h, "t4reject@x.com")
	accountID, _ := tenantIDs(t, h, admin)
	base := "/v1/accounts/" + accountID + "/t4-windows"

	for _, tc := range []struct {
		name string
		body map[string]any
		want string
	}{
		{"a device the registry does not know",
			map[string]any{"device_key": "mock:nothing", "verb": "start", "duration_s": 600},
			"unknown_device"},
		{"a verb the device does not offer",
			map[string]any{"device_key": "mock:mower-1", "verb": "unlock", "duration_s": 600},
			"unsupported_verb"},
		// The lamp's `on` is TierReversible. Arming a window for it would be
		// harmless in that nothing consults one — and the operator would
		// believe they had done something, which is how the windows that DO
		// matter stop being read.
		{"a verb below T4",
			map[string]any{"device_key": "mock:lamp-1", "verb": "on", "duration_s": 600},
			"verb_below_t4"},
		{"no duration",
			map[string]any{"device_key": "mock:mower-1", "verb": "start", "duration_s": 0},
			"invalid_duration"},
		{"a negative duration",
			map[string]any{"device_key": "mock:mower-1", "verb": "start", "duration_s": -60},
			"invalid_duration"},
		// Longer than the cap. A window is an attended act; an unbounded one is
		// a permanent permission wearing a temporary name.
		{"longer than the maximum",
			map[string]any{"device_key": "mock:mower-1", "verb": "start", "duration_s": t4WindowMaxDurationS + 1},
			"invalid_duration"},
		{"a negative use cap",
			map[string]any{"device_key": "mock:mower-1", "verb": "start", "duration_s": 600, "max_uses": -1},
			"invalid_max_uses"},
	} {
		rec, out := doJSON(t, h, "POST", base, admin, tc.body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: answered %d %v, want 400", tc.name, rec.Code, out)
			continue
		}
		if out["error"] != tc.want {
			t.Errorf("%s: error is %v, want %q", tc.name, out["error"], tc.want)
		}
	}

	// None of those left a window behind.
	_, out := doJSON(t, h, "GET", base, admin, nil)
	if list, _ := out["t4_windows"].([]any); len(list) != 0 {
		t.Errorf("%d windows were created by requests that were all refused", len(list))
	}
}

// The maximum duration is exactly reachable, so the cap is a boundary rather
// than an approximation.
func TestTheLongestPermittedWindowIsAccepted(t *testing.T) {
	h, _ := t4Server(t)
	admin, _ := register(t, h, "t4max@x.com")
	accountID, _ := tenantIDs(t, h, admin)
	base := "/v1/accounts/" + accountID + "/t4-windows"

	rec, out := doJSON(t, h, "POST", base, admin, map[string]any{
		"device_key": "mock:mower-1", "verb": "start", "duration_s": t4WindowMaxDurationS,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("the maximum duration was refused: %d %v", rec.Code, out)
	}
	starts, _ := out["starts_at"].(float64)
	ends, _ := out["ends_at"].(float64)
	if int64(ends-starts) != t4WindowMaxDurationS {
		t.Errorf("window spans %ds, want %d", int64(ends-starts), t4WindowMaxDurationS)
	}
	// No cap given means no cap stored — not a default this file invented.
	if out["max_uses"] != nil {
		t.Errorf("max_uses defaulted to %v when none was asked for", out["max_uses"])
	}
}

// The list reports the DERIVED status, not the stored column.
//
// Expiry is never written back — see t4window.go on why a sweeper would be the
// thing that fails — so a window past its end still has `status = 'active'` on
// disk. A console reading the column would show a window as live an hour after
// it closed, which is the one lie this whole feature cannot afford.
//
// The window has to be planted through the store: the arm route starts every
// window NOW and caps its length, so no sequence of HTTP calls can produce an
// expired one inside a test.
//
// Found by tampering — swapping EffectiveStatus for the raw column left every
// other test in this file green.
func TestTheListReportsDerivedStatusNotTheStoredColumn(t *testing.T) {
	h, st := t4Server(t)
	admin, _ := register(t, h, "t4derived@x.com")
	accountID, _ := tenantIDs(t, h, admin)

	// A real user id: armed_by is a foreign key, and inventing one here would
	// fail on the constraint rather than on the thing being tested.
	u, err := st.UserByUsername(t.Context(), "t4derived@x.com")
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().Unix() - 7200
	planted, err := st.ArmT4Window(t.Context(), store.T4WindowArgs{
		AccountID: accountID, DeviceKey: "mock:mower-1", Verb: "start",
		ArmedByUserID: u.ID, StartsAt: past, EndsAt: past + 600,
	})
	if err != nil {
		t.Fatal(err)
	}
	// The premise: on disk it still says active.
	if planted.Status != "active" {
		t.Fatalf("the fixture is not the case this tests — stored status is %q", planted.Status)
	}

	_, out := doJSON(t, h, "GET", "/v1/accounts/"+accountID+"/t4-windows", admin, nil)
	list, _ := out["t4_windows"].([]any)
	if len(list) != 1 {
		t.Fatalf("list returned %d windows: %v", len(list), out)
	}
	row := list[0].(map[string]any)
	if row["status"] != "expired" {
		t.Errorf("an ended window is reported as %v — the API is reading the column, not the truth",
			row["status"])
	}
}

// Arming a hazardous verb is an operator decision, so it lands in the audit
// trail — but NOT as the verb itself. A log line reading `start` against a mower
// that never moved is the worst kind of entry to find later.
func TestArmingAndDisarmingAreAudited(t *testing.T) {
	h, st := t4Server(t)
	admin, _ := register(t, h, "t4audit@x.com")
	accountID, _ := tenantIDs(t, h, admin)
	base := "/v1/accounts/" + accountID + "/t4-windows"

	_, out := doJSON(t, h, "POST", base, admin, map[string]any{
		"device_key": "mock:mower-1", "verb": "start", "duration_s": 600,
	})
	windowID, _ := out["id"].(string)
	doJSON(t, h, "POST", base+"/"+windowID+"/disarm", admin, nil)

	logs, err := st.AccessLogsByAccount(t.Context(), accountID, 50)
	if err != nil {
		t.Fatal(err)
	}
	var armed, disarmed bool
	for _, l := range logs {
		switch l.Command {
		case "t4-window:arm:start":
			armed = true
		case "t4-window:disarm:start":
			disarmed = true
		case "start":
			t.Error("the audit trail records `start` against a mower that never moved")
		}
	}
	if !armed {
		t.Error("arming a T4 window was not audited")
	}
	if !disarmed {
		t.Error("disarming a T4 window was not audited")
	}
}
