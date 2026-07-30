package camera

import (
	"errors"
	"strings"
	"testing"
)

// Vectors are written as bit strings with every field named, not as hex blobs.
//
// h264_test.go's rule applies with more force here: "the tests below are built
// from literal byte slices with the bit layout spelled out in comments, not
// round-tripped against a packetizer written in this package." An SPS is a
// bit-packed structure where a one-bit mistake in any field silently shifts
// every field after it, so a hex vector is unreviewable — nobody can tell by
// looking whether 0xac 0xec 0x07 0x80 encodes 1920x1080 or 1936x1080, and a
// reviewer who cannot check the input cannot check the test.
//
// Writing the fields out means the vector and the parser are two independent
// statements of the same spec section: the test says which bits a field
// occupies, the parser says how to read them. They can disagree, which is the
// point. A vector produced by an SPS *writer* in this package could not.
//
// What this does NOT establish is stated as plainly as h264.go states its own
// limit: these vectors are derived from ITU-T H.264 §7.3.2.1.1, so they prove
// this parser agrees with our reading of the standard. No camera has been
// consulted. The first real parameter set may exercise a field combination
// nothing here covers.

// bits assembles a bit string into an RBSP, appending the stop bit and padding
// to a byte boundary exactly as an encoder does (§7.3.2.11).
//
// Spaces and newlines are stripped so a vector can be laid out one field per
// line with its name alongside.
func bits(t *testing.T, s string) []byte {
	t.Helper()
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '0', '1':
			b.WriteRune(r)
		case ' ', '\n', '\t', '_':
		default:
			t.Fatalf("bit string contains %q, which is neither a bit nor whitespace", r)
		}
	}
	out := b.String() + "1" // rbsp_stop_one_bit
	for len(out)%8 != 0 {
		out += "0"
	}
	raw := make([]byte, len(out)/8)
	for i := range raw {
		var v byte
		for j := 0; j < 8; j++ {
			v <<= 1
			if out[i*8+j] == '1' {
				v |= 1
			}
		}
		raw[i] = v
	}
	return raw
}

// ue renders an unsigned exp-Golomb code word, for use in vectors only.
//
// This is the encoder half of §9.1 and is NOT the inverse of the parser's
// reader under test — it is written from the syntax table (N leading zeroes
// where N is one less than the bit length of v+1), so a bug in the reader
// cannot cancel out a matching bug here. The two are checked against each other
// explicitly in TestUERendersTheCodeWordsTheStandardTabulates below, against
// values the standard itself tabulates.
func ueBits(v uint64) string {
	s := ""
	for x := v + 1; x > 0; x >>= 1 {
		s = string("01"[x&1]) + s
	}
	return strings.Repeat("0", len(s)-1) + s
}

// sps prefixes the four fixed-width bytes onto an encoded SPS body.
func spsNAL(profile, constraints, level byte, body []byte) []byte {
	return append([]byte{0x67, profile, constraints, level}, body...)
}

