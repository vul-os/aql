package httpapi

// Adversarial tests for scoped API tokens. Every test here asserts a
// property a token MUST NOT have; the happy path is covered only far enough
// to prove the refusals are refusals and not "broken for everyone".

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/keys"
	"github.com/vul-os/aql/gateway/internal/store"
)

func toJSONString(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// newTokenTestServer is newTestServerWithStore plus a handle on the server's
// log sink, so tests can assert a plaintext credential never reached it.
func newTokenTestServer(t *testing.T) (http.Handler, *store.Store, *bytes.Buffer) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ks, err := keys.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	logBuf := &bytes.Buffer{}
	s := New(Config{
		Version:         "test",
		AdminClaimToken: "op-token",
		JWTSecret:       []byte("0123456789abcdef0123456789abcdef"),
	}, st, ks, slog.New(slog.NewTextHandler(logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	return s.Router(), st, logBuf
}

// mkAccessPoint creates an access point on a location and returns its id.
func mkAccessPoint(t *testing.T, h http.Handler, access, locationID, name string) string {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/access-points", access, map[string]any{
		"location_id": locationID, "name": name, "kind": "gate",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("access point create: %d %v", rec.Code, out)
	}
	return out["id"].(string)
}

// mkToken issues a token and returns (plaintext, id). Fails the test if the
// create response does not carry the plaintext exactly once.
func mkToken(t *testing.T, h http.Handler, access, accountID string, body map[string]any) (string, string) {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+accountID+"/api-tokens", access, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("token create: %d %v", rec.Code, out)
	}
	plain, ok := out["token"].(string)
	if !ok || !strings.HasPrefix(plain, "aqlt_") || !strings.Contains(plain, ".") {
		t.Fatalf("token create did not return a well-formed plaintext: %v", out)
	}
	return plain, out["id"].(string)
}

func countAccessLogs(t *testing.T, st *store.Store) int {
	t.Helper()
	var n int
	if err := st.DB().QueryRow(`SELECT count(*) FROM access_logs`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ---------------------------------------------------------------------------
// The scope boundary
// ---------------------------------------------------------------------------

// A read-only token must be structurally incapable of actuating a gate: the
// refusal happens in tokenScoped, before the handler runs, so the open path
// (store.LogAccess and everything downstream of it) is never entered. The
// access_logs count is the proof — an open that got as far as the choke
// point ALWAYS leaves a row, allowed or denied.
func TestAPITokenReadOnlyCannotActuate(t *testing.T) {
	h, st, _ := newTokenTestServer(t)
	access, _ := register(t, h, "ro@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Front Gate")

	ro, _ := mkToken(t, h, access, acct, map[string]any{
		"name": "reader", "scopes": []string{"access:read"},
	})

	// The read it IS allowed to do, so the refusal below is about scope and
	// not about the token being broken.
	rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, ro, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("read-only token refused a read: %d %v", rec.Code, out)
	}

	before := countAccessLogs(t, st)
	for _, cmd := range []string{"open", "close"} {
		rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/"+cmd, ro, map[string]any{"source": "api"})
		if rec.Code != http.StatusForbidden || out["error"] != "insufficient_scope" {
			t.Fatalf("read-only token %s: want 403 insufficient_scope, got %d %v", cmd, rec.Code, out)
		}
	}
	if got := countAccessLogs(t, st); got != before {
		t.Errorf("a scope-denied actuation reached the open-path choke point: access_logs %d -> %d", before, got)
	}
}

// The complementary half: an open-scoped token DOES actuate, and doing so
// leaves the usual access_logs row through the unmodified choke point.
func TestAPITokenOpenScopeActuates(t *testing.T) {
	h, st, _ := newTokenTestServer(t)
	access, _ := register(t, h, "rw@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Front Gate")

	tok, _ := mkToken(t, h, access, acct, map[string]any{
		"name": "opener", "scopes": []string{"access:read", "access:open"},
	})

	before := countAccessLogs(t, st)
	rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/open", tok, map[string]any{"source": "api"})
	if rec.Code != http.StatusOK || out["ok"] != true {
		t.Fatalf("open-scoped token open: %d %v", rec.Code, out)
	}
	if got := countAccessLogs(t, st); got != before+1 {
		t.Errorf("token open did not write an access_logs row: %d -> %d", before, got)
	}
}

// A token may not reach any route that was not registered with a scope.
// requireAuth accepts JWTs only, so this is 401 (not a JWT), not 403 — the
// default-deny is structural, not a rule this code remembers to apply.
func TestAPITokenCannotReachUnscopedRoutes(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	adminAccess := claimAdmin(t, h, "esc@x.com")
	acct, loc := tenantIDs(t, h, adminAccess)
	tok, tokID := mkToken(t, h, adminAccess, acct, map[string]any{
		"name": "wide", "scopes": []string{"access:read", "access:open"},
	})

	probes := []struct{ method, path string }{
		{"GET", "/v1/auth/me"},
		{"GET", "/v1/accounts"},
		{"POST", "/v1/accounts"},
		{"GET", "/v1/accounts/" + acct + "/members"},
		{"GET", "/v1/locations/" + loc},
		{"GET", "/v1/grants"},
		{"GET", "/v1/devices"},
		{"GET", "/v1/admin/overview"},
		{"POST", "/v1/auth/logout-all"},
		// Token-mints-token would be privilege escalation by a different
		// name: a leaked read-only token must not be able to produce an
		// open-scoped one, or revoke the credential someone is using to
		// investigate it.
		{"GET", "/v1/accounts/" + acct + "/api-tokens"},
		{"POST", "/v1/accounts/" + acct + "/api-tokens"},
		{"POST", "/v1/accounts/" + acct + "/api-tokens/" + tokID + "/revoke"},
		// Creating an access point is a write the token has no scope for.
		{"POST", "/v1/access-points"},
	}
	for _, p := range probes {
		rec, out := doJSON(t, h, p.method, p.path, tok, map[string]any{})
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("token reached %s %s: %d %v", p.method, p.path, rec.Code, out)
		}
	}
}

// ---------------------------------------------------------------------------
// A token never outlives its owner's access
// ---------------------------------------------------------------------------

// Membership is re-derived at USE time, not trusted from issue time. Losing
// the membership the token was issued under kills it on the very next
// request, with no sweep and no TTL to wait out.
func TestAPITokenDiesWithOwnersMembership(t *testing.T) {
	h, st, _ := newTokenTestServer(t)
	ownerAccess, _ := register(t, h, "owner@x.com")
	acct, loc := tenantIDs(t, h, ownerAccess)
	ap := mkAccessPoint(t, h, ownerAccess, loc, "Gate")

	tok, _ := mkToken(t, h, ownerAccess, acct, map[string]any{
		"name": "bot", "scopes": []string{"access:read", "access:open"},
	})
	if rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, tok, nil); rec.Code != http.StatusOK {
		t.Fatalf("token read before membership loss: %d %v", rec.Code, out)
	}

	// The membership goes away (the member-removal route is not ported yet;
	// this is the state it would leave behind).
	if _, err := st.DB().Exec(
		`UPDATE account_members SET status = 'revoked' WHERE account_id = ?`, acct); err != nil {
		t.Fatal(err)
	}

	for _, p := range []struct{ method, path string }{
		{"GET", "/v1/access-points/" + ap},
		{"POST", "/v1/access-points/" + ap + "/open"},
		{"GET", "/v1/access-points"},
	} {
		rec, out := doJSON(t, h, p.method, p.path, tok, map[string]any{"source": "api"})
		if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_api_token" {
			t.Errorf("token survived its owner's membership loss at %s %s: %d %v",
				p.method, p.path, rec.Code, out)
		}
	}
}

