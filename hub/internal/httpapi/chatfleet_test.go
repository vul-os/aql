package httpapi

import (
	"bytes"
	"context"
	"log/slog"
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
