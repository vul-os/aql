package httpapi

// Spending an API token. This file is the whole authorisation story for
// token-authenticated requests; tokens.go issues them, store/tokens.go
// persists and validates them.
//
// ============================================================================
// WHY A READ-ONLY TOKEN CANNOT ACTUATE A GATE — the property, and the proof
// ============================================================================
// The required scope is not a value carried by the request, and it is not a
// string a handler compares. It is an argument fixed at ROUTE REGISTRATION
// time, in Router() (server.go), on the http.Handler that wraps the handler
// function. Reaching handleAccessPointOpen at all means having gone through
// tokenScoped(store.ScopeAccessOpen, ...), which returns before calling the
// handler func unless the principal holds that exact grant. There is no
// request field, header, body value or path that participates in choosing
// which scope is demanded, so there is nothing for a caller to influence.
//
// And the complementary half, which is what makes it airtight rather than
// merely careful: EVERY other authenticated route in this server is wrapped
// in requireAuth (or requireAdmin, which is built on requireAuth), and
// requireAuth accepts a session JWT and nothing else — it calls VerifyJWT,
// which rejects an "aqlt_..." string as malformed. So a token presented at a
// route that was never registered with a scope is not "allowed by default":
// it is rejected for not being a JWT, before any handler-specific logic runs.
// Default-deny is the existing behaviour of an unmodified requireAuth, not a
// new rule this file adds and could forget to apply.
//
// The consequence: adding a token-reachable route is a deliberate, visible,
// one-line act in Router() that names the scope it requires. Forgetting to
// think about scopes on some new route fails CLOSED (tokens simply cannot
// reach it), never open.
//
// ============================================================================
// A TOKEN NEVER WIDENS ITS HOLDER
// ============================================================================
// On success the middleware injects a *Claims whose Sub is the ISSUING USER.
// Downstream, nothing knows or cares that a token was involved: the
// membership gates (accessPointScope, memberRole), the role checks
// (isAdminRole), the choke point's live user-status check and its
// admin-quota exemption all re-derive from that user id against LIVE
// database state. A token is therefore a strict narrowing of one person, and
// store.AuthenticateAPIToken re-proves that person's active membership and
// current role on every single request — never at issue time only. Losing
// membership kills the token on the next request with nothing to sweep.
//
// The injected Claims deliberately carries IsAdmin=false, but that is belt
// and braces: requireAdmin re-reads the live users row and never trusts the
// claim, and admin routes are JWT-only anyway per the paragraph above.
//
// ============================================================================
// THE ACCOUNT FENCE
// ============================================================================
// Scope answers "what may this token do"; the fence answers "to whose
// stuff". A token is bound to one account (api_tokens.account_id). Without a
// fence, a token issued for the holder's home would reach every account they
// are a member of, because the handlers scope by USER membership and the
// token acts as the user.
//
// So the fence, like the scope, is bound at route registration — a small
// function paired with the scope, run after authentication and before the
// handler. For path-addressed access points it resolves the target's owning
// account and demands an exact match (mismatch = 404, the same no-existence-
// leak answer accessPointScope gives). For the account-wide listing it
// NARROWS the request: the account_id query parameter is forced to the
// token's account, so the "list everything across my accounts" default is
// unreachable with a token rather than merely discouraged.
//
// ============================================================================
// FAILURE HANDLING
// ============================================================================
//   - Every authentication failure — unknown selector, wrong verifier,
//     revoked, expired, owner disabled, owner no longer a member, account
//     suspended — renders as one 401 invalid_api_token. store's
//     ErrAPITokenUnusable exists to make that easy to honour.
//   - Authentication failures are throttled with the EXISTING limiter
//     (store/authratelimit.go), failures-only, per source IP. A scope denial
//     is NOT a throttled failure: the credential was valid, the caller is
//     identified and audited, and counting it would let a legitimate
//     automation box that hits a permission boundary lock its own IP out of
//     the endpoints it does have.
//   - Store errors fail CLOSED (503), matching authratelimit.go's stance for
//     credential paths and deliberately NOT openpath.go's availability-wins
//     stance: this is credential verification, not gate availability.
//   - Every use, allowed or denied, writes an admin_audit_log row through
//     store.WriteAdminAudit — the existing hash-chained choke point. Nothing
//     here inserts into an audit table directly. Actuations additionally
//     leave their usual access_logs row, because they run the unmodified
//     handler and therefore the unmodified store.LogAccess choke point.

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// apiTokenKey carries the authenticated principal alongside the synthesized
// Claims, for audit detail and tests. Nothing downstream is required to read
// it — authorisation does not depend on anyone remembering to.
const apiTokenKey ctxKey = 1

