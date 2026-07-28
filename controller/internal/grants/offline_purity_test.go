package grants

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// proto/grants.md § "Revocation vs. in-flight grants" makes a structural
// claim, not a behavioural one:
//
//	"the 11-step check above touches nothing but the presented bytes and the
//	 controller's own pinned key / clock / lockdown state"
//	"There is no per-member or per-grant offline deny-list; the verification
//	 core takes no input besides the presented grant and local controller
//	 state, by design — that locality is the feature this whole path exists
//	 for."
//
// That is the ONE thing in the revocation section that can silently stop
// being true. The rest of the section is honest negatives ("only the grant's
// own exp bounds the exposure", "no message tells a controller a grant is
// revoked") — a test cannot prove an absence in the wire contract, and the
// lockdown lever it names is already covered by the vector corpus and by
// TestVerificationOrderOnMultipleFaults.
//
// The hazard these two tests guard is specific and foreseeable: the spec's
// own v1 proposal (option (b), a revocation list the controller caches and
// consults while offline) is exactly the change that would add a field to Env
// or an import to this package. That change is allowed — it is written down
// as a proposal. What must not happen is it landing while grants.md still
// tells an operator that revocation is bounded only by TTL, because that
// paragraph is what someone reads when deciding how urgently to latch
// lockdown after firing a resident.
//
// So neither test forbids anything. They fail loudly and name the paragraph
// that has to change with the code.

// The set the spec describes, spelled out. Deliberately written as a literal
// rather than derived from the struct, so that adding a field fails here
// instead of quietly widening the expectation.
var documentedEnvFields = []string{
	"DeviceID",        // which controller this is
	"GatewayKey",      // the pinned key
	"LastGatewaySync", // local clock trust (stale-clock, step 1)
	"Lockdown",        // the only sub-TTL revocation lever in v0
	"Now",             // the clock
	"TZ",              // window evaluation
}

func TestVerificationCoreTakesOnlyLocalState(t *testing.T) {
	var got []string
	typ := reflect.TypeOf(Env{})
	for i := 0; i < typ.NumField(); i++ {
		got = append(got, typ.Field(i).Name)
	}
	sort.Strings(got)

	want := append([]string(nil), documentedEnvFields...)
	sort.Strings(want)

	if !reflect.DeepEqual(got, want) {
		t.Fatalf(`grants.Env's fields changed.

 got: %v
want: %v

proto/grants.md § "Revocation vs. in-flight grants" tells an operator that a
revoked member keeps everything an issued grant authorizes for up to its TTL,
and that latching lockdown is the ONLY sub-TTL lever. That paragraph is
derived from this struct: the verification core sees the presented grant and
this, and nothing else.

If a field was added to carry cached revocation state, that is the spec's own
v1 proposal (option (b)) and is welcome — but grants.md's revocation section
and its "Honest summary" have to change in the same commit, because an
operator reading the current text would under-react to a firing.

If a field was added for something unrelated, add it to documentedEnvFields.`, got, want)
	}
}

// Imports are the other way locality can be lost, and the more dangerous one:
// a field is visible in review, whereas a helper three calls deep that reads
// a file or opens a socket is not. Anything that can block, fail, or consult
// the network turns "offline-verifiable" into "usually offline-verifiable" —
// and this path exists precisely for the moment the network is gone.
func TestVerificationCoreStaysOffline(t *testing.T) {
	// Local packages are fine; the check is on what THEY may not reach, so
	// the two this package imports are walked as well.
	roots := []string{".", "../clock", "../wire"}

	forbidden := []string{
		"net", "net/http", "net/url", "os/exec", "database/sql",
		"github.com/vul-os/aql/controller/internal/transport",
		"github.com/vul-os/aql/controller/internal/lanserver",
	}
	isForbidden := func(path string) bool {
		for _, f := range forbidden {
			if path == f || strings.HasPrefix(path, f+"/") {
				return true
			}
		}
		return false
	}

	var offenders []string
	var filesScanned int

	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			t.Fatalf("reading %s: %v", root, err)
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			path := filepath.Join(root, name)
			f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatalf("parsing %s: %v", path, err)
			}
			filesScanned++
			for _, imp := range f.Imports {
				p, err := strconv.Unquote(imp.Path.Value)
				if err != nil {
					continue
				}
				if isForbidden(p) {
					offenders = append(offenders, path+" imports "+p)
				}
			}
		}
	}

	// A scan that found no files would report success while checking nothing.
	// This has bitten this repo before, in naming.test.ts.
	if filesScanned < 3 {
		t.Fatalf("scanned only %d files; the walk is broken, not the code clean", filesScanned)
	}
	if len(offenders) > 0 {
		t.Fatalf(`the offline verification core reached for I/O:

%s

proto/grants.md's whole justification for this path is that redemption needs
no hub. Something that can block or fail at redemption time makes the gate's
behaviour depend on the network being up — the exact condition the offline
path exists to survive.`, strings.Join(offenders, "\n"))
	}
}
