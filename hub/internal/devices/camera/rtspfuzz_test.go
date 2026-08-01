package camera

import (
	"bufio"
	"strings"
	"testing"
)

// The RTSP text protocol, fuzzed.
//
// # Why these two and not the depacketizer
//
// h264_test.go already fuzzes the RTP payload path (FuzzDepacketizerPush,
// FuzzDepacketizerSequence). What had no coverage is the layer above it: the
// RTSP response reader and the SDP parser, which is where a camera's bytes
// FIRST become structure. Both take text straight off the socket, before
// anything has decided the peer is behaving.
//
// The threat is not an attacker on the internet — a camera is on the LAN and
// the hub dials it. It is a camera that is cheap, old, or lying: a firmware
// that emits a Content-Length it does not honour, an SDP with a truncated `m=`
// line, a status line with no status. A parser that panics on any of those
// takes the hub down, and the hub is what opens the gate.
//
// # What these assert, and why so little
//
// Mostly that nothing panics, plus the few invariants the code makes explicit.
// That is deliberate. todo records two fuzz assertions in this repository that
// were wrong BEFORE the code was — one forbade messages alongside an error, the
// other compared numbers by spelling so that canonicalising `0e00` to `0`, which
// is exactly correct, read as corruption. A property assertion is a claim about
// the spec and deserves the same scepticism as the code, so these claim only
// what the implementation states in as many words.

func FuzzReadRTSPResponse(f *testing.F) {
	f.Add("RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n")
	f.Add("RTSP/1.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm=\"x\", nonce=\"y\"\r\n\r\n")
	f.Add("RTSP/1.0 200 OK\r\nContent-Length: 4\r\n\r\nv=0\n")
	// The shapes that are meant to be refused rather than parsed.
	f.Add("HTTP/1.1 200 OK\r\n\r\n")
	f.Add("RTSP/1.0\r\n\r\n")
	f.Add("RTSP/1.0 notanumber OK\r\n\r\n")
	f.Add("RTSP/1.0 200 OK\r\nContent-Length: 99999999\r\n\r\n")
	f.Add("")

	f.Fuzz(func(t *testing.T, raw string) {
		br := bufio.NewReader(strings.NewReader(raw))
		resp, err := readRTSPResponse(br)
		if err != nil {
			// A refusal is always allowed. The only thing that would be wrong
			// is returning a usable response alongside one, which is the exact
			// mistake one of this repository's earlier fuzz assertions made in
			// reverse — so it is asserted here rather than assumed.
			if resp.status != 0 || resp.body != "" {
				t.Fatalf("error %v returned with a populated response (status %d, %d body bytes)",
					err, resp.status, len(resp.body))
			}
			return
		}

		// The body is bounded by rtspMaxResponseBytes — a ceiling that exists so
		// a camera cannot make the hub allocate arbitrarily by declaring a
		// Content-Length it never sends.
		//
		// This used to also assert status != 0, and that assertion was WRONG,
		// which the fuzzer found in four hundredths of a second: "RTSP/ 0\n\n"
		// splits into ["RTSP/", "0"], passes the RTSP/ prefix check, and Atoi
		// returns a legitimate zero. I had conflated "no status parsed" with
		// "status parsed as zero".
		//
		// The code is right and the assertion was not. Every caller requires
		// 2xx — `resp.status < 200 || resp.status > 299` is an error, and the
		// two SETUP paths demand exactly 200 — so a nonsense status line is
		// refused one layer up. Tightening readRTSPResponse to reject it as
		// well would put the same rule in two places, and this package's own
		// comments call that out: "two conditions where one is unreachable is a
		// guard that looks doubly held and is not".
		//
		// Third time a fuzz assertion in this repository has been wrong before
		// the code was. todo records the other two.
		if len(resp.body) > rtspMaxResponseBytes {
			t.Fatalf("body of %d bytes exceeds the %d-byte ceiling the reader enforces",
				len(resp.body), rtspMaxResponseBytes)
		}

		// The Session value goes back out as a header LINE — describeAndProbe
		// sends "Session: "+session on both PLAY and TEARDOWN, and
		// rtspExchangeExtra writes that verbatim followed by CRLF. That is the
		// same shape as the control-attribute injection this file found in
		// parseSDP, one layer over: text the camera chose, interpolated into a
		// message the hub composes.
		//
		// Asked of the fuzzer rather than reasoned about, and then verified
		// directly: 1.7M executions found nothing, and feeding
		// "Session: a\rb" by hand shows why. net/textproto REFUSES the line —
		// "malformed MIME header line" — and readRTSPResponse propagates that,
		// so the whole response is rejected and no session value exists.
		//
		// That is the difference between this and the parseSDP bug, and it is
		// the useful part. The header layer delegates to a parser that
		// VALIDATES; the SDP body is split on "\n" by hand, with nothing
		// checking what the pieces contain. The injection was exactly where the
		// code parsed text itself.
		//
		// The assertion stays because that safety is inherited rather than
		// stated: a future reader that stops using textproto, or reads headers
		// itself for speed, silently takes it away.
		if sid := sessionID(resp.header.Get("Session")); strings.ContainsFunc(sid, isCtl) {
			t.Fatalf("session id %q carries a control character and is written "+
				"into a request header verbatim", sid)
		}
	})
}

func FuzzParseSDP(f *testing.F) {
	f.Add("v=0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:trackID=1\r\n")
	f.Add("m=audio 0 RTP/AVP 0\r\n")
	// Truncations and malformations a cheap camera actually emits.
	f.Add("m=\r\n")
	f.Add("m")
	f.Add("=\n=\n=")
	f.Add("a=control:\r\nm=video\r\n")
	f.Add("m=video 0 RTP/AVP 96\na=fmtp:96 sprop-parameter-sets=,\n")
	f.Add("")

	f.Fuzz(func(t *testing.T, body string) {
		media := parseSDP(body)

		// Every description this returns must have come from an `m=` line, so
		// there cannot be more of them than there are lines. Weak on purpose:
		// the parser's contract is what it fills in, not how, and a tighter
		// claim here would be inventing a spec for it to violate.
		if len(media) > strings.Count(body, "\n")+1 {
			t.Fatalf("returned %d media descriptions from %d line(s)",
				len(media), strings.Count(body, "\n")+1)
		}
		for _, m := range media {
			// Control is used to build a SETUP URL. An entry carrying a newline
			// would split a request in two, which is the one structural
			// property worth asserting about text taken from a camera.
			if strings.ContainsAny(m.Control, "\r\n") {
				t.Fatalf("control %q carries a line break, which would split an RTSP request", m.Control)
			}
		}
	})
}
