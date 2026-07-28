package automations

import (
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
	"testing"
)

// The package doc makes three STRUCTURAL claims, and structure rots silently.
//
//	"It does not own an HTTP surface, and it does not reach into
//	 internal/store. It takes a database handle and the audit choke point as
//	 narrow interfaces (DB, Auditor) so it can be exercised end to end in tests
//	 without the server, and so it structurally cannot write to an audit table
//	 itself."
//
// Every part of that is an import-boundary claim, and an import is one line
// somebody adds while fixing something else. Nothing in the build would notice:
// the package would still compile, its tests would still pass, and the sentence
// above would simply have become false — which matters because "structurally
// cannot" is the reason an unattended rule engine is allowed near an audit
// table at all.
//
// This is the same shape as the grants package's offline-purity guard: not a
// style rule, but a claim the code makes about itself, held in place.

func automationSources(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".go") || strings.HasSuffix(n, "_test.go") {
			continue
		}
		b, err := os.ReadFile(n)
		if err != nil {
			t.Fatal(err)
		}
		out[n] = string(b)
	}
	// A scan that found nothing would pass while checking nothing.
	if len(out) < 4 {
		t.Fatalf("found only %d non-test sources; the walk is broken, not the code", len(out))
	}
	return out
}

func TestTheRuleEngineCannotReachTheStoreOrServeHTTP(t *testing.T) {
	// Each entry names WHY it is forbidden, so a future reader deciding
	// whether to add one has the argument in front of them rather than a bare
	// deny-list.
	forbidden := map[string]string{
		"github.com/vul-os/aql/hub/internal/store": "the package doc's central claim is that it " +
			"cannot write an audit row itself — it takes the choke point as the narrow Auditor " +
			"interface. Importing the store gives it InsertAccessLog and WriteAdminAudit directly, " +
			"and an unattended engine that can write its own audit trail is not audited.",
		"net/http": "it does not own an HTTP surface. Rules are actuated by the scheduler and by " +
			"httpapi calling in, never by this package listening or dialling.",
		"github.com/vul-os/aql/hub/internal/httpapi": "the dependency runs the other way; this " +
			"would be a cycle and an inversion of who is in charge.",
		"github.com/vul-os/aql/hub/internal/channels": "a rule engine that could talk to a chat " +
			"rail could notify without going through the surfaces that decide what a member may see.",
	}

	var offenders []string
	fset := token.NewFileSet()
	for name, body := range automationSources(t) {
		f, err := parser.ParseFile(fset, name, body, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parsing %s: %v", name, err)
		}
		for _, imp := range f.Imports {
			p, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				continue
			}
			for bad, why := range forbidden {
				if p == bad || strings.HasPrefix(p, bad+"/") {
					offenders = append(offenders, name+" imports "+p+"\n      "+why)
				}
			}
		}
	}

	if len(offenders) > 0 {
		t.Fatalf(`the rule engine crossed a boundary its own package doc claims it does not:

  %s

If the boundary should move, move it in the package doc in the same change —
"structurally cannot write to an audit table itself" is a promise this package
makes about an UNATTENDED actuator, and it is worth exactly as much as the
import list behind it.`, strings.Join(offenders, "\n  "))
	}
}

// The other half of the same claim: the narrow interfaces have to stay narrow.
// A DB that grew an arbitrary-SQL escape hatch, or an Auditor that grew a
// second method, would satisfy the import check above while giving the package
// back what the boundary took away.
func TestTheNarrowSeamsStayNarrow(t *testing.T) {
	src := automationSources(t)

	// Auditor is the load-bearing one: exactly one method, the audit choke
	// point, so this package can record what it did and nothing else.
	joined := strings.Join([]string{src["automations.go"], src["store.go"]}, "\n")
	if !strings.Contains(joined, "type Auditor interface {") {
		t.Fatal("Auditor interface is gone; the audit choke point is no longer a seam")
	}
	auditor := between(joined, "type Auditor interface {", "}")
	// Widening Auditor usually breaks the build first — every implementer stops
	// satisfying it — so the type system is the stronger guard for the careless
	// case. This one is for the CAREFUL case: a change that widens the
	// interface and dutifully updates every implementer compiles perfectly, and
	// nothing else would notice that an unattended rule engine had just been
	// handed a second thing it can do to the audit trail.
	if n := countMethods(auditor); n != 1 {
		t.Errorf("Auditor has %d methods, want exactly 1 (WriteAdminAudit). Every extra method "+
			"is something an unattended engine can do to the audit trail:\n%s", n, auditor)
	}

	// DB is deliberately the three context methods and nothing else — no
	// BeginTx, so this package cannot open a transaction that outlives a call
	// and cannot hold one across an actuation.
	db := between(joined, "type DB interface {", "}")
	if n := countMethods(db); n != 3 {
		t.Errorf("DB has %d methods, want exactly 3:\n%s", n, db)
	}
	for _, forbidden := range []string{"BeginTx", "Begin(", "Conn(", "Driver("} {
		if strings.Contains(db, forbidden) {
			t.Errorf("DB gained %q — the seam is no longer narrow:\n%s", forbidden, db)
		}
	}
}

func between(s, start, end string) string {
	i := strings.Index(s, start)
	if i < 0 {
		return ""
	}
	rest := s[i+len(start):]
	j := strings.Index(rest, end)
	if j < 0 {
		return rest
	}
	return rest[:j]
}

// countMethods counts interface method lines: non-blank, non-comment lines
// carrying a parameter list.
func countMethods(body string) int {
	n := 0
	for _, line := range strings.Split(body, "\n") {
		l := strings.TrimSpace(line)
		if l == "" || strings.HasPrefix(l, "//") {
			continue
		}
		if strings.Contains(l, "(") {
			n++
		}
	}
	return n
}
