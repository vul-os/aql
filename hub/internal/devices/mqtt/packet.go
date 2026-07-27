package mqtt

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// MQTT 3.1.1 control packet types (OASIS mqtt-v3.1.1 §2.2.1). Only the ones
// this client uses are named; anything else read off the wire is a protocol
// error, because we never send a packet that could provoke one.
const (
	ctrlConnect     byte = 1
	ctrlConnack     byte = 2
	ctrlPublish     byte = 3
	ctrlPuback      byte = 4
	ctrlSubscribe   byte = 8
	ctrlSuback      byte = 9
	ctrlPingreq     byte = 12
	ctrlPingresp    byte = 13
	ctrlDisconnect  byte = 14
	protocolName         = "MQTT"
	protocolLevel   byte = 4 // 3.1.1
	subackFailure   byte = 0x80
	maxRemainingLen      = 268435455 // 256 MB, the protocol ceiling
)

var (
	errProtocol   = errors.New("mqtt: protocol violation")
	errPacketSize = errors.New("mqtt: packet exceeds configured maximum")
)

// packet is one decoded control packet: its type, the four header flag bits,
// and the variable header plus payload as raw bytes.
type packet struct {
	typ   byte
	flags byte
	body  []byte
}

// encodeRemainingLength appends MQTT's variable-length integer (§2.2.3).
func encodeRemainingLength(dst []byte, n int) []byte {
	for {
		digit := byte(n % 128)
		n /= 128
		if n > 0 {
			digit |= 0x80
		}
		dst = append(dst, digit)
		if n == 0 {
			return dst
		}
	}
}

// readRemainingLength decodes the variable-length integer. It refuses a fifth
// continuation byte rather than looping: a malformed length is the cheapest way
// for a broken or hostile broker to make a client allocate without bound.
func readRemainingLength(r *bufio.Reader) (int, error) {
	var value, multiplier int
	for i := 0; i < 4; i++ {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		value += int(b&0x7f) << multiplier
		if b&0x80 == 0 {
			return value, nil
		}
		multiplier += 7
	}
	return 0, fmt.Errorf("%w: remaining length longer than 4 bytes", errProtocol)
}

// appendString appends an MQTT UTF-8 string: two-byte big-endian length then
// the bytes.
func appendString(dst []byte, s string) []byte {
	dst = binary.BigEndian.AppendUint16(dst, uint16(len(s)))
	return append(dst, s...)
}

func validString(s string) error {
	if len(s) > 65535 {
		return fmt.Errorf("%w: string longer than 65535 bytes", errProtocol)
	}
	if !utf8.ValidString(s) {
		return fmt.Errorf("%w: string is not valid UTF-8", errProtocol)
	}
	if strings.ContainsRune(s, 0) {
		return fmt.Errorf("%w: string contains a null character", errProtocol)
	}
	return nil
}

// readString reads a length-prefixed string from body at off, returning the
// string and the next offset.
func readString(body []byte, off int) (string, int, error) {
	if off+2 > len(body) {
		return "", 0, fmt.Errorf("%w: truncated string length", errProtocol)
	}
	n := int(binary.BigEndian.Uint16(body[off:]))
	off += 2
	if off+n > len(body) {
		return "", 0, fmt.Errorf("%w: truncated string body", errProtocol)
	}
	return string(body[off : off+n]), off + n, nil
}

// readPacket reads one control packet. maxBody caps the body we are willing to
// allocate; a larger declared length is refused before the allocation, not
// after.
func readPacket(r *bufio.Reader, maxBody int) (packet, error) {
	head, err := r.ReadByte()
	if err != nil {
		return packet{}, err
	}
	length, err := readRemainingLength(r)
	if err != nil {
		return packet{}, err
	}
	if length < 0 || length > maxRemainingLen {
		return packet{}, fmt.Errorf("%w: absurd remaining length", errProtocol)
	}
	if maxBody > 0 && length > maxBody {
		return packet{}, fmt.Errorf("%w: %d bytes", errPacketSize, length)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return packet{}, err
	}
	return packet{typ: head >> 4, flags: head & 0x0f, body: body}, nil
}

