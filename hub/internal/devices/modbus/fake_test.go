package modbus

import (
	"encoding/binary"
	"io"
	"math"
	"net"
	"sync"
	"testing"
)

// A Modbus TCP server, in about a hundred lines, because the alternative is
// shipping this driver untested.
//
// The package doc says every byte of this package is exercised against a fake
// server on a loopback listener. This is that server. It speaks real MBAP
// framing rather than replaying canned bytes, so the driver's transaction-id
// matching, unit matching and byte-count handling are all genuinely exercised
// — a canned-response fake would let a framing bug through and still pass.
//
// It is deliberately capable of MISBEHAVING on request: exceptions, wrong unit
// ids, short byte counts, silence. Those are the interesting cases. A fake that
// only ever answers correctly proves the happy path and nothing about the
// failure handling that the rest of this package is mostly made of.

type fakeServer struct {
	t   *testing.T
	ln  net.Listener
	mu  sync.Mutex
	reg map[uint16]uint16 // wire address -> value, holding and input alike

	// Fault injection. All guarded by mu.
	exception   uint8 // non-zero: answer every request with this exception code
	wrongUnit   bool  // answer with a unit id the request did not ask for
	shortCount  bool  // declare more registers than the payload carries
	silent      bool  // accept the connection and never answer
	dropAfter   int   // close the connection after N requests (0 = never)
	served      int   // requests served
	lastUnit    uint8 // unit id of the most recent request
	lastFn      uint8 // function code of the most recent request
	closedConns int
}

func newFakeServer(t *testing.T) *fakeServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeServer{t: t, ln: ln, reg: map[uint16]uint16{}}
	go f.accept()
	t.Cleanup(func() { _ = ln.Close() })
	return f
}

func (f *fakeServer) addr() string { return f.ln.Addr().String() }

func (f *fakeServer) set(addr uint16, values ...uint16) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, v := range values {
		f.reg[addr+uint16(i)] = v
	}
}

// setFloat32 writes a big-endian IEEE-754 float across two registers, which is
// how essentially every real meter reports power.
func (f *fakeServer) setFloat32(addr uint16, v float32) {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], math.Float32bits(v))
	f.set(addr, binary.BigEndian.Uint16(b[0:2]), binary.BigEndian.Uint16(b[2:4]))
}

func (f *fakeServer) accept() {
	for {
		c, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.serve(c)
	}
}

func (f *fakeServer) serve(c net.Conn) {
	defer c.Close()
	for {
		var head [7]byte
		if _, err := io.ReadFull(c, head[:]); err != nil {
			return
		}
		length := binary.BigEndian.Uint16(head[4:6])
		if length < 1 || length > 260 {
			return
		}
		body := make([]byte, length-1) // length counts the unit id, already read
		if _, err := io.ReadFull(c, body); err != nil {
			return
		}

		tid := binary.BigEndian.Uint16(head[0:2])
		unit := head[6]

		f.mu.Lock()
		f.served++
		f.lastUnit = unit
		f.lastFn = body[0]
		silent, exc, wrongUnit, short := f.silent, f.exception, f.wrongUnit, f.shortCount
		drop := f.dropAfter > 0 && f.served >= f.dropAfter
		f.mu.Unlock()

		if silent {
			return // hold the connection open, answer nothing
		}
		if drop {
			f.mu.Lock()
			f.closedConns++
			f.mu.Unlock()
			return
		}

		fn := body[0]
		var pdu []byte
		switch {
		case exc != 0:
			pdu = []byte{fn | 0x80, exc}
		case fn == 0x03 || fn == 0x04:
			start := binary.BigEndian.Uint16(body[1:3])
			count := binary.BigEndian.Uint16(body[3:5])
			payload := make([]byte, 0, count*2)
			f.mu.Lock()
			for i := uint16(0); i < count; i++ {
				payload = binary.BigEndian.AppendUint16(payload, f.reg[start+i])
			}
			f.mu.Unlock()
			declared := byte(count * 2)
			if short {
				declared += 2 // claim more than is there
			}
			pdu = append([]byte{fn, declared}, payload...)
		default:
			pdu = []byte{fn | 0x80, 0x01} // illegal function
		}

		respUnit := unit
		if wrongUnit {
			respUnit = unit + 1
		}
		out := make([]byte, 0, 7+len(pdu))
		out = binary.BigEndian.AppendUint16(out, tid)
		out = binary.BigEndian.AppendUint16(out, 0)
		out = binary.BigEndian.AppendUint16(out, uint16(len(pdu)+1))
		out = append(out, respUnit)
		out = append(out, pdu...)
		if _, err := c.Write(out); err != nil {
			return
		}
	}
}

func (f *fakeServer) requestsServed() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.served
}

func (f *fakeServer) faults(fn func(*fakeServer)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}