// Same property against the other live-status inputs the authentication
// query folds in: a disabled user, and a suspended account.
func TestAPITokenDiesWithOwnerAndAccountStatus(t *testing.T) {
	t.Run("disabled user", func(t *testing.T) {
		h, st, _ := newTokenTestServer(t)
		access, _ := register(t, h, "dis@x.com")
		acct, loc := tenantIDs(t, h, access)
		ap := mkAccessPoint(t, h, access, loc, "Gate")
		tok, _ := mkToken(t, h, access, acct, map[string]any{
			"name": "bot", "scopes": []string{"access:open"},
		})
		if _, err := st.DB().Exec(`UPDATE users SET status = 'disabled'`); err != nil {
			t.Fatal(err)
		}
		rec, out := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/open", tok, map[string]any{"source": "api"})
		if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_api_token" {
			t.Errorf("token survived its owner being disabled: %d %v", rec.Code, out)
		}
	})

	t.Run("suspended account", func(t *testing.T) {
		h, st, _ := newTokenTestServer(t)
		access, _ := register(t, h, "sus@x.com")
		acct, loc := tenantIDs(t, h, access)
		ap := mkAccessPoint(t, h, access, loc, "Gate")
		tok, _ := mkToken(t, h, access, acct, map[string]any{
			"name": "bot", "scopes": []string{"access:read"},
		})
		if _, err := st.DB().Exec(`UPDATE accounts SET status = 'suspended' WHERE id = ?`, acct); err != nil {
			t.Fatal(err)
		}
		rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, tok, nil)
		if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_api_token" {
			t.Errorf("token survived its account's suspension: %d %v", rec.Code, out)
		}
	})
}

