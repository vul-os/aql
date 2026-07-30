package camera

// An RTSP reachability probe: DESCRIBE, and nothing more.
//
// # The gap this closes, and the one it deliberately leaves open
//
// Until this file, the driver resolved a stream address by asking ONVIF for it
// and handed that URL to an operator having never touched it. If the RTSP port
// was firewalled, if the camera wanted different credentials on the media leg
// than on the device service, if the profile existed but did not stream — the
// operator found out in VLC, not from Aql. The hub was passing on a claim it had
// not checked.
//
// A DESCRIBE checks it. It opens the connection, authenticates, asks the camera
// what the stream IS, and parses the answer. That is enough to say "this URL
// works and it carries H.264 1920x1080", which is exactly the question someone
// wiring up a camera has.
//
// What it still does not do is receive a frame. No SETUP, no PLAY, no RTP, no
// decoding, no recording, no live view. The package doc explains why at length
// and the reasoning has not changed: those need a real camera to develop against
// and a storage design this repository does not have — where clips live, for how
// long, who may see them, what happens when the disk fills, what a resident is
// told when retention silently drops the evening they care about.
//
// The line moved by exactly one request, and it moved because a DESCRIBE is
// testable against a server a test can stand up in-process. That is the same
// standard every other driver here is held to.
//
// # Why not just reuse net/http
//
// RTSP looks like HTTP and is not. It is RTSP/1.0 rather than HTTP/1.1, the
// methods are different, the mandatory CSeq header has no HTTP equivalent, and
// net/http's client will not speak it. But the message grammar IS HTTP's, so the
// request line and header block are written by hand and textproto reads the
// response — which keeps the parsing in the standard library where it has been
// looked at, rather than hand-rolled here.

