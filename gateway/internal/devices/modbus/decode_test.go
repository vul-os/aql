package modbus

import (
	"testing"
)

// Decoding is where Modbus silently lies.
//
// A register is sixteen bits and nothing more. Width, signedness, scale and
// word order all live in the vendor's documentation, not on the wire, and there
// is no discovery to fall back on. Get the order wrong and you do not get an
// error — you get a plausible number. A 32-bit float read as CDAB when the
// device meant ABCD comes back as a different, entirely believable power
// reading, and it will be believed: charted, rolled up, and eventually billed
// against.
//
// So these are table tests over the whole matrix rather than a couple of happy
// paths. The bug being guarded against does not announce itself.

func TestDecodeWordOrderMatrix(t *testing.T) {
	// 0x0102_0304 in the four orders a vendor might document, with the same
	// intended value. The register pair is what would be on the wire.
	const want = float64(0x01020304)
	for _, tc := range []struct {
		order WordOrder
		regs  []uint16
	}{
		{OrderABCD, []uint16{0x0102, 0x0304}},
		{OrderBADC, []uint16{0x0201, 0x0403}}, // bytes swapped within each register
		{OrderCDAB, []uint16{0x0304, 0x0102}}, // registers swapped
		{OrderDCBA, []uint16{0x0403, 0x0201}}, // both
	} {
		got, err := decodeRaw(tc.regs, TypeU32, tc.order)
		if err != nil {
			t.Fatalf("%s: %v", tc.order, err)
		}
		if got != want {
			t.Errorf("%s decoded %v, want %v — a wrong word order produces a "+
				"plausible number, not an error, which is why this matrix exists",
				tc.order, got, want)
		}
	}
}

func TestDecodeSignedness(t *testing.T) {
	for _, tc := range []struct {
		name string
		typ  RegisterType
		regs []uint16
		want float64
	}{
		{"u16 max", TypeU16, []uint16{0xFFFF}, 65535},
		{"s16 minus one", TypeS16, []uint16{0xFFFF}, -1},
		{"s16 most negative", TypeS16, []uint16{0x8000}, -32768},
		{"u32 max", TypeU32, []uint16{0xFFFF, 0xFFFF}, 4294967295},
		{"s32 minus one", TypeS32, []uint16{0xFFFF, 0xFFFF}, -1},
		{"s32 most negative", TypeS32, []uint16{0x8000, 0x0000}, -2147483648},
	} {
		got, err := decodeRaw(tc.regs, tc.typ, OrderABCD)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s decoded %v, want %v — reading a signed register as "+
				"unsigned turns a small negative into a huge positive", tc.name, got, tc.want)
		}
	}
}

func TestDecodeFloat32(t *testing.T) {
	// 1.0f is 0x3F800000.
	got, err := decodeRaw([]uint16{0x3F80, 0x0000}, TypeF32, OrderABCD)
	if err != nil {
		t.Fatalf("f32: %v", err)
	}
	if got != 1.0 {
		t.Fatalf("f32 decoded %v, want 1.0", got)
	}
	// The same bytes in CDAB are a wildly different, still-finite number. That
	// is the failure mode: believable, not detectable.
	swapped, err := decodeRaw([]uint16{0x3F80, 0x0000}, TypeF32, OrderCDAB)
	if err != nil {
		t.Fatalf("f32 cdab: %v", err)
	}
	if swapped == 1.0 {
		t.Fatal("expected CDAB to change the value; if it does not, the order " +
			"handling is not doing anything and the matrix test above is vacuous")
	}
}

// A NaN or Inf reading must not reach the engine. Energy rollups treat a
// reading as a number they can sum; one NaN poisons every aggregate that
// touches it, permanently and silently.
func TestNonFiniteReadingsAreRefused(t *testing.T) {
	for _, tc := range []struct {
		name string
		regs []uint16
	}{
		{"quiet NaN", []uint16{0x7FC0, 0x0000}},
		{"positive infinity", []uint16{0x7F80, 0x0000}},
		{"negative infinity", []uint16{0xFF80, 0x0000}},
	} {
		// Metric.decode is the layer the driver uses and the layer that must
		// refuse; decodeRaw is the inner primitive that just turns bytes into a
		// float64, and IEEE 754 has no error to return for NaN.
		m := Metric{Metric: "kw", Type: TypeF32, Order: OrderABCD}
		got, err := m.decode(tc.regs)
		if err == nil {
			t.Errorf("%s decoded to %v with no error — a non-finite reading must "+
				"be refused, because one NaN poisons every rollup that sums it",
				tc.name, got)
		}
	}
}

func TestWrongRegisterCountIsRefused(t *testing.T) {
	// u32 needs two registers. One is not a short read to paper over.
	if _, err := decodeRaw([]uint16{0x0102}, TypeU32, OrderABCD); err == nil {
		t.Fatal("decoding a 32-bit type from one register must be refused, not " +
			"padded — padding invents the missing half of the number")
	}
	if _, err := decodeRaw(nil, TypeU16, OrderABCD); err == nil {
		t.Fatal("decoding from no registers must be refused")
	}
}

func TestUnknownTypeAndOrderAreRefused(t *testing.T) {
	if _, err := decodeRaw([]uint16{0x0001}, RegisterType("u24"), OrderABCD); err == nil {
		t.Fatal("an unknown register type must be refused rather than guessed")
	}
	if _, err := decodeRaw([]uint16{0x0001}, TypeU16, WordOrder("adbc")); err == nil {
		t.Fatal("an unknown word order must be refused; guessing one is how a " +
			"reading becomes plausibly wrong")
	}
	if RegisterType("u24").valid() {
		t.Error("u24 must not validate")
	}
	if WordOrder("adbc").valid() {
		t.Error("adbc must not validate")
	}
}

// Scale and offset are applied after decoding, in that order: raw*Scale+Offset.
// A meter reporting deci-kW needs Scale 0.1, and getting the order wrong here
// is a tenfold error in a billing figure.
func TestScaleAndOffset(t *testing.T) {
	m := Metric{Metric: "kw", Type: TypeU16, Order: OrderABCD, Scale: 0.1, Offset: 5}
	got, err := m.decode([]uint16{100})
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if want := 100*0.1 + 5; got != want {
		t.Fatalf("got %v, want %v — scale must apply before offset", got, want)
	}
}

// Zero is a legitimate value for Offset but not for Scale, so an unset Scale
// must mean 1 rather than annihilating every reading to zero.
func TestUnsetScaleMeansOne(t *testing.T) {
	m := Metric{Metric: "kw", Type: TypeU16, Order: OrderABCD}
	got, err := m.decode([]uint16{42})
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got != 42 {
		t.Fatalf("unset Scale produced %v, want 42 — treating zero as a real "+
			"multiplier would silently zero every reading on the device", got)
	}
}
