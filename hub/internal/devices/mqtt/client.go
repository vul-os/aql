package mqtt

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"
)

// Sentinel results from the client's publish path. The driver maps them onto
// the devices package's errors; the client itself never returns a devices error
// because the honest mapping depends on the verb's tier, which only the driver
// knows.
var (
	// errNotConnected — no broker link at all. Nothing was written, so nothing
	// can possibly have happened.
	errNotConnected = errors.New("mqtt: not connected to broker")
	// errPartialWrite — the write to the socket failed after some bytes had
	// already left this host. Whether the broker saw a whole packet is unknown.
	errPartialWrite = errors.New("mqtt: write to broker failed mid-packet")
	// errWriteFailed — the write failed having written nothing.
	errWriteFailed = errors.New("mqtt: write to broker failed")
	// errAckTimeout — QoS 1 PUBLISH went out but no PUBACK came back.
	errAckTimeout = errors.New("mqtt: no PUBACK from broker")
)

// session is one live TCP (or TLS) connection to the broker. Writes are
// serialised per session so two concurrent publishes cannot interleave bytes.
type session struct {
	conn net.Conn
	br   *bufio.Reader
	wmu  sync.Mutex
}

// write sends a whole packet. The reported int is how many bytes reached the
// socket, which is what lets the caller tell "nothing was sent" from "something
// was sent and we do not know what the broker made of it".
func (s *session) write(b []byte) (int, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	return s.conn.Write(b)
}

// clientConfig is the transport-level half of Config, split out so the client
// can be tested without any device mapping.
type clientConfig struct {
	addr           string
	clientID       string
	username       string
	password       string
	dial           func(ctx context.Context, addr string) (net.Conn, error)
	keepAlive      time.Duration
	connectTimeout time.Duration
	ackTimeout     time.Duration
	maxPacket      int
	reconnectMin   time.Duration
	reconnectMax   time.Duration
	subs           []subFilter
	now            func() time.Time
	logf           func(string, ...any)

	// onMessage is called for every inbound PUBLISH, from the read loop's
	// goroutine. It must not block.
	onMessage func(topic string, payload []byte, at time.Time)
	// onDown is called once per lost or failed session, after the client has
	// marked itself down. It must not block.
	onDown func(reason string)
	// onUp is called once per established session, after subscriptions are
	// acknowledged.
	onUp func()
}

// client is a minimal MQTT 3.1.1 client: connect, subscribe, publish at QoS 0
// or 1, keepalive, and reconnect. See the package doc for what it does not do.
type client struct {
	cfg clientConfig

	mu       sync.Mutex
	cur      *session
	up       bool
	reason   string
	since    time.Time
	nextID   uint16
	pubAcks  map[uint16]chan bool
	lastRecv time.Time

	closeOnce sync.Once
	closed    chan struct{}
	done      chan struct{}
}

func newClient(cfg clientConfig) *client {
	c := &client{
		cfg:     cfg,
		pubAcks: map[uint16]chan bool{},
		since:   cfg.now(),
		reason:  "not connected yet",
		closed:  make(chan struct{}),
		done:    make(chan struct{}),
	}
	return c
}

func (c *client) start() {
	go c.supervise()
}

// state reports the current link state, the fixed-vocabulary reason for it, and
// when that state began. It never touches the network.
func (c *client) state() (up bool, reason string, since time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.up, c.reason, c.since
}

// supervise owns the connection lifecycle: dial, handshake, subscribe, pump,
// and on any failure back off and try again until Close.
//
// Backoff is exponential and bounded, and carries no jitter on purpose: a hub
// is a single client against a single broker, so there is no herd to spread,
// and a deterministic schedule is one an operator can reason about from a log.
func (c *client) supervise() {
	defer close(c.done)
	delay := c.cfg.reconnectMin
	for {
		select {
		case <-c.closed:
			return
		default:
		}

		reason, connected := c.runSession()
		if connected {
			// A session that actually came up resets the ladder; a broker that
			// restarts should not inherit an hour-long backoff.
			delay = c.cfg.reconnectMin
		}
		c.markDown(reason)
		if c.cfg.onDown != nil {
			c.cfg.onDown(reason)
		}

		select {
		case <-c.closed:
			return
		case <-time.After(delay):
		}
		delay *= 2
		if delay > c.cfg.reconnectMax {
			delay = c.cfg.reconnectMax
		}
	}
}

