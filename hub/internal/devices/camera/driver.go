package camera

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vul-os/aql/hub/internal/devices"
)

// Thresholds for calling a flowing stream unusable.
//
// Both are judgement calls, stated as such rather than dressed up as science.
//
// lossDegradeRate: RTP/H.264 carries no FEC, so a lost packet can destroy a
// whole slice and smear or freeze the picture until the next keyframe. Visible
// damage starts well below 5%; 2% is chosen as clearly-broken rather than
// borderline, because this flips an operator-visible state.
//
// minLossSample: the probe watches for roughly two seconds. On a small burst
// one dropped packet is a large percentage, and degrading on that would make
// the state flap between polls for a camera that is fine. 100 expected packets
// is a few tenths of a second of real video and is cleared easily by any
// working stream — while a stream too short to reach it is not evidence of
// anything either way.
const (
	lossDegradeRate = 0.02
	minLossSample   = 100
)

// Driver exposes discovered and declared ONVIF cameras across the device seam.
//
// It reports two things and no others: whether a camera answers, and where its
// stream would come from. devices.CapCameraFeed offers exactly one verb —
// status, at devices.TierRead — so there is nothing here that can move a
// camera, arm a camera, or open anything. That is not a limitation this driver
// works around; it is the honest shape of a package with no pipeline behind it.
//
// Safe for concurrent use. All mutable state is behind one mutex, and no
// network call is made while holding it.
type Driver struct {
	id               string
	soap             *soapClient
	disc             DiscoveryConfig
	creds            map[string]Credential
	requireHTTPS     bool
	allowForeignHost bool
	streamTTL        time.Duration
	verifyStream     bool
	verifyMediaFlow  bool
	mediaWindow      time.Duration
	rtspTimeout      time.Duration
	ownClient        bool
	now              func() time.Time

	mu     sync.Mutex
	cams   map[string]*cameraState
	health devices.Health
}

var (
	_ devices.Driver = (*Driver)(nil)
	_ devices.Closer = (*Driver)(nil)
)

// cameraState is everything the driver believes about one camera. Written only
// under Driver.mu.
type cameraState struct {
	id      string
	name    string
	zone    string
	service string
	static  bool

	avail    devices.Availability
	lastSeen time.Time
	// detail is operator-facing text. It never carries a credential and never
	// carries a full address.
	detail string

	mediaAddr  string
	profile    Profile
	streamURI  string
	resolvedAt time.Time
}

// Camera is a read-only snapshot of what the driver knows, for a caller that
// wants more than the generic device model carries — specifically the stream
// address, which the seam has no field for.
type Camera struct {
	ID             string
	Name           string
	Zone           string
	ServiceAddress string
	Static         bool
	Availability   devices.Availability
	LastSeen       time.Time
	Detail         string
	// StreamAddress is where the stream comes from. Empty until it has been
	// resolved. This view carries NO credential by design — StreamTargets is
	// the one that does, for the caller that is about to open the stream.
	StreamAddress string
	Profile       Profile
	ResolvedAt    time.Time
}