func TestParseSPSBaseline320x240(t *testing.T) {
	// Baseline profile (66) carries no chroma or scaling-list fields, so the
	// body starts at log2_max_frame_num_minus4 straight after the SPS id.
	body := bits(t, ueBits(0)+ // seq_parameter_set_id = 0
		ueBits(0)+ // log2_max_frame_num_minus4 = 0
		ueBits(0)+ // pic_order_cnt_type = 0
		ueBits(0)+ // log2_max_pic_order_cnt_lsb_minus4 = 0
		ueBits(1)+ // max_num_ref_frames = 1
		"0"+ // gaps_in_frame_num_value_allowed_flag
		ueBits(19)+ // pic_width_in_mbs_minus1 = 19  -> 20 * 16 = 320
		ueBits(14)+ // pic_height_in_map_units_minus1 = 14 -> 15 * 16 = 240
		"1"+ // frame_mbs_only_flag = 1 (progressive)
		"1"+ // direct_8x8_inference_flag
		"0"+ // frame_cropping_flag = 0
		"0") // vui_parameters_present_flag = 0

	got, err := ParseSPS(spsNAL(66, 0x00, 30, body))
	if err != nil {
		t.Fatal(err)
	}
	if got.Width != 320 || got.Height != 240 {
		t.Errorf("got %dx%d, want 320x240", got.Width, got.Height)
	}
	if got.ProfileIDC != 66 || got.LevelIDC != 30 {
		t.Errorf("got profile %d level %d, want 66/30", got.ProfileIDC, got.LevelIDC)
	}
	if got.ChromaFormatIDC != 1 {
		t.Errorf("chroma_format_idc = %d; baseline omits the field and §7.4.2.1.1 infers 4:2:0", got.ChromaFormatIDC)
	}
	if !got.FrameMBSOnly {
		t.Error("FrameMBSOnly = false for a stream whose frame_mbs_only_flag is 1")
	}
}

// The case that makes cropping worth parsing at all.
//
// 1080 is not a multiple of 16, so every 1080p camera on earth encodes 1088
// lines and crops 8 away. A muxer that writes the coded height produces a file
// that plays with an 8-pixel band of encoder padding along the bottom — and
// every box in that file is structurally valid, so no demuxer complains and no
// test that only checks structure would catch it.
func TestParseSPSHighProfile1080pCropsTheEncoderPadding(t *testing.T) {
	body := bits(t, ueBits(0)+ // seq_parameter_set_id
		ueBits(1)+ // chroma_format_idc = 1 (4:2:0)  [high profile only]
		ueBits(0)+ // bit_depth_luma_minus8
		ueBits(0)+ // bit_depth_chroma_minus8
		"0"+ // qpprime_y_zero_transform_bypass_flag
		"0"+ // seq_scaling_matrix_present_flag = 0
		ueBits(0)+ // log2_max_frame_num_minus4
		ueBits(0)+ // pic_order_cnt_type = 0
		ueBits(0)+ // log2_max_pic_order_cnt_lsb_minus4
		ueBits(2)+ // max_num_ref_frames
		"0"+ // gaps_in_frame_num_value_allowed_flag
		ueBits(119)+ // pic_width_in_mbs_minus1 = 119 -> 120 * 16 = 1920
		ueBits(67)+ // pic_height_in_map_units_minus1 = 67 -> 68 * 16 = 1088
		"1"+ // frame_mbs_only_flag = 1
		"1"+ // direct_8x8_inference_flag
		"1"+ // frame_cropping_flag = 1
		ueBits(0)+ // frame_crop_left_offset
		ueBits(0)+ // frame_crop_right_offset
		ueBits(0)+ // frame_crop_top_offset
		ueBits(4)+ // frame_crop_bottom_offset = 4
		"0") // vui_parameters_present_flag

	got, err := ParseSPS(spsNAL(100, 0x00, 40, body))
	if err != nil {
		t.Fatal(err)
	}
	// cropUnitY = SubHeightC * (2 - frame_mbs_only_flag) = 2 * 1 = 2, so a
	// bottom offset of 4 removes 8 lines: 1088 - 8 = 1080.
	if got.Width != 1920 || got.Height != 1080 {
		t.Errorf("got %dx%d, want 1920x1080 (1088 coded less 8 cropped)", got.Width, got.Height)
	}
	if got.ProfileIDC != 100 {
		t.Errorf("profile %d, want 100 (High)", got.ProfileIDC)
	}
}

