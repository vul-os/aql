package relay

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// These tests run in EVERY build, which is the point of spec.go having no build
// tag. The GPIO ioctls are Linux-only and rightly gated, but the thing an
// operator gets wrong is not an ioctl — it is a line number read off a wiring
// diagram at a gate, once, in the dark.

func TestParsesTheFormsAnOperatorTypes(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want Spec
	}{
		{"/dev/gpiochip0:17", Spec{Chip: "/dev/gpiochip0", Line: 17, BiasName: "default"}},
		{"/dev/gpiochip0:17,active-low", Spec{Chip: "/dev/gpiochip0", Line: 17, ActiveLow: true, BiasName: "default"}},
		{"/dev/gpiochip1:3,bias=pull-up", Spec{Chip: "/dev/gpiochip1", Line: 3, BiasName: "pull-up"}},
		{
			"/dev/gpiochip0:17,sensor=27,sensor-active-low,sensor-debounce=20ms",
			Spec{
				Chip: "/dev/gpiochip0", Line: 17, BiasName: "default",
				HasSensor: true, SensorLine: 27, SensorActiveLow: true,
				SensorDebounce: 20 * time.Millisecond,
			},
		},
		// Whitespace is what a copy-paste out of a wiki leaves behind.
		{"  /dev/gpiochip0:17 , active-low ", Spec{Chip: "/dev/gpiochip0", Line: 17, ActiveLow: true, BiasName: "default"}},
	} {
		got, err := ParseSpec(tc.in)
		if err != nil {
			t.Errorf("%q: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%q:\n got %+v\nwant %+v", tc.in, got, tc.want)
		}
	}
}

// Every failure is a refusal, never a default. A line number that silently
// became 0 would drive whatever is wired to line 0 — on a Pi that is a real pin.
func TestEveryMalformedSpecIsRefused(t *testing.T) {
	for _, tc := range []struct{ name, in string }{
		{"no line number", "/dev/gpiochip0"},
		{"empty line", "/dev/gpiochip0:"},
		{"non-numeric line", "/dev/gpiochip0:seventeen"},
		{"negative line", "/dev/gpiochip0:-1"},
		{"implausible line", "/dev/gpiochip0:99999"},
		{"no chip", ":17"},
		// A relative path resolves against the working directory, which for a
		// service unit is not where /dev is.
		{"relative chip path", "gpiochip0:17"},
		{"unknown option", "/dev/gpiochip0:17,activelow"},
		{"unknown bias", "/dev/gpiochip0:17,bias=floating"},
		{"active-low with a value", "/dev/gpiochip0:17,active-low=true"},
		{"duplicate option", "/dev/gpiochip0:17,active-low,active-low"},
		{"sensor on the relay's own line", "/dev/gpiochip0:17,sensor=17"},
		{"sensor option without a sensor", "/dev/gpiochip0:17,sensor-active-low"},
		{"sensor debounce without a sensor", "/dev/gpiochip0:17,sensor-debounce=20ms"},
		{"bad debounce", "/dev/gpiochip0:17,sensor=27,sensor-debounce=soon"},
	} {
		if _, err := ParseSpec(tc.in); err == nil {
			t.Errorf("%s: %q was accepted", tc.name, tc.in)
		}
	}
}

// A typo'd option must not be ignored. An operator who wrote `activelow` and
// was not told believes the drive is inverted when it is not — which on a gate
// means energising the relay to CLOSE it.
func TestATypoIsRefusedRatherThanIgnored(t *testing.T) {
	_, err := ParseSpec("/dev/gpiochip0:17,activelow")
	if err == nil {
		t.Fatal("a misspelled option was silently ignored")
	}
	if !strings.Contains(err.Error(), "activelow") {
		t.Errorf("the error does not name the offending option: %v", err)
	}
}

// No relay configured is not an error — it is how someone asks for the mock —
// but it must be distinguishable so a caller cannot treat an empty Spec as
// valid.
func TestAbsentSpecIsItsOwnSignal(t *testing.T) {
	for _, in := range []string{"", "   "} {
		_, err := ParseSpec(in)
		if !errors.Is(err, ErrNoSpec) {
			t.Errorf("ParseSpec(%q) = %v, want ErrNoSpec", in, err)
		}
	}
}

// A spec must survive a round trip, because String() is what gets logged at
// startup and an operator confirms their wiring against it. A renderer that
// dropped active-low would show a correct-looking line for an inverted relay.
func TestStringRoundTrips(t *testing.T) {
	for _, in := range []string{
		"/dev/gpiochip0:17",
		"/dev/gpiochip0:17,active-low",
		"/dev/gpiochip0:17,bias=pull-down",
		"/dev/gpiochip0:17,active-low,bias=pull-up,sensor=27,sensor-active-low,sensor-debounce=20ms",
	} {
		first, err := ParseSpec(in)
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		second, err := ParseSpec(first.String())
		if err != nil {
			t.Fatalf("%q rendered as %q, which does not parse: %v", in, first.String(), err)
		}
		if first != second {
			t.Errorf("%q did not round trip:\n first %+v\nsecond %+v", in, first, second)
		}
	}
}

// The rule the whole file exists for.
//
// In a build without `-tags gpio`, a configured relay must produce an ERROR.
// The tempting alternative — warn and use the mock — acks the command, has the
// hub write an `opened` row into a hash-chained audit trail, tells the resident
// the gate opened, and moves nothing.
func TestAConfiguredRelayNeverSilentlyBecomesTheMock(t *testing.T) {
	s, err := ParseSpec("/dev/gpiochip0:17")
	if err != nil {
		t.Fatal(err)
	}
	r, err := OpenSpec(s, nil)

	if GPIOAvailable {
		// With the tag, opening a chip that does not exist on this machine must
		// still fail rather than degrade.
		if err == nil {
			t.Skip("a real /dev/gpiochip0 exists on this host; nothing to assert")
		}
		if r != nil {
			t.Fatal("OpenSpec returned a relay alongside an error")
		}
		return
	}

	if err == nil {
		t.Fatal("a build without GPIO support returned a relay for a configured " +
			"gate; every actuation would be acked and nothing would move")
	}
	if r != nil {
		t.Fatal("OpenSpec returned a relay it cannot drive")
	}
	if !errors.Is(err, ErrNoGPIOSupport) {
		t.Errorf("error = %v, want ErrNoGPIOSupport", err)
	}
	// The message has to tell an operator what to actually do.
	if !strings.Contains(err.Error(), "-tags gpio") {
		t.Errorf("the error does not say how to fix it: %v", err)
	}
}

// The mock's contract, asserted so nobody "improves" it into something that
// looks like a real relay. It reports success for everything, which is exactly
// why a configured relay must never fall back to it.
func TestTheMockReportsSuccessForEverything(t *testing.T) {
	m := NewMock(discardLogger())
	if err := m.Pulse(time.Millisecond); err != nil {
		t.Fatalf("the mock failed a pulse: %v", err)
	}
	if err := m.Hold(); err != nil {
		t.Fatalf("the mock failed a hold: %v", err)
	}
	if err := m.Release(); err != nil {
		t.Fatalf("the mock failed a release: %v", err)
	}
}

// discardLogger is spelled differently from gpio_test.go's quietLogger on
// purpose: that one is behind `-tags gpio`, and two helpers with one name would
// collide the moment the tag is set.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
