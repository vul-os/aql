package camera

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// Packets are built from the RFC 3550 §5.1 header layout written out field by
// field, following the rule h264_test.go sets for this package: a component
// tested only against a builder written beside it proves the two agree with each
// other. Spelling the layout out means a reviewer can check it against the RFC
// instead of against the parser under test.
//
//	byte 0   V=2 (bits 7-6), P=0, X=0, CC=0
//	byte 1   M (bit 7), payload type (bits 6-0)
//	byte 2-3 sequence number
//	byte 4-7 timestamp
//	byte 8-11 SSRC
//	byte 12+ payload — here a single NAL unit packet (RFC 6184 §5.6)
func rtpPacket(seq uint16, ts uint32, marker bool, payload []byte) []byte {
	pkt := make([]byte, 12, 12+len(payload))
	pkt[0] = 0x80 // V=2, no padding, no extension, no CSRCs
	pkt[1] = 96   // dynamic payload type; marker bit added below
	if marker {
		pkt[1] |= 0x80
	}
	binary.BigEndian.PutUint16(pkt[2:4], seq)
	binary.BigEndian.PutUint32(pkt[4:8], ts)
	binary.BigEndian.PutUint32(pkt[8:12], 0xdeadbeef) // SSRC
	return append(pkt, payload...)
}

// NAL units, identified by the low five bits of their first byte (H.264 Table
// 7-1). The payload bytes past the header are arbitrary — nothing in the chain
// under test decodes a picture.
func nalIDR(tag byte) []byte    { return []byte{0x65, tag, 0x11, 0x22} }
func nalNonIDR(tag byte) []byte { return []byte{0x41, tag, 0x33} }
func nalSEI() []byte            { return []byte{0x06, 0x05, 0x01, 0x80} }
func nalAUD() []byte            { return []byte{0x09, 0xf0} }

const perFrame90k = 3000 // 30 fps on the 90 kHz clock

// The central claim: a timestamp change is the picture boundary, and the gap
// between two timestamps is the first picture's duration.
func TestAssemblerClosesAnAccessUnitOnATimestampChange(t *testing.T) {
	a := NewAssembler()

	// Two NALs at the same timestamp are one picture.
	for i, nal := range [][]byte{nalIDR(1), nalNonIDR(2)} {
		got, err := a.Push(rtpPacket(uint16(100+i), 9000, false, nal))
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 0 {
			t.Fatalf("packet %d closed a picture before the timestamp moved", i)
		}
	}

	// The next timestamp closes the first picture, and only it.
	got, err := a.Push(rtpPacket(102, 9000+perFrame90k, false, nalNonIDR(3)))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("a timestamp change produced %d access units, want 1", len(got))
	}
	au := got[0]
	if au.RTPTimestamp != 9000 {
		t.Errorf("RTPTimestamp = %d, want 9000", au.RTPTimestamp)
	}
	if au.Duration != perFrame90k {
		t.Errorf("Duration = %d, want %d (the gap to the next timestamp)", au.Duration, perFrame90k)
	}
	if len(au.NALUnits) != 2 {
		t.Errorf("access unit holds %d NAL units, want 2", len(au.NALUnits))
	}
	if !au.IsSync {
		t.Error("IsSync = false for a picture containing an IDR slice")
	}
	// Start codes must be gone: Fragment refuses Annex-B input, and this is the
	// one place the framing is converted.
	for i, nal := range au.NALUnits {
		if nal[0] == 0x00 {
			t.Errorf("NAL unit %d still carries a start code: % x", i, nal[:4])
		}
	}
}

func TestAssemblerMarksOnlyIDRPicturesAsSync(t *testing.T) {
	a := NewAssembler()
	if _, err := a.Push(rtpPacket(1, 1000, false, nalNonIDR(1))); err != nil {
		t.Fatal(err)
	}
	got, err := a.Push(rtpPacket(2, 1000+perFrame90k, false, nalIDR(2)))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].IsSync {
		t.Error("a picture of only non-IDR slices was marked as a sync sample")
	}
}

