package camera

// RFC 6184 depacketization: RTP packets carrying H.264 into Annex-B framed NAL
// units. This is the decode step rtsp.go's file comment names and stops short
// of: "H.264 depacketization is not [as testable as RTP framing]: FU-A
// fragmentation, STAP-A aggregation and parameter-set handling vary between
// real cameras in ways a fake written from the same RFC would simply agree
// with."
//
// That warning is about testing method, not about whether the wire format
// itself is knowable — RFC 6184 §5.2/5.7/5.8 fully specify the three
// packetization modes handled here, and the format is exactly as fixed as the
// RTP header seq.go already depends on. What stays true, and is repeated in
// this file's test comments rather than only here, is that a depacketizer
// tested only against its own packetizer's output proves the two agree with
// each other and proves nothing about the RFC. So the tests below are built
// from literal byte slices with the bit layout spelled out in comments, not
// round-tripped against a packetizer written in this package.
//
// This file still does not decode a picture. It produces Annex-B NAL units —
// SPS, PPS, slices, byte for byte — and stops. Turning those into frames is
// an H.264 decoder, a piece of software this repository has no reason to
// reimplement and no CGO policy that would let it wrap one. Muxing them into
// a file is a separate job again, with its own retention decisions
// (docs/CAMERA-RETENTION.md), and is deliberately out of scope here — it lives
// in fmp4.go, with accessunit.go grouping this file's output into the pictures
// a muxer needs.
//
// # Why a lost packet must destroy the whole NAL, not just a few bytes
//
// H.264's entropy coding (CAVLC/CABAC) has no resync point inside a slice:
// losing any byte in the middle desynchronises every bit after it, and the
// decoder cannot tell where the damage stops. A depacketizer that stitches
// fragments across a gap "because most of it arrived" hands the decoder a
// well-formed-looking NAL that is actually garbage past the hole — which is
// worse than dropping it, because a corrupt PPS or slice header can wedge a
// real decoder rather than just producing a bad frame. So this package's rule
// throughout is: any break in an FU-A run — a sequence gap, a packet that
// arrives out of the order it was sent in, a new start before the old one
// ended — throws the whole partial NAL away rather than emitting it short.
//
// # One instance per RTP source
//
// Like seqTracker, a Depacketizer follows one SSRC's sequence space. Feeding
// it two interleaved sources would reassemble fragments from one stream using
// the other's sequence numbers as continuity evidence, which is not evidence
// of anything. A caller multiplexing multiple SSRCs needs one Depacketizer
// per SSRC, exactly as it needs one seqTracker per SSRC.

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// fuState is where a Depacketizer's FU-A (RFC 6184 §5.8) reassembly stands.
type fuState uint8

const (
	// fuIdle: no reassembly in progress. A continuation fragment (FU header
	// S=0) arriving here has no start to extend and is dropped outright.
	fuIdle fuState = iota
	// fuActive: a valid start fragment was seen and every fragment since has
	// been the next expected sequence number. buf holds real, trustworthy
	// bytes.
	fuActive
	// fuOrphan: this run is known to be unrecoverable — either fuActive broke
	// on a gap, or a continuation arrived with no start at all — and exactly
	// one drop has already been counted for it. Further continuation
	// fragments of the same broken run are discarded silently rather than
	// each incrementing dropped again; the state returns to fuIdle once an
	// end bit is seen (whether or not anything trustworthy accompanied it) or
	// a new start begins.
	fuOrphan
)

// Depacketizer turns one RTP source's H.264 payload (RFC 6184) into Annex-B
// framed NAL units: single NAL unit packets (types 1-23), STAP-A aggregation
// (type 24), and FU-A fragmentation (type 28). STAP-B, MTAP16, MTAP24 and FU-B
// (types 25-27, 29) are not implemented — they exist for interleaved and
// multi-time modes that do not occur on the ordinary, non-interleaved RTP
// transport this package's RTSP client negotiates, and reporting them as
// unsupported is more honest than a handler nobody can test against a camera
// that sends them.
//
// Not safe for concurrent use. Construct one per RTP source (see the file
// comment).
type Depacketizer struct {
	buf       []byte // in-progress FU-A reassembly; valid only in fuActive
	state     fuState
	expectSeq uint16 // next sequence number that may extend buf

	emitted int
	dropped int
}

