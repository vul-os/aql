// Package agent wires the controller together: identity, durable state,
// pairing, clock, nonce store, event queue, command processor, gateway
// transport, LAN grant listener and (optionally, build-tag `ble` on Linux)
// the BLE peripheral — the same assembly for the real binary and the sim.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/vul-os/aql/controller/internal/bleperiph"
	"github.com/vul-os/aql/controller/internal/blesession"
	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/command"
	"github.com/vul-os/aql/controller/internal/events"
	"github.com/vul-os/aql/controller/internal/grants"
	"github.com/vul-os/aql/controller/internal/identity"
	"github.com/vul-os/aql/controller/internal/lanserver"
	"github.com/vul-os/aql/controller/internal/noncestore"
	"github.com/vul-os/aql/controller/internal/pairing"
	"github.com/vul-os/aql/controller/internal/relay"
	"github.com/vul-os/aql/controller/internal/state"
	"github.com/vul-os/aql/controller/internal/transport"
)

// Options configures an agent instance.
type Options struct {
	StateDir      string
	GatewayURL    string // needed only for first-run pairing
	ClaimToken    string // needed only for first-run pairing
	LANAddr       string // e.g. ":8737"; empty disables the LAN listener
	AccessPoints  []string
	Relay         relay.Relay // nil = mock
	Log           *slog.Logger
	AllowInsecure bool   // ws://+http:// endpoints (tests/dev)
	Firmware      string // reported in hw + boot events
	EnableBLE     bool   // requires a `-tags ble` build on Linux or Windows

	// HeldOpenAfter is how long the position sensor may go without reporting
	// the gate closed before a `held_open` event is emitted. Zero disables it,
	// and so does having no sensor — see heldopen.go for what the number in
	// that event does and does not claim.
	HeldOpenAfter time.Duration
}

// Agent is an assembled controller.
type Agent struct {
	Opts     Options
	ID       *identity.Identity
	St       *state.Store
	Clock    *clock.Synced
	Nonces   *noncestore.Store
	Queue    *events.Queue
	Recorder *events.Recorder
	Proc     *command.Processor
	Exchange *grants.Exchange
	Relay    relay.Relay
	Log      *slog.Logger
}

// New loads/creates all durable state and assembles the agent (no I/O to
// the hub yet).
func New(opts Options) (*Agent, error) {
	log := opts.Log
	if log == nil {
		log = slog.Default()
	}
	id, err := identity.Load(opts.StateDir)
	if err != nil {
		return nil, err
	}
	st, err := state.Open(opts.StateDir)
	if err != nil {
		return nil, err
	}
	if len(opts.AccessPoints) > 0 {
		if err := st.SetAccessPoints(opts.AccessPoints); err != nil {
			return nil, err
		}
	}
	nonces, err := noncestore.Open(opts.StateDir)
	if err != nil {
		return nil, err
	}
	queue, err := events.Open(opts.StateDir)
	if err != nil {
		return nil, err
	}
	clk := clock.NewSynced(st.LastGatewaySync(), func(ts int64) {
		if err := st.SetLastGatewaySync(ts); err != nil {
			log.Error("persist gateway sync", "err", err)
		}
	})
	rel := opts.Relay
	if rel == nil {
		// The mock ACTUATES NOTHING and reports success for everything. That is
		// correct for tests and the simulator and dangerous anywhere else: a
		// command is acked, the hub writes an `opened` row into a hash-chained
		// audit trail, and no gate moves.
		//
		// cmd/controller refuses to start when a relay was configured and could
		// not be opened, so reaching here means nobody asked for one. Say so at
		// WARN rather than INFO: an operator who wired a gate and forgot -relay
		// will otherwise see a working-looking controller.
		log.Warn("no relay configured; using the MOCK relay — commands will be " +
			"acked and recorded as successful, and nothing physical will move")
		rel = relay.NewMock(log)
	}
	a := &Agent{
		Opts: opts, ID: id, St: st, Clock: clk, Nonces: nonces,
		Queue: queue, Relay: rel, Log: log, Exchange: grants.NewExchange(),
	}
	deviceID := ""
	if p := st.Pairing(); p != nil {
		deviceID = p.DeviceID
	}
	a.Recorder = &events.Recorder{Priv: id.Private(), DeviceID: deviceID, Clock: clk, Queue: queue, Log: log}
	a.Proc = &command.Processor{
		Priv: id.Private(), State: st, Nonces: nonces, Clock: clk,
		Relay: rel, Events: a.Recorder, Log: log,
		SyncClock: clk.SyncFromGateway,
	}
	return a, nil
}