import (
	"bufio"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net"
	"net/textproto"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DefaultRTSPTimeout bounds a whole probe, dial included.
//
// Short on purpose. A probe runs while an operator waits at a form, and a camera
// that has not answered in five seconds is a camera with a problem worth
// reporting rather than waiting longer for.
const DefaultRTSPTimeout = 5 * time.Second

// rtspMaxResponseBytes bounds what a probe will read. An SDP for a camera is a
// few hundred bytes; anything approaching this is a server that is not going to
// stop, and reading it is how a probe becomes a memory exhaustion.
const rtspMaxResponseBytes = 64 << 10

// StreamInfo is what a camera said about its own stream.
type StreamInfo struct {
	// URL is the address that was probed, with any credentials stripped — this
	// value is logged and shown, and an RTSP URL routinely carries a password
	// in its userinfo.
	URL string
	// Media is one entry per SDP m= line: usually video, sometimes audio too.
	Media []MediaDescription
	// ServerHeader is whatever the camera called itself. Free text, carried
	// through verbatim because it is often the only way to identify a device
	// whose ONVIF metadata is generic.
	ServerHeader string
	// AuthUsed says which scheme the camera actually demanded: "none",
	// "basic" or "digest". Worth surfacing — a camera accepting Basic is
	// sending its password in cleartext on the media leg, and an operator
	// should be able to find that out from the product rather than from a
	// packet capture.
	AuthUsed string
}

// MediaDescription is one m= line and the codec it names.
type MediaDescription struct {
	// Kind is "video", "audio", or whatever else the camera declared.
	Kind string
	// Codec is the encoding name from the rtpmap attribute — "H264",
	// "H265", "JPEG", "PCMU". Empty when the camera named only a static
	// payload type and no rtpmap, which older cameras do.
	Codec string
	// PayloadType is the RTP payload number.
	PayloadType int
	// Control is the per-stream control URL a SETUP would use. Parsed and
	// reported but not followed — see the file comment.
	Control string
	// Parameters is the sequence parameter set the camera advertised in
	// sprop-parameter-sets, decoded. nil when the camera offered none — which
	// is legal, since a camera may send parameter sets in-band instead.
	//
	// This is the difference between "the camera says it streams H264" and "the
	// camera streams 1280x720 H264 at High profile". An ONVIF profile carries a
	// configured resolution, and it is routinely not the one the encoder is
	// actually using — a profile edited without restarting the encoder, or a
	// second stream sharing a profile. The SPS is what the encoder is doing.
	Parameters *SPS
	// ParametersErr says why an advertised parameter set could not be read.
	//
	// Separate from Parameters being nil, because "the camera offered nothing"
	// and "the camera offered something this code could not parse" call for
	// different responses, and collapsing them into a nil would report a broken
	// camera as a quiet one.
	ParametersErr string
}

// Describe probes an RTSP URL and reports what the camera says it streams.
//
// It never receives media. The connection is closed as soon as the DESCRIBE
// response is parsed, so a probe costs the camera one request and holds no
// session — which matters because cheap cameras support very few concurrent
// RTSP sessions and a probe that left one open would take a slot from whatever
// is actually watching.
func Describe(ctx context.Context, rawURL string, cred Credential, timeout time.Duration) (StreamInfo, error) {
	if timeout <= 0 {
		timeout = DefaultRTSPTimeout
	}

	u, err := parseRTSPURL(rawURL)
	if err != nil {
		return StreamInfo{}, err
	}

	// Credentials in the URL win over the configured ones — a camera whose
	// ONVIF GetStreamUri handed back an address with userinfo has told us which
	// account that stream wants, and overriding it with the device-service
	// login is how a working URL gets probed as a broken one.
	if u.User != nil {
		pass, _ := u.User.Password()
		cred = Credential{Username: u.User.Username(), Password: pass}
		u.User = nil
	}
	safeURL := u.String()

	d := net.Dialer{Timeout: timeout}
	conn, err := d.DialContext(ctx, "tcp", rtspHostPort(u))
	if err != nil {
		return StreamInfo{}, fmt.Errorf("camera: rtsp dial %s: %w", safeURL, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	br := bufio.NewReader(conn)
	cseq := 1

	// First attempt, unauthenticated. Most cameras answer 401 with a challenge;
	// asking without credentials first is how the challenge is obtained, and it
	// also means a camera that needs none is never sent one.
	resp, err := rtspExchange(conn, br, "DESCRIBE", safeURL, cseq, "")
	if err != nil {
		return StreamInfo{}, err
	}
	authUsed := "none"

	if resp.status == 401 {
		cseq++
		challenge := resp.header.Get("WWW-Authenticate")
		auth, scheme, err := authorization(challenge, "DESCRIBE", safeURL, cred)
		if err != nil {
			return StreamInfo{}, fmt.Errorf("camera: rtsp %s: %w", safeURL, err)
		}
		authUsed = scheme
		resp, err = rtspExchange(conn, br, "DESCRIBE", safeURL, cseq, auth)
		if err != nil {
			return StreamInfo{}, err
		}
	}

	switch {
	case resp.status == 401:
		// Deliberately distinct from a transport failure: the camera is up and
		// reachable and said no. An operator sent to check cabling when the
		// password is wrong will not find the problem.
		return StreamInfo{}, fmt.Errorf(
			"camera: rtsp %s: the camera rejected these credentials on the media leg "+
				"(cameras often want a different account here than on the device service)",
			safeURL)
	case resp.status == 404:
		return StreamInfo{}, fmt.Errorf(
			"camera: rtsp %s: no such stream — the profile may have been deleted or "+
				"renamed since the address was resolved", safeURL)
	case resp.status < 200 || resp.status > 299:
		return StreamInfo{}, fmt.Errorf("camera: rtsp %s: DESCRIBE returned %d %s",
			safeURL, resp.status, resp.reason)
	}

	info := StreamInfo{
		URL:          safeURL,
		ServerHeader: resp.header.Get("Server"),
		AuthUsed:     authUsed,
		Media:        parseSDP(resp.body),
	}
	if len(info.Media) == 0 {
		// A 200 with nothing describable is not a success. Reporting it as one
		// would tell an operator their camera works when nothing can play it.
		return info, fmt.Errorf("camera: rtsp %s: the camera answered but described "+
			"no media streams", safeURL)
	}
	return info, nil
}

// readSpropParameterSets pulls the SPS out of an fmtp attribute (RFC 6184 §8.1)
// and decodes it.
//
// The line looks like:
//
//	a=fmtp:96 packetization-mode=1;sprop-parameter-sets=Z0IAKeKQFge2AtwEBAaQeJEV,aM48gA==
//
// sprop-parameter-sets is a comma-separated list of base64 parameter sets, in no
// guaranteed order and with no type tag — the NAL header byte inside each one is
// the only thing that says which is the SPS. So every element is decoded and
// tried, rather than assuming the SPS comes first; cameras that send the PPS
// first exist.
//
// Order-independence itself comes from ParseSPS, which refuses a NAL whose type
// is not 7. The nal_unit_type check below is not what provides it — a tamper
// removing that check left every ordering case passing. What the check is for is
// the difference between a list that offers ONLY a PPS, which is legal and
// unremarkable, and one that offers something broken: without it the PPS's
// rejection lands in lastErr and a perfectly healthy camera is reported as
// having advertised an unreadable parameter set.
//
// Nothing here fails the probe. A camera whose fmtp line is malformed still has
// a working stream, and a DESCRIBE that refused because one attribute was odd
// would be less useful than one that reports what it could read and says what it
// could not.
func (m *MediaDescription) readSpropParameterSets(fmtp string) {
	// "96 packetization-mode=1;sprop-parameter-sets=..." — drop the payload
	// type, which is already in PayloadType.
	_, params, ok := strings.Cut(strings.TrimSpace(fmtp), " ")
	if !ok {
		return
	}
	var sprop string
	for _, kv := range strings.Split(params, ";") {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		// The value is base64 and may itself contain '=' padding, so the split
		// above is on the FIRST '=' only and v keeps the rest.
		if strings.EqualFold(strings.TrimSpace(k), "sprop-parameter-sets") {
			sprop = strings.TrimSpace(v)
			break
		}
	}
	if sprop == "" {
		return
	}

	var lastErr string
	for _, enc := range strings.Split(sprop, ",") {
		enc = strings.TrimSpace(enc)
		if enc == "" {
			continue
		}
		nal, err := base64.StdEncoding.DecodeString(enc)
		if err != nil {
			lastErr = "sprop-parameter-sets is not valid base64"
			continue
		}
		if len(nal) == 0 || nal[0]&0x1f != nalTypeSPS {
			continue // a PPS or something else; not an error
		}
		sps, err := ParseSPS(nal)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		m.Parameters = &sps
		m.ParametersErr = ""
		return
	}
	// Only reported when no parameter set parsed. A camera that offers a broken
	// SPS and a good one is not broken.
	if m.Parameters == nil {
		m.ParametersErr = lastErr
	}
}

// VideoResolution returns the first video stream's encoded dimensions, and
// whether the camera advertised a parameter set to read them from.
func (s StreamInfo) VideoResolution() (width, height int, known bool) {
	for _, m := range s.Media {
		if m.Kind == "video" && m.Parameters != nil {
			return m.Parameters.Width, m.Parameters.Height, true
		}
	}
	return 0, 0, false
}

// VideoCodec returns the first video stream's codec, or "".
func (s StreamInfo) VideoCodec() string {
	for _, m := range s.Media {
		if m.Kind == "video" {
			return m.Codec
		}
	}
	return ""
}

// Summary renders the probe for an operator, e.g. "H264 video · digest auth".
func (s StreamInfo) Summary() string {
	var parts []string
	for _, m := range s.Media {
		desc := m.Kind
		if m.Codec != "" {
			desc = m.Codec + " " + m.Kind
		}
		// The resolution comes from the stream's own parameter set, so it is
		// worth showing next to the codec: an operator comparing this against
		// the resolution an ONVIF profile claims is the whole point of having
		// probed. Silence when the camera advertised nothing — an absent
		// parameter set is normal (they can arrive in-band) and rendering it as
		// "0x0" would state a resolution nobody claimed.
		if m.Parameters != nil {
			desc += fmt.Sprintf(" %dx%d", m.Parameters.Width, m.Parameters.Height)
		}
		parts = append(parts, desc)
	}
	out := strings.Join(parts, " + ")
	if s.AuthUsed != "" && s.AuthUsed != "none" {
		out += " · " + s.AuthUsed + " auth"
	}
	return out
}

// ── the wire ────────────────────────────────────────────────────────────────

type rtspResponse struct {
	status int
	reason string
	header textproto.MIMEHeader
	body   string
}

func rtspExchange(conn net.Conn, br *bufio.Reader, method, url string, cseq int, auth string) (rtspResponse, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "%s %s RTSP/1.0\r\n", method, url)
	fmt.Fprintf(&b, "CSeq: %d\r\n", cseq)
	b.WriteString("User-Agent: aql-hub\r\n")
	// Only SDP is parsed, so only SDP is asked for. A camera that would have
	// offered something else is told plainly this client cannot read it.
	b.WriteString("Accept: application/sdp\r\n")
	if auth != "" {
		fmt.Fprintf(&b, "Authorization: %s\r\n", auth)
	}
	b.WriteString("\r\n")

	if _, err := conn.Write([]byte(b.String())); err != nil {
		return rtspResponse{}, fmt.Errorf("camera: rtsp write: %w", err)
	}
	return readRTSPResponse(br)
}

func readRTSPResponse(br *bufio.Reader) (rtspResponse, error) {
	tp := textproto.NewReader(br)
	line, err := tp.ReadLine()
	if err != nil {
		return rtspResponse{}, fmt.Errorf("camera: rtsp read: %w", err)
	}
	// "RTSP/1.0 200 OK"
	parts := strings.SplitN(line, " ", 3)
	if len(parts) < 2 || !strings.HasPrefix(parts[0], "RTSP/") {
		return rtspResponse{}, fmt.Errorf("camera: rtsp: not an RTSP response: %q", line)
	}
	status, err := strconv.Atoi(parts[1])
	if err != nil {
		return rtspResponse{}, fmt.Errorf("camera: rtsp: bad status %q", parts[1])
	}
	reason := ""
	if len(parts) == 3 {
		reason = parts[2]
	}

	header, err := tp.ReadMIMEHeader()
	if err != nil {
		return rtspResponse{}, fmt.Errorf("camera: rtsp headers: %w", err)
	}

	body := ""
	if n, _ := strconv.Atoi(header.Get("Content-Length")); n > 0 {
		if n > rtspMaxResponseBytes {
			return rtspResponse{}, fmt.Errorf(
				"camera: rtsp: declared body of %d bytes exceeds the %d-byte ceiling",
				n, rtspMaxResponseBytes)
		}
		buf := make([]byte, n)
		if _, err := readFull(br, buf); err != nil {
			return rtspResponse{}, fmt.Errorf("camera: rtsp body: %w", err)
		}
		body = string(buf)
	}
	return rtspResponse{status: status, reason: reason, header: header, body: body}, nil
}

func readFull(br *bufio.Reader, buf []byte) (int, error) {
	got := 0
	for got < len(buf) {
		n, err := br.Read(buf[got:])
		got += n
		if err != nil {
			return got, err
		}
	}
	return got, nil
}

// ── auth ────────────────────────────────────────────────────────────────────

// authorization builds an Authorization header for a challenge.
//
// Digest is implemented because it is what cameras overwhelmingly use, and it
// is MD5 because RFC 2069/2617 digest is MD5 — that is not a choice this code
// makes and not a cryptographic claim it depends on. The digest never protects
// anything here beyond the DESCRIBE itself; it exists so the camera answers.
func authorization(challenge, method, uri string, cred Credential) (header, scheme string, err error) {
	c := strings.TrimSpace(challenge)
	switch {
	case c == "":
		return "", "", fmt.Errorf("the camera demanded authentication but sent no challenge")

	case strings.HasPrefix(strings.ToLower(c), "digest "):
		p := parseChallengeParams(c[len("Digest "):])
		realm, nonce := p["realm"], p["nonce"]
		if realm == "" || nonce == "" {
			return "", "", fmt.Errorf("the camera's digest challenge is missing realm or nonce")
		}
		ha1 := md5hex(cred.Username + ":" + realm + ":" + cred.Password)
		ha2 := md5hex(method + ":" + uri)

		// qop=auth requires a client nonce and a counter. Cameras vary on
		// whether they offer it; both shapes are produced rather than assuming
		// the simpler one, because a camera that advertises qop and receives a
		// response without it answers 401 again and the probe reports a
		// credential failure that is really a protocol one.
		if qop := p["qop"]; qop != "" && strings.Contains(qop, "auth") {
			cnonce := randomHex(8)
			const nc = "00000001"
			resp := md5hex(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2)
			return fmt.Sprintf(
				`Digest username="%s", realm="%s", nonce="%s", uri="%s", qop=auth, nc=%s, cnonce="%s", response="%s"`,
				cred.Username, realm, nonce, uri, nc, cnonce, resp), "digest", nil
		}
		resp := md5hex(ha1 + ":" + nonce + ":" + ha2)
		return fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`,
			cred.Username, realm, nonce, uri, resp), "digest", nil

	case strings.HasPrefix(strings.ToLower(c), "basic "):
		// Supported because some cameras offer nothing else, and refusing would
		// mean the product cannot talk to them at all. Reported as "basic" in
		// AuthUsed so an operator can see that this camera is taking a password
		// in cleartext.
		return "Basic " + basicToken(cred.Username, cred.Password), "basic", nil
	}
	return "", "", fmt.Errorf("unsupported authentication scheme in %q", firstWord(c))
}

func parseChallengeParams(s string) map[string]string {
	out := map[string]string{}
	// key="value" or key=value, comma-separated, with values that may contain
	// commas inside quotes.
	var key, val strings.Builder
	inKey, inQuote := true, false
	flush := func() {
		k := strings.TrimSpace(key.String())
		if k != "" {
			out[strings.ToLower(k)] = strings.Trim(strings.TrimSpace(val.String()), `"`)
		}
		key.Reset()
		val.Reset()
		inKey = true
	}
	for _, r := range s {
		switch {
		case r == '"':
			inQuote = !inQuote
			val.WriteRune(r)
		case r == '=' && inKey && !inQuote:
			inKey = false
		case r == ',' && !inQuote:
			flush()
		case inKey:
			key.WriteRune(r)
		default:
			val.WriteRune(r)
		}
	}
	flush()
	return out
}

func md5hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// A predictable cnonce weakens digest's replay protection and nothing
		// else here; failing the probe over it would be worse than proceeding,
		// but silently doing so would be dishonest, so it is at least distinct.
		return strings.Repeat("0", n*2)
	}
	return hex.EncodeToString(b)
}