// ---------------------------------------------------------------------------
// Revocation and expiry
// ---------------------------------------------------------------------------

// Revocation is immediate: the request right after the revoke fails. Nothing
// caches a token's authorisation, so there is no window to wait out.
func TestAPITokenRevokedImmediately(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	access, _ := register(t, h, "rev@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Gate")
	tok, tokID := mkToken(t, h, access, acct, map[string]any{
		"name": "bot", "scopes": []string{"access:read", "access:open"},
	})
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+ap, tok, nil); rec.Code != http.StatusOK {
		t.Fatalf("token unusable before revoke: %d", rec.Code)
	}

	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens/"+tokID+"/revoke", access, map[string]any{})
	if rec.Code != http.StatusOK || out["revoked_at"] == nil || out["live"] != false {
		t.Fatalf("revoke: %d %v", rec.Code, out)
	}

	for _, p := range []struct{ method, path string }{
		{"GET", "/v1/access-points/" + ap},
		{"POST", "/v1/access-points/" + ap + "/open"},
	} {
		rec, out := doJSON(t, h, p.method, p.path, tok, map[string]any{"source": "api"})
		if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_api_token" {
			t.Errorf("revoked token still worked at %s: %d %v", p.path, rec.Code, out)
		}
	}

	// A second revoke is not a different event from a missing token.
	if rec, _ := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens/"+tokID+"/revoke", access, map[string]any{}); rec.Code != http.StatusNotFound {
		t.Errorf("double revoke: %d", rec.Code)
	}
}

func TestAPITokenExpiryRefused(t *testing.T) {
	h, st, _ := newTokenTestServer(t)
	access, _ := register(t, h, "exp@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Gate")
	tok, tokID := mkToken(t, h, access, acct, map[string]any{
		"name": "short", "scopes": []string{"access:read"}, "expires_in_days": 1,
	})
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+ap, tok, nil); rec.Code != http.StatusOK {
		t.Fatalf("token unusable before expiry: %d", rec.Code)
	}
	if _, err := st.DB().Exec(`UPDATE api_tokens SET expires_at = ? WHERE id = ?`,
		time.Now().Add(-time.Minute).Unix(), tokID); err != nil {
		t.Fatal(err)
	}
	rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, tok, nil)
	if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_api_token" {
		t.Errorf("expired token still worked: %d %v", rec.Code, out)
	}
}

