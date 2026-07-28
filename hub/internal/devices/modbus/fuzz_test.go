package modbus

import (
	"bytes"
	"math"
	"testing"
)

// The Modbus response path, driven with bytes a device controls.
//
// Everything decoded here arrives over a TCP socket from something on the LAN
// that claims to be a meter. The hub dialled it, so it is not "untrusted" in
// the way a public endpoint is — but "we opened the connection" is not a
// guarantee about what comes back. A meter with firmware that truncates a
// frame, a device that answered on the wrong port, or anything that has taken
// over that address, all reach this code, and a panic here takes down the hub
// process that also opens gates.
//
// The properties below are the ones a fuzzer can hold that examples cannot:
// the unit tests check the frames somebody thought of, and these check the
// frames nobody did.

func FuzzReadADU(f *testing.F) {
	// A well-formed read response: tid 1, protocol 0, length 5, unit 1,
	// fn 0x03, byte count 2, one register.
	f.Add([]byte{0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x02, 0x12, 0x34})
	f.Add([]byte{0x00, 0x01, 0x00, 0x01, 0x00, 0x05, 0x01, 0x03, 0x02, 0x12, 0x34}) // wrong protocol id
	f.Add([]byte{0x00, 0x01, 0x00, 0x00, 0xFF, 0xFF, 0x01})                         // absurd length
	f.Add([]byte{0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01})                         // length 0
	f.Add([]byte{0x00, 0x01, 0x00, 0x00, 0x00, 0x02})                               // header only, no pdu
	f.Add([]byte{})

	f.Fuzz(func(t *testing.T, raw []byte) {
		a, err := readADU(bytes.NewReader(raw))
		if err != nil {
			return // refusing is always allowed; a short or malformed frame is one
		}

		// A PDU longer than the protocol permits means the length guard was
		// bypassed, and the allocation above it is sized from the same field —
		// this is the bound that stops a hostile length from asking for memory
		// the hub does not have.
		if len(a.pdu) > maxPDU {
			t.Fatalf("accepted a %d-byte pdu; maxPDU is %d (from %d bytes in)", len(a.pdu), maxPDU, len(raw))
		}
		// Nothing may be conjured: the frame cannot yield more payload than was
		// fed in, minus the header it consumed.
		if len(a.pdu) > len(raw)-mbapLen {
			t.Fatalf("returned %d pdu bytes from %d input bytes", len(a.pdu), len(raw))
		}
	})
}

// decodeReadResponse is where a device's answer is checked against the request
// that produced it. Believing a mismatched frame is worse than failing: the
// registers would be sliced at the wrong offsets and every metric in the block
// would decode to a plausible wrong number.
func FuzzDecodeReadResponse(f *testing.F) {
	f.Add([]byte{0x03, 0x02, 0x12, 0x34}, uint8(3), uint16(1))
	f.Add([]byte{0x83, 0x02}, uint8(3), uint16(1))       // exception response
	f.Add([]byte{0x03, 0xFF, 0x00}, uint8(3), uint16(1)) // byte count lies
	f.Add([]byte{0x03}, uint8(3), uint16(1))             // too short
	f.Add([]byte{}, uint8(3), uint16(0))

	f.Fuzz(func(t *testing.T, pdu []byte, fnByte uint8, quantity uint16) {
		// Keep quantity inside what a request could legally have asked for; a
		// larger value is rejected before a response is ever read (MaxReadRegisters
		// is capped by the single-byte count field in the response).
		if quantity > MaxReadRegisters {
			t.Skip()
		}
		regs, err := decodeReadResponse(pdu, FunctionCode(fnByte), quantity)
		if err != nil {
			return
		}
		// On success the register count must be exactly what was asked for.
		// Anything else means a caller indexes past the end, or silently reads
		// a shorter block than the metric layout assumes.
		if len(regs) != int(quantity) {
			t.Fatalf("accepted a response yielding %d registers for a request of %d", len(regs), quantity)
		}
		// And every register must have come from the payload, not from
		// zero-value padding: 2 bytes each, after the 2-byte header.
		if len(pdu) < 2+2*int(quantity) {
			t.Fatalf("returned %d registers from a %d-byte pdu", len(regs), len(pdu))
		}
	})
}

// The numeric half. A metric's declared decoding is operator configuration
// applied to device bytes, and both sides can be wrong at once.
func FuzzMetricDecode(f *testing.F) {
	f.Add(uint16(0x1234), uint16(0x5678), "f32", "abcd", 1.0, 0.0)
	f.Add(uint16(0x7FC0), uint16(0x0000), "f32", "abcd", 1.0, 0.0) // NaN bit pattern
	f.Add(uint16(0x7F80), uint16(0x0000), "f32", "abcd", 1.0, 0.0) // +Inf
	f.Add(uint16(0xFFFF), uint16(0xFFFF), "u32", "abcd", 1e308, 0.0)
	f.Add(uint16(0x0001), uint16(0x0000), "u16", "ab", 0.0, -40.0)

	f.Fuzz(func(t *testing.T, r0, r1 uint16, typ, order string, scale, offset float64) {
		m := Metric{
			Metric: "fuzz",
			Type:   RegisterType(typ),
			Order:  WordOrder(order),
			Scale:  scale,
			Offset: offset,
		}
		for _, regs := range [][]uint16{{}, {r0}, {r0, r1}, {r0, r1, r0, r1}} {
			v, err := m.decode(regs)
			if err != nil {
				continue // refusing is always allowed
			}
			// THE property, and the reason this target is worth having: a
			// value that decodes successfully is finite. Several inverters put
			// NaN in a channel that is not currently measuring, and a NaN
			// ingested as energy poisons every aggregate it touches for as
			// long as the row exists — silently, because NaN compares false
			// against every threshold anyone would check it with.
			if math.IsNaN(v) || math.IsInf(v, 0) {
				t.Fatalf("decoded a non-finite value %v from regs=%v type=%q order=%q scale=%v offset=%v",
					v, regs, typ, order, scale, offset)
			}
		}
	})
}
