package camera

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
)

// MulticastAddr is the WS-Discovery group and port ONVIF uses. It is a
// site-local IPv4 multicast address; the probe never leaves the LAN.
const MulticastAddr = "239.255.255.250:3702"

// The namespaces below are ONVIF's, not the newer WS-DD 2009/01 ones. ONVIF
// Core pins WS-Discovery at the 2005/04 revision and every camera follows it,
// so the probe is emitted with exactly these. Replies are parsed leniently —
// see parseProbeMatches.
const (
	nsSOAP12          = "http://www.w3.org/2003/05/soap-envelope"
	nsAddressing      = "http://schemas.xmlsoap.org/ws/2004/08/addressing"
	nsDiscovery       = "http://schemas.xmlsoap.org/ws/2005/04/discovery"
	nsNetworkWSDL     = "http://www.onvif.org/ver10/network/wsdl"
	probeAction       = nsDiscovery + "/Probe"
	discoveryTo       = "urn:schemas-xmlsoap-org:ws:2005:04:discovery"
	typeVideoTransmit = "NetworkVideoTransmitter"
)

// Discovery defaults. Repeats exists because a Probe is a single unacknowledged
// datagram and a switch under load will drop it; WS-Discovery retransmits the
// SAME message id, which is what makes duplicate replies safe to deduplicate.
const (
	DefaultProbeTarget   = MulticastAddr
	DefaultProbeTimeout  = 3 * time.Second
	DefaultProbeRepeats  = 2
	DefaultProbeInterval = 250 * time.Millisecond
	DefaultMaxMatches    = 64
	// maxDatagram bounds one reply. A ProbeMatch is a few hundred bytes; this
	// is the UDP payload ceiling and exists so a hostile responder cannot make
	// the hub allocate on demand. A larger datagram is truncated, fails to
	// parse, and is dropped.
	maxDatagram = 64 << 10
)

// DiscoveryConfig is both the configuration for WS-Discovery and the prober
// itself. Zero values are filled in by withDefaults, so a caller only sets what
// it means to change.
//
// Enabled is consulted by Driver, not by Probe: calling Probe directly always
// probes, which is what the tests want.
type DiscoveryConfig struct {
	// Enabled turns multicast discovery on for the Driver. Off by default. A
	// package that emits multicast the moment someone constructs its zero value
	// is a package that surprises an operator.
	Enabled bool
	// Target is the address the probe is sent to. Defaults to MulticastAddr.
	// A unicast address is legal and is how a test — or an operator on a
	// segment that drops multicast — points the probe at one known camera.
	Target string
	// Timeout bounds the whole probe, sending and collecting together.
	Timeout time.Duration
	// Repeats is how many identical probe datagrams are sent.
	Repeats int
	// Interval is the gap between repeats.
	Interval time.Duration
	// MaxMatches caps how many distinct cameras one probe will return. A flood
	// of forged replies must not be able to grow the hub's inventory without
	// bound.
	MaxMatches int

	// AcceptAnyDeviceType keeps replies that do not declare
	// NetworkVideoTransmitter. ONVIF door controllers and access units answer
	// the same probe; by default they are dropped, because this driver models
	// what it finds as a camera and a driver that mislabels an access device as
	// a camera has told the console something false.
	AcceptAnyDeviceType bool
	// AcceptUnrelatedReplies keeps replies whose wsa:RelatesTo does not echo
	// this probe's MessageID. Turning it on means accepting any WS-Discovery
	// traffic on the segment, including a Hello-storm or a forged ProbeMatch
	// aimed at putting a device the hub never asked about into its inventory.
	AcceptUnrelatedReplies bool
	// AcceptForeignServiceAddress keeps replies whose advertised service
	// address is not the literal source IP of the packet — a hostname, or
	// another host's address. Turning it on lets any device on the LAN aim the
	// hub, and the credentials the hub holds for that camera, at a host of its
	// choosing. It exists for NAT and port-forward deployments, where the
	// address a camera advertises legitimately is not the address it answers
	// from.
	AcceptForeignServiceAddress bool

	// now and newMessageID are swappable for tests.
	now          func() time.Time
	newMessageID func() (string, error)
}

