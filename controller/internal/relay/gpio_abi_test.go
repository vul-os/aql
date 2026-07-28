//go:build gpio

package relay

import (
	"os"
	"regexp"
	"strings"
	"testing"
	"unsafe"
)

// The uAPI layer is the part of this driver that cannot be checked by the
// compiler and fails silently on hardware (a mis-sized struct yields ENOTTY,
// a mis-placed field yields a line request for the wrong offset). These
// tests pin it to the values <linux/gpio.h> produces, and they run on any
// host — including one with no GPIO chip at all.
//
// They verify the ARGUMENTS. They cannot verify that the kernel accepts
// them: no ioctl in this package has been executed against a running kernel
// by this tree's authors.
//
// They also only check the architecture they RUN on, which in CI is amd64
// while a controller runs on ARM. gpio_abi_static.go asserts the same numbers
// as constant expressions, so the ordinary cross-compile checks them for
// linux/arm64, linux/arm and linux/386 too. Keep the two in step: this file is
// the readable one that names the field and reports every mismatch at once,
// that one is the one that covers the target.

func TestABIStructSizes(t *testing.T) {
	// Sizes from <linux/gpio.h>, uAPI v2. Identical on 32- and 64-bit
	// targets because every __aligned_u64 here already sits at a naturally
	// 8-aligned offset (see the note in gpio_abi.go).
	cases := []struct {
		name string
		got  uintptr
		want uintptr
	}{
		{"struct gpiochip_info", unsafe.Sizeof(chipInfo{}), 68},
		{"struct gpio_v2_line_attribute", unsafe.Sizeof(lineAttribute{}), 16},
		{"struct gpio_v2_line_config_attribute", unsafe.Sizeof(lineConfigAttribute{}), 24},
		{"struct gpio_v2_line_config", unsafe.Sizeof(lineConfig{}), 272},
		{"struct gpio_v2_line_request", unsafe.Sizeof(lineRequest{}), 592},
		{"struct gpio_v2_line_values", unsafe.Sizeof(lineValues{}), 16},
		{"struct gpio_v2_line_info", unsafe.Sizeof(lineInfo{}), 256},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("sizeof(%s) = %d, want %d", c.name, c.got, c.want)
		}
	}
}

func TestABIFieldOffsets(t *testing.T) {
	cases := []struct {
		name string
		got  uintptr
		want uintptr
	}{
		{"gpiochip_info.lines", unsafe.Offsetof(chipInfo{}.lines), 64},
		{"gpio_v2_line_attribute.value(union)", unsafe.Offsetof(lineAttribute{}.value), 8},
		{"gpio_v2_line_config_attribute.mask", unsafe.Offsetof(lineConfigAttribute{}.mask), 16},
		{"gpio_v2_line_config.num_attrs", unsafe.Offsetof(lineConfig{}.numAttrs), 8},
		{"gpio_v2_line_config.attrs", unsafe.Offsetof(lineConfig{}.attrs), 32},
		{"gpio_v2_line_request.consumer", unsafe.Offsetof(lineRequest{}.consumer), 256},
		{"gpio_v2_line_request.config", unsafe.Offsetof(lineRequest{}.config), 288},
		{"gpio_v2_line_request.num_lines", unsafe.Offsetof(lineRequest{}.numLines), 560},
		{"gpio_v2_line_request.event_buffer_size", unsafe.Offsetof(lineRequest{}.eventBufferSize), 564},
		{"gpio_v2_line_request.fd", unsafe.Offsetof(lineRequest{}.fd), 588},
		{"gpio_v2_line_values.mask", unsafe.Offsetof(lineValues{}.mask), 8},
		{"gpio_v2_line_info.offset", unsafe.Offsetof(lineInfo{}.offset), 64},
		{"gpio_v2_line_info.flags", unsafe.Offsetof(lineInfo{}.flags), 72},
		{"gpio_v2_line_info.attrs", unsafe.Offsetof(lineInfo{}.attrs), 80},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("offsetof(%s) = %d, want %d", c.name, c.got, c.want)
		}
	}
}

