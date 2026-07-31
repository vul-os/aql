package httpapi

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

// A chat rail sees only the devices its caller owns.
//
// chatFleetFor feeds the resolver, and the resolver's output is printed back to
// the member — so a widened fleet does not merely over-permit, it NAMES another
// household's devices in a message. On a multi-tenant hub that is a disclosure
// with no actuation required.
//
// Found by tampering: deleting the scope check entirely left every test in this
// package green, because nothing exercised the chat path with an engine
// attached. This is that test.
func TestAChatFleetIsScopedToTheCallersOwnDevices(t *testing.T) {
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
	srv := New(Config{
		Version:   "test",
		JWTSecret: []byte("0123456789abcdef0123456789abcdef"),
		Devices:   reg,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	ctx := context.Background()

	// Two tenants. The scope only narrows past one account — with a single
	// account every member sees everything, which is correct for a household
	// and is why this test needs two.
	accessA, _ := register(t, h, "a@fleet.test")
	acctA, _ := tenantIDs(t, h, accessA)
	accessB, _ := register(t, h, "b@fleet.test")
	acctB, _ := tenantIDs(t, h, accessB)

	fleet := reg.Devices()
	if len(fleet) < 2 {
		t.Fatalf("mock driver exposes %d devices, need at least 2 to tell the scopes apart", len(fleet))
	}
	mine, theirs := fleet[0], fleet[1]

	userA := userIDFor(t, st, "a@fleet.test")
	userB := userIDFor(t, st, "b@fleet.test")
	if err := st.ClaimDevice(ctx, mine.Key, acctA, userA, "mine"); err != nil {
		t.Fatal(err)
	}
	if err := st.ClaimDevice(ctx, theirs.Key, acctB, userB, "theirs"); err != nil {
		t.Fatal(err)
	}

	got := srv.chatFleetFor(ctx, userA)
	seen := map[string]bool{}
	for _, d := range got {
		seen[d.Key] = true
	}
	if !seen[mine.Key] {
		t.Errorf("caller's own device %q missing from their chat fleet", mine.Key)
	}
	if seen[theirs.Key] {
		t.Errorf("chat fleet includes %q, owned by another account — a refusal would name it", theirs.Key)
	}

	// And the reverse direction, because a scope that returned only the FIRST
	// account's devices would pass the assertions above.
	gotB := srv.chatFleetFor(ctx, userB)
	seenB := map[string]bool{}
	for _, d := range gotB {
		seenB[d.Key] = true
	}
	if !seenB[theirs.Key] || seenB[mine.Key] {
		t.Errorf("second caller's fleet is wrong: %v", seenB)
	}
}

// An unknown or unlinked caller gets nothing, rather than the whole fleet.
func TestAnUnknownChatCallerHasNoFleet(t *testing.T) {
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
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))

	for _, id := range []string{"", "no-such-user"} {
		if got := srv.chatFleetFor(context.Background(), id); len(got) != 0 {
			t.Errorf("profile %q got %d devices, want none", id, len(got))
		}
	}
}

