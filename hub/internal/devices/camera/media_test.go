package camera

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMediaAddressFromGetCapabilities(t *testing.T) {
	cam := newFakeCam(t)
	got, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, false)
	if err != nil {
		t.Fatalf("mediaAddress: %v", err)
	}
	if got != cam.URL+"/onvif/media_service" {
		t.Fatalf("media address = %q", got)
	}
	if calls := cam.calls(); len(calls) != 1 || calls[0] != "GetCapabilities" {
		t.Fatalf("calls = %v, want GetCapabilities alone", calls)
	}
}

func TestMediaAddressFallsBackToGetServices(t *testing.T) {
	cam := newFakeCam(t)
	// A Profile T device that has retired GetCapabilities.
	cam.override = func(op string, w http.ResponseWriter) bool {
		if op != "GetCapabilities" {
			return false
		}
		w.WriteHeader(http.StatusInternalServerError)
		io.WriteString(w, notSupportedFaultXML)
		return true
	}
	got, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, false)
	if err != nil {
		t.Fatalf("mediaAddress: %v", err)
	}
	if got != cam.URL+"/onvif/media_service" {
		t.Fatalf("media address = %q", got)
	}
	if calls := cam.calls(); len(calls) != 2 || calls[1] != "GetServices" {
		t.Fatalf("calls = %v, want the GetServices fallback", calls)
	}
}

func TestMediaAddressFallsBackOnAnEmptyMediaXAddr(t *testing.T) {
	cam := newFakeCam(t)
	cam.mediaXAddr = "-" // answers GetCapabilities, names no media service
	got, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, false)
	if err != nil {
		t.Fatalf("mediaAddress: %v", err)
	}
	if got == "" {
		t.Fatal("want the GetServices fallback to supply the address")
	}
}

func TestMediaAddressReportsNoVer10MediaService(t *testing.T) {
	cam := newFakeCam(t)
	cam.mediaXAddr = "-"
	cam.servicesNS = "http://www.onvif.org/ver20/media/wsdl" // Media2 only
	_, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, false)
	if !errors.Is(err, errNoMediaService) {
		t.Fatalf("err = %v, want errNoMediaService for a Media2-only camera", err)
	}
}

func TestMediaAddressDoesNotRetryAfterCredentialsAreRejected(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(_ string, w http.ResponseWriter) bool {
		w.WriteHeader(http.StatusUnauthorized)
		return true
	}
	_, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(),
		Credential{Username: "a", Password: "b"}, false)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if calls := cam.calls(); len(calls) != 1 {
		t.Fatalf("calls = %v; a rejected credential must not be tried again on a second endpoint", calls)
	}
}

func TestMediaAddressRefusesAnotherHost(t *testing.T) {
	cam := newFakeCam(t)
	cam.mediaXAddr = "http://192.0.2.77/onvif/media_service"

	_, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, false)
	if err == nil || !strings.Contains(err.Error(), "another host") {
		t.Fatalf("err = %v, want a refusal: a camera may not aim the hub elsewhere", err)
	}

	got, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, true)
	if err != nil || got != cam.mediaXAddr {
		t.Fatalf("with AcceptForeignServiceAddress got %q, %v", got, err)
	}
}

func TestMediaAddressRefusesCredentialsAndOddSchemes(t *testing.T) {
	for _, addr := range []string{
		"http://user:pass@127.0.0.1/onvif/media_service",
		"file:///etc/passwd",
		"::::",
	} {
		cam := newFakeCam(t)
		cam.mediaXAddr = addr
		cam.servicesNS = "http://www.onvif.org/ver20/media/wsdl"
		if _, err := testSOAP().mediaAddress(context.Background(), cam.deviceAddr(), Credential{}, true); err == nil {
			t.Fatalf("media address %q was accepted", addr)
		}
	}
}

func TestProfilesAreSortedBestFirst(t *testing.T) {
	cam := newFakeCam(t)
	got, err := testSOAP().profiles(context.Background(), cam.URL+"/onvif/media_service", Credential{})
	if err != nil {
		t.Fatalf("profiles: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d profiles, want 2", len(got))
	}
	if got[0].Token != "Profile_1" {
		t.Fatalf("first profile = %q, want the 1920x1080 one regardless of document order", got[0].Token)
	}
	if got[0].Width != 1920 || got[0].Height != 1080 || got[0].Encoding != "H264" {
		t.Fatalf("profile = %+v", got[0])
	}
	if d := got[0].Describe(); d != "mainStream · H264 1920x1080" {
		t.Fatalf("Describe = %q", d)
	}
}

