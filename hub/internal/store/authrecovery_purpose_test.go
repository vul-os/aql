package store

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The purpose column has to stay part of the LOOKUP KEY, not a field checked
// after the row is in hand.
//
// authrecovery.go states it plainly: a token issued for one flow must be
// "structurally unable" to redeem in another, "not merely rejected once found".
// The difference matters the moment a second purpose exists. Filtering in SQL
// means a wrong-purpose token is not found at all, and every downstream check —
// expiry, consumption, the verifier comparison — never runs against it. Checking
// after the fetch means the guarantee is one `if` somebody has to remember, in
// a function that already has several reasons to return the same opaque error.
//
// TODAY THERE IS ONLY ONE PURPOSE, and that is exactly why this is worth
// pinning now. There is no second flow to catch a regression, no test that
// would go red, and nothing to notice if a query quietly dropped the clause.
// The property is being kept correct in advance of the thing it protects
// against — which is the only time it can be kept cheaply.

var recoveryStmtRe = regexp.MustCompile(`(?s)` + "`" + `([^` + "`" + `]*auth_recovery_tokens[^` + "`" + `]*)` + "`")

func TestEveryRecoveryTokenQueryFiltersOnPurpose(t *testing.T) {
	b, err := os.ReadFile("authrecovery.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)

	stmts := recoveryStmtRe.FindAllStringSubmatch(src, -1)
	// A scan that matched nothing would pass while checking nothing.
	if len(stmts) < 3 {
		t.Fatalf("found %d statements touching auth_recovery_tokens; expected the insert, "+
			"the selector lookup, the invalidate and the claim. The scan is broken, not the code.", len(stmts))
	}

	var offenders []string
	for _, m := range stmts {
		stmt := m[1]
		flat := strings.Join(strings.Fields(stmt), " ")

		// The INSERT writes the purpose rather than filtering on it; that is
		// what makes the column trustworthy for every read below.
		if strings.Contains(strings.ToUpper(flat), "INSERT INTO") {
			if !strings.Contains(flat, "purpose") {
				offenders = append(offenders, "INSERT does not record a purpose: "+flat)
			}
			continue
		}

		if !strings.Contains(flat, "purpose = ?") {
			offenders = append(offenders,
				"reads or writes a recovery token without filtering on purpose: "+flat)
		}
	}

	if len(offenders) > 0 {
		t.Fatalf(`a recovery-token statement stopped keying on purpose:

  %s

authrecovery.go promises a token issued for one flow is STRUCTURALLY unable to
redeem in another, not merely rejected once found. Dropping the clause turns
that into an if-statement somebody has to remember — in a function that already
returns one opaque error for four different reasons, so a missing check there
looks exactly like a token that was simply unusable.`, strings.Join(offenders, "\n  "))
	}
}

// The other half: purpose must reach the SQL as a bound parameter, never
// formatted into the statement. A purpose interpolated into the string would
// pass the check above while being injectable.
func TestPurposeIsBoundNotInterpolated(t *testing.T) {
	b, err := os.ReadFile("authrecovery.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)

	for _, bad := range []string{"purpose = '", `purpose = "`, "purpose='", "Sprintf"} {
		if strings.Contains(src, bad) {
			t.Errorf("authrecovery.go contains %q — purpose must be a bound parameter, "+
				"so that the discriminator cannot be shaped by anything a caller supplies", bad)
		}
	}
}