// encodeConnect builds a CONNECT packet. Clean session is always set: this
// client keeps no persistent session state, so asking the broker to hold one
// for us would leak queued messages we would never process.
func encodeConnect(clientID, username, password string, keepAliveSeconds uint16) ([]byte, error) {
	for _, s := range []string{clientID, username, password} {
		if err := validString(s); err != nil {
			return nil, err
		}
	}
	if clientID == "" {
		return nil, fmt.Errorf("%w: empty client id", errProtocol)
	}
	var flags byte = 0x02 // clean session
	if username != "" {
		flags |= 0x80
	}
	if password != "" {
		flags |= 0x40
	}
	var body []byte
	body = appendString(body, protocolName)
	body = append(body, protocolLevel, flags)
	body = binary.BigEndian.AppendUint16(body, keepAliveSeconds)
	body = appendString(body, clientID)
	if username != "" {
		body = appendString(body, username)
	}
	if password != "" {
		body = appendString(body, password)
	}
	return frame(ctrlConnect, 0, body), nil
}

// connackCode is the broker's answer to CONNECT (§3.2.2.3).
type connackCode byte

const (
	connackAccepted           connackCode = 0
	connackBadProtocolVersion connackCode = 1
	connackIdentifierRejected connackCode = 2
	connackServerUnavailable  connackCode = 3
	connackBadCredentials     connackCode = 4
	connackNotAuthorised      connackCode = 5
)

// reason is deliberately a fixed vocabulary. It is surfaced through
// devices.Health.Detail, whose contract forbids credentials and addresses, so
// it must never be built from an error string that could contain either.
func (c connackCode) reason() string {
	switch c {
	case connackAccepted:
		return "accepted"
	case connackBadProtocolVersion:
		return "broker refused: unacceptable protocol version"
	case connackIdentifierRejected:
		return "broker refused: client identifier rejected"
	case connackServerUnavailable:
		return "broker refused: server unavailable"
	case connackBadCredentials:
		return "broker refused: bad username or password"
	case connackNotAuthorised:
		return "broker refused: not authorised"
	}
	return "broker refused: unknown return code"
}

func decodeConnack(p packet) (sessionPresent bool, code connackCode, err error) {
	if p.typ != ctrlConnack {
		return false, 0, fmt.Errorf("%w: expected CONNACK, got packet type %d", errProtocol, p.typ)
	}
	if len(p.body) != 2 {
		return false, 0, fmt.Errorf("%w: CONNACK body is %d bytes", errProtocol, len(p.body))
	}
	return p.body[0]&0x01 == 1, connackCode(p.body[1]), nil
}

// publishMsg is an inbound or outbound PUBLISH.
type publishMsg struct {
	topic    string
	payload  []byte
	qos      byte
	retain   bool
	packetID uint16
}

func encodePublish(m publishMsg) ([]byte, error) {
	if err := validString(m.topic); err != nil {
		return nil, err
	}
	if m.topic == "" {
		return nil, fmt.Errorf("%w: empty publish topic", errProtocol)
	}
	if strings.ContainsAny(m.topic, "+#") {
		return nil, fmt.Errorf("%w: publish topic contains a wildcard", errProtocol)
	}
	if m.qos > 1 {
		return nil, fmt.Errorf("%w: QoS %d not implemented", errProtocol, m.qos)
	}
	if m.qos > 0 && m.packetID == 0 {
		return nil, fmt.Errorf("%w: QoS 1 publish needs a non-zero packet id", errProtocol)
	}
	var flags byte
	flags |= m.qos << 1
	if m.retain {
		flags |= 0x01
	}
	body := appendString(nil, m.topic)
	if m.qos > 0 {
		body = binary.BigEndian.AppendUint16(body, m.packetID)
	}
	body = append(body, m.payload...)
	return frame(ctrlPublish, flags, body), nil
}

func decodePublish(p packet) (publishMsg, error) {
	if p.typ != ctrlPublish {
		return publishMsg{}, fmt.Errorf("%w: expected PUBLISH, got packet type %d", errProtocol, p.typ)
	}
	m := publishMsg{
		qos:    (p.flags >> 1) & 0x03,
		retain: p.flags&0x01 == 1,
	}
	if m.qos > 2 {
		return publishMsg{}, fmt.Errorf("%w: PUBLISH with QoS 3", errProtocol)
	}
	topic, off, err := readString(p.body, 0)
	if err != nil {
		return publishMsg{}, err
	}
	m.topic = topic
	if m.qos > 0 {
		if off+2 > len(p.body) {
			return publishMsg{}, fmt.Errorf("%w: truncated PUBLISH packet id", errProtocol)
		}
		m.packetID = binary.BigEndian.Uint16(p.body[off:])
		off += 2
	}
	m.payload = p.body[off:]
	return m, nil
}

func encodePuback(packetID uint16) []byte {
	return frame(ctrlPuback, 0, binary.BigEndian.AppendUint16(nil, packetID))
}

