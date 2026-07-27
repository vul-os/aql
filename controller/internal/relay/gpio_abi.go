//go:build gpio

package relay

import (
	"fmt"
	"unsafe"
)

// Linux GPIO character-device uAPI v2 (<linux/gpio.h>, kernel ≥ 5.10).
//
// This file is deliberately syscall-free and builds on every GOOS: the
// struct layout and the ioctl request numbers are the part of the driver
// most likely to be wrong and least likely to be caught at runtime (a
// mis-sized struct yields a silent ENOTTY, or worse, a kernel read past the
// end of the argument), so they are unit-tested on the development host
// (gpio_abi_test.go) even though the ioctls themselves can only run on
// Linux.
//
// Every field below is a fixed-width scalar or an array of them, and every
// __aligned_u64 in the kernel headers happens to land on a naturally
// 8-aligned offset. That matters because Go aligns uint64 to 4 bytes on
// 386/arm (32-bit Raspberry Pi OS) while the kernel forces 8; because no
// u64 here needs padding to reach an 8-aligned offset, the Go and C layouts
// agree on both 32- and 64-bit targets. The compile-time assertions at the
// bottom of this file nail that down: a layout regression fails the build
// rather than the gate.

const (
	gpioMaxNameSize       = 32 // GPIO_MAX_NAME_SIZE
	gpioV2LinesMax        = 64 // GPIO_V2_LINES_MAX
	gpioV2LineNumAttrsMax = 10 // GPIO_V2_LINE_NUM_ATTRS_MAX
)

// enum gpio_v2_line_flag
const (
	lineFlagUsed              uint64 = 1 << 0
	lineFlagActiveLow         uint64 = 1 << 1
	lineFlagInput             uint64 = 1 << 2
	lineFlagOutput            uint64 = 1 << 3
	lineFlagEdgeRising        uint64 = 1 << 4
	lineFlagEdgeFalling       uint64 = 1 << 5
	lineFlagOpenDrain         uint64 = 1 << 6
	lineFlagOpenSource        uint64 = 1 << 7
	lineFlagBiasPullUp        uint64 = 1 << 8
	lineFlagBiasPullDown      uint64 = 1 << 9
	lineFlagBiasDisabled      uint64 = 1 << 10
	lineFlagEventClockRealtim uint64 = 1 << 11
)

// enum gpio_v2_line_attr_id
const (
	lineAttrIDFlags        uint32 = 1
	lineAttrIDOutputValues uint32 = 2
	lineAttrIDDebounce     uint32 = 3
)

// struct gpiochip_info
type chipInfo struct {
	name  [gpioMaxNameSize]byte
	label [gpioMaxNameSize]byte
	lines uint32
}

// struct gpio_v2_line_attribute. The third field is a union of
// { __aligned_u64 flags; __aligned_u64 values; __u32 debounce_period_us }.
// Only the u64 members are written directly; debounce_period_us is a __u32
// occupying the low half of the union, which is why writing it through the
// u64 member is little-endian-only (see hostIsLittleEndian).
type lineAttribute struct {
	id      uint32
	padding uint32
	value   uint64
}

// struct gpio_v2_line_config_attribute
type lineConfigAttribute struct {
	attr lineAttribute
	mask uint64
}

// struct gpio_v2_line_config
type lineConfig struct {
	flags    uint64
	numAttrs uint32
	padding  [5]uint32
	attrs    [gpioV2LineNumAttrsMax]lineConfigAttribute
}

// struct gpio_v2_line_request
type lineRequest struct {
	offsets         [gpioV2LinesMax]uint32
	consumer        [gpioMaxNameSize]byte
	config          lineConfig
	numLines        uint32
	eventBufferSize uint32
	padding         [5]uint32
	fd              int32
}

// struct gpio_v2_line_values
type lineValues struct {
	bits uint64
	mask uint64
}

// struct gpio_v2_line_info
type lineInfo struct {
	name     [gpioMaxNameSize]byte
	consumer [gpioMaxNameSize]byte
	offset   uint32
	numAttrs uint32
	flags    uint64
	attrs    [gpioV2LineNumAttrsMax]lineAttribute
	padding  [4]uint32
}

// _IOC encoding (asm-generic/ioctl.h): dir<<30 | size<<16 | type<<8 | nr.
// The size is taken from the Go structs above so the request number and the
// argument can never disagree; gpio_abi_test.go pins the results against the
// values the kernel headers produce.
const (
	iocRead     = 2
	iocWrite    = 1
	iocReadWr   = iocRead | iocWrite
	iocSizeShif = 16
	iocTypeShif = 8
	iocDirShift = 30

	gpioIOCMagic = 0xB4
)

