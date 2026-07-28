package discovery

import "testing"

// mDNS packets come from anything on the network, unauthenticated, by
// construction — the package comment says so and refuses to pair on the
// strength of one. That makes parseResponse the hub's most exposed parser: a
// panic in it is reachable by any host on the LAN sending one UDP datagram, and
// a hub that dies on a malformed broadcast is a hub that stops opening gates.
//
// This is the first fuzz target in the repository. It exists because the parser
// makes two claims a regression could quietly break, both of which are exactly
// what a fuzzer is good at:
//
//   - Compression pointers are followed with a BOUND. RFC 1035 imposes none, so
//     a packet naming a pointer that points at itself is legal and hangs an
//     unbounded decoder. decodeName caps it at sixteen jumps.
//   - Every read is length-checked against the packet. A truncated record, an
//     rdlength longer than what follows, a label running off the end — all of
//     these are ordinary on a busy network and none may index past the slice.
//
// The property asserted is simply "does not panic and does not hang". There is
// no correct parse of a corrupt packet to compare against, and inventing one
// would test the fuzzer's idea of mDNS rather than this parser's safety.
func FuzzParseResponse(f *testing.F) {
	// A well-formed response, so the fuzzer starts from something that reaches
	// the record loop rather than bouncing off the length check.
	f.Add(buildQuery(ServiceName))

	// A minimal response header with the QR bit set: 12 bytes, one answer
	// promised and no bytes to back it.
	f.Add([]byte{0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0})

	// A name that is a compression pointer to itself — the hang this parser
	// bounds. 0xC0 0x0C points at offset 12, which is where it sits.
	f.Add([]byte{0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xC0, 0x0C})

	// An rdlength claiming far more than the packet holds.
	f.Add([]byte{0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 33, 0, 1, 0, 0, 0, 0, 0xFF, 0xFF})

	f.Fuzz(func(t *testing.T, pkt []byte) {
		found := map[string]*Controller{}
		parseResponse(pkt, found)

		// Whatever it decided, the result must be usable: a Controller with a
		// nil Extra map would panic on the next write, and the caller does
		// write to it.
		for _, c := range found {
			if c.Extra == nil {
				t.Fatalf("parsed a controller with a nil Extra map: %+v", c)
			}
		}
	})
}

// decodeName is where the pointer-loop bound lives, so it gets its own target:
// reaching it through parseResponse requires a packet well-formed enough to get
// past the header and question sections, which is a narrow target for a fuzzer
// to hit by chance.
func FuzzDecodeName(f *testing.F) {
	f.Add([]byte{3, 'a', 'b', 'c', 0}, 0)
	f.Add([]byte{0xC0, 0x00}, 0)             // pointer to itself
	f.Add([]byte{0xC0, 0x02, 0xC0, 0x00}, 0) // two pointers, mutual loop
	f.Add([]byte{5, 'a'}, 0)                 // label longer than the buffer

	f.Fuzz(func(t *testing.T, pkt []byte, off int) {
		// Offsets outside the packet are the caller's business; the parser is
		// only asked to survive plausible ones.
		if off < 0 || off > len(pkt) {
			t.Skip()
		}
		name, next := decodeName(pkt, off)

		// The contract: a failure returns next < 0. A success must not report a
		// position outside the packet, because the caller uses it to keep
		// walking and would read past the end.
		if next >= 0 && next > len(pkt) {
			t.Fatalf("decodeName(%q, %d) = (%q, %d): next is past the packet (len %d)",
				pkt, off, name, next, len(pkt))
		}
	})
}
