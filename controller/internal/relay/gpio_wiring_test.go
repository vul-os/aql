package relay

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The one wiring in this driver that no test machine can exercise.
//
// gpio.go's failure model rests on a single sentence: the kernel releasing the
// line when the process dies is "the only cleanup path that cannot be skipped".
// An exec'd child inheriting the line fd defeats exactly that — the child
// outlives the controller still holding the claim, and the gate stays held by a
// process that never meant to hold it.
//
// TestSetCloexecReallySetsTheFlag proves setCloexec WORKS, and proves it
// properly: it clears the flag first, so it cannot agree with a setCloexec that
// does nothing. What it cannot prove is that requestLine CALLS it. That call
// sits immediately after a GPIO_V2_GET_LINE ioctl, which needs a real gpiochip;
// there is no machine in CI that can reach it, and there never will be.
//
// So this reads the source. That is a weaker check than running the code and it
// is chosen deliberately over the alternative, which is no check at all — the
// function stays proven, the call site stays unproven, and the difference is
// invisible until a gate is held open by a process nobody can find.
//
// NO BUILD TAG on purpose: gpio_linux.go exists as text whatever the platform,
// so this runs in the ordinary `go test ./...` rather than only when someone
// remembers -tags gpio.

func gpioLinuxSource(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("gpio_linux.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	// A scan of an empty or renamed file would pass while checking nothing.
	if len(src) < 2000 || !strings.Contains(src, "func requestLine(") {
		t.Fatalf("gpio_linux.go is %d bytes and does not look like the driver; "+
			"the scan is broken, not the code", len(src))
	}
	return src
}

// requestLineBody returns the text of requestLine, which is where the claim
// lives. Checking the whole file would pass on a setCloexec call anywhere.
func requestLineBody(t *testing.T, src string) string {
	t.Helper()
	i := strings.Index(src, "func requestLine(")
	if i < 0 {
		t.Fatal("requestLine is gone")
	}
	rest := src[i:]
	j := strings.Index(rest, "\n}")
	if j < 0 {
		t.Fatal("could not delimit requestLine")
	}
	return rest[:j]
}

func TestEveryLineFdIsMarkedCloseOnExec(t *testing.T) {
	body := requestLineBody(t, gpioLinuxSource(t))

	if !strings.Contains(body, "setCloexec(") {
		t.Fatal(`requestLine does not call setCloexec.

The line fd is what holds the gate. Without FD_CLOEXEC an exec'd child inherits
it, and when the controller dies the kernel does not release the line — because
the child still has it open. The gate stays held by a process that never meant
to hold it, and the fail-safe this whole driver is built around does not fire.`)
	}

	// And the failure must close the line rather than continue with it.
	// Holding a line whose fd could leak is worse than not having claimed it:
	// the driver would believe it owns a safe claim it does not own.
	if !regexp.MustCompile(`if err := setCloexec\([^)]*\); err != nil \{`).MatchString(body) {
		t.Error("setCloexec's error is not branched on in requestLine; a failure must be fatal to the claim")
	}
	tail := body[strings.Index(body, "setCloexec("):]
	if !strings.Contains(tail, "close()") {
		t.Error(`requestLine does not close the line when setCloexec fails.

Continuing leaves the driver holding a claim it cannot guarantee is
close-on-exec, which is the state the claim exists to prevent.`)
	}
}

// The other half of the same sentence: nothing may keep the line claimed
// "for later" through a mechanism the kernel does not tear down.
//
// A finalizer or a package-level cache holding the line would survive the
// scope that owns it and reintroduce exactly the lifetime the fd model
// removes. This is a narrow check for the two shapes that would do it.
func TestTheLineIsHeldOnlyByItsFileDescriptor(t *testing.T) {
	src := gpioLinuxSource(t)

	for _, bad := range []string{"runtime.SetFinalizer", "runtime.KeepAlive"} {
		if strings.Contains(src, bad) {
			t.Errorf("gpio_linux.go uses %s. The line's lifetime is the fd's lifetime and "+
				"the kernel's alone — anything that extends it past process death is the "+
				"failure this driver's comment rules out.", bad)
		}
	}
}
