package camera

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Defaults applied by New when a Config field is zero.
const (
	DefaultDriverID = "camera"
	DefaultTimeout  = 5 * time.Second
	// DefaultMaxResponseBytes bounds one SOAP reply. GetProfiles on a camera
	// with many profiles is the largest of them and is measured in tens of
	// kilobytes; a camera that answers with more than this is either broken or
	// hostile, and either way the hub must not hold it in memory.
	DefaultMaxResponseBytes int64 = 256 << 10
	// DefaultStreamTTL is how long a resolved stream address is trusted before
	// it is asked for again. Reachability is re-checked on every Read regardless
	// — it is the address, not the camera, that is cached.
	DefaultStreamTTL = 10 * time.Minute
)

// Config is the whole configuration surface. It is parsed by the hub; this
// package never touches the filesystem.
type Config struct {
	// ID is the driver id the registry namespaces device keys with. Defaults to
	// DefaultDriverID. It must not contain ':' — the registry splits a device
	// key at the FIRST colon to recover the driver id.
	ID string
	// Timeout bounds each individual ONVIF request, including connect and body
	// read. Applied on top of the caller's context, never instead of it.
	Timeout time.Duration
	// MaxResponseBytes bounds how much of a reply is read into memory.
	MaxResponseBytes int64
	// StreamTTL is how long a resolved stream address is cached.
	StreamTTL time.Duration
	// Client is an optional HTTP client, for pinning a private CA or for tests.
	// A copy is taken.
	Client *http.Client

	// Discovery configures WS-Discovery. It is off unless Enabled is set.
	Discovery DiscoveryConfig

	// Cameras are statically declared cameras, for the segments where multicast
	// does not survive the switch — which is most segments with a VLAN on them.
	// A statically declared camera always wins over a discovered one with the
	// same id or the same service address: the operator said it, and a device
	// on the network does not get to overwrite that.
	Cameras []CameraConfig

	// Credentials are ONVIF logins keyed by camera host, as it appears in the
	// service address ("192.168.1.50"). The empty key is the fallback used for
	// any host with no entry of its own. Passwords are held in memory only.
	Credentials map[string]Credential

	// RequireHTTPS refuses plaintext service addresses, discovered or declared.
	// Off by default because essentially no camera ships with usable TLS, and a
	// hub that refused them all would discover nothing. Read the package doc's
	// security note before deciding that is fine.
	RequireHTTPS bool

	// VerifyStream makes Read follow the resolved address with an RTSP
	// DESCRIBE, so the driver reports what the camera ACTUALLY streams rather
	// than the address ONVIF claimed for it. See rtsp.go.
	//
	// Off by default, and that is a cost decision rather than a safety one: a
	// probe is one extra TCP connection and one round trip per refresh, against
	// a device class that is often on a slow link and supports very few
	// concurrent sessions. A hub polling twenty cameras every five minutes
	// should opt into that, not inherit it.
	//
	// It never receives media, holds no session, and does not decode anything.
	VerifyStream bool

	// AcceptForeignServiceAddress lets a camera name a media service, or return
	// a stream address, on a host other than its own. See DiscoveryConfig for
	// the same switch applied to discovery, and for what it gives up.
	AcceptForeignServiceAddress bool
}

// CameraConfig declares one camera by hand.
type CameraConfig struct {
	// ID must be unique within this driver and stable across restarts: the
	// registry reconciles persisted state on it.
	ID   string
	Name string
	Zone string
	// ServiceAddress is the ONVIF device service URL, conventionally
	// http://<host>/onvif/device_service.
	ServiceAddress string
}

func configErr(format string, a ...any) error {
	return fmt.Errorf("camera: config: "+format, a...)
}

// validate checks a declared camera. Every problem here fails the hub's startup
// rather than a resident's evening.
func (cc CameraConfig) validate(requireHTTPS bool) (*cameraState, error) {
	if !validDeviceID(cc.ID) {
		return nil, configErr("camera id %q must be 1..64 characters of letters, digits, '-', '_' or '.'", cc.ID)
	}
	if strings.TrimSpace(cc.Name) == "" {
		return nil, configErr("camera %q has no name", cc.ID)
	}
	addr, err := checkServiceAddress(cc.ServiceAddress, requireHTTPS)
	if err != nil {
		return nil, configErr("camera %q: %v", cc.ID, err)
	}
	return &cameraState{
		id:      cc.ID,
		name:    sanitize(cc.Name, 64),
		zone:    sanitize(cc.Zone, 64),
		service: addr,
		static:  true,
		avail:   devices.AvailUnknown,
		detail:  "declared in config; not contacted yet",
	}, nil
}

// checkServiceAddress enforces the transport rules that cannot be relaxed later:
// a known scheme, a host, and NO credentials in the URL. Userinfo is refused
// outright rather than redacted at log time, because the only way to guarantee
// a credential is never logged is for it not to be there.
func checkServiceAddress(raw string, requireHTTPS bool) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", fmt.Errorf("no service address")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("service address is unparseable")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if requireHTTPS {
			return "", fmt.Errorf("service address is plaintext http and RequireHTTPS is set")
		}
	default:
		return "", fmt.Errorf("service address uses scheme %q; only http and https are supported", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("service address has no host")
	}
	if u.User != nil {
		return "", fmt.Errorf("service address embeds credentials; put them in Credentials instead")
	}
	return u.String(), nil
}

func validDeviceID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == '.':
		default:
			return false
		}
	}
	return true
}

// credentialFor resolves the login for a service address: an exact host entry
// first, then the fallback entry under the empty key.
func credentialFor(creds map[string]Credential, serviceAddr string) Credential {
	if len(creds) == 0 {
		return Credential{}
	}
	if u, err := url.Parse(serviceAddr); err == nil {
		if c, ok := creds[strings.ToLower(u.Hostname())]; ok {
			return c
		}
	}
	return creds[""]
}