// runSession dials, handshakes and pumps one session to completion. It returns
// the fixed-vocabulary reason the session ended and whether it ever came up.
func (c *client) runSession() (reason string, cameUp bool) {
	ctx, cancel := context.WithTimeout(context.Background(), c.cfg.connectTimeout)
	defer cancel()
	conn, err := c.cfg.dial(ctx, c.cfg.addr)
	if err != nil {
		// The dial error text routinely contains the broker's host and port,
		// which Health.Detail must not carry. Classify, do not quote.
		return "broker unreachable: dial failed", false
	}
	s := &session{conn: conn, br: bufio.NewReader(conn)}

	if err := c.handshake(s); err != nil {
		_ = conn.Close()
		return err.Error(), false
	}

	c.mu.Lock()
	c.cur = s
	c.up = true
	c.reason = "connected"
	c.since = c.cfg.now()
	c.lastRecv = c.cfg.now()
	c.mu.Unlock()
	if c.cfg.onUp != nil {
		c.cfg.onUp()
	}

	stop := make(chan struct{})
	var pingWG sync.WaitGroup
	pingWG.Add(1)
	go func() {
		defer pingWG.Done()
		c.keepalive(s, stop)
	}()

	reason = c.pump(s)
	close(stop)
	_ = conn.Close()
	pingWG.Wait()
	return reason, true
}

// handshake performs CONNECT/CONNACK then SUBSCRIBE/SUBACK synchronously, with
// the connect deadline applied, before any concurrent reader exists.
func (c *client) handshake(s *session) error {
	// Network deadlines use the real clock: cfg.now may be a test clock, and a
	// fake time would produce a deadline the kernel cannot honour.
	_ = s.conn.SetDeadline(time.Now().Add(c.cfg.connectTimeout))
	defer func() { _ = s.conn.SetDeadline(time.Time{}) }()

	ka := uint16(c.cfg.keepAlive / time.Second)
	pkt, err := encodeConnect(c.cfg.clientID, c.cfg.username, c.cfg.password, ka)
	if err != nil {
		return errors.New("client misconfigured: CONNECT could not be built")
	}
	if _, err := s.write(pkt); err != nil {
		return errors.New("broker unreachable: CONNECT not sent")
	}
	p, err := readPacket(s.br, c.cfg.maxPacket)
	if err != nil {
		return errors.New("broker unreachable: no CONNACK")
	}
	_, code, err := decodeConnack(p)
	if err != nil {
		return errors.New("broker spoke something other than MQTT 3.1.1")
	}
	if code != connackAccepted {
		return errors.New(code.reason())
	}

	if len(c.cfg.subs) == 0 {
		return nil
	}
	id := c.takePacketID()
	sub, err := encodeSubscribe(id, c.cfg.subs)
	if err != nil {
		return errors.New("client misconfigured: SUBSCRIBE could not be built")
	}
	if _, err := s.write(sub); err != nil {
		return errors.New("broker unreachable: SUBSCRIBE not sent")
	}
	// The read loop is not running yet, so read the SUBACK here. A broker may
	// legally interleave PUBLISHes (retained state on a fresh subscription
	// arrives immediately), so deliver anything that is not our SUBACK rather
	// than discarding it.
	for {
		p, err := readPacket(s.br, c.cfg.maxPacket)
		if err != nil {
			return errors.New("broker unreachable: no SUBACK")
		}
		if p.typ == ctrlPublish {
			c.deliver(s, p)
			continue
		}
		if p.typ != ctrlSuback {
			continue
		}
		gotID, codes, err := decodeSuback(p)
		if err != nil || gotID != id {
			return errors.New("broker sent a malformed SUBACK")
		}
		for _, code := range codes {
			if code == subackFailure {
				// Failing closed: a driver whose telemetry subscription was
				// refused would report readings that can never update.
				return errors.New("broker refused a telemetry subscription")
			}
		}
		return nil
	}
}

// pump is the read loop. It returns the reason the session ended.
func (c *client) pump(s *session) string {
	for {
		p, err := readPacket(s.br, c.cfg.maxPacket)
		if err != nil {
			select {
			case <-c.closed:
				return "closed"
			default:
			}
			if errors.Is(err, errPacketSize) {
				return "connection dropped: broker sent an oversized packet"
			}
			if errors.Is(err, errProtocol) {
				return "connection dropped: protocol violation from broker"
			}
			return "connection lost"
		}
		c.mu.Lock()
		c.lastRecv = c.cfg.now()
		c.mu.Unlock()

		switch p.typ {
		case ctrlPublish:
			c.deliver(s, p)
		case ctrlPuback:
			id, err := decodePacketID(p)
			if err != nil {
				return "connection dropped: malformed PUBACK"
			}
			c.mu.Lock()
			if ch, ok := c.pubAcks[id]; ok {
				delete(c.pubAcks, id)
				ch <- true
			}
			c.mu.Unlock()
		case ctrlSuback:
			// The only SUBSCRIBE we send is acknowledged inline during the
			// handshake, before this loop starts. A later SUBACK is the
			// broker's business, not ours.
		case ctrlPingresp:
			// lastRecv already updated.
		default:
			// PUBREC/PUBREL/PUBCOMP would mean the broker started a QoS 2 flow
			// we never asked for. We cannot complete it, so drop the link
			// rather than leave a half-open exchange the broker will retry.
			return fmt.Sprintf("connection dropped: unexpected packet type %d", p.typ)
		}
	}
}

