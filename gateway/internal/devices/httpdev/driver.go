package httpdev

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// Driver is the generic HTTP/webhook driver. Safe for concurrent use: the
// device table is built once by New and never mutated, and the only mutable
// state — last-observed availability and health — is behind one mutex.
type Driver struct {
	id        string
	timeout   time.Duration
	maxBytes  int64
	client    *http.Client
	ownClient bool

	// devices is read-only after New.
	devices map[string]*device
	order   []string

	now func() time.Time

	mu     sync.Mutex
	state  map[string]deviceState
	health devices.Health
}

type deviceState struct {
	avail    devices.Availability
	lastSeen time.Time
}

var (
	_ devices.Driver = (*Driver)(nil)
	_ devices.Closer = (*Driver)(nil)
)

// errCrossHostRedirect is returned from CheckRedirect. It is a sentinel so the
// error mapping can tell a refused redirect (the request WAS delivered) apart
// from a dial failure (it was not).
var errCrossHostRedirect = errors.New("httpdev: refused redirect to a different host")

// New validates the config and returns a driver. Every configuration problem is
// an error here, at hub startup, rather than a surprise at actuation time.
func New(cfg Config) (*Driver, error) {
	id := cfg.ID
	if id == "" {
		id = DefaultDriverID
	}
	if strings.ContainsAny(id, ": \t\r\n") {
		return nil, configErr("driver id %q must not contain ':' or whitespace; the registry "+
			"splits a device key at the first colon to recover the driver id", id)
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

	d := &Driver{
		id:       id,
		timeout:  timeout,
		maxBytes: maxBytes,
		devices:  map[string]*device{},
		state:    map[string]deviceState{},
		now:      time.Now,
	}

	for _, dc := range cfg.Devices {
		if _, dup := d.devices[dc.ID]; dup {
			return nil, configErr("device %q declared twice", dc.ID)
		}
		built, err := dc.validate()
		if err != nil {
			return nil, err
		}
		dev := built
		d.devices[dc.ID] = &dev
		d.order = append(d.order, dc.ID)
		d.state[dc.ID] = deviceState{avail: devices.AvailUnknown}
	}
	sort.Strings(d.order)

	if cfg.Client != nil {
		cp := *cfg.Client
		d.client = &cp
	} else {
		d.client = &http.Client{}
		d.ownClient = true
	}
	// Not negotiable from config: a redirect may not move the request to
	// another host. Following one would send this device's credentials —
	// they are on the request as headers — to a host the operator never named.
	d.client.CheckRedirect = checkRedirect
	// Timeouts are per-request, applied through the context, so that a caller's
	// shorter deadline still wins.
	d.client.Timeout = 0

	d.health = devices.Health{
		OK:     true,
		Detail: fmt.Sprintf("%d device(s) configured; no request issued yet", len(d.devices)),
		Since:  d.now(),
	}
	return d, nil
}

func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("httpdev: too many redirects")
	}
	if req.URL.Host != via[0].URL.Host {
		return errCrossHostRedirect
	}
	return nil
}

func (d *Driver) ID() string { return d.id }

// Discover returns the declared devices. It issues no request — a declared
// fleet has nothing to discover, and Discover must not actuate. Availability is
// what the driver last observed, so a device stays AvailUnknown until something
// has actually talked to it.
func (d *Driver) Discover(_ context.Context) ([]devices.Device, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]devices.Device, 0, len(d.order))
	for _, id := range d.order {
		dev := d.devices[id].model
		st := d.state[id]
		dev.Availability = st.avail
		dev.LastSeen = st.lastSeen
		out = append(out, dev)
	}
	return out, nil
}

