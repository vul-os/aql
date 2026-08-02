package agent

import (
	"crypto/ed25519"
	"log/slog"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/events"
	"github.com/vul-os/aql/controller/internal/relay"
)

// countingRelay records actuation without doing any.
type countingRelay struct {
	relay.Relay
	pulses atomic.Int64
}

func (c *countingRelay) Pulse(time.Duration) error { c.pulses.Add(1); return nil }

// A denied grant proof must not move the relay.
//
// This is the last line of defence in the product: the offline emergency path
// runs with no hub, no network and no second opinion, so whatever the
// controller decides is what the gate does. A denial that actuates anyway is
// the worst outcome the system has.
//
// The property IS covered — e2e's TestOfflineGrant_Rejects and
// TestRevoke_StopsAGrantOpeningARealController both fail when OnDenied is made
// to pulse. This exists anyway, because `cd controller && go test ./...` is a
// normal thing to run and answered `ok` to exactly that change: the e2e module
// is a different module and does not run from here.
//
// Deliberately calling OnDenied directly rather than driving a forged proof
// through the Exchange. The Exchange's own refusals are covered by its tests
// and its fuzz targets; what is unguarded HERE is the callback, and a test that
// went the long way round would pass for reasons that have nothing to do with
// it.
func TestADeniedGrantNeverMovesTheRelay(t *testing.T) {
	r := &countingRelay{}
	a := &Agent{
		Relay: r,
		Log:   slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})),
	}

	// Recorder is nil, which OnDenied returns early on — so assert the early
	// return happens BEFORE any actuation, not merely that nothing was
	// recorded.
	a.OnDenied("grant-123", "cnonce_replay")
	if n := r.pulses.Load(); n != 0 {
		t.Fatalf("a denied grant pulsed the relay %d time(s) with no recorder attached", n)
	}

	// And with a recorder present, so the nil-Recorder early return is not the
	// only reason this passes — that would make the test agree with itself.
	q, err := events.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open queue: %v", err)
	}
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	a.Recorder = &events.Recorder{
		Priv: priv, DeviceID: "dev-denied",
		Clock: clock.NewSynced(1_700_000_000, nil), Queue: q,
	}
	for _, reason := range []string{"cnonce_replay", "expired", "bad_sig", "unknown_ap"} {
		a.OnDenied("grant-456", reason)
	}
	if n := r.pulses.Load(); n != 0 {
		t.Fatalf("denied grants pulsed the relay %d time(s)", n)
	}
}
