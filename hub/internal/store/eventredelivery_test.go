package store

import (
	"context"
	"sync"
	"testing"
)

// One event, one audit row — even when the same delivery arrives six times at once.
//
// # The defect this pins
//
// The audit row was appended BEFORE the controller_events insert, so the event
// row could carry its id. A pre-check narrowed the window and its own comment
// admitted what that was worth: "ordering, not trust". Under concurrent
// redeliveries of one event_id, every caller passed the pre-check and appended
// an audit row, and only then did one insert win. Measured before the fix: six
// concurrent calls, one controller_events row, SIX access_logs rows.
//
// Six opens in the tamper-evident trail for one gate movement. The rows are
// hash-chained, so they verify perfectly — the chain proves nobody edited them,
// not that they describe something that happened.
//
// The insert is the claim now: the PRIMARY KEY picks one winner and only the
// winner appends. This asserts the counts rather than the mechanism, because
// what matters is that the log says one open.
func TestAConcurrentlyRedeliveredEventLogsOneOpen(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	acctA, _, locA, _ := twoTenants(t, s)
	ap, err := s.CreateAccessPointFull(ctx, acctA.ID, locA.ID, "Gate", "gate", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	dev, err := s.CreateDeviceWithClaim(ctx, acctA.ID, locA.ID, "ctl", "h", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE access_points SET device_id = ? WHERE id = ?`, dev.ID, ap.ID); err != nil {
		t.Fatal(err)
	}

	ev := ControllerEvent{
		EventID: "evt-dup-1", DeviceID: dev.ID, Kind: "opened", TS: 1700000000,
		Data: map[string]any{"cause": "cmd"}, Sig: "x", Envelope: []byte("{}"),
	}

	const n = 6
	var wg sync.WaitGroup
	stored := make([]bool, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			ok, _, err := s.RecordControllerEvent(ctx, ev)
			if err != nil {
				t.Errorf("record: %v", err)
			}
			stored[i] = ok
		}(i)
	}
	close(start)
	wg.Wait()

	nStored := 0
	for _, b := range stored {
		if b {
			nStored++
		}
	}
	var events, logs int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM controller_events WHERE event_id = ?`, ev.EventID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM access_logs`).Scan(&logs); err != nil {
		t.Fatal(err)
	}

	if nStored != 1 {
		t.Errorf("%d of %d concurrent deliveries reported the event as stored, want 1", nStored, n)
	}
	if events != 1 {
		t.Errorf("%d controller_events rows for one event_id, want 1", events)
	}
	if logs != 1 {
		t.Fatalf("%d access_logs rows for ONE gate movement, want 1 — the audit trail "+
			"over-reports opens that did not happen, and the hash chain will verify "+
			"every one of them", logs)
	}

	// And the event points at the audit row it produced, or the two records
	// cannot be joined by anyone reading the trail later.
	var linked int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM controller_events WHERE event_id = ? AND access_log_id IS NOT NULL`,
		ev.EventID).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked != 1 {
		t.Errorf("the stored event does not reference its audit row")
	}
}