// Parameter sets belong in avcC, not in a sample. Passing them through would
// rely on decoder tolerance rather than on the format, and would also put bytes
// in mdat that the init segment already carries.
func TestAssemblerCapturesParameterSetsAndKeepsThemOutOfSamples(t *testing.T) {
	a := NewAssembler()
	sps := testSPS320x240(t)
	pps := testPPSNAL()

	if a.SPS() != nil || a.PPS() != nil {
		t.Fatal("parameter sets reported before any arrived")
	}
	for i, nal := range [][]byte{sps, pps, nalIDR(1)} {
		if _, err := a.Push(rtpPacket(uint16(i), 500, false, nal)); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(a.SPS(), sps) {
		t.Errorf("SPS() = % x, want % x", a.SPS(), sps)
	}
	if !bytes.Equal(a.PPS(), pps) {
		t.Errorf("PPS() = % x, want % x", a.PPS(), pps)
	}

	got, err := a.Push(rtpPacket(9, 500+perFrame90k, false, nalNonIDR(2)))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d access units, want 1", len(got))
	}
	if n := len(got[0].NALUnits); n != 1 {
		t.Errorf("access unit holds %d NAL units, want 1 — the parameter sets were "+
			"passed through into the sample", n)
	}
	for _, nal := range got[0].NALUnits {
		if typ := nal[0] & 0x1f; typ == nalTypeSPS || typ == nalTypePPS {
			t.Errorf("a type-%d parameter set is in the sample data", typ)
		}
	}

	// The returned slices must not alias state the Assembler will overwrite: a
	// caller holds the SPS for the life of a Fragmenter, and an init segment
	// already sent to a player cannot be silently rewritten.
	held := a.SPS()
	if _, err := a.Push(rtpPacket(20, 900, false, spsNAL(77, 0x00, 31, bits(t,
		ueBits(0)+ueBits(0)+ueBits(0)+ueBits(0)+ueBits(1)+"0"+
			ueBits(39)+ueBits(29)+"1"+"1"+"0"+"0")))); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(held, sps) {
		t.Error("a previously returned SPS changed when a new one arrived")
	}
	if bytes.Equal(a.SPS(), sps) {
		t.Error("SPS() did not update when a new parameter set arrived")
	}
}

// An access unit delimiter says only "a picture starts here", which the
// timestamp already said. Keeping it would put a NAL in the sample whose sole
// purpose is to restate the container.
func TestAssemblerDropsAccessUnitDelimiters(t *testing.T) {
	a := NewAssembler()
	for i, nal := range [][]byte{nalAUD(), nalIDR(1), nalSEI()} {
		if _, err := a.Push(rtpPacket(uint16(i), 100, false, nal)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := a.Push(rtpPacket(9, 100+perFrame90k, false, nalNonIDR(2)))
	if err != nil {
		t.Fatal(err)
	}
	if len(got[0].NALUnits) != 2 {
		t.Fatalf("access unit holds %d NAL units, want 2 (IDR and SEI, no AUD)", len(got[0].NALUnits))
	}
	for _, nal := range got[0].NALUnits {
		if nal[0]&0x1f == nalTypeAUD {
			t.Error("an access unit delimiter reached the sample data")
		}
	}
	// SEI is kept: it carries real per-picture information and is legal in a
	// sample, unlike a parameter set.
	var sawSEI bool
	for _, nal := range got[0].NALUnits {
		if nal[0]&0x1f == nalTypeSEI {
			sawSEI = true
		}
	}
	if !sawSEI {
		t.Error("SEI was dropped; it is legal in a sample and carries picture information")
	}
}

// The 90 kHz timestamp is a uint32 and wraps in about 13¼ hours. Taken as a
// plain subtraction the delta across the wrap is about 4.29 billion ticks —
// thirteen hours of duration on one frame, which a player renders as a stream
// that stops dead.
func TestAssemblerDurationSurvivesTimestampWraparound(t *testing.T) {
	a := NewAssembler()
	// A uint32 variable rather than a constant: justBefore + 3000 exceeds 2^32,
	// so as a constant expression it is a compile error rather than the wrap this
	// test is about. The wrap has to happen at runtime, exactly as it does on a
	// stream that has been running for thirteen hours.
	var justBefore uint32 = 0xffffffff - 1000

	if _, err := a.Push(rtpPacket(1, justBefore, false, nalIDR(1))); err != nil {
		t.Fatal(err)
	}
	next := justBefore + perFrame90k
	got, err := a.Push(rtpPacket(2, next, false, nalNonIDR(2)))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d access units, want 1", len(got))
	}
	if got[0].Duration != perFrame90k {
		t.Errorf("Duration across the wrap = %d, want %d", got[0].Duration, perFrame90k)
	}
}

// A picture cannot be reopened once its successor has begun, so a packet
// arriving late with an older timestamp is lost. Counted, because a stream that
// reorders across picture boundaries produces visibly wrong output and this is
// the only evidence of why.
func TestAssemblerCountsBackwardsTimestamps(t *testing.T) {
	a := NewAssembler()
	if _, err := a.Push(rtpPacket(1, 10_000, false, nalIDR(1))); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Push(rtpPacket(2, 13_000, false, nalNonIDR(2))); err != nil {
		t.Fatal(err)
	}
	if a.BackwardsTimestamps() != 0 {
		t.Fatalf("BackwardsTimestamps() = %d before any reordering", a.BackwardsTimestamps())
	}

	// A straggler from the first picture.
	got, err := a.Push(rtpPacket(3, 10_000, false, nalNonIDR(3)))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("a backwards timestamp closed %d access units", len(got))
	}
	if a.BackwardsTimestamps() != 1 {
		t.Errorf("BackwardsTimestamps() = %d, want 1", a.BackwardsTimestamps())
	}
	// And the current picture must not have been rebased onto the old timestamp,
	// which would make the next duration negative.
	next, err := a.Push(rtpPacket(4, 16_000, false, nalNonIDR(4)))
	if err != nil {
		t.Fatal(err)
	}
	if len(next) != 1 {
		t.Fatalf("got %d access units, want 1", len(next))
	}
	if next[0].RTPTimestamp != 13_000 || next[0].Duration != 3000 {
		t.Errorf("picture after the straggler is ts=%d dur=%d, want 13000/3000 — "+
			"the late packet rebased the pending picture", next[0].RTPTimestamp, next[0].Duration)
	}
}

