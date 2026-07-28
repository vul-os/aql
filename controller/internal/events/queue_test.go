package events_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/controller/internal/events"
)

func mustOpen(t *testing.T, dir string) *events.Queue {
	t.Helper()
	q, err := events.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return q
}

func TestDurabilityAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	for i := 0; i < 5; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"e%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	if err := q.Enqueue("grant_redeemed", []byte(`{"event_id":"g0"}`)); err != nil {
		t.Fatal(err)
	}
	q.Close() // simulated kill: no ack, no compact

	q2 := mustOpen(t, dir)
	defer q2.Close()
	n, g := q2.Len()
	if n != 5 || g != 1 {
		t.Fatalf("after reopen: normal=%d grant=%d", n, g)
	}
	pend := q2.Drain(100)
	if len(pend) != 6 {
		t.Fatalf("drain: %d", len(pend))
	}
	// Grants drain first (audit continuity).
	if !pend[0].Grant {
		t.Fatal("grant partition must drain first")
	}
	// Ack everything; cursor survives reopen.
	for _, p := range pend {
		if err := q2.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	q2.Close()
	q3 := mustOpen(t, dir)
	defer q3.Close()
	if n, g := q3.Len(); n != 0 || g != 0 {
		t.Fatalf("acked events resurrected: normal=%d grant=%d", n, g)
	}
}

func TestTornTailTruncated(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	if err := q.Enqueue("opened", []byte(`{"event_id":"keep"}`)); err != nil {
		t.Fatal(err)
	}
	q.Close()
	// Simulate a torn write: garbage without trailing newline.
	path := filepath.Join(dir, "queue", "events.jsonl")
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(`{"seq":99,"raw":{"tr`)
	f.Close()

	q2 := mustOpen(t, dir)
	defer q2.Close()
	if n, _ := q2.Len(); n != 1 {
		t.Fatalf("torn tail handling: normal=%d", n)
	}
	// And the log keeps accepting appends afterwards.
	if err := q2.Enqueue("opened", []byte(`{"event_id":"after"}`)); err != nil {
		t.Fatal(err)
	}
	if n, _ := q2.Len(); n != 2 {
		t.Fatal("append after truncation failed")
	}
}

