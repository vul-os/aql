// Package accessdev presents access points to the device engine, read-only.
//
// It is step 2 of docs/ACCESS-ON-THE-ENGINE.md. Read that first; the decisions
// below are its decisions and this package does not get to change them.
//
// # What this is for
//
// A gate is the kind Aql is best at and the only one the console's device list
// structurally could not show, because access ran as a parallel stack. This
// driver puts the gate in the fleet beside the lamp, the meter and the camera.
// That is the whole of it.
//
// # What this deliberately does NOT do
//
// It does not open anything. `Execute` refuses every verb and names the path
// that does. Gates are actuated by the hub's signed Ed25519 route to a paired
// controller — conformance-tested against proto/vectors, carrying offline grants
// and key pinning, writing its audit row in the same transaction as the
// decision. None of that is improved by being reachable through a second door,
// and two actuation routes to a gate is strictly worse than one whatever the
// second one's quality: it doubles what has to stay correct, and the failure it
// invites — one route enforcing a rule the other does not — is silent.
//
// # Why the devices declare a status-only capability
//
// A device must declare at least one capability, so "declare nothing" is not
// available. Declaring CapBarrier or CapLock would be worse than it looks:
//
//   - The console would render an open button in front of a route that refuses.
//   - An automation rule could NAME an actuating access verb. It still could not
//     fire one — every access verb sits above MaxActionTier, pinned by a test in
//     internal/automations — but "cannot be named" and "is refused when named"
//     are different depths, and the cheaper one is free here.
//
// So these devices declare CapAccessStatus, whose only verb is `status` at
// TierRead. The engine can therefore never route an actuating access verb to
// anything, which keeps the defence the design in §2.1 expected to spend.
//
// # The source of truth is the database, not the config file
//
// Every other driver is built from -device-config. This one is not, and the
// asymmetry is deliberate: access points are created through the product, by
// people, and live in SQLite. Discover re-reads them; nothing is written back,
// so there is still exactly one source of truth for what gates exist.
package accessdev

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// DriverID is the driver id, and therefore the prefix of every device key this
// package produces: `access:<access_point_id>`.
//
// Access point ids are already stable across restarts, which is what the Driver
// contract requires. Deriving a key from the NAME would break the moment
// somebody renames a gate.
const DriverID = "access"

// AccessPoint is one access point as this driver needs it. Narrow on purpose:
// the package takes a function rather than a *store.Store so it cannot reach
// for authorisation state it has no business reading.
type AccessPoint struct {
	ID        string
	AccountID string
	Name      string
	Kind      string // gate | door | barrier | other
	DeviceID  string // paired controller; "" if none
	Status    string // active | disabled | …
}

// Config wires the driver to the hub without importing it.
type Config struct {
	// List returns every access point on the hub. Called on each Discover.
	List func(ctx context.Context) ([]AccessPoint, error)
	// Connected reports whether a paired controller currently holds a session,
	// and whether that is KNOWN.
	//
	// Two return values rather than one because "not connected" and "nobody is
	// tracking connections yet" are different facts and only one of them should
	// be shown to somebody looking at a gate. The device hub is constructed
	// after the engine is wired, so there is a real window at boot where the
	// answer is genuinely unknown, and a plain bool would have to report those
	// gates as offline — a wrong answer where an honest one exists.
	//
	// Optional: nil means never known.
	Connected func(controllerDeviceID string) (connected, known bool)
	Log       *slog.Logger
	// Now is swappable for tests.
	Now func() time.Time
}

// Driver is the read-only access adapter.
type Driver struct {
	cfg Config

	mu      sync.Mutex
	lastErr string
	lastOK  time.Time
}

