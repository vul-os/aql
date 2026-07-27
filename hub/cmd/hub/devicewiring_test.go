package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A driver package can be complete, tested and still unreachable, because
// nothing in the binary constructs it. That happened here: the MQTT driver had
// a full Driver implementation and a passing test suite for weeks while
// buildDeviceDriver knew only about http and camera, so no operator could turn
// it on. `go build` cannot catch that — an unused constructor in another
// package is not an error.
//
// This test is the check that would have caught it: every name the binary
// advertises must actually build something.
func TestEveryAdvertisedDriverCanBeConstructed(t *testing.T) {
	// Minimal valid config per driver. Kept here rather than in a fixture so
	// adding a driver to knownDeviceDrivers without adding a case fails loudly.
	configs := map[string]string{
		deviceDriverHTTP: `{"http":{"ID":"http","Devices":[{"ID":"d1","Name":"Lamp",
			"Kind":"lighting","Capabilities":["light.switch"],"AllowPlaintext":false}]}}`,
		deviceDriverCamera: `{"camera":{"ID":"camera","Cameras":[{"ID":"c1",
			"Name":"Gate cam","ServiceAddress":"https://cam.example/onvif/device_service"}]}}`,
		// The realistic zigbee2mqtt shape: a bridge owns the radio and
		// republishes a JSON object per device, and Field picks one value out.
		// A realistic meter: power as a float32 pair, energy as a uint32
		// counter — the shape almost every real Modbus device uses.
		deviceDriverModbus: `{"modbus":{"ID":"modbus","Devices":[{"ID":"meter-main",
			"Name":"Main incomer","Kind":"energy","Capabilities":["energy.meter"],
			"Address":"127.0.0.1:502","UnitID":1,
			"Reads":[{"Function":3,"Start":100,"Count":4,"Metrics":[
			  {"Metric":"kw","Address":100,"Type":"f32","Order":"abcd"},
			  {"Metric":"kwh","Address":102,"Type":"u32","Order":"abcd","Scale":0.01}]}]}]}}`,
		deviceDriverMQTT: `{"mqtt":{"DriverID":"mqtt","BrokerAddr":"broker.example:1883",
			"ClientID":"aql","CommandQoS":2,"Devices":[{"ID":"m1","Name":"Kitchen lamp","Kind":"lighting","Capabilities":["light.dimmable"],
			"State":[{"Topic":"zigbee2mqtt/kitchen-lamp","Metric":"brightness",
			"Field":"brightness"}]}]}}`,
	}

	for _, name := range knownDeviceDrivers() {
		raw, ok := configs[name]
		if !ok {
			t.Errorf("driver %q is advertised by knownDeviceDrivers but this test has "+
				"no config for it; add one so the name is proven to build something", name)
			continue
		}
		path := filepath.Join(t.TempDir(), "devices.json")
		if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
			t.Fatal(err)
		}
		file, err := loadDeviceFile(path)
		if err != nil {
			t.Errorf("driver %q: config did not parse: %v", name, err)
			continue
		}
		d, err := buildDeviceDriver(name, file)
		if err != nil {
			t.Errorf("driver %q is advertised but does not build: %v", name, err)
			continue
		}
		if d == nil {
			t.Errorf("driver %q built a nil driver", name)
			continue
		}
		if d.ID() == "" {
			t.Errorf("driver %q has no id", name)
		}
		// Constructing must not leave a connection behind that outlives the
		// test. Close is not on the Driver interface — a driver that holds no
		// resources needs none — so shut down whichever ones do.
		if c, ok := d.(io.Closer); ok {
			if err := c.Close(); err != nil {
				t.Errorf("driver %q: Close: %v", name, err)
			}
		}
	}
}

// The flag parser and the constructor must agree. A name accepted by one and
// refused by the other is an operator setting a flag that silently does
// nothing.
func TestAdvertisedNamesAreExactlyTheAcceptedNames(t *testing.T) {
	known := knownDeviceDrivers()
	enabled, unknown := resolveDeviceDrivers(strings.Join(known, ","))
	if len(unknown) != 0 {
		t.Errorf("resolveDeviceDrivers refused advertised names: %v", unknown)
	}
	if len(enabled) != len(known) {
		t.Errorf("advertised %d drivers, %d resolved: %v", len(known), len(enabled), enabled)
	}
	if _, unknown := resolveDeviceDrivers("definitely-not-a-driver"); len(unknown) != 1 {
		t.Error("an unknown driver name was accepted")
	}
}
