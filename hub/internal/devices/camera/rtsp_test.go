package camera

import (
	"bufio"
	"context"
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// A real RTSP server, because the alternative is shipping a probe that has
// never spoken to one.
//
// It speaks the actual message grammar — request line, CSeq, headers, body —
// rather than replaying canned bytes, so the probe's parsing, its digest
// computation and its 401 retry are genuinely exercised. It can also misbehave
// on request: that is where the interesting cases are.
type fakeRTSP struct {
	t  *testing.T
	ln net.Listener

	mu sync.Mutex
	// Media knobs. rtpPackets > 0 makes SETUP/PLAY succeed and stream that many
	// interleaved RTP packets; 0 makes them succeed and send nothing, which is
	// the failure the media probe exists to catch.
	rtpPackets int
	rtpPayload byte
	// rtpDropEvery makes the fake SKIP a sequence number every N packets
	// without sending it — a stream that is flowing and lossy, which is what a
	// camera on a weak link produces and what a packet counter alone reports
	// as healthy. The sequence number still advances, exactly as a real
	// sender's would; nothing here pretends the packet was never generated.
	rtpDropEvery int
	// rtpStartSeq seeds the sequence counter, so a test can start just below
	// the 16-bit wrap and watch it roll over.
	rtpStartSeq uint16
	setupStatus int
	playStatus  int
	sawSetup    bool
	sawPlay     bool
	sawTeardown bool
	// knobs
	requireAuth string // "", "digest", "basic"
	user, pass  string
	status      int    // override the DESCRIBE status
	sdp         string // body to return
	withQop     bool   // advertise qop=auth in the digest challenge
	serverName  string
	// observed
	requests   []string
	lastAuth   string
	lastCSeq   []string
	authTriesN int
}

const sampleSDP = `v=0
o=- 2890844526 2890842807 IN IP4 192.168.1.64
s=Media Presentation
m=video 0 RTP/AVP 96
a=rtpmap:96 H264/90000
a=control:rtsp://192.168.1.64/Streaming/Channels/101/trackID=1
m=audio 0 RTP/AVP 0
a=rtpmap:0 PCMU/8000
a=control:rtsp://192.168.1.64/Streaming/Channels/101/trackID=2
`

func newFakeRTSP(t *testing.T) *fakeRTSP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeRTSP{t: t, ln: ln, status: 200, sdp: sampleSDP, serverName: "FakeCam/1.0"}
	go f.accept()
	t.Cleanup(func() { _ = ln.Close() })
	return f
}

func (f *fakeRTSP) url(path string) string {
	return "rtsp://" + f.ln.Addr().String() + path
}

func (f *fakeRTSP) set(fn func(*fakeRTSP)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *fakeRTSP) accept() {
	for {
		c, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.serve(c)
	}
}

func (f *fakeRTSP) serve(c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return
		}
		req := strings.TrimSpace(line)
		cseq, auth := "", ""
		for {
			h, err := br.ReadString('\n')
			if err != nil {
				return
			}
			h = strings.TrimSpace(h)
			if h == "" {
				break
			}
			k, v, _ := strings.Cut(h, ":")
			switch strings.ToLower(strings.TrimSpace(k)) {
			case "cseq":
				cseq = strings.TrimSpace(v)
			case "authorization":
				auth = strings.TrimSpace(v)
			}
		}

		f.mu.Lock()
		f.requests = append(f.requests, req)
		f.lastCSeq = append(f.lastCSeq, cseq)
		if auth != "" {
			f.lastAuth = auth
			f.authTriesN++
		}
		need, user, pass := f.requireAuth, f.user, f.pass
		status, sdp, withQop, server := f.status, f.sdp, f.withQop, f.serverName
		f.mu.Unlock()

		if need != "" && auth == "" {
			challenge := `Basic realm="cam"`
			if need == "digest" {
				challenge = `Digest realm="cam", nonce="dcd98b7102dd2f0e"`
				if withQop {
					challenge = `Digest realm="cam", nonce="dcd98b7102dd2f0e", qop="auth"`
				}
			}
			fmt.Fprintf(c, "RTSP/1.0 401 Unauthorized\r\nCSeq: %s\r\nWWW-Authenticate: %s\r\n\r\n",
				cseq, challenge)
			continue
		}
		if need == "digest" && auth != "" && !digestOK(auth, user, pass, req) {
			fmt.Fprintf(c, "RTSP/1.0 401 Unauthorized\r\nCSeq: %s\r\n\r\n", cseq)
			continue
		}

		// The media methods. Handled after auth so the probe's per-method
		// digest is exercised on SETUP and PLAY too, not only on DESCRIBE.
		if m := strings.Fields(req); len(m) > 0 {
			switch m[0] {
			case "SETUP", "PLAY", "TEARDOWN":
				f.serveMedia(c, m[0], cseq)
				continue
			}
		}

		if status != 200 {
			fmt.Fprintf(c, "RTSP/1.0 %d Nope\r\nCSeq: %s\r\n\r\n", status, cseq)
			continue
		}
		fmt.Fprintf(c, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nServer: %s\r\n"+
			"Content-Type: application/sdp\r\nContent-Length: %d\r\n\r\n%s",
			cseq, server, len(sdp), sdp)
	}
}

