package mdns

import (
	"encoding/binary"
	"strings"
	"testing"
	"time"
)

// The mDNS responder parses UNTRUSTED packets off the LAN, and had no tests at
// all — found by re-running the coverage audit with -coverpkg.
//
// Everything here reads a datagram anyone on the network can send to a device
// that opens gates. decodeName is a hand-rolled DNS name decoder, which is the
// classic home of the compression-pointer loop: a name whose pointer points at
// itself makes a naive decoder spin forever. This one bounds jumps and lengths;
// nothing checked that it does.

// name encodes a dotted name in DNS label form.
func name(s string) []byte {
	var out []byte
	for _, part := range strings.Split(strings.TrimSuffix(s, "."), ".") {
		out = append(out, byte(len(part)))
		out = append(out, part...)
	}
	return append(out, 0)
}

func TestDecodeNameReadsAPlainName(t *testing.T) {
	pkt := name("_aql._tcp.local.")
	got, n := decodeName(pkt, 0)
	if got != "_aql._tcp.local." {
		t.Errorf("decoded %q", got)
	}
	// consumed has to be the whole encoding, because the caller advances by it
	// to reach the qtype/qclass that follow.
	if n != len(pkt) {
		t.Errorf("consumed %d, want %d", n, len(pkt))
	}
}

// A pointer that points at itself must terminate. Without the jump bound this
// is an infinite loop in a UDP read path — one datagram, and the responder
// never returns.
func TestASelfReferentialPointerTerminates(t *testing.T) {
	pkt := []byte{0xC0, 0x00} // pointer to offset 0, which is this pointer

	done := make(chan struct{})
	var n int
	go func() {
		_, n = decodeName(pkt, 0)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("decodeName did not return on a self-referential pointer — one datagram hangs the responder")
	}
	if n >= 0 {
		t.Errorf("a pointer loop decoded successfully (consumed %d)", n)
	}
}

// A two-pointer cycle is the same hazard one step removed, and a bound that
// only caught self-reference would miss it.
func TestAPointerCycleTerminates(t *testing.T) {
	pkt := []byte{0xC0, 0x02, 0xC0, 0x00}
	done := make(chan struct{})
	var n int
	go func() {
		_, n = decodeName(pkt, 0)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("decodeName did not return on a pointer cycle")
	}
	if n >= 0 {
		t.Errorf("a pointer cycle decoded successfully (consumed %d)", n)
	}
}

func TestMalformedNamesAreRejectedRatherThanRead(t *testing.T) {
	cases := map[string][]byte{
		"pointer past the end":    {0xC0, 0xFF},
		"truncated pointer":       {0xC0},
		"label runs past the end": {0x05, 'a', 'b'},
		"empty packet":            {},
		"length with no data":     {0x01},
	}
	for what, pkt := range cases {
		if _, n := decodeName(pkt, 0); n >= 0 {
			t.Errorf("%s: accepted (consumed %d)", what, n)
		}
	}
	// An offset past the end of a valid packet is rejected too.
	if _, n := decodeName(name("local."), 99); n >= 0 {
		t.Errorf("an out-of-range offset was accepted (consumed %d)", n)
	}
}

// A legitimate compressed name resolves, and `consumed` counts the bytes at the
// ORIGINAL offset — two for the pointer — not the length of what it expanded
// to. Getting that wrong walks the caller into the middle of the packet.
func TestACompressedNameConsumesOnlyThePointer(t *testing.T) {
	target := name("local.")
	pkt := append([]byte{}, target...)
	ptrAt := len(pkt)
	pkt = append(pkt, 0x03, 'a', 'b', 'c', 0xC0, 0x00) // "abc" + pointer to offset 0

	got, n := decodeName(pkt, ptrAt)
	if got != "abc.local." {
		t.Errorf("decoded %q, want abc.local.", got)
	}
	if want := 6; n != want { // 1+3 label bytes + 2 pointer bytes
		t.Errorf("consumed %d, want %d — the caller would resume mid-packet", n, want)
	}

	// A CHAINED pointer is what actually pins the rule. With one pointer the
	// "only count bytes before the first jump" guard is indistinguishable from
	// counting every pointer, because there is only one — the first version of
	// this test had exactly that fixture and passed against a tamper that
	// dropped the guard. Here the second name points at the first, which itself
	// ends in a pointer, so a decoder that kept updating `consumed` after
	// jumping would report the offset of the LAST pointer instead.
	chained := append([]byte{}, pkt...)
	chainAt := len(chained)
	chained = append(chained, 0x03, 'x', 'y', 'z', 0xC0, byte(ptrAt))

	got, n = decodeName(chained, chainAt)
	if got != "xyz.abc.local." {
		t.Errorf("decoded %q, want xyz.abc.local.", got)
	}
	if want := 6; n != want {
		t.Errorf("consumed %d for a chained pointer, want %d — bytes consumed are those at "+
			"the ORIGINAL offset, not wherever the chain ended", n, want)
	}
}

