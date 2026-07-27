package camera

import (
	"context"
	"encoding/xml"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Every test in this file talks to a UDP socket on loopback that this test file
// controls. NOTHING HERE HAS EVER SEEN A CAMERA, and the reply bodies below are
// captured SHAPES — the element structure, prefixes and scope vocabulary a
// Profile S camera emits — not recordings from a device on someone's desk. What
// they prove is that the probe this package sends is well formed and that the
// parser accepts what it should and refuses what it should. What they cannot
// prove is that a real camera agrees. See the package doc.

// probeMatchTemplate is the reply shape, with __RELATES__ and __XADDR__
// substituted. Written with the prefixes vendors actually use (SOAP-ENV, wsa,
// d, dn) rather than the ones this package emits, because a parser that only
// accepts its own prefixes is a parser that has not been tested.
const probeMatchTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
 <SOAP-ENV:Header>
  <wsa:MessageID>urn:uuid:c0a80132-1111-2222-3333-444455556666</wsa:MessageID>
  <wsa:RelatesTo>__RELATES__</wsa:RelatesTo>
  <wsa:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
  <wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
 </SOAP-ENV:Header>
 <SOAP-ENV:Body>
  <d:ProbeMatches>
   <d:ProbeMatch>
    <wsa:EndpointReference>
     <wsa:Address>urn:uuid:2419d68a-2dd2-21b2-a205-001b7b1b3f77</wsa:Address>
    </wsa:EndpointReference>
    <d:Types>dn:NetworkVideoTransmitter tds:Device</d:Types>
    <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/name/Front%20Gate onvif://www.onvif.org/location/Driveway/North onvif://www.onvif.org/hardware/DS-2CD2143G0-I</d:Scopes>
    <d:XAddrs>__XADDR__</d:XAddrs>
    <d:MetadataVersion>10</d:MetadataVersion>
   </d:ProbeMatch>
  </d:ProbeMatches>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

func fillMatch(relatesTo, xaddr string) []byte {
	s := strings.ReplaceAll(probeMatchTemplate, "__RELATES__", relatesTo)
	return []byte(strings.ReplaceAll(s, "__XADDR__", xaddr))
}

// responder is a fake WS-Discovery device on loopback. reply is handed the
// probe datagram and returns zero or more datagrams to send back.
func responder(t *testing.T, reply func(probe []byte, port int) [][]byte) string {
	t.Helper()
	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("fake responder: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	port := conn.LocalAddr().(*net.UDPAddr).Port

	go func() {
		buf := make([]byte, 65535)
		for {
			n, from, err := conn.ReadFrom(buf)
			if err != nil {
				return
			}
			probe := append([]byte(nil), buf[:n]...)
			for _, out := range reply(probe, port) {
				if out == nil {
					continue
				}
				// A reply larger than the platform's maximum datagram is
				// silently dropped by the kernel, which would make a broken
				// fixture look like a broken parser. Real ProbeMatch replies
				// are a few hundred bytes; keep the fixtures honest.
				if _, err := conn.WriteTo(out, from); err != nil {
					t.Errorf("fake responder could not send a %d byte reply: %v", len(out), err)
				}
			}
		}
	}()
	return conn.LocalAddr().String()
}

// serviceAddr is the fake responder's own address, which is what a camera is
// required to advertise.
func serviceAddr(port int) string {
	return "http://127.0.0.1:" + strconv.Itoa(port) + "/onvif/device_service"
}

// messageIDOf pulls the MessageID out of a probe, which is what a real camera
// has to do to fill in RelatesTo.
func messageIDOf(t *testing.T, probe []byte) string {
	t.Helper()
	var env struct {
		MessageID string `xml:"Header>MessageID"`
	}
	if err := xml.Unmarshal(probe, &env); err != nil {
		t.Fatalf("the probe this package emitted is not parseable XML: %v", err)
	}
	return strings.TrimSpace(env.MessageID)
}

func fastProbe(target string) DiscoveryConfig {
	return DiscoveryConfig{
		Target:   target,
		Timeout:  700 * time.Millisecond,
		Repeats:  1,
		Interval: 10 * time.Millisecond,
	}
}

func TestProbeFindsACameraAndReadsItsScopes(t *testing.T) {
	addr := responder(t, func(probe []byte, port int) [][]byte {
		return [][]byte{fillMatch(messageIDOf(t, probe), serviceAddr(port))}
	})

	cfg := fastProbe(addr)
	cfg.MaxMatches = 1
	got, err := cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1", len(got))
	}
	m := got[0]
	if m.DeviceID != "2419d68a-2dd2-21b2-a205-001b7b1b3f77" {
		t.Fatalf("device id = %q, want the uuid from the endpoint reference", m.DeviceID)
	}
	if m.Name != "Front Gate" {
		t.Fatalf("name = %q, want the percent-decoded scope value", m.Name)
	}
	if m.Location != "Driveway/North" {
		t.Fatalf("location = %q, want the whole hierarchical location scope", m.Location)
	}
	if m.Hardware != "DS-2CD2143G0-I" {
		t.Fatalf("hardware = %q", m.Hardware)
	}
	if !strings.HasSuffix(m.ServiceAddress, "/onvif/device_service") {
		t.Fatalf("service address = %q", m.ServiceAddress)
	}
	if m.Source != "127.0.0.1" {
		t.Fatalf("source = %q, want the packet's real source", m.Source)
	}
}

func TestProbeEmitsAWellFormedOnvifProbe(t *testing.T) {
	seen := make(chan []byte, 1)
	addr := responder(t, func(probe []byte, _ int) [][]byte {
		select {
		case seen <- probe:
		default:
		}
		return nil
	})

	cfg := fastProbe(addr)
	cfg.Timeout = 250 * time.Millisecond
	if _, err := cfg.Probe(context.Background()); err != nil {
		t.Fatalf("Probe: %v", err)
	}

	var probe []byte
	select {
	case probe = <-seen:
	case <-time.After(time.Second):
		t.Fatal("the responder never received a probe")
	}

	var env struct {
		Action    string `xml:"Header>Action"`
		To        string `xml:"Header>To"`
		MessageID string `xml:"Header>MessageID"`
		Types     string `xml:"Body>Probe>Types"`
	}
	if err := xml.Unmarshal(probe, &env); err != nil {
		t.Fatalf("emitted probe is not parseable: %v", err)
	}
	if env.Action != probeAction {
		t.Fatalf("Action = %q, want %q", env.Action, probeAction)
	}
	if env.To != discoveryTo {
		t.Fatalf("To = %q, want %q", env.To, discoveryTo)
	}
	if !strings.HasPrefix(env.MessageID, "urn:uuid:") || len(env.MessageID) != len("urn:uuid:")+36 {
		t.Fatalf("MessageID = %q, want a urn:uuid", env.MessageID)
	}
	if !strings.HasSuffix(env.Types, typeVideoTransmit) {
		t.Fatalf("Types = %q, want it to ask for a %s", env.Types, typeVideoTransmit)
	}
	if !strings.Contains(string(probe), `xmlns:dn="`+nsNetworkWSDL+`"`) {
		t.Fatal("the dn prefix used in Types is never declared; a camera cannot resolve it")
	}
}

func TestProbeIgnoresAReplyThatDoesNotRelateToOurProbe(t *testing.T) {
	addr := responder(t, func(_ []byte, port int) [][]byte {
		return [][]byte{fillMatch("urn:uuid:deadbeef-0000-0000-0000-000000000000", serviceAddr(port))}
	})

	got, err := fastProbe(addr).Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d matches, want 0: an unsolicited reply must not enter the inventory", len(got))
	}

	cfg := fastProbe(addr)
	cfg.AcceptUnrelatedReplies = true
	cfg.MaxMatches = 1
	got, err = cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("with AcceptUnrelatedReplies got %d matches, want 1", len(got))
	}
}