// New validates the config and returns a driver. Every configuration problem is
// an error here, at hub startup, rather than a surprise at poll time.
func New(cfg Config) (*Driver, error) {
	id := cfg.ID
	if id == "" {
		id = DefaultDriverID
	}
	if err := devices.ValidateDriverID(id); err != nil {
		return nil, configErr("%v", err)
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	if timeout < 0 {
		return nil, configErr("timeout must be positive")
	}
	maxBytes := cfg.MaxResponseBytes
	if maxBytes == 0 {
		maxBytes = DefaultMaxResponseBytes
	}
	if maxBytes < 0 {
		return nil, configErr("max response bytes must be positive")
	}
	ttl := cfg.StreamTTL
	if ttl == 0 {
		ttl = DefaultStreamTTL
	}
	if ttl < 0 {
		return nil, configErr("stream ttl must be positive")
	}

	d := &Driver{
		id:               id,
		disc:             cfg.Discovery,
		requireHTTPS:     cfg.RequireHTTPS,
		allowForeignHost: cfg.AcceptForeignServiceAddress,
		streamTTL:        ttl,
		verifyStream:     cfg.VerifyStream || cfg.VerifyMediaFlow,
		verifyMediaFlow:  cfg.VerifyMediaFlow,
		mediaWindow:      cfg.MediaFlowWindow,
		rtspTimeout:      timeout,
		now:              time.Now,
		cams:             map[string]*cameraState{},
	}
	// The discovery half inherits the foreign-address decision unless it was
	// set on its own, so an operator cannot accidentally harden one half and
	// leave the other open.
	if cfg.AcceptForeignServiceAddress {
		d.disc.AcceptForeignServiceAddress = true
	}

	for _, cc := range cfg.Cameras {
		st, err := cc.validate(cfg.RequireHTTPS)
		if err != nil {
			return nil, err
		}
		if _, dup := d.cams[st.id]; dup {
			return nil, configErr("camera %q declared twice", st.id)
		}
		d.cams[st.id] = st
	}

	if len(cfg.Credentials) > 0 {
		d.creds = make(map[string]Credential, len(cfg.Credentials))
		for host, c := range cfg.Credentials {
			d.creds[strings.ToLower(host)] = c
		}
	}

	client := &http.Client{}
	if cfg.Client != nil {
		cp := *cfg.Client
		client = &cp
	} else {
		d.ownClient = true
	}
	// Not negotiable from config. A redirect may not move an ONVIF request to
	// another host: the request carries this camera's credentials.
	client.CheckRedirect = checkRedirect
	// Timeouts are per-request through the context, so a caller's shorter
	// deadline still wins.
	client.Timeout = 0

	d.soap = &soapClient{
		http:     client,
		timeout:  timeout,
		maxBytes: maxBytes,
		now:      time.Now,
		nonce:    randomNonce,
	}

	detail := fmt.Sprintf("%d camera(s) declared", len(d.cams))
	if d.disc.Enabled {
		detail += "; discovery enabled, no probe sent yet"
	} else {
		detail += "; discovery disabled"
	}
	d.health = devices.Health{OK: true, Detail: detail, Since: d.now()}
	return d, nil
}

// errCrossHostRedirect is a sentinel so a refused redirect is distinguishable
// from a dial failure.
var errCrossHostRedirect = errors.New("camera: refused a redirect to a different host")

func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("camera: too many redirects")
	}
	if req.URL.Host != via[0].URL.Host {
		return errCrossHostRedirect
	}
	return nil
}

func (d *Driver) ID() string { return d.id }

// Discover runs a WS-Discovery probe when discovery is enabled, merges what
// answered with what was declared, and returns the union.
//
// It never actuates: a Probe is a question, and the only reply is a datagram.
//
// A failed probe does NOT become an error unless the driver knows of no cameras
// at all. The registry drops a driver's whole device list when Discover errors,
// and a multicast probe that lost a race on a busy switch is not a reason to
// make three statically declared cameras vanish from an operator's console. The
// failure is recorded in Health instead, where it belongs.
func (d *Driver) Discover(ctx context.Context) ([]devices.Device, error) {
	var probeErr error
	if d.disc.Enabled {
		matches, err := d.disc.Probe(ctx)
		if err != nil {
			probeErr = err
		} else {
			d.merge(matches)
		}
	}

	d.mu.Lock()
	out := make([]devices.Device, 0, len(d.cams))
	for _, st := range d.cams {
		out = append(out, st.model())
	}
	if probeErr != nil {
		d.setHealthLocked(false, "the discovery probe failed: "+sanitize(probeErr.Error(), 120))
	} else {
		d.setHealthLocked(true, fmt.Sprintf("%d camera(s) known", len(d.cams)))
	}
	d.mu.Unlock()

	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if probeErr != nil && len(out) == 0 {
		return nil, probeErr
	}
	return out, nil
}

