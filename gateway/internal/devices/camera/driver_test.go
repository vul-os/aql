package camera

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/devices"
)

func declared(cam *fakeCam) CameraConfig {
	return CameraConfig{
		ID: "gate-cam", Name: "Gate Camera", Zone: "Driveway",
		ServiceAddress: cam.deviceAddr(),
	}
}

func newDriver(t *testing.T, cfg Config) *Driver {
	t.Helper()
	d, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

// --- configuration refusals -------------------------------------------------

func TestNewRefusesUnusableConfig(t *testing.T) {
	cam := newFakeCam(t)
	cases := []struct {
		name string
		cfg  Config
	}{
		{"driver id with a colon", Config{ID: "cam:1"}},
		{"driver id with whitespace", Config{ID: "cam 1"}},
		{"negative timeout", Config{Timeout: -time.Second}},
		{"camera with no name", Config{Cameras: []CameraConfig{{ID: "a", ServiceAddress: cam.deviceAddr()}}}},
		{"camera with no id", Config{Cameras: []CameraConfig{{Name: "x", ServiceAddress: cam.deviceAddr()}}}},
		{"camera id with a colon", Config{Cameras: []CameraConfig{{ID: "a:b", Name: "x", ServiceAddress: cam.deviceAddr()}}}},
		{"no service address", Config{Cameras: []CameraConfig{{ID: "a", Name: "x"}}}},
		{"unsupported scheme", Config{Cameras: []CameraConfig{{ID: "a", Name: "x", ServiceAddress: "rtsp://192.0.2.1/x"}}}},
		{"credentials in the address", Config{Cameras: []CameraConfig{
			{ID: "a", Name: "x", ServiceAddress: "http://u:p@192.0.2.1/onvif/device_service"}}}},
		{"plaintext under RequireHTTPS", Config{RequireHTTPS: true, Cameras: []CameraConfig{declared(cam)}}},
		{"the same camera twice", Config{Cameras: []CameraConfig{declared(cam), declared(cam)}}},
	}
	for _, c := range cases {
		if _, err := New(c.cfg); err == nil {
			t.Fatalf("%s: New accepted it", c.name)
		}
	}
}

// --- the seam ---------------------------------------------------------------

func TestDiscoverReportsDeclaredCamerasAsStatusOnly(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}})

	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d devices, want 1", len(got))
	}
	dev := got[0]
	if dev.Kind != devices.KindCamera {
		t.Fatalf("kind = %q", dev.Kind)
	}
	if len(dev.Capabilities) != 1 || dev.Capabilities[0] != devices.CapCameraFeed {
		t.Fatalf("capabilities = %v, want the status-only feed capability alone", dev.Capabilities)
	}
	if dev.Availability != devices.AvailUnknown {
		t.Fatalf("availability = %q; a declared camera nobody has contacted is not online", dev.Availability)
	}
	if err := dev.Validate(); err != nil {
		t.Fatalf("the engine rejects the device this driver produced: %v", err)
	}
	// The capability carries one verb, and it is a read.
	if spec, _, ok := dev.Supports(devices.VerbStatus); !ok || spec.Tier != devices.TierRead {
		t.Fatalf("status verb = %+v, ok=%v; want TierRead", spec, ok)
	}
	for _, v := range []devices.Verb{devices.VerbOn, devices.VerbOpen, devices.VerbStart,
		devices.VerbUnlock, devices.VerbArm, devices.VerbSet, devices.VerbRead} {
		if _, _, ok := dev.Supports(v); ok {
			t.Fatalf("a camera device offers %q; this driver has no pipeline behind any verb but status", v)
		}
	}
}

func TestExecuteRefusesEveryVerbButStatus(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}})

	for _, v := range []devices.Verb{devices.VerbOn, devices.VerbOff, devices.VerbOpen,
		devices.VerbStart, devices.VerbStop, devices.VerbArm, devices.VerbUnlock,
		devices.VerbSet, devices.VerbRead, devices.Verb("record"), devices.Verb("")} {
		err := d.Execute(context.Background(), "gate-cam", v, nil)
		if !errors.Is(err, devices.ErrUnsupported) {
			t.Fatalf("Execute(%q) = %v, want ErrUnsupported", v, err)
		}
	}
	if calls := cam.calls(); len(calls) != 0 {
		t.Fatalf("a refused verb still reached the camera: %v", calls)
	}
}