// NewDepacketizer returns a Depacketizer ready to accept the first packet of
// a stream.
func NewDepacketizer() *Depacketizer { return &Depacketizer{} }

// Emitted is how many complete NAL units this Depacketizer has produced.
func (d *Depacketizer) Emitted() int { return d.emitted }

// Dropped is how many NAL units this Depacketizer knows it could not
// reconstruct: an FU-A run broken by a sequence gap or an out-of-order
// arrival, one abandoned because a new start (or an unrelated packet) arrived
// before its end bit, a continuation fragment whose start was never seen, or
// a STAP-A whose declared size ran past what the packet actually carried.
//
// This is to NAL loss what MediaFlow.Lost is to packet loss, and the two are
// deliberately not the same number: one lost RTP packet in the middle of a
// multi-fragment NAL takes the whole NAL down, so a caller that only has
// packet-level loss cannot tell "one packet missing, one frame smeared" from
// "one packet missing, nothing else affected". Matching seq.go's existing
// contract — count it, report it, do not fold it into a number that hides it.
func (d *Depacketizer) Dropped() int { return d.dropped }

// Reset clears all in-progress reassembly state, for a caller that knows the
// source has restarted (a new PLAY, a reconnect) and wants stale FU-A state
// discarded rather than incorrectly gated against the old sequence space.
func (d *Depacketizer) Reset() { *d = Depacketizer{} }

// Push processes one RTP packet — the full packet as read off the wire,
// header included, the same shape countInterleaved already parses in rtsp.go
// — and returns zero or more complete Annex-B NAL units it produced.
//
// Zero is a normal outcome, not a signal of anything having gone wrong: a
// non-final FU-A fragment legitimately produces no output yet. A non-nil
// error means this one packet was malformed or unusable in some way (bad RTP
// framing, an FU-A run broken by a gap, a truncated STAP-A); the Depacketizer
// remains valid to keep pushing into afterward; the error's purpose is
// diagnostics, and Dropped() is the durable record of what was lost, since a
// caller that only logs a stream of transient per-packet errors will not
// notice the pattern the way a running counter makes visible.
func (d *Depacketizer) Push(pkt []byte) ([][]byte, error) {
	hdr, payload, err := parseRTPHeader(pkt)
	if err != nil {
		// The RTP framing itself is unusable, so nothing about this packet's
		// place in a sequence can be trusted either. Whatever FU-A run was in
		// progress cannot be assumed to continue past it.
		d.breakActive()
		return nil, err
	}
	if len(payload) == 0 {
		d.breakActive()
		return nil, errors.New("camera: rtp/h264: zero-length RTP payload")
	}

	// RFC 6184 §5.3: the low 5 bits of the first payload byte are the NAL
	// unit type (for a single NAL) or the packetization mode's own type value
	// (24 STAP-A, 28 FU-A). The top 3 bits (F, and the 2-bit NRI) belong to
	// this byte only when it IS a real NAL header — for STAP-A and FU-A it is
	// a mode-marker byte instead, which is why the FU-A path below rebuilds a
	// header from different bytes rather than reusing this one.
	naluType := payload[0] & 0x1F

	if naluType == 28 {
		return d.fuA(hdr.Seq, payload)
	}

	// Any packet type other than a continuing FU-A fragment ends whatever
	// fragmentation was in progress: the sender moved on to a new access unit
	// or an unfragmented NAL before this reassembly ever saw its end bit.
	d.breakActive()

	switch {
	case naluType >= 1 && naluType <= 23:
		// RFC 6184 §5.6: the RTP payload IS the NAL unit, header and all.
		// Nothing to reconstruct; the whole payload becomes the NAL body.
		d.emitted++
		return [][]byte{annexB(payload)}, nil
	case naluType == 24:
		return d.stapA(payload)
	default:
		return nil, fmt.Errorf(
			"camera: rtp/h264: packetization type %d (STAP-B/MTAP16/MTAP24/FU-B) is not implemented",
			naluType)
	}
}

