package camera

import (
	"bytes"
	"encoding/binary"
	"errors"
	"testing"
)

// The box reader below walks length-and-type headers generically — it knows the
// ISOBMFF framing rule and nothing about which boxes this writer emits or in
// what order. That distinction is the point: a reader built from the writer's
// own layout would agree with any mistake in it. This one can report that a box
// is absent, overlong, or nested somewhere unexpected.
//
// It is deliberately strict about lengths. A box whose declared size runs past
// its parent is the single most common muxing bug and the one a permissive
// reader hides: players differ in whether they trust the declared size or the
// remaining bytes, so a file with inconsistent sizes plays in one and not
// another.

type mp4box struct {
	typ      string
	payload  []byte
	children []mp4box
	// offset is the box header's position within the buffer it was parsed from,
	// needed to check trun's data_offset.
	offset int
}

// containers are the boxes whose payload is entirely further boxes. Listed
// explicitly rather than guessed at, because a leaf box's payload can easily
// begin with four bytes that look like a plausible size.
var containers = map[string]bool{
	"moov": true, "trak": true, "mdia": true, "minf": true, "dinf": true,
	"stbl": true, "mvex": true, "moof": true, "traf": true,
}

func parseBoxes(t *testing.T, b []byte, base int) []mp4box {
	t.Helper()
	var out []mp4box
	for len(b) > 0 {
		if len(b) < 8 {
			t.Fatalf("at offset %d: %d trailing bytes, too few for a box header", base, len(b))
		}
		size := int(binary.BigEndian.Uint32(b[0:4]))
		typ := string(b[4:8])
		if size < 8 {
			t.Fatalf("box %q at offset %d declares size %d, below the 8-byte header", typ, base, size)
		}
		if size > len(b) {
			t.Fatalf("box %q at offset %d declares size %d but only %d bytes remain — "+
				"a box running past its parent is read differently by different players",
				typ, base, size, len(b))
		}
		bx := mp4box{typ: typ, payload: b[8:size], offset: base}
		if containers[typ] {
			bx.children = parseBoxes(t, bx.payload, base+8)
		}
		out = append(out, bx)
		b = b[size:]
		base += size
	}
	return out
}

func find(boxes []mp4box, path ...string) *mp4box {
	cur := boxes
	for i, want := range path {
		var hit *mp4box
		for j := range cur {
			if cur[j].typ == want {
				hit = &cur[j]
				break
			}
		}
		if hit == nil {
			return nil
		}
		if i == len(path)-1 {
			return hit
		}
		cur = hit.children
	}
	return nil
}

func mustFind(t *testing.T, boxes []mp4box, path ...string) *mp4box {
	t.Helper()
	b := find(boxes, path...)
	if b == nil {
		t.Fatalf("box %v is absent", path)
	}
	return b
}

// testPPSNAL is a picture parameter set: nal_unit_type 8 with a short payload.
// Never parsed by anything under test — only stored in avcC and read back.
func testPPSNAL() []byte { return []byte{0x68, 0xce, 0x3c, 0x80} }