func TestExecuteRefusesAnUnknownDevice(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}})
	if err := d.Execute(context.Background(), "nope", devices.VerbStatus, nil); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("Execute on an unknown id = %v, want ErrUnknownDevice", err)
	}
	if _, err := d.Read(context.Background(), "nope"); !errors.Is(err, devices.ErrUnknownDevice) {
		t.Fatalf("Read on an unknown id = %v, want ErrUnknownDevice", err)
	}
}

func TestExecuteStatusAsksTheCamera(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}})

	if err := d.Execute(context.Background(), "gate-cam", devices.VerbStatus, nil); err != nil {
		t.Fatalf("Execute(status): %v", err)
	}
	if calls := cam.calls(); len(calls) == 0 {
		t.Fatal("status answered without asking the camera anything")
	}
	if c := d.Cameras(); len(c) != 1 || c[0].Availability != devices.AvailOnline {
		t.Fatalf("cameras = %+v, want the camera marked online", c)
	}
}

func TestExecuteStatusOnACameraThatIsNotThere(t *testing.T) {
	cam := newFakeCam(t)
	cfg := Config{Cameras: []CameraConfig{declared(cam)}}
	d := newDriver(t, cfg)
	cam.Close()

	err := d.Execute(context.Background(), "gate-cam", devices.VerbStatus, nil)
	if !errors.Is(err, devices.ErrUnreachable) {
		t.Fatalf("Execute = %v, want ErrUnreachable", err)
	}
	if c := d.Cameras(); c[0].Availability != devices.AvailOffline {
		t.Fatalf("availability = %q, want offline", c[0].Availability)
	}
}

func TestExecuteStatusOnACameraWithNoMediaServiceStillSucceeds(t *testing.T) {
	cam := newFakeCam(t)
	cam.mediaXAddr = "-"
	cam.servicesNS = "http://www.onvif.org/ver20/media/wsdl"
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}})

	// Status asked whether the camera answers. It does.
	if err := d.Execute(context.Background(), "gate-cam", devices.VerbStatus, nil); err != nil {
		t.Fatalf("Execute(status) = %v, want success: the camera answered", err)
	}
	c := d.Cameras()[0]
	if c.Availability != devices.AvailDegraded {
		t.Fatalf("availability = %q, want degraded: reachable, nothing to point at", c.Availability)
	}
	if c.StreamAddress != "" {
		t.Fatalf("stream address = %q, want none", c.StreamAddress)
	}
}

// --- reading ---------------------------------------------------------------

func TestReadResolvesTheStreamAddress(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{
		Cameras:     []CameraConfig{declared(cam)},
		Credentials: map[string]Credential{"": {Username: "admin", Password: "hunter2"}},
	})

	readings, err := d.Read(context.Background(), "gate-cam")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	byMetric := map[string]devices.Reading{}
	for _, r := range readings {
		byMetric[r.Metric] = r
	}
	if byMetric["reachable"].Value != 1 {
		t.Fatalf("reachable = %v", byMetric["reachable"].Value)
	}
	if got := byMetric["stream"].Text; got != cam.streamURI {
		t.Fatalf("stream = %q, want %q", got, cam.streamURI)
	}
	if got := byMetric["profile"].Text; !strings.Contains(got, "1920x1080") {
		t.Fatalf("profile = %q, want the best profile described", got)
	}
	if want := []string{"GetCapabilities", "GetProfiles", "GetStreamUri"}; !equal(cam.calls(), want) {
		t.Fatalf("calls = %v, want %v", cam.calls(), want)
	}
	// The credential travelled as a digest, never as the password.
	body, _ := cam.lastRequest()
	if strings.Contains(body, "hunter2") {
		t.Fatal("the password was sent in the clear")
	}
}

