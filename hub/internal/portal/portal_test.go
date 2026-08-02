//go:build !portal

package portal

import (
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

// The default build (no portal tag) serves the placeholder and does NOT do
// SPA fallback — every unknown path is a plain 404, matching a static file
// server. The -tags portal build's SPA behavior is documented and exercised
// manually against a real dist/; here we assert the default seam.
func TestDefaultBuildServesPlaceholder(t *testing.T) {
	h := Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Aql hub") {
		t.Fatalf("placeholder: %d %s", rec.Code, rec.Body)
	}
	if spaFallback {
		t.Error("default build must not enable SPA fallback")
	}
}

// Nothing under dist/ may be committed.
//
// The embed in portal_embed.go does not compile until the bundle is built, and
// the error it prints (`pattern all:dist: no matching files found`) reads like
// something to fix by adding a file. Adding one "fixes" it in the worst way:
// `-tags portal` then succeeds embedding a placeholder, and the gateway serves
// a page saying the portal is not embedded yet — with a green build, a running
// container and clean logs. The only symptom is a human opening a browser.
//
// This ran for real on 2026-08-02: a stale Docker layer produced an image
// serving exactly that page, and it took a rebuild under a second tag to tell
// the difference between a caching artifact and a shipped placeholder. A
// committed placeholder makes that state reachable from a clean checkout.
//
// Deliberately git-based rather than a filesystem check: dist/ is SUPPOSED to
// exist locally after `make -C hub portal`, so os.Stat proves nothing. The
// question is only ever what is tracked.
func TestPortalDistIsNotCommitted(t *testing.T) {
	// "dist", not "internal/portal/dist": `go test` runs with the working
	// directory set to the PACKAGE dir, so the longer path resolves to
	// internal/portal/internal/portal/dist, matches nothing, and the check
	// passes no matter what is committed. It did exactly that when written,
	// and staging a placeholder to test it is the only reason I know.
	out, err := exec.Command("git", "ls-files", "dist").Output()
	if err != nil {
		t.Skipf("git unavailable: %v", err)
	}
	if tracked := strings.TrimSpace(string(out)); tracked != "" {
		t.Fatalf("these are committed under internal/portal/dist, which lets a "+
			"placeholder bundle ship as if it were the console:\n%s", tracked)
	}
}