// Expiry is the default; a token that never expires must be asked for
// explicitly, and cannot be reached by accident or by field precedence.
func TestAPITokenExpiryIsDefault(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	access, _ := register(t, h, "def@x.com")
	acct, _ := tenantIDs(t, h, access)

	// no expiry fields at all -> bounded default, NOT immortal
	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens", access, map[string]any{
		"name": "default", "scopes": []string{"access:read"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %v", rec.Code, out)
	}
	if out["never_expires"] != false || out["expires_at"] == nil {
		t.Fatalf("omitting expiry produced a non-expiring token: %v", out)
	}
	exp := int64(out["expires_at"].(float64))
	if want := time.Now().Add(defaultTokenTTLDays * 24 * time.Hour).Unix(); exp < want-120 || exp > want+120 {
		t.Errorf("default TTL is not %d days: expires_at=%d want~%d", defaultTokenTTLDays, exp, want)
	}

	// explicit immortality is honoured
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens", access, map[string]any{
		"name": "forever", "scopes": []string{"access:read"}, "never_expires": true,
	})
	if rec.Code != http.StatusCreated || out["never_expires"] != true || out["expires_at"] != nil {
		t.Fatalf("never_expires: %d %v", rec.Code, out)
	}

	// asking for both is a refusal, not a precedence rule
	rec, out = doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens", access, map[string]any{
		"name": "both", "scopes": []string{"access:read"}, "never_expires": true, "expires_in_days": 30,
	})
	if rec.Code != http.StatusBadRequest || out["error"] != "conflicting_expiry" {
		t.Errorf("conflicting expiry: %d %v", rec.Code, out)
	}

	// out-of-range explicit TTLs are refused at both ends
	for _, days := range []int{0, -1, maxTokenTTLDays + 1} {
		rec, out = doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens", access, map[string]any{
			"name": "bad", "scopes": []string{"access:read"}, "expires_in_days": days,
		})
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_expiry" {
			t.Errorf("expires_in_days=%d: %d %v", days, rec.Code, out)
		}
	}
}

// ---------------------------------------------------------------------------
// The account fence
// ---------------------------------------------------------------------------

// A token bound to account A must not touch account B — even though its
// owner is personally a member of BOTH, and even though every handler
// downstream scopes by that user's membership and would happily allow it.
// The fence is what makes the token narrower than the person.
func TestAPITokenAccountFence(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	access, _ := register(t, h, "two@x.com")
	acctA, locA := tenantIDs(t, h, access)
	apA := mkAccessPoint(t, h, access, locA, "A gate")

	rec, out := doJSON(t, h, "POST", "/v1/accounts", access, map[string]any{"name": "Second"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("second account: %d %v", rec.Code, out)
	}
	acctB := out["id"].(string)
	_, outB := doJSON(t, h, "GET", "/v1/accounts/"+acctB+"/locations", access, nil)
	locB := outB["locations"].([]any)[0].(map[string]any)["id"].(string)
	apB := mkAccessPoint(t, h, access, locB, "B gate")

	// Sanity: the PERSON can reach both.
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+apB, access, nil); rec.Code != http.StatusOK {
		t.Fatalf("owner cannot read B's access point, test premise broken")
	}

	tokA, _ := mkToken(t, h, access, acctA, map[string]any{
		"name": "a-only", "scopes": []string{"access:read", "access:open"},
	})

	// B's resources are 404 — indistinguishable from missing, not 403.
	for _, p := range []struct{ method, path string }{
		{"GET", "/v1/access-points/" + apB},
		{"POST", "/v1/access-points/" + apB + "/open"},
		{"POST", "/v1/access-points/" + apB + "/close"},
	} {
		rec, out := doJSON(t, h, p.method, p.path, tokA, map[string]any{"source": "api"})
		if rec.Code != http.StatusNotFound || out["error"] != "access_point_not_found" {
			t.Errorf("account-A token reached %s %s: %d %v", p.method, p.path, rec.Code, out)
		}
	}
	// A's own resource still works, so the 404s above are about the fence.
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+apA, tokA, nil); rec.Code != http.StatusOK {
		t.Fatalf("account-A token cannot read its own access point")
	}

	// The wide listing is narrowed, not merely discouraged: the default
	// "everything across my accounts" view must not include B.
	rec, out = doJSON(t, h, "GET", "/v1/access-points", tokA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("token list: %d %v", rec.Code, out)
	}
	aps := out["access_points"].([]any)
	if len(aps) != 1 || aps[0].(map[string]any)["id"] != apA {
		t.Errorf("token listing was not fenced to its account: %v", out)
	}
	// The same call under the PERSON's session still spans both accounts,
	// proving the narrowing came from the token and not from the handler.
	_, outAll := doJSON(t, h, "GET", "/v1/access-points", access, nil)
	if len(outAll["access_points"].([]any)) != 2 {
		t.Errorf("session listing should still span both accounts: %v", outAll)
	}
	// Explicitly asking for the other tenant is refused, not silently
	// rewritten to something else.
	rec, out = doJSON(t, h, "GET", "/v1/access-points?account_id="+acctB, tokA, nil)
	if rec.Code != http.StatusForbidden || out["error"] != "token_account_scope" {
		t.Errorf("cross-account list: %d %v", rec.Code, out)
	}
}