func TestIoctlRequestNumbersMatchKernelHeaders(t *testing.T) {
	// Values as expanded by <linux/gpio.h> on any little-endian Linux
	// target. If a struct above changes size these change with it, which is
	// exactly the regression this test exists to catch.
	cases := []struct {
		name string
		got  uintptr
		want uintptr
	}{
		{"GPIO_GET_CHIPINFO_IOCTL", iocGetChipInfo, 0x8044b401},
		{"GPIO_V2_GET_LINEINFO_IOCTL", iocGetLineInfo, 0xc100b405},
		{"GPIO_V2_GET_LINE_IOCTL", iocGetLine, 0xc250b407},
		{"GPIO_V2_LINE_SET_CONFIG_IOCTL", iocLineSetConfig, 0xc110b40d},
		{"GPIO_V2_LINE_GET_VALUES_IOCTL", iocLineGetValues, 0xc010b40e},
		{"GPIO_V2_LINE_SET_VALUES_IOCTL", iocLineSetValues, 0xc010b40f},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s = %#x, want %#x", c.name, c.got, c.want)
		}
	}
}

func TestLineFlagBits(t *testing.T) {
	// enum gpio_v2_line_flag
	want := map[string]uint64{
		"USED": 1, "ACTIVE_LOW": 2, "INPUT": 4, "OUTPUT": 8,
		"EDGE_RISING": 16, "EDGE_FALLING": 32, "OPEN_DRAIN": 64, "OPEN_SOURCE": 128,
		"BIAS_PULL_UP": 256, "BIAS_PULL_DOWN": 512, "BIAS_DISABLED": 1024,
	}
	got := map[string]uint64{
		"USED": lineFlagUsed, "ACTIVE_LOW": lineFlagActiveLow, "INPUT": lineFlagInput,
		"OUTPUT": lineFlagOutput, "EDGE_RISING": lineFlagEdgeRising,
		"EDGE_FALLING": lineFlagEdgeFalling, "OPEN_DRAIN": lineFlagOpenDrain,
		"OPEN_SOURCE": lineFlagOpenSource, "BIAS_PULL_UP": lineFlagBiasPullUp,
		"BIAS_PULL_DOWN": lineFlagBiasPullDown, "BIAS_DISABLED": lineFlagBiasDisabled,
	}
	for k, w := range want {
		if got[k] != w {
			t.Errorf("GPIO_V2_LINE_FLAG_%s = %d, want %d", k, got[k], w)
		}
	}
}

func TestBuildLineRequestOutput(t *testing.T) {
	req, err := buildLineRequest(17, "lintel-controller", lineFlagOutput|lineFlagActiveLow, false, 0)
	if err != nil {
		t.Fatalf("buildLineRequest: %v", err)
	}
	if req.numLines != 1 || req.offsets[0] != 17 {
		t.Errorf("num_lines=%d offsets[0]=%d", req.numLines, req.offsets[0])
	}
	if got := cstr(req.consumer[:]); got != "lintel-controller" {
		t.Errorf("consumer = %q", got)
	}
	if req.consumer[len(req.consumer)-1] != 0 {
		t.Error("consumer field is not NUL-terminated")
	}
	if req.config.flags != lineFlagOutput|lineFlagActiveLow {
		t.Errorf("config.flags = %#x", req.config.flags)
	}
	// The initial level travels as an OUTPUT_VALUES attribute so the kernel
	// applies it as it sets the direction — no window where the relay is
	// driven at an arbitrary level.
	if req.config.numAttrs != 1 {
		t.Fatalf("num_attrs = %d, want 1 (the initial output value)", req.config.numAttrs)
	}
	a := req.config.attrs[0]
	if a.attr.id != lineAttrIDOutputValues || a.mask != 1 || a.attr.value != 0 {
		t.Errorf("attrs[0] = %+v; want OUTPUT_VALUES mask=1 value=0 (de-asserted)", a)
	}
	if a.attr.padding != 0 {
		t.Errorf("attribute padding must be zeroed, got %d", a.attr.padding)
	}
	// Unused tail must stay zero: the kernel reads the whole struct.
	for i := 1; i < gpioV2LineNumAttrsMax; i++ {
		if req.config.attrs[i] != (lineConfigAttribute{}) {
			t.Errorf("attrs[%d] not zeroed", i)
		}
	}
	if req.eventBufferSize != 0 || req.padding != [5]uint32{} || req.fd != 0 {
		t.Error("reserved/padding fields must be zero on the way in")
	}
}

func TestBuildLineRequestInitialAsserted(t *testing.T) {
	req, err := buildLineRequest(0, "x", lineFlagOutput, true, 0)
	if err != nil {
		t.Fatal(err)
	}
	if req.config.attrs[0].attr.value != 1 {
		t.Errorf("initial asserted value = %d, want 1", req.config.attrs[0].attr.value)
	}
}

