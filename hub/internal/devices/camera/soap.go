package camera

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ONVIF service namespaces used when building requests. Replies are parsed by
// local name (see the response structs), so these only have to be right on the
// way out.
const (
	nsDeviceWSDL = "http://www.onvif.org/ver10/device/wsdl"
	nsMediaWSDL  = "http://www.onvif.org/ver10/media/wsdl"
	nsSchema     = "http://www.onvif.org/ver10/schema"
	nsWSSE       = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
	nsWSU        = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"

	typePasswordDigest = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"
	encodingBase64     = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"
)

// ErrUnauthorized means the camera answered, and refused the credentials. It is
// deliberately distinct from devices.ErrUnreachable: a camera that rejects a
// password is online, its address is right, and the operator has a different
// problem to fix. Reporting it as unreachable sends them looking at cabling.
var ErrUnauthorized = errors.New("camera: the camera rejected the credentials")

// Credential is one camera's ONVIF login. Password is never logged, never put
// in an error, and never placed in a Health.Detail or a device Summary.
type Credential struct {
	Username string
	Password string
}

func (c Credential) empty() bool { return c.Username == "" && c.Password == "" }

// soapClient issues one ONVIF SOAP request and decodes one reply. It holds no
// per-camera state, so it is safe to share across the driver's cameras.
type soapClient struct {
	http     *http.Client
	timeout  time.Duration
	maxBytes int64
	// now and nonce are swappable so the UsernameToken digest is reproducible
	// in a test. Neither is a secret; the password is.
	now   func() time.Time
	nonce func() ([]byte, error)
}

// call POSTs one SOAP body to one endpoint and unmarshals the reply into out.
//
// The mapping from what came back to what the caller gets:
//
//	transport failure, no status      -> a wrapped error; the caller decides
//	                                     it is unreachable
//	401, or a fault whose subcode
//	  mentions NotAuthorized          -> ErrUnauthorized
//	any other SOAP fault              -> an error naming the fault code only
//	2xx with a parseable body         -> nil, out populated
//
// No URL ever reaches an error string. Endpoints here are validated to carry no
// userinfo, but a camera's device service path is still an address an operator
// may not want in a shared log, and redact keeps the messages uniform.
func (c *soapClient) call(ctx context.Context, endpoint, action, inner string, cred Credential, out any) error {
	body, err := c.envelope(inner, cred)
	if err != nil {
		return err
	}

	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		return fmt.Errorf("camera: could not build a request for %s", redact(endpoint))
	}
	req.Header.Set("Content-Type", `application/soap+xml; charset=utf-8; action="`+action+`"`)
	// Harmless under SOAP 1.2 and required by the handful of gSOAP builds that
	// still dispatch on it.
	req.Header.Set("SOAPAction", action)

	resp, err := c.http.Do(req)
	if err != nil {
		// The *url.Error is not wrapped: it stringifies the full URL. cause()
		// in the driver classifies it instead.
		return fmt.Errorf("camera: %s did not answer: %w", redact(endpoint), errTransport{err})
	}
	defer resp.Body.Close()

	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, c.maxBytes+1))
	if int64(len(raw)) > c.maxBytes {
		return fmt.Errorf("camera: %s answered with more than %d bytes", redact(endpoint), c.maxBytes)
	}
	if rerr != nil {
		return fmt.Errorf("camera: the reply from %s was cut short: %w", redact(endpoint), errTransport{rerr})
	}

	if resp.StatusCode == http.StatusUnauthorized {
		// Cameras that want HTTP Digest rather than WS-Security land here. This
		// package does not implement Digest — see the package doc — so from the
		// hub's point of view the outcome is the same: it cannot authenticate.
		return ErrUnauthorized
	}
	if fault := parseFault(raw); fault != "" {
		if isAuthFault(fault) {
			return ErrUnauthorized
		}
		return fmt.Errorf("camera: %s refused the request: %s", redact(endpoint), sanitize(fault, 120))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("camera: %s answered %d", redact(endpoint), resp.StatusCode)
	}
	if err := xml.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("camera: the reply from %s is not a SOAP envelope this package understands", redact(endpoint))
	}
	return nil
}

// errTransport marks an error as "the request did not complete", so the driver
// can map it to devices.ErrUnreachable without matching on message text.
type errTransport struct{ err error }

func (e errTransport) Error() string { return "the request did not complete" }
func (e errTransport) Unwrap() error { return e.err }