// tokenAuthFailuresPerWindow bounds FAILED token authentications per source
// IP inside one store.AuthWindowS window.
//
// Failures only, per-IP, for the reasons store/authratelimit.go's package
// comment sets out: a per-IP hard limit costs the attacker their own budget
// and never a victim's, and counting only failures means a busy, correctly
// configured automation box is never throttled by its own success. There is
// deliberately no per-TOKEN counter — it would hand an attacker a way to
// disable a specific gate credential on purpose by failing it repeatedly
// from anywhere, and it would buy nothing: the verifier is 256 random bits,
// so there is no guessing attack for it to bound.
//
// Env-only by omission, like every other value in AuthRateLimitConfig: a
// brute-force control an operator (or someone who has talked their way into
// the admin console) can turn off at runtime is not a control.
const tokenAuthFailuresPerWindow int64 = 20

// accountFence narrows a token-authenticated request to the token's own
// account. It returns the request to pass on (possibly rewritten) and false
// if it has already written a refusal.
type accountFence func(s *Server, w http.ResponseWriter, r *http.Request, tokenAccountID string) (*http.Request, bool)

// tokenScoped is the one constructor that makes a route reachable by an API
// token. Everything a token is allowed to do on the route is decided here,
// from arguments supplied at registration:
//
//	scope  the grant the token must hold. A constant at the call site in
//	       Router(); nothing in the request can change which one is demanded.
//	fence  binds the request to the token's account (see the file comment).
//
// A SESSION request (a JWT, or no credential at all) takes the completely
// unmodified requireAuth path — same behaviour, same errors, no scope and no
// fence, because a person's own session is already bounded by their
// membership and is not what this mechanism restricts.
func (s *Server) tokenScoped(scope store.APITokenScope, fence accountFence, next http.HandlerFunc) http.Handler {
	session := s.requireAuth(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !strings.HasPrefix(raw, apiTokenPrefix) {
			session.ServeHTTP(w, r)
			return
		}
		p, ok := s.authenticateToken(w, r)
		if !ok {
			return
		}

		// ---- THE SCOPE CHECK -------------------------------------------
		// Bound at registration, evaluated before the handler function is
		// entered. A read-only token reaching an actuation route stops here
		// having executed no part of the open path: no membership lookup, no
		// store.LogAccess call, no command signed, nothing dispatched.
		if !p.Has(scope) {
			s.auditTokenUse(r, p, string(scope), false, "insufficient_scope")
			writeErr(w, http.StatusForbidden, "insufficient_scope")
			return
		}

		// ---- THE ACCOUNT FENCE -----------------------------------------
		r, ok = fence(s, w, r, p.AccountID)
		if !ok {
			return
		}

		s.auditTokenUse(r, p, string(scope), true, "")

		// Act as the issuing user. Every downstream gate re-derives from
		// this id against live state — see the file comment.
		claims := &Claims{
			Iss: jwtIssuer, Sub: p.UserID, Username: p.Username, IsAdmin: false,
		}
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		ctx = context.WithValue(ctx, apiTokenKey, p)
		next(w, r.WithContext(ctx))
	})
}

