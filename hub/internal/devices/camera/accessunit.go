package camera

// Grouping NAL units into access units — the piece fmp4.go declined to do and
// named as the caller's job. This is that caller.
//
// h264.go turns RTP packets into NAL units. fmp4.go turns access units into a
// playable container. Between them sits the question "which NAL units belong to
// the same picture", and nothing answered it, so the chain from a camera's
// packets to a file was broken in the middle.
//
// # The boundary signal, and the one this deliberately does not use
//
// fmp4.go said grouping "needs first_mb_in_slice from each slice header, and the
// rules for when a new picture starts (H.264 §7.4.1.2) are genuinely fiddly."
// That is true of an H.264 elementary stream read from a file. It is not true
// here, because RTP already carries the answer: RFC 3550 §5.1 requires every
// packet of one access unit to share a timestamp, and RFC 6184 §8.4 restates it
// for H.264. A timestamp change IS a picture boundary, and reading it costs four
// bytes of header rather than a second bitstream parser.
//
// The marker bit is the tempting shortcut and is not used to close an access
// unit. RFC 6184 §5.1 says a sender SHOULD set it on the last packet of an
// access unit, and real cameras set it early, late, or never. Trusting it buys
// one packet of latency and risks splitting a picture in two; the timestamp
// costs that one packet and cannot split anything. For a recorder the latency is
// irrelevant, and for live view it is one frame interval.
//
// So the marker bit is recorded and cross-checked instead: MarkerDisagreements
// counts how often a sender's marker bit did not fall where the timestamps say
// the boundary was. That turns "this camera's marker bits are unreliable" into a
// number someone can read, without letting an unreliable one corrupt the output.
//
// # Parameter sets are separated, not passed through
//
// An SPS or PPS arriving in-band belongs in the container's avcC, not in a
// sample: avc1 tracks carry parameter sets in the sample entry, and a decoder
// reading them from mdat instead is relying on tolerance rather than on the
// format. So they are captured — SPS()/PPS() — and left out of the access unit's
// NAL list.
//
// This is also what makes a camera that sends no sprop-parameter-sets usable: a
// caller can wait for SPS() and PPS() to be populated and construct the
// Fragmenter from those, rather than needing the SDP to have carried them.
//
// # Start codes
//
// Depacketizer emits Annex-B framed NAL units and Fragment refuses Annex-B
// framed input. That is not an inconsistency to paper over — it is why Fragment
// refuses them loudly. This file is the one place that strips the framing, so
// there is a single conversion between the two representations rather than a
// convention each caller has to remember.

import (
	"errors"
	"fmt"
)

// NAL unit types this file acts on (H.264 Table 7-1). The rest are passed
// through into the access unit untouched.
const (
	nalTypeNonIDRSlice = 1
	nalTypeIDRSlice    = 5
	nalTypeSEI         = 6
	nalTypePPS         = 8
	nalTypeAUD         = 9
)

// AccessUnit is one decoded picture's worth of NAL units.
type AccessUnit struct {
	// RTPTimestamp is the media-clock instant every packet of this picture
	// carried.
	RTPTimestamp uint32
	// Duration is how long until the next picture, in media-clock units.
	//
	// Zero means not known rather than instantaneous, and the only access unit
	// that can carry a zero is the last one — the one Flush returns, whose
	// successor never arrived to say when it ended. A caller writing that sample
	// has to choose a duration; this type refuses to choose one for it, because a
	// guessed final frame duration is indistinguishable from a measured one once
	// it is in the container.
	Duration uint32
	// NALUnits are bare NAL units, start codes stripped, in arrival order.
	// Parameter sets are not among them — see SPS and PPS.
	NALUnits [][]byte
	// IsSync is true when this picture contains an IDR slice, making it a point
	// a player may start or seek to.
	IsSync bool
}