// The marker bit is recorded and never used to close a picture. A sender that
// never sets it must still produce correct output, and must be visible as
// unreliable rather than silently trusted.
func TestAssemblerCrossChecksTheMarkerBitWithoutTrustingIt(t *testing.T) {
	t.Run("a sender that sets it correctly", func(t *testing.T) {
		a := NewAssembler()
		// Marker on the last packet of each picture, which is what RFC 6184 asks
		// for.
		if _, err := a.Push(rtpPacket(1, 1000, false, nalIDR(1))); err != nil {
			t.Fatal(err)
		}
		if _, err := a.Push(rtpPacket(2, 1000, true, nalNonIDR(2))); err != nil {
			t.Fatal(err)
		}
		if _, err := a.Push(rtpPacket(3, 4000, true, nalIDR(3))); err != nil {
			t.Fatal(err)
		}
		if a.MarkerDisagreements() != 0 {
			t.Errorf("MarkerDisagreements() = %d for a sender that sets it correctly",
				a.MarkerDisagreements())
		}
	})

	t.Run("a sender that never sets it still produces pictures", func(t *testing.T) {
		a := NewAssembler()
		if _, err := a.Push(rtpPacket(1, 1000, false, nalIDR(1))); err != nil {
			t.Fatal(err)
		}
		got, err := a.Push(rtpPacket(2, 4000, false, nalIDR(2)))
		if err != nil {
			t.Fatal(err)
		}
		// The output is correct despite the missing marker — that is the point of
		// not depending on it.
		if len(got) != 1 || got[0].Duration != 3000 {
			t.Fatalf("got %d units (first dur %v); a missing marker bit changed the output",
				len(got), got)
		}
		if a.MarkerDisagreements() != 1 {
			t.Errorf("MarkerDisagreements() = %d, want 1 — an unreliable sender must be "+
				"visible in a number rather than silently trusted", a.MarkerDisagreements())
		}
	})
}

// A boundary with nothing accumulated is not a picture. Emitting one would put a
// sample carrying no NAL units into the container.
func TestAssemblerDoesNotEmitEmptyAccessUnits(t *testing.T) {
	a := NewAssembler()
	// Parameter sets at one timestamp, then a move: nothing but parameter sets
	// arrived, so no picture was formed.
	if _, err := a.Push(rtpPacket(1, 100, false, testSPS320x240(t))); err != nil {
		t.Fatal(err)
	}
	got, err := a.Push(rtpPacket(2, 3100, false, testPPSNAL()))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("a parameter-set-only interval produced %d access units", len(got))
	}
	if a.Emitted() != 0 {
		t.Errorf("Emitted() = %d with no picture data pushed", a.Emitted())
	}
	if _, ok := a.Flush(); ok {
		t.Error("Flush returned a picture built only from parameter sets")
	}
}