func TestProbeRefusesAServiceAddressOnAnotherHost(t *testing.T) {
	addr := responder(t, func(probe []byte, _ int) [][]byte {
		return [][]byte{fillMatch(messageIDOf(t, probe), "http://192.0.2.50/onvif/device_service")}
	})

	got, err := fastProbe(addr).Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d matches, want 0: a device may only advertise itself", len(got))
	}

	cfg := fastProbe(addr)
	cfg.AcceptForeignServiceAddress = true
	cfg.MaxMatches = 1
	got, err = cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 1 || got[0].ServiceAddress != "http://192.0.2.50/onvif/device_service" {
		t.Fatalf("with AcceptForeignServiceAddress got %+v, want the foreign address accepted", got)
	}
}

func TestProbeRefusesAHostnameServiceAddressAndCredentialsInIt(t *testing.T) {
	for _, xaddr := range []string{
		"http://camera.local/onvif/device_service", // a name cannot be bound to the source
		"http://root:pass@127.0.0.1/onvif/device_service",
		"ftp://127.0.0.1/onvif/device_service",
		"nonsense",
	} {
		addr := responder(t, func(probe []byte, _ int) [][]byte {
			return [][]byte{fillMatch(messageIDOf(t, probe), xaddr)}
		})
		got, err := fastProbe(addr).Probe(context.Background())
		if err != nil {
			t.Fatalf("Probe(%s): %v", xaddr, err)
		}
		if len(got) != 0 {
			t.Fatalf("XAddrs %q was accepted; want it dropped", xaddr)
		}
	}
}

