package camera

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestUsernameTokenDigestFollowsTheProfile(t *testing.T) {
	c := testSOAP()
	env, err := c.envelope(`<tds:GetCapabilities/>`, Credential{Username: "admin", Password: "hunter2"})
	if err != nil {
		t.Fatalf("envelope: %v", err)
	}

	// Computed independently of the implementation: the digest a camera will
	// recompute is base64(sha1(nonce || created || password)).
	nonce, _ := fixedNonce()
	created := fixedTime.Format("2006-01-02T15:04:05.000Z")
	h := sha1.New()
	h.Write(nonce)
	h.Write([]byte(created))
	h.Write([]byte("hunter2"))
	want := base64.StdEncoding.EncodeToString(h.Sum(nil))

	if !strings.Contains(env, ">"+want+"<") {
		t.Fatalf("envelope does not carry the expected digest %q:\n%s", want, env)
	}
	if strings.Contains(env, "hunter2") {
		t.Fatal("the password itself appears in the envelope")
	}
	if !strings.Contains(env, base64.StdEncoding.EncodeToString(nonce)) {
		t.Fatal("the nonce is not sent, so the camera cannot recompute the digest")
	}
	if !strings.Contains(env, "<wsu:Created>"+created+"</wsu:Created>") {
		t.Fatalf("the created timestamp is missing or in the wrong format:\n%s", env)
	}
	if !strings.Contains(env, typePasswordDigest) {
		t.Fatal("the password type is not declared as PasswordDigest")
	}
}

func TestEnvelopeCarriesNoSecurityHeaderWithoutCredentials(t *testing.T) {
	env, err := testSOAP().envelope(`<tds:GetCapabilities/>`, Credential{})
	if err != nil {
		t.Fatalf("envelope: %v", err)
	}
	if strings.Contains(env, "Security") {
		t.Fatalf("an empty credential still produced a security header:\n%s", env)
	}
}

func TestEnvelopeEscapesTheUsername(t *testing.T) {
	env, err := testSOAP().envelope(`<tds:GetCapabilities/>`, Credential{Username: `a<b&"c`, Password: "x"})
	if err != nil {
		t.Fatalf("envelope: %v", err)
	}
	if strings.Contains(env, `<wsse:Username>a<b`) {
		t.Fatalf("the username was not escaped:\n%s", env)
	}
	if !strings.Contains(env, "a&lt;b&amp;") {
		t.Fatalf("the username was not escaped as expected:\n%s", env)
	}
}

func TestCallSendsTheActionAndSoap12ContentType(t *testing.T) {
	cam := newFakeCam(t)
	var reply capabilitiesReply
	if err := testSOAP().call(context.Background(), cam.deviceAddr(),
		actionGetCapabilities, `<tds:GetCapabilities/>`, Credential{}, &reply); err != nil {
		t.Fatalf("call: %v", err)
	}
	_, ct := cam.lastRequest()
	if !strings.HasPrefix(ct, "application/soap+xml") {
		t.Fatalf("content type = %q, want SOAP 1.2", ct)
	}
	if !strings.Contains(ct, `action="`+actionGetCapabilities+`"`) {
		t.Fatalf("content type = %q, want the action in it", ct)
	}
}

func TestCallMapsA401ToUnauthorized(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(string, http.ResponseWriter) bool { return false }
	cam.override = func(_ string, w http.ResponseWriter) bool {
		// The shape a camera that wants HTTP Digest rather than WS-Security
		// answers with. This package does not implement Digest.
		w.Header().Set("WWW-Authenticate", `Digest realm="IP Camera", nonce="abc"`)
		w.WriteHeader(http.StatusUnauthorized)
		return true
	}
	var reply capabilitiesReply
	err := testSOAP().call(context.Background(), cam.deviceAddr(),
		actionGetCapabilities, `<tds:GetCapabilities/>`, Credential{Username: "a", Password: "b"}, &reply)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}

func TestCallMapsAnAuthFaultToUnauthorized(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(_ string, w http.ResponseWriter) bool {
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, authFaultXML)
		return true
	}
	var reply capabilitiesReply
	err := testSOAP().call(context.Background(), cam.deviceAddr(),
		actionGetCapabilities, `<tds:GetCapabilities/>`, Credential{Username: "a", Password: "b"}, &reply)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}