func basicToken(user, pass string) string {
	return base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
}

func firstWord(s string) string {
	if i := strings.IndexByte(s, ' '); i > 0 {
		return s[:i]
	}
	return s
}

// ── SDP ─────────────────────────────────────────────────────────────────────

// parseSDP reads the m=, a=rtpmap and a=control lines and ignores the rest.
//
// Deliberately partial, for the reason the config parsers here are: decoding
// only what is used means a camera sending fields this does not know about
// cannot break the probe.
func parseSDP(body string) []MediaDescription {
	var out []MediaDescription
	var cur *MediaDescription

	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 2 || line[1] != '=' {
			continue
		}
		value := line[2:]

		switch line[0] {
		case 'm':
			// "m=video 0 RTP/AVP 96"
			f := strings.Fields(value)
			if len(f) < 4 {
				continue
			}
			pt, err := strconv.Atoi(f[3])
			if err != nil {
				pt = -1
			}
			out = append(out, MediaDescription{Kind: f[0], PayloadType: pt})
			cur = &out[len(out)-1]

		case 'a':
			if cur == nil {
				continue // a session-level attribute, not ours
			}
			switch {
			case strings.HasPrefix(value, "rtpmap:"):
				// "a=rtpmap:96 H264/90000"
				f := strings.Fields(strings.TrimPrefix(value, "rtpmap:"))
				if len(f) >= 2 {
					cur.Codec = strings.SplitN(f[1], "/", 2)[0]
				}
			case strings.HasPrefix(value, "control:"):
				cur.Control = strings.TrimSpace(strings.TrimPrefix(value, "control:"))
			case strings.HasPrefix(value, "fmtp:"):
				cur.readSpropParameterSets(strings.TrimPrefix(value, "fmtp:"))
			}
		}
	}
	return out
}