// EnsurePaired redeems the claim token when unpaired (first run).
func (a *Agent) EnsurePaired(ctx context.Context) error {
	if a.St.Pairing() != nil {
		return nil
	}
	if a.Opts.GatewayURL == "" || a.Opts.ClaimToken == "" {
		return errors.New("agent: unpaired — provide --hub and --claim-token for first run")
	}
	fw := a.Opts.Firmware
	if fw == "" {
		fw = "0.1.0"
	}
	pc := &pairing.Client{AllowInsecureWS: a.Opts.AllowInsecure}
	g, err := pc.RedeemClaim(ctx, a.St, a.Opts.GatewayURL, a.Opts.ClaimToken,
		a.ID.PublicKeyB64(), pairing.HW{Model: "lintel-ref", FW: fw, Ifaces: []string{"wifi"}})
	if err != nil {
		return err
	}
	a.Recorder.DeviceID = g.DeviceID
	a.Log.Info("paired", "device_id", g.DeviceID, "ws_url", g.WSURL)
	return nil
}

// GrantEnv snapshots the controller context for a redemption decision.
func (a *Agent) GrantEnv() grants.Env {
	deviceID := ""
	if p := a.St.Pairing(); p != nil {
		deviceID = p.DeviceID
	}
	now := a.Clock.Now()
	return grants.Env{
		Now:             now,
		LastGatewaySync: a.Clock.LastGatewaySync(),
		DeviceID:        deviceID,
		Lockdown:        a.St.Lockdown(),
		GatewayKey:      a.St.GatewayKey(),
		TZ:              nil, // v0 default UTC
		// The cached deny-list, read from durable local state
		// (docs/GRANT-REVOCATION.md). Bound here rather than passed as data so
		// a redemption late in a long-running process sees the list as it is
		// NOW, not as it was when the Env was first built — a `revoke` that
		// arrived a second ago must already count.
		//
		// `now` is captured once above and closed over, so an entry's expiry is
		// compared against the same instant the validity window is. Reading the
		// clock again in here would let a redemption straddle two instants —
		// harmless today, and the kind of thing that stops being harmless when
		// someone adds a second time-dependent step.
		Revoked: func(grantID string) bool {
			return a.St.RevokedAt(grantID, now)
		},
	}
}

// OnRedeemed durably records the grant_redeemed audit event BEFORE
// actuating the relay, then actuates, then records "opened".
//
// Ordering (the defect fix): actuating first and recording after leaves a
// window — a crash, power loss, or (see below) a full audit queue between
// the two steps — where the gate has physically opened with zero durable
// trace. Recording first closes that window for the common case: by the
// time the relay is asked to move, the authorization that justified moving
// it is already on durable storage (or, worst case, we know it is NOT and
// can say so loudly).
//
// Safety tradeoff when the reserved grant-event partition is itself full
// (proto/events.md's "reserved partition full" gap — needs on the order of
// a thousand undelivered offline opens, already an extreme, extended
// outage): this is the OFFLINE EMERGENCY access path. By construction
// there is no gateway reachable to fall back to, so refusing to open here
// trades "audit gap" for "person stranded outside a gate during a real
// emergency" — a strictly worse failure mode for a physical access system.
// We do NOT fail-closed on a full/unwritable audit queue. Instead
// RecordGrantRedeemed (via events.Queue.EnqueueGrantRedeemed) degrades in
// two steps before giving up: (1) the reserved partition, normally: (2) an
// always-on local overflow log if the reserved partition is full — so even
// the "partition full" case still leaves a durable, operator-recoverable
// trace on the device without blocking the open. Only if BOTH of those
// durable writes fail (e.g. the filesystem itself is unwritable — a rarer
// and more severe condition than "1000 undelivered offline opens") does
// this fall through with literally no audit record; even then the gate
// still opens, and the failure is logged as loudly as this package can
// manage, because an unaudited-but-granted open is judged the safer
// outcome here than a stranded resident. If this tradeoff is ever
// revisited, treat it as a product decision (see proto/events.md), not
// something to silently flip in code.
// OnDenied records a refusal of a grant whose signature verified.
//
// proto/events.md lists `denied` as the kind that drives security alerting, and
// until this existed the grant path emitted one only for a hardware failure
// AFTER verification passed. A refusal — wrong gate, outside its window,
// expired, and now revoked — left no trace anywhere. The person whose access
// was taken away stands at the gate, is refused, and an operator has no record
// it happened, which is precisely the event they would most want.
//
// Best-effort, like the config report and for the same reason: a refusal has
// already been returned to the caller and the gate is already shut. Failing to
// record it must not change that.
//
// Only ATTRIBUTABLE refusals reach here — the exchange sets no grant id until
// the signature has verified — so this cannot be used to flood the audit ring
// from outside. See grants.HandleProof's header.
func (a *Agent) OnDenied(grantID, reason string) {
	if a.Recorder == nil {
		return
	}
	a.Recorder.Record("denied", map[string]any{"reason": reason, "ref": grantID})
}

