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
	"net/http"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/keys"
)

// ackResultOK is the controller's success result for a non-actuation command
// (controller/internal/command: ResultOK). A ping acked with anything else is a
// controller that did NOT sync its clock, and must not be recorded as having
// proved one.
const ackResultOK = "ok"

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
		env, err := s.signForDevice(ctx, "ping", deviceID, "", nil, 30*time.Second,
			map[string]any{"source": "gateway", "reason": "clock_sync"})
		if err != nil {
			s.log.Error("sign clock-sync ping", "device_id", deviceID, "err", err)
			continue
		}
		mu.Lock()
		sent++
		mu.Unlock()

		// Remember the nonce BEFORE dispatching. A connected controller can ack
		// fast enough that the ack handler runs before this write would, and an
		// ack whose nonce is not yet recorded is an ack that proves nothing —
		// the sync would be silently lost for exactly the controllers that are
		// healthiest.
		if err := s.store.RecordPingDispatched(ctx, deviceID, env.Nonce); err != nil {
			s.log.Error("record ping nonce", "device_id", deviceID, "err", err)
		}

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
	every := s.cfg.ClockSyncInterval
	if every <= 0 {
		every = clockSyncInterval
	}
	t := time.NewTicker(every)
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

// GET /v1/accounts/{id}/controllers/clock-freshness
//
// Which of this account's controllers can still be trusted to honour an offline
// grant, and which are drifting toward refusing every one of them.
//
// Account-admin only: it is fleet operational data, and it names every
// controller the account has.
//
// # What each answer means
//
// `synced_at` is when a ping this hub minted was last PROVED processed by that
// controller — see store/migrations/0022 for why nothing else is proof. `null`
// means no ping has ever been acked by it, which is a real state and the one
// most worth acting on: such a controller has not demonstrably synced since it
// was paired.
//
// `stale_after` is the hub's copy of the controller's own limit. It is reported
// rather than assumed so a client does not hard-code fourteen days — the number
// lives in the controller module and the hub cannot import it.
func (s *Server) handleClockFreshness(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireAccountAdmin(w, r, id) {
		return
	}
	rows, err := s.store.ClockFreshnessByAccount(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	now := time.Now().Unix()
	out := make([]map[string]any, 0, len(rows))
	for _, f := range rows {
		m := map[string]any{"device_id": f.DeviceID, "label": f.Label}
		if f.SyncedAt == nil {
			// Reported as its own thing rather than as an enormous age, because
			// "never" and "very old" warrant different words to an operator.
			m["synced_at"] = nil
			m["proved"] = false
		} else {
			m["synced_at"] = *f.SyncedAt
			m["proved"] = true
			m["age_s"] = now - *f.SyncedAt
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"controllers": out,
		// The controller refuses every offline grant past this age. Sent so the
		// client does not restate a constant that lives in another module.
		"stale_after_s": keys.StaleClockLimitSeconds,
	})
}

// recordClockProof records a clock sync only when the controller's ack reports
// success.
//
// Wrapping the store call rather than changing it: the store answers "does this
// nonce match the ping I minted", which is exactly right and is what makes a
// recorded proof mean the signed nonce round-tripped. Whether the controller
// then DID the thing is a different question, and it belongs here, with the ack
// in hand, on both transports.
// # What this still cannot prove, stated rather than implied
//
// That the controller then USED the iat it acked. A controller that replies
// "ok" and never touches its own clock is indistinguishable from one that
// synced, from here — the hub sees a reply, not an effect. Tampering confirms
// it: making the controller ack successfully while skipping SyncClock leaves
// every test green, and no assertion available to the hub could catch it.
//
// So the guarantee is bounded and worth naming: a recorded proof means this
// controller RECEIVED and ACCEPTED a ping this hub minted, at a known time. The
// step from there to "its clock advanced" rests on the controller's own
// conformance tests, which is the right place for it — but it is a different
// claim, and `clock-freshness` should not be read as more than the first.
func (s *Server) recordClockProof(ctx context.Context, deviceID, nonce, result string) (bool, error) {
	if result != ackResultOK {
		return false, nil
	}
	return s.store.RecordAckIfPing(ctx, deviceID, nonce)
}
