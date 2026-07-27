// Package discovery finds Aql controllers on the local network.
//
// # The problem it solves
//
// Pairing a controller means knowing where it is. Until now that meant reading
// an IP off a screen, or off a router's DHCP table, or guessing — for a box
// screwed to a wall at a gate, often by someone standing outside in the rain
// with a phone.
//
// Controllers already advertise themselves. The controller has shipped an mDNS
// responder for a while (controller/internal/mdns) announcing `_lintel._tcp`
// with its device id and LAN port. Nothing ever listened. This is the other
// half.
//
// # Why the service name still says lintel
//
// `_lintel._tcp` is a wire identifier, not a label. It is normative in
// proto/grants.md, the phone app browses for exactly that string, and every
// controller already deployed advertises it. Renaming it means an updated hub
// cannot find an existing controller — on the path that matters most when
// something has gone wrong. It stays until a protocol change migrates both
// halves together.
//
// # What this deliberately does not do
//
// It does not pair anything. A controller that answers a browse is a
// SUGGESTION with an address attached, and pairing still requires a claim token
// typed by a human — because mDNS is unauthenticated by construction. Anything
// on the LAN can answer a browse, and a discovery routine that paired what it
// found would let a device on the guest wifi volunteer to be a gate controller.
//
// It also does not write configuration. Same reasoning as the MQTT bridge scan:
// a human decides what joins the fleet.
package discovery

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

const (
	// mdnsGroup is the IPv4 multicast address and port from RFC 6762.
	mdnsGroup = "224.0.0.251:5353"
	// ServiceName is what a controller advertises. See the package comment for
	// why it still says lintel.
	ServiceName = "_lintel._tcp.local."
	// DefaultBrowseWindow is how long Browse listens.
	//
	// mDNS is best-effort and lossy: a response can be dropped, and a
	// controller that just booted may not answer the first query. Two seconds
	// covers a normal LAN with room for a retry; longer mainly makes an
	// operator wait.
	DefaultBrowseWindow = 2 * time.Second
	// maxPacket bounds a read. A response carrying four records is a few
	// hundred bytes; this is far above anything legitimate and stops a
	// malicious responder from being interesting.
	maxPacket = 9000
	// maxResponders bounds how many distinct controllers one browse will
	// report, so a host spraying instance names cannot make the hub allocate
	// without limit.
	maxResponders = 256
)

// Controller is one responder found on the network.
type Controller struct {
	// Instance is the advertised label, e.g. "aql-de71ce00".
	Instance string
	// DeviceID is the controller's own id, from the TXT record. Empty when the
	// responder did not include one — which a real controller always does, so
	// an empty value is a reason to be suspicious rather than to proceed.
	DeviceID string
	// Addr is host:port for the LAN grant listener.
	Addr string
	// Proto is the advertised protocol version from TXT, or "".
	Proto string
	// Extra carries any other TXT keys verbatim, so a newer controller
	// advertising something this hub does not know about is visible rather
	// than silently dropped.
	Extra map[string]string
}

