// Package command implements the controller-side, fail-closed processing of
// signed command envelopes per proto/commands.md: verification in the
// normative order (sig → addressing → validity window → nonce replay →
// lockdown matrix), actuation through the relay seam, the signed cmd.ack,
// and denied/opened/closed events. Never "open on doubt".
package command

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/vul-os/aql/controller/internal/clock"
	"github.com/vul-os/aql/controller/internal/relay"
	"github.com/vul-os/aql/controller/internal/state"
	"github.com/vul-os/aql/controller/internal/wire"
)

// Defaults for actuation config (overridable via the `config` command).
const (
	DefaultPulseMs = 700
	DefaultHoldMax = 1800
	// DefaultDebounce is deliberately absent. It existed here unused, next to two
	// defaults that ARE resolved, which read as "sensor_debounce_ms is an
	// actuation setting like the others". It is not: the debounce that applies is
	// a property of the relay wiring (-relay …,sensor-debounce=20ms, parsed into
	// relay.Spec), and `config` merely accepts and stores the key. A default for
	// a value nothing resolves is a default that will one day be reported as
	// being in effect.
	ResultOK        = "ok" // success result for non-actuation commands, see README
	ResultOpened    = "opened"
	ResultHeld      = "held"
	ResultClosed    = "closed"
	ResultDenied    = "denied"
	ResultError     = "error"
	DetailRepairBad = "repair_invalid" // additive detail: malformed repair payload
	DetailConfigBad = "config_invalid" // additive detail: malformed config payload
	DetailRevokeBad = "revoke_invalid" // additive detail: malformed revoke payload
	// DetailRevokeStale: the list is not newer than the stored one. Reported
	// rather than swallowed as success — an operator seeing this repeatedly is
	// seeing either an attacker replaying an old list or a hub that reset its
	// counter, and both need saying out loud (docs/GRANT-REVOCATION.md §3.5).
	DetailRevokeStale = "revoke_stale"
)

// NonceStore is the persistent replay store seam (internal/noncestore in
// production; a temp-dir store in tests).
type NonceStore interface {
	Seen(nonce string) bool
	// MarkIfUnseen durably records an accepted nonce and reports whether THIS
	// call recorded it. false means someone else did first — a replay.
	//
	// The check and the record have to be one operation. Seen() runs early so a
	// command refused for lockdown does not burn its nonce, and the record runs
	// only on acceptance; across two lock acquisitions, two verifications of the
	// same envelope can both pass Seen() and both record, and both open the
	// gate. Any error must cause rejection (fail-closed).
	MarkIfUnseen(nonce string, keepUntil, now int64) (bool, error)
}

// EventRecorder queues signed audit events (internal/events.Recorder).
type EventRecorder interface {
	Record(kind string, data map[string]any)
}

// Context is everything the fail-closed envelope decision needs beyond the
// envelope itself.
type Context struct {
	Now          int64
	DeviceID     string
	AccessPoints []string
	Lockdown     bool
	Nonces       NonceStore // nil fails closed
}

// Verify runs the complete verification of a raw command envelope in the
// normative order (first failure wins). On acceptance the nonce is durably
// recorded. Returns the parsed command, or *wire.Reject with the reported
// reason.
func Verify(pub ed25519.PublicKey, raw []byte, ctx Context) (*wire.Command, error) {
	// 1. Signature against the pinned gateway key (parse failures = badsig).
	if err := wire.VerifyRaw(pub, raw); err != nil {
		return nil, &wire.Reject{Reason: wire.ReasonBadSig}
	}
	var e wire.Command
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, &wire.Reject{Reason: wire.ReasonBadSig}
	}
	// 2. Addressed to this controller, at an access point it serves.
	if e.DeviceID != ctx.DeviceID {
		return nil, &wire.Reject{Reason: wire.ReasonWrongDevice}
	}
	if wire.NeedsAccessPoint[e.Cmd] {
		served := false
		for _, ap := range ctx.AccessPoints {
			if ap == e.AccessPoint && ap != "" {
				served = true
				break
			}
		}
		if !served {
			return nil, &wire.Reject{Reason: wire.ReasonWrongAccessPoint}
		}
	}
	// 3. Validity window: iat ≤ exp, exp − iat ≤ 60, ±90 s skew on BOTH bounds.
	if e.IAT > e.EXP || e.EXP-e.IAT > wire.MaxCommandWindowSeconds {
		return nil, &wire.Reject{Reason: wire.ReasonWindowTooLong}
	}
	if ctx.Now < e.IAT-wire.ClockSkewSeconds {
		return nil, &wire.Reject{Reason: wire.ReasonNotYetValid}
	}
	if ctx.Now > e.EXP+wire.ClockSkewSeconds {
		return nil, &wire.Reject{Reason: wire.ReasonExpired}
	}
	// 4. Nonce never seen before (nil/empty/full store fails closed).
	if ctx.Nonces == nil || e.Nonce == "" || ctx.Nonces.Seen(e.Nonce) {
		return nil, &wire.Reject{Reason: wire.ReasonReplay}
	}
	// 5. Lockdown matrix.
	if ctx.Lockdown && !wire.LockdownAllowed[e.Cmd] {
		return nil, &wire.Reject{Reason: wire.ReasonLockdown}
	}
	// Record the nonce durably, and only if this call is the one that recorded
	// it. A false here means a concurrent verification of the same envelope got
	// there first; both would otherwise be accepted and the command would
	// actuate twice. Any error rejects, fail-closed.
	fresh, err := ctx.Nonces.MarkIfUnseen(e.Nonce, e.EXP+wire.ClockSkewSeconds, ctx.Now)
	if err != nil || !fresh {
		return nil, &wire.Reject{Reason: wire.ReasonReplay}
	}
	return &e, nil
}