// merge folds probe results into the driver's state.
//
// A declared camera is never overwritten by a discovered one — not by id and
// not by service address. The operator's configuration is an assertion; a
// ProbeMatch is a claim made by a device on the network.
func (d *Driver) merge(matches []Match) {
	d.mu.Lock()
	defer d.mu.Unlock()

	declared := map[string]bool{}
	for _, st := range d.cams {
		if st.static {
			declared[normaliseHostKey(st.service)] = true
		}
	}

	for _, m := range matches {
		if d.requireHTTPS && !strings.HasPrefix(m.ServiceAddress, "https://") {
			continue
		}
		if existing, ok := d.cams[m.DeviceID]; ok {
			if existing.static {
				continue
			}
			existing.service = m.ServiceAddress
			if m.Name != "" {
				existing.name = m.Name
			}
			if m.Location != "" {
				existing.zone = m.Location
			}
			existing.avail = devices.AvailOnline
			existing.lastSeen = m.At
			existing.detail = "answered discovery"
			continue
		}
		if declared[normaliseHostKey(m.ServiceAddress)] {
			// Already known under an operator-chosen id. Adding it again under
			// its uuid would show one camera twice.
			continue
		}
		name := m.Name
		if name == "" {
			name = "Camera " + shortID(m.DeviceID)
		}
		d.cams[m.DeviceID] = &cameraState{
			id:       m.DeviceID,
			name:     name,
			zone:     m.Location,
			service:  m.ServiceAddress,
			avail:    devices.AvailOnline,
			lastSeen: m.At,
			detail:   "answered discovery",
		}
	}
}

// Execute performs the one verb this driver has: status.
//
// Status is a question, so "the action happened" means "the camera answered".
// The check is a real request to the camera's device service, not a cached
// value: a status verb that returned the last thing the driver happened to
// believe would be a status verb that lies at exactly the moment it matters.
//
// Every other verb is devices.ErrUnsupported, twice over — once because the
// device's capabilities do not offer it, and once explicitly, because if a
// future catalogue change ever puts a second verb behind CapCameraFeed this
// driver must keep refusing it until something exists to carry it out.
func (d *Driver) Execute(ctx context.Context, deviceID string, v devices.Verb, _ map[string]float64) error {
	st, ok := d.snapshot(deviceID)
	if !ok {
		return devices.ErrUnknownDevice
	}
	// The registry already checked this. Check it again anyway: a driver
	// reachable by another path must not depend on someone else's validation.
	if _, _, ok := st.model().Supports(v); !ok {
		return devices.ErrUnsupported
	}
	if v != devices.VerbStatus {
		return devices.ErrUnsupported
	}

	cred := credentialFor(d.creds, st.service)
	if _, err := d.soap.mediaAddress(ctx, st.service, cred, d.allowForeignHost); err != nil {
		// A camera that answers but names no media service is still reachable,
		// and status asked whether it was reachable.
		if errors.Is(err, errNoMediaService) {
			d.observe(deviceID, devices.AvailDegraded, "answered, but advertises no ver10 media service")
			return nil
		}
		return d.failure(deviceID, err)
	}
	d.observe(deviceID, devices.AvailOnline, "answered a status check")
	return nil
}

