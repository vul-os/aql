package devices

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MockDriver is the in-tree reference driver. It touches no network and is
// fully deterministic, so it can prove the seam in tests without hardware.
//
// It exists to answer one question honestly: can a second driver be written
// against this interface without changing the interface? Every method a real
// adapter must implement is implemented here, including the refusal paths —
// unknown device, unsupported verb, and an injectable failure so callers can
// exercise ErrUnreachable and ErrIndeterminate.
//
// It is NOT a demo-data source for the console. src/lib/demoData.ts still owns
// that, and the console marks it as demo at the point of use.
type MockDriver struct {
	id string

	mu      sync.Mutex
	devices map[string]Device
	state   map[string]map[string]float64
	text    map[string]string
	// FailWith, when set, is returned by Execute and Read for every device.
	// Lets a test drive the failure paths without a broken network.
	FailWith error
	// Calls records every Execute in order, for assertions.
	Calls []MockCall
	now   func() time.Time
}

// MockCall is one recorded Execute.
type MockCall struct {
	DeviceID string
	Verb     Verb
	Args     map[string]float64
}

// NewMockDriver returns a driver preloaded with one device of each of the six
// kinds this engine drives. Access is deliberately absent — access points are
// not routed through the device engine (see the package doc).
func NewMockDriver(id string) *MockDriver {
	m := &MockDriver{
		id:      id,
		devices: map[string]Device{},
		state:   map[string]map[string]float64{},
		text:    map[string]string{},
		now:     time.Now,
	}
	seed := []Device{
		{ID: "lamp-1", Kind: KindLighting, Name: "Garden Lights", Zone: "Exterior",
			Capabilities: []CapabilityID{CapDimmable}, Availability: AvailOnline, Summary: "62% · warm"},
		{ID: "mower-1", Kind: KindRobot, Name: "Mower", Zone: "Lawn",
			Capabilities: []CapabilityID{CapBladeJob}, Availability: AvailOnline, Summary: "docked"},
		{ID: "vac-1", Kind: KindRobot, Name: "Cleaning Bot", Zone: "Interior",
			Capabilities: []CapabilityID{CapJob}, Availability: AvailOnline, Summary: "docked"},
		{ID: "thermo-1", Kind: KindClimate, Name: "Thermostat", Zone: "Interior",
			Capabilities: []CapabilityID{CapSetpoint}, Availability: AvailOnline, Summary: "21.5°C"},
		{ID: "meter-1", Kind: KindEnergy, Name: "Energy Meter", Zone: "Utility",
			Capabilities: []CapabilityID{CapMeter}, Availability: AvailOnline, Summary: "2.41 kW"},
		{ID: "tank-1", Kind: KindSensor, Name: "Water Tank", Zone: "Utility",
			Capabilities: []CapabilityID{CapSensorReadCa}, Availability: AvailOnline, Summary: "level 12%"},
		{ID: "cam-1", Kind: KindCamera, Name: "Yard Camera", Zone: "Exterior",
			Capabilities: []CapabilityID{CapCameraStream}, Availability: AvailOnline, Summary: "1080p"},
	}
	for _, d := range seed {
		m.devices[d.ID] = d
		m.state[d.ID] = map[string]float64{}
	}
	m.state["lamp-1"]["level"] = 62
	m.state["thermo-1"]["celsius"] = 21.5
	m.state["meter-1"]["kw"] = 2.41
	m.state["tank-1"]["percent"] = 12
	m.text["mower-1"] = "docked"
	m.text["vac-1"] = "docked"
	return m
}

func (m *MockDriver) ID() string { return m.id }

func (m *MockDriver) Discover(_ context.Context) ([]Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Device, 0, len(m.devices))
	for _, d := range m.devices {
		d.LastSeen = m.now()
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (m *MockDriver) Execute(_ context.Context, deviceID string, v Verb, args map[string]float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailWith != nil {
		return m.FailWith
	}
	dev, ok := m.devices[deviceID]
	if !ok {
		return ErrUnknownDevice
	}
	// A driver MUST still refuse a verb its device does not offer, even though
	// the registry checked — a driver reachable by another path must not rely
	// on someone else's validation.
	if _, _, ok := dev.Supports(v); !ok {
		return ErrUnsupported
	}
	m.Calls = append(m.Calls, MockCall{DeviceID: deviceID, Verb: v, Args: args})
	switch v {
	case VerbOn:
		m.state[deviceID]["level"] = 100
	case VerbOff:
		m.state[deviceID]["level"] = 0
	case VerbSet:
		for k, val := range args {
			m.state[deviceID][k] = val
		}
	case VerbStart, VerbResume:
		m.text[deviceID] = "running"
	case VerbStop, VerbPause:
		m.text[deviceID] = "stopped"
	case VerbDock:
		m.text[deviceID] = "docked"
	}
	return nil
}

func (m *MockDriver) Read(_ context.Context, deviceID string) ([]Reading, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailWith != nil {
		return nil, m.FailWith
	}
	if _, ok := m.devices[deviceID]; !ok {
		return nil, ErrUnknownDevice
	}
	var out []Reading
	for metric, val := range m.state[deviceID] {
		out = append(out, Reading{DeviceID: deviceID, Metric: metric, Value: val, At: m.now()})
	}
	if t, ok := m.text[deviceID]; ok {
		out = append(out, Reading{DeviceID: deviceID, Metric: "state", Text: t, At: m.now()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Metric < out[j].Metric })
	return out, nil
}

func (m *MockDriver) Health(_ context.Context) Health {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailWith != nil {
		return Health{OK: false, Detail: "injected failure", Since: m.now()}
	}
	return Health{OK: true, Detail: "mock driver, no network", Since: m.now()}
}

// Drop removes a device, so a test can exercise disappearance across Refresh.
func (m *MockDriver) Drop(deviceID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.devices, deviceID)
}