// Execute performs one verb by issuing its configured request.
//
// The mapping from transport outcome to seam error, in the order it is applied:
//
//	unknown device id                     -> ErrUnknownDevice
//	verb not in the device's capabilities -> ErrUnsupported
//	verb with no configured template      -> ErrUnsupported
//	DNS failure, connection refused,
//	  TLS failure, timeout BEFORE the
//	  request was written                 -> ErrUnreachable   (it did NOT happen)
//	request written, no or partial
//	  response (timeout, reset, refused
//	  cross-host redirect)                -> ErrIndeterminate (cannot tell)
//	2xx                                   -> nil              (it happened)
//	404                                   -> ErrUnknownDevice
//	405, 501                              -> ErrUnsupported
//	5xx, action not declared idempotent   -> ErrIndeterminate
//	5xx, action declared idempotent       -> plain failure (safe to retry)
//	any other status                      -> plain failure (device refused it)
//
// The written/not-written split is measured, not guessed: an httptrace hook
// records whether the request reached the wire. That is the whole point. For a
// TierPhysicalAccess or TierHazardousMotion verb, "the gate may have opened" and
// "the gate did not open" are different facts, and reporting the first as the
// second is a lie a resident will act on.
func (d *Driver) Execute(ctx context.Context, deviceID string, v devices.Verb, args map[string]float64) error {
	dev, ok := d.devices[deviceID]
	if !ok {
		return devices.ErrUnknownDevice
	}
	// The registry already checked this. Check it again anyway: a driver
	// reachable by another path must not depend on someone else's validation.
	if _, _, ok := dev.model.Supports(v); !ok {
		return devices.ErrUnsupported
	}
	act, ok := dev.actions[v]
	if !ok {
		return devices.ErrUnsupported
	}
	rawURL, body, err := act.render(args)
	if err != nil {
		return err
	}

	res := d.do(ctx, act.method, rawURL, body, act.contentType, dev.headers)
	target := fmt.Sprintf("device %q: %s %s", deviceID, act.method, redact(rawURL))

	if res.err != nil {
		if !res.wrote {
			return d.fail(deviceID, devices.AvailOffline,
				fmt.Errorf("httpdev: %s: %s: %w", target, cause(res.err), devices.ErrUnreachable))
		}
		return d.fail(deviceID, devices.AvailDegraded,
			fmt.Errorf("httpdev: %s: request was sent but %s: %w", target, cause(res.err), devices.ErrIndeterminate))
	}
	if err := classifyStatus(res.status, act.idempotent); err != nil {
		avail := devices.AvailDegraded
		if errors.Is(err, devices.ErrUnknownDevice) {
			avail = devices.AvailOffline
		}
		return d.fail(deviceID, avail, fmt.Errorf("httpdev: %s: %w", target, err))
	}
	d.succeed(deviceID)
	return nil
}

