package devices

import (
	"strings"
	"time"
)

// Kind is one of Aql's seven device kinds. It is presentational — it groups
// devices in the console and nothing authorises on it. Authority comes from
// capabilities and their tiers, because a "robot" that mows and a "robot" that
// vacuums are not the same risk and their kind cannot tell them apart.
type Kind string

const (
	KindCamera   Kind = "camera"
	KindLighting Kind = "lighting"
	KindRobot    Kind = "robot"
	KindClimate  Kind = "climate"
	KindEnergy   Kind = "energy"
	KindSensor   Kind = "sensor"
	// KindAccess is modelled but NOT driven through this package — see the
	// package doc. It exists so the console can render one list across all
	// seven kinds without a special case.
	KindAccess Kind = "access"
)

// KnownKind reports whether k is one of the seven. Fails closed: an unknown
// kind is rejected at ingest rather than stored and rendered as a blank.
func KnownKind(k Kind) bool {
	switch k {
	case KindCamera, KindLighting, KindRobot, KindClimate, KindEnergy, KindSensor, KindAccess:
		return true
	}
	return false
}

// Availability is what the engine currently believes about a device.
type Availability string

const (
	// AvailUnknown is the zero value: the engine has not heard from this
	// device since it started. Deliberately not "online" — a persisted device
	// whose driver has not reported yet must not render as live.
	AvailUnknown Availability = ""
	AvailOnline  Availability = "online"
	AvailOffline Availability = "offline"
	// AvailDegraded — reachable but not fully functional (a driver can say so).
	AvailDegraded Availability = "degraded"
)

// Device is the one internal representation every driver maps onto.
//
// The shape was chosen to match what the console already rendered at the time —
// the demo dataset's {id, name, kind, zone, state, read, detail, seen} — so that
// replacing that dataset with live data would be a data-source change and not a
// UI rewrite.
//
// That replacement has since happened: the console reads live engine state and
// the demo dataset -- `demoData.ts`, which had no
// replacement because it needed none -- is deleted. The shape held across the
// swap without a field being added or dropped, which is the evidence the
// constraint was worth accepting rather than a claim that it was.
type Device struct {
	// ID is unique within a driver. The registry namespaces it with the
	// driver id to form the globally-unique key it persists.
	ID   string
	Kind Kind
	Name string
	// Zone is a free-text room or area. Grouping only; never authorises.
	Zone string
	// Capabilities are catalogue ids (capability.go). A capability not in the
	// catalogue is rejected at registration — a driver cannot widen the verb
	// space by naming a capability nobody reviewed.
	Capabilities []CapabilityID

	Availability Availability
	// Summary is a short human-readable state for the console's list row
	// ("62% · warm", "charging · 81%"). Presentational; never parsed.
	Summary  string
	LastSeen time.Time
}

// Key is the globally-unique device key: driver id and device id joined. Used
// as the persisted primary key and as the id every API surface speaks.
func Key(driverID, deviceID string) string { return driverID + ":" + deviceID }

// ReservedDriverIDs are driver ids that other code reasons about BY NAME rather
// than by asking which driver produced a device. A configured driver may not
// take one.
//
// # Why a reservation rather than a convention
//
// Two places in this hub decide something about a device from the spelling of
// its key alone:
//
//   - httpapi's engine scope grants ownership of every `access:<id>` key to the
//     account owning the access point with that id, because gates are owned
//     through their location and have no device_ownership row; and
//   - store.AccountForDeviceKey routes any key with that prefix into the
//     access_points table, so it answers ownership WITHOUT the claim ceremony
//     that every other engine device goes through.
//
// Both are correct for the read-only `access` driver, which is a compile-time
// constant and never passes through here. Neither asks which driver produced
// the key, because at those layers there is no driver to ask — the store must
// not import a driver package, and the scope works from persisted keys.
//
// The driver id of every OTHER driver is config-supplied. So a hub operator
// naming an MQTT bridge `access` — an entirely natural name for a bridge to an
// access-control system — hands its devices derived ownership from the
// access_points table and a path around the claim ceremony, by string
// coincidence. Nothing else in the config would look wrong.
//
// Reserving the name is the cheap half of the fix. The expensive half would be
// teaching both sites to ask the registry which driver produced a key, which
// inverts a dependency the store deliberately does not have.
//
// If a third by-name site appears, its prefix belongs here too.
var ReservedDriverIDs = []string{"access"}

// ValidateDriverID checks a config-supplied driver id.
//
// It lives here, in the package that owns the key namespace, rather than in
// each driver: the rules are properties of the namespace, and four copies is
// how one of them ends up missing. It was — modbus documented the colon rule in
// its Config doc and enforced nothing, so `modbus:plantroom` was accepted and
// indexed its devices under a driver id ("modbus") that had a different one
// registered.
//
// Not called by accessdev, whose id is a constant rather than configuration and
// is the very name being reserved.
func ValidateDriverID(id string) error {
	if id == "" {
		return errInvalid("driver id is empty")
	}
	// The registry recovers a driver id by splitting a key at its FIRST colon,
	// so an id containing one indexes devices under a driver that was never
	// registered: they appear in the console and cannot be actuated. Whitespace
	// is refused with it because a key is spoken over HTTP and pasted into
	// consoles, where a trailing space is invisible and unequal.
	if strings.ContainsAny(id, ": \t\r\n") {
		return errInvalid("driver id %q must not contain ':' or whitespace; the registry "+
			"splits a device key at the first colon to recover the driver id", id)
	}
	for _, r := range ReservedDriverIDs {
		if id == r {
			return errInvalid("driver id %q is reserved: the hub decides ownership of "+
				"%q keys from the prefix alone, so a configured driver taking this name "+
				"would inherit access-point ownership it was never granted", id, Key(r, ""))
		}
	}
	return nil
}

// Has reports whether the device declares a capability.
func (d Device) Has(c CapabilityID) bool {
	for _, got := range d.Capabilities {
		if got == c {
			return true
		}
	}
	return false
}

// Supports resolves a verb against the device's own capabilities, returning the
// spec and the capability that provides it.
//
// The first capability declaring the verb wins, and the catalogue is written so
// that no device should ever hold two capabilities offering the same verb at
// different tiers — assertOneTierPerVerb in the tests enforces that across the
// whole catalogue, so this cannot silently pick the laxer of two.
func (d Device) Supports(v Verb) (VerbSpec, CapabilityID, bool) {
	for _, c := range d.Capabilities {
		if spec, ok := Lookup(c, v); ok {
			return spec, c, true
		}
	}
	return VerbSpec{}, "", false
}

// Validate checks a device a driver returned from Discover. Fails closed: an
// unknown kind, a missing id, or a capability outside the catalogue is a
// rejection, not a warning. A driver that could register an uncatalogued
// capability could smuggle in an untiered verb.
func (d Device) Validate() error {
	if d.ID == "" {
		return errInvalid("device id is empty")
	}
	if !KnownKind(d.Kind) {
		return errInvalid("unknown kind %q for device %q", string(d.Kind), d.ID)
	}
	if len(d.Capabilities) == 0 {
		return errInvalid("device %q declares no capabilities", d.ID)
	}
	for _, c := range d.Capabilities {
		if _, ok := catalogue[c]; !ok {
			return errInvalid("device %q declares uncatalogued capability %q", d.ID, string(c))
		}
	}
	return nil
}
