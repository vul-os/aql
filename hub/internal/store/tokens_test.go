package store

// Store-level adversarial tests for API tokens. These cover the properties
// the HTTP layer cannot demonstrate on its own: that the schema itself
// refuses an unknown scope, that authentication is one transaction whose
// verify step gates everything after it, and that the listing projection
// physically cannot carry the credential.

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func tokenFixture(t *testing.T) (*Store, context.Context, string, string) {
	t.Helper()
	st := openTest(t)
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "tok@x.com", "hash", "Tok", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acct, _, err := st.CreateAccountWithOwner(ctx, u.ID, "Home", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	return st, ctx, acct.ID, u.ID
}

// alwaysVerify / neverVerify stand in for the constant-time comparison the
// HTTP layer supplies, so these tests exercise the ORDERING of the checks
// without duplicating the digest construction.
func alwaysVerify(string, string) bool { return true }
func neverVerify(string, string) bool  { return false }

func mkStoreToken(t *testing.T, st *Store, ctx context.Context, accountID, userID, selector string,
	expiresAt *int64, scopes ...APITokenScope) *APIToken {
	t.Helper()
	tok, err := st.CreateAPIToken(ctx, CreateAPITokenArgs{
		AccountID: accountID, UserID: userID, Name: "bot", Selector: selector,
		Salt: "0011", VerifierHash: "deadbeef", ExpiresAt: expiresAt, Scopes: scopes,
	})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// The scope vocabulary is closed at the DATABASE, not only in Go: an unknown
// scope cannot be persisted at all, so no row can ever exist that the app
// layer would have to decide what to do with.
func TestAPITokenScopeVocabularyIsClosed(t *testing.T) {
	st, ctx, acct, user := tokenFixture(t)

	if _, err := st.CreateAPIToken(ctx, CreateAPITokenArgs{
		AccountID: acct, UserID: user, Name: "x", Selector: "s1", Salt: "a", VerifierHash: "b",
		Scopes: []APITokenScope{"admin:everything"},
	}); err == nil {
		t.Fatal("an unknown scope was accepted by CreateAPIToken")
	}

	// And directly against the schema, bypassing the Go validation entirely:
	// the CHECK constraint is the backstop.
	tok := mkStoreToken(t, st, ctx, acct, user, "s2", nil, ScopeAccessRead)
	if _, err := st.db.Exec(
		`INSERT INTO api_token_scopes (token_id, scope) VALUES (?, 'access:everything')`, tok.ID); err == nil {
		t.Fatal("the api_token_scopes CHECK constraint did not reject an unknown scope")
	}

	// A scopeless token is refused: a credential that authenticates and then
	// permits nothing is a caller bug, not a safe default.
	if _, err := st.CreateAPIToken(ctx, CreateAPITokenArgs{
		AccountID: acct, UserID: user, Name: "x", Selector: "s3", Salt: "a", VerifierHash: "b",
	}); err == nil {
		t.Fatal("a scopeless token was accepted")
	}
}

// Every failure mode returns the SAME error, so nothing about why a token
// stopped working leaks to whoever presents it.
func TestAuthenticateAPITokenOneErrorForEveryFailure(t *testing.T) {
	st, ctx, acct, user := tokenFixture(t)
	nowUnix := now()

	past := nowUnix - 60
	mkStoreToken(t, st, ctx, acct, user, "live", nil, ScopeAccessRead)
	mkStoreToken(t, st, ctx, acct, user, "expired", &past, ScopeAccessRead)
	revoked := mkStoreToken(t, st, ctx, acct, user, "revoked", nil, ScopeAccessRead)
	if _, err := st.RevokeAPIToken(ctx, acct, revoked.ID, user); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		selector string
		verify   func(string, string) bool
	}{
		{"unknown selector", "no-such-selector", alwaysVerify},
		{"empty selector", "", alwaysVerify},
		{"wrong verifier", "live", neverVerify},
		{"expired", "expired", alwaysVerify},
		{"revoked", "revoked", alwaysVerify},
	}
	for _, c := range cases {
		_, err := st.AuthenticateAPIToken(ctx, c.selector, c.verify, nowUnix)
		if !errors.Is(err, ErrAPITokenUnusable) {
			t.Errorf("%s: want ErrAPITokenUnusable, got %v", c.name, err)
		}
	}

	// The live one authenticates, so the failures above are real refusals.
	p, err := st.AuthenticateAPIToken(ctx, "live", alwaysVerify, nowUnix)
	if err != nil {
		t.Fatalf("live token: %v", err)
	}
	if p.UserID != user || p.AccountID != acct || p.Role != "owner" {
		t.Errorf("principal did not carry live membership: %+v", p)
	}
	if !p.Has(ScopeAccessRead) || p.Has(ScopeAccessOpen) {
		t.Errorf("principal scopes wrong: has %s=%v, %s=%v; want the granted one only",
			ScopeAccessRead, p.Has(ScopeAccessRead), ScopeAccessOpen, p.Has(ScopeAccessOpen))
	}
}

// The verifier is proven BEFORE any liveness state is consulted, so a caller
// who only guessed a selector cannot distinguish "revoked" from "never
// existed" by which branch ran.
func TestAuthenticateAPITokenVerifiesBeforeLiveness(t *testing.T) {
	st, ctx, acct, user := tokenFixture(t)
	nowUnix := now()
	tok := mkStoreToken(t, st, ctx, acct, user, "sel", nil, ScopeAccessOpen)

	verifyCalls := 0
	if _, err := st.AuthenticateAPIToken(ctx, "sel", func(string, string) bool {
		verifyCalls++
		return false
	}, nowUnix); !errors.Is(err, ErrAPITokenUnusable) {
		t.Fatalf("want ErrAPITokenUnusable, got %v", err)
	}
	if verifyCalls != 1 {
		t.Errorf("verify was called %d times, want exactly 1", verifyCalls)
	}
	// A failed verify must not have stamped last_used_at — a caller who does
	// not hold the secret leaves no trace of having "used" the token.
	got, err := st.APITokenByID(ctx, acct, tok.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastUsedAt.Valid {
		t.Errorf("a failed authentication stamped last_used_at")
	}
}

// A token's authority is its OWNER's authority, re-derived per call. When
// the membership goes, the token goes, with no sweep.
func TestAuthenticateAPITokenTracksLiveMembership(t *testing.T) {
	st, ctx, acct, user := tokenFixture(t)
	nowUnix := now()
	mkStoreToken(t, st, ctx, acct, user, "sel", nil, ScopeAccessOpen)

	if _, err := st.AuthenticateAPIToken(ctx, "sel", alwaysVerify, nowUnix); err != nil {
		t.Fatalf("baseline: %v", err)
	}

	// Role changes are picked up live, not frozen at issue time.
	if _, err := st.db.Exec(`UPDATE account_members SET role = 'member' WHERE account_id = ?`, acct); err != nil {
		t.Fatal(err)
	}
	p, err := st.AuthenticateAPIToken(ctx, "sel", alwaysVerify, nowUnix)
	if err != nil {
		t.Fatal(err)
	}
	if p.Role != "member" {
		t.Errorf("principal carried a stale role: %q", p.Role)
	}

	for _, stmt := range []struct{ name, sql string }{
		{"membership revoked", `UPDATE account_members SET status = 'revoked'`},
		{"membership restored", `UPDATE account_members SET status = 'active'`},
		{"user disabled", `UPDATE users SET status = 'disabled'`},
		{"user restored", `UPDATE users SET status = 'active'`},
		{"account suspended", `UPDATE accounts SET status = 'suspended'`},
	} {
		if _, err := st.db.Exec(stmt.sql); err != nil {
			t.Fatal(err)
		}
		_, err := st.AuthenticateAPIToken(ctx, "sel", alwaysVerify, nowUnix)
		wantFail := strings.Contains(stmt.name, "revoked") ||
			strings.Contains(stmt.name, "disabled") || strings.Contains(stmt.name, "suspended")
		if wantFail && !errors.Is(err, ErrAPITokenUnusable) {
			t.Errorf("%s: token still authenticated (%v)", stmt.name, err)
		}
		if !wantFail && err != nil {
			t.Errorf("%s: token should authenticate, got %v", stmt.name, err)
		}
	}
}

// Tenancy: a token id from another account is indistinguishable from a
// missing one, for reads and for revokes alike.
func TestAPITokenStoreTenancy(t *testing.T) {
	st, ctx, acctA, userA := tokenFixture(t)
	userB, err := st.CreateUser(ctx, "b@x.com", "hash", "B", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	acctB, _, err := st.CreateAccountWithOwner(ctx, userB.ID, "Other", "ZA")
	if err != nil {
		t.Fatal(err)
	}
	tokA := mkStoreToken(t, st, ctx, acctA, userA, "sel-a", nil, ScopeAccessRead)

	if _, err := st.APITokenByID(ctx, acctB.ID, tokA.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-account read: %v", err)
	}
	if _, err := st.RevokeAPIToken(ctx, acctB.ID, tokA.ID, userB.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-account revoke: %v", err)
	}
	if list, err := st.APITokensByAccount(ctx, acctB.ID, ""); err != nil || len(list) != 0 {
		t.Errorf("cross-account listing: %v %v", list, err)
	}
	// Still live in its own account after the cross-tenant revoke attempt.
	got, err := st.APITokenByID(ctx, acctA, tokA.ID)
	if err != nil || !got.Live(now()) {
		t.Errorf("token was affected by a cross-tenant revoke: %v %v", got, err)
	}

	// A double revoke inside the right account is also ErrNotFound — the
	// guarded UPDATE claims the row exactly once.
	if _, err := st.RevokeAPIToken(ctx, acctA, tokA.ID, userA); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RevokeAPIToken(ctx, acctA, tokA.ID, userA); !errors.Is(err, ErrNotFound) {
		t.Errorf("double revoke: %v", err)
	}
}

// The listing projection cannot leak the credential because it does not
// select the columns that hold it. This asserts the SQL text itself, which
// is the thing that would have to change for the property to break.
func TestAPITokenListingProjectionExcludesSecrets(t *testing.T) {
	for _, col := range []string{"salt", "verifier_hash", "selector"} {
		if strings.Contains(apiTokenSelect, col) {
			t.Errorf("the public token projection selects %q", col)
		}
	}
}
