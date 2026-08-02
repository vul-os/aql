package store

import (
	"context"
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

// The DATABASE refuses a purpose outside the allowed set.
//
// The test above pins that every query filters on purpose. This pins the other
// half: that there is only one purpose to filter for, and that the schema —
// not a Go constant, not a comment — is what says so.
//
// migration 0009 declares `CHECK (purpose IN ('password_reset'))` and
// authrecovery.go explains the omission: identity on this hub is a local
// username, "so there is no address to verify and no sender to verify it
// with, and migration 0009 leaves 'email_verify' deliberately out of the
// purpose CHECK constraint". That is a product decision — this hub runs in
// somebody's house with no outbound mail — enforced at the strongest layer
// available, and nothing tested it.
//
// A later migration widening that CHECK is a one-line change that would make
// an email-verification flow storable, and every existing test would stay
// green: the queries would still filter on purpose, the Go constant would
// still be the only one defined, and the schema would quietly permit a flow
// the product does not have.
func TestTheSchemaRefusesAnyRecoveryPurposeButPasswordReset(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// A real user row: user_id is a foreign key, so a made-up id fails for a
	// reason that has nothing to do with the purpose under test.
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "purpose-check", "argon2id$dummy", "Purpose Check", "ZA")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	userID := u.ID

	insert := func(purpose string) error {
		_, err := s.db.Exec(
			`INSERT INTO auth_recovery_tokens
			   (id, user_id, purpose, selector, salt, verifier_hash, issued_at, expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"tok-"+purpose, userID, purpose, "sel-"+purpose, "salt", "hash",
			1_700_000_000, 1_700_003_600, 1_700_000_000)
		return err
	}

	// The premise: the one real purpose IS insertable. Without this the
	// rejections below would pass against a table that refuses everything —
	// a broken schema and a correct one look identical from the failure side.
	if err := insert("password_reset"); err != nil {
		t.Fatalf("password_reset was refused (%v); this test proves nothing if no "+
			"purpose can be stored", err)
	}

	for _, bad := range []string{"email_verify", "phone_verify", "", "PASSWORD_RESET"} {
		if err := insert(bad); err == nil {
			t.Errorf("the schema accepted purpose %q. migration 0009's CHECK is what "+
				"keeps a flow this product does not have from being storable at all — "+
				"identity here is a local username and the hub has no outbound mail",
				bad)
		}
	}
}
