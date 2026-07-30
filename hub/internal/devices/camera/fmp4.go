package camera

// Fragmented MP4 muxing — ISO/IEC 14496-12 (ISO base media file format) and
// -15 (AVC in ISOBMFF). This is the "fMP4 writer" doc.go names as the remaining
// half of recording, and the reason it comes after sps.go: an init segment
// cannot be written without the encoder's real dimensions, profile and level,
// and those exist nowhere except inside the SPS bitstream.
//
// # Why fragmented, and not a plain MP4
//
// A plain MP4 puts its sample tables in a moov at the front, which means the
// table is only complete once recording stops. Writing one requires either
// buffering the whole clip or seeking back to patch the header — and a camera
// recorder is exactly the workload where the process is most likely to be
// killed mid-clip, by a full disk, a reboot, or a retention worker. A plain MP4
// truncated at any point is not a shorter video, it is a file with no index: a
// player reads the incomplete moov and refuses the lot.
//
// Fragmented MP4 puts a self-describing index in front of every fragment. A file
// cut off mid-write loses the fragment being written and plays everything before
// it. That is the difference between losing four seconds of the evening someone
// cared about and losing the evening, which docs/CAMERA-RETENTION.md is
// explicitly about.
//
// It is also the only container the browser can play without a plugin: Media
// Source Extensions takes exactly this byte layout, so the same writer serves
// recording and live view rather than needing two.
//
// # Access units are the caller's job
//
// Fragment takes samples already grouped into access units — one decoded
// picture each. Grouping NAL units into pictures is a different piece of H.264
// semantics from anything in sps.go or h264.go: it needs first_mb_in_slice from
// each slice header, and the rules for when a new picture starts (H.264 §7.4.1.2)
// are genuinely fiddly. Guessing at it inside the muxer would put a second
// under-tested bitstream parser behind a box writer, where its mistakes would
// surface as timing drift rather than as an error. So the seam is explicit: the
// caller says where a picture ends, and this file writes boxes.
//
// # What is NOT here
//
// No audio. No edit lists. No B-frame reordering beyond writing the composition
// offsets a caller supplies — the muxer does not compute them, because deriving
// them needs picture order counts, which needs slice headers, which is the same
// parser this file just declined to write.
//
// NOTHING IN THIS FILE HAS SEEN A CAMERA, the same as the rest of the package.
// What it has seen is Chromium's demuxer: fmp4_browser.spec.ts feeds the output
// of this writer to a real SourceBuffer, which is an independent implementation
// that rejects malformed boxes. That is a stronger check than a test built on
// this file's own reading of the spec, and it is still not a camera.

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// H264ClockRate is the RTP timestamp clock for H.264 (RFC 6184 §8.1) and the
// natural timescale for a track built from RTP: sample durations are then
// exactly the timestamp deltas off the wire, with no rounding.
const H264ClockRate = 90000

// videoTrackID is the only track this writer produces. Track IDs must be
// non-zero (14496-12 §8.3.2.3).
const videoTrackID = 1

// avcLengthSize is the NAL length prefix width written into mdat, and declared
// in avcC as lengthSizeMinusOne. Four bytes because a single H.264 NAL can
// legitimately exceed 64 KiB — an IDR picture at 4K routinely does — and a
// 2-byte prefix would silently truncate the length rather than the data.
const avcLengthSize = 4

// Sample is one access unit: the NAL units of a single decoded picture.
type Sample struct {
	// NALUnits are bare NAL units — each starting at its header byte, with no
	// Annex-B start code and no length prefix. Fragment refuses anything that
	// looks start-code prefixed rather than silently writing it, because a NAL
	// carrying its own 00 00 01 produces a file that is structurally valid and
	// undecodable.
	NALUnits [][]byte
	// Duration is how long this picture is shown, in track timescale units.
	Duration uint32
	// IsSync marks a sample a player may start decoding at — an IDR picture.
	// A fragment whose samples are all non-sync is unseekable, and a track whose
	// first sample is non-sync will not start at all.
	IsSync bool
	// CompositionOffset is composition time minus decode time, in timescale
	// units, for streams with B-frames. Signed, and written through a version-1
	// trun so negative values survive; zero for streams in decode order.
	//
	// Not computed here — see the file comment. A caller that does not know it
	// should leave it zero rather than guess, since a wrong offset reorders
	// frames and a zero merely declines to.
	CompositionOffset int32
}