func TestProbeDropsNonCameraDeviceTypes(t *testing.T) {
	// An ONVIF door controller answers the same probe.
	body := func(relates, xaddr string) []byte {
		s := strings.ReplaceAll(string(fillMatch(relates, xaddr)),
			"dn:NetworkVideoTransmitter tds:Device", "tdc:AccessControl")
		return []byte(s)
	}
	addr := responder(t, func(probe []byte, port int) [][]byte {
		return [][]byte{body(messageIDOf(t, probe), serviceAddr(port))}
	})

	got, err := fastProbe(addr).Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d matches, want 0: an access controller is not a camera", len(got))
	}

	cfg := fastProbe(addr)
	cfg.AcceptAnyDeviceType = true
	cfg.MaxMatches = 1
	if got, err = cfg.Probe(context.Background()); err != nil || len(got) != 1 {
		t.Fatalf("with AcceptAnyDeviceType got %d matches (%v), want 1", len(got), err)
	}
}

func TestProbeDropsAMatchWithNoEndpointReference(t *testing.T) {
	addr := responder(t, func(probe []byte, port int) [][]byte {
		s := string(fillMatch(messageIDOf(t, probe), serviceAddr(port)))
		s = strings.ReplaceAll(s, "urn:uuid:2419d68a-2dd2-21b2-a205-001b7b1b3f77", "")
		return [][]byte{[]byte(s)}
	})
	got, err := fastProbe(addr).Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d matches, want 0: no endpoint reference means no stable id", len(got))
	}
}

func TestProbeSurvivesGarbageAndKeepsTheGoodReply(t *testing.T) {
	addr := responder(t, func(probe []byte, port int) [][]byte {
		good := fillMatch(messageIDOf(t, probe), serviceAddr(port))
		return [][]byte{
			[]byte("this is not xml at all"),
			[]byte("<Envelope><Body><ProbeMatches>"), // truncated
			good,
		}
	})
	cfg := fastProbe(addr)
	cfg.MaxMatches = 1
	got, err := cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1: malformed datagrams must not stop collection", len(got))
	}
}

func TestProbeDeduplicatesRepeatedReplies(t *testing.T) {
	addr := responder(t, func(probe []byte, port int) [][]byte {
		good := fillMatch(messageIDOf(t, probe), serviceAddr(port))
		return [][]byte{good, good, good}
	})
	cfg := fastProbe(addr)
	cfg.Repeats = 2
	cfg.Interval = 20 * time.Millisecond
	cfg.Timeout = 400 * time.Millisecond
	got, err := cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1: retransmission means duplicate replies are normal", len(got))
	}
}

func TestProbeCapsTheNumberOfMatches(t *testing.T) {
	// One reply carrying many ProbeMatch elements is the cheap way to try to
	// grow the hub's inventory without bound.
	addr := responder(t, func(probe []byte, port int) [][]byte {
		id := messageIDOf(t, probe)
		var b strings.Builder
		b.WriteString(`<Envelope><Header><RelatesTo>` + id + `</RelatesTo></Header><Body><ProbeMatches>`)
		// Twenty, not two hundred: one datagram has to stay under the
		// platform's maximum UDP payload or the kernel drops it and the test
		// measures nothing.
		for i := 0; i < 20; i++ {
			b.WriteString(`<ProbeMatch><EndpointReference><Address>urn:uuid:` +
				fmt.Sprintf("00000000-0000-0000-0000-%012x", i) +
				`</Address></EndpointReference>`)
			b.WriteString(`<Types>dn:NetworkVideoTransmitter</Types>`)
			b.WriteString(`<XAddrs>` + serviceAddr(port) + `</XAddrs></ProbeMatch>`)
		}
		b.WriteString(`</ProbeMatches></Body></Envelope>`)
		return [][]byte{[]byte(b.String())}
	})
	cfg := fastProbe(addr)
	cfg.MaxMatches = 3
	got, err := cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d matches, want the cap of 3", len(got))
	}
}