// breakActive ends an in-progress fuActive reassembly, counting it as one
// dropped NAL. A no-op when nothing was active, so it is safe to call on
// every packet that is not itself a continuing FU-A fragment.
func (d *Depacketizer) breakActive() {
	if d.state == fuActive {
		d.dropped++
	}
	d.buf = nil
	d.state = fuIdle
}

// fuA reassembles one RFC 6184 §5.8 Fragmentation Unit (type A).
//
// Wire layout of the payload (the two bytes Push has already confirmed
// exist beyond the type check, since fuA additionally requires a header):
//
//	byte 0: FU indicator  — F(1) NRI(2) Type(5)=28
//	byte 1: FU header     — S(1) E(1) R(1) Type(5)  [original NAL type]
//	byte 2..: fragment data
//
// The original NAL's header byte — the one that would have appeared once at
// the front of an unfragmented packet — never crosses the wire intact. It is
// rebuilt from two different packets' worth of bits: F and NRI travel in
// every fragment's FU indicator, and the original Type travels in every
// fragment's FU header. Reconstructing it wrong (say, keeping the FU
// indicator's own type field instead) would tag every reassembled NAL as
// type 28, which no H.264 consumer recognises as anything.
func (d *Depacketizer) fuA(seq uint16, payload []byte) ([][]byte, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf(
			"camera: rtp/h264: FU-A payload is %d byte(s), too short for its indicator+header", len(payload))
	}
	indicator, fuHeader := payload[0], payload[1]
	start := fuHeader&0x80 != 0 // S bit
	end := fuHeader&0x40 != 0   // E bit
	// fuHeader&0x20 is R, the reserved bit. RFC 6184 §5.8: "The reserved bit
	// MUST be set to 0 ... and MUST be ignored by the receiver." Not checked,
	// on purpose — a camera that gets this wrong is still sending recoverable
	// video, and refusing it over an ignorable bit would be this package's
	// own bug, not the camera's.
	fragment := payload[2:]

	if start {
		// A start bit always wins over whatever was in progress. If that was
		// fuActive, it never reached an end bit and is now known lost; if it
		// was already fuOrphan, it was counted once already and must not be
		// counted again just for a fresh start arriving.
		if d.state == fuActive {
			d.dropped++
		}
		// F and NRI come from the FU indicator's top 3 bits; the original
		// NAL's type comes from the FU header's low 5 bits. Together they are
		// exactly the header byte RFC 6184 says was never sent whole.
		naluHeader := (indicator & 0xE0) | (fuHeader & 0x1F)
		d.buf = append([]byte{naluHeader}, fragment...)
		d.state = fuActive
		d.expectSeq = seq + 1
		if end {
			// RFC 6184 §5.8 permits S and E both set: a fragmentation unit of
			// exactly one fragment. Unusual, not invalid.
			return d.finishActive()
		}
		return nil, nil
	}

	switch d.state {
	case fuActive:
		if seq != d.expectSeq {
			// A gap: a packet between the last fragment and this one never
			// arrived, or this one arrived out of the order it was sent in.
			// Either way, this fragment cannot be assumed to be adjacent in
			// the encoder's bitstream to what is already buffered, so the
			// buffer is discarded rather than stitched across the hole. See
			// the file comment for why a partial NAL must never be emitted
			// here instead.
			d.dropped++
			d.state = fuOrphan
			if end {
				// The run is definitively over, trustworthy or not: return to
				// idle so the NEXT start is treated as a fresh attempt, not
				// folded into this one's already-counted loss.
				d.state = fuIdle
			}
			return nil, fmt.Errorf(
				"camera: rtp/h264: FU-A sequence gap (expected %d, got %d), partial NAL discarded",
				d.expectSeq, seq)
		}
		d.buf = append(d.buf, fragment...)
		d.expectSeq = seq + 1
		if end {
			return d.finishActive()
		}
		return nil, nil

	case fuOrphan:
		if end {
			d.state = fuIdle
		}
		return nil, nil // already counted; there is nothing here to emit

	default: // fuIdle
		// A continuation with no start ever seen: the fragment that would
		// have carried S=1 was lost before this Depacketizer ever observed
		// it, or this stream is being picked up mid-run. There is no header
		// to rebuild and no buffer to extend, so — per the file comment's
		// rule — this is dropped rather than treated as a start.
		d.dropped++
		if !end {
			d.state = fuOrphan
		}
		return nil, errors.New("camera: rtp/h264: FU-A continuation fragment with no start ever seen")
	}
}