func TestCallReportsAnOrdinaryFaultWithoutLeakingTheAddress(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(_ string, w http.ResponseWriter) bool {
		w.WriteHeader(http.StatusInternalServerError)
		io.WriteString(w, notSupportedFaultXML)
		return true
	}
	var reply capabilitiesReply
	err := testSOAP().call(context.Background(), cam.deviceAddr()+"?key=s3cret",
		actionGetCapabilities, `<tds:GetCapabilities/>`, Credential{}, &reply)
	if err == nil {
		t.Fatal("want an error for a SOAP fault")
	}
	if errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, an ActionNotSupported fault is not an auth failure", err)
	}
	if !strings.Contains(err.Error(), "ActionNotSupported") {
		t.Fatalf("err = %v, want the fault subcode named", err)
	}
	if strings.Contains(err.Error(), "s3cret") || strings.Contains(err.Error(), "device_service") {
		t.Fatalf("err = %v leaks the request path", err)
	}
}

func TestCallRefusesAnOversizeReply(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(_ string, w http.ResponseWriter) bool {
		io.WriteString(w, "<Envelope><Body>")
		io.WriteString(w, strings.Repeat("x", 5000))
		io.WriteString(w, "</Body></Envelope>")
		return true
	}
	c := testSOAP()
	c.maxBytes = 1024
	var reply capabilitiesReply
	err := c.call(context.Background(), cam.deviceAddr(), actionGetCapabilities,
		`<tds:GetCapabilities/>`, Credential{}, &reply)
	if err == nil || !strings.Contains(err.Error(), "more than 1024 bytes") {
		t.Fatalf("err = %v, want a refusal on size", err)
	}
}

func TestCallMarksATransportFailure(t *testing.T) {
	cam := newFakeCam(t)
	addr := cam.deviceAddr()
	cam.Close() // nothing is listening now

	var reply capabilitiesReply
	err := testSOAP().call(context.Background(), addr, actionGetCapabilities,
		`<tds:GetCapabilities/>`, Credential{}, &reply)
	if err == nil {
		t.Fatal("want an error when nothing is listening")
	}
	if !isTransport(err) {
		t.Fatalf("err = %v, want it marked as a transport failure so the driver can call it unreachable", err)
	}
	if strings.Contains(err.Error(), "device_service") {
		t.Fatalf("err = %v leaks the request path", err)
	}
}

func TestCallRejectsAReplyThatIsNotSoap(t *testing.T) {
	cam := newFakeCam(t)
	cam.override = func(_ string, w http.ResponseWriter) bool {
		io.WriteString(w, "<html><body>404 not found</body>")
		return true
	}
	var reply capabilitiesReply
	err := testSOAP().call(context.Background(), cam.deviceAddr(), actionGetCapabilities,
		`<tds:GetCapabilities/>`, Credential{}, &reply)
	if err == nil {
		t.Fatal("want an error for a reply that is not a SOAP envelope")
	}
}

func TestParseFaultHandlesSoap11(t *testing.T) {
	const soap11 = `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
 <SOAP-ENV:Body><SOAP-ENV:Fault>
  <faultcode>SOAP-ENV:Client</faultcode>
  <faultstring>Sender not Authorized</faultstring>
 </SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`
	fault := parseFault([]byte(soap11))
	if fault == "" {
		t.Fatal("a SOAP 1.1 fault was not recognised; a refusal would look like an empty success")
	}
	if !isAuthFault(fault) {
		t.Fatalf("fault %q was not recognised as an auth failure", fault)
	}
}

func TestParseFaultIsQuietOnASuccessfulReply(t *testing.T) {
	if f := parseFault([]byte(sub(streamURIReplyXML, "__URI__", "rtsp://192.0.2.1/x"))); f != "" {
		t.Fatalf("parseFault found %q in a successful reply", f)
	}
}

func TestRedactKeepsOnlySchemeAndHost(t *testing.T) {
	if got := redact("http://192.0.2.1:8080/api/KEY123/onvif?token=abc"); got != "http://192.0.2.1:8080" {
		t.Fatalf("redact = %q", got)
	}
	if got := redact("::not a url"); got != "(camera address)" {
		t.Fatalf("redact of junk = %q", got)
	}
}
