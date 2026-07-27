package main

import (
	"fmt"
	"log/slog"

	"github.com/vul-os/aql/controller/internal/relay"
)

// Relay selection, and the one rule that governs it.
//
// A controller told to drive a real relay that it cannot open MUST NOT fall
// back to the mock. It must refuse to start.
//
// The mock is not a degraded relay. Every actuation returns nil, so the command
// is acked, the hub records an `opened` row in its hash-chained audit trail, and
// the resident is told the gate opened. Nothing moves. A gate that fails to open
// is a visible fault someone goes and fixes within the hour; a gate that reports
// opening while standing still quietly corrupts the one record anybody would
// later trust — and it is the record a dispute is settled with.
//
// So the failure modes are deliberately asymmetric:
//
//	-relay unset          mock, with a WARN saying nothing will move
//	-relay set, opens     the real thing
//	-relay set, fails     EXIT, with the reason
//
// There is no flag to soften the third case, on purpose. "Try the relay and
// carry on if it is missing" is precisely the configuration that produces a
// silent liar at a gate.
func openRelay(spec string, log *slog.Logger) (relay.Relay, error) {
	s, err := relay.ParseSpec(spec)
	if err != nil {
		if err == relay.ErrNoSpec {
			return nil, nil // caller uses the mock; agent.New warns
		}
		return nil, err
	}

	if !relay.GPIOAvailable {
		// Named separately from a failed open because the fix is different: one
		// is a build, the other is wiring or permissions.
		return nil, fmt.Errorf("-relay %s was given but %w", s, relay.ErrNoGPIOSupport)
	}

	r, err := relay.OpenSpec(s, log)
	if err != nil {
		return nil, err
	}
	log.Info("relay open", "spec", s.String())
	return r, nil
}