// userIDFor resolves the id from the access token the caller was issued, which
// is the only handle a test has — there is no lookup by username on the store
// and adding one for a test would widen the surface for nothing.
func userIDFor(t *testing.T, st *store.Store, username string) string {
	t.Helper()
	u, err := st.UserByUsername(context.Background(), username)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

// "Which lights are on", end to end: consent, fleet, catalogue state, reply.
//
// The unit tests cover each rule in isolation. This is the one that shows they
// are all reached from a real caller — the reachability lesson this package has
// paid for twice.
func TestWhichLightsAreOnRequiresConsentThenAnswers(t *testing.T) {
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
	srv := New(Config{Version: "test", PublicURL: "https://gate.example",
		JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	ctx := context.Background()

	access, _ := register(t, h, "lights@x.test")
	_, locID := tenantIDs(t, h, access)
	u := userIDFor(t, st, "lights@x.test")

	// Without consent, the question is refused and the switch is named.
	before := srv.answerOccupancyQuestion(ctx, "which lights are on", u, "whatsapp")
	if !strings.Contains(before, "has not turned on occupancy answers") {
		t.Fatalf("answered without consent: %q", before)
	}

	if err := st.SetOccupancyDisclosure(ctx, locID, u, true); err != nil {
		t.Fatal(err)
	}
	after := srv.answerOccupancyQuestion(ctx, "which lights are on", u, "whatsapp")
	if strings.Contains(after, "has not turned on occupancy answers") {
		t.Fatalf("still refused after consent: %q", after)
	}
	// The mock fleet's one light declares CapDimmable and reports a level, so
	// the hub can speak for it — the whole chain from driver reading through
	// the catalogue's declaration to the reply.
	if !strings.Contains(after, "Garden Lights") {
		t.Errorf("the answer does not name the light: %q", after)
	}

	// §4.4 rule 5: the disclosure is audited, on the rail it happened on.
	logs, err := st.AccessLogsByAccount(ctx, accountOf(t, st, u), 100)
	if err != nil {
		t.Fatal(err)
	}
	reads := 0
	for _, l := range logs {
		if l.Command == "read" && l.Source == "whatsapp" {
			reads++
		}
	}
	if reads == 0 {
		t.Error("a lights disclosure was not audited")
	}
}

func accountOf(t *testing.T, st *store.Store, userID string) string {
	t.Helper()
	accounts, err := st.AccountsForUser(context.Background(), userID)
	if err != nil || len(accounts) == 0 {
		t.Fatalf("no account for %s: %v", userID, err)
	}
	return accounts[0].ID
}

// Partial consent is no consent, and it needs TWO locations to be visible.
//
// Found by tampering: the "nothing consented" gate and the "not everything
// consented" gate both fire for a one-location household, so removing either
// alone left the other holding and both tampers passed. Two guards masking each
// other is the same shape as the camera scoping earlier in this package, and
// the fix is the same — a fixture where only one of them can be responsible.
//
// Why partial consent refuses at all: engine devices are owned per ACCOUNT and
// carry no location, while consent is per LOCATION. There is no way to report
// only the consenting household's lights, so reporting any of them would mix in
// a household that said no.
func TestPartialConsentAnswersNothing(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, _ := keys.Load(dir)
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	ctx := context.Background()

	access, _ := register(t, h, "partial@x.test")
	acct, locA := tenantIDs(t, h, access)
	u := userIDFor(t, st, "partial@x.test")
	locB, err := st.CreateLocationFull(ctx, acct, store.CreateLocationArgs{Name: "Cottage", Type: "house"})
	if err != nil {
		t.Fatal(err)
	}

	// One of two consents. The "nothing consented" gate cannot be what refuses.
	if err := st.SetOccupancyDisclosure(ctx, locA, u, true); err != nil {
		t.Fatal(err)
	}
	got := srv.answerOccupancyQuestion(ctx, "which lights are on", u, "whatsapp")
	if !strings.Contains(got, "has not turned on occupancy answers") {
		t.Fatalf("partial consent answered: %q", got)
	}

	// Both consented: now it answers.
	if err := st.SetOccupancyDisclosure(ctx, locB, u, true); err != nil {
		t.Fatal(err)
	}
	full := srv.answerOccupancyQuestion(ctx, "which lights are on", u, "whatsapp")
	if strings.Contains(full, "has not turned on occupancy answers") {
		t.Fatalf("full consent still refused: %q", full)
	}
}

// The readings route reports the resolved ACTIVE state, so the console and a
// chat reply cannot disagree about the same lamp.
//
// Computed on the hub rather than in the client: re-deriving it in TypeScript
// would put a second copy of the catalogue's declarations in a language that
// cannot see them, and the two would diverge the first time a capability gained
// a state.
func TestTheReadingsRouteReportsResolvedState(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, _ := keys.Load(dir)
	reg := devices.NewRegistry()
	if err := reg.Register(devices.NewMockDriver("mock")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	srv := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef"), Devices: reg},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h := srv.Router()
	access, _ := register(t, h, "readings@x.test")

	// A dimmable lamp: declares a state and reports a level.
	rec, out := doJSON(t, h, "GET", "/v1/engine/devices/mock:lamp-1/readings", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("readings: %d %v", rec.Code, out)
	}
	if out["active"] == nil {
		t.Fatal("no active state on the response — the console would have to derive it")
	}
	if out["state_declared"] != true {
		t.Errorf("state_declared = %v for a dimmable lamp", out["state_declared"])
	}
	if got := out["active"]; got != "active" && got != "inactive" {
		t.Errorf("active = %v, want a resolved state for a lamp that reports a level", got)
	}

	// A thermostat declares no state, and says so rather than omitting the
	// field — absence would be ambiguous between "not supported" and "did not
	// report".
	rec, out = doJSON(t, h, "GET", "/v1/engine/devices/mock:thermo-1/readings", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("thermostat readings: %d", rec.Code)
	}
	if out["state_declared"] != false {
		t.Errorf("a setpoint declares a state: %v", out["state_declared"])
	}
	if out["active"] != "unknown" {
		t.Errorf("active = %v for a device with no declared state, want unknown", out["active"])
	}
}
