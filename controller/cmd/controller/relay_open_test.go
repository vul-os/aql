package main

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/vul-os/aql/controller/internal/relay"
)

func quiet() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// A controller told to drive a relay must never silently drive a mock instead.
//
// # Why this file exists
//
// main.go calls openRelay before anything else and exits non-zero on any error,
// with a comment naming the mock fallback as "the one unacceptable outcome":
// a controller that reports opened, emits the event and satisfies the hub while
// the physical gate has not moved. That is the failure mode this whole seam is
// shaped around.
//
// openRelay had no test at all. The only tests in this package were about flag
// parsing, so the interlock itself — the thing standing between a wiring
// mistake and a gate that lies — rested entirely on reading the code.
//
// # The invariant, chosen so it holds on every platform
//
// (nil, nil) is openRelay's "use the mock" answer, and it is correct for
// EXACTLY one input: no -relay flag at all, meaning the operator never asked
// for a relay. For every other input — malformed spec, unparseable line,
// well-formed spec on a binary built without -tags gpio, a real open failure —
// it must return an error.
//
// Asserting that rather than asserting a particular error keeps this meaningful
// whether or not the test host has GPIO. On a machine without it the
// !GPIOAvailable branch is what fires; on a Linux build with the tag, ParseSpec
// and OpenSpec are. Both must refuse, and neither may answer "use the mock".
func TestAGivenRelaySpecNeverFallsBackToTheMock(t *testing.T) {
	for _, spec := range []string{
		// Malformed, each in a different way ParseSpec distinguishes.
		"gpiochip0",                     // no line number
		":17",                           // no chip before the line
		"gpiochip0:17",                  // not an absolute path
		"/dev/gpiochip0:notanumber",     // unparseable line
		"/dev/gpiochip0:17,bias=nope",   // bias not in the allowed set
		"/dev/gpiochip0:17,pulse=400ms", // no such option
		// Well-formed, and verified to be: every option here is one ParseSpec
		// accepts. The first draft used `pulse=400ms` as a "well-formed"
		// example and it is not an option at all, so that row was exercising
		// the malformed path while the comment claimed otherwise and only one
		// row ever reached the branch below.
		//
		// On a host without -tags gpio these are refused for ErrNoGPIOSupport;
		// with the tag they are refused by the real open, because this chip
		// does not exist on any test machine.
		"/dev/gpiochip0:17",
		"/dev/gpiochip0:17,active-low,bias=pull-up",
		"/dev/gpiochip0:17,sensor=/dev/gpiochip0:18,sensor-debounce=20ms",
	} {
		r, err := openRelay(spec, quiet())
		if err == nil {
			t.Errorf("openRelay(%q) returned no error (relay=%v). If that reaches main, "+
				"the controller comes up on a MOCK relay and reports opened while the "+
				"gate does not move.", spec, r)
			continue
		}
		if r != nil {
			t.Errorf("openRelay(%q) returned both a relay and an error %v; main exits on "+
				"the error, so this relay would leak its lines", spec, err)
		}
	}
}

// The one input for which "use the mock" IS the answer: no -relay flag.
//
// The control for the test above, which would otherwise be satisfied by an
// openRelay that refused everything — including a controller started with no
// relay at all, which is how every developer and every test harness runs it.
func TestNoRelayFlagIsNotAnError(t *testing.T) {
	r, err := openRelay("", quiet())
	if err != nil {
		t.Fatalf("openRelay(\"\") = %v; a controller started without -relay must come up "+
			"on the mock, which is how it is run in development and in e2e", err)
	}
	if r != nil {
		t.Fatalf("openRelay(\"\") returned a relay %v; nil is what tells agent.New to use "+
			"the mock and warn", r)
	}
	// Whitespace is the same case: a unit file with `-relay ""` or a stray
	// space must not be read as a malformed spec and refused.
	if _, err := openRelay("   ", quiet()); err != nil {
		t.Errorf("openRelay(\"   \") = %v, want the no-spec path", err)
	}
}

// A binary built without -tags gpio names the BUILD as the fix, not the wiring.
//
// The two failures are fixed in completely different places — one is a
// rebuild, the other is a device node, a permission or a line number — and an
// operator who is told the wrong one loses a lot of time at a gate. relay.go
// separates them deliberately; this holds that apart.
func TestAGPIOlessBuildSaysSoRatherThanBlamingTheWiring(t *testing.T) {
	if relay.GPIOAvailable {
		t.Skip("this binary was built with -tags gpio; the branch under test is the other one")
	}
	_, err := openRelay("/dev/gpiochip0:17", quiet())
	if err == nil {
		t.Fatal("a well-formed spec was accepted by a build with no GPIO support")
	}
	if !errors.Is(err, relay.ErrNoGPIOSupport) {
		t.Fatalf("error %v does not wrap ErrNoGPIOSupport; an operator is sent to check "+
			"wiring when the fix is a rebuild", err)
	}
	// And it must repeat the spec, so the message is actionable without
	// going back to the unit file.
	if !strings.Contains(err.Error(), "/dev/gpiochip0") {
		t.Errorf("error %q does not name the spec it refused", err)
	}
}