// Assembler turns one RTP source's packets into access units.
//
// Not safe for concurrent use, and one per SSRC, for the same reason
// Depacketizer is: the timestamps of two interleaved sources would be read as
// one source's picture boundaries.
type Assembler struct {
	depack *Depacketizer

	// pending is the access unit being accumulated. Nil before the first VCL
	// NAL arrives.
	pending    *AccessUnit
	haveTS     bool
	pendingTS  uint32
	sps        []byte
	pps        []byte
	markerSeen bool

	emitted             int
	markerDisagreements int
	backwardsTS         int
}

// NewAssembler returns an Assembler ready for the first packet of a stream.
func NewAssembler() *Assembler {
	return &Assembler{depack: NewDepacketizer()}
}

// SPS returns the most recent in-band sequence parameter set, or nil.
//
// A copy: the caller keeps it for the life of a Fragmenter, and handing out the
// slice this Assembler will overwrite on the next parameter-set change would
// silently rewrite an init segment already sent to a player.
func (a *Assembler) SPS() []byte { return cloneBytes(a.sps) }

// PPS returns the most recent in-band picture parameter set, or nil.
func (a *Assembler) PPS() []byte { return cloneBytes(a.pps) }

// Emitted is how many complete access units this Assembler has produced.
func (a *Assembler) Emitted() int { return a.emitted }

// MarkerDisagreements counts pictures whose boundary, as determined by the RTP
// timestamp, did not coincide with a marker bit.
//
// A healthy sender leaves this at zero. A non-zero count means the marker bits
// cannot be trusted for anything — which is worth surfacing to whoever is
// debugging a camera, and is exactly the fact that would have been destroyed by
// using them to close access units.
func (a *Assembler) MarkerDisagreements() int { return a.markerDisagreements }

// BackwardsTimestamps counts packets whose timestamp preceded the access unit
// already being assembled.
//
// A picture cannot be reopened once its successor has started, so these packets
// are lost. Counted rather than silently absorbed: a stream that reorders across
// picture boundaries produces visibly wrong output and the count is the only
// evidence of why.
func (a *Assembler) BackwardsTimestamps() int { return a.backwardsTS }

// Depacketizer exposes the underlying NAL-level state, so a caller can read
// Dropped() — NAL loss and access-unit loss are different numbers and folding
// them together would hide which one happened.
func (a *Assembler) Depacketizer() *Depacketizer { return a.depack }

// Push processes one RTP packet and returns any access units it completed.
//
// At most one: a packet either continues the current picture or starts the next
// one, and starting the next is what completes the previous. An error concerns
// the packet, not the Assembler, which stays usable — the same contract as
// Depacketizer.Push.
func (a *Assembler) Push(pkt []byte) ([]AccessUnit, error) {
	hdr, _, err := parseRTPHeader(pkt)
	if err != nil {
		return nil, err
	}
	nals, perr := a.depack.Push(pkt)

	var done []AccessUnit
	// The timestamp is read before the NAL units are examined, because the
	// boundary belongs to the packet rather than to its contents: a packet
	// carrying only a parameter set still marks the start of a new picture if its
	// timestamp moved.
	if a.haveTS && hdr.Timestamp != a.pendingTS {
		delta := int32(hdr.Timestamp - a.pendingTS)
		if delta < 0 {
			// Reordered across a picture boundary. The previous picture is
			// already closed or closing; this packet's contents cannot be put
			// back into it.
			a.backwardsTS++
		} else if au := a.close(uint32(delta)); au != nil {
			done = append(done, *au)
		}
		if delta >= 0 {
			a.pendingTS = hdr.Timestamp
		}
	} else if !a.haveTS {
		a.pendingTS = hdr.Timestamp
		a.haveTS = true
	}

	for _, framed := range nals {
		nal, err := stripStartCode(framed)
		if err != nil {
			// Depacketizer produced something this file cannot read, which is a
			// bug in one of the two rather than a property of the stream.
			return done, err
		}
		switch nal[0] & 0x1f {
		case nalTypeSPS:
			a.sps = cloneBytes(nal)
		case nalTypePPS:
			a.pps = cloneBytes(nal)
		case nalTypeAUD:
			// An access unit delimiter says a picture starts here and carries no
			// picture data. Dropped rather than stored: it is redundant with the
			// timestamp boundary, and keeping it would put a NAL in the sample
			// whose only purpose is to restate what the container already says.
		default:
			if a.pending == nil {
				a.pending = &AccessUnit{RTPTimestamp: a.pendingTS}
			}
			a.pending.NALUnits = append(a.pending.NALUnits, nal)
			if nal[0]&0x1f == nalTypeIDRSlice {
				a.pending.IsSync = true
			}
		}
	}

	if hdr.Marker {
		a.markerSeen = true
	}
	return done, perr
}

