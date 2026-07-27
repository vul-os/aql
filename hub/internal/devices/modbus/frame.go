package modbus

import (
	"encoding/binary"
	"fmt"
	"io"

	"github.com/vul-os/aql/hub/internal/devices"
)

// FunctionCode is a Modbus function code. Only the two read codes are declared:
// this driver is read-only (see the package doc), and a constant for a write
// code that nothing emits is an invitation.
type FunctionCode uint8

const (
	// FCReadHolding is function code 3, read holding registers — the read/write
	// register bank. Most meters and inverters publish here.
	FCReadHolding FunctionCode = 3
	// FCReadInput is function code 4, read input registers — the read-only
	// register bank. Some devices publish measurements here instead, and a few
	// publish the same values in both.
	FCReadInput FunctionCode = 4
)

func (f FunctionCode) String() string {
	switch f {
	case FCReadHolding:
		return "read-holding-registers(3)"
	case FCReadInput:
		return "read-input-registers(4)"
	}
	return fmt.Sprintf("function(%d)", uint8(f))
}

func (f FunctionCode) valid() bool { return f == FCReadHolding || f == FCReadInput }

// Protocol limits, from the Modbus Application Protocol specification v1.1b3.
const (
	// mbapLen is the fixed MBAP header: transaction id (2), protocol id (2),
	// length (2), unit id (1).
	mbapLen = 7
	// maxPDU is the largest PDU the TCP transport allows: 260 bytes on the wire
	// minus the 7-byte MBAP header. The length field counts the unit id plus the
	// PDU, so the largest legal length is maxPDU+1.
	maxPDU = 253
	// MaxReadRegisters is the most registers one FC3/FC4 request may ask for.
	// The limit is the response byte-count field being a single byte: 125
	// registers is 250 bytes of payload, and 126 would not fit alongside the
	// function code and byte count.
	MaxReadRegisters = 125
	// protocolID is 0 for Modbus. Any other value on a response means the peer
	// is not speaking Modbus on this socket, which is a desync, not a device
	// fault.
	protocolID = 0
)

// exception codes, MODBUS Application Protocol v1.1b3 §7.
const (
	excIllegalFunction    = 0x01
	excIllegalDataAddress = 0x02
	excIllegalDataValue   = 0x03
	excServerDeviceFail   = 0x04
	excAcknowledge        = 0x05
	excServerDeviceBusy   = 0x06
	excMemoryParity       = 0x08
	excGatewayPathUnavail = 0x0A
	excGatewayNoResponse  = 0x0B
)

// exceptionError is a well-formed exception response from the device. The
// device answered — it is reachable and speaking Modbus — and declined.
type exceptionError struct {
	fn   FunctionCode
	code uint8
}

func (e exceptionError) Error() string {
	return fmt.Sprintf("device returned exception 0x%02X (%s) for %s", e.code, excText(e.code), e.fn)
}

// Unwrap maps an exception code onto the seam's vocabulary. The mapping is the
// interesting part of this package's honesty, so it is spelled out rather than
// collapsed into "the device said no":
//
//	0x01 illegal function    -> devices.ErrUnsupported. The device is there and
//	                            does not implement this function code at all.
//	                            The usual cause is asking FC3 of a device that
//	                            only publishes input registers.
//	0x0A gateway path unavailable,
//	0x0B gateway target device failed to respond
//	                         -> devices.ErrUnreachable. These two are only ever
//	                            emitted by a TCP-to-serial gateway, and they mean
//	                            the gateway is up but the slave behind it is not.
//	                            The device this hub cares about was NOT contacted,
//	                            which is exactly what ErrUnreachable says. Mapping
//	                            them to a plain failure would make a dead meter
//	                            behind a live gateway indistinguishable from a
//	                            meter that answered with a fault.
//	0x02 illegal data address,
//	0x03 illegal data value  -> plain failure. The device is fine; the configured
//	                            address map does not match it. Not ErrUnsupported:
//	                            the verb is supported, the config is wrong, and an
//	                            operator needs to see the address in the message.
//	0x04, 0x05, 0x06, 0x08   -> plain failure. The device faulted, is busy, or
//	                            needs more time. Nothing was actuated (this driver
//	                            only reads), so a retry is free and there is no
//	                            outcome in doubt.
//
// devices.ErrIndeterminate appears nowhere in that table, and that is a property
// rather than a gap: see Driver.Execute.
func (e exceptionError) Unwrap() error {
	switch e.code {
	case excIllegalFunction:
		return devices.ErrUnsupported
	case excGatewayPathUnavail, excGatewayNoResponse:
		return devices.ErrUnreachable
	}
	return nil
}

func excText(code uint8) string {
	switch code {
	case excIllegalFunction:
		return "illegal function"
	case excIllegalDataAddress:
		return "illegal data address"
	case excIllegalDataValue:
		return "illegal data value"
	case excServerDeviceFail:
		return "server device failure"
	case excAcknowledge:
		return "acknowledge; the request is accepted but not complete"
	case excServerDeviceBusy:
		return "server device busy"
	case excMemoryParity:
		return "memory parity error"
	case excGatewayPathUnavail:
		return "gateway path unavailable"
	case excGatewayNoResponse:
		return "gateway target device failed to respond"
	}
	return "unknown exception code"
}

