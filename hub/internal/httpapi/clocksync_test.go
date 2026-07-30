package httpapi

// The ping nobody was sending.
//
// A controller learns the hub's time in two places and no others: the WS
// handshake, and an accepted `ping`. The hub had never sent a ping — its only
// signer was called with `open` and `close` — so the handshake was the sole
// source of time.
//
// A healthy WS connection carries no read deadline and can live for weeks, so
// a controller that never drops never re-handshakes. After 14 days
// (wire.StaleClockLimitSeconds) its grant verification refuses EVERYTHING with
// stale_clock, before it even looks at the grant. The failure lands exactly
// where it hurts: perfect connectivity for a fortnight, then a hub outage, and
// every offline emergency grant denied at the gate.
//
// These tests are about the sweep actually happening and actually carrying a
// time. What the controller does with it is verified on the controller side.

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

func TestClockSyncPingsEveryConnectedController(t *testing.T) {
	s, st := newServerForClockSync(t)
	a := pairDeviceForClockSync(t, st, "dev-a")
	b := pairDeviceForClockSync(t, st, "dev-b")

	sendA, _, unregA := s.hub.Register(a)
	defer unregA()
	sendB, _, unregB := s.hub.Register(b)
	defer unregB()

	go s.SyncControllerClocks(context.Background())

	for name, ch := range map[string]<-chan []byte{a: sendA, b: sendB} {
		select {
		case payload := <-ch:
			var env keys.Envelope
			if err := json.Unmarshal(payload, &env); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if env.Cmd != "ping" {
				t.Errorf("%s received %q, want ping", name, env.Cmd)
			}
			// The iat is what the controller syncs from. A zero or stale one
			// would leave the clock exactly as unsynced as before while
			// looking like the problem had been fixed.
			if env.IAT <= 0 {
				t.Errorf("%s: ping carries iat %d — the controller syncs FROM this, so a "+
					"ping without a usable time does nothing at all", name, env.IAT)
			}
			if drift := time.Since(time.Unix(env.IAT, 0)); drift > time.Minute || drift < -time.Minute {
				t.Errorf("%s: ping iat is %v away from now", name, drift)
			}
			if env.Sig == "" {
				t.Errorf("%s: ping is unsigned; the controller would refuse it", name)
			}
		case <-time.After(2 * time.Second):
			t.Errorf("%s was never pinged", name)
		}
	}
}

