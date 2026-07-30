package camera

import (
	"encoding/base64"
	"strings"
	"testing"
)

// sprop-parameter-sets handling (RFC 6184 §8.1).
//
// The SPS bytes here are the same 320x240 baseline vector sps_test.go derives
// field by field, base64-encoded. Reusing it rather than pasting a captured
// fmtp string from a datasheet is deliberate: a captured string would let this
// file assert a resolution nobody in this repository can check, and the point
// of these tests is the plumbing between the SDP attribute and ParseSPS, not
// the parse itself — which sps_test.go covers against the standard.
func testSPS320x240(t *testing.T) []byte {
	t.Helper()
	body := bits(t, ueBits(0)+ // seq_parameter_set_id
		ueBits(0)+ // log2_max_frame_num_minus4
		ueBits(0)+ // pic_order_cnt_type
		ueBits(0)+ // log2_max_pic_order_cnt_lsb_minus4
		ueBits(1)+ // max_num_ref_frames
		"0"+ // gaps_in_frame_num_value_allowed_flag
		ueBits(19)+ // -> 320 wide
		ueBits(14)+ // -> 240 high
		"1"+"1"+"0"+"0")
	return spsNAL(66, 0x00, 30, body)
}

// A minimal PPS: nal_unit_type 8 and one byte of payload. Never parsed, only
// skipped past — its presence is what makes the ordering test meaningful.
func testPPS() []byte { return []byte{0x68, 0xce, 0x3c, 0x80} }

func sdpWithFmtp(fmtp string) string {
	return strings.Join([]string{
		"v=0",
		"o=- 0 0 IN IP4 127.0.0.1",
		"s=Stream",
		"m=video 0 RTP/AVP 96",
		"a=rtpmap:96 H264/90000",
		"a=control:trackID=1",
		fmtp,
		"",
	}, "\r\n")
}

// The list has no type tags, so the NAL header inside each element is the only
// thing identifying the SPS — and cameras that put the PPS first exist. A parser
// that takes the first element reports a PPS's bytes as a resolution.
func TestSpropParameterSetsFindsTheSPSRegardlessOfOrder(t *testing.T) {
	sps := base64.StdEncoding.EncodeToString(testSPS320x240(t))
	pps := base64.StdEncoding.EncodeToString(testPPS())

	for _, tc := range []struct {
		name  string
		sprop string
	}{
		{"SPS first", sps + "," + pps},
		{"PPS first", pps + "," + sps},
		{"SPS alone", sps},
		{"with surrounding spaces", " " + pps + " , " + sps + " "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			media := parseSDP(sdpWithFmtp("a=fmtp:96 packetization-mode=1;sprop-parameter-sets=" + tc.sprop))
			if len(media) != 1 {
				t.Fatalf("parsed %d media descriptions, want 1", len(media))
			}
			m := media[0]
			if m.ParametersErr != "" {
				t.Fatalf("ParametersErr = %q, want empty", m.ParametersErr)
			}
			if m.Parameters == nil {
				t.Fatal("Parameters is nil; the SPS in the list was not found")
			}
			if m.Parameters.Width != 320 || m.Parameters.Height != 240 {
				t.Errorf("got %dx%d, want 320x240", m.Parameters.Width, m.Parameters.Height)
			}
		})
	}
}

// The base64 payload contains '=' padding, so splitting the parameter list on
// '=' rather than on the first '=' truncates it. This is the mistake that makes
// a parser work on some cameras and not others, since whether padding appears
// depends on the parameter set's length.
func TestSpropParameterSetsSurvivesBase64Padding(t *testing.T) {
	raw := testSPS320x240(t)
	enc := base64.StdEncoding.EncodeToString(raw)
	if !strings.HasSuffix(enc, "=") {
		// Pad the SPS to a length whose encoding needs padding, so the test is
		// actually exercising the case it names.
		raw = append(raw, 0x80) // a trailing byte after rbsp_trailing_bits
		enc = base64.StdEncoding.EncodeToString(raw)
	}
	if !strings.HasSuffix(enc, "=") {
		t.Skip("could not construct a padded encoding for this vector")
	}
	media := parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=" + enc + ";packetization-mode=1"))
	if media[0].Parameters == nil {
		t.Fatalf("Parameters is nil for a padded base64 value (%q); the '=' was treated as a separator", enc)
	}
}

