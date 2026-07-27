package httpdev

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

// Every test here talks to an httptest.Server or to a stub dialer. Nothing
// touches a real network: a driver whose tests need one cannot be trusted to
// fail the same way twice.

// lampConfig is the worked example: a dimmable lamp with on/off/set and a read.
func lampConfig(base string) DeviceConfig {
	return DeviceConfig{
		ID: "lamp-1", Kind: devices.KindLighting, Name: "Garden Lights", Zone: "Exterior",
		Capabilities:   []devices.CapabilityID{devices.CapDimmable},
		AllowPlaintext: true,
		Headers:        map[string]string{"Authorization": "Bearer s3cret"},
		Actions: map[devices.Verb]Action{
			devices.VerbOn:  {Method: http.MethodPost, URL: base + "/lamp/on", Idempotent: true},
			devices.VerbOff: {Method: http.MethodPost, URL: base + "/lamp/off", Idempotent: true},
			devices.VerbSet: {Method: http.MethodPut, URL: base + "/lamp/level",
				Body: `{"level":{{level}}}`},
		},
		Reads: []ReadSpec{{URL: base + "/lamp", Metrics: []Metric{
			{Metric: "level", Path: "state.level"},
			{Metric: "state", Path: "state.mode"},
		}}},
	}
}

func newDriver(t *testing.T, devs ...DeviceConfig) *Driver {
	t.Helper()
	d, err := New(Config{ID: "http", Timeout: 2 * time.Second, Devices: devs})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return d
}

// --- the happy paths, only enough of them to make the failure paths meaningful.

func TestExecuteSuccessAndTemplating(t *testing.T) {
	var gotMethod, gotPath, gotBody, gotAuth, gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbSet,
		map[string]float64{"level": 42}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotMethod != http.MethodPut || gotPath != "/lamp/level" {
		t.Fatalf("got %s %s, want PUT /lamp/level", gotMethod, gotPath)
	}
	if gotBody != `{"level":42}` {
		t.Fatalf("body = %q, want the argument substituted", gotBody)
	}
	if gotAuth != "Bearer s3cret" {
		t.Fatalf("configured header was not sent: %q", gotAuth)
	}
	if gotCT != "application/json" {
		t.Fatalf("content type = %q, want the application/json default", gotCT)
	}
}

func TestExecuteSubstitutesIntoTheURLToo(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
	}))
	defer srv.Close()

	d := newDriver(t, DeviceConfig{
		ID: "thermo-1", Kind: devices.KindClimate, Name: "Thermostat",
		Capabilities: []devices.CapabilityID{devices.CapSetpoint}, AllowPlaintext: true,
		Actions: map[devices.Verb]Action{
			devices.VerbSet: {Method: http.MethodPost, URL: srv.URL + "/set/{{celsius}}"},
		},
	})
	if err := d.Execute(context.Background(), "thermo-1", devices.VerbSet,
		map[string]float64{"celsius": 21.5}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if gotPath != "/set/21.5" {
		t.Fatalf("path = %q, want /set/21.5", gotPath)
	}
}

func TestDiscoverIssuesNoRequestAndStartsUnknown(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits++ }))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	found, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if hits != 0 {
		t.Fatalf("Discover made %d request(s); it must not touch the network", hits)
	}
	if len(found) != 1 {
		t.Fatalf("got %d devices, want 1", len(found))
	}
	if found[0].Availability != devices.AvailUnknown {
		t.Fatalf("availability = %q before any contact; a device nobody has talked to "+
			"must not render as live", found[0].Availability)
	}
	// And it survives the engine's own validation, which is the actual contract.
	if err := found[0].Validate(); err != nil {
		t.Fatalf("declared device fails devices.Validate: %v", err)
	}

	if err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	found, _ = d.Discover(context.Background())
	if found[0].Availability != devices.AvailOnline {
		t.Fatalf("availability = %q after a successful call, want online", found[0].Availability)
	}
	if found[0].LastSeen.IsZero() {
		t.Fatal("LastSeen was not set after a successful call")
	}
}

// --- the error mapping. This is the driver's actual product.

func TestUnknownDeviceID(t *testing.T) {
	d := newDriver(t)
	if err := d.Execute(context.Background(), "nope", devices.VerbOn, nil); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("Execute on an unowned id = %v, want ErrUnknownDevice", err)
	}
	if _, err := d.Read(context.Background(), "nope"); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("Read on an unowned id = %v, want ErrUnknownDevice", err)
	}
}

