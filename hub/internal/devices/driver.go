// Package devices is Aql's device engine: one internal device model, a
// driver-adapter seam that protocol adapters implement, and a registry that
// routes a capability verb to the driver that owns the device.
//
// # What this package is for
//
// Aql's device model has seven kinds — camera, lighting, robot, climate,
// energy, sensor and access. Exactly one of them, access, is driven end to end
// today by the hub's signed-command path to a paired controller. The other six
// have had no engine behind them at all. This package is that engine's seam.
//
// # What this package is NOT
//
// It does not drive access points. Gates, doors and barriers are actuated by
// the hub's existing signed Ed25519 path (internal/keys, internal/hub,
// internal/store's open-path choke point), which is conformance-tested against
// proto/vectors and is not routed through here. The model below can express
// access — CapBarrier and CapLock exist — so a future change could expose the
// controller as a Driver, but that is deliberately not done now: rewriting the
// one path that works, to prove a seam that has no other drivers yet, trades a
// tested system for a symmetry.
//
// # What a driver may assume
//
//   - Its methods are called concurrently. The registry does not serialise them.
//   - Context deadlines are honoured by the caller; a driver that blocks past
//     its context is a bug in the driver.
//   - Device ids it returns are stable across restarts for the same physical
//     device. The registry uses them to reconcile persisted state.
//
// # What a driver may NOT assume
//
//   - That it may define verbs. The verb set is closed (capability.go). A
//     driver declares which catalogue capabilities a device has; it cannot
//     invent a verb and it cannot choose a tier. A driver that could assign
//     tiers could mark a blade start as reversible.
//   - That a returned error is cosmetic. Execute returning non-nil means the
//     action did not happen, and the caller reports it as a failure. A driver
//     that cannot tell whether the action happened must return an error — see
//     ErrIndeterminate.
//   - That it will be asked to Discover only once.
package devices

import (
	"context"
	"errors"
	"time"
)

// Errors a driver may return, and which the registry distinguishes. Anything
// else is treated as a plain failure.
var (
	// ErrUnknownDevice — the driver does not own the id it was handed.
	ErrUnknownDevice = errors.New("devices: unknown device")
	// ErrUnsupported — the device exists but does not offer that verb.
	ErrUnsupported = errors.New("devices: verb not supported by device")
	// ErrUnreachable — the device could not be contacted. The action did NOT
	// happen.
	ErrUnreachable = errors.New("devices: device unreachable")
	// ErrIndeterminate — the driver cannot tell whether the action happened.
	// Distinct from ErrUnreachable on purpose: for a T3/T4 verb the honest
	// answer to a resident is "I don't know", not "it failed", and the two
	// warrant different copy and different retry behaviour.
	ErrIndeterminate = errors.New("devices: outcome indeterminate")
)

// Health is a driver's own report on itself.
type Health struct {
	OK bool
	// Detail is operator-facing text. It is shown in the console and must not
	// carry credentials, tokens or full addresses.
	Detail string
	// Since is when the current OK state began.
	Since time.Time
}

// Reading is one telemetry sample from a device.
type Reading struct {
	DeviceID string
	// Metric names what was read, using the capability's own vocabulary
	// ("level", "celsius", "kw", "percent").
	Metric string
	Value  float64
	// Text carries a non-numeric state where one is the honest representation
	// ("docked", "patrol", "locked"). Value is ignored when Text is set.
	Text string
	At   time.Time
}

// Driver is the seam. A protocol adapter implements this and nothing else, and
// it can live out of tree.
//
// (Protocol names are deliberately not enumerated here. scripts/check-feature-claims.mjs
// greps for them to detect a driver landing while the docs still say none exists,
// and prose naming a protocol as an example is exactly the false signal that
// makes such a tripwire get ignored.)
//
// Implementations must be safe for concurrent use.
type Driver interface {
	// ID is a stable, unique identifier for this driver instance, e.g. "mqtt"
	// or "modbus:plantroom". It prefixes the device ids the registry stores,
	// so it must not change across restarts for the same configuration.
	ID() string

	// Discover returns every device this driver currently knows about. It is
	// called at startup and may be called again; it must be idempotent and
	// must not actuate anything.
	Discover(ctx context.Context) ([]Device, error)

	// Execute performs one verb on one device. args carries the verb's single
	// numeric argument when its VerbSpec declares one; the registry has
	// already validated presence and range, so a driver need not re-check
	// bounds — but it MUST still refuse a verb the device does not offer, with
	// ErrUnsupported.
	//
	// Returning nil means the action happened. If that cannot be established,
	// return ErrIndeterminate rather than nil.
	Execute(ctx context.Context, deviceID string, v Verb, args map[string]float64) error

	// Read returns the current readings for a device. It must not actuate.
	Read(ctx context.Context, deviceID string) ([]Reading, error)

	// Health reports the driver's own state. It must not block on the network;
	// return the last known state instead.
	Health(ctx context.Context) Health
}

// Closer is implemented by drivers holding resources — a broker connection, a
// serial port. The registry calls Close on shutdown when present.
type Closer interface {
	Close() error
}
