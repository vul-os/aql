package httpapi

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Every HTTP entry point must be reachable from the router.
//
// # The gap this closes
//
// internal/store has a reachability test for *Store methods, and its rationale
// applies here word for word: "every previous instance of this was a feature
// that did not work... the tests passed throughout, because the code was
// correct — it just never executed." Nothing held the same line for handlers.
//
// The feature-claims gate cannot either, and says so — caveat 1: "a function
// that exists and is wired up but is buggy, half-finished, or dead code nobody
// calls will still show green here." A handler written, unit-tested, and never
// added to the mux satisfies every check this repository has: it compiles, its
// test passes, `routegen` never sees it because routegen reads the ROUTER, and
// the claims gate finds the symbol and calls it evidence.
//
// # Why the signature and not the name
//
// `handle*` names two different things in this package. Most are HTTP entry
// points. Seven are internal dispatch helpers with other signatures —
// handleOp(w, r, command, payload) behind the open/close routes,
// handleControllerUplink(ctx, deviceID, pub, msg) from the websocket loop,
// handleDiscordEvent from the gateway. Matching on the name flags all seven,
// every one a non-finding.
//
// So this matches the exact entry-point signature. That is the shape only a mux
// can call, which makes "defined and never registered" mean exactly one thing.
//
// Verified against the tree on 2026-08-01: 131 entry points, all registered.
// This enforces a property the package already had.

var (
	entryPointRe = regexp.MustCompile(
		`func \(s \*Server\) (handle[A-Za-z0-9_]+)\(w http\.ResponseWriter, r \*http\.Request\) \{`)
	registeredRe = regexp.MustCompile(`s\.(handle[A-Za-z0-9_]+)`)
)

// unroutedOK names entry points that deliberately have no route.
//
// Empty, and it should stay that way. An entry point with no mux line is a
// feature nobody can reach; if one ever belongs here it needs a reason that
// survives a stranger reading it, in the shape store's allowedUnreachable uses.
// "Not wired up yet" is unfinished work, not an exemption.
var unroutedOK = map[string]string{}

func TestEveryHTTPEntryPointIsRouted(t *testing.T) {
	dir := "."
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	defined := map[string]string{} // handler -> file it is declared in
	var routerSrc strings.Builder
	scanned := 0

	for _, f := range files {
		name := f.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		scanned++
		for _, m := range entryPointRe.FindAllStringSubmatch(string(body), -1) {
			defined[m[1]] = name
		}
		// The router is server.go, but reading EVERY file for registrations is
		// deliberate: a route registered from a second file would otherwise
		// read as unrouted here, and this test would be demanding a change that
		// makes the code worse.
		routerSrc.Write(body)
	}

	if scanned < 20 {
		t.Fatalf("scanned %d source files in this package — the walk is not seeing it", scanned)
	}
	// The guard on the guard. One bad character in entryPointRe and this test
	// passes forever while checking nothing.
	if len(defined) < 100 {
		t.Fatalf("found %d HTTP entry points; this package serves far more, so the "+
			"signature pattern has drifted and this test is checking almost nothing", len(defined))
	}

	registered := map[string]bool{}
	for _, m := range registeredRe.FindAllStringSubmatch(routerSrc.String(), -1) {
		registered[m[1]] = true
	}

	var orphans []string
	for name, file := range defined {
		if registered[name] {
			continue
		}
		if _, ok := unroutedOK[name]; ok {
			continue
		}
		orphans = append(orphans, name+"  ("+file+")")
	}
	sort.Strings(orphans)

	if len(orphans) > 0 {
		t.Errorf(`these HTTP handlers exist and nothing routes them:

  %s

An entry point with no mux line is a feature nobody can reach. It compiles, its
unit test passes, routegen never sees it because routegen reads the router, and
the feature-claims gate finds the symbol and counts it as evidence — so this is
the only thing that would notice.

Route it, delete it, or add it to unroutedOK with a reason that will make sense
to whoever reads it next. "Not wired up yet" is unfinished work, not a reason.`,
			strings.Join(orphans, "\n  "))
	}

	// An exemption must not outlive the handler it names, or it quietly widens
	// what this test permits.
	for name := range unroutedOK {
		if _, ok := defined[name]; !ok {
			t.Errorf("unroutedOK names %q, which is no longer an HTTP entry point — remove it", name)
		}
	}
}
