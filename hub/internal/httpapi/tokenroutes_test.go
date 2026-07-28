package httpapi

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The API-token attack surface, held to its exact size.
//
// server.go states an EXHAUSTIVE claim beside the route table:
//
//	"The four tokenScoped routes below are the ONLY ones an API token can
//	 reach... Adding a token-reachable route is a deliberate one-line act here;
//	 forgetting is fail-closed."
//
// TestAPITokenCannotReachUnscopedRoutes already probes a dozen routes with a
// live token and gets 401 for each, which is the right test of the mechanism.
// What it cannot do is notice a route that did not exist when it was written:
// it names its probes by hand, so a NEW `tokenScoped` registration is invisible
// to it, and the surface would have grown with every existing test still green.
//
// This reads the route table itself, so the set is checked rather than sampled.

var tokenScopedRe = regexp.MustCompile(
	`mux\.Handle\("([A-Z]+) ([^"]+)",\s*s\.tokenScoped\(store\.(Scope\w+)`)

// The complete set, spelled out. Adding a row here is the second half of the
// "deliberate one-line act" the comment describes — the first half being the
// registration itself, and the point being that neither happens by accident.
var tokenReachable = map[string]string{
	"GET /v1/access-points":             "ScopeAccessRead",
	"GET /v1/access-points/{id}":        "ScopeAccessRead",
	"POST /v1/access-points/{id}/open":  "ScopeAccessOpen",
	"POST /v1/access-points/{id}/close": "ScopeAccessOpen",
}

func serverSource(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestOnlyTheDeclaredRoutesAreReachableByAnAPIToken(t *testing.T) {
	src := serverSource(t)

	// A scan that matched nothing would pass while checking nothing; this repo
	// has shipped that guard before.
	if n := strings.Count(src, "mux.Handle("); n < 50 {
		t.Fatalf("found only %d route registrations; the scan is broken, not the router", n)
	}

	found := map[string]string{}
	for _, m := range tokenScopedRe.FindAllStringSubmatch(src, -1) {
		found[m[1]+" "+m[2]] = m[3]
	}
	if len(found) == 0 {
		t.Fatal("matched no tokenScoped registrations; the regex has drifted from the router")
	}

	var added, missing, changed []string
	for route, scope := range found {
		want, ok := tokenReachable[route]
		switch {
		case !ok:
			added = append(added, route+" ("+scope+")")
		case want != scope:
			changed = append(changed, route+": guarded by "+scope+", expected "+want)
		}
	}
	for route := range tokenReachable {
		if _, ok := found[route]; !ok {
			missing = append(missing, route)
		}
	}
	sort.Strings(added)
	sort.Strings(missing)
	sort.Strings(changed)

	if len(added) > 0 {
		t.Errorf(`a route became reachable by an API token:

  %s

An API token is a bearer credential that lives in someone's CI config. Every
route added here is something a leaked token can do, and the surface is small
on purpose — session-only is the default and forgetting is fail-closed. If this
is intended, add it to tokenReachable in the same change, and check the scope
is the narrowest one that works.`, strings.Join(added, "\n  "))
	}
	if len(missing) > 0 {
		t.Errorf("declared token-reachable but no longer registered: %s\n"+
			"If the route was removed, remove it here too — a stale entry makes this "+
			"list stop describing the router.", strings.Join(missing, ", "))
	}
	if len(changed) > 0 {
		t.Errorf("a token route changed scope:\n  %s", strings.Join(changed, "\n  "))
	}
}

// The escalation shape, stated as its own rule: a READ scope must never guard a
// method that changes something.
//
// This is the failure the surrounding comment calls structurally impossible —
// a read-only token that can actuate. It would not look like a bug in review:
// `tokenScoped(store.ScopeAccessRead, fence, s.handleSomethingCreate)` reads
// perfectly naturally, and every existing token test would still pass, because
// they check that the SCOPE is enforced rather than what the scope is attached
// to.
func TestAReadScopeNeverGuardsAMutation(t *testing.T) {
	src := serverSource(t)

	mutating := map[string]bool{"POST": true, "PUT": true, "PATCH": true, "DELETE": true}
	readScopes := map[string]bool{"ScopeAccessRead": true}

	var offenders []string
	for _, m := range tokenScopedRe.FindAllStringSubmatch(src, -1) {
		method, path, scope := m[1], m[2], m[3]
		if mutating[method] && readScopes[scope] {
			offenders = append(offenders, method+" "+path+" is guarded by "+scope)
		}
	}
	if len(offenders) > 0 {
		t.Fatalf(`a read-only scope is guarding a mutating route:

  %s

"access:read" is the scope an integration is given when it should be able to
LOOK at gates. A token holding only that must not be able to change anything,
and a route registered this way hands it exactly that power while still
answering 403 to everyone the scope check was written to stop.`,
			strings.Join(offenders, "\n  "))
	}
}