func newTestFragmenter(t *testing.T) *Fragmenter {
	t.Helper()
	f, err := NewFragmenter(testSPS320x240(t), testPPSNAL(), H264ClockRate)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestInitSegmentStructure(t *testing.T) {
	boxes := parseBoxes(t, newTestFragmenter(t).InitSegment(), 0)

	if boxes[0].typ != "ftyp" {
		t.Errorf("first box is %q, want ftyp — a player reads the brand before anything else", boxes[0].typ)
	}
	// iso5 must be among the compatible brands: tfdt is a 2012 addition, and a
	// file claiming only isom is one a strict player may refuse the fragments of.
	if !bytes.Contains(boxes[0].payload, []byte("iso5")) {
		t.Error("ftyp does not claim the iso5 brand, but the fragments use a version-1 tfdt")
	}

	// Every box 14496-12 requires in the chain down to the sample entry. Checked
	// by path rather than by counting, so a box appearing in the wrong parent is
	// still reported absent.
	for _, path := range [][]string{
		{"moov", "mvhd"},
		{"moov", "trak", "tkhd"},
		{"moov", "trak", "mdia", "mdhd"},
		{"moov", "trak", "mdia", "hdlr"},
		{"moov", "trak", "mdia", "minf", "vmhd"},
		{"moov", "trak", "mdia", "minf", "dinf", "dref"},
		{"moov", "trak", "mdia", "minf", "stbl", "stsd"},
		{"moov", "trak", "mdia", "minf", "stbl", "stts"},
		{"moov", "trak", "mdia", "minf", "stbl", "stsc"},
		{"moov", "trak", "mdia", "minf", "stbl", "stsz"},
		{"moov", "trak", "mdia", "minf", "stbl", "stco"},
		{"moov", "mvex", "trex"},
	} {
		if find(boxes, path...) == nil {
			t.Errorf("required box %v is absent from the init segment", path)
		}
	}
}

// The dimensions are written twice, in two different number formats, and getting
// either wrong produces a file that plays at the wrong size rather than one that
// fails. tkhd is 16.16 fixed point; the sample entry is plain integers.
func TestInitSegmentCarriesTheSPSDimensionsInBothFormats(t *testing.T) {
	f := newTestFragmenter(t)
	boxes := parseBoxes(t, f.InitSegment(), 0)

	tkhd := mustFind(t, boxes, "moov", "trak", "tkhd")
	// version(1) flags(3) creation(4) modification(4) track_ID(4) reserved(4)
	// duration(4) reserved(8) layer(2) alt_group(2) volume(2) reserved(2)
	// matrix(36) = 76, then width and height.
	w := binary.BigEndian.Uint32(tkhd.payload[76:80])
	h := binary.BigEndian.Uint32(tkhd.payload[80:84])
	if w != 320<<16 || h != 240<<16 {
		t.Errorf("tkhd is %dx%d in 16.16 (raw %#x/%#x), want 320x240", w>>16, h>>16, w, h)
	}

	// stsd: version(1) flags(3) entry_count(4) then the avc1 sample entry.
	stsd := mustFind(t, boxes, "moov", "trak", "mdia", "minf", "stbl", "stsd")
	avc1 := parseBoxes(t, stsd.payload[8:], 0)[0]
	if avc1.typ != "avc1" {
		t.Fatalf("sample entry is %q, want avc1", avc1.typ)
	}
	// reserved(6) data_ref(2) pre_defined(2) reserved(2) pre_defined(12) = 24,
	// then width and height as uint16.
	iw := binary.BigEndian.Uint16(avc1.payload[24:26])
	ih := binary.BigEndian.Uint16(avc1.payload[26:28])
	if iw != 320 || ih != 240 {
		t.Errorf("avc1 sample entry is %dx%d, want 320x240", iw, ih)
	}
}

// avcC is the contract between the init segment and every mdat: it declares the
// NAL length prefix width, and carries the parameter sets a decoder needs before
// the first sample. A wrong length declaration makes every sample unreadable
// while leaving the file structurally perfect.
func TestAVCCDeclaresTheLengthPrefixAndCarriesTheParameterSets(t *testing.T) {
	f := newTestFragmenter(t)
	stsd := mustFind(t, parseBoxes(t, f.InitSegment(), 0),
		"moov", "trak", "mdia", "minf", "stbl", "stsd")
	avc1 := parseBoxes(t, stsd.payload[8:], 0)[0]
	// The avcC box follows the 78-byte visual sample entry body.
	avcC := parseBoxes(t, avc1.payload[78:], 0)[0]
	if avcC.typ != "avcC" {
		t.Fatalf("box after the sample entry body is %q, want avcC", avcC.typ)
	}
	p := avcC.payload

	if p[0] != 1 {
		t.Errorf("configurationVersion = %d, want 1", p[0])
	}
	// Copied from the SPS rather than assumed: a decoder uses these to decide
	// whether it can play the track at all.
	if p[1] != 66 || p[3] != 30 {
		t.Errorf("avcC profile/level = %d/%d, want 66/30 from the SPS", p[1], p[3])
	}
	if got := p[4] & 0x03; got != avcLengthSize-1 {
		t.Errorf("lengthSizeMinusOne = %d, want %d — this must match the prefixes written into mdat",
			got, avcLengthSize-1)
	}
	if got := p[5] & 0x1f; got != 1 {
		t.Errorf("numOfSequenceParameterSets = %d, want 1", got)
	}
	spsLen := int(binary.BigEndian.Uint16(p[6:8]))
	gotSPS := p[8 : 8+spsLen]
	if !bytes.Equal(gotSPS, testSPS320x240(t)) {
		t.Error("the SPS in avcC is not the one the fragmenter was given")
	}
	rest := p[8+spsLen:]
	if rest[0] != 1 {
		t.Errorf("numOfPictureParameterSets = %d, want 1", rest[0])
	}
	ppsLen := int(binary.BigEndian.Uint16(rest[1:3]))
	if !bytes.Equal(rest[3:3+ppsLen], testPPSNAL()) {
		t.Error("the PPS in avcC is not the one the fragmenter was given")
	}
}

// ── fragments ───────────────────────────────────────────────────────────────

func sampleWith(nals [][]byte, dur uint32, sync bool) Sample {
	return Sample{NALUnits: nals, Duration: dur, IsSync: sync}
}

func TestFragmentStructureAndSampleData(t *testing.T) {
	f := newTestFragmenter(t)
	idr := []byte{0x65, 0x88, 0x84, 0x00, 0x21}
	slice := []byte{0x41, 0x9a, 0x00}

	frag, err := f.Fragment([]Sample{
		sampleWith([][]byte{idr}, 3000, true),
		sampleWith([][]byte{slice}, 3000, false),
	})
	if err != nil {
		t.Fatal(err)
	}
	boxes := parseBoxes(t, frag, 0)
	if len(boxes) != 2 || boxes[0].typ != "moof" || boxes[1].typ != "mdat" {
		t.Fatalf("fragment is %d boxes (%q...), want moof then mdat", len(boxes), boxes[0].typ)
	}
	mustFind(t, boxes, "moof", "mfhd")
	mustFind(t, boxes, "moof", "traf", "tfhd")
	mustFind(t, boxes, "moof", "traf", "tfdt")
	trun := mustFind(t, boxes, "moof", "traf", "trun")

	// mdat holds each NAL length-prefixed, in order, with nothing between.
	want := []byte{}
	for _, nal := range [][]byte{idr, slice} {
		var l [4]byte
		binary.BigEndian.PutUint32(l[:], uint32(len(nal)))
		want = append(want, l[:]...)
		want = append(want, nal...)
	}
	if !bytes.Equal(boxes[1].payload, want) {
		t.Errorf("mdat payload = % x, want % x", boxes[1].payload, want)
	}

	// trun v1: version(1) flags(3) sample_count(4) data_offset(4) then 16 bytes
	// per sample.
	if n := binary.BigEndian.Uint32(trun.payload[4:8]); n != 2 {
		t.Errorf("trun sample_count = %d, want 2", n)
	}
	for i, wantSize := range []uint32{uint32(4 + len(idr)), uint32(4 + len(slice))} {
		off := 12 + i*16
		if dur := binary.BigEndian.Uint32(trun.payload[off : off+4]); dur != 3000 {
			t.Errorf("sample %d duration = %d, want 3000", i, dur)
		}
		if got := binary.BigEndian.Uint32(trun.payload[off+4 : off+8]); got != wantSize {
			t.Errorf("sample %d size = %d, want %d (the length prefix counts)", i, got, wantSize)
		}
	}
}

// data_offset points at the first byte of mdat's payload, measured from the
// start of the moof. It is the one field in the fragment whose correct value
// depends on the size of the box containing it, and a file with it wrong parses
// perfectly and decodes garbage — the player reads samples from whatever
// happens to be at the offset it names.
func TestTrunDataOffsetPointsAtTheFirstSampleByte(t *testing.T) {
	f := newTestFragmenter(t)
	frag, err := f.Fragment([]Sample{
		sampleWith([][]byte{{0x65, 0x01, 0x02}}, 3000, true),
		sampleWith([][]byte{{0x41, 0x03}, {0x41, 0x04, 0x05}}, 3000, false),
	})
	if err != nil {
		t.Fatal(err)
	}
	boxes := parseBoxes(t, frag, 0)
	trun := mustFind(t, boxes, "moof", "traf", "trun")
	off := int(int32(binary.BigEndian.Uint32(trun.payload[8:12])))

	// mdat's payload begins 8 bytes into the mdat box, which begins where the
	// moof ends. Computed from the parsed boxes, not from the writer's own
	// arithmetic.
	mdatPayloadStart := boxes[1].offset + 8
	if off != mdatPayloadStart {
		t.Errorf("trun data_offset = %d, but mdat's payload starts at %d", off, mdatPayloadStart)
	}
	// And it really does land on a length prefix: the first four bytes there
	// must be the first NAL's length.
	if got := binary.BigEndian.Uint32(frag[off : off+4]); got != 3 {
		t.Errorf("the four bytes at data_offset are %d, want the first NAL's length 3", got)
	}
}

// Every fragment must be reachable on its own: default-base-is-moof makes
// data_offset relative to the moof rather than to the file. Without it a
// fragment handed to MSE in isolation, or appended to a growing recording,
// resolves its samples to a position nothing can compute.
func TestTfhdSetsDefaultBaseIsMoof(t *testing.T) {
	f := newTestFragmenter(t)
	frag, err := f.Fragment([]Sample{sampleWith([][]byte{{0x65, 0x01}}, 3000, true)})
	if err != nil {
		t.Fatal(err)
	}
	tfhd := mustFind(t, parseBoxes(t, frag, 0), "moof", "traf", "tfhd")
	flags := uint32(tfhd.payload[1])<<16 | uint32(tfhd.payload[2])<<8 | uint32(tfhd.payload[3])
	if flags&0x020000 == 0 {
		t.Errorf("tfhd flags = %#06x, missing default-base-is-moof (0x020000)", flags)
	}
}

// Sequence numbers and decode times must advance across fragments, and the
// decode time must be 64-bit: at 90 kHz a 32-bit field wraps after about 13
// hours, and a continuous recorder is exactly what runs longer than that.
func TestFragmentsAdvanceSequenceAndDecodeTime(t *testing.T) {
	f := newTestFragmenter(t)
	var seqs []uint32
	var times []uint64
	for i := 0; i < 3; i++ {
		frag, err := f.Fragment([]Sample{
			sampleWith([][]byte{{0x65, 0x01}}, 3000, true),
			sampleWith([][]byte{{0x41, 0x02}}, 3000, false),
		})
		if err != nil {
			t.Fatal(err)
		}
		boxes := parseBoxes(t, frag, 0)
		mfhd := mustFind(t, boxes, "moof", "mfhd")
		tfdt := mustFind(t, boxes, "moof", "traf", "tfdt")
		if tfdt.payload[0] != 1 {
			t.Fatalf("tfdt version = %d, want 1 (a 32-bit decode time wraps after ~13h at 90kHz)", tfdt.payload[0])
		}
		seqs = append(seqs, binary.BigEndian.Uint32(mfhd.payload[4:8]))
		times = append(times, binary.BigEndian.Uint64(tfdt.payload[4:12]))
	}
	if seqs[0] != 1 || seqs[1] != 2 || seqs[2] != 3 {
		t.Errorf("moof sequence numbers = %v, want 1,2,3", seqs)
	}
	// Two 3000-tick samples per fragment.
	if times[0] != 0 || times[1] != 6000 || times[2] != 12000 {
		t.Errorf("baseMediaDecodeTime = %v, want 0,6000,12000", times)
	}
	if f.DecodeTime() != 18000 {
		t.Errorf("DecodeTime() = %d, want 18000", f.DecodeTime())
	}
}

// A sync sample is where a player may start and where a seek may land. The
// non-sync bit is the field a seek consults, and depends_on is what a player
// deciding what it may drop consults; both have to be right.
func TestSampleFlagsMarkSyncSamples(t *testing.T) {
	f := newTestFragmenter(t)
	frag, err := f.Fragment([]Sample{
		sampleWith([][]byte{{0x65, 0x01}}, 3000, true),
		sampleWith([][]byte{{0x41, 0x02}}, 3000, false),
	})
	if err != nil {
		t.Fatal(err)
	}
	trun := mustFind(t, parseBoxes(t, frag, 0), "moof", "traf", "trun")

	syncFlags := binary.BigEndian.Uint32(trun.payload[12+8 : 12+12])
	nonSyncFlags := binary.BigEndian.Uint32(trun.payload[12+16+8 : 12+16+12])

	if syncFlags&(1<<16) != 0 {
		t.Errorf("sync sample flags %#08x has sample_is_non_sync_sample set", syncFlags)
	}
	if got := (syncFlags >> 24) & 0x03; got != 2 {
		t.Errorf("sync sample depends_on = %d, want 2 (does not depend on others)", got)
	}
	if nonSyncFlags&(1<<16) == 0 {
		t.Errorf("non-sync sample flags %#08x does not set sample_is_non_sync_sample", nonSyncFlags)
	}
	if got := (nonSyncFlags >> 24) & 0x03; got != 1 {
		t.Errorf("non-sync sample depends_on = %d, want 1 (depends on others)", got)
	}
}

// Composition offsets are signed, which is the whole reason for a version-1
// trun. Written through a version-0 box a negative offset becomes an enormous
// positive one and the frame is scheduled hours into the future.
func TestNegativeCompositionOffsetSurvivesAsSigned(t *testing.T) {
	f := newTestFragmenter(t)
	frag, err := f.Fragment([]Sample{
		{NALUnits: [][]byte{{0x65, 0x01}}, Duration: 3000, IsSync: true, CompositionOffset: -3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	trun := mustFind(t, parseBoxes(t, frag, 0), "moof", "traf", "trun")
	if trun.payload[0] != 1 {
		t.Fatalf("trun version = %d, want 1 so composition offsets are signed", trun.payload[0])
	}
	got := int32(binary.BigEndian.Uint32(trun.payload[12+12 : 12+16]))
	if got != -3000 {
		t.Errorf("composition offset read back as %d, want -3000", got)
	}
}

func TestFragmenterRefusals(t *testing.T) {
	t.Run("Annex-B framed NAL", func(t *testing.T) {
		f := newTestFragmenter(t)
		// The caller left a start code on. A NAL header's first byte is never
		// 0x00, so this is detectable — and writing it would produce a file every
		// structural check passes and no decoder can read.
		_, err := f.Fragment([]Sample{
			sampleWith([][]byte{{0x00, 0x00, 0x00, 0x01, 0x65, 0x88}}, 3000, true),
		})
		if !errors.Is(err, ErrAnnexBSample) {
			t.Errorf("err = %v, want ErrAnnexBSample", err)
		}
	})

	t.Run("no samples", func(t *testing.T) {
		if _, err := newTestFragmenter(t).Fragment(nil); err == nil {
			t.Error("an empty fragment was written without error")
		}
	})

	t.Run("sample with no NAL units", func(t *testing.T) {
		_, err := newTestFragmenter(t).Fragment([]Sample{{Duration: 3000, IsSync: true}})
		if err == nil {
			t.Error("a sample carrying no NAL units was written without error")
		}
	})

	t.Run("empty NAL unit", func(t *testing.T) {
		_, err := newTestFragmenter(t).Fragment([]Sample{
			sampleWith([][]byte{{}}, 3000, true),
		})
		if err == nil {
			t.Error("a zero-length NAL unit was written without error")
		}
	})

	t.Run("zero timescale", func(t *testing.T) {
		if _, err := NewFragmenter(testSPS320x240(t), testPPSNAL(), 0); err == nil {
			t.Error("a zero timescale was accepted; every duration would be a division by zero")
		}
	})

	t.Run("unparseable SPS", func(t *testing.T) {
		if _, err := NewFragmenter([]byte{0x67, 0x42}, testPPSNAL(), H264ClockRate); err == nil {
			t.Error("a truncated SPS was accepted")
		}
	})

	t.Run("SPS passed where the PPS belongs", func(t *testing.T) {
		sps := testSPS320x240(t)
		if _, err := NewFragmenter(sps, sps, H264ClockRate); err == nil {
			t.Error("the SPS was accepted as a PPS; a decoder reads avcC's PPS by " +
				"length without rechecking its type, so this fails at decode with no clue why")
		}
	})

	t.Run("empty PPS", func(t *testing.T) {
		if _, err := NewFragmenter(testSPS320x240(t), nil, H264ClockRate); err == nil {
			t.Error("an empty PPS was accepted")
		}
	})
}

// A fragmenter built from a 1080p SPS must declare 1080, not the 1088 coded
// lines. This is sps.go's cropping arithmetic reaching the container, which is
// where it actually matters — the whole reason the parser exists.
func TestFragmenterUsesCroppedDimensions(t *testing.T) {
	body := bits(t, ueBits(0)+
		ueBits(1)+ // chroma_format_idc 4:2:0
		ueBits(0)+ueBits(0)+"0"+"0"+
		ueBits(0)+ueBits(0)+ueBits(0)+ueBits(2)+"0"+
		ueBits(119)+ // 1920
		ueBits(67)+ // 1088 coded
		"1"+"1"+
		"1"+ // frame_cropping_flag
		ueBits(0)+ueBits(0)+ueBits(0)+ueBits(4)+ // crop 8 lines
		"0")
	f, err := NewFragmenter(spsNAL(100, 0x00, 40, body), testPPSNAL(), H264ClockRate)
	if err != nil {
		t.Fatal(err)
	}
	if f.Params().Height != 1080 {
		t.Fatalf("Params().Height = %d, want 1080", f.Params().Height)
	}
	stsd := mustFind(t, parseBoxes(t, f.InitSegment(), 0),
		"moov", "trak", "mdia", "minf", "stbl", "stsd")
	avc1 := parseBoxes(t, stsd.payload[8:], 0)[0]
	if h := binary.BigEndian.Uint16(avc1.payload[26:28]); h != 1080 {
		t.Errorf("avc1 height = %d, want 1080 — writing 1088 puts a band of encoder "+
			"padding along the bottom of a file nothing complains about", h)
	}
}

// Byte-for-byte determinism. An init segment that embeds a timestamp changes on
// every call, which breaks caching, makes two recordings of the same stream
// diff differently, and would make any golden comparison here meaningless.
func TestInitSegmentIsDeterministic(t *testing.T) {
	a := newTestFragmenter(t).InitSegment()
	b := newTestFragmenter(t).InitSegment()
	if !bytes.Equal(a, b) {
		t.Error("two fragmenters over the same parameter sets produced different init segments")
	}
}

// Total box lengths must account for every byte. parseBoxes fails on a box
// running past its parent, but a box that stops SHORT leaves unexplained bytes
// that it would silently treat as another box — so assert the walk consumed
// everything at the top level too.
func TestNoUnaccountedBytes(t *testing.T) {
	f := newTestFragmenter(t)
	init := f.InitSegment()
	var n int
	for _, b := range parseBoxes(t, init, 0) {
		n += len(b.payload) + 8
	}
	if n != len(init) {
		t.Errorf("top-level boxes account for %d of %d init-segment bytes", n, len(init))
	}

	frag, err := f.Fragment([]Sample{sampleWith([][]byte{{0x65, 0x01, 0x02}}, 3000, true)})
	if err != nil {
		t.Fatal(err)
	}
	n = 0
	for _, b := range parseBoxes(t, frag, 0) {
		n += len(b.payload) + 8
	}
	if n != len(frag) {
		t.Errorf("top-level boxes account for %d of %d fragment bytes", n, len(frag))
	}
}