// Fragmenter writes one video track as a fragmented MP4.
//
// Not safe for concurrent use: fragment sequence numbers and the running decode
// time are per-track state, and two goroutines interleaving fragments would
// produce a file whose timeline goes backwards.
type Fragmenter struct {
	sps       []byte
	pps       []byte
	params    SPS
	timescale uint32

	seq      uint32 // moof sequence_number, 1-based
	decodeTS uint64 // running baseMediaDecodeTime
}

// ErrAnnexBSample reports a NAL unit that still carries a start code.
var ErrAnnexBSample = errors.New("camera: sample NAL unit is Annex-B framed; strip the start code first")

// NewFragmenter prepares a writer from the stream's parameter sets.
//
// sps and pps are bare NAL units, as ParseSPS takes and as
// sprop-parameter-sets carries them. The SPS is parsed rather than trusted: its
// dimensions go into the track header, and writing a track whose declared size
// disagrees with the bitstream is the padding-band failure sps.go exists to
// avoid.
func NewFragmenter(sps, pps []byte, timescale uint32) (*Fragmenter, error) {
	if timescale == 0 {
		// A zero timescale means every duration is a division by zero for the
		// player. Refused rather than defaulted, because a caller that passed 0
		// has a bug and silently substituting 90000 would hide it behind
		// plausible playback.
		return nil, errors.New("camera: fMP4 timescale must be non-zero")
	}
	parsed, err := ParseSPS(sps)
	if err != nil {
		return nil, fmt.Errorf("camera: fMP4 init segment needs a readable SPS: %w", err)
	}
	if len(pps) == 0 {
		return nil, errors.New("camera: fMP4 init segment needs a picture parameter set")
	}
	// A decoder reads the PPS out of avcC by length and does not re-check its
	// type, so a caller that passed the SPS twice would produce a file that
	// fails at decode with no indication why.
	if pps[0]&0x1f != 8 {
		return nil, fmt.Errorf("camera: pps argument has nal_unit_type %d, want 8", pps[0]&0x1f)
	}
	return &Fragmenter{
		sps:       append([]byte(nil), sps...),
		pps:       append([]byte(nil), pps...),
		params:    parsed,
		timescale: timescale,
	}, nil
}

// Params reports the parsed sequence parameter set backing the init segment.
func (f *Fragmenter) Params() SPS { return f.params }

// InitSegment returns ftyp+moov: everything a player needs before the first
// fragment. Deterministic and constant for the life of the Fragmenter, so it can
// be written once to a file or handed to each new MSE SourceBuffer.
func (f *Fragmenter) InitSegment() []byte {
	out := make([]byte, 0, 1024)
	out = append(out, f.ftyp()...)
	out = append(out, f.moov()...)
	return out
}

// Fragment returns one moof+mdat pair for the given access units and advances
// the track's decode time.
//
// Calling it with no samples is an error rather than a no-op: an empty fragment
// is legal ISOBMFF and useless, and a caller producing them is usually one whose
// access-unit grouping has silently stopped working.
func (f *Fragmenter) Fragment(samples []Sample) ([]byte, error) {
	if len(samples) == 0 {
		return nil, errors.New("camera: fMP4 fragment needs at least one sample")
	}
	sizes := make([]uint32, len(samples))
	payload := make([]byte, 0, 4096)
	for i, s := range samples {
		if len(s.NALUnits) == 0 {
			return nil, fmt.Errorf("camera: sample %d has no NAL units", i)
		}
		before := len(payload)
		for _, nal := range s.NALUnits {
			if len(nal) == 0 {
				return nil, fmt.Errorf("camera: sample %d contains an empty NAL unit", i)
			}
			// A NAL unit's first byte is its header, whose forbidden_zero_bit is
			// 0 and whose nal_unit_type is never 0 — so a leading 0x00 means the
			// caller left an Annex-B start code on. Refusing is the point: a
			// length-prefixed start code produces a file every box-level check
			// passes and no decoder can read.
			if nal[0] == 0x00 {
				return nil, fmt.Errorf("camera: sample %d: %w", i, ErrAnnexBSample)
			}
			var lenPrefix [avcLengthSize]byte
			binary.BigEndian.PutUint32(lenPrefix[:], uint32(len(nal)))
			payload = append(payload, lenPrefix[:]...)
			payload = append(payload, nal...)
		}
		sizes[i] = uint32(len(payload) - before)
	}

	f.seq++
	baseTS := f.decodeTS
	for _, s := range samples {
		f.decodeTS += uint64(s.Duration)
	}

	// The moof has to be built before its length is known, because trun's
	// data_offset is relative to the start of the moof and must point at the
	// first byte of mdat's payload — so it depends on the size of the box it is
	// written inside. Built once with a placeholder to learn the length, then
	// again with the real offset. Patching the bytes in place would be shorter
	// and would silently produce garbage the moment any preceding box changed
	// size.
	probe := f.moof(baseTS, samples, sizes, 0)
	dataOffset := int32(len(probe)) + 8 // + mdat header
	moof := f.moof(baseTS, samples, sizes, dataOffset)
	if len(moof) != len(probe) {
		// data_offset is a fixed-width field, so this cannot happen; asserted
		// because if it ever did, every sample in the fragment would be read
		// from the wrong place and the file would still parse.
		return nil, fmt.Errorf("camera: moof length changed with data_offset (%d -> %d)", len(probe), len(moof))
	}

	out := make([]byte, 0, len(moof)+len(payload)+8)
	out = append(out, moof...)
	out = append(out, box("mdat", payload)...)
	return out, nil
}