func decodePacketID(p packet) (uint16, error) {
	if len(p.body) < 2 {
		return 0, fmt.Errorf("%w: packet type %d has no packet id", errProtocol, p.typ)
	}
	return binary.BigEndian.Uint16(p.body), nil
}

// subFilter is one topic filter and the QoS we are willing to receive it at.
type subFilter struct {
	filter string
	qos    byte
}

func encodeSubscribe(packetID uint16, filters []subFilter) ([]byte, error) {
	if len(filters) == 0 {
		return nil, fmt.Errorf("%w: SUBSCRIBE with no filters", errProtocol)
	}
	if packetID == 0 {
		return nil, fmt.Errorf("%w: SUBSCRIBE needs a non-zero packet id", errProtocol)
	}
	body := binary.BigEndian.AppendUint16(nil, packetID)
	for _, f := range filters {
		if err := ValidateFilter(f.filter); err != nil {
			return nil, err
		}
		if f.qos > 1 {
			return nil, fmt.Errorf("%w: subscribing at QoS %d is not implemented", errProtocol, f.qos)
		}
		body = appendString(body, f.filter)
		body = append(body, f.qos)
	}
	// Bits 3..0 of a SUBSCRIBE fixed header are reserved and MUST be 0b0010.
	return frame(ctrlSubscribe, 0x02, body), nil
}

func decodeSuback(p packet) (packetID uint16, codes []byte, err error) {
	if p.typ != ctrlSuback {
		return 0, nil, fmt.Errorf("%w: expected SUBACK, got packet type %d", errProtocol, p.typ)
	}
	if len(p.body) < 3 {
		return 0, nil, fmt.Errorf("%w: short SUBACK", errProtocol)
	}
	return binary.BigEndian.Uint16(p.body), p.body[2:], nil
}

func encodePingreq() []byte    { return frame(ctrlPingreq, 0, nil) }
func encodeDisconnect() []byte { return frame(ctrlDisconnect, 0, nil) }

func frame(typ, flags byte, body []byte) []byte {
	out := make([]byte, 0, len(body)+5)
	out = append(out, typ<<4|flags&0x0f)
	out = encodeRemainingLength(out, len(body))
	return append(out, body...)
}

// ValidateTopic checks a topic a device publishes to. Wildcards are refused:
// you cannot command a wildcard, and a config that tried would silently
// actuate every device under it.
func ValidateTopic(topic string) error {
	if topic == "" {
		return errors.New("mqtt: empty topic")
	}
	if err := validString(topic); err != nil {
		return err
	}
	if strings.ContainsAny(topic, "+#") {
		return fmt.Errorf("mqtt: topic %q contains a wildcard", topic)
	}
	return nil
}

// ValidateFilter checks a subscription filter, including wildcard placement:
// '+' must occupy a whole level, '#' must be the final level.
func ValidateFilter(filter string) error {
	if filter == "" {
		return errors.New("mqtt: empty topic filter")
	}
	if err := validString(filter); err != nil {
		return err
	}
	levels := strings.Split(filter, "/")
	for i, l := range levels {
		switch {
		case l == "+" || !strings.Contains(l, "+"):
			// fine: a whole-level '+', or no '+' at all.
		default:
			return fmt.Errorf("mqtt: filter %q has '+' inside a level", filter)
		}
		if strings.Contains(l, "#") {
			if l != "#" {
				return fmt.Errorf("mqtt: filter %q has '#' inside a level", filter)
			}
			if i != len(levels)-1 {
				return fmt.Errorf("mqtt: filter %q has '#' before the last level", filter)
			}
		}
	}
	return nil
}

// TopicMatch reports whether a filter matches a concrete topic, per §4.7.
//
// Topics beginning with '$' are excluded from a leading wildcard, which is what
// keeps a config's "#" from quietly subscribing to the broker's own $SYS tree.
func TopicMatch(filter, topic string) bool {
	if filter == topic {
		return true
	}
	f := strings.Split(filter, "/")
	t := strings.Split(topic, "/")
	if len(t) > 0 && strings.HasPrefix(t[0], "$") && len(f) > 0 && (f[0] == "+" || f[0] == "#") {
		return false
	}
	for i := range f {
		if f[i] == "#" {
			// '#' matches the parent level too, but only if it is the last.
			return i == len(f)-1 && len(t) >= i
		}
		if i >= len(t) {
			return false
		}
		if f[i] == "+" {
			continue
		}
		if f[i] != t[i] {
			return false
		}
	}
	return len(f) == len(t)
}
