package lanserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The CORS policy is not the authorization boundary — the signed grant is —
// but it decides who may READ a controller's answers, and "*" would turn every
// gate controller on every LAN into a probe target for a drive-by tab. These
// tests pin the narrow policy rather than the permissive one.

func TestOriginFromWSURL(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"ws://hub.local:8080/api/controller/ws", "http://hub.local:8080"},
		{"wss://gate.example.com/api/controller/ws", "https://gate.example.com"},
		{"ws://192.168.1.10:8080/x", "http://192.168.1.10:8080"},
		// Already-http pairing URLs are accepted too; some deployments store
		// the base rather than the socket.
		{"http://hub.local:8080", "http://hub.local:8080"},
		{"https://gate.example.com", "https://gate.example.com"},

		// Everything below must produce "" — allow NOTHING. A wrong origin is
		// not a lax policy, it is a permanent silent handshake failure, so
		// guessing is worse than refusing.
		{"", ""},
		{"   ", ""},
		{"not a url", ""},
		{"ws://", ""},               // no host
		{"file:///etc/passwd", ""},  // not a scheme a page is served from
		{"javascript:alert(1)", ""}, //
		{"/api/controller/ws", ""},  // relative: no host
	} {
		if got := OriginFromWSURL(tc.in); got != tc.want {
			t.Errorf("OriginFromWSURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// An origin header carries a path or query only if something built it wrong.
// Deriving one that a browser would never send means the comparison can never
// match, so the derived value must be scheme+host+port exactly.
func TestOriginFromWSURLDropsPathAndQuery(t *testing.T) {
	got := OriginFromWSURL("ws://hub.local:8080/api/controller/ws?token=abc#frag")
	if got != "http://hub.local:8080" {
		t.Errorf("got %q, want a bare scheme+host+port origin", got)
	}
}

func corsProbe(t *testing.T, allowOrigin, method, reqOrigin string) *httptest.ResponseRecorder {
	t.Helper()
	h := withCORS(allowOrigin, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(method, "/grant/open", nil)
	if reqOrigin != "" {
		req.Header.Set("Origin", reqOrigin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCORSAllowsOnlyThePairedHubOrigin(t *testing.T) {
	const paired = "http://hub.local:8080"

	rec := corsProbe(t, paired, http.MethodPost, paired)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != paired {
		t.Errorf("paired origin got Allow-Origin %q, want %q", got, paired)
	}

	for _, other := range []string{
		"http://evil.example",
		"https://hub.local:8080", // same host, different scheme
		"http://hub.local:9999",  // same host, different port
		"http://hub.local",       // same host, no port
		"null",                   // sandboxed iframe / file://
	} {
		rec := corsProbe(t, paired, http.MethodPost, other)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %q was allowed (%q); only the paired hub may read these answers", other, got)
		}
	}
}

// An unpaired controller allows nothing. This is the state every deployment was
// in before CORS existed here, and it must remain the default.
func TestCORSAllowsNothingWhenUnpaired(t *testing.T) {
	rec := corsProbe(t, "", http.MethodPost, "http://hub.local:8080")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("an unpaired controller allowed origin %q", got)
	}
}

// Never Allow-Credentials. Nothing here reads a cookie or an Authorization
// header — the signed grant is the entire credential — and allowing them would
// let a same-origin page replay an authenticated session at a gate.
func TestCORSNeverAllowsCredentials(t *testing.T) {
	const paired = "http://hub.local:8080"
	for _, m := range []string{http.MethodPost, http.MethodOptions} {
		rec := corsProbe(t, paired, m, paired)
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
			t.Errorf("%s set Access-Control-Allow-Credentials=%q", m, got)
		}
	}
}

// Vary: Origin, always — including on requests that are refused. Without it a
// shared cache can hand one origin's allow header to a page from another,
// which turns a correct policy into an incorrect one at the cache layer.
func TestCORSAlwaysVariesOnOrigin(t *testing.T) {
	for _, tc := range []struct{ allow, origin string }{
		{"http://hub.local:8080", "http://hub.local:8080"},
		{"http://hub.local:8080", "http://evil.example"},
		{"", "http://hub.local:8080"},
	} {
		rec := corsProbe(t, tc.allow, http.MethodPost, tc.origin)
		if got := rec.Header().Values("Vary"); len(got) == 0 {
			t.Errorf("allow=%q origin=%q: no Vary header", tc.allow, tc.origin)
		}
	}
}

func TestCORSPreflight(t *testing.T) {
	const paired = "http://hub.local:8080"

	rec := corsProbe(t, paired, http.MethodOptions, paired)
	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("preflight carried no Allow-Methods, so the browser will refuse the real request")
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Error("preflight carried no Allow-Headers; the app sends Content-Type: application/json")
	}

	// A preflight from anyone else gets a bare 204 and learns nothing.
	rec = corsProbe(t, paired, http.MethodOptions, "http://evil.example")
	if rec.Code != http.StatusNoContent {
		t.Errorf("refused preflight status %d, want 204", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" ||
		rec.Header().Get("Access-Control-Allow-Methods") != "" {
		t.Error("a disallowed preflight was answered with allow headers")
	}
}

// The preflight must reach the CORS wrapper rather than the mux's own 405.
// Registering only POST would make a browser handshake fail before the real
// request was ever attempted, with no header explaining why.
func TestHandlerAnswersPreflightOnBothEndpoints(t *testing.T) {
	s := &Server{DeviceID: "d", AllowOrigin: "http://hub.local:8080"}
	h := s.Handler()
	for _, path := range []string{"/grant/open", "/grant/proof"} {
		req := httptest.NewRequest(http.MethodOptions, path, nil)
		req.Header.Set("Origin", "http://hub.local:8080")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("%s preflight: status %d, want 204", path, rec.Code)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") == "" {
			t.Errorf("%s preflight carried no Allow-Origin", path)
		}
	}
}
