package command_test

// What a controller may honestly report about itself.
//
// ResolvedConfig answers two questions a stored config map cannot. "What will
// this gate do" is the value with defaults applied — a never-configured
// controller runs on 700 ms, not on nothing. "Did my change land" is the source,
// because 700 from a config command and 700 from the firmware are the same
// number and different answers.

import (
	"testing"

	"github.com/vul-os/aql/controller/internal/command"
	"github.com/vul-os/aql/controller/internal/wire"
)

func TestResolvedConfigReportsDefaultsAsDefaults(t *testing.T) {
	got := command.ResolvedConfig(nil)

	pulse, ok := got["pulse_ms"]
	if !ok {
		t.Fatal("a never-configured controller reported no pulse_ms; it still has one and will use it")
	}
	if pulse.Value != command.DefaultPulseMs || pulse.Source != wire.SourceDefault {
		t.Errorf("pulse_ms = %+v, want {%d default}", pulse, command.DefaultPulseMs)
	}
	if hold := got["hold_max"]; hold.Value != command.DefaultHoldMax || hold.Source != wire.SourceDefault {
		t.Errorf("hold_max = %+v, want {%d default}", hold, command.DefaultHoldMax)
	}
}

func TestResolvedConfigMarksConfiguredValuesAsConfigured(t *testing.T) {
	got := command.ResolvedConfig(map[string]int64{"hold_max": 45})

	if hold := got["hold_max"]; hold.Value != 45 || hold.Source != wire.SourceConfig {
		t.Errorf("hold_max = %+v, want {45 config}", hold)
	}
	// The untouched key stays a default rather than disappearing.
	if pulse := got["pulse_ms"]; pulse.Value != command.DefaultPulseMs || pulse.Source != wire.SourceDefault {
		t.Errorf("pulse_ms = %+v, want the default", pulse)
	}
}

// The key the report must NOT carry.
//
// `config` accepts an open map, so the hub can send sensor_debounce_ms and the
// controller stores it — and nothing reads it, because the debounce that applies
// belongs to the relay wiring. Reporting it would tell an operator a setting is
// in effect while the gate uses a value from a command line they cannot see.
func TestResolvedConfigOmitsKeysNothingResolves(t *testing.T) {
	got := command.ResolvedConfig(map[string]int64{
		"pulse_ms":           700,
		"sensor_debounce_ms": 20,
		"something_invented": 1,
	})

	for _, k := range []string{"sensor_debounce_ms", "something_invented"} {
		if e, ok := got[k]; ok {
			t.Errorf(`the report carries %q as %+v.

It is stored and never read. Showing it as configured tells an operator their
setting is live when the gate is using something else entirely.`, k, e)
		}
	}
	if len(got) != 2 {
		t.Errorf("report carries %d keys, want exactly the 2 the controller resolves", len(got))
	}
}

// A stored value the actuation path would ignore must not be reported as in
// effect either. cfgInt takes an override only when it is positive, and the
// report has to agree with it or it describes a gate that does not exist.
func TestANonPositiveOverrideIsNotInEffect(t *testing.T) {
	for _, v := range []int64{0, -1} {
		got := command.ResolvedConfig(map[string]int64{"pulse_ms": v})
		if p := got["pulse_ms"]; p.Source != wire.SourceDefault || p.Value != command.DefaultPulseMs {
			t.Errorf("pulse_ms stored as %d reported %+v; actuation ignores it, so the report must too", v, p)
		}
	}
}