func isTransport(err error) bool {
	var t errTransport
	return errors.As(err, &t)
}

// envelope wraps a body, adding a WS-Security UsernameToken when credentials
// are configured.
//
// The digest is base64(sha1(nonce || created || password)) — the UsernameToken
// profile ONVIF Profile S mandates. SHA-1 here is the specification's choice,
// not this package's; see the package doc for what that means over plaintext
// HTTP.
func (c *soapClient) envelope(inner string, cred Credential) (string, error) {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="utf-8"?>`)
	b.WriteString(`<s:Envelope xmlns:s="` + nsSOAP12 + `"`)
	b.WriteString(` xmlns:tds="` + nsDeviceWSDL + `" xmlns:trt="` + nsMediaWSDL + `"`)
	b.WriteString(` xmlns:tt="` + nsSchema + `">`)

	if !cred.empty() {
		raw, err := c.nonce()
		if err != nil {
			return "", fmt.Errorf("camera: could not generate a security nonce: %w", err)
		}
		created := c.now().UTC().Format("2006-01-02T15:04:05.000Z")
		sum := sha1.New()
		sum.Write(raw)
		sum.Write([]byte(created))
		sum.Write([]byte(cred.Password))
		digest := base64.StdEncoding.EncodeToString(sum.Sum(nil))

		b.WriteString(`<s:Header><wsse:Security s:mustUnderstand="1" xmlns:wsse="` + nsWSSE + `" xmlns:wsu="` + nsWSU + `">`)
		b.WriteString(`<wsse:UsernameToken><wsse:Username>`)
		b.WriteString(escapeXML(cred.Username))
		b.WriteString(`</wsse:Username><wsse:Password Type="` + typePasswordDigest + `">`)
		b.WriteString(digest)
		b.WriteString(`</wsse:Password><wsse:Nonce EncodingType="` + encodingBase64 + `">`)
		b.WriteString(base64.StdEncoding.EncodeToString(raw))
		b.WriteString(`</wsse:Nonce><wsu:Created>` + created + `</wsu:Created>`)
		b.WriteString(`</wsse:UsernameToken></wsse:Security></s:Header>`)
	}

	b.WriteString(`<s:Body>`)
	b.WriteString(inner)
	b.WriteString(`</s:Body></s:Envelope>`)
	return b.String(), nil
}

// faultEnvelope covers SOAP 1.2 (Code/Value + Subcode/Value) and the SOAP 1.1
// shape a few older cameras still answer with (faultcode/faultstring). Both are
// parsed by local name, so a prefix nobody expected does not hide a fault and
// make a refusal look like an empty success.
type faultEnvelope struct {
	Code     string `xml:"Body>Fault>Code>Value"`
	Subcode  string `xml:"Body>Fault>Code>Subcode>Value"`
	Reason   string `xml:"Body>Fault>Reason>Text"`
	OldCode  string `xml:"Body>Fault>faultcode"`
	OldStr   string `xml:"Body>Fault>faultstring"`
	Detail11 string `xml:"Body>Fault>detail"`
}

// parseFault returns a short fault description, or "" when the reply carries no
// fault.
func parseFault(raw []byte) string {
	var f faultEnvelope
	if err := xml.Unmarshal(raw, &f); err != nil {
		return ""
	}
	parts := make([]string, 0, 3)
	for _, s := range []string{f.Subcode, f.Code, f.OldCode, f.Reason, f.OldStr, f.Detail11} {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, s)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, " ")
}

// isAuthFault recognises the ONVIF authorisation faults. The vocabulary is not
// uniform across vendors, so this matches on substrings; a false positive costs
// an operator a slightly wrong message, and a false negative would report a
// wrong password as a broken camera.
func isAuthFault(fault string) bool {
	l := strings.ToLower(fault)
	for _, needle := range []string{
		"notauthorized", "not authorized", "unauthorized",
		"failedauthentication", "authentication failed", "sender not authorized",
	} {
		if strings.Contains(l, needle) {
			return true
		}
	}
	return false
}

func randomNonce() ([]byte, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	return b[:], nil
}

func escapeXML(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// redact reduces a URL to scheme and host. Same rule as the HTTP driver: the
// path is dropped rather than sanitised, because there is no reliable way to
// tell a descriptive path segment from a secret one.
func redact(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "(camera address)"
	}
	return u.Scheme + "://" + u.Host
}