func (c DiscoveryConfig) withDefaults() DiscoveryConfig {
	if c.Target == "" {
		c.Target = DefaultProbeTarget
	}
	if c.Timeout <= 0 {
		c.Timeout = DefaultProbeTimeout
	}
	if c.Repeats <= 0 {
		c.Repeats = DefaultProbeRepeats
	}
	if c.Interval <= 0 {
		c.Interval = DefaultProbeInterval
	}
	if c.MaxMatches <= 0 {
		c.MaxMatches = DefaultMaxMatches
	}
	if c.now == nil {
		c.now = time.Now
	}
	if c.newMessageID == nil {
		c.newMessageID = newMessageID
	}
	return c
}

// Match is one camera that answered a probe. It is what discovery knows before
// anything has authenticated or asked a single media question.
type Match struct {
	// DeviceID is derived from the endpoint reference and is stable across
	// restarts for the same camera — see deviceIDFromEndpoint. The registry
	// reconciles persisted state on it, so it must not be derived from the IP.
	DeviceID string
	// Endpoint is the raw wsa:EndpointReference address, usually urn:uuid:...
	Endpoint string
	// ServiceAddress is the accepted device-service URL (the first advertised
	// address that passed validation).
	ServiceAddress string
	// Advertised is every address the camera offered, accepted or not, for
	// operator diagnostics.
	Advertised []string
	Types      []string
	Scopes     []string
	// Name, Location and Hardware come from the onvif:// scope vocabulary. They
	// are device-supplied strings that end up in a console, so they are
	// sanitised and length-capped at parse time.
	Name     string
	Location string
	Hardware string
	// Source is the IP the reply actually came from.
	Source string
	At     time.Time
}

// Probe sends the WS-Discovery Probe and collects ProbeMatch replies until the
// timeout expires.
//
// It does NOT join the multicast group. It does not have to: a ProbeMatch is
// sent back by unicast to the source port of the probe, so an ordinary
// unbound UDP socket receives every reply. That is the whole reason this is
// standard library — no interface enumeration, no group membership, no
// x/net/ipv4.
//
// Returns the matches it did collect even when the context expires mid-probe:
// three cameras found before a cancellation are three cameras, and discarding
// them would make a shorter deadline look like an empty network.
func (c DiscoveryConfig) Probe(ctx context.Context) ([]Match, error) {
	c = c.withDefaults()

	target, err := net.ResolveUDPAddr("udp4", c.Target)
	if err != nil {
		return nil, fmt.Errorf("camera: discovery target %q is not a udp4 address", c.Target)
	}
	msgID, err := c.newMessageID()
	if err != nil {
		return nil, fmt.Errorf("camera: could not generate a probe message id: %w", err)
	}
	body := probeEnvelope(msgID)

	conn, err := net.ListenPacket("udp4", "0.0.0.0:0")
	if err != nil {
		return nil, fmt.Errorf("camera: could not open a udp socket for discovery: %w", err)
	}
	defer conn.Close()

	deadline := c.now().Add(c.Timeout)
	if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
		deadline = dl
	}
	_ = conn.SetDeadline(deadline)

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// The context watcher closes the socket, which is the only way to unblock a
	// ReadFrom that is already parked on a deadline further out than the
	// context's.
	wg.Add(1)
	go func() {
		defer wg.Done()
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stop:
		}
	}()

	var (
		writeMu  sync.Mutex
		writeErr error
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < c.Repeats; i++ {
			if i > 0 {
				select {
				case <-time.After(c.Interval):
				case <-stop:
					return
				case <-ctx.Done():
					return
				}
			}
			if _, err := conn.WriteTo(body, target); err != nil {
				writeMu.Lock()
				if writeErr == nil {
					writeErr = err
				}
				writeMu.Unlock()
				return
			}
		}
	}()

	buf := make([]byte, maxDatagram)
	seen := map[string]bool{}
	var out []Match
