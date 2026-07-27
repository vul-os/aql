package discovery

import (
	"encoding/binary"
	"encoding/hex"
	"strings"
	"testing"
)

// The fixture below is not a packet this test wrote. It is the exact bytes the
// CONTROLLER's own responder produces — captured by running
// controller/internal/mdns's buildResponse and hex-dumping the result.
//
// That distinction is the point. Writing a second encoder here from the same
// RFC and checking the two agree would prove they match EACH OTHER, which is
// worth nothing: both could read the spec the same wrong way. Parsing the real
// emitter's real output is a genuine cross-implementation check, and it lives in
// a different Go module so the two cannot share code by accident.
//
// If the controller's encoder changes, this fixture goes stale and the test
// starts passing against bytes nobody sends any more — so regenerate it rather
// than editing it by hand. The recipe is in the commit that added this file.
const controllerResponse = "123484000000000400000000075f6c696e74656c045f746370056c6f63616c00000c00010000007800210c61716c2d6465373163653030075f6c696e74656c045f746370056c6f63616c000c61716c2d6465373163653030075f6c696e74656c045f746370056c6f63616c000021800100000078001a0000000022210c61716c2d6465373163653030056c6f63616c000c61716c2d6465373163653030075f6c696e74656c045f746370056c6f63616c00001080010000007800241b6465766963653d6465765f30316879326b336d346e3570367137720770726f746f3d300c61716c2d6465373163653030056c6f63616c0000018001000000780004c0a80830"

func realPacket(t *testing.T) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimSpace(controllerResponse))
	if err != nil {
		t.Fatalf("fixture is not hex: %v", err)
	}
	return b
}

// The whole point of the package: parse what a real controller actually sends.
func TestParsesARealControllerAnnouncement(t *testing.T) {
	found := map[string]*Controller{}
	parseResponse(realPacket(t), found)

	if len(found) != 1 {
		t.Fatalf("found %d controllers in a real announcement, want 1: %+v", len(found), found)
	}
	var c *Controller
	for _, v := range found {
		c = v
	}
	if c.Instance != "aql-de71ce00" {
		t.Errorf("instance = %q", c.Instance)
	}
	if c.DeviceID != "dev_01hy2k3m4n5p6q7r" {
		t.Errorf("device id = %q — the TXT record is how a hub knows WHICH controller "+
			"answered, and pairing against the wrong one is not recoverable from here",
			c.DeviceID)
	}
	if !strings.HasSuffix(c.Addr, ":8737") {
		t.Errorf("addr = %q, want the advertised LAN port", c.Addr)
	}
	if c.Proto != "0" {
		t.Errorf("proto = %q", c.Proto)
	}
}

// A response with no SRV has no port, and an address with no port is not
// something anyone can connect to. Reporting it would put a row in an
// operator's list that cannot be acted on.
func TestARecordWithoutAPortIsNotReported(t *testing.T) {
	pkt := realPacket(t)
	// Flip the SRV type (33) to an unused one so the record is skipped.
	patched := make([]byte, len(pkt))
	copy(patched, pkt)
	n := 0
	for i := 0; i+1 < len(patched); i++ {
		if binary.BigEndian.Uint16(patched[i:i+2]) == 33 {
			binary.BigEndian.PutUint16(patched[i:i+2], 99)
			n++
			break
		}
	}
	if n == 0 {
		t.Skip("no SRV type found to patch; fixture shape changed")
	}
	found := map[string]*Controller{}
	parseResponse(patched, found)
	for _, c := range found {
		if c.Addr != "" {
			t.Errorf("a controller with no SRV was reported with an address: %+v", c)
		}
	}
}

// Our own query, echoed back by the network, must not be read as a response.
func TestOurOwnQueryIsNotMistakenForAnAnswer(t *testing.T) {
	found := map[string]*Controller{}
	parseResponse(buildQuery(ServiceName), found)
	if len(found) != 0 {
		t.Fatalf("a query was parsed as %d responses", len(found))
	}
}

// Anything on a LAN can answer a browse, so the parser is a hostile-input
// surface. None of these may hang or panic.
func TestMalformedPacketsAreSurvived(t *testing.T) {
	real := realPacket(t)
	cases := map[string][]byte{
		"empty":            {},
		"header only":      real[:12],
		"truncated mid-rr": real[:40],
		"claims 65535 answers": func() []byte {
			b := make([]byte, len(real))
			copy(b, real)
			binary.BigEndian.PutUint16(b[6:8], 65535)
			return b
		}(),
		"rdlength past the end": func() []byte {
			b := make([]byte, len(real))
			copy(b, real)
			// The first RR's rdlength sits after the name; overstate it wildly.
			for i := 12; i+2 < len(b); i++ {
				if binary.BigEndian.Uint16(b[i:i+2]) == 12 { // PTR type
					binary.BigEndian.PutUint16(b[i+8:i+10], 60000)
					break
				}
			}
			return b
		}(),
		// A compression pointer that points at itself. An unbounded decoder
		// turns this into a hang, which is a denial of service anything on the
		// LAN could trigger.
		"self-referential pointer": {
			0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0,
			0xC0, 12, 0, 12, 0, 1, 0, 0, 0, 120, 0, 0,
		},
	}
	for name, pkt := range cases {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("%s: panicked: %v", name, r)
				}
			}()
			found := map[string]*Controller{}
			parseResponse(pkt, found) // must simply return
		}()
	}
}

// Records for other services sharing the network must be ignored rather than
// half-parsed into a controller with no id.
func TestRecordsForOtherServicesAreIgnored(t *testing.T) {
	if got := instanceOf("printer._ipp._tcp.local."); got != "" {
		t.Errorf("a foreign service resolved to instance %q", got)
	}
	if got := instanceOf("aql-de71ce00._lintel._tcp.local."); got != "aql-de71ce00" {
		t.Errorf("our own service resolved to %q", got)
	}
}

// A browse must send a well-formed PTR question — a malformed one is answered
// by nobody, and the failure looks exactly like an empty network.
func TestTheQueryIsAWellFormedPTRQuestion(t *testing.T) {
	q := buildQuery(ServiceName)
	if binary.BigEndian.Uint16(q[4:6]) != 1 {
		t.Error("QDCOUNT is not 1")
	}
	if binary.BigEndian.Uint16(q[2:4])&0x8000 != 0 {
		t.Error("the query has the response bit set")
	}
	name, next := decodeName(q, 12)
	if name != ServiceName {
		t.Errorf("question name = %q, want %q", name, ServiceName)
	}
	if binary.BigEndian.Uint16(q[next:next+2]) != 12 {
		t.Error("QTYPE is not PTR")
	}
}

// A newer controller advertising a TXT key this hub does not know must not have
// it silently dropped — an operator debugging a mismatch needs to see what was
// actually sent.
func TestUnknownTXTKeysAreCarriedThrough(t *testing.T) {
	found := map[string]*Controller{}
	parseResponse(realPacket(t), found)
	for _, c := range found {
		if c.Extra == nil {
			t.Error("Extra is nil; an unknown key would have nowhere to go")
		}
	}
}