func TestBuildLineRequestInputWithDebounce(t *testing.T) {
	if !hostIsLittleEndian() {
		t.Skip("debounce union overlay is little-endian only, and is refused elsewhere")
	}
	req, err := buildLineRequest(9, "lintel-controller-sensor", lineFlagInput|lineFlagBiasPullUp, false, 50_000)
	if err != nil {
		t.Fatalf("buildLineRequest: %v", err)
	}
	// An input line takes no OUTPUT_VALUES attribute, so debounce is first.
	if req.config.numAttrs != 1 {
		t.Fatalf("num_attrs = %d, want 1 (debounce only)", req.config.numAttrs)
	}
	a := req.config.attrs[0]
	if a.attr.id != lineAttrIDDebounce || a.attr.value != 50_000 || a.mask != 1 {
		t.Errorf("attrs[0] = %+v; want DEBOUNCE 50000us mask=1", a)
	}
	// debounce_period_us is a __u32 in the union: the high half must be 0
	// or the kernel reads a garbage period.
	if a.attr.value>>32 != 0 {
		t.Errorf("debounce union high half = %#x, want 0", a.attr.value>>32)
	}
}

func TestBuildLineRequestRejects(t *testing.T) {
	if _, err := buildLineRequest(0, "", lineFlagOutput, false, 0); err == nil {
		t.Error("empty consumer accepted")
	}
	long := make([]byte, gpioMaxNameSize)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := buildLineRequest(0, string(long), lineFlagOutput, false, 0); err == nil {
		t.Error("over-long consumer accepted (would drop the NUL terminator)")
	}
	if _, err := buildLineRequest(1<<20, "x", lineFlagOutput, false, 0); err == nil {
		t.Error("absurd line offset accepted")
	}
}

func TestCstr(t *testing.T) {
	b := [8]byte{'g', 'p', 'i', 'o', 0, 'x'}
	if got := cstr(b[:]); got != "gpio" {
		t.Errorf("cstr = %q", got)
	}
	full := [4]byte{'a', 'b', 'c', 'd'}
	if got := cstr(full[:]); got != "abcd" {
		t.Errorf("cstr(unterminated) = %q", got)
	}
}

// The two ABI files must cover the same ground.
//
// gpio_abi_test.go (this file) checks the architecture it runs on;
// gpio_abi_static.go checks every architecture the cross-build targets. A
// struct added here and not there is checked on amd64 and nowhere else — which
// is precisely the gap that motivated the static file, reappearing one struct
// at a time.
//
// Compared by NAME rather than by count, so adding one and removing another
// cannot balance out.
func TestABIAssertionsCoverTheSameStructsAndFields(t *testing.T) {
	runtimeSrc := readSource(t, "gpio_abi_test.go")
	staticSrc := readSource(t, "gpio_abi_static.go")

	sizeOf := regexp.MustCompile(`unsafe\.Sizeof\((\w+)\{\}\)`)
	offsetOf := regexp.MustCompile(`unsafe\.Offsetof\((\w+)\{\}\.(\w+)\)`)

	names := func(src string, re *regexp.Regexp) map[string]bool {
		out := map[string]bool{}
		for _, m := range re.FindAllStringSubmatch(src, -1) {
			out[strings.Join(m[1:], ".")] = true
		}
		return out
	}

	for _, tc := range []struct {
		what string
		re   *regexp.Regexp
	}{
		{"struct sizes", sizeOf},
		{"field offsets", offsetOf},
	} {
		here, there := names(runtimeSrc, tc.re), names(staticSrc, tc.re)
		// A regex that matched nothing would make this pass silently.
		if len(here) < 5 || len(there) < 5 {
			t.Fatalf("%s: extracted %d here and %d there; the pattern stopped matching",
				tc.what, len(here), len(there))
		}
		for n := range here {
			if !there[n] {
				t.Errorf("%s: %s is asserted at runtime but not in gpio_abi_static.go, "+
					"so it is unchecked on arm, arm64 and 386", tc.what, n)
			}
		}
		for n := range there {
			if !here[n] {
				t.Errorf("%s: %s is asserted in gpio_abi_static.go but not here; add the "+
					"readable case so a mismatch names the field", tc.what, n)
			}
		}
	}
}

func readSource(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(b)
}