// ── URL ─────────────────────────────────────────────────────────────────────

func parseRTSPURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("camera: rtsp url: %w", err)
	}
	if u.Scheme != "rtsp" && u.Scheme != "rtsps" {
		return nil, fmt.Errorf("camera: %q is not an rtsp:// URL", raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("camera: rtsp url has no host: %q", raw)
	}
	return u, nil
}

func rtspHostPort(u *url.URL) string {
	if u.Port() != "" {
		return u.Host
	}
	if u.Scheme == "rtsps" {
		return net.JoinHostPort(u.Hostname(), "322")
	}
	return net.JoinHostPort(u.Hostname(), "554")
}

// ── media-flow probe: SETUP, PLAY, count, TEARDOWN ──────────────────────────
//
// # Why this exists when DESCRIBE already passed
//
// A DESCRIBE proves the camera ANSWERS and says what it intends to stream. It
// does not prove anything comes out. A camera that describes a perfectly good
// H.264 profile and then sends nothing is an ordinary failure — a dead encoder,
// a transport the camera will not actually do, a firewall that permits the
// control connection and drops the media. The operator's symptom is a black
// player, and DESCRIBE told them everything was fine.
//
// So this takes the next step and stops immediately after it: SETUP the video
// track over interleaved TCP, PLAY, count what arrives for a second or two,
// TEARDOWN.
//
// # The line, and why it is exactly here
//
// It counts PACKETS. It does not decode one.
//
// RTP framing and the RTP header are fully specified and small — a 4-byte
// interleaved prefix and a 12-byte header — so a test can serve them faithfully
// and this code can be trusted against it. H.264 DEPACKETIZATION is not that: FU-A
// fragmentation, STAP-A aggregation and the parameter-set handling vary between
// real cameras in ways a fake written from the same RFC would simply agree with.
// Writing that blind produces code that passes its own tests and fails on
// contact, which is the trap this package's doc comment already names.
//
// Everything above the packet counter therefore stays unbuilt until there is a
// camera to develop against. What this buys without one is the honest answer to
// "is media actually flowing", which is the question a black player raises.
//
// # It holds a session, so it is opt-in and it always tears down
//
// Unlike Describe, this occupies an RTSP session. Cheap cameras support very few
// concurrent ones, and a probe that leaked a session would take a slot from
// whatever is genuinely watching. TEARDOWN is sent on every exit path.

