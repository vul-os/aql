package events_test

import (
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/events"
	"github.com/vul-os/aql/controller/internal/wire"
)

// The Recorder — the signing layer over the event queue.
//
// The queue underneath it is well covered; Record, RecordGrantRedeemed and
// NewEventID were at zero. Found by the controller coverage audit.
//
// What these carry: every event a controller emits while the hub is
// unreachable, including grant_redeemed — the primary evidence that an offline
// emergency-access open happened. Nobody is watching when these are written, by
// definition, so a fault here is discovered later or not at all.

func recorderFixture(t *testing.T) (*events.Recorder, *events.Queue, ed25519.PublicKey, string) {
	t.Helper()
	dir := t.TempDir()
	q, err := events.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { q.Close() })
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	r := &events.Recorder{
		Priv: priv, DeviceID: "dev-1",
		Clock: &clock.Fake{NowSec: 1_700_000_000, SyncSec: 1_700_000_000},
		Queue: q,
	}
	return r, q, pub, dir
}

// A recorded event is signed by the controller and carries the CLOCK's time —
// not the wall clock. The hub verifies both, so either being wrong makes the
// event unusable as evidence.
func TestARecordedEventIsSignedAndCarriesTheControllerClock(t *testing.T) {
	r, q, pub, _ := recorderFixture(t)

	r.Record("tamper", map[string]any{"why": "case opened"})

	pending := q.Drain(10)
	if len(pending) != 1 {
		t.Fatalf("queued %d events, want 1", len(pending))
	}
	var ev wire.Event
	if err := json.Unmarshal(pending[0].Raw, &ev); err != nil {
		t.Fatal(err)
	}
	if ev.Kind != "tamper" || ev.DeviceID != "dev-1" {
		t.Errorf("event: %+v", ev)
	}
	if ev.TS != 1_700_000_000 {
		t.Errorf("event ts %d — it must come from the controller's synced clock, not the wall clock", ev.TS)
	}
	if ev.EventID == "" {
		t.Error("event has no id — the hub's idempotency key")
	}
	// Verified the way the hub does it: canonicalise the RECEIVED bytes minus
	// sig and check the signature over those. Rebuilding the struct and
	// re-signing would verify the signer rather than the artefact — the trap
	// the key-rotation test fell into.
	canonical, sig, err := wire.CanonicalMinusSig(pending[0].Raw)
	if err != nil {
		t.Fatal(err)
	}
	if !wire.Verify(pub, canonical, sig) {
		t.Error("the queued event does not verify under the controller's key")
	}
	// And it does not verify under a different key, or the check above would
	// pass on anything.
	otherPub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	if wire.Verify(otherPub, canonical, sig) {
		t.Error("the event verifies under an unrelated key")
	}
}

// grant_redeemed lands in the RESERVED partition, so a controller that has been
// offline long enough to fill its ordinary queue still records the one event
// that proves a gate was opened on an emergency grant.
func TestGrantRedeemedSurvivesAFullOrdinaryQueue(t *testing.T) {
	r, q, _, _ := recorderFixture(t)

	// Nine thousand fsync'd appends is thirty-odd seconds of test suite for a
	// property that has nothing to do with durability. SetSyncForTest exists
	// for this; the durability of a single append is exercised by the test
	// above, which leaves fsync on.
	q.SetSyncForTest(false)

	// The grant is recorded FIRST, then buried under a flood that overruns the
	// ordinary partition. Order is the whole test: the ordinary queue is a ring
	// that drops the OLDEST undelivered entries, so a grant written last
	// survives even without a reserved partition — which is how the first
	// version of this test passed against a tamper that removed the partition
	// entirely. Written first, it survives only because it was never in the
	// ring to begin with.
	if err := r.RecordGrantRedeemed(map[string]any{"grant_id": "g-1"}); err != nil {
		t.Fatalf("recording the grant failed: %v", err)
	}
	for i := 0; i < (events.Capacity-events.GrantReserved)+50; i++ {
		r.Record("heartbeat", map[string]any{"n": i})
	}

	found := false
	for _, p := range q.Drain(events.Capacity) {
		var ev wire.Event
		if err := json.Unmarshal(p.Raw, &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Kind == "grant_redeemed" {
			found = true
		}
	}
	if !found {
		t.Error("the grant_redeemed event is not in the queue")
	}
}

// The asymmetry is deliberate and is the kind of thing a tidy-up removes:
// Record LOGS its errors because recording must never block actuation;
// RecordGrantRedeemed RETURNS them because the caller has to know whether the
// audit trail captured the only evidence of an offline open.
func TestGrantRedeemedReportsFailureWhileOrdinaryRecordingDoesNot(t *testing.T) {
	r, q, _, dir := recorderFixture(t)

	q.SetSyncForTest(false)

	// Fill the reserved partition to its limit, then break the last-resort
	// overflow log by making its path un-writable — a directory in its place.
	for i := 0; i < events.GrantReserved; i++ {
		if err := r.RecordGrantRedeemed(map[string]any{"n": i}); err != nil {
			t.Fatalf("reserved partition rejected event %d: %v", i, err)
		}
	}
	q.Close()
	overflow := filepath.Join(dir, "queue", "grant_overflow.jsonl")
	if err := os.MkdirAll(overflow, 0o700); err != nil {
		// Layout differs; find it rather than guess.
		matches, _ := filepath.Glob(filepath.Join(dir, "**", "grant_overflow.jsonl"))
		t.Skipf("cannot position the overflow path (%v, candidates %v)", err, matches)
	}
	q2, err := events.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { q2.Close() })
	q2.SetSyncForTest(false)
	r.Queue = q2

	if err := r.RecordGrantRedeemed(map[string]any{"grant_id": "lost"}); err == nil {
		t.Error("RecordGrantRedeemed returned nil when neither the reserved partition " +
			"nor the overflow log could take the event — the caller cannot tell the " +
			"only evidence of an offline open was dropped")
	}

	// Record, by contrast, returns nothing at all: its contract is that
	// recording never blocks actuation.
	r.Record("heartbeat", map[string]any{})
}

// The event id is the hub's idempotency key. A fixed or colliding value would
// make the hub discard distinct events as duplicates — silently, and in the
// direction of losing evidence.
func TestEventIDsAreUniqueAndWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := events.NewEventID()
		if seen[id] {
			t.Fatalf("duplicate event id %q after %d draws", id, i)
		}
		seen[id] = true
		if len(id) != 36 || strings.Count(id, "-") != 4 {
			t.Fatalf("event id %q is not a UUID", id)
		}
		// Version 4, variant RFC 4122 — the shape the hub parses.
		if id[14] != '4' {
			t.Errorf("event id %q is not version 4", id)
		}
		if v := id[19]; v != '8' && v != '9' && v != 'a' && v != 'b' {
			t.Errorf("event id %q has the wrong variant nibble %q", id, v)
		}
	}
}
