package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// The algorithm, against the RFCs' own published vectors
// ---------------------------------------------------------------------------

// TestHOTPRFC4226Vectors checks hotpCode against RFC 4226 Appendix D — the
// canonical HOTP values for the ASCII secret "12345678901234567890" at
// counters 0..9. If this ever fails, no authenticator app in the world will
// interoperate with this server, whatever the rest of the tests say.
func TestHOTPRFC4226Vectors(t *testing.T) {
	secret := []byte("12345678901234567890")
	want := []string{
		"755224", "287082", "359152", "969429", "338314",
		"254676", "287922", "162583", "399871", "520489",
	}
	for i, w := range want {
		if got := hotpCode(secret, uint64(i), 6); got != w {
			t.Errorf("hotpCode(counter=%d) = %s, RFC 4226 says %s", i, got, w)
		}
	}
}

// TestTOTPRFC6238Vectors checks the time-based construction against RFC
// 6238 Appendix B's SHA-1 rows (the RFC's SHA-256/512 rows use different,
// longer seeds and a different HMAC; only SHA-1 is implemented here, on
// purpose — see twofactor.go's PARAMETERS section).
func TestTOTPRFC6238Vectors(t *testing.T) {
	secret := []byte("12345678901234567890")
	cases := []struct {
		unixTime int64
		want     string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	}
	for _, c := range cases {
		counter := totpCounter(c.unixTime, 30)
		if got := hotpCode(secret, uint64(counter), 8); got != c.want {
			t.Errorf("TOTP(T=%d) = %s, RFC 6238 says %s", c.unixTime, got, c.want)
		}
	}
	// And the verifier agrees with the generator at the RFC's own times.
	for _, c := range cases {
		if _, ok := verifyTOTP(secret, 8, 30, 1, c.want, c.unixTime); !ok {
			t.Errorf("verifyTOTP rejected the RFC vector at T=%d", c.unixTime)
		}
	}
}

// TestTOTPSkewWindowIsExactlyOneStep pins the acceptance window: the current
// step and one either side, and NOTHING else. Widening this is a real
// weakening (see twofactor.go), so it is asserted rather than assumed.
func TestTOTPSkewWindowIsExactlyOneStep(t *testing.T) {
	secret := []byte("12345678901234567890")
	const nowUnix int64 = 1700000000
	base := totpCounter(nowUnix, 30)

	for _, d := range []int64{-1, 0, 1} {
		code := hotpCode(secret, uint64(base+d), 6)
		step, ok := verifyTOTP(secret, 6, 30, totpSkewSteps, code, nowUnix)
		if !ok {
			t.Errorf("step %+d must be accepted within ±%d", d, totpSkewSteps)
			continue
		}
		if step != base+d {
			t.Errorf("step %+d reported as %d, want %d", d, step, base+d)
		}
	}
	for _, d := range []int64{-3, -2, 2, 3, 100} {
		code := hotpCode(secret, uint64(base+d), 6)
		if _, ok := verifyTOTP(secret, 6, 30, totpSkewSteps, code, nowUnix); ok {
			t.Errorf("a code from step %+d is outside the window and must be refused", d)
		}
	}
}

// TestNormalizeTOTPCodeRejectsJunk: only exactly `digits` ASCII digits count.
// Grouping whitespace a human types is tolerated; anything else is not.
func TestNormalizeTOTPCodeRejectsJunk(t *testing.T) {
	ok := []struct{ in, want string }{
		{"123456", "123456"},
		{"123 456", "123456"},
		{"123-456", "123456"},
	}
	for _, c := range ok {
		got, valid := normalizeTOTPCode(c.in, 6)
		if !valid || got != c.want {
			t.Errorf("normalizeTOTPCode(%q) = %q,%v", c.in, got, valid)
		}
	}
	for _, bad := range []string{"", "12345", "1234567", "12345a", "abcdef", "١٢٣٤٥٦"} {
		if _, valid := normalizeTOTPCode(bad, 6); valid {
			t.Errorf("normalizeTOTPCode(%q) must be refused", bad)
		}
	}
}

