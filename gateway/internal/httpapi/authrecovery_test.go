package httpapi

// Adversarial tests for the account-recovery routes. The happy path is the
// least interesting thing here: a reset token is the one credential in this
// system that converts, on its own, into control of an account that opens
// physical gates, so what these tests assert is mostly what must NOT work —
// reuse, expiry, a stolen selector, a token pointed at somebody else, an
// unmetered guessing loop — plus the two properties a reviewer cannot see by
// reading the handler alone: that a reset really does end live sessions, and
// that forgot-password answers a known and an unknown address identically.

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/vul-os/aql/gateway/internal/keys"
	"github.com/vul-os/aql/gateway/internal/store"
)

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

type capturedMail struct {
	email     string
	token     string
	expiresAt time.Time
}

// captureMailer is the injected RecoveryMailer: it keeps what a real one
// would have delivered so tests can hold the plaintext token the response
// body deliberately never carries.
type captureMailer struct {
	mu       sync.Mutex
	resets   []capturedMail
	verifies []capturedMail
}

func (m *captureMailer) SendPasswordReset(_ context.Context, email, token string, exp time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resets = append(m.resets, capturedMail{email, token, exp})
	return nil
}

func (m *captureMailer) SendEmailVerification(_ context.Context, email, token string, exp time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.verifies = append(m.verifies, capturedMail{email, token, exp})
	return nil
}

func (m *captureMailer) lastReset(t *testing.T) capturedMail {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.resets) == 0 {
		t.Fatal("no password-reset mail was delivered")
	}
	return m.resets[len(m.resets)-1]
}

func (m *captureMailer) resetCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.resets)
}

