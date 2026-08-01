package agent_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Exported controller symbols that only tests reach.
//
// internal/store has this test for the hub and its reasoning is quoted here
// unchanged: "every previous instance of this was a feature that did not work —
// a verified phone nobody could obtain, a chat identity nothing could bind, a
// retention window that never ran. The tests passed throughout, because the
// code was correct — it just never executed." The controller had no equivalent.
//
// # The false-positive control, which is the only reason this is trustworthy
//
// The first version of this scan reported zero orphans against a tree that
// contained one. A symbol named in its own doc comment counted as a reference,
// so every declaration referenced itself and nothing could ever be orphaned —
// the same comments-are-not-evidence bug the feature-claims gate warns about in
// its caveat 4.
//
// It was found by PLANTING a dead exported function and checking the scan saw
// it. That control runs below, on every invocation, for exactly that reason: a
// reachability scan reporting zero is indistinguishable from a broken one, and
// the difference matters more than the result.

var (
	declRe    = regexp.MustCompile(`(?m)^func (?:\([^)]*\) )?([A-Z]\w*)\(`)
	blockCmnt = regexp.MustCompile(`(?s)/\*.*?\*/`)
)

// allowedTestOnly names exported symbols production is not expected to call,
// each with a reason that has to survive a stranger reading it.
//
// "Nothing calls it yet" is unfinished work and does not belong here.
var allowedTestOnly = map[string]string{
	"VerifyWSAuth": "the HUB's side of ws.auth, implemented here on purpose. The hub is a " +
		"separate Go module and cannot import controller/internal, so this is the second, " +
		"independent implementation the conformance vectors check the hub's own verifier " +
		"against. A contract with one implementation is a contract nobody has checked.",

	"Mark": "superseded, and kept only because tests seed nonces with it. Production uses " +
		"MarkIfUnseen, which is ATOMIC — Mark is check-then-write and is exactly the shape " +
		"that reintroduces the replay race MarkIfUnseen exists to close. Nothing outside a " +
		"test may call it; see the warning at its declaration.",

	"NewGPIO": "a convenience constructor for tests. Production opens a relay through " +
		"relay.OpenSpec, which builds a GPIOConfig from the parsed -relay spec, so the " +
		"driver itself is fully reachable — this wrapper is not the driver.",

	"NewWSConn": "wraps an already-upgraded connection for the fake gateway in tests, and " +
		"says so at its declaration. Production upgrades its own connection.",

	"Partial": "a Reassembler predicate used to assert mid-frame state in framing tests. " +
		"Production reads frames to completion and never asks.",

	"WSAccept": "a one-line exported wrapper over the unexported wsAccept, so the " +
		"fake-gateway test server can compute a Sec-WebSocket-Accept. The real handshake " +
		"uses wsAccept directly.",

	"OverflowEntriesForTest": "named for what it is.",
	"SetSyncForTest":         "named for what it is.",
}

func controllerRoot(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// stripComments removes what a symbol name may appear in without being a use.
func stripComments(src string) string {
	src = blockCmnt.ReplaceAllString(src, " ")
	var b strings.Builder
	for _, line := range strings.Split(src, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "//") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}

type sources struct{ prod, test map[string]string }

func loadSources(t *testing.T, root string, extra map[string]string) sources {
	t.Helper()
	s := sources{prod: map[string]string{}, test: map[string]string{}}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") {
			return err
		}
		body, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if strings.HasSuffix(p, "_test.go") {
			s.test[p] = stripComments(string(body))
		} else {
			s.prod[p] = stripComments(string(body))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for p, body := range extra {
		s.prod[p] = stripComments(body)
	}
	return s
}

// orphans returns exported symbols declared under internal/ that no production
// file references.
func orphans(src sources) []string {
	declared := map[string]string{}
	for p, body := range src.prod {
		if !strings.Contains(p, string(filepath.Separator)+"internal"+string(filepath.Separator)) {
			continue
		}
		for _, m := range declRe.FindAllStringSubmatch(body, -1) {
			if _, seen := declared[m[1]]; !seen {
				declared[m[1]] = p
			}
		}
	}
	var out []string
	for name, where := range declared {
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`)
		uses := 0
		for p, body := range src.prod {
			n := len(re.FindAllString(body, -1))
			if p == where {
				// Discount the declaration itself, not references to it.
				n -= len(regexp.MustCompile(`(?m)^func (?:\([^)]*\) )?`+regexp.QuoteMeta(name)+`\(`).
					FindAllString(body, -1))
			}
			uses += n
		}
		if uses == 0 {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func TestTheReachabilityScanCanSeeAnOrphan(t *testing.T) {
	root := controllerRoot(t)
	// A dead exported function that exists only in memory. If the scan cannot
	// find this, its verdict on the real tree means nothing — which is exactly
	// what happened to the first version, where a symbol named in its own doc
	// comment counted as a use.
	planted := map[string]string{
		filepath.Join(root, "internal", "clock", "zz_planted_probe.go"): `package clock

// A probe. Never written to disk.
func DeadProbeNobodyCalls() int { return 42 }
`,
	}
	found := orphans(loadSources(t, root, planted))
	var saw bool
	for _, n := range found {
		if n == "DeadProbeNobodyCalls" {
			saw = true
		}
	}
	if !saw {
		t.Fatalf("the scan did not find a planted orphan, so its verdict on the real tree "+
			"is worthless; it reported: %v", found)
	}
}

func TestEveryExportedControllerSymbolIsReachableFromProduction(t *testing.T) {
	root := controllerRoot(t)
	src := loadSources(t, root, nil)
	if len(src.prod) < 20 {
		t.Fatalf("walked %d production files — the walk is not seeing the module", len(src.prod))
	}

	var unexplained []string
	for _, name := range orphans(src) {
		if _, ok := allowedTestOnly[name]; !ok {
			unexplained = append(unexplained, name)
		}
	}
	if len(unexplained) > 0 {
		t.Errorf(`these exported symbols are reachable only from tests:

  %s

The question is not "is it right", it is "what calls it in production". If the
answer is nothing yet, that is unfinished work. If it genuinely never should be
called from production, add it to allowedTestOnly with a reason that will still
make sense to whoever reads it next.`, strings.Join(unexplained, "\n  "))
	}

	// An allowlist entry that is now reachable, or names a symbol that no longer
	// exists, is a stale exemption quietly widening what this permits.
	live := map[string]bool{}
	for _, n := range orphans(src) {
		live[n] = true
	}
	declared := map[string]bool{}
	for p, body := range src.prod {
		if !strings.Contains(p, string(filepath.Separator)+"internal"+string(filepath.Separator)) {
			continue
		}
		for _, m := range declRe.FindAllStringSubmatch(body, -1) {
			declared[m[1]] = true
		}
	}
	for name := range allowedTestOnly {
		if !declared[name] {
			t.Errorf("allowedTestOnly names %q, which is no longer an exported symbol — remove it", name)
			continue
		}
		if !live[name] {
			t.Errorf("allowedTestOnly still exempts %q, but production calls it now — remove the exemption", name)
		}
	}
}
