//go:build gpio && linux

package relay

import (
	"errors"
	"fmt"
	"syscall"
	"unsafe"
)

// The ioctl layer. Standard-library syscall only — no cgo, no GPIO library,
// so the controller module's dependency graph is unchanged.
//
// Each ioctl performs the unsafe.Pointer→uintptr conversion inside the
// syscall.Syscall argument list, which is the form the compiler and `go vet`
// recognise (unsafe.Pointer rule 4): the argument is kept alive and its
// object is not moved for the duration of the call. Do not hoist these
// conversions into a helper.
//
// NOT HARDWARE-VALIDATED: see the package doc in gpio.go. The struct
// packing and request numbers below are unit-tested; the calls are not.

// gpioLine is one gpio_v2 line request. The kernel's claim on the line lives
// exactly as long as fd, including when the process is killed — that is the
// fail-safe the package doc relies on.
type gpioLine struct {
	fd     int
	offset uint32
}

// openLines claims the relay output and, if configured, the position input.
// Both come from the same chip. The chip fd is closed before returning: each
// line request fd holds its own reference to the chip.
func openLines(cfg GPIOConfig) (lineHandle, lineHandle, error) {
	chipFD, err := syscall.Open(cfg.Chip, syscall.O_RDWR|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("relay: open %s: %w%s", cfg.Chip, err, permissionHint(err))
	}
	defer syscall.Close(chipFD)

	nLines, label, err := chipLines(chipFD)
	if err != nil {
		return nil, nil, fmt.Errorf("relay: %s chipinfo: %w", cfg.Chip, err)
	}
	if cfg.Line >= nLines {
		return nil, nil, fmt.Errorf("relay: %s (%s) has %d lines, relay line %d is out of range",
			cfg.Chip, label, nLines, cfg.Line)
	}
	if err := checkFree(chipFD, cfg.Chip, cfg.Line, "relay output"); err != nil {
		return nil, nil, err
	}

	out, err := requestLine(chipFD, cfg.Line, cfg.Consumer, outputFlags(cfg), false, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("relay: claim %s line %d: %w%s", cfg.Chip, cfg.Line, err, busyHint(err))
	}

	if cfg.Sensor == nil {
		return out, nil, nil
	}
	s := *cfg.Sensor
	if s.Line >= nLines {
		_ = out.close()
		return nil, nil, fmt.Errorf("relay: %s (%s) has %d lines, sensor line %d is out of range",
			cfg.Chip, label, nLines, s.Line)
	}
	if err := checkFree(chipFD, cfg.Chip, s.Line, "position sensor"); err != nil {
		_ = out.close()
		return nil, nil, err
	}
	in, err := requestLine(chipFD, s.Line, cfg.Consumer+"-sensor", inputFlags(s), false, s.DebounceMs*1000)
	if err != nil {
		_ = out.close()
		return nil, nil, fmt.Errorf("relay: claim sensor %s line %d: %w%s", cfg.Chip, s.Line, err, busyHint(err))
	}
	return out, in, nil
}

// chipLines reads GPIO_GET_CHIPINFO so an out-of-range offset is refused at
// Open with a comprehensible message instead of an EINVAL at actuation.
func chipLines(chipFD int) (uint32, string, error) {
	var info chipInfo
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(chipFD), iocGetChipInfo,
		uintptr(unsafe.Pointer(&info))); e != 0 {
		return 0, "", e
	}
	return info.lines, cstr(info.label[:]), nil
}

// checkFree reports who currently owns a line. GPIO_V2_GET_LINE returns
// EBUSY authoritatively, but it cannot say who took the line; this advisory
// probe (racy by nature, and only ever used to build an error message) can.
func checkFree(chipFD int, chip string, offset uint32, what string) error {
	var info lineInfo
	info.offset = offset
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(chipFD), iocGetLineInfo,
		uintptr(unsafe.Pointer(&info))); e != 0 {
		return fmt.Errorf("relay: %s line %d info: %w", chip, offset, e)
	}
	if info.flags&lineFlagUsed != 0 {
		owner := cstr(info.consumer[:])
		if owner == "" {
			owner = "an unnamed consumer (kernel driver?)"
		}
		return fmt.Errorf("relay: %s line %d (%s) is already claimed by %q — refusing to start",
			chip, offset, what, owner)
	}
	return nil
}

// requestLine performs GPIO_V2_GET_LINE for a single line.
func requestLine(chipFD int, offset uint32, consumer string, flags uint64, initialAsserted bool, debounceUS uint32) (*gpioLine, error) {
	req, err := buildLineRequest(offset, consumer, flags, initialAsserted, debounceUS)
	if err != nil {
		return nil, err
	}
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(chipFD), iocGetLine,
		uintptr(unsafe.Pointer(&req))); e != 0 {
		return nil, e
	}
	if req.fd < 0 {
		return nil, fmt.Errorf("kernel returned line fd %d", req.fd)
	}
	l := &gpioLine{fd: int(req.fd), offset: offset}
	// The kernel already opens line request fds O_CLOEXEC; set it again
	// rather than trusting it, because an exec'd child inheriting this fd
	// would keep the line claimed after we die — exactly the failure the
	// fd-lifetime design exists to prevent.
	if _, _, e := syscall.Syscall(syscall.SYS_FCNTL, uintptr(l.fd),
		uintptr(syscall.F_SETFD), uintptr(syscall.FD_CLOEXEC)); e != 0 {
		_ = l.close()
		return nil, fmt.Errorf("set FD_CLOEXEC on line fd: %w", e)
	}
	return l, nil
}

// set implements lineHandle. asserted is the LOGICAL level: the kernel
// applies GPIO_V2_LINE_FLAG_ACTIVE_LOW, so asserted always means "relay
// energised" regardless of board polarity.
func (l *gpioLine) set(asserted bool) error {
	if l.fd < 0 {
		return ErrClosed
	}
	v := lineValues{mask: 1}
	if asserted {
		v.bits = 1
	}
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(l.fd), iocLineSetValues,
		uintptr(unsafe.Pointer(&v))); e != 0 {
		return e
	}
	return nil
}

// get implements lineHandle.
func (l *gpioLine) get() (bool, error) {
	if l.fd < 0 {
		return false, ErrClosed
	}
	v := lineValues{mask: 1}
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(l.fd), iocLineGetValues,
		uintptr(unsafe.Pointer(&v))); e != 0 {
		return false, e
	}
	return v.bits&1 == 1, nil
}

// close implements lineHandle: closing the request fd is what releases the
// line back to the kernel.
func (l *gpioLine) close() error {
	if l.fd < 0 {
		return nil
	}
	fd := l.fd
	l.fd = -1
	return syscall.Close(fd)
}

func permissionHint(err error) string {
	if errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) {
		return " (add the user to the `gpio` group, or install a udev rule granting it the chip)"
	}
	if errors.Is(err, syscall.ENOENT) {
		return " (no such gpio chip — check `gpiodetect`)"
	}
	return ""
}

func busyHint(err error) string {
	switch {
	case errors.Is(err, syscall.EBUSY):
		return " (line already claimed — another process or a device-tree driver holds it)"
	case errors.Is(err, syscall.EOPNOTSUPP), errors.Is(err, syscall.ENOTSUP):
		return " (the chip does not support a requested feature, e.g. kernel debounce or bias)"
	case errors.Is(err, syscall.ENOTTY), errors.Is(err, syscall.EINVAL):
		return " (kernel too old for the GPIO uAPI v2? it needs Linux 5.10 or newer)"
	}
	return ""
}
