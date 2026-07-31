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