// Sequence reports how many fragments have been written.
func (f *Fragmenter) Sequence() uint32 { return f.seq }

// DecodeTime reports the track's next baseMediaDecodeTime, in timescale units.
func (f *Fragmenter) DecodeTime() uint64 { return f.decodeTS }

// ── box construction ────────────────────────────────────────────────────────

// box wraps a payload in a length-and-type header (14496-12 §4.2).
//
// Only the 32-bit size form is emitted. A box needing the 64-bit form would be
// an mdat over 4 GiB, which for a fragment holding a fraction of a second of
// video would mean something upstream has gone very wrong; the length is checked
// rather than silently truncated by the uint32 conversion.
func box(typ string, payload ...[]byte) []byte {
	n := 8
	for _, p := range payload {
		n += len(p)
	}
	out := make([]byte, 8, n)
	binary.BigEndian.PutUint32(out[0:4], uint32(n))
	copy(out[4:8], typ)
	for _, p := range payload {
		out = append(out, p...)
	}
	return out
}

// fullBox is a box whose payload begins with a version byte and 24-bit flags.
func fullBox(typ string, version uint8, flags uint32, payload ...[]byte) []byte {
	head := []byte{version, byte(flags >> 16), byte(flags >> 8), byte(flags)}
	return box(typ, append([][]byte{head}, payload...)...)
}

func u32(v uint32) []byte {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], v)
	return b[:]
}

func u64(v uint64) []byte {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], v)
	return b[:]
}

func u16(v uint16) []byte {
	var b [2]byte
	binary.BigEndian.PutUint16(b[:], v)
	return b[:]
}

func (f *Fragmenter) ftyp() []byte {
	// iso5 is claimed because tfdt (used below) is an ISO 14496-12:2012
	// addition; a player that only understands isom would otherwise be entitled
	// to reject the fragments. avc1 names the codec, mp41 is conventional.
	return box("ftyp", []byte("isom"), u32(0x200), []byte("isomiso5avc1mp41"))
}

func (f *Fragmenter) moov() []byte {
	return box("moov", f.mvhd(), f.trak(), f.mvex())
}

func (f *Fragmenter) mvhd() []byte {
	return fullBox("mvhd", 0, 0,
		u32(0), // creation_time — zero rather than now(), so the same
		u32(0), // modification_time  input always produces the same bytes
		u32(f.timescale),
		u32(0),          // duration: 0 for fragmented, the fragments carry it
		u32(0x00010000), // rate 1.0
		u16(0x0100),     // volume 1.0 (a video-only file still declares it)
		u16(0),          // reserved
		u32(0), u32(0),  // reserved
		unityMatrix(),
		make([]byte, 24),    // pre_defined
		u32(videoTrackID+1), // next_track_ID
	)
}

// unityMatrix is the identity transformation matrix every non-rotated track
// carries (14496-12 §8.2.2.3), in 16.16 fixed point except the last row which is
// 2.30.
func unityMatrix() []byte {
	return []byte{
		0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0,
		0, 0, 0, 0, 0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0,
		0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x00, 0x00, 0x00,
	}
}

