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
	"encoding/hex"
	"fmt"
	"net"
	"net/textproto"
	"net/url"
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
		if m.Codec != "" {
			parts = append(parts, m.Codec+" "+m.Kind)
		} else {
			parts = append(parts, m.Kind)
		}
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
