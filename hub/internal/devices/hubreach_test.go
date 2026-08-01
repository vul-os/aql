package devices_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Exported symbols in hub/internal that no production code calls.
//
// internal/store has this for *Store methods and the controller module has it
// for its own exports. Everything ELSE in hub/ had nothing, and that gap cost
// real things — found by running this sweep by hand on 2026-08-01, across 33
// symbols:
//
//   - sealed.NewKey had no caller. Its doc read "returns a fresh random data
//     key, base64 for an operator to store", hub/README.md told an operator to
//     "set AQL_DATA_KEY to a base64 32-byte key", and nothing connected the two.
//     The product could not mint the key it asks for. `aql-hub gen-data-key`.
//   - mqtt.Scan and Candidate.SuggestedConfig had no caller. README advertises
//     bridge discovery and ROADMAP marked it shipped; there was no route and no
//     subcommand, so both documents were true about the code and false about the
//     product. `aql-hub mqtt-scan`.
//   - channels.OccupancyEnabledButUnbuilt and channels.GateQuestionReply were
//     replies for limitations that had since been lifted — unreachable, and
//     their careful reasoning described a product that no longer existed.
//   - accessdev.NewAccessDriver was a one-line alias with no caller anywhere.
//
// None of those is visible from a test of the code itself. Each function works;
// what is missing is the line that lets anyone reach it.
//
// # The allowlist is argued, not bulk-written
//
// store/reachability_test.go says an exemption needs "a reason that will still
// make sense to whoever reads it next", and that writing entries in bulk to
// make a new test go green is the failure mode. Every entry below was
// classified one at a time during that sweep, and most carry the long form at
// their own declaration — the entry here is a pointer, not the argument.

var declRe = regexp.MustCompile(`(?m)^func (?:\([^)]*\) )?([A-Z]\w*)\(`)

// allowedUncalled maps a symbol to why production does not call it.
//
// "Nothing calls it yet" is unfinished work and does not belong here. The four
// symbols that turned out to mean that were fixed or deleted rather than added.
var allowedUncalled = map[string]string{
	// Cross-module mirrors: each module holds one independent implementation of
	// the other's half so proto/vectors can check two rather than one.
	"VerifyCommand": "the CONTROLLER's verification, implemented in the hub; see its declaration",
	"SignCommand":   "the plain signer; production goes through the rotation-aware wrappers",

	// Config-unaware forms whose config-aware twin is what production must use.
	"Disclosure":  "declared table verbatim; production needs DisclosureFor, which corrects for the Telegram engine",
	"Disclosures": "same as Disclosure",

	// Superseded wrappers, kept for tests that want the narrower behaviour.
	"TextGateVerb":       "collapses TextGateIntent's command-vs-question distinction",
	"GateVerbForCommand": "the bare mapping under SelectionCommandVerb",
	"TierOf":             "fail-safe alternative to Supports()+ok that nothing needs",

	// Functional options with no configurator. The three non-test ones are real
	// tunables reachable from nowhere an operator can get to; see their docs.
	"WithClock":                   "test seam, says so at its declaration",
	"WithReadTimeout":             "real tunable, no config surface reaches it",
	"WithRollupBudget":            "real tunable, no config surface reaches it",
	"WithCounterGapInterpolation": "real tunable whose default is a product decision",

	// Test fixtures and observability.
	"NewMockDriver":       "the mock driver itself",
	"AddDevice":           "mock fleet construction",
	"Drop":                "mock failure injection",
	"Weekdays":            "builds a day bitmask for readable schedule fixtures",
	"DenialReasons":       "exists so a test can assert every reason has a message; says so",
	"Intact":              "camera pipeline observability; see camera/doc.go",
	"VideoResolution":     "camera pipeline observability; see camera/doc.go",
	"Params":              "camera pipeline observability; see camera/doc.go",
	"DecodeTime":          "camera pipeline observability; see camera/doc.go",
	"Sequence":            "camera pipeline observability; see camera/doc.go",
	"BackwardsTimestamps": "camera diagnostics; see camera/doc.go",
	"MarkerDisagreements": "camera diagnostics; see camera/doc.go",
	"Viewers":             "subscriber accounting; its doc explains why the capture loop cannot use it",

	// Genuinely incidental.
	"IsNotFound":    "errors.Is wrapper",
	"UnmarshalJSON": "called by encoding/json",
	"Share":         "the mix API returns coverage/expected seconds instead, so a client shows the gap",
}

