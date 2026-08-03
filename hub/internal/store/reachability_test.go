package store

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// A drift alarm for the defect this codebase keeps producing: a store method
// that is correct, tested, carefully documented — and that nothing in
// production ever calls.
//
// It has happened four times, and every one of them was invisible to every
// other check, because nothing was broken. The feature simply never ran:
//
//   - store.AddVerifiedPhone was the ONLY writer of profile_phone_numbers'
//     verified_at, and had test callers and no others. Every chat-rail lookup
//     filters on that column, so no member could ever be recognised and every
//     WhatsApp open was refused. Built, tested, documented as shipped, inert.
//   - store.LinkChannelIdentity was the same thing for Telegram, Slack,
//     Discord and DMTAP.
//   - energy.PruneSamples was written and guarded with real care and never
//     called, so the samples table grew forever on the Raspberry Pi this
//     product targets.
//   - (sibling shape, not caught by this test) the hub verified controller
//     events and then dropped them on the floor.
//
// A method reached only from _test.go files is the signature of all of these:
// the tests prove the code is right, and nothing proves it runs.
//
// WHAT THIS CANNOT SEE. Reachability here is "referenced from a non-test file
// outside internal/store", plus a transitive pass inside it. That is a
// file-granularity approximation, so a method called only from a dead branch
// still counts as reachable. It also says nothing about the sibling shape
// above — a handler that receives something and discards it is fully
// "reachable". This catches one specific, repeatedly-observed failure, not
// dead code in general.
//
// It also matches call sites TEXTUALLY (".Name("), so a method whose name is
// also defined on some other type is marked reachable when that other type's
// method is the one being called. Three names currently overlap — Close,
// DeleteRule and Location — and all three store versions were checked by hand
// and are genuinely called on their own (cmd/hub calls st.Close; the
// automations engine calls its store's DeleteRule; httpapi calls the energy
// store's Location). Nothing is masked today. If a fourth name starts
// overlapping, that check has to be redone by hand, because this test will not
// do it for you.
//
// The frontend has the same guard for its own layer, and it shipped with a
// closely related hole: src/lib/__tests__/apiReachability.test.ts could not see
// `api\n  .method()`, so a wired-up method still looked uncalled and the
// stale-allowlist check stayed quiet. Textual reachability checks are worth
// having and are worth distrusting in exactly this way.

// allowedUnreachable is an allowlist, and every entry needs a REASON that
// survives someone reading it a year from now. "It's fine" is not a reason.
//
// Adding a name here is a claim that production genuinely does not need to
// call it. If the honest answer is "we never finished wiring it up", the entry
// belongs in todo as work, not here as an exception.
var allowedUnreachable = map[string]string{
	"AddVerifiedPhone": "cross-package test fixture. Production verifies a phone through the " +
		"link ceremony (RedeemPhoneLinkCode), which shares this method's write via " +
		"addVerifiedPhoneTx because it must run inside the transaction that spends the code. " +
		"Kept exported so httpapi's tests can set up a verified member without replaying " +
		"the whole ceremony.",
	"LinkChannelIdentity": "same as AddVerifiedPhone, for channel_identities: production goes " +
		"through RedeemChannelLinkCode, which shares the write via linkChannelIdentityTx.",
	"ExpireDeviceClaim": "explicitly a test/dev hook and says so at its declaration: it " +
		"force-expires a pending claim so tests can time-travel, and no HTTP route exposes " +
		"it. A route that let a caller expire someone else's pending claim would be a " +
		"denial-of-service on pairing, so this staying unreachable is the point.",
	"SetInviteTokenHash": "same shape, same comment at its declaration: with invite delivery " +
		"mocked, tests recover a token by overwriting token_hash. Exposing it would let a " +
		"caller replace an invite's credential with one they chose.",
	"PhoneVerified": "read helper used by tests to assert the ceremony's outcome. The " +
		"production read path is the channels.go resolution queries, which filter on " +
		"verified_at directly in SQL rather than calling this.",
}

var storeMethodRe = regexp.MustCompile(`^func \(s \*Store\) ([A-Z]\w*)\(`)

// Exported methods on this package's OTHER exported types — Grant, T4Window,
// StepUpIntent, Coverage, APITokenPrincipal and the rest.
//
// Added because two dead methods were found sitting exactly in the gap between
// this test and the deadcode gate, and neither could see them:
//
//   - This test enumerated `func (s *Store)` only, so a method on any other
//     receiver was never a candidate.
//   - scripts/deadcode.sh does not report an unreachable METHOD on a type that
//     is ever assigned to an interface. That was measured rather than assumed:
//     planting one dead func and one dead method on *StepUpIntent in this
//     package, the sweep reported the func and stayed silent about the method.
//
// StepUpIntent.Approvable was the one that mattered. It duplicated, in Go, a
// check that ClaimStepUpIntent performs atomically in SQL, so its existence
// invited exactly the check-then-act the atomic claim was written to prevent —
// two console tabs both reading "approvable" and both actuating.
// APITokenPrincipal.ScopeList was the milder kind: a helper whose doc claimed a
// purpose ("logs, audit detail") that nothing fulfilled, kept alive only by an
// error-message format string in a test.
//
// The transitive pass below is what makes this workable: four methods here are
// called only from inside internal/store (Coverage.DayObserved and DayPartial,
// AnalyticsWindow.Previous, GeofenceRule.DeniesOnMissingLocation) and are
// legitimately reachable through the *Store methods declared beside them.
var typeMethodRe = regexp.MustCompile(`^func \([a-z]\w* \*?([A-Z]\w*)\) ([A-Z]\w*)\(`)