// isQueryFor is the gate on whether this responder answers at all. It must
// ignore RESPONSES (QR=1), or two advertisers on one LAN answer each other
// forever.
func TestOnlyQueriesForOurServiceAreAnswered(t *testing.T) {
	const svc = "_aql._tcp.local."
	query := func(qname string, qtype uint16, flags uint16) []byte {
		pkt := make([]byte, 12)
		binary.BigEndian.PutUint16(pkt[2:4], flags)
		binary.BigEndian.PutUint16(pkt[4:6], 1)
		pkt = append(pkt, name(qname)...)
		var tc [4]byte
		binary.BigEndian.PutUint16(tc[0:2], qtype)
		binary.BigEndian.PutUint16(tc[2:4], 1)
		return append(pkt, tc[:]...)
	}

	if !isQueryFor(query(svc, 12, 0), svc) {
		t.Error("a PTR query for our service was not recognised")
	}
	if !isQueryFor(query(svc, 255, 0), svc) {
		t.Error("an ANY query for our service was not recognised")
	}
	if isQueryFor(query(svc, 12, 0x8000), svc) {
		t.Error("a RESPONSE was treated as a query — two responders would answer each other")
	}
	if isQueryFor(query("_other._tcp.local.", 12, 0), svc) {
		t.Error("a query for another service was answered")
	}
	if isQueryFor(query(svc, 1 /*A*/, 0), svc) {
		t.Error("an A query was answered as a service query")
	}
	// Truncated and empty packets are not queries.
	for _, pkt := range [][]byte{nil, make([]byte, 11), {0xff}} {
		if isQueryFor(pkt, svc) {
			t.Errorf("a %d-byte packet was treated as a query", len(pkt))
		}
	}
	// A question count larger than the packet holds must not read past the end.
	//
	// The first version of this asserted that a packet claiming 50 questions is
	// never answered — and it was, correctly: its FIRST question was a genuine
	// query for our service, and a lie about how many follow does not make a
	// real question fake. The hazard is the loop continuing past the data, so
	// the fixture now puts a non-matching question first and truncates: the
	// only safe answer is false, reached without reading off the end.
	bad := query("_other._tcp.local.", 12, 0)
	binary.BigEndian.PutUint16(bad[4:6], 50)
	if isQueryFor(bad, svc) {
		t.Error("a packet claiming 50 questions but holding one non-matching question was answered")
	}
	// And truncated mid-question, with the count still claiming more.
	for cut := len(bad) - 1; cut >= 12; cut-- {
		if isQueryFor(bad[:cut], svc) {
			t.Errorf("a packet truncated to %d bytes was answered", cut)
		}
	}
}

// The property that matters most for a parser on a UDP read path: it always
// returns, and never panics, whatever arrives.
func FuzzDecodeName(f *testing.F) {
	f.Add(name("_aql._tcp.local."), 0)
	f.Add([]byte{0xC0, 0x00}, 0)
	f.Add([]byte{0xC0, 0x02, 0xC0, 0x00}, 0)
	f.Add([]byte{0x05, 'a', 'b'}, 0)
	f.Add([]byte{}, 0)

	f.Fuzz(func(t *testing.T, pkt []byte, off int) {
		if off < 0 || off > len(pkt) {
			t.Skip()
		}
		got, n := decodeName(pkt, off)
		if n < 0 {
			return // rejected, which is always a valid answer
		}
		// A success must be self-consistent: it consumed something inside the
		// packet, and produced a name that ends the way DNS names do.
		if n > len(pkt)-off {
			t.Fatalf("consumed %d bytes from offset %d of a %d-byte packet", n, off, len(pkt))
		}
		if !strings.HasSuffix(got, ".") {
			t.Fatalf("decoded %q without a trailing dot", got)
		}
	})
}

func FuzzIsQueryFor(f *testing.F) {
	f.Add(append(make([]byte, 12), name("_aql._tcp.local.")...))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, pkt []byte) {
		// No assertion beyond "returns without panicking": this decides whether
		// to answer a stranger's datagram, so a crash here is the whole failure.
		_ = isQueryFor(pkt, "_aql._tcp.local.")
	})
}