func (a *Agent) OnRedeemed(g *grants.Grant, p *grants.Proof) {
	if err := a.Recorder.RecordGrantRedeemed(map[string]any{
		"grant_id":     g.GrantID,
		"cnonce":       p.Cnonce,
		"access_point": p.AccessPoint,
		"proof_sig":    p.Sig,
	}); err != nil {
		a.Log.Error("grant_redeemed UNRECORDED on both the reserved partition and the overflow log — "+
			"proceeding with actuation anyway (offline emergency access path; see proto/events.md)",
			"err", err, "grant_id", g.GrantID)
	}

	cfg := a.St.Config()
	pulse := int64(command.DefaultPulseMs)
	if v, ok := cfg["pulse_ms"]; ok && v > 0 {
		pulse = v
	}
	if err := a.Relay.Pulse(time.Duration(pulse) * time.Millisecond); err != nil {
		a.Log.Error("grant actuation failed", "err", err)
		a.Recorder.Record("denied", map[string]any{"reason": "hw:" + err.Error(), "ref": g.GrantID})
		return
	}
	a.Recorder.Record("opened", map[string]any{"cause": "grant", "ref": g.GrantID})
}

// Run pairs if needed, then runs the hub transport, the LAN grant
// listener and (if enabled and available) the BLE peripheral until ctx ends.
func (a *Agent) Run(ctx context.Context) error {
	if err := a.EnsurePaired(ctx); err != nil {
		return err
	}
	fw := a.Opts.Firmware
	if fw == "" {
		fw = "0.1.0"
	}
	a.Recorder.Record("boot", map[string]any{"fw": fw, "reason": "start"})

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	errc := make(chan error, 3)

	if a.Opts.LANAddr != "" {
		// The ONE browser origin allowed to read the LAN redemption
		// responses: the console of the hub this controller paired with.
		// Unpaired means empty means no browser access at all — the state
		// every controller was in before this existed. See lanserver/cors.go.
		allowOrigin := ""
		if p := a.St.Pairing(); p != nil {
			allowOrigin = lanserver.OriginFromWSURL(p.WSURL)
		}
		lan := &lanserver.Server{
			DeviceID: a.Recorder.DeviceID, Exchange: a.Exchange,
			Env: a.GrantEnv, OnRedeemed: a.OnRedeemed, OnDenied: a.OnDenied, Log: a.Log,
			AllowOrigin: allowOrigin,
		}
		go func() { errc <- lan.Serve(ctx, a.Opts.LANAddr) }()
	}
	// The gate-left-open watcher. Started only when the relay also implements
	// Sensors, which the GPIO driver does and the mock does as "no sensor
	// present" — so on a build with no sensor this returns immediately.
	if sensors, ok := a.Relay.(relay.Sensors); ok && a.Opts.HeldOpenAfter > 0 {
		w := &heldOpenWatcher{
			sensors:   sensors,
			record:    a.Recorder.Record,
			threshold: a.Opts.HeldOpenAfter,
			interval:  5 * time.Second,
			now:       time.Now,
		}
		go w.run(ctx)
	}

	bleEnabled := true // default on; `config` {"ble_enabled": 0} disables
	if v, ok := a.St.Config()["ble_enabled"]; ok && v == 0 {
		bleEnabled = false
	}
	if a.Opts.EnableBLE && bleEnabled {
		go func() {
			err := bleperiph.Start(ctx, bleperiph.Config{
				DeviceID: a.Recorder.DeviceID, Exchange: a.Exchange,
				Env: a.GrantEnv, OnRedeemed: blesession.Redeemed(a.OnRedeemed),
				OnDenied: blesession.Denied(a.OnDenied),
			})
			if errors.Is(err, bleperiph.ErrUnsupported) {
				a.Log.Warn("ble peripheral unavailable", "err", err)
				return
			}
			errc <- err
		}()
	}
	runner := &transport.Runner{
		Priv: a.ID.Private(), St: a.St, Proc: a.Proc, Queue: a.Queue,
		Clock: a.Clock, Log: a.Log, AllowInsecure: a.Opts.AllowInsecure,
		Firmware: a.Opts.Firmware,
	}
	go func() { errc <- runner.Run(ctx) }()

	select {
	case <-ctx.Done():
		return nil
	case err := <-errc:
		if err != nil && ctx.Err() == nil {
			return fmt.Errorf("agent: %w", err)
		}
		return nil
	}
}