func TestVerbWithNoTemplateIsUnsupported(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	cfg := lampConfig(srv.URL)
	delete(cfg.Actions, devices.VerbOff)
	d := newDriver(t, cfg)

	// A catalogue verb the device offers but the config never templated.
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbOff, nil); !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("verb with no template = %v, want ErrUnsupported", err)
	}
	// A catalogue verb none of its capabilities offer. The registry would have
	// refused this first; the driver must refuse it independently.
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbOpen, nil); !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("verb outside the device's capabilities = %v, want ErrUnsupported", err)
	}
}

func TestReadWithNoReadSpecIsUnsupported(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	cfg := lampConfig(srv.URL)
	cfg.Reads = nil
	d := newDriver(t, cfg)
	if _, err := d.Read(context.Background(), "lamp-1"); !errors.Is(err, devices.ErrUnsupported) {
		t.Fatalf("Read with no read spec = %v, want ErrUnsupported", err)
	}
}

// Connection refused: nothing was written, so the action did NOT happen.
func TestConnectionRefusedIsUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	base := srv.URL
	srv.Close() // the port is now closed; dialling it is refused.

	d := newDriver(t, lampConfig(base))
	err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("connection refused = %v, want ErrUnreachable", err)
	}
	if errors.Is(err, devices.ErrIndeterminate) {
		t.Fatal("a refused connection must not be reported as indeterminate: " +
			"nothing was sent, so the action definitely did not happen")
	}
	if _, rerr := d.Read(context.Background(), "lamp-1"); !errors.Is(rerr, devices.ErrUnreachable) {
		t.Fatalf("Read against a refused connection = %v, want ErrUnreachable", rerr)
	}
	found, _ := d.Discover(context.Background())
	if found[0].Availability != devices.AvailOffline {
		t.Fatalf("availability = %q after a refused connection, want offline", found[0].Availability)
	}
}

// A DNS failure, injected at the dialer so the test needs no resolver.
func TestDNSFailureIsUnreachable(t *testing.T) {
	client := &http.Client{Transport: &http.Transport{
		DialContext: func(context.Context, string, string) (net.Conn, error) {
			return nil, &net.DNSError{Err: "no such host", Name: "relay.invalid", IsNotFound: true}
		},
	}}
	d, err := New(Config{Devices: []DeviceConfig{lampConfig("http://relay.invalid")}, Client: client})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	execErr := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if !errors.Is(execErr, devices.ErrUnreachable) {
		t.Fatalf("DNS failure = %v, want ErrUnreachable", execErr)
	}
	if !strings.Contains(execErr.Error(), "did not resolve") {
		t.Fatalf("error text %q does not say the name did not resolve", execErr)
	}
}