// ---------------------------------------------------------------------------
// The plaintext appears exactly once, and nowhere else — ever
// ---------------------------------------------------------------------------

func TestAPITokenPlaintextNeverReappears(t *testing.T) {
	h, st, logBuf := newTokenTestServer(t)
	access, _ := register(t, h, "leak@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Gate")

	plain, tokID := mkToken(t, h, access, acct, map[string]any{
		"name": "secret-bot", "scopes": []string{"access:read", "access:open"},
	})
	_, verifier, ok := splitAPIToken(plain)
	if !ok {
		t.Fatal("minted token does not parse")
	}

	// Exercise every surface that could echo it back: a use, a list, a
	// revoke, a post-revoke use, and a malformed-credential failure.
	bodies := []string{}
	record := func(method, path, bearer string, body any) {
		rec, _ := doJSON(t, h, method, path, bearer, body)
		bodies = append(bodies, rec.Body.String())
	}
	record("GET", "/v1/access-points/"+ap, plain, nil)
	record("POST", "/v1/access-points/"+ap+"/open", plain, map[string]any{"source": "api"})
	record("GET", "/v1/accounts/"+acct+"/api-tokens", access, nil)
	record("POST", "/v1/accounts/"+acct+"/api-tokens/"+tokID+"/revoke", access, map[string]any{})
	record("GET", "/v1/accounts/"+acct+"/api-tokens", access, nil)
	record("GET", "/v1/access-points/"+ap, plain, nil)              // revoked
	record("GET", "/v1/access-points/"+ap, plain+"x", nil)          // wrong verifier
	record("GET", "/v1/access-points/"+ap, "aqlt_nope.nope", nil)   // unknown
	record("GET", "/v1/access-points/"+ap, "not-even-a-token", nil) // malformed

	for i, b := range bodies {
		if strings.Contains(b, plain) || strings.Contains(b, verifier) {
			t.Fatalf("response %d echoed the token plaintext: %s", i, b)
		}
	}

	// Nothing the server logged may contain it either.
	if logs := logBuf.String(); strings.Contains(logs, plain) || strings.Contains(logs, verifier) {
		t.Fatalf("server log contains the token plaintext:\n%s", logs)
	}

	// And it is not recoverable from the database: no column holds it.
	rows, err := st.DB().Query(`SELECT id, account_id, user_id, name, selector, salt, verifier_hash FROM api_tokens`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, acctID, userID, name, selector, salt, hash string
		if err := rows.Scan(&id, &acctID, &userID, &name, &selector, &salt, &hash); err != nil {
			t.Fatal(err)
		}
		for _, col := range []string{id, acctID, userID, name, selector, salt, hash} {
			if strings.Contains(col, verifier) {
				t.Fatalf("a stored column contains the secret verifier: %q", col)
			}
		}
	}

	// The audit trail records the use, and records no secret.
	adminAccess := claimAdmin(t, h, "leak-admin@x.com")
	actions := auditActions(t, h, adminAccess)
	for _, want := range []string{"api_token_create", "api_token_use", "api_token_revoke"} {
		if !containsAction(actions, want) {
			t.Errorf("missing audit action %q; got %v", want, actions)
		}
	}
	_, auditOut := doJSON(t, h, "GET", "/v1/admin/audit/actions?limit=200", adminAccess, nil)
	if raw := toJSONString(t, auditOut); strings.Contains(raw, plain) || strings.Contains(raw, verifier) {
		t.Fatalf("the audit trail contains the token plaintext")
	}
}

// ---------------------------------------------------------------------------
// Credential handling
// ---------------------------------------------------------------------------

