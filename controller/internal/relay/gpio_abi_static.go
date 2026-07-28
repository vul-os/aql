//go:build gpio

package relay

import "unsafe"

// The kernel uAPI layout, asserted at COMPILE time on every target.
//
// # Why this exists alongside gpio_abi_test.go
//
// Those tests check the same numbers, and they are the readable version — they
// name each field and report every mismatch at once. But a test only checks the
// architecture it RUNS on, and these run on CI's amd64. A controller runs on a
// Raspberry Pi: linux/arm64, and on older boards linux/arm, which is 32-bit.
//
// gpio_abi_test.go asserts in a comment that the sizes are "identical on 32-
// and 64-bit targets because every __aligned_u64 here already sits at a
// naturally 8-aligned offset". That is a real claim about ARM, and until this
// file existed nothing verified it: Go aligns uint64 to 4 bytes on 386 and arm,
// not 8, so a struct that happens to be laid out correctly on amd64 can differ
// on a 32-bit target. The consequence is silent — a mis-sized struct makes the
// ioctl request number wrong, and the kernel answers ENOTTY, at a gate.
//
// A constant expression is evaluated for whatever GOARCH is being built, so
// these are checked by the ordinary cross-compile CI already runs, on exactly
// the architectures the product ships to, without an emulator or a Pi.
//
// # How the assertion works
//
// A uint constant cannot be negative. Two of them, one for each direction,
// compile only when the sizes are exactly equal — too small and the first
// underflows, too large and the second does. The error names the line, and the
// per-field version in gpio_abi_test.go says which field moved.

// sizeMatch is exact-equality as a pair of constants: uint(a-b) rejects a < b,
// uint(b-a) rejects a > b.
const (
	_ = uint(unsafe.Sizeof(chipInfo{}) - 68)
	_ = uint(68 - unsafe.Sizeof(chipInfo{}))

	_ = uint(unsafe.Sizeof(lineAttribute{}) - 16)
	_ = uint(16 - unsafe.Sizeof(lineAttribute{}))

	_ = uint(unsafe.Sizeof(lineConfigAttribute{}) - 24)
	_ = uint(24 - unsafe.Sizeof(lineConfigAttribute{}))

	_ = uint(unsafe.Sizeof(lineConfig{}) - 272)
	_ = uint(272 - unsafe.Sizeof(lineConfig{}))

	_ = uint(unsafe.Sizeof(lineRequest{}) - 592)
	_ = uint(592 - unsafe.Sizeof(lineRequest{}))

	_ = uint(unsafe.Sizeof(lineValues{}) - 16)
	_ = uint(16 - unsafe.Sizeof(lineValues{}))

	_ = uint(unsafe.Sizeof(lineInfo{}) - 256)
	_ = uint(256 - unsafe.Sizeof(lineInfo{}))
)

// Offsets. A struct can be the right total size with a field in the wrong
// place — padding absorbs it — and the kernel reads by offset, so the size
// assertions above are not sufficient on their own.
const (
	_ = uint(unsafe.Offsetof(chipInfo{}.lines) - 64)
	_ = uint(64 - unsafe.Offsetof(chipInfo{}.lines))

	_ = uint(unsafe.Offsetof(lineAttribute{}.value) - 8)
	_ = uint(8 - unsafe.Offsetof(lineAttribute{}.value))

	_ = uint(unsafe.Offsetof(lineConfigAttribute{}.mask) - 16)
	_ = uint(16 - unsafe.Offsetof(lineConfigAttribute{}.mask))

	_ = uint(unsafe.Offsetof(lineConfig{}.numAttrs) - 8)
	_ = uint(8 - unsafe.Offsetof(lineConfig{}.numAttrs))

	_ = uint(unsafe.Offsetof(lineConfig{}.attrs) - 32)
	_ = uint(32 - unsafe.Offsetof(lineConfig{}.attrs))

	_ = uint(unsafe.Offsetof(lineRequest{}.consumer) - 256)
	_ = uint(256 - unsafe.Offsetof(lineRequest{}.consumer))

	_ = uint(unsafe.Offsetof(lineRequest{}.config) - 288)
	_ = uint(288 - unsafe.Offsetof(lineRequest{}.config))

	_ = uint(unsafe.Offsetof(lineRequest{}.numLines) - 560)
	_ = uint(560 - unsafe.Offsetof(lineRequest{}.numLines))

	_ = uint(unsafe.Offsetof(lineRequest{}.eventBufferSize) - 564)
	_ = uint(564 - unsafe.Offsetof(lineRequest{}.eventBufferSize))

	_ = uint(unsafe.Offsetof(lineRequest{}.fd) - 588)
	_ = uint(588 - unsafe.Offsetof(lineRequest{}.fd))

	_ = uint(unsafe.Offsetof(lineValues{}.mask) - 8)
	_ = uint(8 - unsafe.Offsetof(lineValues{}.mask))

	_ = uint(unsafe.Offsetof(lineInfo{}.offset) - 64)
	_ = uint(64 - unsafe.Offsetof(lineInfo{}.offset))

	_ = uint(unsafe.Offsetof(lineInfo{}.flags) - 72)
	_ = uint(72 - unsafe.Offsetof(lineInfo{}.flags))

	_ = uint(unsafe.Offsetof(lineInfo{}.attrs) - 80)
	_ = uint(80 - unsafe.Offsetof(lineInfo{}.attrs))
)