// finishActive closes out a complete fuActive reassembly.
func (d *Depacketizer) finishActive() ([][]byte, error) {
	out := annexB(d.buf)
	d.buf = nil
	d.state = fuIdle
	d.emitted++
	return [][]byte{out}, nil
}

// stapA splits a Single-Time Aggregation Packet (RFC 6184 §5.7.1) into its
// constituent NAL units.
//
// Wire layout: `[STAP-A header, 1 byte, already consumed by Push's type
// check] { [uint16 size][size bytes of one full NAL unit] }+`.
//
// Every size here is a length read off the wire — written by whatever camera
// (or anything on the network claiming to be one) sent this packet — and is
// exactly the kind of value this package cannot trust. A size that runs past
// what is actually left in the packet is not a hypothetical edge case; it is
// the first thing a fuzzer finds if the bound is missing, because the field
// is 16 bits and the packet is not. Every size is checked against the
// remaining buffer BEFORE it is used to slice, never after.
//
// A NAL unit already fully validated (its size fit) is returned even if a
// later one in the same packet is truncated: each one returned was
// independently bounds-checked, and discarding the whole packet over damage
// to its LAST entry would throw away NALs that decoded correctly. The
// truncation itself is reported both as an error and as one dropped NAL — the
// entry that could not be recovered.
func (d *Depacketizer) stapA(payload []byte) ([][]byte, error) {
	var out [][]byte
	i := 1 // payload[0] is the STAP-A header/mode-marker byte, not a NAL
	for i < len(payload) {
		if i+2 > len(payload) {
			d.dropped++
			return out, fmt.Errorf(
				"camera: rtp/h264: STAP-A size field runs past the packet (%d byte(s) left)",
				len(payload)-i)
		}
		size := int(binary.BigEndian.Uint16(payload[i : i+2]))
		i += 2
		if size <= 0 {
			d.dropped++
			return out, fmt.Errorf("camera: rtp/h264: STAP-A declares a non-positive NAL size %d", size)
		}
		if i+size > len(payload) {
			d.dropped++
			return out, fmt.Errorf(
				"camera: rtp/h264: STAP-A declares a %d-byte NAL with only %d byte(s) left",
				size, len(payload)-i)
		}
		out = append(out, annexB(payload[i:i+size]))
		d.emitted++
		i += size
	}
	if len(out) == 0 {
		return nil, errors.New("camera: rtp/h264: STAP-A carries no aggregated NAL units")
	}
	return out, nil
}

// annexB returns a fresh copy of nal with a 4-byte Annex-B start code
// (0x00000001) prepended.
//
// Always a fresh allocation, never a reslice of the input: nal is a window
// into the RTP packet Push was called with (or, for FU-A, into d.buf, which
// the next Push call mutates via append). A caller that held onto a reslice
// of either would find its "NAL unit" silently changed under it by whatever
// arrives next.
func annexB(nal []byte) []byte {
	out := make([]byte, 4+len(nal))
	out[0], out[1], out[2], out[3] = 0, 0, 0, 1
	copy(out[4:], nal)
	return out
}