// digestOK recomputes the digest the way a camera would, so the test asserts
// the probe's arithmetic rather than merely that it sent something.
func digestOK(auth, user, pass, requestLine string) bool {
	if !strings.HasPrefix(auth, "Digest ") {
		return false
	}
	p := parseChallengeParams(auth[len("Digest "):])
	parts := strings.Fields(requestLine)
	if len(parts) < 2 {
		return false
	}
	h := func(s string) string { x := md5.Sum([]byte(s)); return hex.EncodeToString(x[:]) }
	ha1 := h(user + ":" + p["realm"] + ":" + pass)
	// The METHOD from the request line, not a hardcoded DESCRIBE. Digest covers
	// method and URI, so a header computed for one cannot be replayed for
	// another — and this validator was written when DESCRIBE was the only
	// method, which made every correctly-signed SETUP look like a bad password.
	ha2 := h(parts[0] + ":" + p["uri"])
	var want string
	if p["qop"] != "" {
		want = h(ha1 + ":" + p["nonce"] + ":" + p["nc"] + ":" + p["cnonce"] + ":auth:" + ha2)
	} else {
		want = h(ha1 + ":" + p["nonce"] + ":" + ha2)
	}
	return p["response"] == want
}

// ── the tests ───────────────────────────────────────────────────────────────

func TestDescribeReadsWhatTheCameraStreams(t *testing.T) {
	srv := newFakeRTSP(t)
	info, err := Describe(context.Background(), srv.url("/Streaming/Channels/101"),
		Credential{}, time.Second)
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if len(info.Media) != 2 {
		t.Fatalf("got %d media streams, want video + audio: %+v", len(info.Media), info.Media)
	}
	if info.VideoCodec() != "H264" {
		t.Errorf("video codec = %q, want H264", info.VideoCodec())
	}
	if info.Media[1].Codec != "PCMU" {
		t.Errorf("audio codec = %q, want PCMU", info.Media[1].Codec)
	}
	if info.Media[0].PayloadType != 96 {
		t.Errorf("payload type = %d, want 96", info.Media[0].PayloadType)
	}
	if info.Media[0].Control == "" {
		t.Error("no control URL parsed; a SETUP would have nowhere to go")
	}
	if info.ServerHeader != "FakeCam/1.0" {
		t.Errorf("server = %q", info.ServerHeader)
	}
	if info.AuthUsed != "none" {
		t.Errorf("auth = %q, want none for a camera that demanded none", info.AuthUsed)
	}
}

