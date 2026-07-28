package bleperiph

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Go applies an IMPLICIT build constraint from a filename suffix: a file named
// `x_linux.go` is compiled only on Linux, whatever its //go:build line says.
//
// That is how the BLE peripheral spent its life Linux-only. The backend is
// entirely portable — every call is the tinygo.org/x/bluetooth GATT-server API,
// and the library ships real implementations for both Linux and Windows — but
// the file was called start_ble_linux.go, so the //go:build line was never
// consulted for any other platform. The NAME was the restriction.
//
// It is a silent failure: the code compiles, the tags look right, and the
// feature is simply absent everywhere else with no error to notice.
func TestNoFileInThisPackageCarriesAnImplicitPlatformConstraint(t *testing.T) {
	// Every GOOS and GOARCH Go treats as a filename suffix. A file may still
	// legitimately end in one of these — but in THIS package it would silently
	// narrow a backend that is deliberately cross-platform, so the rule here is
	// simply: don't.
	suffixes := []string{
		"_linux", "_windows", "_darwin", "_freebsd", "_openbsd", "_netbsd",
		"_js", "_wasip1", "_android", "_ios", "_plan9", "_solaris", "_aix",
		"_amd64", "_arm", "_arm64", "_386", "_riscv64", "_mips", "_mips64",
	}

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	examined := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") {
			continue
		}
		examined++
		base := strings.TrimSuffix(name, ".go")
		base = strings.TrimSuffix(base, "_test")
		for _, suf := range suffixes {
			if strings.HasSuffix(base, suf) {
				t.Errorf("%s ends in %q, so Go compiles it only on that platform "+
					"regardless of its //go:build line. In this package that "+
					"silently narrows a portable backend — rename it and express "+
					"the constraint in //go:build, where it can be read.",
					filepath.Base(name), suf)
			}
		}
	}

	// A floor, because this check is shaped "look at every file, report
	// offenders" — which passes perfectly when it looks at NO files. A wrong
	// directory or a changed filter would make it go quiet rather than fail,
	// and a quiet guard is indistinguishable from a healthy one. The package
	// has several files; three is a floor, not a count.
	if examined < 3 {
		t.Fatalf("examined only %d .go files in this package, so this guard would "+
			"report no offenders whatever the filenames were", examined)
	}
}

// The boundary this package claims, asserted so the claim and the build tags
// cannot drift apart.
//
// Start is defined in both files; if the tags ever overlapped the package would
// not compile, and if neither matched it would not compile either. So reaching
// here proves the tags partition — but that is ALL it proved, and the previous
// version of this test stopped there: it logged whatever Start returned and
// asserted nothing about it.
//
// The assertion that matters was written in that comment and never made. On a
// build with no backend, Start must return exactly ErrUnsupported, because
// agent.go branches on errors.Is(err, ErrUnsupported) to log a warning and
// carry on. Any other error goes to the agent's error channel instead — so a
// stub returning something else does not degrade the BLE feature, it stops the
// controller from running. On the default build, which is every controller not
// built with `-tags ble`.
//
// context.Background() rather than t.Context(): this module targets go1.23 and
// t.Context() landed in 1.24. `go test` hid that once — the package was cached
// from before the file existed — and only `go vet` caught it.
func TestExactlyOneBackendIsLinked(t *testing.T) {
	err := Start(context.Background(), Config{})

	if !BackendLinked {
		if !errors.Is(err, ErrUnsupported) {
			t.Fatalf("this build links no GATT-server backend, so Start must return "+
				"ErrUnsupported — agent.go recognises only that and treats anything "+
				"else as fatal, which would stop the controller rather than degrade "+
				"the feature. Got: %v", err)
		}
		return
	}

	// A real backend is linked. It may still fail for want of a radio, an
	// adapter or permission, and that is not this test's business — but it must
	// NOT claim to be unsupported, because the agent would then quietly skip a
	// backend this build actually has.
	if errors.Is(err, ErrUnsupported) {
		t.Fatalf("a real backend is linked, yet Start reported ErrUnsupported; the " +
			"agent would log a warning and skip BLE on a build that supports it")
	}
	t.Logf("backend linked; Start on this host reports: %v", err)
}
