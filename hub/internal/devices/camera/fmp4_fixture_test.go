package camera

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// Fixture generator for the browser conformance check.
//
// Every test in fmp4_test.go compares this writer's output against offsets
// computed in this repository, from this repository's reading of ISO/IEC
// 14496-12. That is worth having and it is circular: the writer and the tests
// share one understanding, so a misreading of the standard satisfies both. The
// six tampers on fmp4.go prove the tests are sensitive to changes in the writer,
// not that either agrees with a demuxer.
//
// So the output also goes to Chromium. e2e-browser/fmp4.spec.ts feeds these
// bytes to a real MediaSource, which parses the boxes, reads the SPS out of
// avcC to derive the coded size, and refuses anything it dislikes — an
// implementation written by people who have met every camera, and one nobody
// here can accidentally agree with.
//
// Writing fixtures from a test rather than shipping a `main` keeps the generator
// out of the built product: nothing in the hub binary exists to serve a test.
// The env var is what makes it opt-in — an ordinary `go test ./...` skips it, so
// no run has a side effect on the filesystem it was not asked for.
const fixtureDirEnv = "AQL_FMP4_FIXTURE_DIR"

func TestWriteBrowserFixture(t *testing.T) {
	dir := os.Getenv(fixtureDirEnv)
	if dir == "" {
		t.Skipf("set %s to write browser fixtures", fixtureDirEnv)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	f, err := NewFragmenter(testSPS320x240(t), testPPSNAL(), H264ClockRate)
	if err != nil {
		t.Fatal(err)
	}

	write := func(name string, b []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("init.mp4", f.InitSegment())

	// Three fragments of five samples each at 15 fps (6000 ticks of the 90 kHz
	// clock per frame), the first sample of each a sync sample. The durations are
	// what the browser reports back as a buffered range, so they are the part of
	// the check that proves trun and tfdt were read rather than merely accepted.
	const perFrame = 6000
	const samplesPerFragment = 5
	for i := 0; i < 3; i++ {
		samples := make([]Sample, samplesPerFragment)
		for j := range samples {
			// Payload bytes are not a real picture — see the package comment.
			// What is real is the framing: a NAL header byte whose type says IDR
			// or non-IDR slice, then bytes. Chromium's container parser reads the
			// length prefixes and the NAL headers; it does not decode until
			// playback, which is why an undecodable payload still exercises
			// everything this fixture is for.
			nal := []byte{0x41, byte(i), byte(j), 0x00, 0x11, 0x22}
			sync := j == 0
			if sync {
				nal[0] = 0x65 // IDR slice
			}
			samples[j] = Sample{NALUnits: [][]byte{nal}, Duration: perFrame, IsSync: sync}
		}
		frag, err := f.Fragment(samples)
		if err != nil {
			t.Fatal(err)
		}
		write("frag"+string(rune('0'+i))+".m4s", frag)
	}

	// What the spec should expect, derived from the same constants that produced
	// the bytes rather than restated in TypeScript. A hand-written expectation on
	// the other side would be a second source of truth for the duration, and the
	// two would drift the first time a constant here changed.
	//
	// The dimensions come from Params(), not from the literals in the SPS vector,
	// so the file states what the writer actually put in the container.
	const fragments = 3
	totalTicks := uint64(fragments * samplesPerFragment * perFrame)
	expected := struct {
		Width              int     `json:"width"`
		Height             int     `json:"height"`
		Fragments          int     `json:"fragments"`
		SamplesPerFragment int     `json:"samplesPerFragment"`
		Timescale          uint32  `json:"timescale"`
		DurationSeconds    float64 `json:"durationSeconds"`
		// Codec is the MSE type string, assembled from the profile/constraint/
		// level triple in avcC. Chromium checks it against what it finds in the
		// init segment, so a wrong one is itself a failure worth catching.
		Codec string `json:"codec"`
	}{
		Width:              f.Params().Width,
		Height:             f.Params().Height,
		Fragments:          fragments,
		SamplesPerFragment: samplesPerFragment,
		Timescale:          H264ClockRate,
		DurationSeconds:    float64(totalTicks) / float64(H264ClockRate),
		Codec: fmt.Sprintf("avc1.%02X%02X%02X",
			f.Params().ProfileIDC, f.Params().ConstraintFlags, f.Params().LevelIDC),
	}
	// A second fixture built the way a camera would actually drive this: RTP
	// packets through the Assembler, whose access units go to the same
	// Fragmenter — and whose parameter sets come from the stream in-band rather
	// than from the test's own variables.
	//
	// This is the part worth putting in front of a browser. The muxer fixture
	// above proves the container is valid when handed correct access units. This
	// one proves the chain produces correct access units, which is the claim
	// nothing could check while the middle of it did not exist. If the Assembler
	// mis-grouped pictures, dropped a start code, or got a duration wrong,
	// Chromium would refuse the result or report the wrong timeline.
	chainInit, chainFrag, chainSamples, chainTicks := buildChainFixture(t)
	write("chain-init.mp4", chainInit)
	write("chain0.m4s", chainFrag)

	blob, err := json.MarshalIndent(struct {
		Width              int     `json:"width"`
		Height             int     `json:"height"`
		Fragments          int     `json:"fragments"`
		SamplesPerFragment int     `json:"samplesPerFragment"`
		Timescale          uint32  `json:"timescale"`
		DurationSeconds    float64 `json:"durationSeconds"`
		Codec              string  `json:"codec"`
		ChainSamples       int     `json:"chainSamples"`
		ChainDuration      float64 `json:"chainDurationSeconds"`
	}{
		Width: expected.Width, Height: expected.Height,
		Fragments: expected.Fragments, SamplesPerFragment: expected.SamplesPerFragment,
		Timescale: expected.Timescale, DurationSeconds: expected.DurationSeconds,
		Codec:        expected.Codec,
		ChainSamples: chainSamples,
		// The browser reports this back as a buffered range, so it is the
		// assertion that proves the Assembler's durations reached the container
		// intact rather than merely being accepted.
		ChainDuration: float64(chainTicks) / float64(H264ClockRate),
	}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	write("expected.json", append(blob, '\n'))

	if f.DecodeTime() != totalTicks {
		t.Fatalf("decode time %d disagrees with the %d ticks the fixture claims",
			f.DecodeTime(), totalTicks)
	}
	if f.Sequence() != fragments {
		t.Fatalf("wrote %d fragments but the sequence counter says %d", fragments, f.Sequence())
	}
}

// buildChainFixture drives the whole pipeline: RTP packets in, one playable
// fragment out, with the parameter sets taken from the stream rather than from
// the test.
//
// The packet layout is accessunit_test.go's rtpPacket, whose RFC 3550 header
// fields are written out there. Nothing here hand-assembles an access unit —
// that is the point, since a fixture that skipped the Assembler would check the
// muxer twice and the chain not at all.
func buildChainFixture(t *testing.T) (init, frag []byte, samples int, ticks uint32) {
	t.Helper()
	const perFrame = 6000 // 15 fps on the 90 kHz clock
	const pictures = 6

	a := NewAssembler()
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

	// Parameter sets arrive in-band, as a camera advertising no
	// sprop-parameter-sets sends them.
	push(0, false, testSPS320x240(t))
	push(0, false, testPPSNAL())

	var units []AccessUnit
	for i := 0; i < pictures; i++ {
		ts := uint32(i) * perFrame
		// Every picture is two NAL units at one timestamp, so the fixture
		// exercises grouping rather than a one-packet-per-picture stream where
		// grouping is trivially correct. Marker on the last packet of each.
		if i%3 == 0 {
			units = append(units, push(ts, false, nalIDR(byte(i)))...)
		} else {
			units = append(units, push(ts, false, nalNonIDR(byte(i)))...)
		}
		units = append(units, push(ts, true, nalSEI())...)
	}
	// The final picture is still open — its successor never arrived — so it is
	// left out rather than flushed with an invented duration. Samples() refuses a
	// zero-duration unit, which is what makes that a deliberate choice here
	// rather than an oversight.
	if len(units) != pictures-1 {
		t.Fatalf("assembled %d pictures from %d, want %d", len(units), pictures, pictures-1)
	}
	if a.MarkerDisagreements() != 0 {
		t.Fatalf("the fixture's own sender disagrees with its marker bits %d times",
			a.MarkerDisagreements())
	}

	f, err := NewFragmenter(a.SPS(), a.PPS(), H264ClockRate)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Samples(units)
	if err != nil {
		t.Fatal(err)
	}
	frag, err = f.Fragment(s)
	if err != nil {
		t.Fatal(err)
	}
	// The expected duration comes from the INPUT — the packet timestamps this
	// function chose — not from the samples that came out.
	//
	// Summing the emitted durations was the first version and it made the browser
	// check unable to fail: a tamper halving every computed duration moved the
	// fixture and its own expectation together, and Chromium happily confirmed a
	// self-consistent lie. Deriving from the input is what makes the browser an
	// independent witness rather than an echo — it now compares the container
	// against the timestamps that went in.
	//
	// Nothing here asserts the two agree, deliberately. That assertion belongs in
	// accessunit_test.go, where the duration is checked against a literal; doing
	// it here as well would fail fixture generation and stop the browser from
	// ever seeing the discrepancy it exists to catch.
	return f.InitSegment(), frag, pictures - 1, (pictures - 1) * perFrame
}
