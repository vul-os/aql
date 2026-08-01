package devices_test

import (
	"fmt"
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

// allowedUncalled maps a symbol to why production does not call it, and to the
// packages that declaration lives in.
//
// # Why the packages are part of the entry
//
// This scan reports NAMES, and an entry used to be a bare name too. A name is
// not unique: an orphan planted in channels called `Params` — a name the camera
// package legitimately has an entry for — was absorbed by that entry instead of
// being reported. The failure it produced was worse than silence: it announced
// that the camera's exemption had gone stale, which is a specific and wrong
// accusation about working code.
//
// Recording where each was granted turns that into a failure. A new declaration
// of an exempt name in a different package changes the site list and fails here,
// which is the same reasoning as the counts in docCitations' historical
// exemptions: an exemption must cover exactly what it was argued for.
//
// "Nothing calls it yet" is unfinished work and does not belong here. The four
// symbols that turned out to mean that were fixed or deleted rather than added.
type exemption struct {
	why string
	in  []string // packages, relative to hub/internal
}

var allowedUncalled = map[string]exemption{
	// Cross-module mirrors: each module holds one independent implementation of
	// the other's half so proto/vectors can check two rather than one.
	"VerifyCommand": {"the CONTROLLER's verification, implemented in the hub; see its declaration", []string{"keys"}},
	"SignCommand":   {"the plain signer; production goes through the rotation-aware wrappers", []string{"keys"}},

	// Config-unaware forms whose config-aware twin is what production must use.
	"Disclosure":  {"declared table verbatim; production needs DisclosureFor, which corrects for the Telegram engine", []string{"channels"}},
	"Disclosures": {"same as Disclosure", []string{"channels"}},

	// Superseded wrappers, kept for tests that want the narrower behaviour.
	"TextGateVerb":       {"collapses TextGateIntent's command-vs-question distinction", []string{"channels"}},
	"GateVerbForCommand": {"the bare mapping under SelectionCommandVerb", []string{"channels"}},
	"TierOf":             {"fail-safe alternative to Supports()+ok that nothing needs", []string{"devices"}},

	// Functional options with no configurator. The three non-test ones are real
	// tunables reachable from nowhere an operator can get to; see their docs.
	"WithClock":                   {"test seam, says so at its declaration", []string{"energy"}},
	"WithReadTimeout":             {"real tunable, no config surface reaches it", []string{"energy"}},
	"WithRollupBudget":            {"real tunable, no config surface reaches it", []string{"energy"}},
	"WithCounterGapInterpolation": {"real tunable whose default is a product decision", []string{"energy"}},

	// Test fixtures and observability.
	"NewMockDriver":       {"the mock driver itself", []string{"devices"}},
	"AddDevice":           {"mock fleet construction", []string{"devices"}},
	"Drop":                {"mock failure injection", []string{"devices"}},
	"Weekdays":            {"builds a day bitmask for readable schedule fixtures", []string{"automations"}},
	"DenialReasons":       {"exists so a test can assert every reason has a message; says so", []string{"channels"}},
	"Intact":              {"camera pipeline observability; see camera/doc.go", []string{"devices/camera"}},
	"VideoResolution":     {"camera pipeline observability; see camera/doc.go", []string{"devices/camera"}},
	"Params":              {"camera pipeline observability; see camera/doc.go", []string{"devices/camera"}},
	"DecodeTime":          {"camera pipeline observability; see camera/doc.go", []string{"devices/camera"}},
	"Sequence":            {"camera pipeline observability; see camera/doc.go", []string{"devices/camera"}},
	"BackwardsTimestamps": {"camera diagnostics; see camera/doc.go", []string{"devices/camera"}},
	"MarkerDisagreements": {"camera diagnostics; see camera/doc.go", []string{"devices/camera"}},
	"Viewers":             {"subscriber accounting; its doc explains why the capture loop cannot use it", []string{"recording"}},

	// Pipeline counters. Both names are declared on more than one type, which is
	// exactly what used to hide them: the other declaration's signature line
	// counted as a use, so neither appeared here until the scan started
	// subtracting every declaring file rather than the first one.
	"Dropped": {"depacketizer and broadcaster loss counters; read by tests and by camera/doc.go's diagnostics story, not by the capture loop", []string{"devices/camera", "recording"}},
	"Emitted": {"the assembler and depacketizer output counters, same story as Dropped", []string{"devices/camera"}},

	// Derived energy figures the API deliberately does not send.
	//
	// GET /v1/accounts/{id}/energy/mix returns the COMPONENTS — kwh,
	// estimated_kwh, coverage_seconds, expected_seconds — and the console does
	// the arithmetic itself (src/components/device/liveState.ts:222 and :315).
	// Sending a derived number as well would be two representations of one fact,
	// which is what the mix design is most careful to avoid.
	"CoverageRatio": {"coverage/expected, derivable by any client from what the mix API already sends", []string{"energy"}},
	"MeasuredKWh":   {"kwh minus estimated_kwh, same reason; note the console branches on a null kwh first, as this function's doc requires", []string{"energy"}},
	"Share":         {"the mix API returns coverage/expected seconds instead, so a client shows the gap", []string{"energy"}},

	// Genuinely incidental.
	"IsNotFound":    {"errors.Is wrapper", []string{"automations"}},
	"UnmarshalJSON": {"called by encoding/json", []string{"httpapi"}},
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

// uncalled returns exported names with no reference outside their own
// declarations.
//
// # Why every declaring file is subtracted, not just the first
//
// This used to record ONE declaring file per name and subtract the `func X(`
// lines only there. Names are declared more than once all over this tree —
// `Execute` on seven driver types, `Dropped` on two — and every other
// declaration's own signature line then counted as a USE of the name. Four
// symbols were invisible because of it, and a planted orphan named after an
// existing symbol was not reported at all: instead the scan announced that the
// allowlist entry for the REAL symbol had gone stale, which is a confident,
// specific, wrong answer.
//
// Uses are still counted across the whole tree rather than per package, so a
// name used in one package counts as used in all of them. That is deliberately
// conservative: it can hide an orphan, never invent one. scripts/deadcode.sh
// does the type-based analysis that resolves it properly, and this stays a
// cheap in-module net for the case deadcode does NOT cover — reachable from a
// test, unreachable from production.
// The returned map is name -> the packages declaring it, relative to
// hub/internal, so an exemption can be held to the site it was argued for.
func uncalled(prod map[string]string) map[string][]string {
	declared := map[string][]string{}
	for p, src := range prod {
		if !strings.Contains(p, "/internal/") || strings.Contains(p, "/internal/store/") {
			continue
		}
		for _, m := range declRe.FindAllStringSubmatch(src, -1) {
			declared[m[1]] = append(declared[m[1]], p)
		}
	}
	out := map[string][]string{}
	for name, sites := range declared {
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`)
		declRe := regexp.MustCompile(`(?m)^func (?:\([^)]*\) )?` + regexp.QuoteMeta(name) + `\(`)
		at := map[string]bool{}
		for _, p := range sites {
			at[p] = true
		}
		uses := 0
		for p, src := range prod {
			n := len(re.FindAllString(src, -1))
			if at[p] {
				n -= len(declRe.FindAllString(src, -1))
			}
			uses += n
		}
		if uses == 0 {
			pkgs := map[string]bool{}
			for _, p := range sites {
				dir := filepath.Dir(p)
				if i := strings.Index(dir, "internal/"); i >= 0 {
					dir = dir[i+len("internal/"):]
				}
				pkgs[dir] = true
			}
			var list []string
			for d := range pkgs {
				list = append(list, d)
			}
			sort.Strings(list)
			out[name] = list
		}
	}
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
	if _, ok := uncalled(sources(t, root, planted))["DeadProbeXYZ"]; ok {
		return
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
	var unexplained, misplaced []string
	for name, pkgs := range found {
		live[name] = true
		e, ok := allowedUncalled[name]
		if !ok {
			unexplained = append(unexplained, name)
			continue
		}
		// The exemption covers the packages it was argued for and no others. A
		// new uncalled declaration of the same name elsewhere is a different
		// symbol with a different reason, and used to be absorbed silently.
		if strings.Join(pkgs, ",") != strings.Join(e.in, ",") {
			misplaced = append(misplaced, fmt.Sprintf("%s: declared in [%s], the exemption covers [%s] — %s",
				name, strings.Join(pkgs, " "), strings.Join(e.in, " "), e.why))
		}
	}
	sort.Strings(unexplained)
	sort.Strings(misplaced)
	if len(misplaced) > 0 {
		t.Errorf(`an exemption is covering a package it was not argued for:

  %s

Adding a symbol here explains ONE declaration. A same-named one in another
package is a different function with a different reason to be unreachable, and
before this check it inherited the first one's excuse.`, strings.Join(misplaced, "\n  "))
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