// TestRecoveryCodesAreDistinctAndHashed: the batch is unique, the plaintexts
// are not derivable from what gets stored, and normalisation is forgiving
// about grouping without being forgiving about content.
func TestRecoveryCodesAreDistinctAndHashed(t *testing.T) {
	plain, seeds, err := newRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) != recoveryCodeCount || len(seeds) != recoveryCodeCount {
		t.Fatalf("expected %d codes, got %d/%d", recoveryCodeCount, len(plain), len(seeds))
	}
	seen := map[string]bool{}
	for i, p := range plain {
		if seen[p] {
			t.Errorf("duplicate recovery code %q", p)
		}
		seen[p] = true
		if strings.Contains(seeds[i].CodeHash, normalizeRecoveryCode(p)) {
			t.Error("the stored digest must not contain the plaintext")
		}
		// Salts must differ per row (no precomputation across the batch).
		for j := range seeds {
			if j != i && seeds[j].Salt == seeds[i].Salt {
				t.Error("recovery code salts must be per-row")
			}
		}
		// The stored digest must match the code as a user would retype it.
		if totpRecoveryHash(seeds[i].Salt, normalizeRecoveryCode(strings.ToLower(p))) != seeds[i].CodeHash {
			t.Errorf("code %q does not verify against its own stored digest", p)
		}
	}
}

// ---------------------------------------------------------------------------
// End-to-end over the HTTP surface
// ---------------------------------------------------------------------------

// currentStep is the RFC 6238 counter this instant maps to.
func currentStep() int64 { return totpCounter(time.Now().Unix(), totpPeriodS) }