// newRecoveryServer is newTestServerWithStore plus an injected capture
// mailer and caller-controlled auth throttles (the shared helpers give the
// generous defaults, which no rate-limit test could exhaust in a reasonable
// number of requests).
func newRecoveryServer(t *testing.T, limits store.AuthRateLimitConfig) (http.Handler, *store.Store, *captureMailer) {
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
	mailer := &captureMailer{}
	s := New(Config{
		Version:         "test",
		AdminClaimToken: "op-token",
		JWTSecret:       []byte("0123456789abcdef0123456789abcdef"),
		AuthRateLimits:  limits,
		RecoveryMailer:  mailer,
	}, st, ks, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	return s.Router(), st, mailer
}

// generousLimits is "throttling on, but out of the way" — every test that is
// not about rate limiting uses this so a cap never fires by accident.
var generousLimits = store.AuthRateLimitConfig{
	LoginIPPerWindow: 1000, LoginAccountPerWindow: 1000,
	RegisterIPPerWindow: 1000, RefreshIPPerWindow: 1000, ClaimIPPerWindow: 1000,
}

// forgotToken runs the real forgot-password route and returns the token the
// mailer received — the only place a caller can legitimately obtain one.
func forgotToken(t *testing.T, h http.Handler, m *captureMailer, email string) string {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": email})
	if rec.Code != http.StatusAccepted {
		t.Fatalf("forgot-password %s: %d %v", email, rec.Code, out)
	}
	return m.lastReset(t).token
}

func resetWith(t *testing.T, h http.Handler, token, newPassword string) (int, string) {
	t.Helper()
	rec, _ := doJSON(t, h, "POST", "/v1/auth/reset-password", "", map[string]any{
		"token": token, "new_password": newPassword,
	})
	return rec.Code, rec.Body.String()
}

func loginCode(t *testing.T, h http.Handler, email, password string) int {
	t.Helper()
	rec, _ := doJSON(t, h, "POST", "/v1/auth/login", "", map[string]any{
		"email": email, "password": password,
	})
	return rec.Code
}

func userIDOf(t *testing.T, h http.Handler, access string) string {
	t.Helper()
	rec, out := doJSON(t, h, "GET", "/v1/auth/me", access, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("me: %d %v", rec.Code, out)
	}
	return out["user"].(map[string]any)["id"].(string)
}

// mintStoredToken puts a token of the caller's choosing (purpose, expiry)
// straight into the store and hands back the plaintext — the only way to
// build an ALREADY-EXPIRED token, and the only issuance path for
// email-verification tokens, which nothing in the gateway mints yet.
func mintStoredToken(t *testing.T, st *store.Store, userID string, purpose store.RecoveryPurpose, expiresAt int64) string {
	t.Helper()
	m, err := mintRecovery(purpose)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateRecoveryToken(context.Background(), userID, purpose,
		m.selector, m.salt, m.verifierHash, expiresAt); err != nil {
		t.Fatal(err)
	}
	return m.plain
}

// ---------------------------------------------------------------------------
// enumeration
// ---------------------------------------------------------------------------

// TestForgotPasswordDoesNotEnumerate is the headline property: an
// unauthenticated caller must not be able to learn whether an address has an
// account on this instance — which here means learning whether a named person
// holds keys to a specific building. Status, headers and body are compared
// byte-for-byte between a registered address and one that has never existed.
func TestForgotPasswordDoesNotEnumerate(t *testing.T) {
	h, _, mailer := newRecoveryServer(t, generousLimits)
	register(t, h, "known@x.com")

	recKnown, _ := doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": "known@x.com"})
	recUnknown, _ := doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": "nobody@x.com"})

	if recKnown.Code != http.StatusAccepted {
		t.Fatalf("known address: want 202, got %d %s", recKnown.Code, recKnown.Body)
	}
	if recKnown.Code != recUnknown.Code {
		t.Errorf("status differs by account existence: known=%d unknown=%d", recKnown.Code, recUnknown.Code)
	}
	if recKnown.Body.String() != recUnknown.Body.String() {
		t.Errorf("body differs by account existence: known=%q unknown=%q",
			recKnown.Body.String(), recUnknown.Body.String())
	}
	if got, want := recUnknown.Header().Get("Content-Type"), recKnown.Header().Get("Content-Type"); got != want {
		t.Errorf("Content-Type differs by account existence: %q vs %q", got, want)
	}
	// ...and nothing was delivered for the address that does not exist: the
	// uniform response must not be bought by mailing strangers.
	if n := mailer.resetCount(); n != 1 {
		t.Fatalf("expected exactly one delivered reset (the real account), got %d", n)
	}
	if got := mailer.lastReset(t).email; got != "known@x.com" {
		t.Errorf("delivered to %q, want known@x.com", got)
	}
}

// TestForgotPasswordNeverReturnsTheToken: the secret travels out of band or
// not at all. A response body carrying it would make every network hop and
// every browser history entry an account-takeover vector.
func TestForgotPasswordNeverReturnsTheToken(t *testing.T) {
	h, _, mailer := newRecoveryServer(t, generousLimits)
	register(t, h, "leak@x.com")
	rec, _ := doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": "leak@x.com"})
	tok := mailer.lastReset(t).token
	if bytes.Contains(rec.Body.Bytes(), []byte(tok)) {
		t.Fatal("the reset token appeared in the HTTP response body")
	}
	sel, ver, ok := splitRecoveryToken(tok)
	if !ok {
		t.Fatalf("issued token is not selector.verifier: %q", tok)
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(sel)) || bytes.Contains(rec.Body.Bytes(), []byte(ver)) {
		t.Fatal("half of the reset token appeared in the HTTP response body")
	}
}

// ---------------------------------------------------------------------------
// reset: session invalidation, single use
// ---------------------------------------------------------------------------

// TestPasswordResetEndsLiveSessions proves the requirement that the store
// implements inside setPasswordTx rather than around it: after a reset, a
// refresh token minted BEFORE the reset is dead, so no further access tokens
// can be minted from the pre-reset session.
func TestPasswordResetEndsLiveSessions(t *testing.T) {
	h, _, mailer := newRecoveryServer(t, generousLimits)
	_, refresh := register(t, h, "session@x.com")

	// the pre-reset session is live
	rec, _ := doJSON(t, h, "POST", "/v1/auth/refresh", "", map[string]any{"refresh_token": refresh})
	if rec.Code != http.StatusOK {
		t.Fatalf("pre-reset refresh should work: %d %s", rec.Code, rec.Body)
	}
	newRefresh := func() string {
		_, out := doJSON(t, h, "POST", "/v1/auth/login", "", map[string]any{
			"email": "session@x.com", "password": "hunter2hunter2",
		})
		return out["tokens"].(map[string]any)["refresh_token"].(string)
	}()

	tok := forgotToken(t, h, mailer, "session@x.com")
	if code, body := resetWith(t, h, tok, "brand-new-passphrase"); code != http.StatusOK {
		t.Fatalf("reset: %d %s", code, body)
	}

	rec, out := doJSON(t, h, "POST", "/v1/auth/refresh", "", map[string]any{"refresh_token": newRefresh})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("a session that predates the reset must be dead: %d %v", rec.Code, out)
	}
	if code := loginCode(t, h, "session@x.com", "hunter2hunter2"); code != http.StatusUnauthorized {
		t.Errorf("the old password must stop working: %d", code)
	}
	if code := loginCode(t, h, "session@x.com", "brand-new-passphrase"); code != http.StatusOK {
		t.Errorf("the new password must work: %d", code)
	}
}