func TestRingDropsOldestButNeverGrants(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	defer q.Close()
	q.SetSyncForTest(false) // bulk fill; durability path covered elsewhere
	normalCap := events.Capacity - events.GrantReserved
	for i := 0; i < normalCap+10; i++ {
		if err := q.Enqueue("net", []byte(fmt.Sprintf(`{"event_id":"n%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	n, _ := q.Len()
	if n != normalCap {
		t.Fatalf("ring did not cap: %d != %d", n, normalCap)
	}
	// Oldest were dropped: first pending normal is n10.
	pend := q.Drain(1)
	if string(pend[0].Raw) != `{"event_id":"n10"}` {
		t.Fatalf("expected n10 first, got %s", pend[0].Raw)
	}

	// Grant partition refuses to drop when full.
	for i := 0; i < events.GrantReserved; i++ {
		if err := q.Enqueue("grant_redeemed", []byte(fmt.Sprintf(`{"event_id":"g%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	if err := q.Enqueue("grant_redeemed", []byte(`{"event_id":"overflow"}`)); err == nil {
		t.Fatal("grant partition overflow must error, never drop")
	}
}

// TestGrantOverflowFallback: once the reserved grant_redeemed partition is
// full (Enqueue itself refuses to drop, proving the partition really is
// saturated — see TestRingDropsOldestButNeverGrants), EnqueueGrantRedeemed
// must NOT lose the record: it must fall back to the overflow log instead
// of returning that error to the caller. This is the durable
// "last-resort" trace the offline-emergency open path relies on (defect
// fix in agent.OnRedeemed) — before this method existed, a full reserved
// partition meant the record was simply gone.
func TestGrantOverflowFallback(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	defer q.Close()
	q.SetSyncForTest(false)
	for i := 0; i < events.GrantReserved; i++ {
		if err := q.Enqueue("grant_redeemed", []byte(fmt.Sprintf(`{"event_id":"g%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	// Sanity: the reserved partition really is full (Enqueue alone refuses).
	if err := q.Enqueue("grant_redeemed", []byte(`{"event_id":"would-drop"}`)); err == nil {
		t.Fatal("test setup: reserved partition unexpectedly accepted one more")
	}

	if err := q.EnqueueGrantRedeemed([]byte(`{"event_id":"overflow-1"}`)); err != nil {
		t.Fatalf("EnqueueGrantRedeemed with a full reserved partition returned an error (record lost): %v", err)
	}
	entries, err := q.OverflowEntriesForTest()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || string(entries[0]) != `{"event_id":"overflow-1"}` {
		t.Fatalf("overflow log contents: %v", entries)
	}

	// A second overflow write appends rather than clobbering the first.
	if err := q.EnqueueGrantRedeemed([]byte(`{"event_id":"overflow-2"}`)); err != nil {
		t.Fatalf("second overflow write: %v", err)
	}
	entries, err = q.OverflowEntriesForTest()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 overflow entries, got %d: %v", len(entries), entries)
	}

	// Below capacity, EnqueueGrantRedeemed uses the reserved partition, not
	// the overflow log.
	dir2 := t.TempDir()
	q2 := mustOpen(t, dir2)
	defer q2.Close()
	if err := q2.EnqueueGrantRedeemed([]byte(`{"event_id":"normal-path"}`)); err != nil {
		t.Fatal(err)
	}
	if n, g := q2.Len(); n != 0 || g != 1 {
		t.Fatalf("expected the reserved partition to take it: normal=%d grant=%d", n, g)
	}
	if entries, _ := q2.OverflowEntriesForTest(); len(entries) != 0 {
		t.Fatalf("overflow log should be untouched on the normal path: %v", entries)
	}
}

func TestCompact(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	for i := 0; i < 10; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"c%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	pend := q.Drain(5)
	for _, p := range pend {
		if err := q.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	if err := q.Compact(); err != nil {
		t.Fatal(err)
	}
	q.Close()
	q2 := mustOpen(t, dir)
	defer q2.Close()
	if n, _ := q2.Len(); n != 5 {
		t.Fatalf("after compact+reopen: %d", n)
	}
}

// The queue's log is append-only, so a delivered entry leaves `entries` but
// its line stays on disk until the file is rewritten. Compact did that and
// nothing called it — the same "written, correct, never invoked" shape as the
// hub's PruneSamples, on the device with the least storage in the system.
//
// TestCompact above proves the function works. These prove it RUNS, and that
// the file actually gets smaller — the existing assertion (entry count after
// reopen) passes unchanged even if the log never shrinks a byte.

func logSize(t *testing.T, dir string) int64 {
	t.Helper()
	var total int64
	for _, name := range []string{"events.jsonl", "grants.jsonl"} {
		fi, err := os.Stat(filepath.Join(dir, "queue", name))
		if err != nil {
			t.Fatal(err)
		}
		total += fi.Size()
	}
	return total
}

func TestCompactionActuallyShrinksTheLog(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	defer q.Close()

	for i := 0; i < 200; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"s%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	grown := logSize(t, dir)

	for _, p := range q.Drain(200) {
		if err := q.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	// Acking alone must not shrink anything — the point of the append-only log
	// is that delivery is a cursor move, not a rewrite.
	if after := logSize(t, dir); after != grown {
		t.Fatalf("acking rewrote the log on its own: %d -> %d", grown, after)
	}

	if err := q.Compact(); err != nil {
		t.Fatal(err)
	}
	if after := logSize(t, dir); after >= grown {
		t.Fatalf("compaction did not shrink the log: %d -> %d", grown, after)
	}
}

// The threshold exists so a controller draining a handful of events a minute
// is not rewriting two files a minute. Below it, nothing happens.
func TestCompactIfNeededIsQuietBelowTheThreshold(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	defer q.Close()

	for i := 0; i < 5; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"q%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range q.Drain(5) {
		if err := q.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	before := logSize(t, dir)
	if err := q.CompactIfNeeded(); err != nil {
		t.Fatal(err)
	}
	if after := logSize(t, dir); after != before {
		t.Fatalf("compacted after 5 acks with a threshold of %d: %d -> %d",
			events.CompactThreshold, before, after)
	}
}

func TestCompactIfNeededFiresOnceEnoughIsAcked(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	defer q.Close()

	n := events.CompactThreshold + 10
	for i := 0; i < n; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"f%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	before := logSize(t, dir)
	for _, p := range q.Drain(n) {
		if err := q.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	if err := q.CompactIfNeeded(); err != nil {
		t.Fatal(err)
	}
	if after := logSize(t, dir); after >= before {
		t.Fatalf("threshold passed and nothing was reclaimed: %d -> %d", before, after)
	}
}

// A controller that is power cycled often would otherwise accumulate one run's
// worth of delivered history per boot, forever. Opening reclaims it once.
func TestOpeningReclaimsThePreviousRunsDeliveredEntries(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)
	for i := 0; i < 50; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"r%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range q.Drain(50) {
		if err := q.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	grown := logSize(t, dir)
	q.Close()

	// No explicit Compact call anywhere in this test.
	q2 := mustOpen(t, dir)
	defer q2.Close()
	if after := logSize(t, dir); after >= grown {
		t.Fatalf("reopening did not reclaim the previous run: %d -> %d", grown, after)
	}
	if n, g := q2.Len(); n != 0 || g != 0 {
		t.Fatalf("reclaim lost or invented undelivered entries: normal=%d grant=%d", n, g)
	}
}

// The reclaim must never touch what has NOT been delivered — that is the whole
// contract of the queue, and grant redemptions are the entries it exists for.
func TestReclaimNeverDropsUndeliveredEntries(t *testing.T) {
	dir := t.TempDir()
	q := mustOpen(t, dir)

	for i := 0; i < 20; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"u%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	if err := q.EnqueueGrantRedeemed([]byte(`{"event_id":"g-keep"}`)); err != nil {
		t.Fatal(err)
	}
	// Deliver only some of the normal ones; nothing of the grant partition.
	for _, p := range q.Drain(5) {
		if p.Grant {
			continue
		}
		if err := q.Ack(p); err != nil {
			t.Fatal(err)
		}
	}
	q.Close()

	q2 := mustOpen(t, dir)
	defer q2.Close()
	normal, grant := q2.Len()
	if grant != 1 {
		t.Fatalf("the undelivered grant redemption did not survive reclaim: %d", grant)
	}
	if normal == 0 {
		t.Fatal("reclaim dropped undelivered normal events")
	}
}