// Cameras overwhelmingly want digest, and getting the arithmetic wrong reads as
// a credential failure — sending an operator to reset a password that is fine.
func TestDigestAuthIsComputedCorrectly(t *testing.T) {
	for _, qop := range []bool{false, true} {
		srv := newFakeRTSP(t)
		srv.set(func(f *fakeRTSP) {
			f.requireAuth, f.user, f.pass, f.withQop = "digest", "admin", "s3cret", qop
		})

		info, err := Describe(context.Background(), srv.url("/cam"),
			Credential{Username: "admin", Password: "s3cret"}, time.Second)
		if err != nil {
			t.Fatalf("qop=%v: %v", qop, err)
		}
		if info.AuthUsed != "digest" {
			t.Errorf("qop=%v: auth = %q, want digest", qop, info.AuthUsed)
		}
		// The unauthenticated probe first, then the authenticated retry.
		srv.set(func(f *fakeRTSP) {
			if len(f.requests) != 2 {
				t.Errorf("qop=%v: %d requests, want an unauthenticated probe then a retry",
					qop, len(f.requests))
			}
			if len(f.lastCSeq) == 2 && f.lastCSeq[0] == f.lastCSeq[1] {
				t.Errorf("qop=%v: the retry reused CSeq %q; RTSP requires it to increment",
					qop, f.lastCSeq[0])
			}
		})
	}
}

// A camera that advertises qop and receives a response without it answers 401
// again — which would be reported as a wrong password when it is a protocol
// mistake.
func TestQopChallengeGetsAQopResponse(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) {
		f.requireAuth, f.user, f.pass, f.withQop = "digest", "admin", "pw", true
	})
	if _, err := Describe(context.Background(), srv.url("/cam"),
		Credential{Username: "admin", Password: "pw"}, time.Second); err != nil {
		t.Fatalf("a qop=auth camera rejected the probe: %v", err)
	}
	srv.set(func(f *fakeRTSP) {
		for _, want := range []string{"qop=auth", "nc=", "cnonce="} {
			if !strings.Contains(f.lastAuth, want) {
				t.Errorf("the digest response omits %s: %s", want, f.lastAuth)
			}
		}
	})
}

// Basic is supported because some cameras offer nothing else — but an operator
// must be able to learn from the product that their password crossed the wire
// in cleartext.
func TestBasicAuthIsSupportedAndReported(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.requireAuth, f.user, f.pass = "basic", "u", "p" })

	info, err := Describe(context.Background(), srv.url("/cam"),
		Credential{Username: "u", Password: "p"}, time.Second)
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if info.AuthUsed != "basic" {
		t.Errorf("auth = %q; a camera taking a cleartext password must be reported "+
			"as doing so", info.AuthUsed)
	}
}

// The distinction that decides where an operator looks: the camera is up and
// said no, versus the camera is not there.
func TestWrongCredentialsAreDistinctFromUnreachable(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.requireAuth, f.user, f.pass = "digest", "admin", "right" })

	_, err := Describe(context.Background(), srv.url("/cam"),
		Credential{Username: "admin", Password: "wrong"}, time.Second)
	if err == nil {
		t.Fatal("a wrong password was accepted")
	}
	if !strings.Contains(err.Error(), "credentials") {
		t.Errorf("error does not identify a credential problem: %v", err)
	}

	// And an address nothing is listening on fails differently.
	_, err = Describe(context.Background(), "rtsp://127.0.0.1:1/cam", Credential{}, 300*time.Millisecond)
	if err == nil {
		t.Fatal("an unreachable camera reported success")
	}
	if strings.Contains(err.Error(), "credentials") {
		t.Errorf("an unreachable camera was reported as a credential problem: %v", err)
	}
}

// A 200 with no describable media is not a success. Reporting it as one tells
// an operator their camera works when nothing can play it.
func TestAnEmptyDescriptionIsAFailure(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.sdp = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=nothing\r\n" })

	_, err := Describe(context.Background(), srv.url("/cam"), Credential{}, time.Second)
	if err == nil {
		t.Fatal("a camera describing no media was reported as working")
	}
}

func TestNotFoundSaysTheStreamIsGone(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.status = 404 })
	_, err := Describe(context.Background(), srv.url("/gone"), Credential{}, time.Second)
	if err == nil || !strings.Contains(err.Error(), "no such stream") {
		t.Fatalf("404 reported as %v", err)
	}
}

