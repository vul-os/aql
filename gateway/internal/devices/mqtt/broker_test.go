package mqtt

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// Everything in this package's tests talks to the fake broker below, over
// net.Pipe. No port is opened, no external broker is needed, and no test
// depends on a network stack behaving a particular way: a driver whose tests
// need a real broker cannot be trusted to fail the same way twice.
//
// The fake speaks enough MQTT 3.1.1 to exercise the driver — CONNECT, SUBSCRIBE,
// PUBLISH both ways, PUBACK, PINGREQ — using this package's own codec, so a
// test that passes proves the driver against the same bytes the driver writes.

type connectRec struct {
	clientID     string
	username     string
	password     string
	keepAlive    uint16
	cleanSession bool
	level        byte
	name         string
}

type fakeBroker struct {
	mu sync.Mutex

	cur      *brokerConn
	sessions int
	connects []connectRec
	filters  []subFilter
	got      []publishMsg
	pings    int
	nextID   uint16

	// knobs, all read under mu.
	dialErr    bool
	connack    connackCode
	subackFail bool
	noPuback   bool
	noPingresp bool
	// onPublish runs on the broker's own goroutine for every PUBLISH the client
	// sends. It is how a test makes a device "confirm".
	onPublish func(b *fakeBroker, m publishMsg)

	pubs chan publishMsg
	acks chan uint16
}

func newFakeBroker() *fakeBroker {
	return &fakeBroker{pubs: make(chan publishMsg, 32), acks: make(chan uint16, 32)}
}

type brokerConn struct {
	b    *fakeBroker
	conn net.Conn
	br   *bufio.Reader
	wmu  sync.Mutex
}

func (b *fakeBroker) dial(_ context.Context, _ string) (net.Conn, error) {
	b.mu.Lock()
	refuse := b.dialErr
	b.mu.Unlock()
	if refuse {
		return nil, errors.New("dial refused by the fake broker")
	}
	cli, srv := net.Pipe()
	bc := &brokerConn{b: b, conn: srv, br: bufio.NewReader(srv)}
	go bc.serve()
	return cli, nil
}

func (bc *brokerConn) write(p []byte) error {
	bc.wmu.Lock()
	defer bc.wmu.Unlock()
	_, err := bc.conn.Write(p)
	return err
}

func (bc *brokerConn) serve() {
	defer bc.conn.Close()
	for {
		p, err := readPacket(bc.br, 1<<20)
		if err != nil {
			return
		}
		switch p.typ {
		case ctrlConnect:
			rec := parseConnect(p)
			bc.b.mu.Lock()
			bc.b.connects = append(bc.b.connects, rec)
			bc.b.sessions++
			bc.b.cur = bc
			code := bc.b.connack
			bc.b.mu.Unlock()
			if err := bc.write(frame(ctrlConnack, 0, []byte{0, byte(code)})); err != nil {
				return
			}
			if code != connackAccepted {
				return
			}
		case ctrlSubscribe:
			id, filters := parseSubscribe(p)
			bc.b.mu.Lock()
			bc.b.filters = filters
			fail := bc.b.subackFail
			bc.b.mu.Unlock()
			body := binary.BigEndian.AppendUint16(nil, id)
			for _, f := range filters {
				if fail {
					body = append(body, subackFailure)
				} else {
					body = append(body, f.qos)
				}
			}
			if err := bc.write(frame(ctrlSuback, 0, body)); err != nil {
				return
			}
		case ctrlPublish:
			m, err := decodePublish(p)
			if err != nil {
				return
			}
			bc.b.mu.Lock()
			bc.b.got = append(bc.b.got, m)
			ack := !bc.b.noPuback
			hook := bc.b.onPublish
			bc.b.mu.Unlock()
			select {
			case bc.b.pubs <- m:
			default:
			}
			if m.qos == 1 && ack {
				if err := bc.write(encodePuback(m.packetID)); err != nil {
					return
				}
			}
			if hook != nil {
				hook(bc.b, m)
			}
		case ctrlPuback:
			id, err := decodePacketID(p)
			if err != nil {
				return
			}
			select {
			case bc.b.acks <- id:
			default:
			}
		case ctrlPingreq:
			bc.b.mu.Lock()
			silent := bc.b.noPingresp
			bc.b.pings++
			bc.b.mu.Unlock()
			if silent {
				continue
			}
			if err := bc.write(frame(ctrlPingresp, 0, nil)); err != nil {
				return
			}
		case ctrlDisconnect:
			return
		}
	}
}

// push sends a broker-to-client PUBLISH on the current session.
func (b *fakeBroker) push(t *testing.T, topic, payload string, qos byte) {
	t.Helper()
	b.mu.Lock()
	bc := b.cur
	b.nextID++
	if b.nextID == 0 {
		b.nextID = 1
	}
	id := b.nextID
	b.mu.Unlock()
	if bc == nil {
		t.Fatal("push: no session")
	}
	pkt, err := encodePublish(publishMsg{topic: topic, payload: []byte(payload), qos: qos, packetID: id})
	if err != nil {
		t.Fatalf("push: encode: %v", err)
	}
	if err := bc.write(pkt); err != nil {
		t.Fatalf("push: write: %v", err)
	}
}

