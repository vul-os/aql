package camera

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// SOAP actions. ONVIF dispatches on these, and getting one wrong produces a
// fault rather than a wrong answer, which is the failure mode to prefer.
const (
	actionGetCapabilities = nsDeviceWSDL + "/GetCapabilities"
	actionGetServices     = nsDeviceWSDL + "/GetServices"
	actionGetProfiles     = nsMediaWSDL + "/GetProfiles"
	actionGetStreamURI    = nsMediaWSDL + "/GetStreamUri"
)

// errNoMediaService means the camera answered but named no ver10 media service.
// Profile T devices that only offer the ver20 service (Media2) land here.
// Media2 is not implemented — see the package doc.
var errNoMediaService = errors.New("camera: the camera advertises no ONVIF ver10 media service")

// errNoProfiles means the media service answered with an empty profile list.
var errNoProfiles = errors.New("camera: the camera advertises no media profiles")

// Profile is one encoder profile, which is what a stream address is requested
// for. Resolution and encoding are carried because they are the only honest
// answer to "what would this stream be" that can be had without opening it.
type Profile struct {
	Token    string
	Name     string
	Encoding string
	Width    int
	Height   int
}

// Describe renders a profile for an operator, e.g. "mainStream · H264 1920x1080".
func (p Profile) Describe() string {
	parts := make([]string, 0, 2)
	if p.Name != "" {
		parts = append(parts, p.Name)
	}
	spec := strings.TrimSpace(p.Encoding)
	if p.Width > 0 && p.Height > 0 {
		spec = strings.TrimSpace(spec + " " + strconv.Itoa(p.Width) + "x" + strconv.Itoa(p.Height))
	}
	if spec != "" {
		parts = append(parts, spec)
	}
	if len(parts) == 0 {
		return p.Token
	}
	return strings.Join(parts, " · ")
}

// pixels is the ordering key for "best" profile. Zero when the camera did not
// say, which sorts last.
func (p Profile) pixels() int { return p.Width * p.Height }

// --- GetCapabilities / GetServices -----------------------------------------

type capabilitiesReply struct {
	MediaXAddr string `xml:"Body>GetCapabilitiesResponse>Capabilities>Media>XAddr"`
}

type servicesReply struct {
	Services []struct {
		Namespace string `xml:"Namespace"`
		XAddr     string `xml:"XAddr"`
	} `xml:"Body>GetServicesResponse>Service"`
}

// mediaAddress finds the ver10 media service endpoint for a camera.
//
// GetCapabilities first because every Profile S camera answers it; GetServices
// as a fallback because it is the call that replaced it, and a device that
// deprecated GetCapabilities would otherwise look like a device with no media
// service at all. Neither path is worth skipping: the fallback costs one extra
// request on the cameras that need it and nothing on the cameras that do not.
func (c *soapClient) mediaAddress(ctx context.Context, deviceAddr string, cred Credential, allowForeignHost bool) (string, error) {
	var caps capabilitiesReply
	inner := `<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>`
	capsErr := c.call(ctx, deviceAddr, actionGetCapabilities, inner, cred, &caps)
	if capsErr == nil && strings.TrimSpace(caps.MediaXAddr) != "" {
		return c.checkServiceAddress(caps.MediaXAddr, deviceAddr, allowForeignHost)
	}
	// A rejected credential is not a reason to try a second call with the same
	// rejected credential.
	if errors.Is(capsErr, ErrUnauthorized) || isTransport(capsErr) {
		return "", capsErr
	}

	var svc servicesReply
	inner = `<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>`
	if err := c.call(ctx, deviceAddr, actionGetServices, inner, cred, &svc); err != nil {
		if capsErr != nil {
			return "", capsErr
		}
		return "", err
	}
	for _, s := range svc.Services {
		if strings.TrimSpace(s.Namespace) == nsMediaWSDL && strings.TrimSpace(s.XAddr) != "" {
			return c.checkServiceAddress(s.XAddr, deviceAddr, allowForeignHost)
		}
	}
	return "", errNoMediaService
}

// checkServiceAddress applies the same rule discovery applies: a camera may
// point the hub at itself and nowhere else. The media service a camera names is
// the endpoint the hub will send that camera's password to, so an unchecked
// redirect here hands the credential to whatever host the camera nominates.
func (c *soapClient) checkServiceAddress(raw, deviceAddr string, allowForeignHost bool) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("camera: %s named an unusable media service address", redact(deviceAddr))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("camera: %s named a media service address with scheme %q", redact(deviceAddr), u.Scheme)
	}
	if u.User != nil {
		return "", fmt.Errorf("camera: %s named a media service address with credentials embedded in it", redact(deviceAddr))
	}
	if allowForeignHost {
		return u.String(), nil
	}
	dev, err := url.Parse(deviceAddr)
	if err != nil {
		return "", fmt.Errorf("camera: %s has an unusable device service address", redact(deviceAddr))
	}
	if !sameHost(u.Hostname(), dev.Hostname()) {
		return "", fmt.Errorf("camera: %s pointed its media service at another host; "+
			"set AcceptForeignServiceAddress if that is genuinely your topology", redact(deviceAddr))
	}
	return u.String(), nil
}

func sameHost(a, b string) bool {
	if strings.EqualFold(a, b) {
		return true
	}
	ipA, ipB := net.ParseIP(a), net.ParseIP(b)
	return ipA != nil && ipB != nil && ipA.Equal(ipB)
}