// TestResetTokenIsSingleUse: the second redemption of a spent token must fail
// AND must not apply its password. A token that keeps working is a permanent
// key handed out by email.
func TestResetTokenIsSingleUse(t *testing.T) {
	h, _, mailer := newRecoveryServer(t, generousLimits)
	register(t, h, "once@x.com")
	tok := forgotToken(t, h, mailer, "once@x.com")

	if code, body := resetWith(t, h, tok, "first-new-password"); code != http.StatusOK {
		t.Fatalf("first redemption: %d %s", code, body)
	}
	code, _ := resetWith(t, h, tok, "attacker-password")
	if code != http.StatusBadRequest {
		t.Fatalf("replayed token: want 400 invalid_token, got %d", code)
	}
	if got := loginCode(t, h, "once@x.com", "attacker-password"); got != http.StatusUnauthorized {
		t.Error("the replayed redemption applied its password anyway")
	}
	if got := loginCode(t, h, "once@x.com", "first-new-password"); got != http.StatusOK {
		t.Error("the legitimate password from the first redemption stopped working")
	}
}

// TestReissueSupersedesTheOlderToken: store.CreateRecoveryToken's one-live-
// token-per-(user,purpose) bound, observed from the HTTP side. Two requests,
// only the newest token redeems — so a flood of forgot-password requests
// cannot accumulate a pile of simultaneously-valid keys to one account.
func TestReissueSupersedesTheOlderToken(t *testing.T) {
	h, _, mailer := newRecoveryServer(t, generousLimits)
	register(t, h, "supersede@x.com")
	first := forgotToken(t, h, mailer, "supersede@x.com")
	second := forgotToken(t, h, mailer, "supersede@x.com")
	if first == second {
		t.Fatal("reissue returned the same token twice")
	}
	if code, _ := resetWith(t, h, first, "using-the-old-one"); code != http.StatusBadRequest {
		t.Errorf("the superseded token must be dead: %d", code)
	}
	if code, body := resetWith(t, h, second, "using-the-new-one"); code != http.StatusOK {
		t.Errorf("the newest token must redeem: %d %s", code, body)
	}
}

// ---------------------------------------------------------------------------
// every failure is the same failure
// ---------------------------------------------------------------------------

