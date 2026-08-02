//go:build portal

package portal

import (
	"embed"
	"io/fs"
)

// The real portal build. dist/ is populated by the documented copy step
// (`make -C hub portal`, or npm run build && cp -r dist
// hub/internal/portal/dist), and this file does NOT compile before that runs:
//
//	internal/portal/portal_embed.go:14:12: pattern all:dist: no matching files found
//
// That is deliberate, and the alternative was tried in prose here — this
// comment used to claim "a committed dist/index.html placeholder keeps this
// compilable". Nothing under dist/ is committed (it is gitignored), so the
// claim was false; but committing one would be worse than the confusing error.
// A placeholder that embeds cleanly means `-tags portal` SUCCEEDS with the
// wrong bundle, and an operator gets a running gateway serving a page that
// says the portal is not embedded yet. That failure is invisible: the build is
// green, the container starts, the logs are clean, and only opening a browser
// shows it.
//
// A hard compile error names the missing step. Silence ships the wrong page.
//
//go:embed all:dist
var distFS embed.FS

func init() {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err) // embed is compile-time; cannot fail at runtime
	}
	content = sub
	spaFallback = true
}