func hubRoot(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func stripComments(src string) string {
	src = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(src, " ")
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

// sources returns production Go under hub/, comments stripped.
//
// portal/dist is excluded: it is the embedded console BUNDLE, and a minified
// blob containing UI copy matched a symbol name during the manual sweep.
func sources(t *testing.T, root string, extra map[string]string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") {
			return err
		}
		if strings.HasSuffix(p, "_test.go") || strings.Contains(p, "portal/dist") {
			return nil
		}
		body, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[p] = stripComments(string(body))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for p, b := range extra {
		out[p] = stripComments(b)
	}
	return out
}

func uncalled(prod map[string]string) []string {
	declared := map[string]string{}
	for p, src := range prod {
		if !strings.Contains(p, "/internal/") || strings.Contains(p, "/internal/store/") {
			continue
		}
		for _, m := range declRe.FindAllStringSubmatch(src, -1) {
			if _, seen := declared[m[1]]; !seen {
				declared[m[1]] = p
			}
		}
	}
	var out []string
	for name, where := range declared {
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`)
		uses := 0
		for p, src := range prod {
			n := len(re.FindAllString(src, -1))
			if p == where {
				n -= len(regexp.MustCompile(`(?m)^func (?:\([^)]*\) )?`+regexp.QuoteMeta(name)+`\(`).
					FindAllString(src, -1))
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

// The control. A scan reporting zero is indistinguishable from a broken one, and
// the first version of the controller's equivalent DID report zero against a
// tree containing an orphan — a symbol named in its own doc comment counted as a
// reference, so nothing could ever be flagged.
func TestTheUncalledScanCanSeeAnOrphan(t *testing.T) {
	root := hubRoot(t)
	planted := map[string]string{
		filepath.Join(root, "internal", "channels", "zz_probe.go"): "package channels\n\nfunc DeadProbeXYZ() int { return 1 }\n",
	}
	for _, n := range uncalled(sources(t, root, planted)) {
		if n == "DeadProbeXYZ" {
			return
		}
	}
	t.Fatal("the scan did not find a planted orphan, so its verdict on the real tree is worthless")
}

func TestEveryUncalledHubSymbolIsExplained(t *testing.T) {
	root := hubRoot(t)
	prod := sources(t, root, nil)
	if len(prod) < 80 {
		t.Fatalf("walked %d production files — the walk is not seeing hub/", len(prod))
	}

	found := uncalled(prod)
	if len(found) < 10 {
		t.Fatalf("found %d uncalled symbols; the sweep of 2026-08-01 left 27, so this "+
			"scan has stopped looking rather than the tree having improved", len(found))
	}

	live := map[string]bool{}
	var unexplained []string
	for _, name := range found {
		live[name] = true
		if _, ok := allowedUncalled[name]; !ok {
			unexplained = append(unexplained, name)
		}
	}
	if len(unexplained) > 0 {
		t.Errorf(`these exported symbols have no production caller and no entry here:

  %s

Ask what would call it. Twice in one sweep the answer was "nothing, and that is
the bug" — a key the product asks operators for and could not generate, and an
advertised discovery command with no way to run it. Both were complete
implementations missing only the line that reaches them.

If it should be reachable, wire it. If it is a test fixture, a cross-module
mirror or a superseded wrapper, add it with a reason that will make sense to
whoever reads it next.`, strings.Join(unexplained, "\n  "))
	}

	// An entry that is no longer uncalled is a stale exemption, and one that
	// names nothing is a rename nobody finished.
	for name := range allowedUncalled {
		if !live[name] {
			t.Errorf("allowedUncalled explains %q, which now has a production caller or no "+
				"longer exists — remove it", name)
		}
	}
}
