package store

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Every way THROUGH a gate is decided in one place.
//
// openpath.go states the rule and the reason: "This function exists rather than
// an `== \"open\"` comparison at each site precisely so that adding a third way
// through cannot be done by widening one branch and forgetting five. Every
// denial below funnels through it."
//
// It holds today — six restriction sites call opensTheWay and none compares to
// the literal. Nothing enforced it. A seventh check written as
// `args.Command == "open"` would be correct-looking, would pass every test in
// this package, and would let a HOLD skip whichever restriction it guarded:
// the time window, the geofence, the quota, the suspension. A gate held open is
// a gate opened, for longer, so a hold that skips a check is strictly worse
// than an open that does.
//
// Deliberately a source check rather than a behavioural one. The behaviour of
// the sites that exist is covered; what cannot be tested by exercising the code
// is a site nobody has written yet, and that is the failure this rule was
// written to prevent.
func TestEveryWayThroughFunnelsThroughOpensTheWay(t *testing.T) {
	src, err := os.ReadFile("openpath.go")
	if err != nil {
		t.Fatal(err)
	}

	// Comments explain the rule by quoting the thing it forbids, so a guard
	// that reads them measures the explanation instead of the code. Strip
	// them first — this file's own header is why.
	code := regexp.MustCompile(`(?m)^\s*//.*$`).ReplaceAllString(string(src), "")
	code = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(code, "")

	offenders := []string{}
	inHelper := false
	for i, line := range strings.Split(code, "\n") {
		if strings.HasPrefix(line, "func opensTheWay(") {
			inHelper = true
			continue
		}
		if inHelper {
			if strings.HasPrefix(line, "}") {
				inHelper = false
			}
			continue // the one place the literal belongs
		}
		if strings.Contains(line, `== "open"`) || strings.Contains(line, `!= "open"`) {
			offenders = append(offenders, strings.TrimSpace(line)+" (line "+itoa(i+1)+")")
		}
	}
	if len(offenders) > 0 {
		t.Errorf("openpath.go compares a command to \"open\" outside opensTheWay:\n  %s\n"+
			"Use opensTheWay(). A site that names only \"open\" lets a HOLD past whatever "+
			"it guards, and a gate held open is a gate opened for longer.",
			strings.Join(offenders, "\n  "))
	}

	// The premise: the helper is actually used. Without this, deleting every
	// call site would leave nothing to compare against the literal and this
	// test would pass on a file that decides nothing.
	// Call sites only. Counting every occurrence includes the declaration, so
	// the first version of this floor read 7 as 6 and passed with a call site
	// deleted — the tamper said so.
	calls := strings.Count(code, "opensTheWay(") - strings.Count(code, "func opensTheWay(")
	if calls < 6 {
		t.Errorf("opensTheWay has %d call sites; it had 6. Either a restriction lost its "+
			"funnel or this guard is watching the wrong file", calls)
	}
}
