package main

import (
	"strings"
	"testing"

	"github.com/vul-os/aql/hub/internal/devices"
	"github.com/vul-os/aql/hub/internal/devices/accessdev"
	"github.com/vul-os/aql/hub/internal/devices/camera"
	"github.com/vul-os/aql/hub/internal/devices/httpdev"
	"github.com/vul-os/aql/hub/internal/devices/modbus"
	"github.com/vul-os/aql/hub/internal/devices/mqtt"
	"github.com/vul-os/aql/hub/internal/store"
)

// No configured driver may take a driver id the hub reasons about by name.
//
// Two places decide a device's OWNER from the spelling of its key: the engine's
// HTTP scope, which grants every `access:<id>` key to the account owning the
// access point with that id, and store.AccountForDeviceKey, which answers such
// keys from the access_points table instead of device_ownership — around the
// claim ceremony every other engine device goes through. Neither can ask which
// driver produced the key: the store must not import a driver, and the scope
// works from persisted keys.
//
// The `access` driver's id is a compile-time constant, so those two are right
// about it. Every other driver id comes from the device config file, and
// `access` is an entirely natural name for a bridge to an access-control
// system. Naming one that gave its devices derived ownership from the
// access_points table by string coincidence, with nothing in the config looking
// wrong.
//
// This is the end-to-end version of that rule: it goes through the same
// buildDeviceDriver the hub calls at boot, not through the validator directly,
// because a rule enforced in a helper nothing calls is not enforced.
func TestNoConfiguredDriverMayClaimAReservedID(t *testing.T) {
	for _, reserved := range devices.ReservedDriverIDs {
		// Minimal-but-valid configs. If one of these were invalid for another
		// reason the driver would refuse for THAT reason and this test would
		// pass having proved nothing, which is why the assertion below names
		// the word "reserved" rather than merely checking for an error.
		file := deviceFile{
			HTTP:   &httpdev.Config{ID: reserved, Devices: []httpdev.DeviceConfig{{ID: "d1", Name: "d1", Kind: devices.KindLighting}}},
			Camera: &camera.Config{ID: reserved},
			MQTT:   &mqtt.Config{DriverID: reserved, BrokerAddr: "127.0.0.1:1883"},
			Modbus: &modbus.Config{ID: reserved, Devices: []modbus.DeviceConfig{{ID: "d1", Name: "d1", Kind: devices.KindSensor, Address: "127.0.0.1:502"}}},
		}
		for _, name := range []string{deviceDriverHTTP, deviceDriverCamera, deviceDriverMQTT, deviceDriverModbus} {
			h := &hub{}
			drv, err := h.buildDeviceDriver(name, file)
			if err == nil {
				if c, ok := drv.(devices.Closer); ok {
					_ = c.Close()
				}
				t.Errorf("driver %q accepted the reserved id %q; its devices would be keyed %q "+
					"and inherit access-point ownership they were never granted",
					name, reserved, devices.Key(reserved, "<device>"))
				continue
			}
			if !strings.Contains(err.Error(), "reserved") {
				t.Errorf("driver %q refused the reserved id %q, but for another reason: %v\n"+
					"That is not evidence the reservation holds — the config is meant to be "+
					"otherwise valid here.", name, reserved, err)
			}
		}
	}
}

// A driver id containing a colon is refused by every configured driver.
//
// The registry recovers a driver id by splitting a device key at its FIRST
// colon, so `modbus:plantroom` indexes its devices under the driver id
// "modbus" — a driver that is either registered and different, or not
// registered at all. Either way the devices appear in the console's fleet and
// cannot be actuated, and nothing says why.
//
// Every one of these four Config docs stated this rule. Only three enforced it:
// modbus's New trimmed whitespace and never looked for a colon, so the
// paragraph in its doc describing the refusal described nothing. That is the
// regression this pins, and the reason the check now lives in one place.
func TestNoConfiguredDriverAcceptsAColonInItsID(t *testing.T) {
	const id = "modbus:plantroom" // shaped like the example in modbus's own doc
	file := deviceFile{
		HTTP:   &httpdev.Config{ID: id, Devices: []httpdev.DeviceConfig{{ID: "d1", Name: "d1", Kind: devices.KindLighting}}},
		Camera: &camera.Config{ID: id},
		MQTT:   &mqtt.Config{DriverID: id, BrokerAddr: "127.0.0.1:1883"},
		Modbus: &modbus.Config{ID: id, Devices: []modbus.DeviceConfig{{ID: "d1", Name: "d1", Kind: devices.KindSensor, Address: "127.0.0.1:502"}}},
	}
	for _, name := range []string{deviceDriverHTTP, deviceDriverCamera, deviceDriverMQTT, deviceDriverModbus} {
		h := &hub{}
		drv, err := h.buildDeviceDriver(name, file)
		if err == nil {
			if c, ok := drv.(devices.Closer); ok {
				_ = c.Close()
			}
			t.Errorf("driver %q accepted the id %q; its devices would be indexed under the "+
				"driver id %q and be listed but unactuatable", name, id, "modbus")
			continue
		}
		if !strings.Contains(err.Error(), "colon") {
			t.Errorf("driver %q refused %q for another reason: %v — not evidence the colon "+
				"rule holds", name, id, err)
		}
	}
}

// The reserved list must actually cover the prefix the store matches on.
//
// The list and the by-name sites are separate facts, and a reservation naming
// something nothing reasons about protects nothing. This is cmd/hub because it
// is the one package that imports the driver, the store and the device model.
func TestTheReservedListCoversTheStoresAccessPrefix(t *testing.T) {
	want := strings.TrimSuffix(store.AccessDeviceKeyPrefix, ":")
	found := false
	for _, r := range devices.ReservedDriverIDs {
		if r == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("store.AccountForDeviceKey decides ownership from the %q prefix, but %q is "+
			"not in devices.ReservedDriverIDs %v — a configured driver could take the name.",
			store.AccessDeviceKeyPrefix, want, devices.ReservedDriverIDs)
	}
	// And that the name reserved is the one the access driver actually uses,
	// rather than three constants agreeing about something none of them is.
	if accessdev.DriverID != want {
		t.Fatalf("the access driver's id is %q but %q is what is reserved", accessdev.DriverID, want)
	}
}