// MediaFlow is what a short PLAY observed.
type MediaFlow struct {
	// Packets is how many RTP packets arrived in the window.
	Packets int
	// Bytes is their total payload size, header excluded.
	Bytes int
	// PayloadTypes are the distinct RTP payload types seen, sorted. A stream
	// carrying a type the SDP did not advertise is worth seeing.
	PayloadTypes []int
	// SSRCs are the distinct synchronisation sources seen. More than one on a
	// single track means something is multiplexing, which a viewer will not
	// expect.
	SSRCs []uint32
	// Lost is how many RTP packets the sequence numbers say never arrived.
	//
	// Counting packets answers "is media flowing"; this answers "is it arriving
	// intact", and they come apart on exactly the cameras an operator needs
	// help with — a weak Wi-Fi link sends packets the whole time and produces a
	// smeared picture. See seq.go for how reordering, duplication and the
	// 16-bit wrap are kept out of this number.
	Lost int
	// Expected is how many the observed sequence range implies. Lost/Expected
	// is the loss rate; both are reported so a caller can tell "0 lost of 12"
	// from "0 lost of 12000".
	Expected int
	// SourceRestarts counts sequence spaces that jumped too far forward to be
	// loss — a camera restarting its stream mid-probe. Reported rather than
	// folded into Lost, because it is a different fault with a different fix.
	SourceRestarts int
	// Window is how long the probe listened.
	Window time.Duration
}