func TestAPITokenMalformedAndWrongSecretRefused(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	access, _ := register(t, h, "mal@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Gate")
	plain, _ := mkToken(t, h, access, acct, map[string]any{
		"name": "bot", "scopes": []string{"access:read"},
	})
	selector, verifier, _ := splitAPIToken(plain)

	bad := []string{
		"aqlt_",                  // prefix only
		"aqlt_" + selector,       // selector, no verifier
		"aqlt_" + selector + ".", // empty verifier
		"aqlt_." + verifier,      // empty selector
		"aqlt_" + selector + "." + verifier + ".x", // extra dot
		selector + "." + verifier,                  // right halves, no prefix -> not a JWT either
		"aqlt_" + selector + ".wrong-secret",       // valid selector, wrong secret
		strings.ToUpper(plain),                     // case-mangled
	}
	for _, cred := range bad {
		rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, cred, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("credential %q was not refused: %d %v", cred, rec.Code, out)
		}
		if code, _ := out["error"].(string); code != "invalid_api_token" && code != "unauthorized" {
			t.Errorf("credential %q leaked a distinguishing error %q", cred, code)
		}
	}
	// The real one still works, so the refusals above are about the
	// credential and not about the route.
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+ap, plain, nil); rec.Code != http.StatusOK {
		t.Fatalf("valid token refused after the malformed batch")
	}
}

// Failed token authentications are throttled by the EXISTING limiter
// (store/authratelimit.go), per source IP, failures only — so a successful
// caller is never throttled by its own traffic.
func TestAPITokenAuthFailuresRateLimited(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	access, _ := register(t, h, "rl@x.com")
	acct, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Gate")
	good, _ := mkToken(t, h, access, acct, map[string]any{
		"name": "bot", "scopes": []string{"access:read"},
	})

	limited := false
	for i := 0; i < int(tokenAuthFailuresPerWindow)+3; i++ {
		rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, "aqlt_bogus.bogus", nil)
		if rec.Code == http.StatusTooManyRequests && out["error"] == "rate_limited" {
			if rec.Header().Get("Retry-After") == "" {
				t.Errorf("rate-limited response has no Retry-After")
			}
			limited = true
			break
		}
	}
	if !limited {
		t.Fatalf("token auth failures were never rate limited")
	}
	// Once the window is spent, even the GOOD token is held off — the
	// throttle is per-IP and does not distinguish, which is the point.
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+ap, good, nil); rec.Code != http.StatusTooManyRequests {
		t.Errorf("throttle did not apply to the source IP: %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Issuance and management tenancy
// ---------------------------------------------------------------------------

func TestAPITokenManagementTenancy(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	ownerAccess, _ := register(t, h, "own@x.com")
	strangerAccess, _ := register(t, h, "stranger@x.com")
	acct, _ := tenantIDs(t, h, ownerAccess)
	_, tokID := mkToken(t, h, ownerAccess, acct, map[string]any{
		"name": "bot", "scopes": []string{"access:read"},
	})

	// A non-member cannot list, create or revoke — and gets 404, not 403.
	for _, p := range []struct {
		method, path string
		body         map[string]any
	}{
		{"GET", "/v1/accounts/" + acct + "/api-tokens", nil},
		{"POST", "/v1/accounts/" + acct + "/api-tokens", map[string]any{"name": "x", "scopes": []string{"access:open"}}},
		{"POST", "/v1/accounts/" + acct + "/api-tokens/" + tokID + "/revoke", map[string]any{}},
	} {
		rec, out := doJSON(t, h, p.method, p.path, strangerAccess, p.body)
		if rec.Code != http.StatusNotFound || out["error"] != "account_not_found" {
			t.Errorf("stranger %s %s: %d %v", p.method, p.path, rec.Code, out)
		}
	}

	// Unknown / bad scopes are refused rather than silently dropped: a
	// caller must never walk away believing they got a capability.
	for _, scopes := range [][]string{
		{},
		{"admin"},
		{"access:read", "access:read"},
		{"access:*"},
		{"ACCESS:OPEN"},
	} {
		rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens", ownerAccess, map[string]any{
			"name": "x", "scopes": scopes,
		})
		if rec.Code != http.StatusBadRequest || out["error"] != "invalid_scopes" {
			t.Errorf("scopes %v: %d %v", scopes, rec.Code, out)
		}
	}

	// A blank name is refused (the listing is the only place an operator
	// can tell one credential from another).
	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens", ownerAccess, map[string]any{
		"name": "   ", "scopes": []string{"access:read"},
	})
	if rec.Code != http.StatusBadRequest || out["error"] != "invalid_token_name" {
		t.Errorf("blank name: %d %v", rec.Code, out)
	}
}