// TestTokenFailuresAreIndistinguishable is the fail-closed contract: expired,
// consumed, superseded, unknown-selector, right-selector-wrong-verifier and
// malformed all render as ONE response. Telling an attacker "expired" instead
// of "unknown" tells them a token once existed for that selector.
func TestTokenFailuresAreIndistinguishable(t *testing.T) {
	h, st, mailer := newRecoveryServer(t, generousLimits)
	accessA, _ := register(t, h, "shapes-a@x.com")
	uidA := userIDOf(t, h, accessA)
	register(t, h, "shapes-b@x.com")

	// expired: minted straight into the store with an expiry in the past.
	expired := mintStoredToken(t, st, uidA, store.RecoveryPasswordReset, time.Now().Add(-time.Hour).Unix())

	// consumed: issued and spent through the real routes (this also
	// supersedes `expired`, which is why `expired` was created first and is
	// checked for its own sake, not for ordering).
	consumed := forgotToken(t, h, mailer, "shapes-b@x.com")
	if code, body := resetWith(t, h, consumed, "b-new-password"); code != http.StatusOK {
		t.Fatalf("setup redemption: %d %s", code, body)
	}

	// right selector, wrong verifier: B's live-issued selector wearing A's
	// verifier. This is the case a selector-only design would let through.
	tokA := forgotToken(t, h, mailer, "shapes-a@x.com")
	tokB := forgotToken(t, h, mailer, "shapes-b@x.com")
	selB, _, ok := splitRecoveryToken(tokB)
	if !ok {
		t.Fatal("bad token shape")
	}
	_, verA, ok := splitRecoveryToken(tokA)
	if !ok {
		t.Fatal("bad token shape")
	}
	swapped := selB + "." + verA

	unknownSelector := mustMint(t, store.RecoveryPasswordReset) // never stored

	cases := map[string]string{
		"expired":          expired,
		"consumed":         consumed,
		"wrong verifier":   swapped,
		"unknown selector": unknownSelector,
		"no separator":     "not-a-token",
		"empty verifier":   "selector-only.",
		"empty":            "",
	}
	var wantCode int
	var wantBody string
	for name, tok := range cases {
		code, body := resetWith(t, h, tok, "attempted-password")
		if wantBody == "" {
			wantCode, wantBody = code, body
			if code != http.StatusBadRequest {
				t.Fatalf("%s: want 400 invalid_token, got %d %s", name, code, body)
			}
			continue
		}
		if code != wantCode || body != wantBody {
			t.Errorf("%s is distinguishable from the other failures: %d %s (want %d %s)",
				name, code, body, wantCode, wantBody)
		}
	}
	// None of that guessing may have moved a password.
	if got := loginCode(t, h, "shapes-a@x.com", "attempted-password"); got != http.StatusUnauthorized {
		t.Error("a refused token changed A's password anyway")
	}
	if got := loginCode(t, h, "shapes-b@x.com", "attempted-password"); got != http.StatusUnauthorized {
		t.Error("a refused token changed B's password anyway")
	}
	if got := loginCode(t, h, "shapes-b@x.com", "b-new-password"); got != http.StatusOK {
		t.Error("B's real password stopped working")
	}
}

func mustMint(t *testing.T, p store.RecoveryPurpose) string {
	t.Helper()
	m, err := mintRecovery(p)
	if err != nil {
		t.Fatal(err)
	}
	return m.plain
}

// TestResetTokenCannotBeRedeemedAgainstADifferentUser attacks the join the
// HTTP layer deliberately never exposes: the user id comes from the token's
// own row, never from the request. Pointing a valid, live token at another
// user id fails closed and leaves BOTH accounts untouched — including the
// token, which must not be burned by somebody else's failed attempt.
func TestResetTokenCannotBeRedeemedAgainstADifferentUser(t *testing.T) {
	h, st, mailer := newRecoveryServer(t, generousLimits)
	accessA, _ := register(t, h, "victim@x.com")
	accessB, _ := register(t, h, "attacker@x.com")
	uidA, uidB := userIDOf(t, h, accessA), userIDOf(t, h, accessB)

	tok := forgotToken(t, h, mailer, "victim@x.com")
	sel, _, ok := splitRecoveryToken(tok)
	if !ok {
		t.Fatal("bad token shape")
	}
	row, err := st.RecoveryTokenBySelector(context.Background(), sel, store.RecoveryPasswordReset)
	if err != nil {
		t.Fatal(err)
	}
	if row.UserID != uidA {
		t.Fatalf("token bound to %s, want the requesting user %s", row.UserID, uidA)
	}

	hash, err := HashPassword("stolen-account-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.RedeemPasswordReset(context.Background(), row.ID, uidB, hash); err == nil {
		t.Fatal("a token issued for one user redeemed against another")
	}
	if code := loginCode(t, h, "attacker@x.com", "stolen-account-password"); code != http.StatusUnauthorized {
		t.Error("the cross-user redemption changed the other account's password")
	}
	if code := loginCode(t, h, "victim@x.com", "hunter2hunter2"); code != http.StatusOK {
		t.Error("the victim's password changed")
	}
	// The victim's token survives a stranger's failed attempt at it.
	if code, body := resetWith(t, h, tok, "victim-chosen-password"); code != http.StatusOK {
		t.Errorf("the legitimate holder's token was burned by the failed attack: %d %s", code, body)
	}
}

// ---------------------------------------------------------------------------
// purpose separation
// ---------------------------------------------------------------------------