func TestProfilesDropsUnusableTokens(t *testing.T) {
	cam := newFakeCam(t)
	cam.profilesBody = sub(profilesReplyXML,
		`token="Profile_1"`, `token="../../etc/passwd"`,
		`token="Profile_2"`, `token=""`)
	_, err := testSOAP().profiles(context.Background(), cam.URL+"/onvif/media_service", Credential{})
	if !errors.Is(err, errNoProfiles) {
		t.Fatalf("err = %v, want every unusable token dropped and errNoProfiles left", err)
	}
}

func TestProfilesReportsAnEmptyList(t *testing.T) {
	cam := newFakeCam(t)
	cam.profilesBody = `<Envelope><Body><GetProfilesResponse></GetProfilesResponse></Body></Envelope>`
	_, err := testSOAP().profiles(context.Background(), cam.URL+"/onvif/media_service", Credential{})
	if !errors.Is(err, errNoProfiles) {
		t.Fatalf("err = %v, want errNoProfiles", err)
	}
}

func TestStreamURIRequestAsksForRTPOverRTSP(t *testing.T) {
	cam := newFakeCam(t)
	media := cam.URL + "/onvif/media_service"
	got, err := testSOAP().streamURI(context.Background(), media, "Profile_1", Credential{}, false)
	if err != nil {
		t.Fatalf("streamURI: %v", err)
	}
	if got != cam.streamURI {
		t.Fatalf("stream address = %q, want %q", got, cam.streamURI)
	}
	body, _ := cam.lastRequest()
	for _, want := range []string{"<tt:Stream>RTP-Unicast</tt:Stream>", "<tt:Protocol>RTSP</tt:Protocol>",
		"<trt:ProfileToken>Profile_1</trt:ProfileToken>"} {
		if !strings.Contains(body, want) {
			t.Fatalf("request body is missing %q:\n%s", want, body)
		}
	}
}

func TestStreamURIStripsEmbeddedCredentials(t *testing.T) {
	cam := newFakeCam(t)
	host := strings.TrimPrefix(cam.URL, "http://")
	cam.streamURI = "rtsp://admin:hunter2@" + host + "/Streaming/Channels/101"

	got, err := testSOAP().streamURI(context.Background(), cam.URL+"/onvif/media_service",
		"Profile_1", Credential{}, false)
	if err != nil {
		t.Fatalf("streamURI: %v", err)
	}
	if strings.Contains(got, "hunter2") || strings.Contains(got, "admin") {
		t.Fatalf("stream address %q still carries the credential the camera embedded", got)
	}
	if !strings.HasSuffix(got, "/Streaming/Channels/101") {
		t.Fatalf("stream address = %q, want the path preserved", got)
	}
}

func TestStreamURIRefusesWhatIsNotAStream(t *testing.T) {
	cam := newFakeCam(t)
	host := strings.TrimPrefix(cam.URL, "http://")
	for _, uri := range []string{
		"http://" + host + "/snapshot.jpg", // a snapshot address is not a stream
		"rtsp://192.0.2.99/Streaming",      // another host entirely
		"",
		"not a url at all",
	} {
		cam.streamURI = uri
		if _, err := testSOAP().streamURI(context.Background(), cam.URL+"/onvif/media_service",
			"Profile_1", Credential{}, false); err == nil {
			t.Fatalf("stream address %q was accepted", uri)
		}
	}
}

func TestStreamURIAcceptsAForeignHostWhenTold(t *testing.T) {
	cam := newFakeCam(t)
	cam.streamURI = "rtsp://192.0.2.99:554/Streaming"
	got, err := testSOAP().streamURI(context.Background(), cam.URL+"/onvif/media_service",
		"Profile_1", Credential{}, true)
	if err != nil || got != cam.streamURI {
		t.Fatalf("got %q, %v; want the foreign address accepted under the escape hatch", got, err)
	}
}

func TestStreamURIRefusesAnUnusableProfileToken(t *testing.T) {
	cam := newFakeCam(t)
	if _, err := testSOAP().streamURI(context.Background(), cam.URL+"/onvif/media_service",
		`Profile"><evil>`, Credential{}, false); err == nil {
		t.Fatal("want a refusal rather than an escaped injection attempt on the wire")
	}
	if calls := cam.calls(); len(calls) != 0 {
		t.Fatalf("calls = %v, want the request refused before it was sent", calls)
	}
}

func TestSameHostComparesIPsNotStrings(t *testing.T) {
	if !sameHost("127.0.0.1", "127.0.0.1") || !sameHost("CAM.local", "cam.local") {
		t.Fatal("sameHost rejected identical hosts")
	}
	if sameHost("127.0.0.1", "127.0.0.2") {
		t.Fatal("sameHost accepted two different addresses")
	}
}