const (
	// GPIO_GET_CHIPINFO_IOCTL           _IOR (0xB4, 0x01, struct gpiochip_info)
	iocGetChipInfo = iocRead<<iocDirShift | unsafe.Sizeof(chipInfo{})<<iocSizeShif |
		gpioIOCMagic<<iocTypeShif | 0x01
	// GPIO_V2_GET_LINEINFO_IOCTL        _IOWR(0xB4, 0x05, struct gpio_v2_line_info)
	iocGetLineInfo = iocReadWr<<iocDirShift | unsafe.Sizeof(lineInfo{})<<iocSizeShif |
		gpioIOCMagic<<iocTypeShif | 0x05
	// GPIO_V2_GET_LINE_IOCTL            _IOWR(0xB4, 0x07, struct gpio_v2_line_request)
	iocGetLine = iocReadWr<<iocDirShift | unsafe.Sizeof(lineRequest{})<<iocSizeShif |
		gpioIOCMagic<<iocTypeShif | 0x07
	// GPIO_V2_LINE_SET_CONFIG_IOCTL     _IOWR(0xB4, 0x0D, struct gpio_v2_line_config)
	iocLineSetConfig = iocReadWr<<iocDirShift | unsafe.Sizeof(lineConfig{})<<iocSizeShif |
		gpioIOCMagic<<iocTypeShif | 0x0D
	// GPIO_V2_LINE_GET_VALUES_IOCTL     _IOWR(0xB4, 0x0E, struct gpio_v2_line_values)
	iocLineGetValues = iocReadWr<<iocDirShift | unsafe.Sizeof(lineValues{})<<iocSizeShif |
		gpioIOCMagic<<iocTypeShif | 0x0E
	// GPIO_V2_LINE_SET_VALUES_IOCTL     _IOWR(0xB4, 0x0F, struct gpio_v2_line_values)
	iocLineSetValues = iocReadWr<<iocDirShift | unsafe.Sizeof(lineValues{})<<iocSizeShif |
		gpioIOCMagic<<iocTypeShif | 0x0F
)

// buildLineRequest fills a struct gpio_v2_line_request for a single line.
//
// The initial output level is carried as a GPIO_V2_LINE_ATTR_ID_OUTPUT_VALUES
// attribute rather than written after the request: the kernel applies the
// requested output value as it sets the line's direction, so an output line
// is never briefly driven at an arbitrary level between being claimed and
// being written. (A relay board that latches on its own power-up, before
// this process starts at all, is outside any driver's control — that is a
// wiring problem, see the failure model in gpio.go.)
//
// consumer is what `gpioinfo` shows as the owner of the line; it must fit in
// GPIO_MAX_NAME_SIZE including its NUL terminator.
func buildLineRequest(offset uint32, consumer string, flags uint64, initialAsserted bool, debounceUS uint32) (lineRequest, error) {
	var req lineRequest
	if offset >= 1<<16 {
		return req, fmt.Errorf("relay: line offset %d out of range", offset)
	}
	if len(consumer) == 0 {
		return req, fmt.Errorf("relay: empty consumer label")
	}
	if len(consumer) > gpioMaxNameSize-1 {
		return req, fmt.Errorf("relay: consumer label %q longer than %d bytes", consumer, gpioMaxNameSize-1)
	}
	if debounceUS != 0 && !hostIsLittleEndian() {
		// debounce_period_us is a __u32 inside a __aligned_u64 union; the
		// overlay below only lands in the right half on little-endian hosts
		// and this has never been exercised on a big-endian kernel.
		return req, fmt.Errorf("relay: kernel debounce is unsupported on big-endian hosts")
	}
	req.offsets[0] = offset
	copy(req.consumer[:gpioMaxNameSize-1], consumer)
	req.numLines = 1
	req.config.flags = flags

	n := 0
	if flags&lineFlagOutput != 0 {
		req.config.attrs[n].attr.id = lineAttrIDOutputValues
		if initialAsserted {
			req.config.attrs[n].attr.value = 1
		}
		req.config.attrs[n].mask = 1 // applies to offsets[0]
		n++
	}
	if debounceUS != 0 {
		req.config.attrs[n].attr.id = lineAttrIDDebounce
		req.config.attrs[n].attr.value = uint64(debounceUS)
		req.config.attrs[n].mask = 1
		n++
	}
	req.config.numAttrs = uint32(n)
	return req, nil
}

// hostIsLittleEndian reports the byte order of the running host. Every Linux
// target this controller is built for (arm, arm64, amd64) is little-endian;
// the check exists so the one endian-sensitive field in the uAPI (the
// debounce union member) refuses rather than silently misbehaves elsewhere.
func hostIsLittleEndian() bool {
	x := uint16(1)
	return *(*byte)(unsafe.Pointer(&x)) == 1
}

// cstr trims a NUL-padded kernel name field to a Go string.
func cstr(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// Compile-time layout assertions against the sizes the kernel headers
// produce. Each pair fails to compile (constant overflows uintptr) if the Go
// struct is respectively too large or too small.
const (
	_ = unsafe.Sizeof(chipInfo{}) - 68
	_ = 68 - unsafe.Sizeof(chipInfo{})

	_ = unsafe.Sizeof(lineAttribute{}) - 16
	_ = 16 - unsafe.Sizeof(lineAttribute{})

	_ = unsafe.Sizeof(lineConfigAttribute{}) - 24
	_ = 24 - unsafe.Sizeof(lineConfigAttribute{})

	_ = unsafe.Sizeof(lineConfig{}) - 272
	_ = 272 - unsafe.Sizeof(lineConfig{})

	_ = unsafe.Sizeof(lineRequest{}) - 592
	_ = 592 - unsafe.Sizeof(lineRequest{})

	_ = unsafe.Sizeof(lineValues{}) - 16
	_ = 16 - unsafe.Sizeof(lineValues{})

	_ = unsafe.Sizeof(lineInfo{}) - 256
	_ = 256 - unsafe.Sizeof(lineInfo{})

	_ = unsafe.Offsetof(lineRequest{}.config) - 288
	_ = 288 - unsafe.Offsetof(lineRequest{}.config)

	_ = unsafe.Offsetof(lineRequest{}.fd) - 588
	_ = 588 - unsafe.Offsetof(lineRequest{}.fd)
)
