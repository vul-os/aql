package camera

// H.264 sequence parameter set parsing — ITU-T H.264 §7.3.2.1.1, and the only
// part of the codec this package has any business reading.
//
// h264.go produces NAL units and deliberately stops there: "Muxing them into a
// file is a separate job again." This file is the first step of that job, and it
// is a narrow one. A muxer cannot write an fMP4 without four facts that exist
// nowhere except inside the SPS bitstream:
//
//   - width and height in luma samples, AFTER frame cropping, for tkhd/stsd.
//     The encoded picture is a whole number of 16-pixel macroblocks, so a
//     1080-line camera encodes 1088 lines and crops 8 away. A muxer that writes
//     the uncropped figure produces a file that plays with a green band along
//     one edge, and every box in it is structurally valid, so nothing complains.
//   - profile_idc, the constraint-flags byte and level_idc, which go into
//     AVCDecoderConfigurationRecord verbatim (ISO/IEC 14496-15 §5.3.3.1).
//     A demuxer uses them to decide whether it can play the track at all.
//
// # This is a parser, not a decoder
//
// Everything here reads the sequence parameter set's header fields and stops at
// the VUI. It does not touch a slice, does not reconstruct a picture, and could
// not be extended into something that does without becoming an H.264 decoder —
// which h264.go already states this repository has no reason to reimplement.
//
// # Why the awkward fields are still parsed
//
// Most of what follows is skipped rather than used: scaling lists, POC cycle
// tables, ref-frame counts. They are parsed anyway because exp-Golomb is
// self-delimiting only if you read every field in order. There is no way to
// "skip to" pic_width_in_mbs_minus1 — its bit offset depends on how many bits
// every preceding field consumed. So a parser that ignores the scaling lists
// does not read the width from a later offset; it reads garbage from the middle
// of a scaling list and reports a plausible-looking resolution. That failure is
// silent and produces a file that is wrong rather than rejected, which is why
// the skipped fields below are walked rather than assumed absent.

import (
	"errors"
	"fmt"
)

// SPS is the subset of a sequence parameter set an fMP4 muxer needs.
//
// Width and Height are in luma samples with frame cropping already applied —
// the displayed size, not the encoded macroblock grid.
type SPS struct {
	ProfileIDC uint8
	// ConstraintFlags is the whole byte following profile_idc: the six
	// constraint_setN_flags plus two reserved bits. Kept as one byte because
	// that is how AVCDecoderConfigurationRecord carries it, and splitting it
	// into named flags would invite reassembling it in a different bit order.
	ConstraintFlags uint8
	LevelIDC        uint8
	Width           int
	Height          int
	// ChromaFormatIDC is 1 (4:2:0) when the SPS does not carry it, which is
	// what the spec's inference rule says for the profiles that omit it.
	ChromaFormatIDC uint8
	// FrameMBSOnly is false for an interlaced stream. Recorded because it
	// doubles the coded height and a caller deciding whether it can handle the
	// stream at all wants to know before it writes a track.
	FrameMBSOnly bool
}

// ErrNotSPS reports a NAL whose header says it is something else. Returned
// rather than parsed-anyway because reading a PPS as an SPS yields a confident
// wrong resolution.
var ErrNotSPS = errors.New("camera: NAL unit is not a sequence parameter set")

// ErrSPSTruncated reports a bitstream that ended mid-field.
var ErrSPSTruncated = errors.New("camera: sequence parameter set ended mid-field")

// nalTypeSPS is the nal_unit_type for a sequence parameter set (H.264 Table 7-1).
const nalTypeSPS = 7

// maxSPSDimension bounds a decoded width or height.
//
// pic_width_in_mbs_minus1 is an unbounded exp-Golomb value, so a corrupt or
// hostile SPS can claim a picture of billions of samples per side. Nothing
// downstream would divide by zero on it, but a muxer would write those numbers
// into a tkhd and a viewer would try to allocate them. H.264 level 6.2 — the
// highest the standard defines — tops out at 8192×4320, so refusing anything
// past 16384 rejects nonsense while leaving room for every real stream and for
// levels the standard has not defined yet.
const maxSPSDimension = 16384