func TestSpropParameterSetsDistinguishesAbsentFromBroken(t *testing.T) {
	t.Run("no fmtp line at all", func(t *testing.T) {
		media := parseSDP(strings.Join([]string{
			"m=video 0 RTP/AVP 96", "a=rtpmap:96 H264/90000", "",
		}, "\r\n"))
		if media[0].Parameters != nil || media[0].ParametersErr != "" {
			t.Errorf("Parameters=%v Err=%q; a camera that advertised nothing is not broken",
				media[0].Parameters, media[0].ParametersErr)
		}
	})

	t.Run("fmtp without sprop-parameter-sets", func(t *testing.T) {
		media := parseSDP(sdpWithFmtp("a=fmtp:96 packetization-mode=1"))
		if media[0].Parameters != nil || media[0].ParametersErr != "" {
			t.Errorf("Parameters=%v Err=%q, want both empty", media[0].Parameters, media[0].ParametersErr)
		}
	})

	t.Run("only a PPS offered", func(t *testing.T) {
		// Legal: parameter sets may arrive in-band instead. Not an error.
		pps := base64.StdEncoding.EncodeToString(testPPS())
		media := parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=" + pps))
		if media[0].Parameters != nil {
			t.Error("a PPS was parsed as a sequence parameter set")
		}
		if media[0].ParametersErr != "" {
			t.Errorf("ParametersErr = %q; offering only a PPS is legal", media[0].ParametersErr)
		}
	})

	t.Run("not base64", func(t *testing.T) {
		media := parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=!!!not base64!!!"))
		if media[0].Parameters != nil {
			t.Error("Parameters set from a value that is not base64")
		}
		if media[0].ParametersErr == "" {
			t.Error("ParametersErr is empty; a camera that advertised something " +
				"unreadable must not look like one that advertised nothing")
		}
	})

	t.Run("valid base64, unparseable SPS", func(t *testing.T) {
		// nal_unit_type 7 so it is taken for an SPS, then truncated.
		media := parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=" +
			base64.StdEncoding.EncodeToString([]byte{0x67, 0x42})))
		if media[0].Parameters != nil {
			t.Error("Parameters set from a truncated SPS")
		}
		if media[0].ParametersErr == "" {
			t.Error("ParametersErr is empty for an SPS that could not be parsed")
		}
	})

	t.Run("a good SPS beside a broken one is not an error", func(t *testing.T) {
		broken := base64.StdEncoding.EncodeToString([]byte{0x67, 0x42})
		good := base64.StdEncoding.EncodeToString(testSPS320x240(t))
		media := parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=" + broken + "," + good))
		if media[0].Parameters == nil {
			t.Fatal("Parameters is nil; a readable SPS later in the list was not used")
		}
		if media[0].ParametersErr != "" {
			t.Errorf("ParametersErr = %q, but a usable parameter set was found", media[0].ParametersErr)
		}
	})
}

func TestSpropParameterSetsKeyIsCaseInsensitive(t *testing.T) {
	// SDP attribute names are case-insensitive (RFC 4566 §9), and cameras vary.
	sps := base64.StdEncoding.EncodeToString(testSPS320x240(t))
	media := parseSDP(sdpWithFmtp("a=fmtp:96 SPROP-Parameter-Sets=" + sps))
	if media[0].Parameters == nil {
		t.Error("Parameters is nil for a differently-cased attribute name")
	}
}

func TestSummaryReportsTheEncodedResolution(t *testing.T) {
	sps := base64.StdEncoding.EncodeToString(testSPS320x240(t))
	withSPS := StreamInfo{
		Media:    parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=" + sps)),
		AuthUsed: "digest",
	}
	got := withSPS.Summary()
	if !strings.Contains(got, "320x240") {
		t.Errorf("Summary() = %q, want it to name the encoded resolution", got)
	}

	// And no invented resolution when the camera advertised none: "0x0" would
	// state a fact nobody claimed.
	without := StreamInfo{Media: parseSDP(sdpWithFmtp("a=fmtp:96 packetization-mode=1"))}
	if strings.Contains(without.Summary(), "0x0") {
		t.Errorf("Summary() = %q for a camera that advertised no parameter set", without.Summary())
	}
}

func TestVideoResolutionReportsWhetherItIsKnown(t *testing.T) {
	sps := base64.StdEncoding.EncodeToString(testSPS320x240(t))
	w, h, known := StreamInfo{Media: parseSDP(sdpWithFmtp("a=fmtp:96 sprop-parameter-sets=" + sps))}.VideoResolution()
	if !known || w != 320 || h != 240 {
		t.Errorf("got %dx%d known=%v, want 320x240 known=true", w, h, known)
	}

	_, _, known = StreamInfo{Media: parseSDP(sdpWithFmtp("a=fmtp:96 packetization-mode=1"))}.VideoResolution()
	if known {
		t.Error("known=true for a stream with no advertised parameter set")
	}

	// An audio-only session must not report a video resolution.
	audio := parseSDP(strings.Join([]string{"m=audio 0 RTP/AVP 0", "a=rtpmap:0 PCMU/8000", ""}, "\r\n"))
	if _, _, known = (StreamInfo{Media: audio}).VideoResolution(); known {
		t.Error("known=true for an audio-only session")
	}
}
