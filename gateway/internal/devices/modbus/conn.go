package modbus

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// maxStaleSkip bounds how many unmatched frames one exchange will discard
// before giving up on the socket. A handful covers the real case — responses
// orphaned by earlier timed-out requests — while a device that answers every
// frame with the wrong transaction id is broken, not slow, and must not be able
// to hold a poll cycle open indefinitely.
const maxStaleSkip = 8

// endpoint is one TCP connection to one host:port, and the lock that makes it a
// queue.
//
// Modbus TCP devices are famously intolerant of concurrency. A great many
// accept exactly ONE connection, and their behaviour when a second arrives
// ranges from refusing it to accepting it and silently dropping the first.
// Others accept several and then interleave responses badly enough that a
// naive client attributes one register block to another. So: one connection per
// endpoint, and one request in flight on it at a time.
//
// The unit of pooling is the ADDRESS, not the device, because that is what the
// constraint is actually about. Several DeviceConfigs pointing at one
// TCP-to-serial gateway with different UnitIDs are several devices to the
// registry and one socket here, which is both what the gateway wants and what
// the serial bus behind it requires.
type endpoint struct {
	addr    string
	timeout time.Duration
	base    time.Duration
	max     time.Duration

	// mu serialises the whole request/response exchange and guards everything
	// below it. Held across network I/O, which is the point: it is the queue.
	mu        sync.Mutex
	conn      net.Conn
	tid       uint16
	dialFails int
	nextDial  time.Time

	// healthy is read by Driver.Health, which the seam forbids from blocking on
	// the network. It is an atomic rather than a mu-guarded field precisely so
	// that a health check does not queue behind an in-flight poll.
	healthy atomic.Bool
}

func newEndpoint(addr string, timeout, base, max time.Duration) *endpoint {
	e := &endpoint{addr: addr, timeout: timeout, base: base, max: max}
	// Nothing has been tried yet. Unknown is reported as healthy so that a hub
	// with a device it has not polled does not start up asserting a fault; the
	// per-device availability stays devices.AvailUnknown either way, which is
	// what stops an unpolled device rendering as live.
	e.healthy.Store(true)
	return e
}

func unreachablef(format string, a ...any) error {
	return fmt.Errorf("modbus: "+format+": %w", append(a, devices.ErrUnreachable)...)
}

// exchange sends one PDU and returns the response PDU.
//
// It handles the transport and the framing only: transaction matching, unit
// matching and MBAP validity. Whether the response PDU says what the caller
// hoped — the function code echo, an exception, a byte count — is decoded by the
// caller, because those are semantic failures that leave the socket perfectly
// well framed and do not justify tearing a scarce connection down.
//
// Retry, precisely: at most two attempts, and the second only when the first
// used an ALREADY-OPEN connection. A Modbus device that drops an idle
// connection does so silently, so the failure surfaces as an EOF on the next
// write or read, and re-dialling is the only way to tell that apart from a dead
// device. Re-issuing the request is safe because this driver only ever reads —
// if a write path is ever added, this retry must not cover it, and the honest
// outcome of a lost write response is devices.ErrIndeterminate.
func (e *endpoint) exchange(ctx context.Context, unit uint8, pdu []byte) ([]byte, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	deadline := time.Now().Add(e.timeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		fresh := false
		if e.conn == nil {
			if wait := time.Until(e.nextDial); wait > 0 {
				e.healthy.Store(false)
				return nil, unreachablef("%s is in a reconnect backoff for another %s after %d "+
					"failed dial(s)", e.addr, wait.Round(time.Millisecond), e.dialFails)
			}
			if err := ctx.Err(); err != nil {
				e.healthy.Store(false)
				return nil, unreachablef("%s: %s before the request was sent", e.addr, ctxCause(err))
			}
			dialer := net.Dialer{Deadline: deadline}
			c, err := dialer.DialContext(ctx, "tcp", e.addr)
			if err != nil {
				e.noteDialFailure()
				e.healthy.Store(false)
				// The request never reached the wire, so nothing happened.
				return nil, unreachablef("%s: %s", e.addr, dialCause(err))
			}
			e.conn = c
			e.dialFails = 0
			e.nextDial = time.Time{}
			fresh = true
		}

		resp, err := e.roundTrip(ctx, deadline, unit, pdu)
		if err == nil {
			e.healthy.Store(true)
			return resp, nil
		}

		// Any failure here leaves the socket's framing in doubt, so it is closed
		// rather than handed to the next caller half-consumed.
		e.closeLocked()
		lastErr = err

		var pe protocolError
		if errors.As(err, &pe) {
			// The peer is not speaking Modbus correctly on this socket. A retry
			// would produce the same nonsense and burn the device's single
			// connection slot doing it.
			e.healthy.Store(false)
			return nil, fmt.Errorf("modbus: %s: %w", e.addr, err)
		}
		if fresh || time.Now().After(deadline) || ctx.Err() != nil {
			break
		}
		// Reused connection, transport error, time left: the classic silently
		// dropped Modbus connection. Dial again and re-issue.
	}

	e.healthy.Store(false)
	if cerr := ctx.Err(); cerr != nil {
		// A cancelled context surfaces as a deadline error on the socket,
		// because that is how cancellation is delivered to a blocking read.
		// Report what actually happened.
		return nil, unreachablef("%s: %s", e.addr, ctxCause(cerr))
	}
	return nil, unreachablef("%s: %s", e.addr, transportCause(lastErr))
}