func (f *Fragmenter) trak() []byte {
	return box("trak", f.tkhd(), f.mdia())
}

func (f *Fragmenter) tkhd() []byte {
	// flags 0x000007 = track_enabled | track_in_movie | track_in_preview.
	// Without track_enabled a player is entitled to ignore the track entirely,
	// which presents as a file that plays silently for its full duration showing
	// nothing — a failure that looks like a black camera rather than a bad file.
	return fullBox("tkhd", 0, 0x000007,
		u32(0), u32(0), // creation, modification
		u32(videoTrackID),
		u32(0),         // reserved
		u32(0),         // duration — fragmented
		u32(0), u32(0), // reserved
		u16(0), // layer
		u16(0), // alternate_group
		u16(0), // volume — 0 for video
		u16(0), // reserved
		unityMatrix(),
		// width and height are 16.16 fixed point here, unlike the integer
		// fields in the sample entry. The SPS's cropped dimensions, so the
		// display size matches the coded picture minus encoder padding.
		u32(uint32(f.params.Width)<<16),
		u32(uint32(f.params.Height)<<16),
	)
}

func (f *Fragmenter) mdia() []byte {
	return box("mdia", f.mdhd(), f.hdlr(), f.minf())
}

func (f *Fragmenter) mdhd() []byte {
	return fullBox("mdhd", 0, 0,
		u32(0), u32(0), // creation, modification
		u32(f.timescale),
		u32(0),      // duration — fragmented
		u16(0x55c4), // language: "und" packed as 5-bit offsets from 0x60
		u16(0),      // pre_defined
	)
}

func (f *Fragmenter) hdlr() []byte {
	return fullBox("hdlr", 0, 0,
		u32(0),           // pre_defined
		[]byte("vide"),   // handler_type
		make([]byte, 12), // reserved
		[]byte("VideoHandler\x00"),
	)
}

func (f *Fragmenter) minf() []byte {
	return box("minf", f.vmhd(), f.dinf(), f.stbl())
}

func (f *Fragmenter) vmhd() []byte {
	// flags must be 1 (14496-12 §12.1.2.1); a zero there is a spec violation
	// some demuxers reject outright.
	return fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0))
}

func (f *Fragmenter) dinf() []byte {
	// A dref with one self-contained 'url ' entry: flag 1 means the media is in
	// this file rather than at an external URL. Omitting dinf entirely, or
	// leaving the flag clear, tells a player to go looking for the samples
	// somewhere else.
	url := fullBox("url ", 0, 1)
	dref := fullBox("dref", 0, 0, u32(1), url)
	return box("dinf", dref)
}

func (f *Fragmenter) stbl() []byte {
	// Every table is present and empty. They have to be: 14496-12 requires
	// stts, stsc, stsz and stco in a stbl, and a fragmented file keeps its
	// per-sample data in trun instead. A missing box here is not "no samples in
	// the moov", it is a malformed stbl.
	return box("stbl",
		f.stsd(),
		fullBox("stts", 0, 0, u32(0)),
		fullBox("stsc", 0, 0, u32(0)),
		fullBox("stsz", 0, 0, u32(0), u32(0)),
		fullBox("stco", 0, 0, u32(0)),
	)
}

func (f *Fragmenter) stsd() []byte {
	return fullBox("stsd", 0, 0, u32(1), f.avc1())
}

func (f *Fragmenter) avc1() []byte {
	var compressor [32]byte // a length-prefixed fixed 32-byte Pascal string
	return box("avc1",
		make([]byte, 6), // reserved
		u16(1),          // data_reference_index — the dref entry above
		u16(0), u16(0),  // pre_defined, reserved
		make([]byte, 12), // pre_defined
		// Integer luma samples here, not fixed point — the one place in the file
		// where these fields are not 16.16, and a rich source of files that
		// declare a 65536-pixel-wide picture.
		u16(uint16(f.params.Width)),
		u16(uint16(f.params.Height)),
		u32(0x00480000), // horizresolution 72 dpi
		u32(0x00480000), // vertresolution 72 dpi
		u32(0),          // reserved
		u16(1),          // frame_count
		compressor[:],
		u16(0x0018), // depth
		u16(0xffff), // pre_defined
		f.avcC(),
	)
}

