// Package httpdev is a generic HTTP/webhook driver for the device engine.
//
// It is the escape hatch every hub needs: the device that speaks no standard
// protocol but exposes a REST endpoint, and the relay board whose entire API is
// a URL. It is deliberately the first driver written against the seam because
// it needs no external dependency — standard library only, no CGO.
//
// # What it is
//
// A device is DECLARED, not discovered. The operator states the device's id,
// kind, zone, catalogue capabilities, one HTTP request template per verb, and
// optionally one or more read requests with a dotted path per metric. Discover
// therefore touches no network: it returns what was configured, annotated with
// what the driver last observed.
//
// # What it is NOT
//
//   - It does not invent verbs. Capabilities come from the catalogue and
//     devices.Device.Validate rejects anything else, so an operator cannot
//     widen the verb space — or dodge a tier — through config.
//   - It does not read config from disk. Config is a plain struct; the hub's
//     config wiring owns file formats.
//   - It is not a JSONPath engine. See lookupPath for the whole path grammar.
//
// # Why the error mapping is the product
//
// Anyone can POST a URL. The reason this package exists is that the seam
// distinguishes "it did not happen" (devices.ErrUnreachable) from "I cannot
// tell whether it happened" (devices.ErrIndeterminate), and HTTP is exactly the
// transport where that distinction is both real and easy to get wrong. A gate
// that may or may not have opened is not a failure, and telling a resident it
// failed is a lie that they act on. The full mapping is documented on
// classifyStatus and on Driver.Execute.
package httpdev

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// Defaults applied by New when a Config field is zero.
const (
	DefaultDriverID         = "http"
	DefaultTimeout          = 5 * time.Second
	DefaultMaxResponseBytes = 64 << 10
)

// Config is the whole configuration surface. It is parsed by the hub — this
// package never touches the filesystem.
type Config struct {
	// ID is the driver id the registry namespaces device keys with. Defaults to
	// DefaultDriverID. It must not contain ':' because the registry splits a
	// device key at the FIRST colon to recover the driver id.
	ID string
	// Timeout bounds each individual HTTP request, including connect, TLS and
	// body read. Defaults to DefaultTimeout. It is applied on top of the
	// caller's context, never instead of it.
	Timeout time.Duration
	// MaxResponseBytes bounds how much of a response body is read into memory.
	// Defaults to DefaultMaxResponseBytes. A device that answers with a
	// gigabyte must not be able to take the hub down.
	MaxResponseBytes int64
	// Client is an optional HTTP client, for pinning a private CA or for tests.
	// A copy is taken and its CheckRedirect is replaced unconditionally — the
	// cross-host redirect refusal is not negotiable from config.
	Client *http.Client
	// Devices are the declared devices. Zero devices is legal.
	Devices []DeviceConfig
}

// DeviceConfig declares one device and its request templates.
type DeviceConfig struct {
	// ID must be unique within this driver and stable across restarts: the
	// registry reconciles persisted state on it.
	ID   string
	Kind devices.Kind
	Name string
	Zone string
	// Capabilities are catalogue ids. Validated through devices.Device.Validate.
	Capabilities []devices.CapabilityID

	// AllowPlaintext permits http:// URLs for this device. Off by default: a
	// plaintext actuation URL on a routed network is an open relay for anyone
	// on the path. Intended for a LAN relay board that has no TLS at all, and
	// it is per-device so one such board does not downgrade the whole hub.
	AllowPlaintext bool
	// Headers are sent on every request for this device (an API key, a bearer
	// token). Values are never logged.
	Headers map[string]string

	// Actions map a verb to the request that performs it. A verb with no entry
	// is devices.ErrUnsupported. Every verb here must be offered by one of the
	// device's declared capabilities.
	Actions map[devices.Verb]Action
	// Reads are the requests Driver.Read issues, in order. Each is a GET.
	Reads []ReadSpec
}