// pushRaw sends bytes the codec would refuse to build, so a test can play a
// broker that is broken or hostile rather than merely absent.
func (b *fakeBroker) pushRaw(t *testing.T, pkt []byte) {
	t.Helper()
	b.mu.Lock()
	bc := b.cur
	b.mu.Unlock()
	if bc == nil {
		t.Fatal("pushRaw: no session")
	}
	if err := bc.write(pkt); err != nil {
		t.Fatalf("pushRaw: %v", err)
	}
}

// drop kills the current session the way a broker restart would: no DISCONNECT,
// the socket simply goes away.
func (b *fakeBroker) drop() {
	b.mu.Lock()
	bc := b.cur
	b.cur = nil
	b.mu.Unlock()
	if bc != nil {
		_ = bc.conn.Close()
	}
}

func (b *fakeBroker) pingCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.pings
}

func (b *fakeBroker) sessionCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.sessions
}

func (b *fakeBroker) subscriptions() []subFilter {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]subFilter(nil), b.filters...)
}

func (b *fakeBroker) received() []publishMsg {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]publishMsg(nil), b.got...)
}

func (b *fakeBroker) set(f func(*fakeBroker)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	f(b)
}

// nextPublish waits for one client PUBLISH.
func (b *fakeBroker) nextPublish(t *testing.T) publishMsg {
	t.Helper()
	select {
	case m := <-b.pubs:
		return m
	case <-time.After(3 * time.Second):
		t.Fatal("broker never received a PUBLISH")
		return publishMsg{}
	}
}

func parseConnect(p packet) connectRec {
	name, off, err := readString(p.body, 0)
	if err != nil {
		return connectRec{}
	}
	rec := connectRec{name: name, level: p.body[off], cleanSession: p.body[off+1]&0x02 != 0}
	flags := p.body[off+1]
	rec.keepAlive = binary.BigEndian.Uint16(p.body[off+2:])
	off += 4
	rec.clientID, off, _ = readString(p.body, off)
	if flags&0x80 != 0 {
		rec.username, off, _ = readString(p.body, off)
	}
	if flags&0x40 != 0 {
		rec.password, _, _ = readString(p.body, off)
	}
	return rec
}

func parseSubscribe(p packet) (uint16, []subFilter) {
	id := binary.BigEndian.Uint16(p.body)
	off := 2
	var out []subFilter
	for off < len(p.body) {
		f, next, err := readString(p.body, off)
		if err != nil || next >= len(p.body) {
			return id, out
		}
		out = append(out, subFilter{filter: f, qos: p.body[next]})
		off = next + 1
	}
	return id, out
}

// --- a connection whose writes can be made to fail, for the two publish
// failure modes that a cooperative broker cannot produce.

const (
	writeOK = iota
	writeFailsWithNothingSent
	writeFailsMidPacket
)

type flakyConn struct {
	net.Conn
	mu   sync.Mutex
	mode int
}

func (c *flakyConn) Write(b []byte) (int, error) {
	c.mu.Lock()
	mode := c.mode
	c.mu.Unlock()
	switch mode {
	case writeFailsWithNothingSent:
		return 0, io.ErrClosedPipe
	case writeFailsMidPacket:
		// Genuinely put one byte on the wire before failing: the driver's whole
		// mapping turns on whether anything left this host, so simulating that
		// by returning a number without writing would test the wrong thing.
		n, err := c.Conn.Write(b[:1])
		if err != nil {
			return n, err
		}
		return n, io.ErrClosedPipe
	}
	return c.Conn.Write(b)
}

type flakyDialer struct {
	b     *fakeBroker
	mu    sync.Mutex
	conns []*flakyConn
}

func (fd *flakyDialer) dial(ctx context.Context, addr string) (net.Conn, error) {
	c, err := fd.b.dial(ctx, addr)
	if err != nil {
		return nil, err
	}
	fc := &flakyConn{Conn: c}
	fd.mu.Lock()
	fd.conns = append(fd.conns, fc)
	fd.mu.Unlock()
	return fc, nil
}

func (fd *flakyDialer) arm(t *testing.T, mode int) {
	t.Helper()
	fd.mu.Lock()
	defer fd.mu.Unlock()
	if len(fd.conns) == 0 {
		t.Fatal("arm: no connection yet")
	}
	c := fd.conns[len(fd.conns)-1]
	c.mu.Lock()
	c.mode = mode
	c.mu.Unlock()
}

// --- a clock the tests own, so staleness is exercised without sleeping.

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func newTestClock() *testClock {
	return &testClock{t: time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)}
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}