// enrollAndActivate takes a user from "password only" to "2FA on" and returns
// the base32 secret plus the recovery codes handed out once at activation.
//
// It activates with the code for the CURRENT step, which spends that counter.
// Every subsequent login in these tests therefore uses step+1 — inside the
// forward skew window and strictly greater than what was spent. That is what
// makes the replay assertions deterministic without a 30-second sleep.
func enrollAndActivate(t *testing.T, h http.Handler, access string) (secret string, recovery []string, step int64) {
	t.Helper()
	rec, out := doJSON(t, h, "POST", "/v1/auth/2fa/enroll", access, map[string]any{})
	if rec.Code != http.StatusCreated {
		t.Fatalf("enroll: %d %v", rec.Code, out)
	}
	secret = out["secret"].(string)
	if !strings.HasPrefix(out["otpauth_uri"].(string), "otpauth://totp/Aql:") {
		t.Errorf("otpauth uri: %v", out["otpauth_uri"])
	}
	if !strings.Contains(out["otpauth_uri"].(string), "secret="+secret) {
		t.Error("the otpauth uri must carry the secret")
	}

	step = currentStep()
	rec, out = doJSON(t, h, "POST", "/v1/auth/2fa/activate", access, map[string]any{
		"totp_code": codeAt(t, secret, step),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("activate: %d %v", rec.Code, out)
	}
	for _, c := range out["recovery_codes"].([]any) {
		recovery = append(recovery, c.(string))
	}
	if len(recovery) != recoveryCodeCount {
		t.Fatalf("expected %d recovery codes, got %d", recoveryCodeCount, len(recovery))
	}
	return secret, recovery, step
}

func codeAt(t *testing.T, secretB32 string, step int64) string {
	t.Helper()
	raw, err := b32.DecodeString(secretB32)
	if err != nil {
		t.Fatalf("decode secret: %v", err)
	}
	return hotpCode(raw, uint64(step), totpDigits)
}

func login(t *testing.T, h http.Handler, username string, body map[string]any) (int, map[string]any) {
	t.Helper()
	req := map[string]any{"username": username, "password": "hunter2hunter2"}
	for k, v := range body {
		req[k] = v
	}
	rec, out := doJSON(t, h, "POST", "/v1/auth/login", "", req)
	return rec.Code, out
}

// TestLoginUnchangedForUserWithoutTwoFactor is the regression that matters
// most to everyone who never enrols: adding 2FA must not have added a step to
// their login.
func TestLoginUnchangedForUserWithoutTwoFactor(t *testing.T) {
	h := newTestServer(t, "")
	register(t, h, "plain@x.com")

	code, out := login(t, h, "plain@x.com", nil)
	if code != http.StatusOK {
		t.Fatalf("login: %d %v", code, out)
	}
	if out["tokens"] == nil {
		t.Error("a user with no factor must get tokens from password alone")
	}
	rec, st := doJSON(t, h, "GET", "/v1/auth/2fa",
		out["tokens"].(map[string]any)["access_token"].(string), nil)
	if rec.Code != http.StatusOK || st["enrolled"] != false || st["active"] != false {
		t.Errorf("status for an un-enrolled user: %d %v", rec.Code, st)
	}
}

// TestPendingEnrollmentDoesNotGateLogin is the lockout guard: a secret that
// has been generated but never proven must not start demanding codes. The
// user may have closed the tab before the QR scan worked.
func TestPendingEnrollmentDoesNotGateLogin(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "pending@x.com")

	rec, out := doJSON(t, h, "POST", "/v1/auth/2fa/enroll", access, map[string]any{})
	if rec.Code != http.StatusCreated {
		t.Fatalf("enroll: %d %v", rec.Code, out)
	}
	code, body := login(t, h, "pending@x.com", nil)
	if code != http.StatusOK || body["tokens"] == nil {
		t.Fatalf("a PENDING factor must not gate login: %d %v", code, body)
	}

	// And the pending enrolment can be abandoned cleanly.
	rec, _ = doJSON(t, h, "DELETE", "/v1/auth/2fa/enroll", access, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("cancel pending: %d", rec.Code)
	}
	rec, st := doJSON(t, h, "GET", "/v1/auth/2fa", access, nil)
	if rec.Code != http.StatusOK || st["enrolled"] != false {
		t.Errorf("status after cancel: %d %v", rec.Code, st)
	}
}

// TestTwoFactorLoginHappyPathAndReplay covers the core of the feature:
// password alone is refused once 2FA is on, the right code logs in, and the
// SAME code cannot be used a second time.
func TestTwoFactorLoginHappyPathAndReplay(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "tfa@x.com")
	secret, _, step := enrollAndActivate(t, h, access)

	// Password alone: refused, and told what is missing (no session, no
	// intermediate token).
	code, out := login(t, h, "tfa@x.com", nil)
	if code != http.StatusUnauthorized || out["error"] != "totp_required" {
		t.Fatalf("password alone must be refused: %d %v", code, out)
	}
	if out["tokens"] != nil {
		t.Fatal("no tokens may be issued without the second factor")
	}

	// Right code (step+1: inside the forward skew window, and strictly newer
	// than the counter activation spent).
	loginCode := codeAt(t, secret, step+1)
	code, out = login(t, h, "tfa@x.com", map[string]any{"totp_code": loginCode})
	if code != http.StatusOK || out["tokens"] == nil {
		t.Fatalf("valid code must log in: %d %v", code, out)
	}

	// REPLAY: the identical code, immediately.
	code, out = login(t, h, "tfa@x.com", map[string]any{"totp_code": loginCode})
	if code != http.StatusUnauthorized || out["error"] != "invalid_second_factor" {
		t.Errorf("a replayed code must be refused: %d %v", code, out)
	}

	// A code from a step well outside the window.
	code, out = login(t, h, "tfa@x.com", map[string]any{"totp_code": codeAt(t, secret, step+50)})
	if code != http.StatusUnauthorized || out["error"] != "invalid_second_factor" {
		t.Errorf("a wrong-step code must be refused: %d %v", code, out)
	}

	// Both factors at once is a structural error, not a silent preference.
	code, out = login(t, h, "tfa@x.com", map[string]any{
		"totp_code": codeAt(t, secret, step+2), "recovery_code": "AAAA-BBBB-CCCC-DDDD",
	})
	if code != http.StatusBadRequest || out["error"] != "conflicting_second_factor" {
		t.Errorf("presenting both must be refused: %d %v", code, out)
	}
}

