//go:build gpio

package relay

import (
	"fmt"
	"log/slog"
)

// OpenSpec opens a real GPIO relay. Compiled only with `-tags gpio`; the
// build without the tag has a variant that refuses — see open_nogpio.go.
func OpenSpec(s Spec, log *slog.Logger) (Relay, error) {
	cfg := GPIOConfig{
		Chip:      s.Chip,
		Line:      s.Line,
		ActiveLow: s.ActiveLow,
		Bias:      biasFromName(s.BiasName),
		Log:       log,
	}
	if s.HasSensor {
		cfg.Sensor = &GPIOSensorConfig{
			Line:       s.SensorLine,
			ActiveLow:  s.SensorActiveLow,
			DebounceMs: uint32(s.SensorDebounce.Milliseconds()),
		}
	}
	g, err := Open(cfg)
	if err != nil {
		return nil, fmt.Errorf("relay %s: %w", s, err)
	}
	return g, nil
}

// GPIOAvailable reports whether this binary was BUILT WITH `-tags gpio`.
//
// Not "can drive a real relay": those differ on a third build nobody deploys
// but everybody cross-compiles. With the tag on a non-Linux OS this is true and
// the binary still cannot drive anything, because gpio_other.go's openLines
// returns ErrUnsupported — the character device is a Linux interface.
//
// That is handled, and correctly, one layer out. cmd/controller/relay.go uses
// this constant to answer "did you forget the tag", whose fix is to add it, and
// lets OpenSpec answer everything else — on a tagged non-Linux build that
// message is "gpio character device is Linux-only", which is a BUILD remedy
// stated plainly rather than a wiring one.
//
// Worth this many words because the previous one-line comment claimed the
// constant meant "can drive a relay", and I believed it: I moved the constant
// into the per-platform files so it would report false here, and
// TestAConfiguredRelayNeverSilentlyBecomesTheMock failed — correctly. Its
// `!GPIOAvailable` branch asserts the error names `-tags gpio` as the fix, and
// telling someone who already passed the tag to pass the tag is useless advice.
// The code was right and the sentence describing it was not.
const GPIOAvailable = true

func biasFromName(name string) Bias {
	switch name {
	case "disabled":
		return BiasDisabled
	case "pull-up":
		return BiasPullUp
	case "pull-down":
		return BiasPullDown
	default:
		return BiasDefault
	}
}