// protocolError is a response this package could not believe: a bad protocol
// id, an impossible length, a byte count that disagrees with what was asked
// for. It is never a device fault that a retry fixes — the socket is out of
// step — so the caller closes the connection rather than reusing it.
type protocolError struct{ msg string }

func (e protocolError) Error() string { return "malformed response: " + e.msg }

func protoErrf(format string, a ...any) error {
	return protocolError{msg: fmt.Sprintf(format, a...)}
}

// readRequestPDU builds the PDU for FC3/FC4: function code, start address,
// quantity. Callers have already validated quantity against MaxReadRegisters at
// config time; it is checked again here because this function is the only place
// that knows the wire limit.
func readRequestPDU(fn FunctionCode, start, quantity uint16) ([]byte, error) {
	if !fn.valid() {
		return nil, fmt.Errorf("modbus: %s is not a read function code", fn)
	}
	if quantity < 1 || quantity > MaxReadRegisters {
		return nil, fmt.Errorf("modbus: quantity %d is outside 1..%d", quantity, MaxReadRegisters)
	}
	pdu := make([]byte, 5)
	pdu[0] = byte(fn)
	binary.BigEndian.PutUint16(pdu[1:3], start)
	binary.BigEndian.PutUint16(pdu[3:5], quantity)
	return pdu, nil
}

// encodeADU frames a PDU with its MBAP header. The length field counts the unit
// id plus the PDU, which is the one field in the header that is easy to get
// wrong by one.
func encodeADU(tid uint16, unit uint8, pdu []byte) ([]byte, error) {
	if len(pdu) == 0 || len(pdu) > maxPDU {
		return nil, fmt.Errorf("modbus: pdu length %d is outside 1..%d", len(pdu), maxPDU)
	}
	out := make([]byte, mbapLen+len(pdu))
	binary.BigEndian.PutUint16(out[0:2], tid)
	binary.BigEndian.PutUint16(out[2:4], protocolID)
	binary.BigEndian.PutUint16(out[4:6], uint16(len(pdu)+1))
	out[6] = unit
	copy(out[7:], pdu)
	return out, nil
}

// adu is one decoded frame off the wire.
type adu struct {
	tid  uint16
	unit uint8
	pdu  []byte
}

// readADU reads exactly one frame. It reads the fixed header first and then
// exactly as many bytes as the header promised, so a frame is never split
// across two calls and a following frame is never eaten — which is what makes
// skipping a stale response (see endpoint.exchange) possible at all.
//
// A short read at the header is io.EOF or io.ErrUnexpectedEOF and is returned
// as-is: the caller distinguishes "the connection dropped" from "the device sent
// nonsense", and only the second one is a protocolError.
func readADU(r io.Reader) (adu, error) {
	var head [mbapLen]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return adu{}, err
	}
	if got := binary.BigEndian.Uint16(head[2:4]); got != protocolID {
		return adu{}, protoErrf("protocol id is %d, want 0; this socket is not speaking Modbus", got)
	}
	length := binary.BigEndian.Uint16(head[4:6])
	// length counts the unit id plus the PDU, so a PDU of 1..253 is a length of
	// 2..254. Anything else cannot be framed and the socket is unrecoverable.
	if length < 2 || int(length) > maxPDU+1 {
		return adu{}, protoErrf("length field is %d, outside 2..%d", length, maxPDU+1)
	}
	pdu := make([]byte, length-1)
	if _, err := io.ReadFull(r, pdu); err != nil {
		return adu{}, err
	}
	return adu{
		tid:  binary.BigEndian.Uint16(head[0:2]),
		unit: head[6],
		pdu:  pdu,
	}, nil
}

// decodeReadResponse validates a read response against the request that
// produced it and returns the registers.
//
// Every check here is a case where believing the device would be worse than
// failing: a function code that does not echo means the response belongs to a
// different request, and a byte count that disagrees with the quantity asked for
// means the registers would be sliced at the wrong offsets and every metric in
// the block would decode to a plausible wrong number.
func decodeReadResponse(pdu []byte, fn FunctionCode, quantity uint16) ([]uint16, error) {
	if len(pdu) < 2 {
		return nil, protoErrf("pdu is %d bytes, too short to carry a function code and a byte count", len(pdu))
	}
	got := pdu[0]
	if got == byte(fn)|0x80 {
		return nil, exceptionError{fn: fn, code: pdu[1]}
	}
	if got != byte(fn) {
		return nil, protoErrf("function code 0x%02X does not echo the request's 0x%02X", got, byte(fn))
	}
	want := int(quantity) * 2
	byteCount := int(pdu[1])
	if byteCount != want {
		return nil, protoErrf("byte count is %d, want %d for %d registers", byteCount, want, quantity)
	}
	if len(pdu)-2 != byteCount {
		return nil, protoErrf("pdu carries %d payload bytes, byte count says %d", len(pdu)-2, byteCount)
	}
	regs := make([]uint16, quantity)
	for i := range regs {
		regs[i] = binary.BigEndian.Uint16(pdu[2+i*2 : 4+i*2])
	}
	return regs, nil
}