// Browse sends one PTR query for the controller service and collects answers
// until the window closes.
//
// It never returns a partial error: a browse that found nothing on a network
// with no controllers is a successful browse with no results, and only a
// failure to send at all is an error. An operator staring at an empty list
// needs to know which of those happened, so the two are kept apart rather than
// both rendering as "nothing found".
func Browse(ctx context.Context, window time.Duration) ([]Controller, error) {
	if window <= 0 {
		window = DefaultBrowseWindow
	}

	// An unbound UDP socket. Deliberately NOT joining the multicast group as a
	// listener: this sends a query and reads the unicast-or-multicast replies
	// that come back to its own port, which is enough for a one-shot browse and
	// avoids needing an interface to bind to on a host with several.
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		return nil, fmt.Errorf("discovery: open socket: %w", err)
	}
	defer conn.Close()

	group, err := net.ResolveUDPAddr("udp4", mdnsGroup)
	if err != nil {
		return nil, fmt.Errorf("discovery: resolve %s: %w", mdnsGroup, err)
	}
	if _, err := conn.WriteToUDP(buildQuery(ServiceName), group); err != nil {
		// A send failure is the one genuine error. It usually means multicast
		// is unavailable — a container with no multicast route, or a network
		// that filters it — and saying so beats reporting an empty network.
		return nil, fmt.Errorf("discovery: send mDNS query (multicast may be "+
			"unavailable on this host or network): %w", err)
	}

	deadline := time.Now().Add(window)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetReadDeadline(deadline)

	found := map[string]*Controller{}
	buf := make([]byte, maxPacket)
	for len(found) < maxResponders {
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			var nerr net.Error
			if errors.As(err, &nerr) && nerr.Timeout() {
				break // the window closed; this is the normal exit
			}
			break
		}
		parseResponse(buf[:n], found)
		if ctx.Err() != nil {
			break
		}
	}

	out := make([]Controller, 0, len(found))
	for _, c := range found {
		out = append(out, *c)
	}
	// Stable order so a console's list does not reshuffle between browses for
	// no reason.
	sort.Slice(out, func(i, j int) bool { return out[i].Instance < out[j].Instance })
	return out, nil
}

// buildQuery is a standard mDNS PTR question.
func buildQuery(service string) []byte {
	var b []byte
	b = binary.BigEndian.AppendUint16(b, 0) // id 0 — mDNS ignores it
	b = binary.BigEndian.AppendUint16(b, 0) // flags: standard query
	b = binary.BigEndian.AppendUint16(b, 1) // QDCOUNT
	b = binary.BigEndian.AppendUint16(b, 0) // ANCOUNT
	b = binary.BigEndian.AppendUint16(b, 0) // NSCOUNT
	b = binary.BigEndian.AppendUint16(b, 0) // ARCOUNT
	b = appendName(b, service)
	b = binary.BigEndian.AppendUint16(b, 12) // QTYPE = PTR
	b = binary.BigEndian.AppendUint16(b, 1)  // QCLASS = IN
	return b
}

func appendName(b []byte, name string) []byte {
	for _, label := range strings.Split(strings.TrimSuffix(name, "."), ".") {
		if label == "" {
			continue
		}
		b = append(b, byte(len(label)))
		b = append(b, label...)
	}
	return append(b, 0)
}