// Interlaced doubles the height: pic_height_in_map_units counts field pairs
// rather than frames when frame_mbs_only_flag is 0 (§7.4.2.1.1), and the crop
// unit doubles with it. Reading the field as a frame count halves the picture.
func TestParseSPSInterlacedDoublesTheMapUnits(t *testing.T) {
	body := bits(t, ueBits(0)+
		ueBits(0)+ // log2_max_frame_num_minus4
		ueBits(0)+ // pic_order_cnt_type
		ueBits(0)+ // log2_max_pic_order_cnt_lsb_minus4
		ueBits(1)+ // max_num_ref_frames
		"0"+
		ueBits(44)+ // pic_width_in_mbs_minus1 = 44 -> 45 * 16 = 720
		ueBits(14)+ // pic_height_in_map_units_minus1 = 14 -> 2 * 15 * 16 = 480
		"0"+ // frame_mbs_only_flag = 0 (interlaced)
		"0"+ // mb_adaptive_frame_field_flag — present ONLY because the above is 0
		"1"+ // direct_8x8_inference_flag
		"0"+ // frame_cropping_flag
		"0") // vui_parameters_present_flag

	got, err := ParseSPS(spsNAL(77, 0x00, 30, body))
	if err != nil {
		t.Fatal(err)
	}
	if got.Width != 720 || got.Height != 480 {
		t.Errorf("got %dx%d, want 720x480", got.Width, got.Height)
	}
	if got.FrameMBSOnly {
		t.Error("FrameMBSOnly = true for a stream whose frame_mbs_only_flag is 0")
	}
}

// A scaling list is variable length and ends early when a delta drives the
// running scale to zero, so it cannot be skipped by a fixed bit count. Walking
// it wrong does not fail — it shifts the width field, and the parser reports a
// confident wrong resolution. This vector puts a present, non-trivial list in
// front of the dimensions so a mis-walk moves them.
func TestParseSPSWalksScalingListsBeforeReadingTheDimensions(t *testing.T) {
	// Eight lists for 4:2:0. The first is present and terminates early (a delta
	// of -8 takes the scale from 8 to 0); the rest are absent.
	scaling := "1" + // scaling_list_present_flag[0] = 1
		ueBits(16) + // delta_scale as se(-8): se maps code 16 -> -8
		strings.Repeat("0", 7) // present flags for lists 1..7, all absent

	body := bits(t, ueBits(0)+
		ueBits(1)+ // chroma_format_idc = 1
		ueBits(0)+ueBits(0)+ // bit depths
		"0"+ // qpprime
		"1"+ // seq_scaling_matrix_present_flag = 1
		scaling+
		ueBits(0)+ // log2_max_frame_num_minus4
		ueBits(0)+ // pic_order_cnt_type
		ueBits(0)+ // log2_max_pic_order_cnt_lsb_minus4
		ueBits(1)+ // max_num_ref_frames
		"0"+
		ueBits(39)+ // pic_width_in_mbs_minus1 = 39 -> 640
		ueBits(29)+ // pic_height_in_map_units_minus1 = 29 -> 480
		"1"+"1"+"0"+"0")

	got, err := ParseSPS(spsNAL(100, 0x00, 31, body))
	if err != nil {
		t.Fatal(err)
	}
	if got.Width != 640 || got.Height != 480 {
		t.Errorf("got %dx%d, want 640x480 — a mis-walked scaling list shifts the dimension fields", got.Width, got.Height)
	}
}

// 4:2:2 crops horizontally like 4:2:0 but vertically like 4:4:4, because chroma
// is subsampled in one axis only. Using 4:2:0's units over-crops the height.
func TestParseSPSChroma422UsesItsOwnCropUnits(t *testing.T) {
	body := bits(t, ueBits(0)+
		ueBits(2)+ // chroma_format_idc = 2 (4:2:2)
		ueBits(0)+ueBits(0)+"0"+"0"+
		ueBits(0)+ueBits(0)+ueBits(0)+ueBits(1)+"0"+
		ueBits(39)+ // 640 wide
		ueBits(29)+ // 480 coded high
		"1"+"1"+
		"1"+ // frame_cropping_flag
		ueBits(0)+ueBits(0)+ueBits(0)+ueBits(4)+ // bottom offset 4
		"0")

	got, err := ParseSPS(spsNAL(122, 0x00, 31, body))
	if err != nil {
		t.Fatal(err)
	}
	// cropUnitY = SubHeightC * (2 - 1) = 1 * 1 = 1, so 4 offsets remove 4 lines.
	// Under 4:2:0's units it would be 2 and the answer would be 472.
	if got.Height != 476 {
		t.Errorf("height %d, want 476 (480 less 4); 472 means 4:2:0 crop units were used for a 4:2:2 stream", got.Height)
	}
	if got.ChromaFormatIDC != 2 {
		t.Errorf("chroma_format_idc = %d, want 2", got.ChromaFormatIDC)
	}
}

