//go:build !gpio

package relay

import "log/slog"

// OpenSpec always fails in a build without the gpio tag.
func OpenSpec(_ Spec, _ *slog.Logger) (Relay, error) { return nil, ErrNoGPIOSupport }

// GPIOAvailable reports whether this binary was built with `-tags gpio`; see
// open_gpio.go for why that is not the same as "can drive a relay".
const GPIOAvailable = false