func TestAssemblerFlushReturnsTheFinalPictureWithNoDuration(t *testing.T) {
	a := NewAssembler()
	if _, err := a.Push(rtpPacket(1, 1000, false, nalIDR(1))); err != nil {
		t.Fatal(err)
	}
	au, ok := a.Flush()
	if !ok {
		t.Fatal("Flush returned nothing with a picture in progress")
	}
	if au.Duration != 0 {
		t.Errorf("Duration = %d; the final picture's successor never arrived, so nothing "+
			"knows how long it lasted", au.Duration)
	}
	if !au.IsSync || len(au.NALUnits) != 1 {
		t.Errorf("flushed picture = %+v, want one IDR NAL", au)
	}
	if _, ok := a.Flush(); ok {
		t.Error("a second Flush returned another picture")
	}
}

func TestSamplesRefusesWhatCannotBeWritten(t *testing.T) {
	t.Run("zero duration", func(t *testing.T) {
		// The unflushed-final-unit case. A zero-duration sample is a frame shown
		// for no time at all, and only the caller knows what the last frame's
		// duration should be.
		_, err := Samples([]AccessUnit{{NALUnits: [][]byte{nalIDR(1)}, Duration: 0, IsSync: true}})
		if err == nil {
			t.Error("a zero-duration access unit was converted without error")
		}
	})

	t.Run("no NAL units", func(t *testing.T) {
		if _, err := Samples([]AccessUnit{{Duration: 3000}}); err == nil {
			t.Error("an access unit with no NAL units was converted without error")
		}
	})

	t.Run("composition offsets are zero, not guessed", func(t *testing.T) {
		s, err := Samples([]AccessUnit{{NALUnits: [][]byte{nalIDR(1)}, Duration: 3000, IsSync: true}})
		if err != nil {
			t.Fatal(err)
		}
		if s[0].CompositionOffset != 0 {
			t.Errorf("CompositionOffset = %d; deriving one needs picture order counts, "+
				"and a wrong offset reorders frames", s[0].CompositionOffset)
		}
	})
}

// The chain, end to end: RTP packets in, playable fragment out, with no
// hand-assembled intermediate. This is what was broken before this file existed
// — h264.go produced NAL units and fmp4.go consumed access units, and nothing
// turned one into the other.
func TestRTPPacketsThroughToAFragment(t *testing.T) {
	a := NewAssembler()
	sps := testSPS320x240(t)
	pps := testPPSNAL()

	// Parameter sets in-band, as a camera with no sprop-parameter-sets sends
	// them, then three pictures.
	var seq uint16
	push := func(ts uint32, marker bool, nal []byte) []AccessUnit {
		t.Helper()
		seq++
		got, err := a.Push(rtpPacket(seq, ts, marker, nal))
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	push(0, false, sps)
	push(0, false, pps)
	push(0, true, nalIDR(0))

	var units []AccessUnit
	for i := 1; i <= 3; i++ {
		ts := uint32(i) * perFrame90k
		units = append(units, push(ts, false, nalNonIDR(byte(i)))...)
		units = append(units, push(ts, true, nalSEI())...)
	}
	if len(units) != 3 {
		t.Fatalf("assembled %d pictures, want 3", len(units))
	}

	// The Fragmenter is built from the in-band parameter sets — the case where
	// the SDP carried none.
	f, err := NewFragmenter(a.SPS(), a.PPS(), H264ClockRate)
	if err != nil {
		t.Fatalf("building a fragmenter from in-band parameter sets: %v", err)
	}
	if f.Params().Width != 320 || f.Params().Height != 240 {
		t.Errorf("fragmenter is %dx%d, want 320x240", f.Params().Width, f.Params().Height)
	}

	samples, err := Samples(units)
	if err != nil {
		t.Fatal(err)
	}
	frag, err := f.Fragment(samples)
	if err != nil {
		// The specific failure this guards: Depacketizer emits Annex-B and
		// Fragment refuses it, so a chain that forgot to strip start codes fails
		// exactly here rather than producing an unplayable file.
		t.Fatalf("muxing assembled access units: %v", err)
	}

	boxes := parseBoxes(t, frag, 0)
	trun := mustFind(t, boxes, "moof", "traf", "trun")
	if n := binary.BigEndian.Uint32(trun.payload[4:8]); int(n) != len(samples) {
		t.Errorf("trun declares %d samples, want %d", n, len(samples))
	}
	// The first assembled picture was the IDR one, so the track starts at a point
	// a player can begin decoding from.
	if !samples[0].IsSync {
		t.Error("the first sample is not a sync sample; a track that starts on a " +
			"non-sync sample will not start at all")
	}
	if total := f.DecodeTime(); total != uint64(len(samples))*perFrame90k {
		t.Errorf("decode time %d, want %d", total, uint64(len(samples))*perFrame90k)
	}
}