// authenticateToken verifies the presented credential and returns the live
// principal. It writes the refusal itself and returns false on any failure.
func (s *Server) authenticateToken(w http.ResponseWriter, r *http.Request) (*store.APITokenPrincipal, bool) {
	nowUnix := time.Now().Unix()
	ipSubject := "ip:" + clientIP(r)

	over, retry, err := s.store.AuthAttemptsOverCap(r.Context(), "api_token_ip", ipSubject,
		tokenAuthFailuresPerWindow, nowUnix)
	if err != nil {
		s.log.Error("api token rate limit check failed", "err", err)
		writeErr(w, http.StatusServiceUnavailable, "rate_limit_unavailable")
		return nil, false
	}
	if over {
		w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return nil, false
	}

	fail := func() (*store.APITokenPrincipal, bool) {
		if ferr := s.store.RecordAuthFailure(r.Context(), "api_token_ip", ipSubject, nowUnix); ferr != nil {
			s.log.Error("record api token auth failure", "err", ferr)
		}
		// ONE error for every reason. The credential is never echoed back,
		// not even in part: an error carrying the selector would put a
		// working half of the token into the caller's logs and ours.
		writeErr(w, http.StatusUnauthorized, "invalid_api_token")
		return nil, false
	}

	raw, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	selector, verifier, ok := splitAPIToken(raw)
	if !ok {
		// Burn one digest+compare so a malformed credential costs the same
		// as a well-formed wrong one (handleLogin's dummyHash technique).
		verifyAPIToken("never-a-real-verifier", dummyAPITokenSalt, dummyAPITokenHash)
		return fail()
	}

	p, err := s.store.AuthenticateAPIToken(r.Context(), selector,
		func(salt, want string) bool { return verifyAPIToken(verifier, salt, want) }, nowUnix)
	if errors.Is(err, store.ErrAPITokenUnusable) {
		return fail()
	}
	if err != nil {
		// Fail CLOSED: a store error on a credential path denies. See the
		// file comment for why this diverges from openpath.go.
		s.log.Error("api token authentication failed", "err", err)
		writeErr(w, http.StatusServiceUnavailable, "auth_unavailable")
		return nil, false
	}
	return p, true
}

// auditTokenUse records one token use through store.WriteAdminAudit — the
// existing hash-chained, append-only choke point. Best-effort per that
// method's contract: an audit-write failure never turns a denial into an
// allow, nor an allow into a 500.
//
// The detail names the token, the account, the route and the scope. It never
// names the credential — there is no field here that could carry it.
func (s *Server) auditTokenUse(r *http.Request, p *store.APITokenPrincipal, scope string, allowed bool, reason string) {
	detail := map[string]any{
		"account_id": p.AccountID,
		"method":     r.Method,
		"path":       r.URL.Path,
		"scope":      scope,
	}
	if reason != "" {
		detail["reason"] = reason
	}
	if err := s.store.WriteAdminAudit(r.Context(), p.UserID, "api_token_use", "api_token", p.TokenID,
		allowed, detail); err != nil {
		s.log.Error("api token use audit write failed", "token_id", p.TokenID, "err", err)
	}
}

// apiTokenFrom returns the principal for a token-authenticated request, or
// nil for a session request. Informational only — no authorisation decision
// anywhere depends on calling it.
func apiTokenFrom(r *http.Request) *store.APITokenPrincipal {
	p, _ := r.Context().Value(apiTokenKey).(*store.APITokenPrincipal)
	return p
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

// fenceAccessPointPath binds a request addressed at /{id} to the token's
// account by resolving the access point's owner and demanding an exact
// match.
//
// A mismatch is 404 access_point_not_found, NOT 403: an access point in
// another account must be indistinguishable from one that does not exist,
// which is the same contract accessPointScope and the whole store package
// keep. That holds even when the token's owner is personally a member of
// that other account — the token is not, and the token is what is being
// spent.
func fenceAccessPointPath(s *Server, w http.ResponseWriter, r *http.Request, tokenAccountID string) (*http.Request, bool) {
	apc, err := s.store.AccessPointContextByID(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "access_point_not_found")
		return nil, false
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return nil, false
	}
	if apc.AccountID != tokenAccountID {
		writeErr(w, http.StatusNotFound, "access_point_not_found")
		return nil, false
	}
	return r, true
}

// fenceAccountQuery pins the ?account_id= selector to the token's account.
//
// The listing handler's default with no account_id is "everything across
// every account the caller belongs to" — correct for a person's own session,
// wrong for a credential bound to one tenant. Rather than trusting the
// handler to notice, this rewrites the request so the wide path is not
// reachable: the parameter is always present and always the token's account
// by the time the handler reads it.
//
// An explicit, matching account_id is fine. An explicit MISMATCHING one is
// refused rather than silently corrected — a caller asking for another
// tenant's inventory should be told no, not handed something else and left
// to believe the other account is empty.
func fenceAccountQuery(_ *Server, w http.ResponseWriter, r *http.Request, tokenAccountID string) (*http.Request, bool) {
	q := r.URL.Query()
	if got := q.Get("account_id"); got != "" && got != tokenAccountID {
		writeErr(w, http.StatusForbidden, "token_account_scope")
		return nil, false
	}
	q.Set("account_id", tokenAccountID)
	r2 := r.Clone(r.Context())
	r2.URL.RawQuery = q.Encode()
	return r2, true
}