// Processor wires verification to actuation, acks and events.
type Processor struct {
	Priv   ed25519.PrivateKey // controller signing key (acks)
	State  *state.Store
	Nonces NonceStore
	Clock  clock.Clock
	Relay  relay.Relay
	Events EventRecorder // may be nil (sim dry runs)
	Log    *slog.Logger
	// SyncClock, when non-nil, is called with the hub's iat on every
	// accepted ping (drift correction; proto/commands.md `ping`).
	SyncClock func(ts int64)

	// holdMu guards holdTimer and holdGen, which are touched from two
	// goroutines: the command path schedules and cancels, and the timer's own
	// callback checks whether it is still the current one.
	holdMu    sync.Mutex
	holdTimer *time.Timer
	// holdGen invalidates a callback that has already started.
	//
	// time.Timer.Stop() does not wait for a callback that is already running,
	// and it returns false in exactly that case. cancelRelease ignored the
	// return, so a release in flight landed anyway: measured, five runs out of
	// five, by cancelling at the moment of expiry.
	//
	// What that costs on a gate: a hold is running, a new open arrives as it
	// expires, the command path cancels and pulses — and the old callback
	// releases the gate that was just opened, with the ack already sent saying
	// the open succeeded. A gate that shuts on its own, and an audit trail that
	// says it opened.
	holdGen uint64
}

// Process verifies and executes one raw command envelope, returning the
// signed cmd.ack wire JSON. It never actuates on a failed check and always
// returns an ack (denied/error) when the envelope could be parsed at all.
func (p *Processor) Process(raw []byte) ([]byte, error) {
	log := p.Log
	if log == nil {
		log = slog.Default()
	}
	pairing := p.State.Pairing()
	if pairing == nil {
		return nil, fmt.Errorf("command: not paired")
	}
	pub := p.State.GatewayKey()
	now := p.Clock.Now()
	ctx := Context{
		Now:          now,
		DeviceID:     pairing.DeviceID,
		AccessPoints: p.State.AccessPoints(),
		Lockdown:     p.State.Lockdown(),
		Nonces:       p.Nonces,
	}
	cmd, err := Verify(pub, raw, ctx)
	if err != nil {
		reason := wire.ReasonBadSig
		if rej, ok := err.(*wire.Reject); ok {
			reason = rej.Reason
		}
		// Best-effort nonce for the ack/event ref (unverified envelope).
		var probe struct {
			Nonce string `json:"nonce"`
		}
		_ = json.Unmarshal(raw, &probe)
		log.Warn("command denied", "reason", reason, "nonce", probe.Nonce)
		p.record("denied", map[string]any{"reason": reason, "ref": probe.Nonce})
		return p.ack(pairing.DeviceID, probe.Nonce, ResultDenied, reason, now)
	}

	result, detail := p.execute(cmd, now)
	if result == ResultDenied || result == ResultError {
		p.record("denied", map[string]any{"reason": detail, "ref": cmd.Nonce})
	}
	log.Info("command", "cmd", cmd.Cmd, "result", result, "detail", detail)
	return p.ack(pairing.DeviceID, cmd.Nonce, result, detail, p.Clock.Now())
}

