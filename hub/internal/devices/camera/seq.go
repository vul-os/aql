package camera

// RTP sequence tracking: is the media arriving INTACT, not just arriving.
//
// # Why this is worth having when depacketization is not
//
// ProbeMedia answers "is media flowing" by counting packets. That is a real
// answer to a real question, and it is not the whole one: a camera on a weak
// Wi-Fi link, or behind a switch that is dropping frames, sends packets the
// whole time and produces a smeared or frozen picture anyway. Under a
// packet-count-only probe that camera reports as healthy, and the operator is
// told the stream is fine while looking at a broken one.
//
// This stays firmly below the line rtsp.go draws. The RTP header is a fixed
// 12-byte layout from RFC 3550 with the sequence number at bytes 2-3 — a wire
// format a test can serve faithfully, which is exactly the property that makes
// the interleaved framing testable and H.264 depacketization not. Nothing here
// looks at a payload.
//
// # Counting loss without lying about it
//
// Naively "expected minus seen" breaks three ways, and all three happen on real
// networks:
//
//   - The sequence number is 16-bit and WRAPS at 65535→0. A probe that treats
//     the wrap as a 65000-packet loss reports a catastrophe every 30 seconds on
//     a healthy stream.
//   - Packets ARRIVE OUT OF ORDER. A late packet is not a lost one, and
//     counting it as loss then un-counting it produces a number that depends on
//     when you looked.
//   - Packets are DUPLICATED by some networks. More received than expected is
//     not negative loss.
//
// So this uses RFC 3550's approach (§A.3): extend the 16-bit sequence into a
// 32-bit space by tracking wraps, then compare the RANGE observed against the
// COUNT received. Reordering and duplication fall out for free — a reordered
// packet is inside the range and counted once; a duplicate raises received
// without raising the range, and the result is clamped at zero rather than
// reported as negative loss.
//
// Per SSRC, because two sources on one channel are two independent sequence
// spaces and interleaving them would manufacture loss that is not there.

// maxDropout is how far ahead a sequence number may jump before the jump is
// read as a source restart rather than a run of losses. RFC 3550 uses 3000.
const maxDropout = 3000

// seqTracker follows one SSRC's sequence space.
type seqTracker struct {
	started  bool
	cycles   uint32 // wraps seen, in units of 65536
	baseExt  uint64 // extended seq of the first packet
	maxExt   uint64 // highest extended seq seen
	received uint64
	restarts int
	lastSeq  uint16
}

func (t *seqTracker) observe(seq uint16) {
	t.received++
	if !t.started {
		t.started = true
		t.lastSeq = seq
		t.baseExt = uint64(seq)
		t.maxExt = uint64(seq)
		return
	}

	// Wrap detection is a forward step that lands below the previous value.
	// Distinguished from a REORDERED packet (also below, but only slightly) by
	// the size of the gap: a wrap looks like a huge backwards jump.
	if seq < t.lastSeq && uint16(t.lastSeq-seq) > maxDropout {
		t.cycles++
	}
	ext := uint64(t.cycles)<<16 | uint64(seq)

	switch {
	case ext > t.maxExt+maxDropout:
		// Too far ahead to be loss on any real link. Treat it as the source
		// restarting its sequence space and re-base, rather than reporting a
		// loss figure in the thousands that is an artefact of the restart.
		t.restarts++
		t.cycles = 0
		t.baseExt = uint64(seq)
		t.maxExt = uint64(seq)
		t.received = 1
	case ext > t.maxExt:
		t.maxExt = ext
	}
	t.lastSeq = seq
}

// expected is how many packets the observed range implies.
func (t *seqTracker) expected() uint64 {
	if !t.started {
		return 0
	}
	return t.maxExt - t.baseExt + 1
}

// lost is expected minus received, floored at zero.
//
// Floored rather than allowed negative: duplicates make received exceed
// expected, and "-3 packets lost" is not a thing an operator can act on.
func (t *seqTracker) lost() uint64 {
	exp := t.expected()
	if exp <= t.received {
		return 0
	}
	return exp - t.received
}

// seqSet tracks every SSRC seen in one probe.
type seqSet map[uint32]*seqTracker

func (s seqSet) observe(ssrc uint32, seq uint16) {
	t, ok := s[ssrc]
	if !ok {
		t = &seqTracker{}
		s[ssrc] = t
	}
	t.observe(seq)
}

// totals folds every source into one answer.
//
// Summed across sources rather than reported per source: the question an
// operator has is "is this camera's stream intact", and a per-SSRC breakdown is
// detail for a case (multiplexing) that MediaFlow.SSRCs already flags.
func (s seqSet) totals() (expected, received, lost uint64, restarts int) {
	for _, t := range s {
		expected += t.expected()
		received += t.received
		lost += t.lost()
		restarts += t.restarts
	}
	return
}
