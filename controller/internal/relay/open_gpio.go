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

// GPIOAvailable reports whether this binary can drive a real relay at all.
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