// Emulation prevention is a property of the byte stream, not the syntax: a 0x03
// left in place shifts every field after it by eight bits, so the dimensions
// come out of the wrong offset.
//
// The escape has to sit BEFORE the dimension fields for this to test anything.
// The first version of this test appended 0x00 0x00 0x03 after the stop bit,
// where no field is ever read from — so it passed whether the parser unescaped
// or not, which is the failure mode the whole file is written against.
//
// Getting an escape into the parsed region takes a deliberate bit layout, since
// the encoder only inserts one where two zero bytes are followed by a byte ≤
// 0x03. Four one-bits then a 26-leading-zero exp-Golomb value puts 0x00 0x00
// 0x02 at byte offsets 1–3, which is exactly that condition. The huge
// max_num_ref_frames is chosen to force the byte pattern, not because a camera
// would send it — the field's value is irrelevant to what is being tested, and
// no real SPS is needed to prove that a parser respects a byte-stuffing rule.
func TestParseSPSRemovesEmulationPreventionBytesBeforeTheDimensions(t *testing.T) {
	const forcesZeroBytes = (1 << 26) - 1 // 26 leading zeroes in its code word

	unstuffed := bits(t, ueBits(0)+ // seq_parameter_set_id
		ueBits(0)+ // log2_max_frame_num_minus4
		ueBits(0)+ // pic_order_cnt_type
		ueBits(0)+ // log2_max_pic_order_cnt_lsb_minus4
		ueBits(forcesZeroBytes)+ // max_num_ref_frames — see above
		"0"+ // gaps_in_frame_num_value_allowed_flag
		ueBits(19)+ // pic_width_in_mbs_minus1 -> 320
		ueBits(14)+ // pic_height_in_map_units_minus1 -> 240
		"1"+"1"+"0"+"0")

	// Confirm the layout really did produce the condition an encoder stuffs for,
	// rather than trusting the arithmetic in the comment above.
	stuffAt := -1
	for i := 2; i < len(unstuffed); i++ {
		if unstuffed[i-2] == 0 && unstuffed[i-1] == 0 && unstuffed[i] <= 0x03 {
			stuffAt = i
			break
		}
	}
	if stuffAt < 0 {
		t.Fatalf("the vector contains no 0x000000..0x000003 sequence, so no escape is "+
			"required and this test would prove nothing. body: % x", unstuffed[:8])
	}

	// Insert the escape the way an encoder would.
	stuffed := make([]byte, 0, len(unstuffed)+1)
	stuffed = append(stuffed, unstuffed[:stuffAt]...)
	stuffed = append(stuffed, 0x03)
	stuffed = append(stuffed, unstuffed[stuffAt:]...)
	if !hasEmulationPrevention(stuffed) {
		t.Fatal("the stuffed vector does not register as carrying an escape byte")
	}

	got, err := ParseSPS(spsNAL(66, 0x00, 30, stuffed))
	if err != nil {
		t.Fatalf("parsing a correctly stuffed SPS failed: %v", err)
	}
	// The escape sits ahead of both dimension fields, so a parser that leaves it
	// in reads them eight bits late and cannot arrive at 320x240.
	if got.Width != 320 || got.Height != 240 {
		t.Errorf("got %dx%d, want 320x240 — the escape byte at offset %d was not removed "+
			"before the dimension fields were read", got.Width, got.Height, stuffAt)
	}
}

