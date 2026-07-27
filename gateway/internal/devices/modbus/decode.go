package modbus

import (
	"encoding/binary"
	"fmt"
	"math"
)

// RegisterType is how a run of 16-bit registers becomes one number.
//
// Modbus transmits registers. It does not transmit types: nothing on the wire
// says whether a register pair is a signed 32-bit counter or an IEEE float, and
// nothing says whether a lone register counts to 65535 or to 32767 and then goes
// negative. Both readings are valid decodes of identical bytes, so the type is
// DECLARED and there is no default that could be right.
type RegisterType string

const (
	TypeU16 RegisterType = "u16"
	TypeS16 RegisterType = "s16"
	TypeU32 RegisterType = "u32"
	TypeS32 RegisterType = "s32"
	TypeU64 RegisterType = "u64"
	TypeS64 RegisterType = "s64"
	// TypeF32 is IEEE 754 binary32. Common on inverters and power meters for
	// instantaneous quantities.
	TypeF32 RegisterType = "f32"
	// TypeF64 is IEEE 754 binary64. Rare, but some energy counters use it.
	TypeF64 RegisterType = "f64"
)

// Registers is how many 16-bit registers the type occupies.
func (t RegisterType) Registers() uint16 {
	switch t {
	case TypeU16, TypeS16:
		return 1
	case TypeU32, TypeS32, TypeF32:
		return 2
	case TypeU64, TypeS64, TypeF64:
		return 4
	}
	return 0
}

func (t RegisterType) valid() bool { return t.Registers() > 0 }

// WordOrder is the byte and register layout of a multi-register value.
//
// This is the single most common cause of a Modbus integration reading a
// plausible wrong number. The specification transmits the high-order register
// first, but a large fraction of real devices do not, and the vendors that do
// not are not consistent with each other. Reading a CDAB device as ABCD does not
// fail — it produces a number, of roughly the right magnitude sometimes, and
// nothing anywhere reports an error.
//
// The four names are the ones vendor manuals use, spelling out where the four
// bytes of a 32-bit value land. Take a value whose bytes are A (most
// significant) through D:
//
//	ABCD  big-endian, high register first. What the specification says.
//	BADC  high register first, bytes swapped inside each register.
//	CDAB  low register first, bytes kept inside each register. The notorious
//	      "word-swapped" or "mid-little" layout. Modicon-derived devices,
//	      most Schneider and many Chinese meters.
//	DCBA  little-endian; every byte reversed.
//
// For values wider than 32 bits the same two independent flips apply: the
// register order is reversed for CDAB and DCBA, and the two bytes inside each
// register are swapped for BADC and DCBA. For a single-register type only the
// byte flip can apply, so ABCD and CDAB are identical there, as are BADC and
// DCBA — declaring a word swap on a 16-bit value is accepted and does nothing.
type WordOrder string

const (
	OrderABCD WordOrder = "abcd"
	OrderBADC WordOrder = "badc"
	OrderCDAB WordOrder = "cdab"
	OrderDCBA WordOrder = "dcba"
)

// flips reports the two independent transformations the order names.
func (w WordOrder) flips() (swapWords, swapBytes bool, ok bool) {
	switch w {
	case OrderABCD:
		return false, false, true
	case OrderBADC:
		return false, true, true
	case OrderCDAB:
		return true, false, true
	case OrderDCBA:
		return true, true, true
	}
	return false, false, false
}

func (w WordOrder) valid() bool { _, _, ok := w.flips(); return ok }

// normalise rewrites a run of registers into specification order (ABCD), so
// that every type decoder below can read plain big-endian bytes. It returns a
// fresh slice; the caller's registers are a slice of a shared block read and
// must not be mutated.
func normalise(regs []uint16, order WordOrder) ([]byte, error) {
	swapWords, swapBytes, ok := order.flips()
	if !ok {
		return nil, fmt.Errorf("modbus: unknown word order %q", string(order))
	}
	out := make([]byte, len(regs)*2)
	for i, r := range regs {
		dst := i
		if swapWords {
			dst = len(regs) - 1 - i
		}
		hi, lo := byte(r>>8), byte(r)
		if swapBytes {
			hi, lo = lo, hi
		}
		out[dst*2] = hi
		out[dst*2+1] = lo
	}
	return out, nil
}

// decodeRaw turns registers into a float64 according to the declared type and
// word order, before scale and offset.
//
// Everything lands in a float64 because devices.Reading.Value is a float64.
// That is exact for u16, s16, u32, s32 and f32, and it is NOT exact for a 64-bit
// integer beyond 2^53 — such a value is rounded to the nearest representable
// double. In practice a Wh counter reaches 2^53 at about nine billion MWh, so
// the limit is real but not one a site meter meets; a device using a 64-bit
// register as a serial number or a bitfield would meet it immediately, and this
// package is not the right way to read either.
func decodeRaw(regs []uint16, typ RegisterType, order WordOrder) (float64, error) {
	want := typ.Registers()
	if want == 0 {
		return 0, fmt.Errorf("modbus: unknown register type %q", string(typ))
	}
	if len(regs) != int(want) {
		return 0, fmt.Errorf("modbus: type %s needs %d register(s), got %d", typ, want, len(regs))
	}
	b, err := normalise(regs, order)
	if err != nil {
		return 0, err
	}
	switch typ {
	case TypeU16:
		return float64(binary.BigEndian.Uint16(b)), nil
	case TypeS16:
		return float64(int16(binary.BigEndian.Uint16(b))), nil
	case TypeU32:
		return float64(binary.BigEndian.Uint32(b)), nil
	case TypeS32:
		return float64(int32(binary.BigEndian.Uint32(b))), nil
	case TypeU64:
		return float64(binary.BigEndian.Uint64(b)), nil
	case TypeS64:
		return float64(int64(binary.BigEndian.Uint64(b))), nil
	case TypeF32:
		return float64(math.Float32frombits(binary.BigEndian.Uint32(b))), nil
	case TypeF64:
		return math.Float64frombits(binary.BigEndian.Uint64(b)), nil
	}
	return 0, fmt.Errorf("modbus: unknown register type %q", string(typ))
}

// decode applies the metric's declared decoding to its registers:
//
//	value = raw * Scale + Offset
//
// Scale exists because a meter that measures to 0.1 kW transmits 0.1 kW as the
// integer 1, and the factor is in a table in a PDF. Offset exists because a
// smaller number of devices bias a reading to keep it unsigned — a temperature
// sent as (celsius + 40) × 10 is Scale 0.1, Offset -40.
//
// A non-finite result is refused rather than recorded. An f32 register holding
// NaN — which is what several inverters put in a channel that is not currently
// measuring — would otherwise be ingested as energy, and NaN poisons every
// aggregate it touches downstream for as long as the row exists.
func (m Metric) decode(regs []uint16) (float64, error) {
	raw, err := decodeRaw(regs, m.Type, m.Order)
	if err != nil {
		return 0, err
	}
	scale := m.Scale
	if scale == 0 {
		// Zero is the field's zero value, not a request to multiply by zero: a
		// config that omitted Scale would otherwise silently record every
		// reading as 0.0, which is indistinguishable from a real zero forever
		// after. validate() rejects an explicit non-finite scale, so this only
		// ever means "unset".
		scale = 1
	}
	v := raw*scale + m.Offset
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("modbus: metric %q decoded to a non-finite value", m.Metric)
	}
	return v, nil
}