// ParseSPS reads a sequence parameter set NAL unit.
//
// nal must start at the NAL header byte — no Annex-B start code, no length
// prefix. That is what Depacketizer emits once the start code is stripped, and
// what an AVCDecoderConfigurationRecord stores.
func ParseSPS(nal []byte) (SPS, error) {
	if len(nal) < 4 {
		return SPS{}, ErrSPSTruncated
	}
	// forbidden_zero_bit must be 0; a 1 marks a NAL corrupted in transit
	// (H.264 §7.4.1), and the fields after it cannot be trusted.
	if nal[0]&0x80 != 0 {
		return SPS{}, fmt.Errorf("camera: NAL forbidden_zero_bit set: %w", ErrNotSPS)
	}
	if nal[0]&0x1f != nalTypeSPS {
		return SPS{}, fmt.Errorf("camera: nal_unit_type %d: %w", nal[0]&0x1f, ErrNotSPS)
	}

	var s SPS
	// The three bytes after the NAL header are fixed-width, so they are read
	// directly rather than through the bit reader. They are also the only fields
	// in the SPS that are byte-aligned by construction.
	s.ProfileIDC = nal[1]
	s.ConstraintFlags = nal[2]
	s.LevelIDC = nal[3]

	// Emulation prevention bytes are removed before any bit is read. They are a
	// property of the byte stream, not of the syntax: a 0x03 inserted after two
	// zero bytes shifts every subsequent field by 8 bits. Stripping them after
	// parsing, or not at all, misreads any SPS containing a 0x000003 sequence —
	// which real parameter sets do contain, since a run of zeroes is exactly
	// what a small exp-Golomb field surrounded by flags produces.
	br := newBitReader(unescapeRBSP(nal[4:]))

	if _, err := br.ue(); err != nil { // seq_parameter_set_id
		return SPS{}, err
	}

	s.ChromaFormatIDC = 1 // inferred when absent (§7.4.2.1.1)
	separateColourPlane := false
	switch s.ProfileIDC {
	// The high profiles, and only these, carry the chroma and scaling-list
	// fields (§7.3.2.1.1). The list is enumerated rather than written as
	// "profile >= 100" because the profile numbers are not ordered by feature
	// set — 244 (High 4:4:4 Predictive) and 44 (CAVLC 4:4:4 Intra) are both
	// above and below 100 respectively in ways that break any threshold test.
	case 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135:
		cf, err := br.ue()
		if err != nil {
			return SPS{}, err
		}
		if cf > 3 {
			return SPS{}, fmt.Errorf("camera: chroma_format_idc %d out of range", cf)
		}
		s.ChromaFormatIDC = uint8(cf)
		if cf == 3 {
			b, err := br.bit()
			if err != nil {
				return SPS{}, err
			}
			separateColourPlane = b == 1
		}
		if _, err := br.ue(); err != nil { // bit_depth_luma_minus8
			return SPS{}, err
		}
		if _, err := br.ue(); err != nil { // bit_depth_chroma_minus8
			return SPS{}, err
		}
		if _, err := br.bit(); err != nil { // qpprime_y_zero_transform_bypass_flag
			return SPS{}, err
		}
		scaling, err := br.bit()
		if err != nil {
			return SPS{}, err
		}
		if scaling == 1 {
			// Eight lists for 4:2:0, twelve for 4:4:4 (§7.3.2.1.1): the extra
			// four are the 8x8 chroma lists, which only exist when the chroma
			// planes are full resolution. Getting this count wrong shifts every
			// field after it, including the width.
			n := 8
			if cf == 3 {
				n = 12
			}
			for i := 0; i < n; i++ {
				if err := br.skipScalingList(i); err != nil {
					return SPS{}, err
				}
			}
		}
	}

	if _, err := br.ue(); err != nil { // log2_max_frame_num_minus4
		return SPS{}, err
	}
	pocType, err := br.ue()
	if err != nil {
		return SPS{}, err
	}
	switch pocType {
	case 0:
		if _, err := br.ue(); err != nil { // log2_max_pic_order_cnt_lsb_minus4
			return SPS{}, err
		}
	case 1:
		if _, err := br.bit(); err != nil { // delta_pic_order_always_zero_flag
			return SPS{}, err
		}
		if _, err := br.se(); err != nil { // offset_for_non_ref_pic
			return SPS{}, err
		}
		if _, err := br.se(); err != nil { // offset_for_top_to_bottom_field
			return SPS{}, err
		}
		cycleLen, err := br.ue()
		if err != nil {
			return SPS{}, err
		}
		// Bounded because each iteration reads at least one bit but the count
		// itself is unbounded exp-Golomb: a claimed cycle of 2^40 would spin
		// until the reader ran out, which is a slow failure rather than a
		// refusal. The spec caps num_ref_frames_in_pic_order_cnt_cycle at 255.
		if cycleLen > 255 {
			return SPS{}, fmt.Errorf("camera: num_ref_frames_in_pic_order_cnt_cycle %d exceeds 255", cycleLen)
		}
		for i := uint64(0); i < cycleLen; i++ {
			if _, err := br.se(); err != nil { // offset_for_ref_frame[i]
				return SPS{}, err
			}
		}
	case 2:
		// No additional fields.
	default:
		return SPS{}, fmt.Errorf("camera: pic_order_cnt_type %d out of range", pocType)
	}

	if _, err := br.ue(); err != nil { // max_num_ref_frames
		return SPS{}, err
	}
	if _, err := br.bit(); err != nil { // gaps_in_frame_num_value_allowed_flag
		return SPS{}, err
	}

	widthMBsMinus1, err := br.ue()
	if err != nil {
		return SPS{}, err
	}
	heightMapUnitsMinus1, err := br.ue()
	if err != nil {
		return SPS{}, err
	}
	frameMBSOnly, err := br.bit()
	if err != nil {
		return SPS{}, err
	}
	s.FrameMBSOnly = frameMBSOnly == 1
	if !s.FrameMBSOnly {
		if _, err := br.bit(); err != nil { // mb_adaptive_frame_field_flag
			return SPS{}, err
		}
	}
	if _, err := br.bit(); err != nil { // direct_8x8_inference_flag
		return SPS{}, err
	}

	var cropLeft, cropRight, cropTop, cropBottom uint64
	cropping, err := br.bit()
	if err != nil {
		return SPS{}, err
	}
	if cropping == 1 {
		if cropLeft, err = br.ue(); err != nil {
			return SPS{}, err
		}
		if cropRight, err = br.ue(); err != nil {
			return SPS{}, err
		}
		if cropTop, err = br.ue(); err != nil {
			return SPS{}, err
		}
		if cropBottom, err = br.ue(); err != nil {
			return SPS{}, err
		}
	}
	// vui_parameters_present_flag and everything after it is deliberately not
	// read. The VUI carries the frame rate, which a muxer would like, but RTP
	// timestamps give the same information without a second parser — and the VUI
	// is where H.264 parsers historically go wrong, because hrd_parameters is
	// long, optional, and nested.

	// §7.4.2.1.1. ChromaArrayType is chroma_format_idc unless the colour planes
	// are coded separately, in which case it is 0 and the crop units are the
	// monochrome ones.
	chromaArrayType := s.ChromaFormatIDC
	if separateColourPlane {
		chromaArrayType = 0
	}
	frameHeightMultiplier := uint64(2)
	if s.FrameMBSOnly {
		frameHeightMultiplier = 1
	}
	var cropUnitX, cropUnitY uint64
	if chromaArrayType == 0 {
		cropUnitX, cropUnitY = 1, frameHeightMultiplier
	} else {
		subWidthC, subHeightC := uint64(2), uint64(2)
		switch chromaArrayType {
		case 2: // 4:2:2 — chroma is subsampled horizontally only
			subHeightC = 1
		case 3: // 4:4:4 — no subsampling
			subWidthC, subHeightC = 1, 1
		}
		cropUnitX, cropUnitY = subWidthC, subHeightC*frameHeightMultiplier
	}

	codedWidth := (widthMBsMinus1 + 1) * 16
	codedHeight := frameHeightMultiplier * (heightMapUnitsMinus1 + 1) * 16
	if codedWidth > maxSPSDimension || codedHeight > maxSPSDimension {
		return SPS{}, fmt.Errorf("camera: coded picture %dx%d exceeds the %d-sample limit",
			codedWidth, codedHeight, maxSPSDimension)
	}

	cropX := cropUnitX * (cropLeft + cropRight)
	cropY := cropUnitY * (cropTop + cropBottom)
	// Cropping away the whole picture is syntactically expressible and
	// semantically nothing. Refused rather than clamped to zero, because a
	// zero-dimension track is a file a viewer accepts and shows nothing in.
	if cropX >= codedWidth || cropY >= codedHeight {
		return SPS{}, fmt.Errorf("camera: frame cropping removes the entire picture (%dx%d coded, %dx%d cropped away)",
			codedWidth, codedHeight, cropX, cropY)
	}
	s.Width = int(codedWidth - cropX)
	s.Height = int(codedHeight - cropY)
	return s, nil
}