// LossRate is the fraction of expected packets that never arrived, 0 when
// nothing was expected.
func (m MediaFlow) LossRate() float64 {
	if m.Expected <= 0 {
		return 0
	}
	return float64(m.Lost) / float64(m.Expected)
}

// Intact reports whether the stream arrived without loss.
//
// Separate from Flowing() on purpose, and the pair is the point: a stream can
// be flowing and not intact, which is the case a packet counter alone reports
// as healthy.
func (m MediaFlow) Intact() bool { return m.Flowing() && m.Lost == 0 }

// Flowing reports whether any media arrived at all.
//
// The distinction the whole probe exists for: describing a stream and sending
// one are different claims, and only this one answers the second.
func (m MediaFlow) Flowing() bool { return m.Packets > 0 }

// Summary renders the observation for an operator.
func (m MediaFlow) Summary() string {
	if m.Packets == 0 {
		return "no media in " + m.Window.String()
	}
	rate := float64(m.Packets) / m.Window.Seconds()
	base := fmt.Sprintf("%d packets in %s (~%.0f/s, %d bytes)",
		m.Packets, m.Window, rate, m.Bytes)
	if m.Lost > 0 {
		base += fmt.Sprintf(", %d of %d lost (%.1f%%)", m.Lost, m.Expected, m.LossRate()*100)
	}
	if m.SourceRestarts > 0 {
		base += fmt.Sprintf(", %d source restart(s)", m.SourceRestarts)
	}
	return base
}

