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
	"testing"
	"time"

	"github.com/vul-os/aql/hub/internal/keys"
	"github.com/vul-os/aql/hub/internal/store"
)

func TestClockSyncPingsEveryConnectedController(t *testing.T) {
	s, _ := newServerForClockSync(t)

	sendA, _, unregA := s.hub.Register("dev-a")
	defer unregA()
	sendB, _, unregB := s.hub.Register("dev-b")
	defer unregB()

	go s.SyncControllerClocks(context.Background())

	for name, ch := range map[string]<-chan []byte{"dev-a": sendA, "dev-b": sendB} {
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
	_, _, unreg := s.hub.Register("dev-quiet")
	defer unreg()

	// Drain so Dispatch does not block on the unread channel.
	go func() {
		send, _, u := s.hub.Register("dev-drain")
		defer u()
		<-send
	}()
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
func TestClockSyncIsQuietWithNothingConnected(t *testing.T) {
	s, _ := newServerForClockSync(t)
	if n := s.SyncControllerClocks(context.Background()); n != 0 {
		t.Errorf("pinged %d devices with none connected", n)
	}
}

// The interval has to stay far inside the controller's staleness limit, or the
// worker is decoration. 14 days is wire.StaleClockLimitSeconds on the
// controller side; this is asserted here because the two live in different
// modules and nothing else connects them.
func TestClockSyncIntervalIsWellInsideTheStalenessLimit(t *testing.T) {
	const controllerStaleLimit = 14 * 24 * time.Hour // wire.StaleClockLimitSeconds
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