// Flush completes the access unit still being assembled, if any.
//
// The returned unit has Duration zero: its successor never arrived, so nothing
// here knows how long it lasted. Call at end of stream; a caller that keeps
// pushing afterward gets a fresh picture, not a continuation of the flushed one.
func (a *Assembler) Flush() (AccessUnit, bool) {
	au := a.close(0)
	if au == nil {
		return AccessUnit{}, false
	}
	return *au, true
}

// close finalises the pending access unit with the given duration.
func (a *Assembler) close(duration uint32) *AccessUnit {
	if a.pending == nil {
		// A boundary with nothing accumulated — a run of parameter-set-only
		// packets, or a picture whose every NAL was lost. Not an access unit, and
		// emitting an empty one would put a zero-sample entry in the container.
		a.markerSeen = false
		return nil
	}
	au := a.pending
	au.Duration = duration
	// The marker bit should have been seen exactly once, on the last packet of
	// the picture now closing. It was not if the sender never set it, or set it
	// somewhere that did not coincide with this boundary.
	if !a.markerSeen {
		a.markerDisagreements++
	}
	a.pending = nil
	a.markerSeen = false
	a.emitted++
	return au
}

// Samples converts access units into fmp4 samples.
//
// A separate function rather than a method on Fragmenter so the two halves stay
// independently testable: this is the only place that decides what an access
// unit's composition offset is, and the answer is zero.
//
// Zero, not computed. A non-zero composition offset needs picture order counts,
// which needs slice headers — the parser this package has twice declined to
// write. Zero is correct for any stream in decode order, which is every stream
// without B-frames, and for a stream with them it declines to reorder rather
// than reordering wrongly. fmp4.go's Sample documents the same choice from the
// other side.
func Samples(units []AccessUnit) ([]Sample, error) {
	out := make([]Sample, 0, len(units))
	for i, au := range units {
		if len(au.NALUnits) == 0 {
			return nil, fmt.Errorf("camera: access unit %d has no NAL units", i)
		}
		if au.Duration == 0 {
			// The unflushed-final-unit case. Refused rather than defaulted,
			// because a zero-duration sample in a container is a frame a player
			// shows for no time at all — and the caller is the only party that
			// knows what the final frame's duration should be.
			return nil, fmt.Errorf("camera: access unit %d has no duration; a final "+
				"unit from Flush needs one assigned before it can be written", i)
		}
		out = append(out, Sample{
			NALUnits: au.NALUnits,
			Duration: au.Duration,
			IsSync:   au.IsSync,
		})
	}
	return out, nil
}

// stripStartCode removes the Annex-B start code Depacketizer prepends.
func stripStartCode(framed []byte) ([]byte, error) {
	switch {
	case len(framed) >= 4 && framed[0] == 0 && framed[1] == 0 && framed[2] == 0 && framed[3] == 1:
		framed = framed[4:]
	case len(framed) >= 3 && framed[0] == 0 && framed[1] == 0 && framed[2] == 1:
		framed = framed[3:]
	default:
		return nil, fmt.Errorf("camera: NAL unit is not Annex-B framed: % x",
			framed[:min(len(framed), 4)])
	}
	if len(framed) == 0 {
		return nil, errors.New("camera: Annex-B start code with no NAL unit after it")
	}
	return framed, nil
}

func cloneBytes(b []byte) []byte {
	if b == nil {
		return nil
	}
	return append([]byte(nil), b...)
}