func TestUnescapeRBSP(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   []byte
		want []byte
	}{
		{"no escape is returned unchanged", []byte{0x01, 0x02, 0x03}, []byte{0x01, 0x02, 0x03}},
		{"one escape after two zeroes", []byte{0x00, 0x00, 0x03, 0x01}, []byte{0x00, 0x00, 0x01}},
		{"escape carrying a zero", []byte{0x00, 0x00, 0x03, 0x00}, []byte{0x00, 0x00, 0x00}},
		{
			// The zero run restarts after each escape, so 0x03 0x00 0x00 0x03
			// is two separate stuffings rather than one.
			"two escapes in a row",
			[]byte{0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x02},
			[]byte{0x00, 0x00, 0x00, 0x00, 0x02},
		},
		{
			// A 0x03 that is NOT preceded by two zeroes is ordinary data. Removing
			// it would corrupt the bitstream in exactly the way leaving a real
			// escape in does.
			"a lone 0x03 is data",
			[]byte{0x01, 0x03, 0x00, 0x03},
			[]byte{0x01, 0x03, 0x00, 0x03},
		},
		{
			// Three zeroes then 0x03: the run counter must not have been reset by
			// the third zero in a way that misses the escape.
			"three zeroes then an escape",
			[]byte{0x00, 0x00, 0x00, 0x03, 0x01},
			[]byte{0x00, 0x00, 0x00, 0x01},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := unescapeRBSP(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("got % x (%d bytes), want % x (%d bytes)", got, len(got), tc.want, len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got % x, want % x", got, tc.want)
				}
			}
		})
	}
}

func TestParseSPSRefusals(t *testing.T) {
	valid := bits(t, ueBits(0)+ueBits(0)+ueBits(0)+ueBits(0)+ueBits(1)+"0"+
		ueBits(19)+ueBits(14)+"1"+"1"+"0"+"0")

	t.Run("a PPS is not an SPS", func(t *testing.T) {
		// nal_unit_type 8 is a picture parameter set. Parsed as an SPS it would
		// yield a confident wrong resolution rather than an error.
		nal := append([]byte{0x68, 66, 0x00, 30}, valid...)
		if _, err := ParseSPS(nal); !errors.Is(err, ErrNotSPS) {
			t.Errorf("err = %v, want ErrNotSPS", err)
		}
	})

	t.Run("forbidden_zero_bit set", func(t *testing.T) {
		nal := spsNAL(66, 0x00, 30, valid)
		nal[0] |= 0x80
		if _, err := ParseSPS(nal); !errors.Is(err, ErrNotSPS) {
			t.Errorf("err = %v, want ErrNotSPS for a NAL flagged as corrupt", err)
		}
	})

	t.Run("truncated before the dimensions", func(t *testing.T) {
		nal := spsNAL(66, 0x00, 30, valid[:1])
		if _, err := ParseSPS(nal); !errors.Is(err, ErrSPSTruncated) {
			t.Errorf("err = %v, want ErrSPSTruncated", err)
		}
	})

	t.Run("shorter than the fixed header", func(t *testing.T) {
		if _, err := ParseSPS([]byte{0x67, 66, 0x00}); !errors.Is(err, ErrSPSTruncated) {
			t.Errorf("err = %v, want ErrSPSTruncated", err)
		}
	})

	t.Run("an all-zero body does not read as one enormous value", func(t *testing.T) {
		// Without a prefix bound this is a single ue() with hundreds of leading
		// zeroes, and the 1<<zeros shift overflows silently — turning a corrupt
		// field into a small plausible number rather than an error.
		if _, err := ParseSPS(spsNAL(66, 0x00, 30, make([]byte, 64))); err == nil {
			t.Error("an all-zero SPS body parsed without error")
		}
	})

	t.Run("cropping away the whole picture", func(t *testing.T) {
		body := bits(t, ueBits(0)+ueBits(0)+ueBits(0)+ueBits(0)+ueBits(1)+"0"+
			ueBits(19)+ // 320 wide
			ueBits(14)+ // 240 high
			"1"+"1"+
			"1"+ // frame_cropping_flag
			ueBits(0)+ueBits(0)+ueBits(0)+ueBits(120)+ // bottom offset 120 -> 240 lines
			"0")
		if _, err := ParseSPS(spsNAL(66, 0x00, 30, body)); err == nil {
			t.Error("an SPS cropping away every line parsed without error; a zero-height " +
				"track is a file a viewer accepts and shows nothing in")
		}
	})

	t.Run("a picture larger than any defined level", func(t *testing.T) {
		body := bits(t, ueBits(0)+ueBits(0)+ueBits(0)+ueBits(0)+ueBits(1)+"0"+
			ueBits(2000)+ // 2001 macroblocks = 32016 samples wide
			ueBits(14)+"1"+"1"+"0"+"0")
		if _, err := ParseSPS(spsNAL(66, 0x00, 30, body)); err == nil {
			t.Error("a 32016-sample-wide picture parsed without error")
		}
	})
}