// Read reports reachability and the stream address the camera advertises.
//
// Reachability is re-established on every call. The stream address is cached
// for Config.StreamTTL, because it is a property of the camera's configuration
// rather than of its current state, and re-deriving it costs two more requests
// to a device with a small CPU.
//
// Read moves no video. The "stream" reading is an address, not a stream.
func (d *Driver) Read(ctx context.Context, deviceID string) ([]devices.Reading, error) {
	st, ok := d.snapshot(deviceID)
	if !ok {
		return nil, devices.ErrUnknownDevice
	}
	cred := credentialFor(d.creds, st.service)

	mediaAddr, err := d.soap.mediaAddress(ctx, st.service, cred, d.allowForeignHost)
	if err != nil {
		return nil, d.failure(deviceID, err)
	}

	uri, prof := st.streamURI, st.profile
	fresh := uri != "" && st.mediaAddr == mediaAddr && d.now().Sub(st.resolvedAt) < d.streamTTL
	if !fresh {
		profiles, perr := d.soap.profiles(ctx, mediaAddr, cred)
		if perr != nil {
			return nil, d.failure(deviceID, perr)
		}
		prof = profiles[0]
		uri, perr = d.soap.streamURI(ctx, mediaAddr, prof.Token, cred, d.allowForeignHost)
		if perr != nil {
			return nil, d.failure(deviceID, perr)
		}
		d.recordStream(deviceID, mediaAddr, prof, uri)
	}
	at := d.now()
	readings := []devices.Reading{
		{DeviceID: deviceID, Metric: "reachable", Value: 1, At: at},
		{DeviceID: deviceID, Metric: "profile", Text: prof.Describe(), At: at},
		{DeviceID: deviceID, Metric: "stream", Text: uri, At: at},
	}

	if !d.verifyStream {
		// The address ONVIF claimed, unverified. The summary says so rather
		// than implying the stream was checked.
		d.observe(deviceID, devices.AvailOnline, "answered; stream address resolved (not verified)")
		return readings, nil
	}

	// Follow the address. This is the difference between "ONVIF gave us a URL"
	// and "that URL streams H264" — and cameras routinely want different
	// credentials on the media leg than on the device service, which is
	// precisely the failure an operator otherwise discovers in VLC.
	var (
		info StreamInfo
		flow MediaFlow
		perr error
	)
	if d.verifyMediaFlow {
		info, flow, perr = ProbeMedia(ctx, uri, cred, d.rtspTimeout, d.mediaWindow)
	} else {
		info, perr = Describe(ctx, uri, cred, d.rtspTimeout)
	}
	if perr != nil {
		// DEGRADED, not offline. The camera answered ONVIF and named a stream;
		// the stream is what did not work. Collapsing that to offline would
		// send someone to check whether the camera is powered.
		d.observe(deviceID, devices.AvailDegraded, "ONVIF answered; the stream did not: "+perr.Error())
		readings = append(readings,
			devices.Reading{DeviceID: deviceID, Metric: "stream_ok", Value: 0, At: at})
		return readings, nil
	}

	summary := "streaming " + info.Summary()
	if d.verifyMediaFlow {
		if !flow.Flowing() {
			// Described a stream, sent nothing. DEGRADED rather than online:
			// the camera is demonstrably reachable and demonstrably not
			// delivering, and "online" would tell an operator to look
			// elsewhere.
			d.observe(deviceID, devices.AvailDegraded,
				"described "+info.Summary()+" but sent no media in "+flow.Window.String())
			readings = append(readings,
				devices.Reading{DeviceID: deviceID, Metric: "stream_ok", Value: 1, At: at},
				devices.Reading{DeviceID: deviceID, Metric: "media_flowing", Value: 0, At: at})
			return readings, nil
		}
		summary = info.Summary() + " · " + flow.Summary()
		readings = append(readings,
			devices.Reading{DeviceID: deviceID, Metric: "media_flowing", Value: 1, At: at},
			devices.Reading{DeviceID: deviceID, Metric: "media_packets", Value: float64(flow.Packets), At: at},
			// Emitted whatever the verdict below. These are measurements, and
			// a caller drawing a graph of stream health needs them on the good
			// days too — a loss figure that only appears once something is
			// already wrong has no baseline to be judged against.
			devices.Reading{DeviceID: deviceID, Metric: "media_lost", Value: float64(flow.Lost), At: at},
			devices.Reading{DeviceID: deviceID, Metric: "media_expected", Value: float64(flow.Expected), At: at})

		// Flowing but lossy: DEGRADED, for the same reason "described a stream
		// and sent nothing" is. The camera is reachable and demonstrably not
		// delivering a usable picture, and "online" sends an operator looking
		// somewhere else while they stare at a smeared player.
		//
		// Guarded by a minimum sample on purpose. The probe watches for about
		// two seconds, and on a small burst one dropped packet is a large
		// percentage — degrading on that would make the state flap between
		// polls for a camera that is fine. A real stream clears this easily; a
		// short or stuttering one does not, and a short one is not evidence.
		if flow.Expected >= minLossSample && flow.LossRate() >= lossDegradeRate {
			d.observe(deviceID, devices.AvailDegraded,
				info.Summary()+" · "+flow.Summary())
			return readings, nil
		}
	}

	d.observe(deviceID, devices.AvailOnline, summary)
	readings = append(readings,
		devices.Reading{DeviceID: deviceID, Metric: "stream_ok", Value: 1, At: at},
		devices.Reading{DeviceID: deviceID, Metric: "stream_codec", Text: info.VideoCodec(), At: at},
		// Which auth the media leg demanded. "basic" means the password
		// crossed the wire in cleartext, which an operator should be able to
		// learn from the product rather than from a packet capture.
		devices.Reading{DeviceID: deviceID, Metric: "stream_auth", Text: info.AuthUsed, At: at})
	return readings, nil
}

