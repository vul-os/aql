//go:build !gpio

package relay

import "log/slog"

// OpenSpec always fails in a build without the gpio tag.
func OpenSpec(_ Spec, _ *slog.Logger) (Relay, error) { return nil, ErrNoGPIOSupport }

// GPIOAvailable reports whether this binary can drive a real relay at all.
const GPIOAvailable = false