// A timeout while still connecting: again, nothing was written.
func TestTimeoutBeforeTheRequestIsWrittenIsUnreachable(t *testing.T) {
	client := &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}}
	d, err := New(Config{
		Timeout: 40 * time.Millisecond,
		Devices: []DeviceConfig{lampConfig("http://192.0.2.1")}, // TEST-NET-1, never routed
		Client:  client,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	execErr := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if !errors.Is(execErr, devices.ErrUnreachable) {
		t.Fatalf("dial timeout = %v, want ErrUnreachable", execErr)
	}
}

// The case the seam exists for: the request WAS delivered and the answer never
// came. The hub cannot know whether the lamp switched on.
func TestRequestSentButNoResponseIsIndeterminate(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release // the request is fully written; we simply never answer.
	}))
	defer srv.Close()
	defer close(release)

	d, err := New(Config{Timeout: 100 * time.Millisecond, Devices: []DeviceConfig{lampConfig(srv.URL)}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	execErr := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if !errors.Is(execErr, devices.ErrIndeterminate) {
		t.Fatalf("no response after the request was written = %v, want ErrIndeterminate", execErr)
	}
	if errors.Is(execErr, devices.ErrUnreachable) {
		t.Fatal("a delivered request with no answer must not be reported as unreachable")
	}
	found, _ := d.Discover(context.Background())
	if found[0].Availability != devices.AvailDegraded {
		t.Fatalf("availability = %q, want degraded", found[0].Availability)
	}
}

// The same transport outcome on a READ is unreachable, not indeterminate: a
// read actuates nothing, so there is no outcome to be uncertain about.
func TestReadTimeoutIsUnreachableNotIndeterminate(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-release }))
	defer srv.Close()
	defer close(release)

	d, err := New(Config{Timeout: 100 * time.Millisecond, Devices: []DeviceConfig{lampConfig(srv.URL)}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, rerr := d.Read(context.Background(), "lamp-1")
	if !errors.Is(rerr, devices.ErrUnreachable) {
		t.Fatalf("read timeout = %v, want ErrUnreachable", rerr)
	}
	if errors.Is(rerr, devices.ErrIndeterminate) {
		t.Fatal("a read that timed out actuated nothing; indeterminate overstates it")
	}
}

func TestStatusMapping(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		idempotent bool
		want       error // nil means "a plain failure, matching no sentinel"
		wantNil    bool
	}{
		{name: "204 is success", status: http.StatusNoContent, wantNil: true},
		{name: "200 is success", status: http.StatusOK, wantNil: true},
		{name: "404 is an unknown device", status: http.StatusNotFound, want: devices.ErrUnknownDevice},
		{name: "405 is unsupported", status: http.StatusMethodNotAllowed, want: devices.ErrUnsupported},
		{name: "501 is unsupported", status: http.StatusNotImplemented, want: devices.ErrUnsupported},
		{name: "500 on a non-idempotent action is indeterminate",
			status: http.StatusInternalServerError, want: devices.ErrIndeterminate},
		{name: "503 on a non-idempotent action is indeterminate",
			status: http.StatusServiceUnavailable, want: devices.ErrIndeterminate},
		{name: "500 on an idempotent action is a plain failure",
			status: http.StatusInternalServerError, idempotent: true},
		{name: "403 is a plain failure", status: http.StatusForbidden},
		{name: "401 is a plain failure", status: http.StatusUnauthorized},
		{name: "409 is a plain failure", status: http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()

			// A blade start: the highest-stakes verb in the catalogue, so the
			// mapping is exercised where it matters most.
			d := newDriver(t, DeviceConfig{
				ID: "mower-1", Kind: devices.KindRobot, Name: "Mower",
				Capabilities: []devices.CapabilityID{devices.CapBladeJob}, AllowPlaintext: true,
				Actions: map[devices.Verb]Action{
					devices.VerbStart: {Method: http.MethodPost, URL: srv.URL + "/start",
						Idempotent: tc.idempotent},
				},
			})
			err := d.Execute(context.Background(), "mower-1", devices.VerbStart, nil)
			switch {
			case tc.wantNil:
				if err != nil {
					t.Fatalf("status %d = %v, want nil", tc.status, err)
				}
			case tc.want != nil:
				if !errors.Is(err, tc.want) {
					t.Fatalf("status %d (idempotent=%v) = %v, want %v",
						tc.status, tc.idempotent, err, tc.want)
				}
			default:
				if err == nil {
					t.Fatalf("status %d = nil, want a failure", tc.status)
				}
				for _, sentinel := range []error{
					devices.ErrUnknownDevice, devices.ErrUnsupported,
					devices.ErrUnreachable, devices.ErrIndeterminate,
				} {
					if errors.Is(err, sentinel) {
						t.Fatalf("status %d (idempotent=%v) matched %v; it should be a plain failure",
							tc.status, tc.idempotent, sentinel)
					}
				}
			}
		})
	}
}

func TestReadStatusMappingUsesTheIdempotentRule(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	d := newDriver(t, lampConfig(srv.URL))
	_, err := d.Read(context.Background(), "lamp-1")
	if err == nil {
		t.Fatal("a 500 on a read must be an error")
	}
	if errors.Is(err, devices.ErrIndeterminate) {
		t.Fatal("a read is idempotent by construction; a 500 on it is a plain failure, " +
			"not an indeterminate outcome")
	}
}

func TestReadNotFoundIsUnknownDevice(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	d := newDriver(t, lampConfig(srv.URL))
	if _, err := d.Read(context.Background(), "lamp-1"); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("404 on a read = %v, want ErrUnknownDevice", err)
	}
}

// --- redirects.

func TestSameHostRedirectIsFollowed(t *testing.T) {
	var reached bool
	mux := http.NewServeMux()
	mux.HandleFunc("/moved", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/lamp/on", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/lamp/on", func(w http.ResponseWriter, r *http.Request) { reached = true })
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cfg := lampConfig(srv.URL)
	cfg.Actions[devices.VerbOn] = Action{Method: http.MethodPost, URL: srv.URL + "/moved"}
	d := newDriver(t, cfg)
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !reached {
		t.Fatal("a same-host redirect should have been followed")
	}
}