// Action is one verb's HTTP request template.
type Action struct {
	// Method is one of GET, HEAD, POST, PUT, PATCH, DELETE.
	Method string
	// URL is the request URL. It may contain the placeholder {{<arg>}} where
	// <arg> is the verb's declared numeric argument (VerbSpec.Arg) — "level",
	// "celsius", "seconds".
	URL string
	// Body is an optional request body, with the same placeholder.
	Body string
	// ContentType defaults to application/json when Body is non-empty.
	ContentType string
	// Idempotent declares that re-issuing this exact request is harmless and
	// that the device's resulting state is the same whether it ran once or
	// twice. It is DECLARED, never inferred from the method: a relay board's
	// GET /relay/1/on actuates, and treating GET as evidence of idempotence
	// would silently downgrade the honesty of the error mapping.
	//
	// It changes exactly one thing: a 5xx to a non-idempotent action is
	// devices.ErrIndeterminate, whereas a 5xx to an idempotent one is a plain
	// failure the caller may safely retry.
	Idempotent bool
}

// ReadSpec is one telemetry request and the metrics extracted from its JSON
// response. Reads are always GET: Driver.Read must not actuate, and a method
// with a body is indistinguishable from an actuation.
type ReadSpec struct {
	URL string
	// Metrics name what to extract and where from. Metric names use the
	// capability's own vocabulary ("level", "celsius", "kw", "percent").
	Metrics []Metric
}

// Metric extracts one Reading from the decoded response.
type Metric struct {
	// Metric is the Reading.Metric name. Must be unique within a device.
	Metric string
	// Path is a dotted path into the JSON document — see lookupPath for the
	// complete grammar. Empty selects the whole document.
	Path string
}

// allowedMethods is closed on purpose. An arbitrary method string is a header
// injection surface and there is no device that needs one.
var allowedMethods = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodPost: true,
	http.MethodPut: true, http.MethodPatch: true, http.MethodDelete: true,
}

// action is the validated, immutable form of an Action.
type action struct {
	verb        devices.Verb
	method      string
	url         string
	body        string
	contentType string
	idempotent  bool
	// argName is the verb's declared numeric argument, "" when it takes none.
	argName string
}

type readSpec struct {
	url     string
	metrics []Metric
}

// device is the validated, immutable form of a DeviceConfig. Nothing mutates it
// after New returns, which is most of why the driver is concurrency-safe.
type device struct {
	model   devices.Device
	headers map[string]string
	actions map[devices.Verb]action
	reads   []readSpec
}

func configErr(format string, a ...any) error {
	return fmt.Errorf("httpdev: config: "+format, a...)
}

// validate turns a DeviceConfig into a device, refusing anything it cannot
// prove safe. Every check here fails the hub's startup rather than a resident's
// evening.
func (dc DeviceConfig) validate() (device, error) {
	model := devices.Device{
		ID:           dc.ID,
		Kind:         dc.Kind,
		Name:         dc.Name,
		Zone:         dc.Zone,
		Capabilities: append([]devices.CapabilityID(nil), dc.Capabilities...),
		Availability: devices.AvailUnknown,
	}
	// The catalogue check lives in the engine, not here. A driver that
	// re-implemented it could drift from it.
	if err := model.Validate(); err != nil {
		return device{}, configErr("%v", err)
	}
	if dc.Name == "" {
		return device{}, configErr("device %q has no name", dc.ID)
	}

	d := device{model: model, actions: map[devices.Verb]action{}}

	var err error
	if d.headers, err = validateHeaders(dc.ID, dc.Headers); err != nil {
		return device{}, err
	}

	for v, a := range dc.Actions {
		spec, _, ok := model.Supports(v)
		if !ok {
			return device{}, configErr("device %q declares an action for verb %q, "+
				"which none of its capabilities offer", dc.ID, v)
		}
		built, err := buildAction(dc, v, spec, a)
		if err != nil {
			return device{}, err
		}
		d.actions[v] = built
	}

	seen := map[string]bool{}
	for i, r := range dc.Reads {
		if err := checkURL(dc, r.URL, fmt.Sprintf("read %d", i)); err != nil {
			return device{}, err
		}
		if len(r.Metrics) == 0 {
			return device{}, configErr("device %q read %d declares no metrics", dc.ID, i)
		}
		for _, m := range r.Metrics {
			if m.Metric == "" {
				return device{}, configErr("device %q read %d has a metric with no name", dc.ID, i)
			}
			if seen[m.Metric] {
				return device{}, configErr("device %q declares metric %q twice", dc.ID, m.Metric)
			}
			seen[m.Metric] = true
			if err := checkPath(m.Path); err != nil {
				return device{}, configErr("device %q metric %q: %v", dc.ID, m.Metric, err)
			}
		}
		d.reads = append(d.reads, readSpec{url: r.URL, metrics: append([]Metric(nil), r.Metrics...)})
	}
	return d, nil
}

