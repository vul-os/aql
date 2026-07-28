package transport

import (
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/vul-os/aql/controller/internal/events"
)

// Proves the RUNNER compacts, not merely that the queue can.
//
// events.Compact existed, worked, and had its own passing test — and nothing
// in the controller ever called it, so the durable log grew forever on the
// device with the least storage in the system. A test of the function would
// have stayed green for as long as that lasted; only a test of the call site
// catches it.
//
// This lives in package transport (not transport_test) because drainEvents is
// unexported, and the point is specifically that THIS function invokes
// compaction after acking a drain.
func TestDrainCompactsTheLog(t *testing.T) {
	dir := t.TempDir()
	q, err := events.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()

	n := events.CompactThreshold + 20
	for i := 0; i < n; i++ {
		if err := q.Enqueue("opened", []byte(fmt.Sprintf(`{"event_id":"d%d"}`, i))); err != nil {
			t.Fatal(err)
		}
	}
	before := logBytes(t, dir)

	// A pipe with a reader draining it: WriteMessage blocks until the far end
	// reads, and the far end is the hub in production.
	client, server := net.Pipe()
	go io.Copy(io.Discard, server)
	defer client.Close()
	defer server.Close()

	r := &Runner{Queue: q}
	r.drainEvents(NewWSConn(client), slog.New(slog.NewTextHandler(io.Discard, nil)))

	if got := logBytes(t, dir); got >= before {
		t.Fatalf("draining %d events acked them but never reclaimed the log: %d -> %d bytes.\n"+
			"drainEvents must call Queue.CompactIfNeeded once the batch is acked.", n, before, got)
	}
	if normal, grant := q.Len(); normal != 0 || grant != 0 {
		t.Fatalf("entries survived a full drain: normal=%d grant=%d", normal, grant)
	}
}

func logBytes(t *testing.T, dir string) int64 {
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