func TestCrossHostRedirectIsRefused(t *testing.T) {
	var elsewhereHits int
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		elsewhereHits++
	}))
	defer elsewhere.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+"/lamp/on", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if elsewhereHits != 0 {
		t.Fatal("the driver followed a redirect to another host, taking the device's " +
			"credentials with it")
	}
	// The first server received the request, so the outcome genuinely is unknown.
	if !errors.Is(err, devices.ErrIndeterminate) {
		t.Fatalf("refused cross-host redirect = %v, want ErrIndeterminate", err)
	}
	if !strings.Contains(err.Error(), "different host") {
		t.Fatalf("error text %q does not explain the refusal", err)
	}
}

// --- reads and the path grammar end to end.

func TestReadMapsJSONOntoReadings(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("read used %s; reads must be GET", r.Method)
		}
		fmt.Fprint(w, `{"state":{"level":62.5,"mode":"warm"},"unused":1}`)
	}))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	got, err := d.Read(context.Background(), "lamp-1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d readings, want 2: %+v", len(got), got)
	}
	if got[0].Metric != "level" || got[0].Value != 62.5 || got[0].Text != "" {
		t.Fatalf("numeric reading = %+v", got[0])
	}
	if got[1].Metric != "state" || got[1].Text != "warm" {
		t.Fatalf("text reading = %+v", got[1])
	}
	if got[0].DeviceID != "lamp-1" || got[0].At.IsZero() {
		t.Fatalf("reading is missing its device id or timestamp: %+v", got[0])
	}
}