// An RTSP URL routinely carries a password in its userinfo, and this value is
// logged and rendered. Leaking it there would put a camera password in the
// operator's log file.
func TestCredentialsInTheURLAreUsedButNeverEchoed(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.requireAuth, f.user, f.pass = "digest", "bob", "hunter2" })

	host := srv.ln.Addr().String()
	info, err := Describe(context.Background(),
		"rtsp://bob:hunter2@"+host+"/cam", Credential{}, time.Second)
	if err != nil {
		t.Fatalf("credentials in the URL were not used: %v", err)
	}
	if strings.Contains(info.URL, "hunter2") || strings.Contains(info.URL, "bob") {
		t.Fatalf("the reported URL carries credentials: %s", info.URL)
	}
	if strings.Contains(info.Summary(), "hunter2") {
		t.Fatal("the summary carries the password")
	}
}

// The probe must not hold a session. Cheap cameras support very few concurrent
// RTSP sessions, and one left open takes a slot from whatever is actually
// watching.
func TestTheProbeHoldsNoSession(t *testing.T) {
	srv := newFakeRTSP(t)
	if _, err := Describe(context.Background(), srv.url("/cam"), Credential{}, time.Second); err != nil {
		t.Fatal(err)
	}
	srv.set(func(f *fakeRTSP) {
		for _, r := range f.requests {
			if strings.HasPrefix(r, "SETUP") || strings.HasPrefix(r, "PLAY") {
				t.Errorf("the probe sent %q; it must describe and disconnect", r)
			}
		}
	})
}

func TestNonRTSPURLsAreRefusedBeforeDialing(t *testing.T) {
	for _, u := range []string{"http://cam/stream", "cam/stream", "rtsp://", ""} {
		if _, err := Describe(context.Background(), u, Credential{}, time.Second); err == nil {
			t.Errorf("%q was accepted", u)
		}
	}
}

func TestSDPParsingIgnoresWhatItDoesNotKnow(t *testing.T) {
	// A real camera's SDP carries fmtp, framerate, bandwidth and vendor
	// attributes. Decoding only what is used means new fields cannot break it.
	media := parseSDP("v=0\r\nm=video 0 RTP/AVP 96\r\n" +
		"b=AS:2048\r\na=rtpmap:96 H265/90000\r\n" +
		"a=fmtp:96 profile-level-id=1;sprop-vps=QAEMAf//\r\n" +
		"a=x-dimensions:1920,1080\r\na=control:trackID=1\r\n")
	if len(media) != 1 {
		t.Fatalf("got %d media, want 1", len(media))
	}
	if media[0].Codec != "H265" || media[0].Control != "trackID=1" {
		t.Errorf("parsed %+v", media[0])
	}
}