func (p *Processor) execute(cmd *wire.Command, now int64) (result, detail string) {
	cfg := p.State.Config()
	cfgInt := func(k string, def int64) int64 {
		if v, ok := cfg[k]; ok && v > 0 {
			return v
		}
		return def
	}
	switch cmd.Cmd {
	case "open":
		d := time.Duration(cfgInt("pulse_ms", DefaultPulseMs)) * time.Millisecond
		if err := p.Relay.Pulse(d); err != nil {
			return ResultError, "hw:" + err.Error()
		}
		p.record("opened", map[string]any{"cause": "cmd", "ref": cmd.Nonce})
		return ResultOpened, ""
	case "hold":
		if err := p.Relay.Hold(); err != nil {
			return ResultError, "hw:" + err.Error()
		}
		holdMax := cfgInt("hold_max", DefaultHoldMax)
		secs := holdMax
		if v, ok := numField(cmd.Payload, "seconds"); ok && v > 0 && v < holdMax {
			secs = v
		}
		p.scheduleRelease(time.Duration(secs) * time.Second)
		p.record("opened", map[string]any{"cause": "cmd", "ref": cmd.Nonce})
		return ResultHeld, ""
	case "close":
		p.cancelRelease()
		if err := p.Relay.Release(); err != nil {
			return ResultError, "hw:" + err.Error()
		}
		p.record("closed", map[string]any{"cause": "cmd", "ref": cmd.Nonce})
		return ResultClosed, ""
	case "lockdown":
		if err := p.State.SetLockdown(true); err != nil {
			return ResultError, "hw:persist"
		}
		return ResultOK, ""
	case "lift":
		if err := p.State.SetLockdown(false); err != nil {
			return ResultError, "hw:persist"
		}
		return ResultOK, ""
	case "ping":
		if p.SyncClock != nil {
			p.SyncClock(cmd.IAT)
		}
		return ResultOK, ""
	case "config":
		kv := map[string]int64{}
		for k, v := range cmd.Payload {
			n, ok := numField(cmd.Payload, k)
			if !ok || n < 0 {
				return ResultError, DetailConfigBad
			}
			kv[k] = n
			_ = v
		}
		if err := p.State.MergeConfig(kv); err != nil {
			return ResultError, "hw:persist"
		}
		return ResultOK, ""
	case "revoke":
		// Replace the cached offline-grant deny-list
		// (docs/GRANT-REVOCATION.md, proto/commands.md § Revocation list).
		//
		// The envelope is already verified against the pinned hub key before
		// dispatch, so this parses trusted bytes. What it must NOT do is trust
		// the ORDER they arrived in — see SetRevocations' seq rule.
		seq, ok := numField(cmd.Payload, "seq")
		if !ok || seq <= 0 {
			return ResultError, DetailRevokeBad
		}
		issued, _ := numField(cmd.Payload, "issued_at")
		raw, ok := cmd.Payload["entries"]
		if !ok {
			return ResultError, DetailRevokeBad
		}
		list, err := parseRevocations(raw)
		if err != nil {
			return ResultError, DetailRevokeBad
		}
		if err := p.State.SetRevocations(state.RevocationList{
			Seq: seq, IssuedAt: issued, Entries: list,
		}, p.Clock.Now()); err != nil {
			if errors.Is(err, state.ErrRevocationRollback) {
				return ResultError, DetailRevokeStale
			}
			return ResultError, "hw:persist"
		}
		return ResultOK, ""
	case "repair":
		next, _ := cmd.Payload["next_pubkey"].(string)
		if next == "" {
			return ResultError, DetailRepairBad
		}
		if err := p.State.ApplyRepair(next); err != nil {
			return ResultError, DetailRepairBad
		}
		return ResultOK, ""
	default:
		// Unknown commands are additive: acknowledge without actuating.
		return ResultError, "unknown_cmd"
	}
}

func (p *Processor) scheduleRelease(d time.Duration) {
	p.holdMu.Lock()
	p.stopLocked()
	p.holdGen++
	gen := p.holdGen
	p.holdTimer = time.AfterFunc(d, func() {
		// The generation check and the release happen under ONE lock.
		//
		// Checking under the lock and releasing outside it is not enough, and
		// that version failed under -race: the callback read "still current",
		// dropped the lock, a cancel landed, and the release went to the relay
		// anyway. Check-then-act with the act outside the lock is not a check.
		//
		// So cancelRelease is authoritative from the moment it returns: either
		// the release already reached the relay before it took the lock, or it
		// never will. The cost is that a cancel can wait for one relay write —
		// microseconds of GPIO ioctl — which is the right trade against a gate
		// that closes by itself.
		p.holdMu.Lock()
		if gen != p.holdGen {
			p.holdMu.Unlock()
			return
		}
		err := p.Relay.Release()
		p.holdMu.Unlock()

		// Recording is outside: it can fsync, and holding the lock across that
		// would stall the command path on disk.
		if err == nil {
			p.record("closed", map[string]any{"cause": "cmd", "ref": "hold_max"})
		}
	})
	p.holdMu.Unlock()
}