// TestEmailVerifyTokenCannotResetAPassword: purpose is part of the lookup key
// AND of the hash domain, so a reachability token is structurally unable to
// act as an account-takeover credential. The second half of the test matters
// as much as the first — the rejected attempt must not have consumed it.
func TestEmailVerifyTokenCannotResetAPassword(t *testing.T) {
	h, st, _ := newRecoveryServer(t, generousLimits)
	access, _ := register(t, h, "purpose@x.com")
	uid := userIDOf(t, h, access)
	tok := mintStoredToken(t, st, uid, store.RecoveryEmailVerify, time.Now().Add(time.Hour).Unix())

	if code, _ := resetWith(t, h, tok, "crossed-purposes"); code != http.StatusBadRequest {
		t.Fatalf("a verification token must not reset a password: %d", code)
	}
	if code := loginCode(t, h, "purpose@x.com", "crossed-purposes"); code != http.StatusUnauthorized {
		t.Fatal("the cross-purpose redemption changed the password")
	}
	rec, out := doJSON(t, h, "POST", "/v1/auth/verify-email", "", map[string]any{"token": tok})
	if rec.Code != http.StatusOK {
		t.Fatalf("the rejected cross-purpose attempt consumed the token: %d %v", rec.Code, out)
	}
}

// TestVerifyEmailStampsOnceAndIsSingleUse.
func TestVerifyEmailStampsOnceAndIsSingleUse(t *testing.T) {
	h, st, _ := newRecoveryServer(t, generousLimits)
	access, _ := register(t, h, "verify@x.com")
	uid := userIDOf(t, h, access)

	if v, err := st.EmailVerifiedAt(context.Background(), uid); err != nil || v != 0 {
		t.Fatalf("fresh user should be unverified: %d %v", v, err)
	}
	tok := mintStoredToken(t, st, uid, store.RecoveryEmailVerify, time.Now().Add(time.Hour).Unix())
	rec, out := doJSON(t, h, "POST", "/v1/auth/verify-email", "", map[string]any{"token": tok})
	if rec.Code != http.StatusOK {
		t.Fatalf("verify: %d %v", rec.Code, out)
	}
	v, err := st.EmailVerifiedAt(context.Background(), uid)
	if err != nil || v == 0 {
		t.Fatalf("email_verified_at not stamped: %d %v", v, err)
	}
	rec, _ = doJSON(t, h, "POST", "/v1/auth/verify-email", "", map[string]any{"token": tok})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("replayed verification token: want 400, got %d", rec.Code)
	}
	// Verification is a claim about reachability, never a credential event:
	// it must not have touched the password or the sessions.
	if code := loginCode(t, h, "verify@x.com", "hunter2hunter2"); code != http.StatusOK {
		t.Error("verifying an email disturbed the password")
	}
}

// ---------------------------------------------------------------------------
// update-password
// ---------------------------------------------------------------------------

// TestUpdatePasswordRequiresTheCurrentPassword: holding a live access token
// is NOT enough. Otherwise a leaked 15-minute token would be a permanent
// account takeover, since the change would also evict the real owner.
func TestUpdatePasswordRequiresTheCurrentPassword(t *testing.T) {
	h, _, _ := newRecoveryServer(t, generousLimits)
	access, refresh := register(t, h, "change@x.com")

	rec, out := doJSON(t, h, "POST", "/v1/auth/update-password", access, map[string]any{
		"current_password": "not-the-password", "new_password": "attacker-chosen",
	})
	if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_credentials" {
		t.Fatalf("wrong current password: want 401 invalid_credentials, got %d %v", rec.Code, out)
	}
	if code := loginCode(t, h, "change@x.com", "attacker-chosen"); code != http.StatusUnauthorized {
		t.Fatal("the password changed without the current password")
	}
	// unauthenticated is refused outright by the route's gate
	rec, _ = doJSON(t, h, "POST", "/v1/auth/update-password", "", map[string]any{
		"current_password": "hunter2hunter2", "new_password": "anonymous-change",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated update-password: want 401, got %d", rec.Code)
	}

	rec, out = doJSON(t, h, "POST", "/v1/auth/update-password", access, map[string]any{
		"current_password": "hunter2hunter2", "new_password": "owner-chosen-password",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("legitimate change: %d %v", rec.Code, out)
	}
	if code := loginCode(t, h, "change@x.com", "owner-chosen-password"); code != http.StatusOK {
		t.Error("the new password does not work")
	}
	if code := loginCode(t, h, "change@x.com", "hunter2hunter2"); code != http.StatusUnauthorized {
		t.Error("the old password still works")
	}
	// same session-ending guarantee as a reset — one mechanism, in-transaction
	rec, _ = doJSON(t, h, "POST", "/v1/auth/refresh", "", map[string]any{"refresh_token": refresh})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("update-password must end live sessions: refresh got %d", rec.Code)
	}
}