// ProbeMedia runs DESCRIBE, then SETUP and PLAY on the first video track, and
// counts RTP packets for window.
//
// The StreamInfo is returned even when no media arrives, because "the camera
// described H264 and sent nothing" is the diagnosis, and discarding the
// description would throw away half of it.
func ProbeMedia(ctx context.Context, rawURL string, cred Credential,
	timeout, window time.Duration) (StreamInfo, MediaFlow, error) {
	if timeout <= 0 {
		timeout = DefaultRTSPTimeout
	}
	if window <= 0 {
		window = 2 * time.Second
	}

	u, err := parseRTSPURL(rawURL)
	if err != nil {
		return StreamInfo{}, MediaFlow{}, err
	}
	if u.User != nil {
		pass, _ := u.User.Password()
		cred = Credential{Username: u.User.Username(), Password: pass}
		u.User = nil
	}
	safeURL := u.String()

	d := net.Dialer{Timeout: timeout}
	conn, err := d.DialContext(ctx, "tcp", rtspHostPort(u))
	if err != nil {
		return StreamInfo{}, MediaFlow{}, fmt.Errorf("camera: rtsp dial %s: %w", safeURL, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout + window))

	br := bufio.NewReader(conn)
	seq := &cseqCounter{n: 0}

	info, auth, err := describeOn(conn, br, safeURL, cred, seq)
	if err != nil {
		return StreamInfo{}, MediaFlow{}, err
	}

	track := videoTrack(info)
	if track == nil {
		return info, MediaFlow{}, fmt.Errorf(
			"camera: rtsp %s: described no video track to play", safeURL)
	}
	setupURL := absoluteControl(safeURL, track.Control)

	// Interleaved TCP, not UDP. It is the transport that works through the
	// connection already open — no second socket, no NAT hole, no port range to
	// negotiate — and for a probe whose whole job is answering "does anything
	// come out", removing the transport as a variable is the point.
	resp, err := rtspExchangeExtra(conn, br, "SETUP", setupURL, seq.next(),
		authFor(auth, "SETUP", setupURL, cred), "Transport: RTP/AVP/TCP;unicast;interleaved=0-1")
	if err != nil {
		return info, MediaFlow{}, err
	}
	if resp.status != 200 {
		return info, MediaFlow{}, fmt.Errorf(
			"camera: rtsp %s: SETUP returned %d %s — it described this track but will "+
				"not stream it over TCP", safeURL, resp.status, resp.reason)
	}
	session := sessionID(resp.header.Get("Session"))
	// TEARDOWN on every exit from here. A leaked session takes a slot from
	// whatever is actually watching, and cheap cameras have very few.
	defer func() {
		// A fresh deadline: the read window above has by then consumed the
		// original, and a TEARDOWN written to an expired connection is a
		// TEARDOWN that never happens.
		_ = conn.SetDeadline(time.Now().Add(timeout))
		_, _ = rtspExchangeExtra(conn, br, "TEARDOWN", safeURL, seq.next(),
			authFor(auth, "TEARDOWN", safeURL, cred), "Session: "+session)
	}()

	resp, err = rtspExchangeExtra(conn, br, "PLAY", safeURL, seq.next(),
		authFor(auth, "PLAY", safeURL, cred), "Session: "+session)
	if err != nil {
		return info, MediaFlow{}, err
	}
	if resp.status != 200 {
		return info, MediaFlow{}, fmt.Errorf("camera: rtsp %s: PLAY returned %d %s",
			safeURL, resp.status, resp.reason)
	}

	flow := countInterleaved(conn, br, window)
	flow.Window = window
	return info, flow, nil
}

// countInterleaved reads `$<channel><len16><data>` frames and counts the RTP
// ones, without interpreting a single payload byte.
func countInterleaved(conn net.Conn, br *bufio.Reader, window time.Duration) MediaFlow {
	var flow MediaFlow
	types := map[int]bool{}
	ssrcs := map[uint32]bool{}
	seqs := seqSet{}
	deadline := time.Now().Add(window)
	// Bound the READ by the window, not by the connection's own deadline. A
	// silent camera otherwise blocks here until the whole-request timeout, and
	// the deferred TEARDOWN is then written to a connection whose deadline has
	// already passed — so the probe holds the session it promised to release,
	// on exactly the cameras (silent ones) it was built to diagnose.
	_ = conn.SetReadDeadline(deadline)

	for time.Now().Before(deadline) {
		b, err := br.ReadByte()
		if err != nil {
			break
		}
		if b != '$' {
			// An RTSP response interleaved with media — an announcement, or a
			// keepalive reply. Skip its line and keep going rather than
			// treating it as a framing error.
			_, _ = br.ReadString('\n')
			continue
		}
		var hdr [3]byte
		if _, err := readFull(br, hdr[:]); err != nil {
			break
		}
		channel := int(hdr[0])
		length := int(binary.BigEndian.Uint16(hdr[1:3]))
		if length <= 0 || length > 65535 {
			break
		}
		payload := make([]byte, length)
		if _, err := readFull(br, payload); err != nil {
			break
		}
		// Channel 1 is RTCP under the interleaved=0-1 asked for above. Sender
		// reports are not media and counting them would inflate the answer.
		if channel != 0 || len(payload) < 12 {
			continue
		}
		flow.Packets++
		flow.Bytes += len(payload) - 12
		types[int(payload[1]&0x7F)] = true
		ssrc := binary.BigEndian.Uint32(payload[8:12])
		ssrcs[ssrc] = true
		seqs.observe(ssrc, binary.BigEndian.Uint16(payload[2:4]))
	}

	for t := range types {
		flow.PayloadTypes = append(flow.PayloadTypes, t)
	}
	sort.Ints(flow.PayloadTypes)
	for s := range ssrcs {
		flow.SSRCs = append(flow.SSRCs, s)
	}
	sort.Slice(flow.SSRCs, func(i, j int) bool { return flow.SSRCs[i] < flow.SSRCs[j] })
	expected, _, lost, restarts := seqs.totals()
	flow.Expected = int(expected)
	flow.Lost = int(lost)
	flow.SourceRestarts = restarts
	return flow
}

