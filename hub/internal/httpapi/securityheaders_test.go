package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Every response carries the browser-facing headers, including the ones that
// are not HTML.
//
// # Why the API routes are checked too
//
// nosniff is about what a browser does with a body whose type it distrusts, and
// a JSON error rendered as HTML is the shape that gets exploited. Setting these
// on the console alone would leave the half of the surface an attacker can
// actually address — a JSON endpoint reachable by URL — without them, and the
// omission would be invisible because the console would look fine.
//
// # frame-ancestors is the one with teeth
//
// This console opens gates. A page on any other site could iframe it and float
// something clickable over the button; an operator who is already signed in
// clicks. Nothing else in this product prevents that, and it costs one header.
func TestEveryResponseCarriesSecurityHeaders(t *testing.T) {
	h := newTestServer(t, "")

	// One HTML path, one JSON path, one refusal. A middleware wired in the wrong
	// place tends to cover the happy route and miss the others.
	for _, path := range []string{"/", "/health", "/v1/accounts/x/nope"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		for header, want := range map[string]string{
			"X-Frame-Options":        "DENY",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy":        "no-referrer",
		} {
			if got := rec.Header().Get(header); got != want {
				t.Errorf("%s: %s = %q, want %q", path, header, got, want)
			}
		}

		csp := rec.Header().Get("Content-Security-Policy")
		if !strings.Contains(csp, "frame-ancestors 'none'") {
			t.Errorf("%s: CSP does not forbid framing: %q", path, csp)
		}
		if !strings.Contains(csp, "object-src 'none'") {
			t.Errorf("%s: CSP allows plugins: %q", path, csp)
		}
		if !strings.Contains(csp, "script-src 'self'") {
			t.Errorf("%s: CSP does not restrict scripts: %q", path, csp)
		}
	}
}

// connect-src stays unrestricted, on purpose, and that decision is pinned so it
// is made rather than drifted into.
//
// The console is built to talk to a hub that did not serve it: the gateway
// picker, the ?gateway= deep link and the desktop shell all rely on it. A
// connect-src of 'self' would break that, and would break it SILENTLY — a
// blocked fetch is indistinguishable from a hub that is down, so the report
// would be "the picker stopped working" with nothing pointing here.
//
// If someone adds it deliberately, this test fails and they can say why.
func TestCSPDoesNotLockConnectSrcAndSaysWhy(t *testing.T) {
	h := newTestServer(t, "")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	csp := rec.Header().Get("Content-Security-Policy")
	if strings.Contains(csp, "connect-src") {
		t.Fatalf(`CSP now restricts connect-src: %q

The console connects to hubs it was not served by — that is what the gateway
picker, the ?gateway= deep link and the desktop shell do. If this restriction is
intended, the picker must be shown to still work against a second hub before
this test is updated: a blocked fetch looks exactly like an unreachable hub.`, csp)
	}
}