// TestUpdatePasswordKillsLiveResetTokens: "I changed my password because I
// think someone has access to my mail" has to actually close the door — a
// reset link mailed an hour ago must be dead afterwards.
func TestUpdatePasswordKillsLiveResetTokens(t *testing.T) {
	h, _, mailer := newRecoveryServer(t, generousLimits)
	access, _ := register(t, h, "mailcompromise@x.com")

	// The attacker (in the victim's mailbox) triggers a reset and holds the link.
	stolen := forgotToken(t, h, mailer, "mailcompromise@x.com")

	rec, out := doJSON(t, h, "POST", "/v1/auth/update-password", access, map[string]any{
		"current_password": "hunter2hunter2", "new_password": "locked-them-out",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("update-password: %d %v", rec.Code, out)
	}
	if code, _ := resetWith(t, h, stolen, "attacker-regains-access"); code != http.StatusBadRequest {
		t.Fatalf("the pre-existing reset link survived the password change: %d", code)
	}
	if code := loginCode(t, h, "mailcompromise@x.com", "locked-them-out"); code != http.StatusOK {
		t.Error("the owner's own new password stopped working")
	}
}

// ---------------------------------------------------------------------------
// rate limits — account recovery is the classic way around a hardened login
// ---------------------------------------------------------------------------

// TestForgotPasswordRateLimitExhausted: without this, the endpoint is an
// unmetered address-probing oracle (and an unmetered mail cannon).
func TestForgotPasswordRateLimitExhausted(t *testing.T) {
	limits := generousLimits
	limits.RegisterIPPerWindow = 2 // forgot-password rides the issuance budget
	h, _, _ := newRecoveryServer(t, limits)

	for i := 0; i < 2; i++ {
		rec, out := doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": "probe@x.com"})
		if rec.Code != http.StatusAccepted {
			t.Fatalf("probe %d: want 202, got %d %v", i, rec.Code, out)
		}
	}
	rec, out := doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": "probe@x.com"})
	if rec.Code != http.StatusTooManyRequests || out["error"] != "rate_limited" {
		t.Fatalf("3rd probe from the same IP: want 429, got %d %v", rec.Code, out)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("expected a Retry-After header on the 429")
	}
}

// TestResetPasswordRateLimitExhausted bounds token guessing. The verifier is
// 256 bits so guessing is hopeless anyway — but an unthrottled endpoint is
// still a free DoS and a free timing lab, and "the secret is big" is not a
// substitute for a limit.
func TestResetPasswordRateLimitExhausted(t *testing.T) {
	limits := generousLimits
	limits.LoginIPPerWindow = 2
	h, _, _ := newRecoveryServer(t, limits)

	for i := 0; i < 2; i++ {
		code, _ := resetWith(t, h, mustMint(t, store.RecoveryPasswordReset), "guessing-away")
		if code != http.StatusBadRequest {
			t.Fatalf("guess %d: want 400 invalid_token, got %d", i, code)
		}
	}
	rec, out := doJSON(t, h, "POST", "/v1/auth/reset-password", "", map[string]any{
		"token": mustMint(t, store.RecoveryPasswordReset), "new_password": "guessing-away",
	})
	if rec.Code != http.StatusTooManyRequests || out["error"] != "rate_limited" {
		t.Fatalf("3rd guess from the same IP: want 429, got %d %v", rec.Code, out)
	}
}

// TestVerifyEmailRateLimitExhausted — same reasoning, same shared limiter.
func TestVerifyEmailRateLimitExhausted(t *testing.T) {
	limits := generousLimits
	limits.LoginIPPerWindow = 2
	h, _, _ := newRecoveryServer(t, limits)

	for i := 0; i < 2; i++ {
		rec, _ := doJSON(t, h, "POST", "/v1/auth/verify-email", "", map[string]any{
			"token": mustMint(t, store.RecoveryEmailVerify),
		})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("guess %d: want 400, got %d", i, rec.Code)
		}
	}
	rec, out := doJSON(t, h, "POST", "/v1/auth/verify-email", "", map[string]any{
		"token": mustMint(t, store.RecoveryEmailVerify),
	})
	if rec.Code != http.StatusTooManyRequests || out["error"] != "rate_limited" {
		t.Fatalf("3rd verify from the same IP: want 429, got %d %v", rec.Code, out)
	}
}