// rtpFixedHeaderLen is RFC 3550 §5.1's fixed part: version/P/X/CC (1),
// M/PT (1), sequence number (2), timestamp (4), SSRC (4).
const rtpFixedHeaderLen = 12

// parseRTPHeader strips RFC 3550's fixed header, any CSRC list, any header
// extension, and any padding, returning the sequence number and the payload
// bytes Push's packetization-mode switch looks at.
//
// Every length read here — the CSRC count, the extension's word count, the
// padding count — comes off the wire the same way a STAP-A's NAL sizes do,
// and is bounds-checked the same way: computed, checked against what is
// actually left in the packet, and only then used to advance past bytes that
// might not be there.
// rtpHeader is the part of RFC 3550 §5.1 this package acts on.
//
// Timestamp and Marker exist for accessunit.go: all packets of one access unit
// carry the same timestamp, which is how a frame boundary is recognised without
// parsing a slice header. Returned as a struct rather than added to the return
// list because a five-value signature invites callers to mix up two uint fields
// that are both plausible in either position.
type rtpHeader struct {
	Seq uint16
	// Timestamp is the sampling instant of the access unit this packet belongs
	// to, in the media clock (90 kHz for H.264). Shared by every packet of one
	// frame, and it wraps — a uint32 at 90 kHz wraps in about 13¼ hours, so
	// deltas must be taken as signed differences rather than by subtraction.
	Timestamp uint32
	// Marker is set by a sender on the last packet of an access unit
	// (RFC 6184 §5.1). Recorded but never used to close one — see accessunit.go
	// for why.
	Marker bool
}

func parseRTPHeader(pkt []byte) (hdr rtpHeader, payload []byte, err error) {
	if len(pkt) < rtpFixedHeaderLen {
		return rtpHeader{}, nil, fmt.Errorf(
			"camera: rtp/h264: %d-byte packet shorter than the 12-byte RTP header", len(pkt))
	}
	version := pkt[0] >> 6
	if version != 2 {
		return rtpHeader{}, nil, fmt.Errorf("camera: rtp/h264: RTP version %d, want 2", version)
	}
	padded := pkt[0]&0x20 != 0
	extended := pkt[0]&0x10 != 0
	csrcCount := int(pkt[0] & 0x0F)
	hdr.Seq = binary.BigEndian.Uint16(pkt[2:4])
	hdr.Timestamp = binary.BigEndian.Uint32(pkt[4:8])
	hdr.Marker = pkt[1]&0x80 != 0

	off := rtpFixedHeaderLen + 4*csrcCount
	if off > len(pkt) {
		return rtpHeader{}, nil, fmt.Errorf("camera: rtp/h264: CSRC count %d runs past the packet", csrcCount)
	}
	if extended {
		// RFC 3550 §5.3.1: a 2-byte profile-specific id this package does not
		// interpret, then a 2-byte length in 32-bit WORDS (not bytes) that the
		// extension data occupies.
		if off+4 > len(pkt) {
			return rtpHeader{}, nil, errors.New(
				"camera: rtp/h264: extension flag set with no room for the 4-byte extension header")
		}
		extWords := int(binary.BigEndian.Uint16(pkt[off+2 : off+4]))
		off += 4 + 4*extWords
		if off > len(pkt) {
			return rtpHeader{}, nil, fmt.Errorf(
				"camera: rtp/h264: header extension declares %d word(s) past the packet", extWords)
		}
	}

	end := len(pkt)
	if padded {
		if off >= end {
			return rtpHeader{}, nil, errors.New(
				"camera: rtp/h264: padding flag set with no payload byte to hold a pad count")
		}
		// RFC 3550 §5.1: the last byte of the packet, when P is set, is the
		// count of padding bytes including itself.
		padCount := int(pkt[end-1])
		if padCount == 0 || off+padCount > end {
			return rtpHeader{}, nil, fmt.Errorf(
				"camera: rtp/h264: padding count %d does not fit the %d-byte payload region",
				padCount, end-off)
		}
		end -= padCount
	}
	return hdr, pkt[off:end], nil
}