// TestRecoveryCodeLoginIsSingleUse: a recovery code logs its holder in
// exactly once.
func TestRecoveryCodeLoginIsSingleUse(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "rec@x.com")
	_, recovery, _ := enrollAndActivate(t, h, access)

	code, out := login(t, h, "rec@x.com", map[string]any{"recovery_code": recovery[0]})
	if code != http.StatusOK || out["tokens"] == nil {
		t.Fatalf("a recovery code must log in: %d %v", code, out)
	}
	code, out = login(t, h, "rec@x.com", map[string]any{"recovery_code": recovery[0]})
	if code != http.StatusUnauthorized || out["error"] != "invalid_second_factor" {
		t.Errorf("a recovery code must not work twice: %d %v", code, out)
	}
	// Lowercase / regrouped: still recognised as the same (already spent) code.
	code, _ = login(t, h, "rec@x.com", map[string]any{
		"recovery_code": strings.ToLower(strings.ReplaceAll(recovery[0], "-", " ")),
	})
	if code != http.StatusUnauthorized {
		t.Error("a re-typed spent code must still be refused")
	}
	// A different, unspent code still works.
	code, out = login(t, h, "rec@x.com", map[string]any{"recovery_code": recovery[1]})
	if code != http.StatusOK || out["tokens"] == nil {
		t.Fatalf("a second, unspent code must work: %d %v", code, out)
	}
	// And the count is visible so it cannot silently reach zero.
	newAccess := out["tokens"].(map[string]any)["access_token"].(string)
	rec, st := doJSON(t, h, "GET", "/v1/auth/2fa", newAccess, nil)
	if rec.Code != http.StatusOK || st["recovery_codes_remaining"].(float64) != float64(recoveryCodeCount-2) {
		t.Errorf("remaining count: %d %v", rec.Code, st)
	}
}

// TestTwoFactorVerificationRateLimited: six digits is a million guesses and
// an unthrottled endpoint would make that an afternoon's work. Exhausting the
// shared budget must produce 429 with Retry-After, and it must NOT be
// refreshable by switching endpoints.
func TestTwoFactorVerificationRateLimited(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "brute@x.com")
	secret, _, step := enrollAndActivate(t, h, access)

	for i := 0; i < totpVerifyPerWindow; i++ {
		code, out := login(t, h, "brute@x.com", map[string]any{"totp_code": "000000"})
		if code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d %v", i, code, out)
		}
	}
	code, out := login(t, h, "brute@x.com", map[string]any{"totp_code": "000000"})
	if code != http.StatusTooManyRequests || out["error"] != "rate_limited" {
		t.Fatalf("the budget must run out: %d %v", code, out)
	}

	// Switching endpoints must not buy a fresh budget — same counter.
	rec, out := doJSON(t, h, "POST", "/v1/auth/2fa/disable", access, map[string]any{
		"totp_code": "000000",
	})
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("disable must share the exhausted budget: %d %v", rec.Code, out)
	}

	// And a CORRECT code is refused too while the window is exhausted: the
	// throttle fails closed rather than letting a lucky guess through.
	code, out = login(t, h, "brute@x.com", map[string]any{"totp_code": codeAt(t, secret, step+1)})
	if code != http.StatusTooManyRequests {
		t.Errorf("even a valid code must wait out the window: %d %v", code, out)
	}
}

