package store

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The TOTP secret's blast radius, held to its stated size.
//
// twofactor.go makes three claims about it, and all three are the kind that
// stay true only until somebody writes one convenient query:
//
//	"This is the only query in the codebase that selects user_totp.secret."
//	"[TOTPStatus] has no Secret field, and the query that fills it does not
//	 select the column — a listing shape that structurally cannot carry the
//	 secret, rather than one that merely happens not to today."
//	"[RecoveryCodeRow is] never the plaintext, which does not exist after
//	 issuance."
//
// The secret is the whole second factor. Anything that can read it can mint
// valid codes forever, and unlike a password there is nothing to rotate that a
// user would notice. The reason the code goes to the trouble of a projection
// type with no Secret field — rather than a struct that simply is not filled in
// — is that the first shape cannot leak it and the second only has not yet.
//
// So these tests are about SHAPE, not behaviour. A behavioural test would pass
// happily the day someone adds a second secret-selecting query for a good
// reason, which is exactly the change worth noticing.

func storeSourceFiles(t *testing.T) map[string]string {
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
		b, err := os.ReadFile(filepath.Join(".", n))
		if err != nil {
			t.Fatal(err)
		}
		out[n] = string(b)
	}
	if len(out) < 20 {
		t.Fatalf("read only %d store sources; the walk is broken, not the code", len(out))
	}
	return out
}

// Any SELECT naming the secret column, anywhere in the store.
var selectsSecretRe = regexp.MustCompile(`(?is)SELECT[^` + "`" + `]*\bsecret\b[^` + "`" + `]*FROM\s+user_totp`)

func TestOnlyOneQuerySelectsTheTOTPSecret(t *testing.T) {
	total := 0
	perFile := map[string]int{}
	for name, src := range storeSourceFiles(t) {
		// The column list is a constant spliced into the query, so match both
		// the literal column and the constant that carries it.
		n := len(selectsSecretRe.FindAllString(src, -1))
		n += strings.Count(src, "SELECT `+totpCols+`")
		if n > 0 {
			perFile[name] = n
		}
		total += n
	}

	if total == 0 {
		t.Fatal("found no query selecting the TOTP secret; the scan has drifted from the code " +
			"and would pass however many appeared")
	}
	if total != 1 {
		t.Fatalf(`%d queries select user_totp.secret; twofactor.go says there is exactly one.

  %v

The secret is the entire second factor: anything that reads it can mint valid
codes indefinitely, and there is nothing a user would notice being rotated. One
query means one place to audit and one caller list to reason about. If a second
is genuinely needed, say so in twofactor.go's comment in the same change — the
claim is load-bearing for anyone deciding whether a new endpoint is safe.`,
			total, perFile)
	}
}

// The projection type must stay unable to carry the secret, rather than merely
// not carrying it today.
func TestTheStatusProjectionCannotCarryTheSecret(t *testing.T) {
	src := storeSourceFiles(t)["twofactor.go"]

	body := structBody(src, "type TOTPStatus struct {")
	if body == "" {
		t.Fatal("TOTPStatus is gone; the projection that keeps GET /v1/auth/2fa away from the secret no longer exists")
	}
	for _, banned := range []string{"Secret", "secret"} {
		if strings.Contains(body, banned) {
			t.Errorf("TOTPStatus gained a %q field:\n%s\n\nThis type is what GET /v1/auth/2fa "+
				"returns. A field here is a secret on the wire to anyone holding a session.", banned, body)
		}
	}

	// And the same for the rows that carry recovery codes: salt and digest,
	// never the plaintext, which "does not exist after issuance".
	for _, typ := range []string{"type RecoveryCodeSeed struct {", "type RecoveryCodeRow struct {"} {
		b := structBody(src, typ)
		if b == "" {
			t.Errorf("%s not found", typ)
			continue
		}
		for _, banned := range []string{"Plain", "Code string", "Plaintext"} {
			if strings.Contains(b, banned) {
				t.Errorf("%s gained %q:\n%s\n\nA stored recovery code is a salted digest; "+
					"keeping the plaintext would make the batch replayable from a backup.", typ, banned, b)
			}
		}
	}
}

func structBody(src, header string) string {
	i := strings.Index(src, header)
	if i < 0 {
		return ""
	}
	rest := src[i+len(header):]
	j := strings.Index(rest, "\n}")
	if j < 0 {
		return rest
	}
	return rest[:j]
}