// --- GetProfiles ------------------------------------------------------------

type profilesReply struct {
	Profiles []struct {
		Token string `xml:"token,attr"`
		Name  string `xml:"Name"`
		Video struct {
			Encoding   string `xml:"Encoding"`
			Resolution struct {
				Width  string `xml:"Width"`
				Height string `xml:"Height"`
			} `xml:"Resolution"`
		} `xml:"VideoEncoderConfiguration"`
	} `xml:"Body>GetProfilesResponse>Profiles"`
}

// profiles enumerates the camera's media profiles, best first — highest pixel
// count, ties broken by token so the order is stable between polls and the
// console does not reshuffle. A profile with no token is dropped: the token is
// the only thing GetStreamUri can be asked with.
func (c *soapClient) profiles(ctx context.Context, mediaAddr string, cred Credential) ([]Profile, error) {
	var reply profilesReply
	if err := c.call(ctx, mediaAddr, actionGetProfiles, `<trt:GetProfiles/>`, cred, &reply); err != nil {
		return nil, err
	}
	out := make([]Profile, 0, len(reply.Profiles))
	for _, p := range reply.Profiles {
		tok := strings.TrimSpace(p.Token)
		if !validToken(tok) {
			continue
		}
		w, _ := strconv.Atoi(strings.TrimSpace(p.Video.Resolution.Width))
		h, _ := strconv.Atoi(strings.TrimSpace(p.Video.Resolution.Height))
		out = append(out, Profile{
			Token:    tok,
			Name:     sanitize(p.Name, 48),
			Encoding: sanitize(p.Video.Encoding, 16),
			Width:    w,
			Height:   h,
		})
	}
	if len(out) == 0 {
		return nil, errNoProfiles
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].pixels() != out[j].pixels() {
			return out[i].pixels() > out[j].pixels()
		}
		return out[i].Token < out[j].Token
	})
	return out, nil
}

// validToken bounds what may be substituted into a request. The token is
// XML-escaped as well when it is written, so this is belt and braces — but a
// token is device-supplied text that goes straight back out on the wire, and
// two cheap checks on it are cheaper than one clever one.
func validToken(t string) bool {
	if t == "" || len(t) > 64 {
		return false
	}
	for _, r := range t {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '_', r == '-', r == '.', r == ':':
		default:
			return false
		}
	}
	return true
}

// --- GetStreamUri -----------------------------------------------------------

type streamURIReply struct {
	URI string `xml:"Body>GetStreamUriResponse>MediaUri>Uri"`
}

// streamURI asks where an RTP-over-RTSP stream for one profile would come from.
//
// The address is returned, validated, and shown to an operator. It used to be
// the end of this package's road; it is not any more — StreamTargets hands it,
// with its credential, to the capture worker, which opens it.
func (c *soapClient) streamURI(ctx context.Context, mediaAddr, token string, cred Credential, allowForeignHost bool) (string, error) {
	if !validToken(token) {
		return "", fmt.Errorf("camera: %s offered a profile token this package will not send back", redact(mediaAddr))
	}
	inner := `<trt:GetStreamUri><trt:StreamSetup>` +
		`<tt:Stream>RTP-Unicast</tt:Stream>` +
		`<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>` +
		`</trt:StreamSetup><trt:ProfileToken>` + escapeXML(token) + `</trt:ProfileToken></trt:GetStreamUri>`

	var reply streamURIReply
	if err := c.call(ctx, mediaAddr, actionGetStreamURI, inner, cred, &reply); err != nil {
		return "", err
	}
	return normaliseStreamURI(strings.TrimSpace(reply.URI), mediaAddr, allowForeignHost)
}

// normaliseStreamURI validates the address a camera returned and strips any
// credentials it embedded in it.
//
// Stripping rather than refusing is deliberate: some cameras helpfully return
// rtsp://user:pass@host/..., the address is still correct, and the useful thing
// to show an operator is the address without the password in it. The credential
// the hub holds is in config; it does not need to be repeated in a string that
// gets rendered in a console and copied into a support ticket.
func normaliseStreamURI(raw, mediaAddr string, allowForeignHost bool) (string, error) {
	if raw == "" {
		return "", fmt.Errorf("camera: %s returned an empty stream address", redact(mediaAddr))
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("camera: %s returned an unusable stream address", redact(mediaAddr))
	}
	switch strings.ToLower(u.Scheme) {
	case "rtsp", "rtsps":
	default:
		// http/https here would be an MJPEG or snapshot address. It is not what
		// was asked for, and accepting it would mean the hub records something
		// under "stream" that is not the stream.
		return "", fmt.Errorf("camera: %s returned a stream address with scheme %q, not a stream transport",
			redact(mediaAddr), sanitize(u.Scheme, 12))
	}
	u.User = nil
	if !allowForeignHost {
		dev, derr := url.Parse(mediaAddr)
		if derr != nil {
			return "", fmt.Errorf("camera: %s has an unusable media service address", redact(mediaAddr))
		}
		if !sameHost(u.Hostname(), dev.Hostname()) {
			return "", fmt.Errorf("camera: %s pointed its stream at another host; "+
				"set AcceptForeignServiceAddress if that is genuinely your topology", redact(mediaAddr))
		}
	}
	return u.String(), nil
}