// Read issues the device's configured read requests and maps the JSON responses
// onto readings.
//
// A read actuates nothing, so its mapping is simpler and deliberately different
// from Execute's: ANY transport failure is ErrUnreachable, whether or not the
// request reached the wire. There is no action whose outcome could be in doubt,
// so ErrIndeterminate would overstate the uncertainty.
func (d *Driver) Read(ctx context.Context, deviceID string) ([]devices.Reading, error) {
	dev, ok := d.devices[deviceID]
	if !ok {
		return nil, devices.ErrUnknownDevice
	}
	if len(dev.reads) == 0 {
		return nil, devices.ErrUnsupported
	}

	var out []devices.Reading
	for _, spec := range dev.reads {
		target := fmt.Sprintf("device %q: GET %s", deviceID, redact(spec.url))
		res := d.do(ctx, http.MethodGet, spec.url, "", "", dev.headers)
		if res.err != nil {
			return nil, d.fail(deviceID, devices.AvailOffline,
				fmt.Errorf("httpdev: %s: %s: %w", target, cause(res.err), devices.ErrUnreachable))
		}
		// Reads are idempotent by construction, so a 5xx here is a plain
		// failure: nothing was actuated and a retry is free.
		if err := classifyStatus(res.status, true); err != nil {
			avail := devices.AvailDegraded
			if errors.Is(err, devices.ErrUnknownDevice) {
				avail = devices.AvailOffline
			}
			return nil, d.fail(deviceID, avail, fmt.Errorf("httpdev: %s: %w", target, err))
		}
		if res.truncated {
			return nil, d.fail(deviceID, devices.AvailDegraded,
				fmt.Errorf("httpdev: %s: response exceeded %d bytes", target, d.maxBytes))
		}
		if res.bodyErr != nil {
			return nil, d.fail(deviceID, devices.AvailDegraded,
				fmt.Errorf("httpdev: %s: %s while reading the response: %w",
					target, cause(res.bodyErr), devices.ErrUnreachable))
		}

		var doc any
		dec := json.NewDecoder(bytes.NewReader(res.body))
		dec.UseNumber()
		if err := dec.Decode(&doc); err != nil {
			return nil, d.fail(deviceID, devices.AvailDegraded,
				fmt.Errorf("httpdev: %s: response is not JSON", target))
		}
		at := d.now()
		for _, m := range spec.metrics {
			v, ok := lookupPath(doc, m.Path)
			if !ok {
				// A metric the response does not carry is skipped rather than
				// fabricated. Losing every metric is caught below.
				continue
			}
			val, text, ok := scalar(v)
			if !ok {
				continue
			}
			out = append(out, devices.Reading{
				DeviceID: deviceID, Metric: m.Metric, Value: val, Text: text, At: at,
			})
		}
	}
	if len(out) == 0 {
		return nil, d.fail(deviceID, devices.AvailDegraded,
			fmt.Errorf("httpdev: device %q: no declared metric was found in the response; "+
				"the device's response shape has probably changed", deviceID))
	}
	d.succeed(deviceID)
	return out, nil
}

// Health reports the driver's own last-known state. It issues no request — the
// seam forbids blocking on the network here.
func (d *Driver) Health(_ context.Context) devices.Health {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.health
}

// Close releases idle connections when the driver owns its client. A client
// supplied through Config belongs to the caller and is left alone.
func (d *Driver) Close() error {
	if d.ownClient {
		d.client.CloseIdleConnections()
	}
	return nil
}

// render substitutes the verb's single numeric argument into the URL and body.
//
// Only a float64 the registry already range-checked is ever substituted, and it
// is formatted here as a plain decimal, so a template can never be injected
// into: there is no caller-supplied string on this path at all.
func (a action) render(args map[string]float64) (string, string, error) {
	if a.argName == "" {
		return a.url, a.body, nil
	}
	v, ok := args[a.argName]
	if !ok {
		return "", "", fmt.Errorf("httpdev: verb %q requires argument %q", a.verb, a.argName)
	}
	// NaN slips through the registry's range check — `NaN < Min` and
	// `NaN > Max` are both false — so it has to be refused here.
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return "", "", fmt.Errorf("httpdev: verb %q argument %q is not a finite number", a.verb, a.argName)
	}
	lit := strconv.FormatFloat(v, 'f', -1, 64)
	ph := "{{" + a.argName + "}}"
	return strings.ReplaceAll(a.url, ph, lit), strings.ReplaceAll(a.body, ph, lit), nil
}

// attempt is one request's raw outcome, before it is mapped onto the seam.
type attempt struct {
	// wrote reports whether the request reached the wire, per httptrace.
	wrote bool
	// err is a transport error: no usable response was received.
	err error

	status    int
	body      []byte
	truncated bool
	// bodyErr is a failure reading the body AFTER a status was received.
	bodyErr error
}

