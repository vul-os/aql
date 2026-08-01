package devices

import "time"

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