// unescapeRBSP removes emulation prevention bytes: within the NAL payload, the
// encoder inserts 0x03 after any 0x0000 that would otherwise be followed by a
// byte ≤ 0x03, so the sequence cannot be mistaken for a start code
// (H.264 §7.4.1.1).
func unescapeRBSP(b []byte) []byte {
	// Most parameter sets contain no escape at all, so the common case returns
	// the input rather than a copy.
	if !hasEmulationPrevention(b) {
		return b
	}
	out := make([]byte, 0, len(b))
	zeros := 0
	for _, c := range b {
		// `>= 2`, not `== 2`. The decoder rule is about the two bytes
		// immediately preceding the 0x03, not about a run of exactly two: in
		// 00 00 00 03 the escape is still an escape, because its predecessors
		// are two zeroes. An `== 2` test — which this was — leaves that 0x03 in
		// the RBSP and shifts every field after it by eight bits. A run of three
		// or more zero bytes is ordinary in a parameter set whenever a small
		// exp-Golomb field lands between flags, so this is not a corner case.
		if zeros >= 2 && c == 0x03 {
			zeros = 0
			continue // the escape byte itself is not part of the RBSP
		}
		if c == 0 {
			zeros++
		} else {
			zeros = 0
		}
		out = append(out, c)
	}
	return out
}