// ---------------------------------------------------------------------------
// The response the phone's resolver reads
// ---------------------------------------------------------------------------
//
// buildResponse assembles the PTR + SRV + TXT + A that let a phone find this
// controller on the LAN when the hub is unreachable — the discovery half of
// offline emergency access.
//
// WHAT THIS ESTABLISHES, AND WHAT IT DOES NOT. There is no DNS library in this
// module, and the real consumer is a phone's platform resolver (Bonjour / NSD),
// which nothing here can stand in for. So this is a STRUCTURAL check against
// the wire format, not proof that a resolver accepts it — the same distinction
// CAMERA-RETENTION.md draws between built and run against hardware.
//
// It is still worth having, because the likely regression is structural: a
// record count that disagrees with the records, or an rdlength that does not
// cover its rdata. The walk below recomputes every position from the DECLARED
// lengths and requires the last record to end exactly at the end of the packet,
// so any one of those disagreements lands the walk somewhere else. It
// deliberately does not reuse the production append helpers — an encoder
// checked only by its own encoder proves the two agree, not that either is
// right.

type rr struct {
	name  string
	typ   uint16
	class uint16
	ttl   uint32
	rdata []byte
}

// walkResponse parses a response header and its answer records, independently
// of how they were built.
func walkResponse(t *testing.T, pkt []byte) (id uint16, flags uint16, answers []rr) {
	t.Helper()
	if len(pkt) < 12 {
		t.Fatalf("response is %d bytes, shorter than a DNS header", len(pkt))
	}
	id = binary.BigEndian.Uint16(pkt[0:2])
	flags = binary.BigEndian.Uint16(pkt[2:4])
	qd := binary.BigEndian.Uint16(pkt[4:6])
	an := binary.BigEndian.Uint16(pkt[6:8])
	if qd != 0 {
		t.Fatalf("QDCOUNT = %d in a response", qd)
	}
	off := 12
	for i := 0; i < int(an); i++ {
		nm, n := decodeName(pkt, off)
		if n < 0 {
			t.Fatalf("answer %d: unreadable name at offset %d", i, off)
		}
		off += n
		if off+10 > len(pkt) {
			t.Fatalf("answer %d: header runs past the end", i)
		}
		var a rr
		a.name = nm
		a.typ = binary.BigEndian.Uint16(pkt[off : off+2])
		a.class = binary.BigEndian.Uint16(pkt[off+2 : off+4])
		a.ttl = binary.BigEndian.Uint32(pkt[off+4 : off+8])
		rdlen := int(binary.BigEndian.Uint16(pkt[off+8 : off+10]))
		off += 10
		if off+rdlen > len(pkt) {
			t.Fatalf("answer %d (%s): rdlength %d runs past the end", i, a.name, rdlen)
		}
		a.rdata = pkt[off : off+rdlen]
		off += rdlen
		answers = append(answers, a)
	}
	// The whole point of walking: every declared length has to add up.
	if off != len(pkt) {
		t.Fatalf("walked to offset %d of a %d-byte response — a record count or an "+
			"rdlength disagrees with the bytes", off, len(pkt))
	}
	return id, flags, answers
}