func TestReadCachesTheAddressButNotTheReachability(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}, StreamTTL: time.Hour})

	if _, err := d.Read(context.Background(), "gate-cam"); err != nil {
		t.Fatalf("first Read: %v", err)
	}
	if _, err := d.Read(context.Background(), "gate-cam"); err != nil {
		t.Fatalf("second Read: %v", err)
	}
	want := []string{"GetCapabilities", "GetProfiles", "GetStreamUri", "GetCapabilities"}
	if !equal(cam.calls(), want) {
		t.Fatalf("calls = %v, want %v: the address is cached, the camera being there is not", cam.calls(), want)
	}

	// Once the address goes stale it is asked for again.
	d.streamTTL = time.Nanosecond
	if _, err := d.Read(context.Background(), "gate-cam"); err != nil {
		t.Fatalf("third Read: %v", err)
	}
	if got := len(cam.calls()); got != 7 {
		t.Fatalf("%d calls after the ttl expired, want 7", got)
	}
}

func TestReadOnRejectedCredentialsIsNotUnreachable(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(_ string, w http.ResponseWriter) bool {
		w.WriteHeader(http.StatusUnauthorized)
		return true
	}
	d := newDriver(t, Config{
		Cameras:     []CameraConfig{declared(cam)},
		Credentials: map[string]Credential{"": {Username: "admin", Password: "hunter2"}},
	})

	_, err := d.Read(context.Background(), "gate-cam")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if errors.Is(err, devices.ErrUnreachable) {
		t.Fatal("a rejected password was reported as an unreachable camera")
	}
	if errors.Is(err, devices.ErrIndeterminate) {
		t.Fatal("nothing here actuates, so nothing here can be indeterminate")
	}
	c := d.Cameras()[0]
	if c.Availability != devices.AvailDegraded {
		t.Fatalf("availability = %q, want degraded: the camera IS reachable", c.Availability)
	}
	if strings.Contains(c.Detail, "hunter2") || strings.Contains(err.Error(), "hunter2") {
		t.Fatal("the password leaked into operator-facing text")
	}
	if h := d.Health(context.Background()); strings.Contains(h.Detail, "hunter2") {
		t.Fatal("the password leaked into the driver's health detail")
	}
}

func TestReadOnACameraWithNoProfiles(t *testing.T) {
	cam := newFakeCam(t)
	cam.profilesBody = `<Envelope><Body><GetProfilesResponse></GetProfilesResponse></Body></Envelope>`
	d := newDriver(t, Config{Cameras: []CameraConfig{declared(cam)}})

	_, err := d.Read(context.Background(), "gate-cam")
	if !errors.Is(err, errNoProfiles) {
		t.Fatalf("err = %v, want errNoProfiles", err)
	}
	if errors.Is(err, devices.ErrUnreachable) {
		t.Fatal("a camera with no profiles is not an unreachable camera")
	}
}

// --- discovery through the driver -------------------------------------------

func TestDiscoverAddsWhatAnsweredTheProbe(t *testing.T) {
	addr := responder(t, func(probe []byte, port int) [][]byte {
		return [][]byte{fillMatch(messageIDOf(t, probe), serviceAddr(port))}
	})
	cfg := fastProbe(addr)
	cfg.Enabled = true
	cfg.MaxMatches = 1
	d := newDriver(t, Config{Discovery: cfg})

	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d devices, want the discovered camera", len(got))
	}
	if got[0].ID != "2419d68a-2dd2-21b2-a205-001b7b1b3f77" {
		t.Fatalf("id = %q, want the endpoint reference uuid, not the address", got[0].ID)
	}
	if got[0].Name != "Front Gate" || got[0].Zone != "Driveway/North" {
		t.Fatalf("name/zone = %q/%q, want the scope values", got[0].Name, got[0].Zone)
	}
	if got[0].Availability != devices.AvailOnline {
		t.Fatalf("availability = %q; it answered a probe", got[0].Availability)
	}
	if got[0].Capabilities[0] != devices.CapCameraFeed || len(got[0].Capabilities) != 1 {
		t.Fatalf("capabilities = %v", got[0].Capabilities)
	}
}