// ── small helpers the two probes share ──────────────────────────────────────

type cseqCounter struct{ n int }

func (c *cseqCounter) next() int { c.n++; return c.n }

// describeOn runs the DESCRIBE handshake on an already-open connection and
// returns the parsed stream plus the challenge, so later requests on the same
// session can authenticate without a second round trip.
func describeOn(conn net.Conn, br *bufio.Reader, url string, cred Credential,
	seq *cseqCounter) (StreamInfo, string, error) {
	resp, err := rtspExchange(conn, br, "DESCRIBE", url, seq.next(), "")
	if err != nil {
		return StreamInfo{}, "", err
	}
	challenge := ""
	authUsed := "none"
	if resp.status == 401 {
		challenge = resp.header.Get("WWW-Authenticate")
		hdr, scheme, aerr := authorization(challenge, "DESCRIBE", url, cred)
		if aerr != nil {
			return StreamInfo{}, "", fmt.Errorf("camera: rtsp %s: %w", url, aerr)
		}
		authUsed = scheme
		resp, err = rtspExchange(conn, br, "DESCRIBE", url, seq.next(), hdr)
		if err != nil {
			return StreamInfo{}, "", err
		}
	}
	if resp.status == 401 {
		return StreamInfo{}, "", fmt.Errorf(
			"camera: rtsp %s: the camera rejected these credentials on the media leg", url)
	}
	if resp.status < 200 || resp.status > 299 {
		return StreamInfo{}, "", fmt.Errorf("camera: rtsp %s: DESCRIBE returned %d %s",
			url, resp.status, resp.reason)
	}
	info := StreamInfo{
		URL: url, ServerHeader: resp.header.Get("Server"),
		AuthUsed: authUsed, Media: parseSDP(resp.body),
	}
	if len(info.Media) == 0 {
		return info, challenge, fmt.Errorf(
			"camera: rtsp %s: the camera answered but described no media streams", url)
	}
	return info, challenge, nil
}

// authFor rebuilds an Authorization header for one method+URI. Digest covers
// both, so the DESCRIBE header cannot be replayed for SETUP.
func authFor(challenge, method, uri string, cred Credential) string {
	if challenge == "" {
		return ""
	}
	hdr, _, err := authorization(challenge, method, uri, cred)
	if err != nil {
		return ""
	}
	return hdr
}

func rtspExchangeExtra(conn net.Conn, br *bufio.Reader, method, url string, cseq int,
	auth, extra string) (rtspResponse, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "%s %s RTSP/1.0\r\n", method, url)
	fmt.Fprintf(&b, "CSeq: %d\r\n", cseq)
	b.WriteString("User-Agent: aql-hub\r\n")
	if auth != "" {
		fmt.Fprintf(&b, "Authorization: %s\r\n", auth)
	}
	if extra != "" {
		b.WriteString(extra + "\r\n")
	}
	b.WriteString("\r\n")
	if _, err := conn.Write([]byte(b.String())); err != nil {
		return rtspResponse{}, fmt.Errorf("camera: rtsp write: %w", err)
	}
	return readRTSPResponse(br)
}

func videoTrack(info StreamInfo) *MediaDescription {
	for i := range info.Media {
		if info.Media[i].Kind == "video" {
			return &info.Media[i]
		}
	}
	return nil
}

// absoluteControl resolves an SDP control attribute, which may be absolute, a
// bare track id, or "*".
func absoluteControl(base, control string) string {
	c := strings.TrimSpace(control)
	switch {
	case c == "" || c == "*":
		return base
	case strings.HasPrefix(c, "rtsp://"), strings.HasPrefix(c, "rtsps://"):
		return c
	case strings.HasSuffix(base, "/"):
		return base + c
	default:
		return base + "/" + c
	}
}

// sessionID strips the timeout parameter cameras append to a Session header.
func sessionID(raw string) string {
	id, _, _ := strings.Cut(strings.TrimSpace(raw), ";")
	return id
}