// serveMedia answers SETUP/PLAY/TEARDOWN and, on PLAY, writes real interleaved
// RTP frames: `$<channel><len16><12-byte RTP header + payload>`.
//
// The framing and the header are written from RFC 2326 §10.12 and RFC 3550 §5.1
// rather than copied from the client, so the counter is parsing a layout this
// file decided independently. That is as close to a cross-implementation check
// as is available without a camera — and it is why this probe stops at counting
// packets: the layers below here are specified tightly enough to serve
// faithfully, and H.264 depacketization is not.
func (f *fakeRTSP) serveMedia(c net.Conn, method, cseq string) {
	f.mu.Lock()
	n, pt := f.rtpPackets, f.rtpPayload
	dropEvery, startSeq := f.rtpDropEvery, f.rtpStartSeq
	setupStatus, playStatus := f.setupStatus, f.playStatus
	switch method {
	case "SETUP":
		f.sawSetup = true
	case "PLAY":
		f.sawPlay = true
	case "TEARDOWN":
		f.sawTeardown = true
	}
	f.mu.Unlock()

	if pt == 0 {
		pt = 96
	}
	switch method {
	case "SETUP":
		if setupStatus != 0 && setupStatus != 200 {
			fmt.Fprintf(c, "RTSP/1.0 %d No\r\nCSeq: %s\r\n\r\n", setupStatus, cseq)
			return
		}
		fmt.Fprintf(c, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: 12345678;timeout=60\r\n"+
			"Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n\r\n", cseq)
	case "TEARDOWN":
		fmt.Fprintf(c, "RTSP/1.0 200 OK\r\nCSeq: %s\r\n\r\n", cseq)
	case "PLAY":
		if playStatus != 0 && playStatus != 200 {
			fmt.Fprintf(c, "RTSP/1.0 %d No\r\nCSeq: %s\r\n\r\n", playStatus, cseq)
			return
		}
		fmt.Fprintf(c, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: 12345678\r\n\r\n", cseq)
		for i := 0; i < n; i++ {
			// The sequence number advances whether or not the packet is sent —
			// a dropped packet is one the receiver never sees, not one the
			// sender never numbered.
			seq := startSeq + uint16(i)
			if dropEvery > 0 && i%dropEvery == 0 && i != 0 {
				continue
			}
			payload := make([]byte, 12+20)
			payload[0] = 0x80 // version 2
			payload[1] = pt   // marker clear, payload type
			binary.BigEndian.PutUint16(payload[2:4], seq)
			binary.BigEndian.PutUint32(payload[4:8], uint32(i*3000))
			binary.BigEndian.PutUint32(payload[8:12], 0xDEADBEEF)

			frame := make([]byte, 0, 4+len(payload))
			frame = append(frame, '$', 0)
			frame = binary.BigEndian.AppendUint16(frame, uint16(len(payload)))
			frame = append(frame, payload...)
			if _, err := c.Write(frame); err != nil {
				return
			}
			// One RTCP frame on channel 1, which must NOT be counted as media.
			if i == 0 {
				rtcp := []byte{'$', 1, 0, 8, 0x80, 200, 0, 1, 0, 0, 0, 0}
				_, _ = c.Write(rtcp)
			}
		}
	}
}

// ── media-flow probe ────────────────────────────────────────────────────────

// The failure this whole probe exists to catch: a camera that DESCRIBES a
// perfectly good stream and then sends nothing. A dead encoder, a transport it
// will not really do, a firewall permitting control and dropping media. The
// operator's symptom is a black player and DESCRIBE told them all was well.
func TestACameraThatDescribesButNeverStreamsIsCaught(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 0 })

	info, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, time.Second, 300*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeMedia: %v", err)
	}
	if flow.Flowing() {
		t.Fatalf("reported media from a camera that sent none: %+v", flow)
	}
	// The description must survive — "described H264 and sent nothing" is the
	// diagnosis, and dropping half of it throws away the useful half.
	if info.VideoCodec() != "H264" {
		t.Errorf("the description was lost: %+v", info)
	}
	if !strings.Contains(flow.Summary(), "no media") {
		t.Errorf("summary = %q", flow.Summary())
	}
}

func TestMediaFlowCountsRealInterleavedFrames(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 25; f.rtpPayload = 96 })

	_, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, 2*time.Second, 600*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeMedia: %v", err)
	}
	if flow.Packets != 25 {
		t.Errorf("counted %d packets, want 25", flow.Packets)
	}
	// 12-byte header excluded from the byte total.
	if flow.Bytes != 25*20 {
		t.Errorf("counted %d payload bytes, want %d", flow.Bytes, 25*20)
	}
	if len(flow.PayloadTypes) != 1 || flow.PayloadTypes[0] != 96 {
		t.Errorf("payload types = %v, want [96]", flow.PayloadTypes)
	}
	if len(flow.SSRCs) != 1 {
		t.Errorf("SSRCs = %v, want exactly one source", flow.SSRCs)
	}
}

// RTCP on channel 1 is not media. Counting sender reports would inflate the
// answer and could make a silent stream look alive.
func TestRTCPIsNotCountedAsMedia(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 10 })

	_, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, 2*time.Second, 600*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	// The fake emits one RTCP frame alongside the first RTP packet.
	if flow.Packets != 10 {
		t.Fatalf("counted %d; an RTCP frame was counted as media", flow.Packets)
	}
}

// A leaked session takes a slot from whatever is actually watching, and cheap
// cameras support very few.
func TestTheProbeAlwaysTearsDown(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 5 })

	if _, _, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, 2*time.Second, 300*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	srv.set(func(f *fakeRTSP) {
		if !f.sawSetup || !f.sawPlay {
			t.Error("the probe never set up or played")
		}
		if !f.sawTeardown {
			t.Error("the probe did not TEARDOWN; the session would be held until " +
				"the camera timed it out, taking a slot from a real viewer")
		}
	})
}