// TestUpdatePasswordAccountLockoutAfterFailures: the per-account failure cap,
// the same shape handleLogin uses — so a stolen access token cannot be turned
// into an unmetered guessing loop for the current password.
func TestUpdatePasswordAccountLockoutAfterFailures(t *testing.T) {
	limits := generousLimits
	limits.LoginAccountPerWindow = 2
	h, _, _ := newRecoveryServer(t, limits)
	access, _ := register(t, h, "lockout@x.com")

	for i := 0; i < 2; i++ {
		rec, _ := doJSON(t, h, "POST", "/v1/auth/update-password", access, map[string]any{
			"current_password": "wrong", "new_password": "whatever-goes-here",
		})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d: want 401, got %d", i, rec.Code)
		}
	}
	// even with the RIGHT current password, past the cap
	rec, out := doJSON(t, h, "POST", "/v1/auth/update-password", access, map[string]any{
		"current_password": "hunter2hunter2", "new_password": "whatever-goes-here",
	})
	if rec.Code != http.StatusTooManyRequests || out["error"] != "rate_limited" {
		t.Fatalf("post-cap attempt: want 429, got %d %v", rec.Code, out)
	}
	if code := loginCode(t, h, "lockout@x.com", "whatever-goes-here"); code != http.StatusUnauthorized {
		t.Error("a throttled attempt changed the password anyway")
	}
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

// TestRecoveryWritesAuditRows: every recovery action lands in the hash-chained
// admin trail through the existing choke point (store.WriteAdminAudit) — a
// password change on a system that opens gates is exactly what that trail is
// for. Includes the no-account forgot-password branch, which an operator
// investigating an incident needs to see just as much as the real ones.
func TestRecoveryWritesAuditRows(t *testing.T) {
	h, st, mailer := newRecoveryServer(t, generousLimits)
	adminAccess := claimAdmin(t, h, "recovery-admin@x.com")
	userAccess, _ := register(t, h, "audited@x.com")
	uid := userIDOf(t, h, userAccess)

	doJSON(t, h, "POST", "/v1/auth/forgot-password", "", map[string]any{"email": "no-such-user@x.com"})
	tok := forgotToken(t, h, mailer, "audited@x.com")
	if code, body := resetWith(t, h, tok, "audited-new-password"); code != http.StatusOK {
		t.Fatalf("reset: %d %s", code, body)
	}
	rec, out := doJSON(t, h, "POST", "/v1/auth/update-password", userAccess, map[string]any{
		"current_password": "audited-new-password", "new_password": "audited-newer-password",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("update-password: %d %v", rec.Code, out)
	}
	vtok := mintStoredToken(t, st, uid, store.RecoveryEmailVerify, time.Now().Add(time.Hour).Unix())
	if rec, out := doJSON(t, h, "POST", "/v1/auth/verify-email", "", map[string]any{"token": vtok}); rec.Code != http.StatusOK {
		t.Fatalf("verify-email: %d %v", rec.Code, out)
	}

	actions := auditActions(t, h, adminAccess)
	for _, want := range []string{
		"password_reset_request",
		"password_reset_redeem",
		"password_update",
		"email_verify_redeem",
	} {
		if !containsAction(actions, want) {
			t.Errorf("expected %q in the admin audit trail, got: %v", want, actions)
		}
	}
	// The audit trail must record that recovery happened, never the secret.
	rec, _ = doJSON(t, h, "GET", "/v1/admin/audit?limit=200", adminAccess, nil)
	if bytes.Contains(rec.Body.Bytes(), []byte(tok)) {
		t.Fatal("a recovery token was written into the audit trail")
	}
	if sel, _, ok := splitRecoveryToken(tok); ok && bytes.Contains(rec.Body.Bytes(), []byte(sel)) {
		t.Fatal("a recovery token's selector was written into the audit trail")
	}
}