// deliver hands an inbound PUBLISH to the driver and acknowledges QoS 1.
func (c *client) deliver(s *session, p packet) {
	m, err := decodePublish(p)
	if err != nil {
		c.cfg.logf("mqtt: dropping malformed PUBLISH")
		return
	}
	if m.qos == 2 {
		// We subscribe at QoS 1 at most, so a compliant broker never sends
		// this. We have no QoS 2 flow, and acknowledging one we cannot finish
		// would be worse than dropping it.
		c.cfg.logf("mqtt: dropping QoS 2 message on %q; QoS 2 is not implemented", m.topic)
		return
	}
	if m.qos == 1 {
		if _, err := s.write(encodePuback(m.packetID)); err != nil {
			c.cfg.logf("mqtt: PUBACK for inbound message could not be sent")
		}
	}
	if c.cfg.onMessage != nil {
		c.cfg.onMessage(m.topic, m.payload, c.cfg.now())
	}
}

// keepalive pings at half the keepalive interval and kills a session that has
// gone quiet for one and a half intervals. Without this, a silently dropped
// link (a NAT timeout, a broker that vanished) would leave the driver
// reporting healthy indefinitely while readings quietly went stale.
func (c *client) keepalive(s *session, stop <-chan struct{}) {
	if c.cfg.keepAlive <= 0 {
		return
	}
	tick := time.NewTicker(c.cfg.keepAlive / 2)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case <-c.closed:
			return
		case <-tick.C:
			c.mu.Lock()
			last := c.lastRecv
			c.mu.Unlock()
			if c.cfg.now().Sub(last) > c.cfg.keepAlive*3/2 {
				_ = s.conn.Close() // unblocks pump, which ends the session
				return
			}
			if _, err := s.write(encodePingreq()); err != nil {
				_ = s.conn.Close()
				return
			}
		}
	}
}

func (c *client) takePacketID() uint16 {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.nextID++
	if c.nextID == 0 {
		c.nextID = 1
	}
	return c.nextID
}

func (c *client) markDown(reason string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cur = nil
	if c.up || c.reason != reason {
		c.since = c.cfg.now()
	}
	c.up = false
	c.reason = reason
	// Nobody will ever ack these now. Release the waiters so a publish blocked
	// on a PUBACK fails immediately rather than at its timeout.
	for id, ch := range c.pubAcks {
		delete(c.pubAcks, id)
		close(ch)
	}
}

// publishResult records exactly how far one publish got. The driver turns this
// into an error; the client does not decide, because how much evidence a caller
// needs depends on the verb.
type publishResult struct {
	// sent is true once any byte of the PUBLISH reached the socket.
	sent bool
	// brokerAcked is true only when a QoS 1 PUBACK came back. It says the
	// BROKER holds the message. It says nothing about the device.
	brokerAcked bool
}

// publish sends one PUBLISH, waiting for the PUBACK at QoS 1.
func (c *client) publish(ctx context.Context, m publishMsg, qos byte) (publishResult, error) {
	var res publishResult
	if qos > 0 {
		m.packetID = c.takePacketID()
		m.qos = qos
	}
	pkt, err := encodePublish(m)
	if err != nil {
		return res, err
	}

	c.mu.Lock()
	s := c.cur
	var ack chan bool
	if s != nil && qos > 0 {
		ack = make(chan bool, 1)
		c.pubAcks[m.packetID] = ack
	}
	c.mu.Unlock()

	if s == nil {
		return res, errNotConnected
	}
	n, err := s.write(pkt)
	if err != nil {
		c.forgetAck(m.packetID)
		if n == 0 {
			return res, errWriteFailed
		}
		res.sent = true
		return res, errPartialWrite
	}
	res.sent = true
	if qos == 0 {
		return res, nil
	}

	timeout := time.NewTimer(c.cfg.ackTimeout)
	defer timeout.Stop()
	select {
	case acked := <-ack:
		// markDown closes the waiter when the link drops, which reads as false
		// here: a released waiter is not a PUBACK.
		if !acked {
			return res, errAckTimeout
		}
		res.brokerAcked = true
		return res, nil
	case <-ctx.Done():
		c.forgetAck(m.packetID)
		return res, ctx.Err()
	case <-timeout.C:
		c.forgetAck(m.packetID)
		return res, errAckTimeout
	case <-c.closed:
		c.forgetAck(m.packetID)
		return res, errAckTimeout
	}
}

func (c *client) forgetAck(id uint16) {
	c.mu.Lock()
	delete(c.pubAcks, id)
	c.mu.Unlock()
}

// Close stops the supervisor and drops the connection. It is idempotent.
func (c *client) Close() error {
	c.closeOnce.Do(func() {
		close(c.closed)
		c.mu.Lock()
		s := c.cur
		c.mu.Unlock()
		if s != nil {
			// Best effort: a DISCONNECT tells the broker this was deliberate.
			_, _ = s.write(encodeDisconnect())
			_ = s.conn.Close()
		}
	})
	<-c.done
	c.markDown("closed")
	return nil
}