func (d *Driver) do(ctx context.Context, method, rawURL, body, contentType string, headers map[string]string) attempt {
	reqCtx, cancel := context.WithTimeout(ctx, d.timeout)
	defer cancel()

	var wrote atomic.Bool
	reqCtx = httptrace.WithClientTrace(reqCtx, &httptrace.ClientTrace{
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err == nil {
				wrote.Store(true)
			}
		},
	})

	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(reqCtx, method, rawURL, rdr)
	if err != nil {
		// The URL was validated at config time, so this can only be a
		// substitution that produced something unusable. Nothing was sent.
		return attempt{err: fmt.Errorf("httpdev: could not build the request")}
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		// The *url.Error is deliberately NOT wrapped: it stringifies the full
		// URL, query string included, and that is exactly where a device's API
		// key lives. cause() extracts the classification instead.
		return attempt{wrote: wrote.Load(), err: err}
	}
	defer resp.Body.Close()

	b, rerr := io.ReadAll(io.LimitReader(resp.Body, d.maxBytes+1))
	if int64(len(b)) > d.maxBytes {
		return attempt{wrote: true, status: resp.StatusCode, truncated: true}
	}
	return attempt{wrote: true, status: resp.StatusCode, body: b, bodyErr: rerr}
}

// classifyStatus maps a response status onto the seam's errors.
//
//	2xx      -> nil. The device answered; the action happened.
//	404      -> ErrUnknownDevice. The endpoint for this device is gone: either
//	            the device id moved or the config points at nothing.
//	405, 501 -> ErrUnsupported. The device is there and will not do this.
//	5xx      -> the device broke while holding the request. For a non-idempotent
//	            action that is genuinely indeterminate: a relay that faults after
//	            energising still energised. For a declared-idempotent one the
//	            caller can simply retry, so a plain failure is both honest and
//	            more useful.
//	other    -> a plain failure. 401, 403, 409 and friends all mean the device
//	            received the request and declined it, so the action did not
//	            happen — which is what a non-nil error already says.
func classifyStatus(code int, idempotent bool) error {
	switch {
	case code >= 200 && code < 300:
		return nil
	case code == http.StatusNotFound:
		return fmt.Errorf("device answered 404: %w", devices.ErrUnknownDevice)
	case code == http.StatusMethodNotAllowed, code == http.StatusNotImplemented:
		return fmt.Errorf("device answered %d: %w", code, devices.ErrUnsupported)
	case code >= 500:
		if idempotent {
			return fmt.Errorf("device answered %d", code)
		}
		return fmt.Errorf("device answered %d after a non-idempotent request: %w",
			code, devices.ErrIndeterminate)
	default:
		return fmt.Errorf("device answered %d", code)
	}
}

// cause classifies a transport error into short operator-facing text. It never
// includes the error's own message, because a *url.Error carries the full URL.
func cause(err error) string {
	switch {
	case errors.Is(err, errCrossHostRedirect):
		return "refused a redirect to a different host"
	case errors.Is(err, context.DeadlineExceeded):
		return "timed out"
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case errors.Is(err, io.ErrUnexpectedEOF), errors.Is(err, io.EOF):
		return "the connection closed early"
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "the name did not resolve"
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return "the connection failed"
	}
	return "the request failed"
}

// redact reduces a URL to scheme and host for logging. Path and query are
// dropped, not sanitised: relay boards routinely put an API key in the path
// ("/api/KEY/relay/1/on") and hosted devices put one in the query, and there is
// no reliable way to tell a secret path segment from a descriptive one. The
// device id is carried alongside, so an operator can still tell what failed.
func redact(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "(url)"
	}
	return u.Scheme + "://" + u.Host
}

// fail records the outcome and returns the error unchanged, so call sites read
// as one statement.
func (d *Driver) fail(deviceID string, avail devices.Availability, err error) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	st := d.state[deviceID]
	st.avail = avail
	d.state[deviceID] = st
	d.setHealthLocked(false, fmt.Sprintf("last request to device %q failed", deviceID))
	return err
}

func (d *Driver) succeed(deviceID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.state[deviceID] = deviceState{avail: devices.AvailOnline, lastSeen: d.now()}
	d.setHealthLocked(true, "last request succeeded")
}

// setHealthLocked keeps Since pinned to when the current OK state began.
// Health.Detail names the device id, never an address or a header — the console
// shows it to an operator.
func (d *Driver) setHealthLocked(ok bool, detail string) {
	if d.health.OK != ok {
		d.health.Since = d.now()
	}
	d.health.OK = ok
	d.health.Detail = detail
}
