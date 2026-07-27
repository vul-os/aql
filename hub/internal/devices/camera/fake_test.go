package camera

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// The XML below is captured SHAPE, not a recording: the element structure,
// prefixes and field names a Profile S camera answers with. NOTHING HERE HAS
// EVER SEEN A CAMERA. A fake that agrees with the parser proves the two agree
// with each other — see the package doc for what that does and does not settle.

const capabilitiesReplyXML = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">
 <SOAP-ENV:Body>
  <tds:GetCapabilitiesResponse>
   <tds:Capabilities>
    <tt:Device><tt:XAddr>__DEVICE__</tt:XAddr></tt:Device>
    <tt:Media>
     <tt:XAddr>__MEDIA__</tt:XAddr>
     <tt:StreamingCapabilities>
      <tt:RTPMulticast>false</tt:RTPMulticast>
      <tt:RTP_RTSP_TCP>true</tt:RTP_RTSP_TCP>
     </tt:StreamingCapabilities>
    </tt:Media>
   </tds:Capabilities>
  </tds:GetCapabilitiesResponse>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

const servicesReplyXML = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
 <SOAP-ENV:Body>
  <tds:GetServicesResponse>
   <tds:Service>
    <tds:Namespace>http://www.onvif.org/ver10/device/wsdl</tds:Namespace>
    <tds:XAddr>__DEVICE__</tds:XAddr>
    <tds:Version><tt:Major>2</tt:Major><tt:Minor>60</tt:Minor></tds:Version>
   </tds:Service>
   <tds:Service>
    <tds:Namespace>__MEDIANS__</tds:Namespace>
    <tds:XAddr>__MEDIA__</tds:XAddr>
   </tds:Service>
  </tds:GetServicesResponse>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

// Two profiles, the smaller one first, so "best first" is a real assertion
// rather than an accident of document order.
const profilesReplyXML = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">
 <SOAP-ENV:Body>
  <trt:GetProfilesResponse>
   <trt:Profiles token="Profile_2" fixed="true">
    <tt:Name>subStream</tt:Name>
    <tt:VideoEncoderConfiguration token="VideoEncoder_2">
     <tt:Encoding>H264</tt:Encoding>
     <tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution>
    </tt:VideoEncoderConfiguration>
   </trt:Profiles>
   <trt:Profiles token="Profile_1" fixed="true">
    <tt:Name>mainStream</tt:Name>
    <tt:VideoEncoderConfiguration token="VideoEncoder_1">
     <tt:Encoding>H264</tt:Encoding>
     <tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution>
    </tt:VideoEncoderConfiguration>
   </trt:Profiles>
  </trt:GetProfilesResponse>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

const streamURIReplyXML = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">
 <SOAP-ENV:Body>
  <trt:GetStreamUriResponse>
   <trt:MediaUri>
    <tt:Uri>__URI__</tt:Uri>
    <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
    <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
    <tt:Timeout>PT60S</tt:Timeout>
   </trt:MediaUri>
  </trt:GetStreamUriResponse>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

// authFaultXML is the SOAP 1.2 fault a camera answers with when the
// UsernameToken does not check out.
const authFaultXML = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ter="http://www.onvif.org/ver10/error">
 <SOAP-ENV:Body>
  <SOAP-ENV:Fault>
   <SOAP-ENV:Code>
    <SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value>
    <SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode>
   </SOAP-ENV:Code>
   <SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason>
  </SOAP-ENV:Fault>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

const notSupportedFaultXML = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope">
 <SOAP-ENV:Body>
  <SOAP-ENV:Fault>
   <SOAP-ENV:Code>
    <SOAP-ENV:Value>SOAP-ENV:Receiver</SOAP-ENV:Value>
    <SOAP-ENV:Subcode><SOAP-ENV:Value>ter:ActionNotSupported</SOAP-ENV:Value></SOAP-ENV:Subcode>
   </SOAP-ENV:Code>
   <SOAP-ENV:Reason><SOAP-ENV:Text>Optional Action Not Implemented</SOAP-ENV:Text></SOAP-ENV:Reason>
  </SOAP-ENV:Fault>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