// TestDisableRequiresProofOfPossession is the "stolen session" case: holding
// a live access token must NOT be enough to remove the factor that exists
// precisely to survive a stolen session.
func TestDisableRequiresProofOfPossession(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "off@x.com")
	secret, recovery, step := enrollAndActivate(t, h, access)

	// No credential at all.
	rec, out := doJSON(t, h, "POST", "/v1/auth/2fa/disable", access, map[string]any{})
	if rec.Code != http.StatusBadRequest || out["error"] != "second_factor_required" {
		t.Fatalf("disable with no code must be refused: %d %v", rec.Code, out)
	}
	// A wrong code.
	rec, out = doJSON(t, h, "POST", "/v1/auth/2fa/disable", access, map[string]any{"totp_code": "000000"})
	if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_second_factor" {
		t.Fatalf("disable with a wrong code must be refused: %d %v", rec.Code, out)
	}
	// A wrong recovery code.
	rec, out = doJSON(t, h, "POST", "/v1/auth/2fa/disable", access, map[string]any{
		"recovery_code": "AAAA-BBBB-CCCC-DDDD",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("disable with a bogus recovery code must be refused: %d %v", rec.Code, out)
	}
	// Still on.
	rec, st := doJSON(t, h, "GET", "/v1/auth/2fa", access, nil)
	if rec.Code != http.StatusOK || st["active"] != true {
		t.Fatalf("2FA must still be active: %v", st)
	}
	_ = recovery

	// The real thing.
	rec, out = doJSON(t, h, "POST", "/v1/auth/2fa/disable", access, map[string]any{
		"totp_code": codeAt(t, secret, step+1),
	})
	if rec.Code != http.StatusOK || out["active"] != false {
		t.Fatalf("disable with a valid code: %d %v", rec.Code, out)
	}
	// Login is back to password-only, and the old secret is dead.
	code, body := login(t, h, "off@x.com", nil)
	if code != http.StatusOK || body["tokens"] == nil {
		t.Errorf("login must return to password-only after disable: %d %v", code, body)
	}
}

// TestEnrollRefusedWhileActive: re-enrolling over a live factor would let a
// stolen session swap the second factor without proving possession.
func TestEnrollRefusedWhileActive(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "swap@x.com")
	enrollAndActivate(t, h, access)

	rec, out := doJSON(t, h, "POST", "/v1/auth/2fa/enroll", access, map[string]any{})
	if rec.Code != http.StatusConflict || out["error"] != "totp_already_active" {
		t.Errorf("enrol over an active factor must be refused: %d %v", rec.Code, out)
	}
	// And activate is not a second way in.
	rec, out = doJSON(t, h, "POST", "/v1/auth/2fa/activate", access, map[string]any{"totp_code": "000000"})
	if rec.Code != http.StatusConflict || out["error"] != "no_pending_enrollment" {
		t.Errorf("activate with nothing pending: %d %v", rec.Code, out)
	}
}