func validateHeaders(deviceID string, in map[string]string) (map[string]string, error) {
	if len(in) == 0 {
		return nil, nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		if k == "" {
			return nil, configErr("device %q has a header with an empty name", deviceID)
		}
		// Header values routinely hold credentials, so the name is safe to name
		// in an error and the value never is.
		if strings.ContainsAny(k, "\r\n") || strings.ContainsAny(v, "\r\n") {
			return nil, configErr("device %q header %q contains a newline", deviceID, k)
		}
		out[k] = v
	}
	return out, nil
}

func buildAction(dc DeviceConfig, v devices.Verb, spec devices.VerbSpec, a Action) (action, error) {
	m := strings.ToUpper(strings.TrimSpace(a.Method))
	if m == "" {
		return action{}, configErr("device %q verb %q has no method", dc.ID, v)
	}
	if !allowedMethods[m] {
		return action{}, configErr("device %q verb %q uses method %q; allowed: %s",
			dc.ID, v, a.Method, strings.Join(sortedMethods(), ", "))
	}
	if err := checkURL(dc, a.URL, fmt.Sprintf("verb %q", v)); err != nil {
		return action{}, err
	}

	// Placeholder discipline. Only the verb's own declared argument may appear,
	// and if the verb HAS an argument the template must use it — otherwise
	// "set level 20" and "set level 90" would send byte-identical requests and
	// the hub would report a change that never happened.
	found := placeholders(a.URL)
	found = append(found, placeholders(a.Body)...)
	for _, p := range found {
		if p != spec.Arg {
			return action{}, configErr("device %q verb %q references unknown placeholder {{%s}}; "+
				"the only substitution is the verb's declared argument", dc.ID, v, p)
		}
	}
	if spec.Arg != "" && len(found) == 0 {
		return action{}, configErr("device %q verb %q takes argument %q but its template never uses {{%s}}",
			dc.ID, v, spec.Arg, spec.Arg)
	}

	ct := a.ContentType
	if a.Body != "" && ct == "" {
		ct = "application/json"
	}
	if strings.ContainsAny(ct, "\r\n") {
		return action{}, configErr("device %q verb %q content type contains a newline", dc.ID, v)
	}
	return action{
		verb: v, method: m, url: a.URL, body: a.Body,
		contentType: ct, idempotent: a.Idempotent, argName: spec.Arg,
	}, nil
}

func sortedMethods() []string {
	out := make([]string, 0, len(allowedMethods))
	for m := range allowedMethods {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// checkURL enforces the transport rules that cannot be relaxed at request time:
// a known scheme, HTTPS unless the device explicitly opted into plaintext, a
// host, and NO credentials in the URL. Userinfo is refused outright rather than
// redacted at log time, because the only way to guarantee a credential is never
// logged is for it not to be there.
func checkURL(dc DeviceConfig, raw, where string) error {
	if raw == "" {
		return configErr("device %q %s has no URL", dc.ID, where)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return configErr("device %q %s has an unparseable URL", dc.ID, where)
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !dc.AllowPlaintext {
			return configErr("device %q %s uses http://; set AllowPlaintext to accept "+
				"plaintext for this device", dc.ID, where)
		}
	default:
		return configErr("device %q %s uses scheme %q; only http and https are supported",
			dc.ID, where, u.Scheme)
	}
	if u.Host == "" {
		return configErr("device %q %s has no host", dc.ID, where)
	}
	if u.User != nil {
		return configErr("device %q %s embeds credentials in the URL; put them in Headers instead",
			dc.ID, where)
	}
	return nil
}

// placeholders returns every {{name}} occurrence in s, in order. Unterminated
// "{{" is ignored — buildAction's whitelist means an unrecognised placeholder
// can never be substituted anyway.
func placeholders(s string) []string {
	var out []string
	for {
		i := strings.Index(s, "{{")
		if i < 0 {
			return out
		}
		rest := s[i+2:]
		j := strings.Index(rest, "}}")
		if j < 0 {
			return out
		}
		out = append(out, rest[:j])
		s = rest[j+2:]
	}
}
