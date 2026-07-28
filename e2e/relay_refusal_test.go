package e2e

import (
	"os/exec"
	"strings"
	"testing"
)

// The controller's refusal to lie, asserted rather than remembered.
//
// The rule, from controller/cmd/controller/relay.go: a controller told to drive
// a real relay it cannot open MUST refuse to start, and there is deliberately no
// flag to soften that.
//
// The reason is worth restating where the test lives, because the tempting
// alternative looks harmless. The mock relay is not a degraded relay — every
// actuation returns nil, so the command is acked, the hub writes an `opened` row
// into a hash-chained audit trail, and the resident is told the gate opened.
// Nothing moves. A gate that fails to open is a visible fault someone fixes
// within the hour; a gate that reports opening while standing still corrupts the
// one record a dispute is later settled with.
//
// That property had no automated test — it was verified once by hand against a
// built binary, which is a thing that stops being true silently.

// A configured relay this build cannot drive must exit non-zero, and say what
// is missing rather than starting on the mock.
func TestController_RefusesToStartWithARelayItCannotDrive(t *testing.T) {
	out, err := runController(t, "-state", t.TempDir(), "-relay", "/dev/gpiochip0:17")

	// A non-zero exit is NOT sufficient evidence, and asserting only that would
	// be the bug this test exists to catch. An unpaired controller also exits
	// non-zero, so a build that silently fell back to the mock and then quit for
	// want of --hub would satisfy `err != nil` and look like a refusal.
	//
	// Found exactly that way: tampering openRelay to return the mock made this
	// test fail on a message assertion while the exit-code one passed.
	if err == nil {
		t.Fatal("the controller started with a relay it cannot open. Every actuation " +
			"would be acked and recorded as successful while nothing moved.")
	}
	if strings.Contains(out, "MOCK relay") {
		t.Fatal("the controller fell back to the MOCK relay after being told to drive " +
			"a real one. It exits either way — the difference is whether it exits " +
			"because it refused, or because it happened to be unpaired.")
	}
	if !strings.Contains(out, "GPIO support") {
		t.Errorf("the refusal does not say what is missing: %s", out)
	}
	// The fix has to be in the message. An operator holding a binary that will
	// not start needs to know it is a BUILD, not their wiring.
	if !strings.Contains(out, "-tags gpio") {
		t.Errorf("the refusal does not say how to fix it: %s", out)
	}
}

// A malformed spec is refused the same way, naming the offending field. A line
// number that silently became 0 would drive whatever is wired to line 0.
func TestController_RefusesAMalformedRelaySpec(t *testing.T) {
	for _, spec := range []string{
		"gpiochip0:17",             // relative path — resolves against the service's cwd, not /dev
		"/dev/gpiochip0",           // no line number
		"/dev/gpiochip0:seventeen", // not a number
		"/dev/gpiochip0:17,activelow",
	} {
		out, err := runController(t, "-state", t.TempDir(), "-relay", spec)
		if err == nil {
			t.Errorf("%q was accepted", spec)
			continue
		}
		if !strings.Contains(out, "relay") {
			t.Errorf("%q: the error does not mention the relay: %s", spec, out)
		}
	}
}

// Without -relay the controller runs the mock — and says so loudly, because an
// operator who wired a gate and forgot the flag would otherwise see a
// working-looking controller.
//
// It still exits (unpaired, no --hub), so the assertion is on the WARNING having
// been emitted before that, not on the process surviving.
func TestController_WarnsLoudlyWhenRunningTheMockRelay(t *testing.T) {
	out, _ := runController(t, "-state", t.TempDir())

	if !strings.Contains(out, "MOCK relay") {
		t.Fatalf("no warning that the mock relay is in use: %s", out)
	}
	// The warning has to say what the mock DOES, not just that it is a mock.
	if !strings.Contains(out, "nothing physical will move") {
		t.Errorf("the warning does not say that nothing actuates: %s", out)
	}
	if !strings.Contains(out, "level=WARN") {
		t.Errorf("the mock notice is not at WARN; at INFO it reads as normal "+
			"startup chatter: %s", out)
	}
}

// runController runs the built controller binary to completion and returns its
// combined output. Every invocation here exits quickly by design — either
// refused, or unpaired.
func runController(t *testing.T, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command(controllerBin, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}