func (p *Processor) cancelRelease() {
	p.holdMu.Lock()
	p.stopLocked()
	// Bump even when there is no timer: a callback already running holds no
	// reference to holdTimer, and this is the only thing that stops it.
	p.holdGen++
	p.holdMu.Unlock()
}

// stopLocked stops the timer if there is one. Callers hold holdMu.
func (p *Processor) stopLocked() {
	if p.holdTimer != nil {
		p.holdTimer.Stop()
		p.holdTimer = nil
	}
}

func (p *Processor) record(kind string, data map[string]any) {
	if p.Events != nil {
		p.Events.Record(kind, data)
	}
}

func (p *Processor) ack(deviceID, nonce, result, detail string, ts int64) ([]byte, error) {
	return wire.SignAck(p.Priv, &wire.Ack{
		V: wire.Version, Typ: "cmd.ack",
		DeviceID: deviceID, Nonce: nonce,
		Result: result, Detail: detail, TS: ts,
	})
}

// numField extracts an integral number from a decoded JSON payload map.
func numField(m map[string]any, k string) (int64, bool) {
	switch v := m[k].(type) {
	case float64:
		return int64(v), true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	case int64:
		return v, true
	default:
		return 0, false
	}
}

// ResolvedConfig reports the actuation settings this controller will actually
// apply, for proto/commands.md's `ctl.report`.
//
// It answers the two questions a stored map cannot. "What will this gate do" is
// Value: the resolved number, defaults included, so a never-configured
// controller reports 700 rather than nothing. "Did my change land" is Source:
// a value that came from a `config` command reads differently from one that came
// from the firmware, and without that they are the same number.
//
// ONLY keys this package actually resolves appear. `config` accepts an open map
// and the controller stores whatever it is sent, so the stored map can contain
// keys nothing reads — sensor_debounce_ms is accepted, stored and ignored,
// because the debounce that applies belongs to the relay wiring rather than to
// configuration. Reporting a stored-but-unread key would tell an operator their
// setting is in effect when the gate is using a value from a command line they
// cannot see, which is the failure the report exists to prevent. Absence is the
// honest answer; see proto/commands.md "A key the controller does not resolve is
// not reported".
func ResolvedConfig(stored map[string]int64) map[string]wire.ConfigEntry {
	resolve := func(key string, def int64) wire.ConfigEntry {
		// Same rule cfgInt applies at actuation time: a non-positive stored
		// value is not an override, it is a value the actuation path ignores.
		if v, ok := stored[key]; ok && v > 0 {
			return wire.ConfigEntry{Value: v, Source: wire.SourceConfig}
		}
		return wire.ConfigEntry{Value: def, Source: wire.SourceDefault}
	}
	return map[string]wire.ConfigEntry{
		"pulse_ms": resolve("pulse_ms", DefaultPulseMs),
		"hold_max": resolve("hold_max", DefaultHoldMax),
	}
}

// parseRevocations reads the `entries` array of a `revoke` payload.
//
// Strict: an entry that is not an object, or carries no grant_id, fails the
// whole command rather than being skipped. A partially-applied deny-list is the
// worst outcome available here — the operator is told the revocation landed
// while some of it did not — so this refuses and reports, and the hub resends.
func parseRevocations(raw any) ([]state.Revocation, error) {
	arr, ok := raw.([]any)
	if !ok {
		return nil, errBadRevokePayload
	}
	out := make([]state.Revocation, 0, len(arr))
	for _, item := range arr {
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, errBadRevokePayload
		}
		id, ok := obj["grant_id"].(string)
		if !ok || id == "" {
			return nil, errBadRevokePayload
		}
		var exp int64
		if v, ok := numField(obj, "exp"); ok {
			exp = v
		}
		out = append(out, state.Revocation{GrantID: id, EXP: exp})
	}
	return out, nil
}

var errBadRevokePayload = errors.New("command: malformed revoke payload")