// A plain member sees only their own tokens; an account admin sees all, so
// they can kill a departed colleague's credential. A member cannot revoke —
// or even confirm the existence of — someone else's.
func TestAPITokenListingAndRevokeVisibility(t *testing.T) {
	h, st, _ := newTokenTestServer(t)
	ownerAccess, _ := register(t, h, "boss@x.com")
	acct, _ := tenantIDs(t, h, ownerAccess)
	_, ownerTokID := mkToken(t, h, ownerAccess, acct, map[string]any{
		"name": "boss-bot", "scopes": []string{"access:read"},
	})

	token := inviteAndRecoverToken(t, h, st, ownerAccess, acct, "member@x.com", "member", "+27821230001")
	memberAccess, _ := register(t, h, "member@x.com")
	if rec, out := doJSON(t, h, "POST", "/v1/accounts/invites/"+token+"/accept", memberAccess, map[string]any{}); rec.Code != http.StatusOK {
		t.Fatalf("invite accept: %d %v", rec.Code, out)
	}
	_, memberTokID := mkToken(t, h, memberAccess, acct, map[string]any{
		"name": "member-bot", "scopes": []string{"access:read"},
	})

	// member sees one token (their own)
	_, out := doJSON(t, h, "GET", "/v1/accounts/"+acct+"/api-tokens", memberAccess, nil)
	list := out["api_tokens"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != memberTokID {
		t.Errorf("member listing should show only their own token: %v", out)
	}
	// owner (admin) sees both
	_, out = doJSON(t, h, "GET", "/v1/accounts/"+acct+"/api-tokens", ownerAccess, nil)
	if len(out["api_tokens"].([]any)) != 2 {
		t.Errorf("admin listing should show every token on the account: %v", out)
	}
	// member cannot revoke the owner's — and learns nothing about it
	rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens/"+ownerTokID+"/revoke", memberAccess, map[string]any{})
	if rec.Code != http.StatusNotFound || out["error"] != "api_token_not_found" {
		t.Errorf("member revoking the owner's token: %d %v", rec.Code, out)
	}
	// admin can revoke the member's
	if rec, out := doJSON(t, h, "POST", "/v1/accounts/"+acct+"/api-tokens/"+memberTokID+"/revoke", ownerAccess, map[string]any{}); rec.Code != http.StatusOK {
		t.Errorf("admin revoking a member's token: %d %v", rec.Code, out)
	}
}

// Sessions must be completely unaffected by the tokenScoped wrapper: the
// routes it wraps behave for a person exactly as requireAuth always did.
func TestTokenScopedRoutesUnchangedForSessions(t *testing.T) {
	h, _, _ := newTokenTestServer(t)
	access, _ := register(t, h, "sess@x.com")
	other, _ := register(t, h, "other@x.com")
	_, loc := tenantIDs(t, h, access)
	ap := mkAccessPoint(t, h, access, loc, "Gate")

	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+ap, access, nil); rec.Code != http.StatusOK {
		t.Errorf("session read")
	}
	if rec, _ := doJSON(t, h, "POST", "/v1/access-points/"+ap+"/open", access, map[string]any{"source": "web"}); rec.Code != http.StatusOK {
		t.Errorf("session open")
	}
	// non-member still 404, anonymous still 401
	if rec, out := doJSON(t, h, "GET", "/v1/access-points/"+ap, other, nil); rec.Code != http.StatusNotFound || out["error"] != "access_point_not_found" {
		t.Errorf("non-member session: %d %v", rec.Code, out)
	}
	if rec, _ := doJSON(t, h, "GET", "/v1/access-points/"+ap, "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous")
	}
}