func hasEmulationPrevention(b []byte) bool {
	for i := 2; i < len(b); i++ {
		if b[i] == 0x03 && b[i-1] == 0 && b[i-2] == 0 {
			return true
		}
	}
	return false
}

// bitReader reads big-endian bit fields out of an RBSP.
type bitReader struct {
	buf []byte
	pos int // bit offset from the start of buf
}

func newBitReader(b []byte) *bitReader { return &bitReader{buf: b} }

func (r *bitReader) bit() (uint64, error) {
	if r.pos >= len(r.buf)*8 {
		return 0, ErrSPSTruncated
	}
	b := (r.buf[r.pos/8] >> (7 - uint(r.pos%8))) & 1
	r.pos++
	return uint64(b), nil
}

// maxUEPrefix bounds the leading-zero run.
//
// An all-zero buffer would otherwise be read as a single enormous value, and
// values past 63 zeroes cannot be represented in the uint64 the result is
// accumulated into — the shift would overflow silently and produce a small
// number from a corrupt field, which is the one outcome worse than an error.
// No field in an SPS legitimately needs more than 32.
const maxUEPrefix = 32

// ue reads an unsigned exp-Golomb value (§9.1): N leading zeroes, a one, then N
// more bits, giving 2^N − 1 plus those bits.
func (r *bitReader) ue() (uint64, error) {
	zeros := 0
	for {
		b, err := r.bit()
		if err != nil {
			return 0, err
		}
		if b == 1 {
			break
		}
		zeros++
		if zeros > maxUEPrefix {
			return 0, fmt.Errorf("camera: exp-Golomb prefix longer than %d bits: %w", maxUEPrefix, ErrSPSTruncated)
		}
	}
	v := uint64(1)<<uint(zeros) - 1
	for i := 0; i < zeros; i++ {
		b, err := r.bit()
		if err != nil {
			return 0, err
		}
		v += b << uint(zeros-1-i)
	}
	return v, nil
}

// se reads a signed exp-Golomb value (§9.1.1): the unsigned code word k maps to
// ⌈k/2⌉ with an alternating sign, so 1→1, 2→−1, 3→2, 4→−2.
func (r *bitReader) se() (int64, error) {
	k, err := r.ue()
	if err != nil {
		return 0, err
	}
	if k%2 == 0 {
		return -int64(k / 2), nil
	}
	return int64((k + 1) / 2), nil
}

// skipScalingList walks one scaling list (§7.3.2.1.1.1) without keeping it.
// The list ends early if a delta makes the running scale zero, so the number of
// deltas is data-dependent and cannot be skipped by a fixed bit count.
func (r *bitReader) skipScalingList(idx int) error {
	present, err := r.bit()
	if err != nil {
		return err
	}
	if present == 0 {
		return nil
	}
	// Lists 0–5 are 4x4 (16 coefficients), 6 onward are 8x8 (64).
	size := 16
	if idx >= 6 {
		size = 64
	}
	lastScale := int64(8)
	nextScale := int64(8)
	for i := 0; i < size; i++ {
		if nextScale != 0 {
			delta, err := r.se()
			if err != nil {
				return err
			}
			nextScale = (lastScale + delta + 256) % 256
		}
		if nextScale != 0 {
			lastScale = nextScale
		}
	}
	return nil
}