func TestReadSkipsAMissingMetricButFailsWhenAllAreMissing(t *testing.T) {
	body := `{"state":{"level":10}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	}))
	defer srv.Close()
	d := newDriver(t, lampConfig(srv.URL))

	got, err := d.Read(context.Background(), "lamp-1")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(got) != 1 || got[0].Metric != "level" {
		t.Fatalf("a metric the response omits should be skipped, not fabricated: %+v", got)
	}

	body = `{"other":true}`
	if _, err := d.Read(context.Background(), "lamp-1"); err == nil {
		t.Fatal("a response carrying none of the declared metrics must be an error, " +
			"not an empty success")
	}
}

func TestReadRejectsNonJSONAndOversizedBodies(t *testing.T) {
	body := "not json"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	d, err := New(Config{MaxResponseBytes: 64, Devices: []DeviceConfig{lampConfig(srv.URL)}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := d.Read(context.Background(), "lamp-1"); err == nil {
		t.Fatal("a non-JSON response must be an error")
	}

	body = `{"state":{"level":1,"pad":"` + strings.Repeat("x", 4096) + `"}}`
	_, err = d.Read(context.Background(), "lamp-1")
	if err == nil || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("oversized response = %v, want a bounded-read refusal", err)
	}
}

// --- safety.

func TestPlaintextIsRefusedUnlessOptedIn(t *testing.T) {
	cfg := lampConfig("http://192.0.2.1")
	cfg.AllowPlaintext = false
	if _, err := New(Config{Devices: []DeviceConfig{cfg}}); err == nil {
		t.Fatal("an http:// URL must be refused unless the device opts into plaintext")
	}
	cfg.AllowPlaintext = true
	if _, err := New(Config{Devices: []DeviceConfig{cfg}}); err != nil {
		t.Fatalf("opted-in plaintext should be accepted: %v", err)
	}
	https := lampConfig("https://relay.example")
	https.AllowPlaintext = false
	if _, err := New(Config{Devices: []DeviceConfig{https}}); err != nil {
		t.Fatalf("https must be accepted without an opt-in: %v", err)
	}
}

// The one rule that has to hold in every message the driver produces.
func TestErrorsNeverCarryTheURLsCredentials(t *testing.T) {
	const secret = "sup3rs3cret-token"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	d := newDriver(t, DeviceConfig{
		ID: "relay-1", Kind: devices.KindSensor, Name: "Relay Board",
		Capabilities: []devices.CapabilityID{devices.CapSensorReadCa}, AllowPlaintext: true,
		Actions: map[devices.Verb]Action{
			devices.VerbRead: {Method: http.MethodGet, URL: srv.URL + "/api/" + secret + "/read?key=" + secret},
		},
		Reads: []ReadSpec{{URL: srv.URL + "/api/" + secret + "/state?key=" + secret,
			Metrics: []Metric{{Metric: "percent", Path: "percent"}}}},
	})

	execErr := d.Execute(context.Background(), "relay-1", devices.VerbRead, nil)
	if execErr == nil {
		t.Fatal("expected a failure")
	}
	if strings.Contains(execErr.Error(), secret) {
		t.Fatalf("the error leaked a credential from the URL: %v", execErr)
	}
	_, readErr := d.Read(context.Background(), "relay-1")
	if readErr == nil || strings.Contains(readErr.Error(), secret) {
		t.Fatalf("the read error leaked a credential from the URL: %v", readErr)
	}
	h := d.Health(context.Background())
	if strings.Contains(h.Detail, secret) || strings.Contains(h.Detail, srv.URL) {
		t.Fatalf("health detail carries an address or a credential: %q", h.Detail)
	}
}

func TestCallerContextWinsOverTheDriverTimeout(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-release }))
	defer srv.Close()
	defer close(release)

	d, err := New(Config{Timeout: time.Minute, Devices: []DeviceConfig{lampConfig(srv.URL)}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	start := time.Now()
	execErr := d.Execute(ctx, "lamp-1", devices.VerbOn, nil)
	if time.Since(start) > 10*time.Second {
		t.Fatal("the driver ignored the caller's deadline")
	}
	if !errors.Is(execErr, devices.ErrIndeterminate) {
		t.Fatalf("cancelled after the request was written = %v, want ErrIndeterminate", execErr)
	}
}

func TestNaNArgumentIsRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("a NaN argument must never reach the device")
	}))
	defer srv.Close()
	d := newDriver(t, lampConfig(srv.URL))
	nan := math.NaN()
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbSet,
		map[string]float64{"level": nan}); err == nil {
		t.Fatal("NaN passes the registry's range check (both comparisons are false), " +
			"so the driver has to refuse it")
	}
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbSet, nil); err == nil {
		t.Fatal("a missing required argument must be refused")
	}
}

func TestHealthReportsWithoutTouchingTheNetwork(t *testing.T) {
	fail := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	if h := d.Health(context.Background()); !h.OK || h.Since.IsZero() {
		t.Fatalf("a fresh driver should be OK with a Since: %+v", h)
	}
	_ = d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil)
	if h := d.Health(context.Background()); h.OK {
		t.Fatal("health should be not-OK after a failed request")
	}
	fail = false
	if err := d.Execute(context.Background(), "lamp-1", devices.VerbOn, nil); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if h := d.Health(context.Background()); !h.OK {
		t.Fatal("health should recover after a successful request")
	}
}

// The registry does not serialise calls, so this is a contract, not a nicety.
// Meaningful under -race; still exercises the paths without it.
func TestConcurrentUse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"state":{"level":5,"mode":"warm"}}`)
	}))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ctx := context.Background()
			switch i % 4 {
			case 0:
				_ = d.Execute(ctx, "lamp-1", devices.VerbOn, nil)
			case 1:
				_, _ = d.Read(ctx, "lamp-1")
			case 2:
				_, _ = d.Discover(ctx)
			default:
				_ = d.Health(ctx)
			}
		}(i)
	}
	wg.Wait()
	if err := d.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

// The driver plugs into the registry unchanged — the whole point of the seam.
func TestRegistryDrivesIt(t *testing.T) {
	var lastPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastPath = r.URL.Path
		fmt.Fprint(w, `{"state":{"level":62,"mode":"warm"}}`)
	}))
	defer srv.Close()

	d := newDriver(t, lampConfig(srv.URL))
	reg := devices.NewRegistry()
	if err := reg.Register(d); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := reg.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	key := devices.Key("http", "lamp-1")
	if _, ok := reg.Get(key); !ok {
		t.Fatalf("device %q was not indexed", key)
	}
	if err := reg.Execute(context.Background(), key, devices.VerbSet,
		map[string]float64{"level": 30}); err != nil {
		t.Fatalf("registry Execute: %v", err)
	}
	if lastPath != "/lamp/level" {
		t.Fatalf("registry routed to %q", lastPath)
	}
	got, err := reg.Read(context.Background(), key)
	if err != nil || len(got) != 2 {
		t.Fatalf("registry Read = %+v, %v", got, err)
	}
	if err := reg.Close(); err != nil {
		t.Fatalf("registry Close: %v", err)
	}
}