// A ping is not an access event. The access log is evidence about who went
// where, and a background sweep writing to it would put a row against every
// controller every six hours forever.
func TestClockSyncWritesNoAccessLog(t *testing.T) {
	s, st := newServerForClockSync(t)
	quiet := pairDeviceForClockSync(t, st, "dev-quiet")
	// Not WS-connected, so the ping queues rather than blocking on a reader.
	_ = quiet
	s.SyncControllerClocks(context.Background())

	logs, err := st.AccessLogsByAccount(context.Background(), "any-account", 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range logs {
		if l.Command == "ping" {
			t.Error("a clock-sync ping was written to the access log, which is evidence " +
				"about who went where")
		}
	}
}

// With nothing connected the sweep is a no-op rather than an error: a hub whose
// controllers are all offline is an ordinary state, and they will sync at the
// handshake when they return.
func TestClockSyncIsQuietWithAnEmptyFleet(t *testing.T) {
	s, _ := newServerForClockSync(t)
	if n := s.SyncControllerClocks(context.Background()); n != 0 {
		t.Errorf("pinged %d devices with no paired controllers at all", n)
	}
}

// THE case the first version of this worker missed entirely.
//
// A controller on the HTTPS long-poll fallback holds no WebSocket, so it never
// completes a handshake and never reaches runner.go's SyncFromGateway. The
// worker used to iterate the live WS map, so it was never sent a ping either —
// leaving it with NO path to a fresh clock, and every offline grant it holds
// refused after fourteen days.
//
// The hub looked fine throughout: last_seen_at is stamped on every poll, so
// such a controller reads as recently seen while its clock freezes.
func TestClockSyncReachesAPairedControllerWithNoLiveSocket(t *testing.T) {
	s, st := newServerForClockSync(t)
	id := pairDeviceForClockSync(t, st, "dev-longpoll")

	// Deliberately NOT registered on the WS hub — this is the long-poll case.
	if s.hub.Connected(id) {
		t.Fatal("fixture: the device must not hold a live socket")
	}

	if n := s.SyncControllerClocks(context.Background()); n != 1 {
		t.Fatalf(`pinged %d devices; want 1.

A paired controller with no live socket is exactly the one that cannot sync its
clock any other way. Enumerating only the connected set skipped it.`, n)
	}

	// The ping must be QUEUED for it, which is how a long-poll controller
	// receives commands: it drains the queue on its next poll and runs each
	// through the same command processor a live one uses.
	queued := s.hub.DrainQueue(id)
	if len(queued) != 1 {
		t.Fatalf("%d commands queued for a long-poll controller, want 1", len(queued))
	}
	var env keys.Envelope
	if err := json.Unmarshal(queued[0], &env); err != nil {
		t.Fatal(err)
	}
	if env.Cmd != "ping" {
		t.Errorf("queued command is %q, want ping", env.Cmd)
	}
	if env.IAT <= 0 {
		t.Error("the queued ping carries no usable time, so it would sync nothing")
	}
}

// pairDeviceForClockSync creates a real paired device row, because the worker
// enumerates the FLEET from the store — a WS registration alone is not a paired
// controller, and a fixture that only registered would have hidden the very
// case this worker exists to cover.
func pairDeviceForClockSync(t *testing.T, st *store.Store, label string) string {
	t.Helper()
	ctx := context.Background()
	u, err := st.CreateUser(ctx, label+"@clock.test", "hash", "C", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, loc, err := st.CreateAccountWithOwner(ctx, u.ID, label+" home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	d, err := st.CreateDeviceWithClaim(ctx, acct.ID, loc.ID, label, "hash-"+label, now()+3600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB().ExecContext(ctx,
		`UPDATE devices SET paired_at = ?, public_key = 'x', status = 'active' WHERE id = ?`,
		now(), d.ID); err != nil {
		t.Fatal(err)
	}
	return d.ID
}

func now() int64 { return time.Now().Unix() }

// The interval has to stay far inside the controller's staleness limit, or the
// worker is decoration. 14 days is wire.StaleClockLimitSeconds on the
// controller side; this is asserted here because the two live in different
// modules and nothing else connects them.
func TestClockSyncIntervalIsWellInsideTheStalenessLimit(t *testing.T) {
	// READ from the controller's source, not hand-copied.
	//
	// This test previously declared `const controllerStaleLimit = 14 * 24 *
	// time.Hour // wire.StaleClockLimitSeconds` — a literal in this file with
	// the real constant's name in a comment beside it. That is the exact
	// unenforced-boundary shape this whole worker exists to fix: two modules,
	// one depending on the other's number, and nothing connecting them.
	// Lowering StaleClockLimitSeconds to an hour left this test green.
	//
	// hub and controller are separate Go modules and cannot import each
	// other, so the constant is read as TEXT — the technique
	// src/lib/offline/__tests__/wireConstants.test.ts already uses to hold
	// the TypeScript mirrors of these same constants honest.
	controllerStaleLimit := time.Duration(goConstSeconds(t,
		"../../../controller/internal/wire/wire.go", "StaleClockLimitSeconds")) * time.Second

	if clockSyncInterval >= controllerStaleLimit {
		t.Fatalf("clockSyncInterval %v is not inside the controller's %v staleness limit",
			clockSyncInterval, controllerStaleLimit)
	}
	// A margin big enough to miss several pings — a hub restart, a controller
	// briefly away — and still be far from the limit.
	if clockSyncInterval*8 >= controllerStaleLimit {
		t.Errorf("clockSyncInterval %v leaves too little margin against %v: a controller "+
			"that misses a handful of pings should still be nowhere near stale",
			clockSyncInterval, controllerStaleLimit)
	}
}

// newServerForClockSync builds a Server with a real hub and store, and returns
// both — the sweep talks to the hub, the assertions read the store.
func newServerForClockSync(t *testing.T) (*Server, *store.Store) {
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
	s := New(Config{Version: "test", JWTSecret: []byte("0123456789abcdef0123456789abcdef")},
		st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s, st
}

// goConstSeconds reads `name = <integer>` out of a Go source file.
//
// Deliberately strict: it fails the test if the constant is missing, renamed,
// or no longer a bare integer, rather than falling back to a default. A
// cross-module check that silently stops checking is worse than no check,
// because its name goes on claiming the property is held.
func goConstSeconds(t *testing.T, relPath, name string) int64 {
	t.Helper()
	b, err := os.ReadFile(relPath)
	if err != nil {
		t.Fatalf("read %s: %v — this test asserts a constant that lives in another module, "+
			"and cannot do so if it cannot find it", relPath, err)
	}
	re := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(name) + `\s*=\s*(\d+)`)
	m := re.FindSubmatch(b)
	if m == nil {
		t.Fatalf("%s does not define %s as a bare integer any more. If it moved or changed "+
			"shape, this check must be updated with it — not deleted, because the hub's ping "+
			"interval is only safe relative to whatever that value now is.", relPath, name)
	}
	n, err := strconv.ParseInt(string(m[1]), 10, 64)
	if err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	return n
}

// The staleness limit the API reports must be the controller's real one.
//
// This used to compare a local `controllerStaleAfterSeconds = 14 * 24 * 60 * 60`
// against the controller's source — a hand-written mirror of a constant in
// another Go module, which is the exact shape that made the original stale-clock
// bug invisible. The mirror is gone: the route now serves
// keys.StaleClockLimitSeconds, one hub-side declaration that
// keys/spec_constants_test.go checks against proto/vectors/.
//
// The cross-module comparison stays, because agreeing with the vectors is not
// quite the same claim as agreeing with the binary that enforces the limit. A
// client is told this number and decides what to warn on, so a drift makes every
// downstream warning wrong.
func TestReportedStalenessLimitMatchesTheController(t *testing.T) {
	real := goConstSeconds(t, "../../../controller/internal/wire/wire.go", "StaleClockLimitSeconds")
	if keys.StaleClockLimitSeconds != real {
		t.Fatalf(`the API reports a %d-second staleness limit; the controller enforces %d.

This number is sent to clients so they do not hard-code it. If the controller's
limit moved, keys.StaleClockLimitSeconds must move with it — the two modules
cannot import each other, so nothing but this test connects them.`,
			keys.StaleClockLimitSeconds, real)
	}
}