func TestTheAdvertisedResponseIsWellFormed(t *testing.T) {
	a := &Advertiser{Instance: "lintel-de71ce00", Port: 8737, TXT: []string{"v=1", "id=de71ce00"}}
	pkt := a.buildResponse(0xBEEF)
	if pkt == nil {
		t.Skip("no non-loopback IPv4 on this host, so there is nothing to advertise")
	}

	id, flags, answers := walkResponse(t, pkt)
	if id != 0xBEEF {
		t.Errorf("response id %#x does not echo the query's", id)
	}
	// QR=1 (response) and AA=1 (authoritative) — a resolver ignores an answer
	// that does not claim authority for the name.
	if flags&0x8000 == 0 || flags&0x0400 == 0 {
		t.Errorf("flags %#x: want QR and AA set", flags)
	}
	if len(answers) != 4 {
		t.Fatalf("got %d answers, want PTR + SRV + TXT + A", len(answers))
	}

	const instance = "lintel-de71ce00._lintel._tcp.local."
	const host = "lintel-de71ce00.local."

	ptr, srv, txt, arec := answers[0], answers[1], answers[2], answers[3]

	if ptr.typ != 12 || ptr.name != serviceName {
		t.Errorf("first answer is %s type %d, want a PTR for %s", ptr.name, ptr.typ, serviceName)
	}
	if got, n := decodeName(ptr.rdata, 0); got != instance || n != len(ptr.rdata) {
		t.Errorf("PTR points at %q (consumed %d of %d)", got, n, len(ptr.rdata))
	}
	// The PTR is shared, so it must NOT set the cache-flush bit: another
	// controller advertising the same service is not a conflict.
	if ptr.class&0x8000 != 0 {
		t.Error("the PTR sets cache-flush — it would evict other controllers' records for this service")
	}

	if srv.typ != 33 || srv.name != instance {
		t.Errorf("second answer is %s type %d, want an SRV for the instance", srv.name, srv.typ)
	}
	if len(srv.rdata) < 7 {
		t.Fatalf("SRV rdata is %d bytes", len(srv.rdata))
	}
	if port := binary.BigEndian.Uint16(srv.rdata[4:6]); port != 8737 {
		t.Errorf("SRV advertises port %d, want 8737 — the phone would dial the wrong port", port)
	}
	if got, n := decodeName(srv.rdata, 6); got != host || 6+n != len(srv.rdata) {
		t.Errorf("SRV target %q (consumed %d of %d)", got, n, len(srv.rdata))
	}

	if txt.typ != 16 || txt.name != instance {
		t.Errorf("third answer is %s type %d, want a TXT for the instance", txt.name, txt.typ)
	}
	// TXT rdata is length-prefixed strings that must exactly fill the record.
	var strs []string
	for i := 0; i < len(txt.rdata); {
		l := int(txt.rdata[i])
		if i+1+l > len(txt.rdata) {
			t.Fatalf("TXT string at %d claims %d bytes, past the record", i, l)
		}
		strs = append(strs, string(txt.rdata[i+1:i+1+l]))
		i += 1 + l
	}
	if len(strs) != 2 || strs[0] != "v=1" || strs[1] != "id=de71ce00" {
		t.Errorf("TXT carries %q, want the configured pairs", strs)
	}

	if arec.typ != 1 || arec.name != host {
		t.Errorf("fourth answer is %s type %d, want an A for the host", arec.name, arec.typ)
	}
	if len(arec.rdata) != 4 {
		t.Errorf("A record rdata is %d bytes, want 4", len(arec.rdata))
	}

	// Every unique record carries the cache-flush bit and the service TTL.
	for _, a := range []rr{srv, txt, arec} {
		if a.class&0x8000 == 0 {
			t.Errorf("%s does not set cache-flush — a stale address would linger after a move", a.name)
		}
		if a.class&0x7FFF != 1 {
			t.Errorf("%s class %#x is not IN", a.name, a.class)
		}
		if a.ttl != ttlSeconds {
			t.Errorf("%s ttl %d, want %d", a.name, a.ttl, ttlSeconds)
		}
	}
}

// An advertiser with no TXT pairs still emits a valid TXT record: the format
// requires at least one (empty) string, and a zero-length rdata is malformed.
func TestAnEmptyTXTIsStillAValidRecord(t *testing.T) {
	a := &Advertiser{Instance: "lintel-x", Port: 1}
	pkt := a.buildResponse(1)
	if pkt == nil {
		t.Skip("no non-loopback IPv4 on this host")
	}
	_, _, answers := walkResponse(t, pkt)
	for _, r := range answers {
		if r.typ == 16 && len(r.rdata) == 0 {
			t.Error("TXT rdata is empty — the record must carry at least one zero-length string")
		}
	}
}

// A TXT pair longer than a single DNS string is dropped rather than truncated
// or written with a wrapped length byte, which would corrupt every record after
// it. The walk is what proves the rest of the packet survived.
func TestAnOversizedTXTPairIsDroppedNotWrapped(t *testing.T) {
	a := &Advertiser{Instance: "lintel-x", Port: 1, TXT: []string{strings.Repeat("k", 300), "v=1"}}
	pkt := a.buildResponse(1)
	if pkt == nil {
		t.Skip("no non-loopback IPv4 on this host")
	}
	_, _, answers := walkResponse(t, pkt)
	for _, r := range answers {
		if r.typ != 16 {
			continue
		}
		if got := int(r.rdata[0]); got != 3 {
			t.Errorf("first TXT string claims %d bytes, want the 3 of \"v=1\" — the oversized "+
				"pair was not dropped", got)
		}
	}
}