collect:
	for len(out) < c.MaxMatches {
		n, from, rerr := conn.ReadFrom(buf)
		if rerr != nil {
			// A deadline, a cancellation-driven close, or a genuinely broken
			// socket. All three mean "stop collecting"; the first two are
			// normal and none of them invalidates what was already collected.
			break
		}
		src := sourceIP(from)
		if src == nil {
			continue
		}
		for _, m := range c.parseProbeMatches(buf[:n], msgID, src) {
			if seen[m.DeviceID] {
				continue
			}
			seen[m.DeviceID] = true
			out = append(out, m)
			if len(out) >= c.MaxMatches {
				break collect
			}
		}
	}

	close(stop)
	wg.Wait()

	writeMu.Lock()
	werr := writeErr
	writeMu.Unlock()

	if len(out) == 0 {
		if werr != nil {
			return nil, fmt.Errorf("camera: the discovery probe could not be sent: %w", werr)
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return out, nil
}

// probeEnvelope builds the Probe. The only variable in it is a message id this
// package generated, so there is no caller-supplied string on this path and
// nothing to escape.
func probeEnvelope(messageID string) []byte {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="utf-8"?>`)
	b.WriteString(`<s:Envelope xmlns:s="` + nsSOAP12 + `" xmlns:a="` + nsAddressing + `"`)
	b.WriteString(` xmlns:d="` + nsDiscovery + `" xmlns:dn="` + nsNetworkWSDL + `">`)
	b.WriteString(`<s:Header>`)
	b.WriteString(`<a:Action s:mustUnderstand="1">` + probeAction + `</a:Action>`)
	b.WriteString(`<a:MessageID>` + messageID + `</a:MessageID>`)
	b.WriteString(`<a:To s:mustUnderstand="1">` + discoveryTo + `</a:To>`)
	b.WriteString(`</s:Header>`)
	b.WriteString(`<s:Body><d:Probe><d:Types>dn:` + typeVideoTransmit + `</d:Types></d:Probe></s:Body>`)
	b.WriteString(`</s:Envelope>`)
	return []byte(b.String())
}

// probeMatchEnvelope is deliberately namespace-agnostic: the element tags carry
// no namespace, which makes encoding/xml match on local name alone. Vendors
// disagree about prefixes and a couple emit the 2009/01 discovery namespace by
// mistake, and rejecting those would be pedantry rather than safety — the
// checks that matter (RelatesTo, source binding, device type) are applied to
// the parsed values below, not to the namespace they arrived in.
type probeMatchEnvelope struct {
	XMLName   xml.Name
	RelatesTo string          `xml:"Header>RelatesTo"`
	Matches   []probeMatchXML `xml:"Body>ProbeMatches>ProbeMatch"`
}

type probeMatchXML struct {
	Endpoint string `xml:"EndpointReference>Address"`
	Types    string `xml:"Types"`
	Scopes   string `xml:"Scopes"`
	XAddrs   string `xml:"XAddrs"`
}

// parseProbeMatches turns one datagram into zero or more matches, dropping
// anything it cannot vouch for. Every drop is silent by design: this runs on
// unsolicited multicast traffic, and a per-datagram log line is a remote party's
// ability to fill an operator's disk.
//
// The order of checks is the order of cheapness, except that RelatesTo comes
// first because it is the one that decides whether this reply is ours at all.
func (c DiscoveryConfig) parseProbeMatches(data []byte, messageID string, src net.IP) []Match {
	var env probeMatchEnvelope
	// encoding/xml does not resolve external entities and does not expand
	// entity declarations it was not given, so a DTD in a hostile reply is
	// inert rather than a billion-laughs.
	if err := xml.Unmarshal(data, &env); err != nil {
		return nil
	}
	if !c.AcceptUnrelatedReplies && strings.TrimSpace(env.RelatesTo) != messageID {
		return nil
	}

	at := c.now()
	srcText := src.String()
	out := make([]Match, 0, len(env.Matches))
	for _, m := range env.Matches {
		id := deviceIDFromEndpoint(m.Endpoint)
		if id == "" {
			// No endpoint reference means no stable identity, and an id derived
			// from the IP would rename the camera the day DHCP moves it.
			continue
		}
		types := strings.Fields(m.Types)
		if !c.AcceptAnyDeviceType && !hasVideoTransmitter(types) {
			continue
		}
		advertised := strings.Fields(m.XAddrs)
		service := ""
		for _, raw := range advertised {
			if c.serviceAddressOK(raw, src) {
				service = raw
				break
			}
		}
		if service == "" {
			continue
		}
		scopes := strings.Fields(m.Scopes)
		out = append(out, Match{
			DeviceID:       id,
			Endpoint:       sanitize(m.Endpoint, 128),
			ServiceAddress: service,
			Advertised:     advertised,
			Types:          types,
			Scopes:         scopes,
			Name:           scopeValue(scopes, "name"),
			Location:       scopeValue(scopes, "location"),
			Hardware:       scopeValue(scopes, "hardware"),
			Source:         srcText,
			At:             at,
		})
	}
	return out
}

// serviceAddressOK enforces "a camera may only advertise itself". A hostname is
// refused rather than resolved: resolving it would hand name resolution — and
// therefore the choice of host — to whatever answers DNS on that segment, which
// is precisely the indirection this check exists to remove.
func (c DiscoveryConfig) serviceAddressOK(raw string, src net.IP) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	if u.User != nil {
		return false
	}
	if c.AcceptForeignServiceAddress {
		return true
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil {
		return false
	}
	return ip.Equal(src)
}

func hasVideoTransmitter(types []string) bool {
	for _, t := range types {
		// Prefixes vary by vendor (dn:, tdn:, none at all), so the local part
		// is what is compared.
		if local := t[strings.LastIndex(t, ":")+1:]; local == typeVideoTransmit {
			return true
		}
	}
	return false
}

// deviceIDFromEndpoint derives a stable device id from an endpoint reference.
//
// The common form is urn:uuid:<uuid>, and the uuid alone is used: it is already
// unique and stable, and it reads in a console. Anything else is hashed, so a
// vendor with an exotic endpoint form still gets an id that is stable, unique,
// free of delimiters, and impossible to confuse with a uuid.
func deviceIDFromEndpoint(endpoint string) string {
	s := strings.ToLower(strings.TrimSpace(endpoint))
	if s == "" {
		return ""
	}
	rest := s
	for _, p := range []string{"urn:uuid:", "uuid:"} {
		if strings.HasPrefix(rest, p) {
			rest = rest[len(p):]
			break
		}
	}
	if isUUID(rest) {
		return rest
	}
	sum := sha256.Sum256([]byte(s))
	return "epr-" + hex.EncodeToString(sum[:8])
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !strings.ContainsRune("0123456789abcdef", r) {
				return false
			}
		}
	}
	return true
}

// scopeValue pulls one value out of the onvif:// scope vocabulary, e.g.
// onvif://www.onvif.org/name/Front%20Door -> "Front Door".
//
// Hierarchical scopes (location/country/za/city/durban) return everything after
// the key, unescaped segment by segment. The result is device-supplied text
// bound for a console, so it is sanitised here rather than at the point it is
// rendered — there is more than one renderer and only one parser.
func scopeValue(scopes []string, key string) string {
	prefix := "/" + key + "/"
	for _, s := range scopes {
		u, err := url.Parse(s)
		if err != nil || u.Scheme != "onvif" {
			continue
		}
		p := u.EscapedPath()
		if !strings.HasPrefix(p, prefix) {
			continue
		}
		var parts []string
		for _, seg := range strings.Split(strings.Trim(strings.TrimPrefix(p, prefix), "/"), "/") {
			dec, err := url.PathUnescape(seg)
			if err != nil {
				dec = seg
			}
			if dec != "" {
				parts = append(parts, dec)
			}
		}
		if v := sanitize(strings.Join(parts, "/"), 64); v != "" {
			return v
		}
	}
	return ""
}

// sanitize strips control characters and caps length. Everything it touches came
// off the network from an unauthenticated device and ends up in an operator's
// console: a newline in a camera name is a log-forging primitive and a 4KiB name
// is a broken layout.
func sanitize(s string, max int) string {
	var b strings.Builder
	n := 0
	for _, r := range strings.TrimSpace(s) {
		if r == unicode.ReplacementChar || !unicode.IsPrint(r) {
			continue
		}
		if n == max {
			b.WriteString("…")
			break
		}
		b.WriteRune(r)
		n++
	}
	return strings.TrimSpace(b.String())
}

func sourceIP(addr net.Addr) net.IP {
	if u, ok := addr.(*net.UDPAddr); ok {
		return u.IP
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return nil
	}
	return net.ParseIP(host)
}

// newMessageID returns a random RFC 4122 v4 urn. WS-Discovery only needs it to
// be unique; it is generated from crypto/rand anyway, because a predictable
// message id would let anything on the segment pre-forge a reply that passes
// the RelatesTo check.
func newMessageID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return "urn:uuid:" + h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32], nil
}