// avcC is the AVCDecoderConfigurationRecord (14496-15 §5.3.3.1): the parameter
// sets a decoder needs before the first sample, plus the profile/level triple
// copied verbatim from the SPS.
func (f *Fragmenter) avcC() []byte {
	p := []byte{
		1, // configurationVersion
		f.params.ProfileIDC,
		f.params.ConstraintFlags,
		f.params.LevelIDC,
		// Six reserved bits set, then lengthSizeMinusOne. This byte is the
		// contract with mdat: 0xff declares 4-byte length prefixes, and writing
		// 0xfd (2-byte) here while emitting 4-byte prefixes yields a file whose
		// every sample is read at the wrong offset.
		0xf8 | (avcLengthSize - 1),
		// Three reserved bits set, then numOfSequenceParameterSets in five.
		0xe0 | 1,
	}
	p = append(p, u16(uint16(len(f.sps)))...)
	p = append(p, f.sps...)
	p = append(p, 1) // numOfPictureParameterSets
	p = append(p, u16(uint16(len(f.pps)))...)
	p = append(p, f.pps...)
	return box("avcC", p)
}

func (f *Fragmenter) mvex() []byte {
	// trex supplies the defaults a trun may omit. Zeroes for duration and size
	// because this writer always writes both per sample — a default that
	// disagreed with the explicit value would be read differently by players
	// that prefer one over the other.
	trex := fullBox("trex", 0, 0,
		u32(videoTrackID),
		u32(1), // default_sample_description_index
		u32(0), // default_sample_duration
		u32(0), // default_sample_size
		u32(0), // default_sample_flags
	)
	return box("mvex", trex)
}

// sampleFlags renders the 32-bit sample_flags word (14496-12 §8.8.3.1).
//
// Field order from the MSB: reserved(4), is_leading(2), sample_depends_on(2),
// sample_is_depended_on(2), sample_has_redundancy(2), sample_padding_value(3),
// sample_is_non_sync_sample(1), sample_degradation_priority(16).
func sampleFlags(sync bool) uint32 {
	if sync {
		// sample_depends_on = 2, "does not depend on others" — an I picture.
		return 2 << 24
	}
	// sample_depends_on = 1, "depends on others", and the non-sync bit set. Both
	// are needed: a player seeking uses the non-sync bit, and a player deciding
	// what it may drop uses depends_on.
	return 1<<24 | 1<<16
}

func (f *Fragmenter) moof(baseTS uint64, samples []Sample, sizes []uint32, dataOffset int32) []byte {
	mfhd := fullBox("mfhd", 0, 0, u32(f.seq))

	// tfhd flags 0x020000 = default-base-is-moof. Without it, sample offsets are
	// relative to the start of the FILE, which for a fragment appended to a
	// growing recording or handed to MSE in isolation is not a position anything
	// can compute. This single flag is the difference between a fragment that is
	// independently playable and one that is only meaningful in the file it was
	// first written to.
	tfhd := fullBox("tfhd", 0, 0x020000, u32(videoTrackID))

	// Version 1 tfdt: baseMediaDecodeTime as 64 bits. At 90 kHz a 32-bit field
	// wraps after about 13 hours, and a continuous recorder is precisely the
	// thing that runs longer than that — after which the timeline jumps
	// backwards and a player either stalls or seeks to the start.
	tfdt := fullBox("tfdt", 1, 0, u64(baseTS))

	// trun flags: data-offset-present | sample-duration-present |
	// sample-size-present | sample-flags-present | sample-composition-time-
	// offsets-present.
	const trunFlags = 0x000001 | 0x000100 | 0x000200 | 0x000400 | 0x000800
	entries := make([]byte, 0, len(samples)*16)
	for i, s := range samples {
		entries = append(entries, u32(s.Duration)...)
		entries = append(entries, u32(sizes[i])...)
		entries = append(entries, u32(sampleFlags(s.IsSync))...)
		// Version 1 makes this field signed, which is why version 1 is used even
		// when every offset is zero: switching versions with the content would
		// mean two code paths, and the negative case is the one that only shows
		// up on B-frame streams from cameras nobody tested against.
		entries = append(entries, u32(uint32(s.CompositionOffset))...)
	}
	trun := fullBox("trun", 1, trunFlags,
		u32(uint32(len(samples))),
		u32(uint32(dataOffset)),
		entries,
	)

	traf := box("traf", tfhd, tfdt, trun)
	return box("moof", mfhd, traf)
}
