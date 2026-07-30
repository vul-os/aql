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
	blob, err := json.MarshalIndent(expected, "", "  ")
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