// parseResponse reads the SRV, TXT and A records out of one packet and merges
// them into found, keyed by instance.
//
// Merging rather than replacing, because a responder may split its records
// across packets — and because the records for one instance arrive in no
// guaranteed order, so the SRV that carries the port can land before or after
// the TXT that carries the device id.
func parseResponse(pkt []byte, found map[string]*Controller) {
	if len(pkt) < 12 {
		return
	}
	flags := binary.BigEndian.Uint16(pkt[2:4])
	if flags&0x8000 == 0 {
		return // a query, not a response — including our own, echoed back
	}
	qd := int(binary.BigEndian.Uint16(pkt[4:6]))
	counts := int(binary.BigEndian.Uint16(pkt[6:8])) +
		int(binary.BigEndian.Uint16(pkt[8:10])) +
		int(binary.BigEndian.Uint16(pkt[10:12]))

	off := 12
	// Skip the question section.
	for i := 0; i < qd && off < len(pkt); i++ {
		_, next := decodeName(pkt, off)
		if next <= off {
			return
		}
		off = next + 4
	}

	// hosts maps an A record's owner name to its address, so an SRV target can
	// be resolved without a second lookup.
	hosts := map[string]net.IP{}
	type partial struct {
		port uint16
		host string
		txt  map[string]string
	}
	parts := map[string]*partial{}

	for i := 0; i < counts && off < len(pkt); i++ {
		name, next := decodeName(pkt, off)
		if next <= off || next+10 > len(pkt) {
			return
		}
		typ := binary.BigEndian.Uint16(pkt[next : next+2])
		rdLen := int(binary.BigEndian.Uint16(pkt[next+8 : next+10]))
		rd := next + 10
		if rd+rdLen > len(pkt) {
			return
		}
		data := pkt[rd : rd+rdLen]

		switch typ {
		case 33: // SRV
			if len(data) >= 6 {
				inst := instanceOf(name)
				if inst != "" {
					p := parts[inst]
					if p == nil {
						p = &partial{txt: map[string]string{}}
						parts[inst] = p
					}
					p.port = binary.BigEndian.Uint16(data[4:6])
					target, _ := decodeName(pkt, rd+6)
					p.host = target
				}
			}
		case 16: // TXT
			inst := instanceOf(name)
			if inst != "" {
				p := parts[inst]
				if p == nil {
					p = &partial{txt: map[string]string{}}
					parts[inst] = p
				}
				for _, kv := range decodeTXT(data) {
					k, v, _ := strings.Cut(kv, "=")
					p.txt[k] = v
				}
			}
		case 1: // A
			if len(data) == 4 {
				hosts[strings.ToLower(name)] = net.IPv4(data[0], data[1], data[2], data[3])
			}
		}
		off = rd + rdLen
	}

	for inst, p := range parts {
		if p.port == 0 {
			continue // no SRV means no port, and an address with no port is not reachable
		}
		ip := hosts[strings.ToLower(p.host)]
		if ip == nil {
			continue // the responder named a host it did not give an address for
		}
		c := found[inst]
		if c == nil {
			if len(found) >= maxResponders {
				return
			}
			c = &Controller{Instance: inst, Extra: map[string]string{}}
			found[inst] = c
		}
		c.Addr = net.JoinHostPort(ip.String(), fmt.Sprint(p.port))
		for k, v := range p.txt {
			switch k {
			case "device":
				c.DeviceID = v
			case "proto":
				c.Proto = v
			default:
				// Carried verbatim: a newer controller advertising something
				// this hub does not know about should be visible, not dropped.
				c.Extra[k] = v
			}
		}
	}
}

// instanceOf strips the service suffix from an owner name.
//
//	aql-de71ce00._lintel._tcp.local.  ->  aql-de71ce00
//
// Returns "" for a name that is not under this service, which is how records
// for other services sharing the network are ignored.
func instanceOf(name string) string {
	n := strings.TrimSuffix(strings.ToLower(name), ".")
	suffix := "." + strings.TrimSuffix(strings.ToLower(ServiceName), ".")
	if !strings.HasSuffix(n, suffix) {
		return ""
	}
	return name[:len(n)-len(suffix)]
}

// decodeName reads a DNS name, following compression pointers.
//
// Pointer following is bounded: a packet can name a pointer that points at
// itself, and an unbounded decoder turns that into a hang. RFC 1035 offers no
// limit, so one is imposed here.
func decodeName(pkt []byte, off int) (string, int) {
	var labels []string
	jumps := 0
	next := -1
	for off < len(pkt) {
		l := int(pkt[off])
		switch {
		case l == 0:
			off++
			if next < 0 {
				next = off
			}
			return strings.Join(labels, ".") + ".", next
		case l&0xC0 == 0xC0:
			if off+1 >= len(pkt) {
				return "", -1
			}
			if next < 0 {
				next = off + 2
			}
			jumps++
			if jumps > 16 {
				// A pointer loop. Sixteen is far more indirection than any
				// real packet uses and far less than enough to hang on.
				return "", -1
			}
			off = int(binary.BigEndian.Uint16(pkt[off:off+2]) & 0x3FFF)
		default:
			if off+1+l > len(pkt) {
				return "", -1
			}
			labels = append(labels, string(pkt[off+1:off+1+l]))
			off += 1 + l
		}
	}
	return "", -1
}

// decodeTXT splits a TXT rdata into its length-prefixed strings.
func decodeTXT(data []byte) []string {
	var out []string
	for i := 0; i < len(data); {
		l := int(data[i])
		if i+1+l > len(data) {
			return out
		}
		if l > 0 {
			out = append(out, string(data[i+1:i+1+l]))
		}
		i += 1 + l
	}
	return out
}
