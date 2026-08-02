//go:build portal

package portal

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The -tags portal build serves dist/ with SPA history fallback: index.html
// for the root and for unknown client routes, but a real 404 for missing
// asset-looking paths (so a broken bundle reference never renders as a blank
// 200). Exercised against the committed dist/ placeholder.
func TestPortalBuildSPAFallback(t *testing.T) {
	if !spaFallback {
		t.Fatal("portal build must enable SPA fallback")
	}
	h := Handler()

	get := func(p string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", p, nil))
		return rec
	}

	if rec := get("/"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Aql") {
		t.Errorf("root: %d %s", rec.Code, rec.Body)
	}
	// unknown client route → index.html (200), so deep links work
	if rec := get("/admin/accounts"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<html") {
		t.Errorf("client route fallback: %d", rec.Code)
	}
	// missing asset → 404, not HTML
	if rec := get("/assets/missing-bundle.js"); rec.Code != http.StatusNotFound {
		t.Errorf("missing asset must 404: %d", rec.Code)
	}
}

// The API namespace must never be answered by the console.
//
// `/v1/anything-unregistered` has no dot in its last segment, so before this it
// took the client-route branch and returned 200 with index.html. A caller that
// mistypes an endpoint, or one still using a route that was renamed, then gets
// a success carrying HTML instead of a 404 it can act on — and anything that
// checks the status before parsing, `curl -f` included, calls that working.
//
// This test lives in the tagged file because the fallback only exists in the
// tagged build. That is also why it went unrun for so long: nothing executed
// `go test -tags portal` until scripts/check.sh and ci.yml were taught to.
func TestTheAPINamespaceNeverFallsBackToTheConsole(t *testing.T) {
	h := Handler()
	for _, path := range []string{
		"/v1",
		"/v1/",
		"/v1/accounts/x/devices",
		"/v1/does/not/exist",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404 — an unregistered API path answered by the console",
				path, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "json") {
			t.Errorf("%s: content-type %q, want JSON so a client parsing the body gets an error "+
				"rather than a document", path, ct)
		}
		if strings.Contains(rec.Body.String(), "<html") {
			t.Errorf("%s: answered with HTML", path)
		}
	}

	// The control: a real client route still falls back, or this fix has broken
	// deep-linking into the console, which is the entire point of the fallback.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app/hazardous", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("a console deep link now 404s (%d) — the fallback is broken", rec.Code)
	}
}