// A camera that describes a track and refuses to stream it over TCP is a
// specific, actionable failure — not a generic error.
func TestARefusedSetupSaysSo(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.setupStatus = 461 }) // unsupported transport

	info, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, time.Second, 300*time.Millisecond)
	if err == nil {
		t.Fatal("a refused SETUP was reported as success")
	}
	if !strings.Contains(err.Error(), "will not stream it over TCP") {
		t.Errorf("error does not identify the transport refusal: %v", err)
	}
	if info.VideoCodec() == "" {
		t.Error("the description was discarded on a SETUP failure")
	}
	if flow.Flowing() {
		t.Error("reported flow after a failed SETUP")
	}
}

// Digest covers the method and URI, so a DESCRIBE header cannot be replayed for
// SETUP. A probe that tried would be refused and would report it as a
// credential problem, which it is not.
func TestEachMethodAuthenticatesOnItsOwn(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) {
		f.requireAuth, f.user, f.pass, f.rtpPackets = "digest", "admin", "pw", 5
	})

	_, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{Username: "admin", Password: "pw"}, 2*time.Second, 400*time.Millisecond)
	if err != nil {
		t.Fatalf("an authenticated media probe failed: %v", err)
	}
	if !flow.Flowing() {
		t.Error("no media over an authenticated session")
	}
}

// A stream that is FLOWING and LOSSY. This is the camera an operator most needs
// help with — a weak Wi-Fi link, or a switch dropping frames — and until the
// probe read sequence numbers it reported exactly like a healthy one.
func TestALossyStreamIsFlowingButNotIntact(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 40; f.rtpDropEvery = 4 })

	_, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, 2*time.Second, 400*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeMedia: %v", err)
	}
	if !flow.Flowing() {
		t.Fatal("packets arrived but Flowing() is false")
	}
	if flow.Intact() {
		t.Errorf("a stream missing every 4th packet reported Intact(): %s", flow.Summary())
	}
	if flow.Lost == 0 {
		t.Errorf("no loss detected on a deliberately lossy stream: %s", flow.Summary())
	}
	// Roughly a quarter gone. Bounds rather than an exact figure: the probe
	// stops when its window closes, so the tail is timing-dependent.
	if r := flow.LossRate(); r < 0.15 || r > 0.35 {
		t.Errorf("loss rate %.2f, want ~0.25: %s", r, flow.Summary())
	}
	if !strings.Contains(flow.Summary(), "lost") {
		t.Errorf("Summary() hides the loss: %q", flow.Summary())
	}
}

// A clean stream must report no loss. The counterpart to the test above: a
// tracker that reported loss on healthy traffic would be worse than none,
// because an operator would go looking for a fault that is not there.
func TestACleanStreamReportsNoLoss(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 30 })

	_, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, 2*time.Second, 400*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeMedia: %v", err)
	}
	if flow.Lost != 0 {
		t.Errorf("clean stream reported %d lost: %s", flow.Lost, flow.Summary())
	}
	if !flow.Intact() {
		t.Errorf("clean stream did not report Intact(): %s", flow.Summary())
	}
	if strings.Contains(flow.Summary(), "lost") {
		t.Errorf("Summary() invented loss on a clean stream: %q", flow.Summary())
	}
}

// The 16-bit sequence wraps roughly every half-minute on a busy stream. Through
// the REAL probe, not just the unit tracker: a wrap misread as a backwards jump
// would report a five-figure loss on a healthy camera.
func TestSequenceWrapThroughTheProbeIsNotLoss(t *testing.T) {
	srv := newFakeRTSP(t)
	srv.set(func(f *fakeRTSP) { f.rtpPackets = 20; f.rtpStartSeq = 65530 })

	_, flow, err := ProbeMedia(context.Background(), srv.url("/cam"),
		Credential{}, 2*time.Second, 400*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeMedia: %v", err)
	}
	if flow.Lost != 0 {
		t.Errorf("a stream wrapping 65535→0 reported %d lost: %s", flow.Lost, flow.Summary())
	}
	if flow.SourceRestarts != 0 {
		t.Errorf("the wrap was read as %d source restart(s): %s", flow.SourceRestarts, flow.Summary())
	}
}