func TestProbeReturnsNothingWhenNobodyAnswers(t *testing.T) {
	addr := responder(t, func([]byte, int) [][]byte { return nil })
	cfg := fastProbe(addr)
	cfg.Timeout = 200 * time.Millisecond
	got, err := cfg.Probe(context.Background())
	if err != nil {
		t.Fatalf("Probe: %v, want a silent network to be a non-error", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d matches from a silent responder", len(got))
	}
}

func TestProbeHonoursACancelledContext(t *testing.T) {
	addr := responder(t, func([]byte, int) [][]byte { return nil })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cfg := fastProbe(addr)
	cfg.Timeout = 5 * time.Second
	start := time.Now()
	got, err := cfg.Probe(ctx)
	if err == nil {
		t.Fatal("want an error from a cancelled context")
	}
	if len(got) != 0 {
		t.Fatalf("got %d matches", len(got))
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("Probe waited %v for a context that was already cancelled", time.Since(start))
	}
}

func TestProbeRefusesAnUnusableTarget(t *testing.T) {
	cfg := fastProbe("not-an-address")
	if _, err := cfg.Probe(context.Background()); err == nil {
		t.Fatal("want an error for an unresolvable target")
	}
}

func TestDeviceIDFromEndpoint(t *testing.T) {
	cases := []struct{ in, want string }{
		{"urn:uuid:2419D68A-2DD2-21B2-A205-001B7B1B3F77", "2419d68a-2dd2-21b2-a205-001b7b1b3f77"},
		{"uuid:2419d68a-2dd2-21b2-a205-001b7b1b3f77", "2419d68a-2dd2-21b2-a205-001b7b1b3f77"},
		{"  urn:uuid:2419d68a-2dd2-21b2-a205-001b7b1b3f77  ", "2419d68a-2dd2-21b2-a205-001b7b1b3f77"},
		{"", ""},
	}
	for _, c := range cases {
		if got := deviceIDFromEndpoint(c.in); got != c.want {
			t.Fatalf("deviceIDFromEndpoint(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	// A non-uuid endpoint hashes, stably, and cannot be confused for a uuid.
	a := deviceIDFromEndpoint("http://192.0.2.9/onvif/device")
	b := deviceIDFromEndpoint("http://192.0.2.9/onvif/device")
	if a != b {
		t.Fatalf("a hashed endpoint id is not stable: %q vs %q", a, b)
	}
	if !strings.HasPrefix(a, "epr-") || isUUID(strings.TrimPrefix(a, "epr-")) {
		t.Fatalf("hashed id %q should be prefixed and not uuid-shaped", a)
	}
	if deviceIDFromEndpoint("http://192.0.2.10/onvif/device") == a {
		t.Fatal("two different endpoints hashed to the same id")
	}
}

func TestSanitizeStripsControlCharactersAndCaps(t *testing.T) {
	if got := sanitize("Front\r\nGate: OPEN", 64); got != "FrontGate: OPEN" {
		t.Fatalf("sanitize kept a newline: %q", got)
	}
	long := strings.Repeat("x", 200)
	if got := sanitize(long, 10); len([]rune(got)) != 11 {
		t.Fatalf("sanitize(%d chars, cap 10) produced %d runes", len(long), len([]rune(got)))
	}
	if got := sanitize("   ", 10); got != "" {
		t.Fatalf("sanitize(whitespace) = %q, want empty", got)
	}
}

func TestScopeValueIgnoresForeignSchemes(t *testing.T) {
	scopes := []string{"http://example.com/name/Attacker", "onvif://www.onvif.org/name/Real"}
	if got := scopeValue(scopes, "name"); got != "Real" {
		t.Fatalf("scopeValue = %q, want only the onvif:// scope honoured", got)
	}
	if got := scopeValue(scopes, "location"); got != "" {
		t.Fatalf("scopeValue(location) = %q, want empty", got)
	}
}