func TestDiscoveryDoesNotDuplicateADeclaredCamera(t *testing.T) {
	addr := responder(t, func(probe []byte, port int) [][]byte {
		return [][]byte{fillMatch(messageIDOf(t, probe), serviceAddr(port))}
	})
	cfg := fastProbe(addr)
	cfg.Enabled = true
	cfg.MaxMatches = 1
	// Declared at the same address the probe answers from, under a different
	// path — which is exactly how a vendor's device service and an operator's
	// note about it differ in practice.
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("responder address: %v", err)
	}
	d := newDriver(t, Config{Discovery: cfg, Cameras: []CameraConfig{
		{ID: "gate-cam", Name: "Gate Camera", Zone: "Driveway",
			ServiceAddress: "http://127.0.0.1:" + port + "/onvif/device"},
	}})

	got, derr := d.Discover(context.Background())
	if derr != nil {
		t.Fatalf("Discover: %v", derr)
	}
	if len(got) != 1 || got[0].ID != "gate-cam" {
		t.Fatalf("devices = %+v, want only the operator's declaration", got)
	}
	if got[0].Name != "Gate Camera" {
		t.Fatalf("name = %q; a device on the network overwrote the operator's name", got[0].Name)
	}
}

func TestDiscoverKeepsDeclaredCamerasWhenTheProbeFails(t *testing.T) {
	cam := newFakeCam(t)
	cfg := fastProbe("not-an-address")
	cfg.Enabled = true
	d := newDriver(t, Config{Discovery: cfg, Cameras: []CameraConfig{declared(cam)}})

	got, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover returned %v; a failed probe must not erase declared cameras", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d devices, want the declared camera kept", len(got))
	}
	if h := d.Health(context.Background()); h.OK {
		t.Fatal("the failed probe is invisible in Health")
	}
}

func TestDiscoverErrorsOnlyWhenThereIsNothingToReport(t *testing.T) {
	cfg := fastProbe("not-an-address")
	cfg.Enabled = true
	d := newDriver(t, Config{Discovery: cfg})
	if _, err := d.Discover(context.Background()); err == nil {
		t.Fatal("want an error when the probe failed and no camera is known")
	}
}

func TestDiscoveryIsOffUnlessAskedFor(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{
		Discovery: DiscoveryConfig{Target: "127.0.0.1:1"}, // would fail loudly if used
		Cameras:   []CameraConfig{declared(cam)},
	})
	got, err := d.Discover(context.Background())
	if err != nil || len(got) != 1 {
		t.Fatalf("Discover = %v, %v; discovery must not run unless Enabled", got, err)
	}
	if h := d.Health(context.Background()); !h.OK {
		t.Fatalf("health = %+v", h)
	}
}

// --- through the engine's registry ------------------------------------------

func TestDriverThroughTheRegistry(t *testing.T) {
	cam := newFakeCam(t)
	d := newDriver(t, Config{ID: "camera", Cameras: []CameraConfig{declared(cam)}})

	reg := devices.NewRegistry()
	if err := reg.Register(d); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := reg.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	indexed := reg.Devices()
	if len(indexed) != 1 || indexed[0].Key != "camera:gate-cam" {
		t.Fatalf("devices = %+v", indexed)
	}

	plan, err := reg.Resolve("camera:gate-cam", devices.VerbStatus, nil)
	if err != nil {
		t.Fatalf("Resolve(status): %v", err)
	}
	if plan.Tier != devices.TierRead {
		t.Fatalf("tier = %v, want read", plan.Tier)
	}
	if err := reg.ExecutePlan(context.Background(), plan); err != nil {
		t.Fatalf("ExecutePlan: %v", err)
	}

	// Nothing hazardous resolves at all: the refusal happens in the engine,
	// before this driver is ever consulted.
	for _, v := range []devices.Verb{devices.VerbOpen, devices.VerbStart, devices.VerbOn} {
		if _, err := reg.Resolve("camera:gate-cam", v, nil); err == nil {
			t.Fatalf("the registry resolved %q on a camera", v)
		}
	}

	readings, err := reg.Read(context.Background(), "camera:gate-cam")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(readings) == 0 {
		t.Fatal("no readings")
	}
}

func TestHealthStartsHonest(t *testing.T) {
	d := newDriver(t, Config{})
	h := d.Health(context.Background())
	if !h.OK || !strings.Contains(h.Detail, "discovery disabled") {
		t.Fatalf("health = %+v", h)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