// New builds the driver. List is required; a driver that cannot enumerate its
// devices has nothing to offer and should fail at construction rather than
// report an empty fleet, which reads identically to "you have no gates".
func New(cfg Config) (*Driver, error) {
	if cfg.List == nil {
		return nil, errors.New("accessdev: a List function is required")
	}
	if cfg.Log == nil {
		return nil, errors.New("accessdev: a logger is required")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Driver{cfg: cfg}, nil
}

// NewAccessDriver is New under the name the feature-claims manifest greps for.
// Kept so the guard that fails the day this package appears has something
// stable to match, whatever New is called later.
func NewAccessDriver(cfg Config) (*Driver, error) { return New(cfg) }

func (d *Driver) ID() string { return DriverID }

// Discover re-reads the access points and maps them onto engine devices.
func (d *Driver) Discover(ctx context.Context) ([]devices.Device, error) {
	aps, err := d.cfg.List(ctx)
	if err != nil {
		d.fail(err)
		return nil, fmt.Errorf("accessdev: list access points: %w", err)
	}
	now := d.cfg.Now()
	out := make([]devices.Device, 0, len(aps))
	for _, ap := range aps {
		out = append(out, devices.Device{
			ID:           ap.ID,
			Kind:         devices.KindAccess,
			Name:         ap.Name,
			Zone:         "",
			Capabilities: []devices.CapabilityID{devices.CapAccessStatus},
			Availability: d.availability(ap),
			Summary:      summarise(ap, d.availability(ap)),
			LastSeen:     now,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	d.succeed(now)
	return out, nil
}

// availability answers only what is actually known.
//
// An access point with no paired controller is AvailOffline: it exists in the
// product and nothing can reach it. One whose controller is connected is
// AvailOnline. Without a Connected function nobody is tracking sessions, and the
// answer is AvailUnknown rather than a guess — reporting `online` because a row
// exists would be asserting something nobody checked.
//
// AvailDegraded is deliberately never returned. It means reachable-and-not-
// working, and this driver cannot distinguish that from working: it never
// actuates, so it never learns that an actuation failed.
func (d *Driver) availability(ap AccessPoint) devices.Availability {
	if ap.DeviceID == "" {
		return devices.AvailOffline
	}
	if d.cfg.Connected == nil {
		return devices.AvailUnknown
	}
	connected, known := d.cfg.Connected(ap.DeviceID)
	if !known {
		return devices.AvailUnknown
	}
	if connected {
		return devices.AvailOnline
	}
	return devices.AvailOffline
}

// summarise builds the console's list-row text.
//
// It never claims to know whether the barrier is physically open. Most
// installations have no sensor on the gate, so "closed" would be an invention —
// and a status line that invents is worse on a gate than anywhere else in the
// product. What it reports is whether the thing that opens it can be reached.
func summarise(ap AccessPoint, avail devices.Availability) string {
	parts := []string{ap.Kind}
	switch {
	case ap.DeviceID == "":
		parts = append(parts, "no controller paired")
	case avail == devices.AvailOnline:
		parts = append(parts, "controller connected")
	case avail == devices.AvailUnknown:
		parts = append(parts, "controller pairing known, connection not tracked")
	default:
		parts = append(parts, "controller not connected")
	}
	if ap.Status != "" && ap.Status != "active" {
		parts = append(parts, ap.Status)
	}
	return strings.Join(parts, " · ")
}

// Read returns no readings.
//
// Not a stub: there is genuinely nothing here to measure. Whether a gate is open
// is not known without a sensor most installations do not have, and the one fact
// that IS known — can the controller be reached — is availability, which the
// engine already carries on the device. Inventing a reading to look complete is
// how a console ends up drawing a chart of a number nobody measured.
func (d *Driver) Read(ctx context.Context, deviceID string) ([]devices.Reading, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, nil
}

// ErrUseSignedPath is returned by Execute, always.
var ErrUseSignedPath = errors.New(
	"accessdev: access points are not actuated through the device engine — " +
		"use the signed open path (POST /v1/accounts/{id}/access-points/{apID}/open), " +
		"which verifies membership, time windows, geofences and quotas, signs the " +
		"command, and audits it in the same transaction as the decision")

// Execute refuses. Every verb, every device, unconditionally.
//
// Wrapped in devices.ErrUnsupported so the registry and the API classify it the
// way they classify any verb a device does not offer, rather than as a driver
// fault. In practice the registry rejects an actuating access verb before it
// reaches here, because these devices declare only CapAccessStatus — this is the
// second of those two, and it is here because a check that relies on someone
// else having already checked is not a check.
func (d *Driver) Execute(_ context.Context, deviceID string, v devices.Verb, _ map[string]float64) error {
	return fmt.Errorf("%w: %s on %s: %w", devices.ErrUnsupported, v, deviceID, ErrUseSignedPath)
}

// Health reports whether the last Discover could read the access points.
func (d *Driver) Health(context.Context) devices.Health {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.lastErr != "" {
		return devices.Health{OK: false, Detail: d.lastErr, Since: d.lastOK}
	}
	return devices.Health{OK: true, Detail: "access points readable", Since: d.lastOK}
}

// Close releases nothing: this driver owns no connection. Present because the
// registry may call it.
func (d *Driver) Close() error { return nil }

func (d *Driver) fail(err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.lastErr = err.Error()
	d.cfg.Log.Warn("accessdev: could not list access points", "err", err)
}

func (d *Driver) succeed(at time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.lastErr = ""
	d.lastOK = at
}