// Health reports the driver's own last-known state. It issues no request — the
// seam forbids blocking on the network here.
func (d *Driver) Health(_ context.Context) devices.Health {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.health
}

// Close releases idle connections when the driver owns its client.
func (d *Driver) Close() error {
	if d.ownClient {
		d.soap.http.CloseIdleConnections()
	}
	return nil
}

// Cameras returns a snapshot of every known camera, sorted by id.
func (d *Driver) Cameras() []Camera {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]Camera, 0, len(d.cams))
	for _, st := range d.cams {
		out = append(out, Camera{
			ID: st.id, Name: st.name, Zone: st.zone, ServiceAddress: st.service,
			Static: st.static, Availability: st.avail, LastSeen: st.lastSeen,
			Detail: st.detail, StreamAddress: st.streamURI, Profile: st.profile,
			ResolvedAt: st.resolvedAt,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// --- state plumbing ---------------------------------------------------------

// model renders a camera as the engine's device. Kind is camera, the capability
// is the status-only feed capability, and nothing else is claimed.
func (s *cameraState) model() devices.Device {
	return devices.Device{
		ID:           s.id,
		Kind:         devices.KindCamera,
		Name:         s.name,
		Zone:         s.zone,
		Capabilities: []devices.CapabilityID{devices.CapCameraFeed},
		Availability: s.avail,
		Summary:      s.summary(),
		LastSeen:     s.lastSeen,
	}
}

// summary is the console's one-line state. It says what is known and stops:
// "online" here means the camera answered ONVIF, not that anyone can see
// through it.
func (s *cameraState) summary() string {
	switch {
	case s.streamURI != "" && s.avail == devices.AvailOnline:
		return "answering · stream address known"
	case s.avail == devices.AvailOnline:
		return "answering"
	case s.avail == devices.AvailDegraded:
		return "answering · " + s.detail
	case s.avail == devices.AvailOffline:
		return "not answering"
	default:
		return "not contacted yet"
	}
}

// snapshot copies a camera's state out from under the lock, so no network call
// is ever made while holding it.
func (d *Driver) snapshot(deviceID string) (cameraState, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	st, ok := d.cams[deviceID]
	if !ok {
		return cameraState{}, false
	}
	return *st, true
}

func (d *Driver) observe(deviceID string, avail devices.Availability, detail string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	st, ok := d.cams[deviceID]
	if !ok {
		return
	}
	st.avail = avail
	st.detail = detail
	if avail == devices.AvailOnline || avail == devices.AvailDegraded {
		st.lastSeen = d.now()
	}
	d.setHealthLocked(avail != devices.AvailOffline, fmt.Sprintf("camera %q: %s", deviceID, detail))
}

func (d *Driver) recordStream(deviceID, mediaAddr string, prof Profile, uri string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	st, ok := d.cams[deviceID]
	if !ok {
		return
	}
	st.mediaAddr = mediaAddr
	st.profile = prof
	st.streamURI = uri
	st.resolvedAt = d.now()
}

// failure maps an ONVIF-layer error onto the seam and records what it means.
//
//	the request never completed  -> devices.ErrUnreachable, offline.
//	                                The camera was not reached, full stop.
//	credentials rejected         -> a plain failure, degraded. The camera IS
//	                                reachable; telling an operator it is
//	                                unreachable sends them to look at cabling
//	                                when the problem is a password.
//	answered, but no media
//	  service or no profiles     -> a plain failure, degraded. Reachable, and
//	                                nothing to point at.
//	anything else                -> a plain failure, degraded.
//
// devices.ErrIndeterminate never appears here, and that is deliberate: nothing
// in this driver actuates, so there is no outcome that could be in doubt. A read
// that failed simply did not produce a reading.
func (d *Driver) failure(deviceID string, err error) error {
	switch {
	case isTransport(err), errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		d.observe(deviceID, devices.AvailOffline, "did not answer")
		return fmt.Errorf("%w: %s", devices.ErrUnreachable, cause(err))
	case errors.Is(err, ErrUnauthorized):
		d.observe(deviceID, devices.AvailDegraded, "rejected the configured credentials")
		return err
	case errors.Is(err, errNoMediaService):
		d.observe(deviceID, devices.AvailDegraded, "advertises no ver10 media service")
		return err
	case errors.Is(err, errNoProfiles):
		d.observe(deviceID, devices.AvailDegraded, "advertises no media profiles")
		return err
	default:
		d.observe(deviceID, devices.AvailDegraded, "answered with something this package could not use")
		return err
	}
}

// cause classifies a transport error into short operator-facing text. It never
// includes the error's own message: a *url.Error carries the full URL.
func cause(err error) string {
	switch {
	case errors.Is(err, errCrossHostRedirect):
		return "it tried to redirect the request to a different host"
	case errors.Is(err, context.DeadlineExceeded):
		return "it timed out"
	case errors.Is(err, context.Canceled):
		return "the request was cancelled"
	}
	return "the request did not complete"
}

// setHealthLocked keeps Since pinned to when the current OK state began.
func (d *Driver) setHealthLocked(ok bool, detail string) {
	if d.health.OK != ok {
		d.health.Since = d.now()
	}
	d.health.OK = ok
	d.health.Detail = detail
}

// normaliseHostKey reduces a service address to host and port, which is what
// decides whether two addresses are the same camera. The path is dropped
// because vendors differ on it for the same box (/onvif/device_service versus
// /onvif/device); the port is kept because a port-forwarded site really does
// put several cameras behind one address, and merging those would silently drop
// a camera. A duplicate row is visible and a missing camera is not.
func normaliseHostKey(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return strings.ToLower(strings.TrimSpace(raw))
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443"}[u.Scheme]
	}
	return strings.ToLower(u.Hostname()) + ":" + port
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

// StreamTarget is a resolved camera's media address and the credential that
// address needs.
type StreamTarget struct {
	// ID is the camera's driver-local id; the caller namespaces it.
	ID  string
	URL string
	// Cred is the media-leg credential. Cameras routinely want a different
	// account on the media leg than on the device service, which is why this
	// comes from the driver's own resolution rather than from a caller's guess.
	Cred Credential
}

// StreamTargets lists the cameras whose stream address has been resolved.
//
// Separate from Cameras() because that view is operator-facing and deliberately
// carries no credential — "detail ... never carries a credential", as this file
// says of the field beside it. This one does carry one, so it exists for a
// caller inside the process that is about to open the stream, and for nothing
// else. Cameras with no resolved address are omitted rather than returned with
// an empty URL: there is nothing to open.
func (d *Driver) StreamTargets() []StreamTarget {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]StreamTarget, 0, len(d.cams))
	for _, st := range d.cams {
		if st.streamURI == "" {
			continue
		}
		out = append(out, StreamTarget{
			ID: st.id, URL: st.streamURI, Cred: credentialFor(d.creds, st.service),
		})
	}
	return out
}