// The vector helper and the parser both implement §9.1, in opposite directions.
// If they share a mistake every test above passes while the parser is wrong, so
// pin the helper against code words the standard tabulates directly (Table 9-1)
// rather than against the reader under test.
func TestUEBitsRendersTheCodeWordsTheStandardTabulates(t *testing.T) {
	for _, tc := range []struct {
		v    uint64
		want string
	}{
		{0, "1"},
		{1, "010"},
		{2, "011"},
		{3, "00100"},
		{4, "00101"},
		{5, "00110"},
		{6, "00111"},
		{7, "0001000"},
		{8, "0001001"},
	} {
		if got := ueBits(tc.v); got != tc.want {
			t.Errorf("ueBits(%d) = %q, want %q (H.264 Table 9-1)", tc.v, got, tc.want)
		}
	}
}

// And the reader, against the same table, read back independently.
func TestUEReadsTheCodeWordsTheStandardTabulates(t *testing.T) {
	for _, tc := range []struct {
		bits string
		want uint64
	}{
		{"1", 0},
		{"010", 1},
		{"011", 2},
		{"00100", 3},
		{"00101", 4},
		{"00110", 5},
		{"00111", 6},
		{"0001000", 7},
		{"0001001", 8},
	} {
		// Padded to a byte so the reader has whole bytes to work with; the
		// trailing bits are never reached.
		padded := tc.bits + strings.Repeat("0", (8-len(tc.bits)%8)%8)
		raw := make([]byte, len(padded)/8)
		for i := range raw {
			var v byte
			for j := 0; j < 8; j++ {
				v <<= 1
				if padded[i*8+j] == '1' {
					v |= 1
				}
			}
			raw[i] = v
		}
		got, err := newBitReader(raw).ue()
		if err != nil {
			t.Fatalf("ue(%q): %v", tc.bits, err)
		}
		if got != tc.want {
			t.Errorf("ue(%q) = %d, want %d (H.264 Table 9-1)", tc.bits, got, tc.want)
		}
	}
}

// se()'s mapping is the one place a sign error produces plausible output: every
// magnitude stays right and only the direction flips, which in a scaling-list
// walk shifts nothing and in a POC offset shifts everything.
func TestSEMapsCodeWordsToSignedValues(t *testing.T) {
	for _, tc := range []struct {
		code uint64
		want int64
	}{
		{0, 0}, {1, 1}, {2, -1}, {3, 2}, {4, -2}, {5, 3}, {6, -3},
	} {
		raw := bits(t, ueBits(tc.code))
		got, err := newBitReader(raw).se()
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("se(code %d) = %d, want %d (H.264 §9.1.1)", tc.code, got, tc.want)
		}
	}
}