func sub(tpl string, pairs ...string) string {
	for i := 0; i+1 < len(pairs); i += 2 {
		tpl = strings.ReplaceAll(tpl, pairs[i], pairs[i+1])
	}
	return tpl
}

// fakeCam is an in-process ONVIF device. It dispatches on the SOAP action this
// package puts in the Content-Type, which means a wrong or missing action shows
// up as a test failure rather than as a silently wrong answer.
type fakeCam struct {
	*httptest.Server

	mu       sync.Mutex
	ops      []string
	lastBody string
	lastType string

	// Knobs. Zero values give a well-behaved camera.
	mediaXAddr string // where GetCapabilities points; "-" means "none"
	// servicesMedia is where GetServices points, kept separate so a camera can
	// answer one of the two calls and not the other.
	servicesMedia string
	servicesNS    string // namespace advertised by GetServices
	streamURI     string
	profilesBody  string
	// override, when set, answers the request itself and skips the defaults.
	override func(op string, w http.ResponseWriter) bool
}

func newFakeCam(t *testing.T) *fakeCam {
	t.Helper()
	f := &fakeCam{}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Close)
	f.mediaXAddr = f.URL + "/onvif/media_service"
	f.servicesMedia = f.mediaXAddr
	f.servicesNS = nsMediaWSDL
	f.streamURI = "rtsp://" + strings.TrimPrefix(f.URL, "http://") + "/Streaming/Channels/101"
	f.profilesBody = profilesReplyXML
	return f
}

func (f *fakeCam) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	ct := r.Header.Get("Content-Type")
	op := actionOf(ct)

	f.mu.Lock()
	f.ops = append(f.ops, op)
	f.lastBody = string(body)
	f.lastType = ct
	f.mu.Unlock()

	if f.override != nil && f.override(op, w) {
		return
	}
	w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
	switch op {
	case "GetCapabilities":
		media := f.mediaXAddr
		if media == "-" {
			media = ""
		}
		io.WriteString(w, sub(capabilitiesReplyXML, "__DEVICE__", f.deviceAddr(), "__MEDIA__", media))
	case "GetServices":
		io.WriteString(w, sub(servicesReplyXML, "__DEVICE__", f.deviceAddr(),
			"__MEDIANS__", f.servicesNS, "__MEDIA__", f.servicesMedia))
	case "GetProfiles":
		io.WriteString(w, f.profilesBody)
	case "GetStreamUri":
		io.WriteString(w, sub(streamURIReplyXML, "__URI__", f.streamURI))
	default:
		w.WriteHeader(http.StatusInternalServerError)
		io.WriteString(w, notSupportedFaultXML)
	}
}

func (f *fakeCam) deviceAddr() string { return f.URL + "/onvif/device_service" }

func (f *fakeCam) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.ops...)
}

func (f *fakeCam) lastRequest() (body, contentType string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastBody, f.lastType
}

// actionOf extracts the operation name from `action="…/GetProfiles"`.
func actionOf(contentType string) string {
	i := strings.Index(contentType, `action="`)
	if i < 0 {
		return ""
	}
	rest := contentType[i+len(`action="`):]
	j := strings.Index(rest, `"`)
	if j < 0 {
		return ""
	}
	full := rest[:j]
	return full[strings.LastIndex(full, "/")+1:]
}

// --- deterministic soap client ---------------------------------------------

var fixedTime = time.Date(2026, 7, 27, 10, 30, 0, 0, time.UTC)

func fixedNonce() ([]byte, error) { return []byte("0123456789abcdef"), nil }

func testSOAP() *soapClient {
	return &soapClient{
		http:     &http.Client{},
		timeout:  3 * time.Second,
		maxBytes: DefaultMaxResponseBytes,
		now:      func() time.Time { return fixedTime },
		nonce:    fixedNonce,
	}
}