// roundTrip writes one request and reads until the matching response arrives.
func (e *endpoint) roundTrip(ctx context.Context, deadline time.Time, unit uint8, pdu []byte) ([]byte, error) {
	conn := e.conn
	// A deadline on the socket does not interrupt a blocking read when the
	// caller's context is cancelled early, so cancellation is wired to the
	// deadline. net.Conn deadlines are safe to set concurrently.
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stop()
	if err := conn.SetDeadline(deadline); err != nil {
		return nil, err
	}

	e.tid++
	tid := e.tid
	frame, err := encodeADU(tid, unit, pdu)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Write(frame); err != nil {
		return nil, err
	}

	for skipped := 0; ; skipped++ {
		in, err := readADU(conn)
		if err != nil {
			return nil, err
		}
		if in.tid != tid {
			// A response to a request that already timed out. Discarding it is
			// the whole reason transaction ids exist: returning it would
			// attribute one device's registers to the next request on this
			// socket, which for a shared gateway means one meter's reading
			// filed under another meter's name.
			if skipped >= maxStaleSkip {
				return nil, protoErrf("received %d frames with unmatched transaction ids while "+
					"waiting for 0x%04X", skipped+1, tid)
			}
			continue
		}
		if in.unit != unit {
			// Matching transaction id, wrong unit: the peer is confused about
			// its own conversation, and nothing on this socket can be trusted.
			return nil, protoErrf("response to transaction 0x%04X came from unit %d, want %d",
				tid, in.unit, unit)
		}
		return in.pdu, nil
	}
}

// noteDialFailure applies the bounded backoff. It doubles from base to max, so
// a site whose plant-room switch is off does not spend the day re-dialling it,
// and a meter that comes back is picked up within max regardless.
func (e *endpoint) noteDialFailure() {
	e.dialFails++
	wait := e.base
	for i := 1; i < e.dialFails && wait < e.max; i++ {
		wait *= 2
	}
	if wait > e.max {
		wait = e.max
	}
	e.nextDial = time.Now().Add(wait)
}

func (e *endpoint) closeLocked() {
	if e.conn != nil {
		_ = e.conn.Close()
		e.conn = nil
	}
}

// close is used on driver shutdown.
func (e *endpoint) close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closeLocked()
}

// ok reports the endpoint's last known state without touching the network or
// the exchange lock.
func (e *endpoint) ok() bool { return e.healthy.Load() }

// dialCause classifies a dial failure into short operator-facing text. The
// address is carried separately by the caller — Modbus has no credentials, so
// unlike an HTTP URL there is nothing in it to redact.
func dialCause(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "the connection attempt timed out"
	case errors.Is(err, context.Canceled):
		return "the connection attempt was cancelled"
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "the name did not resolve"
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Timeout() {
		return "the connection attempt timed out"
	}
	return "the connection was refused or failed"
}

// transportCause classifies a mid-exchange failure. An EOF here is the
// signature of a device that accepts one connection and drops it, which is
// worth naming distinctly because the fix is a poll interval, not a cable.
func transportCause(err error) string {
	switch {
	case err == nil:
		return "the request failed"
	case errors.Is(err, context.DeadlineExceeded):
		return "the device did not answer in time"
	case errors.Is(err, context.Canceled):
		return "the request was cancelled"
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Timeout() {
		return "the device did not answer in time"
	}
	if isEOF(err) {
		return "the device closed the connection without answering"
	}
	return "the connection failed"
}

func ctxCause(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "the deadline passed"
	}
	return "the request was cancelled"
}

// isEOF reports whether the peer closed mid-frame or between frames.
func isEOF(err error) bool {
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
