//go:build gpio && linux

package relay

import (
	"errors"
	"os"
	"strings"
	"syscall"
	"testing"
)

// Linux-only checks. Everything here that would TOUCH a real chip is opt-in
// via AQL_GPIO_TEST_CHIP and is read-only even then: a test that claims an
// output line would actuate whatever is wired to it.

func TestOpenMissingChipFailsClearly(t *testing.T) {
	_, err := Open(GPIOConfig{Chip: "/dev/gpiochip991", Log: quietLogger()})
	if err == nil {
		t.Fatal("Open succeeded on a nonexistent chip")
	}
	if !errors.Is(err, syscall.ENOENT) {
		t.Fatalf("err = %v; want ENOENT", err)
	}
	if !strings.Contains(err.Error(), "gpiodetect") {
		t.Errorf("error gives no operator hint: %v", err)
	}
}

// TestLiveChipInfo reads GPIO_GET_CHIPINFO from a real chip. It claims no
// line and drives nothing. Opt in with, e.g.:
//
//	AQL_GPIO_TEST_CHIP=/dev/gpiochip0 go test -tags gpio ./internal/relay/
func TestLiveChipInfo(t *testing.T) {
	path := os.Getenv("AQL_GPIO_TEST_CHIP")
	if path == "" {
		t.Skip("set AQL_GPIO_TEST_CHIP=/dev/gpiochipN to exercise the ioctl layer read-only")
	}
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_CLOEXEC, 0)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer syscall.Close(fd)

	n, label, err := chipLines(fd)
	if err != nil {
		t.Fatalf("GPIO_GET_CHIPINFO: %v", err)
	}
	if n == 0 {
		t.Fatalf("%s reports 0 lines", path)
	}
	t.Logf("%s (%s): %d lines", path, label, n)

	// Line info is also read-only; it is what Open uses to name a squatter.
	if err := checkFree(fd, path, 0, "test probe"); err != nil {
		t.Logf("line 0 is not free (expected on a busy board): %v", err)
	}
}

// FD_CLOEXEC on the line fd, which is the single most consequential line in
// this driver's failure model and had no test.
//
// The whole fail-safe rests on the kernel releasing the line when the process
// dies, because that is the only cleanup that a SIGKILL cannot skip. An exec'd
// child inheriting the fd defeats exactly that: the child outlives the
// controller still holding the claim, and the gate stays held by a process that
// never meant to hold it. The comment said so; nothing checked it.
//
// Runs on any fd, so it needs no gpiochip — which is why the check was worth
// extracting from openLine, where it sat behind an ioctl no test machine can
// issue.
func TestSetCloexecReallySetsTheFlag(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()

	fd := int(r.Fd())

	// Clear it first, so a pass cannot come from the flag already being set by
	// whatever opened the fd. Without this the test would agree with a
	// setCloexec that did nothing at all.
	if _, _, e := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd),
		uintptr(syscall.F_SETFD), 0); e != 0 {
		t.Fatalf("could not clear FD_CLOEXEC to set up the test: %v", e)
	}
	if flags := getFD(t, fd); flags&syscall.FD_CLOEXEC != 0 {
		t.Fatal("FD_CLOEXEC survived being cleared; this test cannot prove anything")
	}

	if err := setCloexec(fd); err != nil {
		t.Fatalf("setCloexec: %v", err)
	}
	if flags := getFD(t, fd); flags&syscall.FD_CLOEXEC == 0 {
		t.Error("setCloexec returned nil but FD_CLOEXEC is not set; an exec'd child " +
			"would inherit the gate line and hold it after this process dies")
	}
}

// A closed fd is the reachable failure: openLine calls this immediately after
// the ioctl, and a caller that ignored the error would return a line whose
// claim can escape.
func TestSetCloexecReportsFailure(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	fd := int(r.Fd())
	r.Close()
	w.Close()
	if err := setCloexec(fd); err == nil {
		t.Error("setCloexec reported success on a closed descriptor")
	}
}

func getFD(t *testing.T, fd int) int {
	t.Helper()
	flags, _, e := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), uintptr(syscall.F_GETFD), 0)
	if e != 0 {
		t.Fatalf("F_GETFD: %v", e)
	}
	return int(flags)
}
