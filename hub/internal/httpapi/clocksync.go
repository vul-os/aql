package httpapi

// Keeping paired controllers' clocks fresh, which nothing did.
//
// # The failure this prevents
//
// A controller learns the hub's time in exactly two places: the WebSocket
// handshake (`transport/runner.go` calls `Clock.SyncFromGateway(ch.IAT)` while
// authenticating) and an accepted `ping` command (`command.go`'s SyncClock).
// Nothing else advances its LastGatewaySync.
//
// The hub had never sent a `ping`. proto/commands.md defines it, the
// controller implements and conformance-tests it, and `keys.SignCommand`'s
// only caller passed `open` or `close`. So in practice the handshake was the
// sole source of time.
//
// A healthy WS connection carries no read deadline
// (`runner.go`: `conn.SetReadDeadline(time.Time{})` once authenticated) and
// can live for weeks. A controller that never drops therefore never
// re-handshakes, and its LastGatewaySync quietly ages.
//
// After `wire.StaleClockLimitSeconds` — 14 days — the controller's grant
// verification refuses EVERYTHING with `stale_clock`
// (`grants/grants.go` step 1, before lockdown and before the grant itself is
// even examined). The consequence is precisely inverted from what anyone
// would expect: a site whose connectivity was flawless for a fortnight, then
// a hub outage, and every offline emergency grant is denied — by the
// controller, at the gate, with the person standing there. The connection
// being healthy is what caused it.
//
// # Why the whole fleet and not just the connected subset
//
// The first version of this worker iterated the hub's live WebSocket map. That
// silently excluded the case that needs it MOST: a controller on the HTTPS
// long-poll fallback (proto/pairing.md rule 5).
//
// Such a controller never completes a WS handshake, so it never reaches
// `runner.go`'s `Clock.SyncFromGateway(ch.IAT)`. And it was never in the
// connected map, so it was never sent a ping. Its LastGatewaySync therefore sat
// frozen at pairing time — no path to a fresh clock at all — and after fourteen
// days every offline grant it held was refused.
//
// Worse, the hub looked healthy: `last_seen_at` is stamped on every poll
// (`handleControllerPoll`), so a long-poll controller reads as recently seen
// while its clock ages out. `last_seen_at` is NOT a proxy for clock freshness
// and must not be used as one — it advances on polls, uplink events and acks,
// only some of which sync anything.
//
// Dispatching to a device with no live socket QUEUES the envelope, the
// long-poll handler drains that queue, and the controller runs it through the
// same `Proc.Process` — so a queued ping syncs a long-poll controller exactly
// as a live one. For a genuinely dead controller the ping expires (30s) and the
// next dispatch prunes it, so this cannot accumulate.
//
// # Why a periodic ping rather than a periodic reconnect
//
// Dropping a working connection to refresh a timestamp trades a real
// capability (a command can be delivered right now) for a bookkeeping one, and
// it would do so on every controller simultaneously. A ping costs one signed
// envelope and one ack.

import (
	"context"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/keys"
)

const (
	// clockSyncInterval is how often connected controllers are pinged.
	//
	// Six hours against a 14-day staleness limit is deliberately far inside
	// it: the margin has to survive a controller that misses several pings
	// while the hub restarts, and a ping is cheap enough that buying that
	// margin costs nothing worth counting.
	clockSyncInterval = 6 * time.Hour

	// clockSyncAckTimeout is short because nothing depends on the answer. A
	// controller that does not ack has either gone away — in which case it
	// will re-handshake and sync that way — or is busy, and will be pinged
	// again in six hours.
	clockSyncAckTimeout = 5 * time.Second
)

// SyncControllerClocks pings every currently connected controller once.
//
// Returns how many were pinged, so a caller can log it and an operator can see
// the worker is alive. Errors are deliberately not aggregated: a ping that
// fails is not an event, it is a controller that will be pinged again.
func (s *Server) SyncControllerClocks(ctx context.Context) int {
	// The whole paired fleet, not the connected subset — see the note above for
	// why the connected subset excluded exactly the controllers that cannot
	// sync any other way. Falls back to the connected set if the fleet cannot
	// be read, so a database hiccup degrades to the old behaviour rather than
	// to no clock sync at all.
	devices, err := s.store.PairedDeviceIDs(ctx)
	if err != nil {
		s.log.Error("clock sync could not enumerate the fleet; falling back to connected devices",
			"err", err)
		devices = s.hub.ConnectedDevices()
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	sent := 0

	for _, deviceID := range devices {
		// The `iat` the controller syncs from is set by SignCommand at signing
		// time, so it is the hub's own clock at the moment of sending — not a
		// timestamp captured when this sweep began, which would drift by the
		// length of the sweep across a large fleet.
		env, err := s.keys.SignCommand("ping", deviceID, "", 30*time.Second,
			map[string]any{"source": "gateway", "reason": "clock_sync"})
		if err != nil {
			s.log.Error("sign clock-sync ping", "device_id", deviceID, "err", err)
			continue
		}
		mu.Lock()
		sent++
		mu.Unlock()

		// CONCURRENTLY, and that is not an optimisation. Dispatch waits for an
		// ack, so a sequential sweep costs clockSyncAckTimeout for every
		// controller that does not answer — a fleet with a handful of silent
		// controllers would take minutes on one goroutine, and a controller
		// early in the list would delay every controller after it. The whole
		// point of this worker is that nobody's clock is left behind.
		wg.Add(1)
		go func(deviceID string, env *keys.Envelope) {
			defer wg.Done()
			// No log id: a ping is not an access event and must never appear
			// in the access log, which is evidence about who went where.
			s.hub.Dispatch(ctx, deviceID, env, clockSyncAckTimeout, "")
		}(deviceID, env)
	}

	// Waited on so one sweep finishes before the next tick can start, rather
	// than accumulating goroutines against a fleet that has stopped answering.
	wg.Wait()
	return sent
}

// RunClockSync pings connected controllers until ctx is cancelled.
//
// It sweeps once at startup rather than waiting a full interval: a hub that
// has just restarted is exactly when controllers may have been reconnecting,
// and a fleet that has been up far longer than the hub is the normal case.
func (s *Server) RunClockSync(ctx context.Context) {
	t := time.NewTicker(clockSyncInterval)
	defer t.Stop()
	for {
		if n := s.SyncControllerClocks(ctx); n > 0 {
			s.log.Info("controller clock sync", "pinged", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