// hubRoot walks up from this package to the hub module root.
func hubRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("expected the hub module root at %s: %v", root, err)
	}
	return root
}

type sourceFile struct {
	path string
	body string
}

func nonTestSources(t *testing.T, root string) []sourceFile {
	t.Helper()
	var out []sourceFile
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if name := info.Name(); name == "testdata" || name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out = append(out, sourceFile{path: p, body: string(b)})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestEveryStoreMethodIsReachableFromProduction(t *testing.T) {
	root := hubRoot(t)
	files := nonTestSources(t, root)

	// Declarations, and the file each one lives in.
	declFile := map[string]string{}
	// Counted where the entry is ADDED, not by re-scanning with the regex.
	//
	// The first version of this floor re-ran typeMethodRe over the files to
	// count matches, which measured the regex rather than the enforcement:
	// disabling the line that puts those methods into declFile left the count
	// at 17 and the floor silent, so the widened check could be switched off
	// without failing anything. Verified by tampering exactly that line.
	onTypes := 0
	for _, f := range files {
		// Parse to confirm the file is real Go before trusting a regex over
		// it; a scan that silently skips unparseable files reports zero.
		if _, err := parser.ParseFile(token.NewFileSet(), f.path, f.body, parser.PackageClauseOnly); err != nil {
			t.Fatalf("parsing %s: %v", f.path, err)
		}
		for _, line := range strings.Split(f.body, "\n") {
			if m := storeMethodRe.FindStringSubmatch(line); m != nil {
				declFile[m[1]] = f.path
				continue
			}
			// Only inside this package: the rule being enforced is about
			// store types, and a scan of the whole module would sweep in every
			// other package's methods under a name-keyed map.
			if !strings.Contains(filepath.ToSlash(f.path), "/internal/store/") {
				continue
			}
			if m := typeMethodRe.FindStringSubmatch(line); m != nil && m[1] != "Store" {
				declFile[m[2]] = f.path
				onTypes++
			}
		}
	}

	// A scan that found nothing would pass while checking nothing. This repo
	// has produced that exact vacuous guard before (naming.test.ts).
	if len(declFile) < 100 {
		t.Fatalf("found only %d store methods; the walk is broken, not the code", len(declFile))
	}
	// A separate floor for the widened class. Without it, a regex that stopped
	// matching non-*Store receivers would leave the total above 100 on the
	// strength of the *Store methods alone, and this check would go quiet
	// while covering exactly what it covered before.
	if onTypes < 15 {
		t.Fatalf("found only %d exported methods on non-*Store types; there were 17 when "+
			"this floor was written, so the second regex has stopped matching", onTypes)
	}

	// Which methods each file mentions.
	refs := map[string]map[string]bool{}
	for _, f := range files {
		set := map[string]bool{}
		for name := range declFile {
			// Call syntax only. A METHOD VALUE — `cfg.Owner = s.AccountForDeviceKey`,
			// with no parentheses — is real production reachability and is
			// invisible here. That is a known limitation and not worth the
			// false positives that matching a bare `.Name` would bring: this
			// file would then count every mention in a comment or a doc string
			// as a caller, which is exactly the kind of "guard that agrees with
			// anything" the rest of this repository keeps deleting.
			//
			// The convention that keeps it honest is to wire such a dependency
			// as a closure that CALLS the method. It costs two lines and it
			// keeps this check strict.
			if strings.Contains(f.body, "."+name+"(") {
				set[name] = true
			}
		}
		refs[f.path] = set
	}

	inStore := func(p string) bool {
		return strings.Contains(filepath.ToSlash(p), "/internal/store/")
	}

	// Seed: referenced from outside internal/store at all.
	reachable := map[string]bool{}
	for _, f := range files {
		if inStore(f.path) {
			continue
		}
		for name := range refs[f.path] {
			reachable[name] = true
		}
	}
	// Transitive closure: a reachable method's own file may call others.
	for changed := true; changed; {
		changed = false
		for name := range reachable {
			f, ok := declFile[name]
			if !ok {
				continue
			}
			for n2 := range refs[f] {
				if !reachable[n2] {
					reachable[n2] = true
					changed = true
				}
			}
		}
	}

	var offenders []string
	for name, file := range declFile {
		if reachable[name] {
			continue
		}
		if _, ok := allowedUnreachable[name]; ok {
			continue
		}
		rel, _ := filepath.Rel(root, file)
		offenders = append(offenders, "  "+name+"  ("+filepath.ToSlash(rel)+")")
	}
	sort.Strings(offenders)

	if len(offenders) > 0 {
		t.Fatalf(`these *Store methods are reachable only from tests:

%s

Every previous instance of this was a feature that did not work: a verified
phone nobody could obtain, a chat identity nothing could bind, a retention
window that never ran. The tests passed throughout, because the code was
correct — it just never executed.

So the question is not "is this method right", it is "what calls it in
production". If the answer is nothing yet, that is unfinished work and belongs
in todo. If it genuinely never should be called from production, add it to
allowedUnreachable with a reason that will still make sense to whoever reads
it next.`, strings.Join(offenders, "\n"))
	}

	// The allowlist must not rot either: an entry for a method that no longer
	// exists, or that is now reachable, is a stale exemption quietly widening
	// what this test permits.
	for name := range allowedUnreachable {
		if _, ok := declFile[name]; !ok {
			t.Errorf("allowedUnreachable names %q, which is no longer a *Store method — remove it", name)
			continue
		}
		if reachable[name] {
			t.Errorf("allowedUnreachable still exempts %q, but production calls it now — remove the exemption", name)
		}
	}
}
