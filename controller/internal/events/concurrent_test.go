package events_test

import (
	"crypto/ed25519"
	"encoding/json"
	"sync"
	"testing"

	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/events"
)

// Many goroutines recording at once, which is what the agent now is.
//
// # Why this exists now
//
// The agent has always had several goroutines that can record an event — the
// command path, the grant path, the LAN and BLE listeners — and this package
// had no test with `go func` in it at all. The hazard was recorded as open and
// unmeasured. Adding the held_open watcher made it one goroutine worse, and
// that change was race-tested against a FAKE recorder holding its own mutex,
// which proves nothing about the real one.
//
// Reading the code says it is safe: Queue.Enqueue takes q.mu, Synced.Now takes
// its own, NewEventID is crypto/rand, and Recorder itself is immutable after
// construction. That is an argument. This is the evidence — and the two are not
// the same thing, which is the entire reason the open item said "each needs a
// test shaped around ITS hazard".
//
// # What is asserted beyond "no race"
//
// Under -race a data race fails the run on its own. But a queue can be
// race-free and still lose writes — two appends under a lock that overwrite the
// same slot would be perfectly synchronised and perfectly wrong — so this also
// counts what came back. Every event enqueued must be readable afterwards, and
// every event id must be distinct: a duplicate id would make the hub's dedupe
// drop a real event as a redelivery, which is the failure that matters and is
// invisible to the race detector.
// Appending while the delivery loop drains, acks and COMPACTS.
//
// This is the pairing the runner actually creates and the test above does not:
// event recorders append from several goroutines while a two-second ticker
// calls drainEvents, which drains, acks each delivered entry and then compacts.
// Compaction REWRITES the log file, so an append racing it is the one that
// could lose an event outright rather than merely interleave.
//
// All four take q.mu, which is an argument. This is the evidence, and it checks
// the property that matters rather than only the absence of a race: every event
// that was accepted must be accounted for exactly once — delivered or still
// pending — because an event silently dropped during a rewrite is an audit hole
// no ack protocol would notice.
func TestAppendingWhileTheDeliveryLoopDrainsAndCompacts(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	q.SetSyncForTest(false) // fsync per append would make this minutes, not seconds

	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := &events.Recorder{
		Priv: priv, DeviceID: "dev-drain",
		Clock: clock.NewSynced(1_700_000_000, nil), Queue: q,
	}

	const writers, each = 4, 60
	var wg sync.WaitGroup
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < each; i++ {
				rec.Record("opened", map[string]any{"cause": "cmd"})
			}
		}()
	}

	// The delivery loop, doing exactly what drainEvents does.
	delivered := 0
	done := make(chan struct{})
	var loop sync.WaitGroup
	loop.Add(1)
	go func() {
		defer loop.Done()
		for {
			select {
			case <-done:
				return
			default:
				for _, pe := range q.Drain(16) {
					if err := q.Ack(pe); err != nil {
						t.Errorf("ack: %v", err)
						return
					}
					delivered++
				}
				if err := q.CompactIfNeeded(); err != nil {
					t.Errorf("compact: %v", err)
					return
				}
			}
		}
	}()

	wg.Wait()
	close(done)
	loop.Wait()

	// Whatever the loop did not take must still be there.
	remaining := len(q.Drain(writers * each * 2))
	if delivered+remaining != writers*each {
		t.Fatalf("%d delivered + %d pending = %d, but %d events were accepted — "+
			"a compaction racing an append lost one",
			delivered, remaining, delivered+remaining, writers*each)
	}
}

func TestConcurrentRecordersLoseNothing(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)

	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := &events.Recorder{
		Priv:     priv,
		DeviceID: "dev-concurrent",
		Clock:    clock.NewSynced(0, nil),
		Queue:    q,
	}

	// The clock is SYNCED and keeps re-syncing while the writers run.
	//
	// Without this the fixture missed half its own subject: NewSynced(0, nil)
	// leaves `synced` false, so Now() returns time.Now() and never reads the
	// shared base/baseMono at all. Removing the clock's mutex was NOT CAUGHT
	// until a writer existed to race against — which is exactly the shape of the
	// agent, where SyncFromGateway runs on the hub connection while other
	// goroutines record.
	rec.Clock.(*clock.Synced).SyncFromGateway(1_700_000_000)

	const writers, each = 8, 25
	var wg sync.WaitGroup

	stopSync := make(chan struct{})
	var syncer sync.WaitGroup
	syncer.Add(1)
	go func() {
		defer syncer.Done()
		for ts := int64(1_700_000_000); ; ts++ {
			select {
			case <-stopSync:
				return
			default:
				rec.Clock.(*clock.Synced).SyncFromGateway(ts)
			}
		}
	}()
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < each; i++ {
				// The kinds the agent actually emits from different goroutines.
				switch i % 3 {
				case 0:
					rec.Record("held_open", map[string]any{"seconds": 300})
				case 1:
					rec.Record("opened", map[string]any{"cause": "cmd"})
				default:
					rec.Record("denied", map[string]any{"reason": "rate_limited"})
				}
			}
		}(w)
	}
	wg.Wait()
	close(stopSync)
	syncer.Wait()

	pending := q.Drain(writers * each * 2)
	if len(pending) != writers*each {
		t.Fatalf("%d events survived %d concurrent records — the queue lost writes without racing",
			len(pending), writers*each)
	}

	ids := map[string]bool{}
	for _, p := range pending {
		var ev struct {
			EventID string `json:"event_id"`
			Kind    string `json:"kind"`
		}
		if err := json.Unmarshal(p.Raw, &ev); err != nil {
			t.Fatalf("an event came back unparseable: %v", err)
		}
		if ev.EventID == "" {
			t.Fatal("an event came back with no id")
		}
		if ids[ev.EventID] {
			t.Fatalf("duplicate event id %s — the hub dedupes on this, so a real event "+
				"would be dropped as a redelivery", ev.EventID)
		}
		ids[ev.EventID] = true
	}
}
