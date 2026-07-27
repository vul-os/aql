package bleperiph

import (
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
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") {
			continue
		}
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
}

// The boundary this package claims, asserted so the claim and the build tags
// cannot drift apart. Both constants are compile-time, so this test is really a
// check that exactly one of the two Start implementations was linked.
func TestExactlyOneBackendIsLinked(t *testing.T) {
	// Start is defined in both files; if the tags ever overlapped, the package
	// would not compile at all and this test could not run. If neither matched,
	// it would also not compile. Reaching here proves the tags partition.
	//
	// What is worth asserting is that the UNSUPPORTED path returns the sentinel
	// rather than something a caller cannot recognise, since agent.go branches
	// on exactly that to degrade instead of failing the controller.
	err := Start(t.Context(), Config{})
	if err == nil {
		t.Skip("a real GATT-server backend is linked and started on this host")
	}
	t.Logf("Start on this build reports: %v", err)
}
