package transport

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/events"
	"github.com/vul-os/aql/controller/internal/state"
)

// The long-poll fallback had no test at all, anywhere.
//
// longPollCycle is what runs when the WebSocket is unavailable — a controller
// behind a proxy that will not upgrade, or a network dropping long-lived
// connections. It carries the same two things the socket does: commands in,
// events out. Nothing in this module or in e2e exercised it, so the whole
// degraded-network path was reasoned about and never run.
//
// It is also where an ack failure was being discarded while the socket path
// three hundred lines up logs and stops. That asymmetry is the reason this test
// exists; the coverage gap is the reason it is worth more than the one line.
func TestLongPollDeliversEventsAndAcksThem(t *testing.T) {
	dir := t.TempDir()
	q, err := events.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	clk := clock.NewSynced(1_700_000_000, nil)
	rec := &events.Recorder{Priv: priv, DeviceID: "dev-longpoll", Clock: clk, Queue: q}
	rec.Record("boot", map[string]any{"reason": "test"})

	var mu sync.Mutex
	var posted map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			// No commands to deliver; the controller should still post its
			// queued events.
			_, _ = w.Write([]byte(`{"commands":[]}`))
		case http.MethodPost:
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			_ = json.Unmarshal(body, &posted)
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer ts.Close()

	r := &Runner{
		Queue:         q,
		Clock:         clk,
		AllowInsecure: true, // httptest is http://
	}
	// pollURL turns ws://host/path into http://host/path/poll, so hand it the
	// ws form of the test server's address.
	p := &state.Pairing{
		DeviceID:     "dev-longpoll",
		WSURL:        strings.Replace(ts.URL, "http://", "ws://", 1) + "/api/controller/ws",
		PollInterval: 1,
	}

	r.longPollCycle(context.Background(), p,
		slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	mu.Lock()
	got := posted
	mu.Unlock()
	evs, _ := got["events"].([]any)
	if len(evs) != 1 {
		t.Fatalf("posted %d events, want 1 — the fallback did not carry the queue", len(evs))
	}

	// And they were ACKED: a second cycle must have nothing left to send.
	// Without the ack, the same event is posted forever and the hub dedupes it
	// silently — costing bandwidth on the one path that runs when the network
	// is already the problem.
	mu.Lock()
	posted = nil
	mu.Unlock()
	r.longPollCycle(context.Background(), p,
		slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	mu.Lock()
	second := posted
	mu.Unlock()
	if second != nil {
		t.Errorf("a second cycle posted again (%v); the first cycle's events were "+
			"never acked off the queue", second)
	}
}
