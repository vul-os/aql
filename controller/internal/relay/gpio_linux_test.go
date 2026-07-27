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