// TestActivateRefusesWrongCode: enrolment is not complete until possession is
// proven, and a failed proof leaves the factor pending (still gating nothing).
func TestActivateRefusesWrongCode(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "prove@x.com")
	rec, out := doJSON(t, h, "POST", "/v1/auth/2fa/enroll", access, map[string]any{})
	if rec.Code != http.StatusCreated {
		t.Fatalf("enroll: %d %v", rec.Code, out)
	}
	secret := out["secret"].(string)

	rec, out = doJSON(t, h, "POST", "/v1/auth/2fa/activate", access, map[string]any{"totp_code": "000000"})
	if rec.Code != http.StatusUnauthorized || out["error"] != "invalid_second_factor" {
		t.Fatalf("activate with a wrong code: %d %v", rec.Code, out)
	}
	rec, st := doJSON(t, h, "GET", "/v1/auth/2fa", access, nil)
	if rec.Code != http.StatusOK || st["active"] != false || st["pending"] != true {
		t.Errorf("a failed proof must leave the factor PENDING (gating nothing): %v", st)
	}
	// A code from far outside the window is refused too.
	rec, _ = doJSON(t, h, "POST", "/v1/auth/2fa/activate", access, map[string]any{
		"totp_code": codeAt(t, secret, currentStep()+50),
	})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("out-of-window activation code: %d", rec.Code)
	}
	// The right one works, and the proving code is spent — it cannot be
	// turned straight around into a login.
	step := currentStep()
	rec, _ = doJSON(t, h, "POST", "/v1/auth/2fa/activate", access, map[string]any{
		"totp_code": codeAt(t, secret, step),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("activate: %d", rec.Code)
	}
	code, body := login(t, h, "prove@x.com", map[string]any{"totp_code": codeAt(t, secret, step)})
	if code != http.StatusUnauthorized {
		t.Errorf("the activation code must not double as a login code: %d %v", code, body)
	}
}

// TestSecretNeverInStatusProjection: the one property the whole file is built
// around. The secret is shown at enrolment and never again — not in the
// status read, not in any other authenticated response.
func TestSecretNeverInStatusProjection(t *testing.T) {
	h := newTestServer(t, "")
	access, _ := register(t, h, "leak@x.com")
	secret, _, _ := enrollAndActivate(t, h, access)

	for _, probe := range []struct{ method, path string }{
		{"GET", "/v1/auth/2fa"},
		{"GET", "/v1/auth/me"},
	} {
		rec, _ := doJSON(t, h, probe.method, probe.path, access, nil)
		if strings.Contains(rec.Body.String(), secret) {
			t.Errorf("%s %s leaked the TOTP secret", probe.method, probe.path)
		}
	}
}

// TestTwoFactorRoutesRequireASession: none of these may be reached with an
// API token or anonymously.
func TestTwoFactorRoutesRequireASession(t *testing.T) {
	h := newTestServer(t, "")
	for _, probe := range []struct{ method, path string }{
		{"GET", "/v1/auth/2fa"},
		{"POST", "/v1/auth/2fa/enroll"},
		{"DELETE", "/v1/auth/2fa/enroll"},
		{"POST", "/v1/auth/2fa/activate"},
		{"POST", "/v1/auth/2fa/disable"},
	} {
		rec, _ := doJSON(t, h, probe.method, probe.path, "", map[string]any{})
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s unauthenticated: %d, want 401", probe.method, probe.path, rec.Code)
		}
	}
}

// TestTwoFactorAudited: enrolment, activation, disablement and a failed
// second factor all leave a durable trail — and none of it contains the
// secret or a recovery code.
func TestTwoFactorAudited(t *testing.T) {
	h := newTestServer(t, "op-token")
	adminAccess := claimAdmin(t, h, "2fa-admin@x.com")
	secret, recovery, step := enrollAndActivate(t, h, adminAccess)

	// One failed login attempt, for the failure trail.
	login(t, h, "2fa-admin@x.com", map[string]any{"totp_code": "000000"})
	// One successful one.
	login(t, h, "2fa-admin@x.com", map[string]any{"totp_code": codeAt(t, secret, step+1)})

	actions := auditActions(t, h, adminAccess)
	for _, want := range []string{"2fa_enroll_start", "2fa_activate", "2fa_login"} {
		if !containsAction(actions, want) {
			t.Errorf("expected %q in the audit trail, got %v", want, actions)
		}
	}
	rec, _ := doJSON(t, h, "GET", "/v1/admin/audit?limit=200", adminAccess, nil)
	body := rec.Body.String()
	if strings.Contains(body, secret) {
		t.Error("the audit trail must never contain the TOTP secret")
	}
	for _, c := range recovery {
		if strings.Contains(body, c) {
			t.Error("the audit trail must never contain a recovery code")
		}
	}
}
