package store

// Scoped API tokens — the store half of /v1/accounts/{id}/api-tokens and of
// every request that authenticates with one. See
// migrations/0012_api_tokens.sql for the schema rationale (split
// selector/verifier, per-row salt, scopes-as-rows, the two lifecycle
// columns) and internal/httpapi/tokens.go for the token construction itself.
//
// THE INVARIANT THIS FILE EXISTS TO ENFORCE, stated once: a token grants no
// more than its owner can do RIGHT NOW, and the act of authenticating it is
// inseparable from re-deriving that. AuthenticateAPIToken below is the ONLY
// way a token becomes a principal, and it is a single transaction that
// checks, in one place: the verifier, the token's own liveness (not revoked,
// not expired), the owner's live users-row status, the owner's live ACTIVE
// membership on the token's account, the account's live status, and the
// token's scope rows. There is no path that resolves a token and then checks
// its owner in a second step, because that shape is how a token outlives the
// access it was issued under.
//
// This mirrors store/authrecovery.go's discipline deliberately: one opaque
// error for every failure mode, and the state read in the same transaction
// as the decision that depends on it. It differs in one way — a token is not
// single-use, so there is no claim/consume; the guarded read IS the whole
// check, and it runs again, in full, on every request.
//
// WHAT IS NOT HERE: any method that returns a verifier hash or a salt to a
// caller. The listing query does not select those columns at all — not as a
// matter of discipline, as a matter of the SQL text. The only code that ever
// sees them is the verify callback inside AuthenticateAPIToken, which lives
// for the length of one comparison.

import (
	"context"
	"database/sql"
	"errors"
)

// APITokenScope is one capability grant. The values are closed: the
// api_token_scopes CHECK constraint rejects anything else at the database,
// and ValidAPITokenScope rejects it at the door.
type APITokenScope string

const (
	// ScopeAccessRead lists and reads access points. Structurally incapable
	// of actuation: no route that moves hardware is registered under it.
	ScopeAccessRead APITokenScope = "access:read"
	// ScopeAccessOpen sends open/close to a gate. This is the one that
	// moves physical hardware.
	ScopeAccessOpen APITokenScope = "access:open"
)

// APITokenScopes is the closed set, in canonical order (used for the create
// request's validation and for stable list output).
var APITokenScopes = []APITokenScope{ScopeAccessRead, ScopeAccessOpen}

// ValidAPITokenScope reports whether s names a scope this build understands.
// Fail-closed: anything unrecognised is refused rather than stored and
// ignored, which would leave a row nothing enforces.
func ValidAPITokenScope(s string) bool {
	for _, k := range APITokenScopes {
		if string(k) == s {
			return true
		}
	}
	return false
}

// ErrAPITokenUnusable is the SINGLE error every failed authentication
// returns, whatever the underlying reason: unknown selector, wrong verifier,
// revoked, expired, owner disabled, owner no longer a member, account
// suspended. Callers map it to one opaque client-facing code.
//
// Same reasoning as ErrRecoveryTokenUnusable: telling a caller "expired"
// rather than "unknown" tells them a token once existed on this hub, and
// telling them "not a member" rather than "unknown" tells them whose. An
// attacker holding a leaked-but-revoked token learns nothing about why it
// stopped working, and an attacker holding nothing learns nothing at all.
var ErrAPITokenUnusable = errors.New("api_token_unusable")

// APIToken is one token's PUBLIC record — everything the operator is allowed
// to see after creation. There is no field here that could reconstruct the
// credential, and the query that populates it does not select the columns
// that could.
type APIToken struct {
	ID         string
	AccountID  string
	UserID     string
	Username   string // owner's username, for the listing
	Name       string
	Scopes     []APITokenScope
	CreatedAt  int64
	ExpiresAt  sql.NullInt64 // NULL = never expires (explicit at creation)
	RevokedAt  sql.NullInt64
	RevokedBy  string // "" when live
	LastUsedAt sql.NullInt64
}

// Live reports whether the token would still authenticate at nowUnix on the
// token's OWN state alone. It deliberately says nothing about the owner's
// membership — that is re-derived per request by AuthenticateAPIToken, and
// treating this as the authority would be exactly the check-then-act shape
// this file exists to avoid. For display and tests only.
func (t *APIToken) Live(nowUnix int64) bool {
	if t.RevokedAt.Valid {
		return false
	}
	return !t.ExpiresAt.Valid || t.ExpiresAt.Int64 > nowUnix
}

// APITokenPrincipal is what a successfully authenticated token resolves to:
// a live person, on one account, with a role, holding a set of scopes.
//
// Note what is NOT in here: any platform-admin flag. A token is never a
// route to the instance-admin console — those routes are gated by
// requireAdmin, which is built on requireAuth, which accepts session JWTs
// only. A token presented there fails as "not a JWT" before anything else
// runs.
type APITokenPrincipal struct {
	TokenID   string
	AccountID string
	UserID    string
	Username  string
	// Role is the owner's membership role AS OF THIS REQUEST, not as of
	// issuance. Downstream gates (isAdminRole, the quota exemptions in
	// openpath.go) see the current value, so a demoted owner's token is
	// demoted with them.
	Role   string
	scopes map[APITokenScope]bool
}

// Has reports whether the principal holds scope. Absence of the grant row is
// the denial — there is no default, no wildcard and no superset.
func (p *APITokenPrincipal) Has(scope APITokenScope) bool {
	if p == nil {
		return false
	}
	return p.scopes[scope]
}

// CreateAPITokenArgs is one issuance.
type CreateAPITokenArgs struct {
	AccountID string
	UserID    string
	Name      string
	Selector  string
	Salt      string
	// VerifierHash is the salted digest of the secret half. The plaintext
	// never reaches this package.
	VerifierHash string
	// ExpiresAt is a unix second, or nil for a token that never expires.
	// The handler is responsible for making nil an explicit caller choice —
	// see httpapi/tokens.go.
	ExpiresAt *int64
	Scopes    []APITokenScope
}

// CreateAPIToken writes the token row and its scope rows in ONE transaction.
// Two statements outside a transaction would leave a window in which a token
// exists with no scopes — harmless today (no scopes means nothing is
// permitted, so the failure is closed) but it would make "a token always has
// at least the scopes it was created with" untrue, and the next person to
// rely on that would be wrong.
//
// The caller must have already verified that UserID is an active member of
// AccountID; this method does not re-check, because issuance authority is a
// route-level question and USE authority — the one that matters — is
// re-derived per request by AuthenticateAPIToken regardless of what was true
// here.
func (s *Store) CreateAPIToken(ctx context.Context, args CreateAPITokenArgs) (*APIToken, error) {
	if len(args.Scopes) == 0 {
		// A scopeless token authenticates and then permits nothing. That is
		// a fail-closed outcome, but it is also certainly a caller bug, so
		// refuse it rather than mint a credential that silently does not work.
		return nil, errors.New("api token requires at least one scope")
	}
	for _, sc := range args.Scopes {
		if !ValidAPITokenScope(string(sc)) {
			return nil, errors.New("unknown api token scope")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	id := NewID()
	t := now()
	var expires any
	if args.ExpiresAt != nil {
		expires = *args.ExpiresAt
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO api_tokens
		   (id, account_id, user_id, name, selector, salt, verifier_hash, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, args.AccountID, args.UserID, args.Name, args.Selector, args.Salt,
		args.VerifierHash, t, expires); err != nil {
		return nil, err
	}
	for _, sc := range args.Scopes {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO api_token_scopes (token_id, scope) VALUES (?, ?)`, id, string(sc)); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	out := &APIToken{
		ID: id, AccountID: args.AccountID, UserID: args.UserID, Name: args.Name,
		Scopes: canonicalScopes(args.Scopes), CreatedAt: t,
	}
	if args.ExpiresAt != nil {
		out.ExpiresAt = sql.NullInt64{Int64: *args.ExpiresAt, Valid: true}
	}
	return out, nil
}

func canonicalScopes(in []APITokenScope) []APITokenScope {
	have := map[APITokenScope]bool{}
	for _, s := range in {
		have[s] = true
	}
	out := make([]APITokenScope, 0, len(have))
	for _, s := range APITokenScopes {
		if have[s] {
			out = append(out, s)
		}
	}
	return out
}

// apiTokenSelect is the PUBLIC projection, shared by the list and get paths.
// Note the columns that are absent: selector, salt, verifier_hash. Nothing
// that reads this projection can leak the credential even by accident,
// because the credential is not in the result set.
const apiTokenSelect = `
	SELECT t.id, t.account_id, t.user_id, coalesce(u.username, ''), t.name,
	       t.created_at, t.expires_at, t.revoked_at, coalesce(t.revoked_by, ''), t.last_used_at
	FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id`

func scanAPIToken(sc interface{ Scan(...any) error }) (*APIToken, error) {
	var t APIToken
	if err := sc.Scan(&t.ID, &t.AccountID, &t.UserID, &t.Username, &t.Name,
		&t.CreatedAt, &t.ExpiresAt, &t.RevokedAt, &t.RevokedBy, &t.LastUsedAt); err != nil {
		return nil, err
	}
	return &t, nil
}

// APITokensByAccount lists an account's tokens, newest first, each with its
// scopes. Account-scoped per this package's tenancy rule; the handler gates
// membership first.
//
// ownerUserID != "" narrows the listing to one person's tokens — the shape
// an ordinary member gets, since a member has no business enumerating the
// account's other credentials.
func (s *Store) APITokensByAccount(ctx context.Context, accountID, ownerUserID string) ([]APIToken, error) {
	q := apiTokenSelect + ` WHERE t.account_id = ?`
	argv := []any{accountID}
	if ownerUserID != "" {
		q += ` AND t.user_id = ?`
		argv = append(argv, ownerUserID)
	}
	q += ` ORDER BY t.created_at DESC, t.rowid DESC`

	rows, err := s.db.QueryContext(ctx, q, argv...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		t, err := scanAPIToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		sc, err := s.apiTokenScopes(ctx, s.db, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Scopes = sc
	}
	return out, nil
}

// APITokenByID fetches one token scoped to its account — cross-account ids
// are ErrNotFound, indistinguishable from missing (the tenancy contract).
func (s *Store) APITokenByID(ctx context.Context, accountID, tokenID string) (*APIToken, error) {
	t, err := scanAPIToken(s.db.QueryRowContext(ctx,
		apiTokenSelect+` WHERE t.account_id = ? AND t.id = ?`, accountID, tokenID))
	if err != nil {
		return nil, err
	}
	sc, err := s.apiTokenScopes(ctx, s.db, t.ID)
	if err != nil {
		return nil, err
	}
	t.Scopes = sc
	return t, nil
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func (s *Store) apiTokenScopes(ctx context.Context, q querier, tokenID string) ([]APITokenScope, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT scope FROM api_token_scopes WHERE token_id = ?`, tokenID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var got []APITokenScope
	for rows.Next() {
		var sc string
		if err := rows.Scan(&sc); err != nil {
			return nil, err
		}
		got = append(got, APITokenScope(sc))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return canonicalScopes(got), nil
}

// RevokeAPIToken kills a token with a guarded UPDATE: it only affects a row
// that is in this account and NOT already revoked. Zero rows affected =>
// ErrNotFound, so a double-revoke and a cross-tenant revoke are the same
// (non-)event and neither reports anything an attacker could learn from.
//
// Revocation takes effect on the very next request. Nothing caches a token's
// authorisation — AuthenticateAPIToken re-reads this row every time — so
// there is no window, no TTL to wait out, and no second mechanism to keep in
// sync. That is the same property requireAuth's live users-row re-read gives
// sessions, reused rather than reinvented.
func (s *Store) RevokeAPIToken(ctx context.Context, accountID, tokenID, byUserID string) (*APIToken, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE api_tokens SET revoked_at = ?, revoked_by = ?
		 WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
		now(), nullable(byUserID), tokenID, accountID)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.APITokenByID(ctx, accountID, tokenID)
}

// ---------------------------------------------------------------------------
// Authentication — the one path a token becomes a principal
// ---------------------------------------------------------------------------

// AuthenticateAPIToken resolves a presented selector to a live principal, or
// returns ErrAPITokenUnusable. It is the ONLY function in this package that
// produces an APITokenPrincipal, and everything a token's authority depends
// on is decided inside its single transaction:
//
//  1. the row exists for this selector;
//  2. verify(salt, verifierHash) accepts — the caller supplies this so the
//     digest construction stays in one place (httpapi/tokens.go) and this
//     package never sees the plaintext. verify MUST be constant-time; the
//     one implementation is.
//  3. the token itself is live: revoked_at IS NULL, and expires_at is NULL
//     (explicitly non-expiring) or still in the future;
//  4. the OWNER is live: users.status = 'active';
//  5. the OWNER STILL BELONGS: account_members row for (token account,
//     owner) with status = 'active', and its role is what the principal
//     carries — current role, not issued role;
//  6. the ACCOUNT is live: accounts.status <> 'suspended'. (The open-path
//     choke point checks this too; doing it here as well means a suspended
//     account's tokens cannot even read.)
//
// Steps 4-6 are the "never widen what a person can do, and never outlive
// their access" requirement. They are not a policy applied on top of
// authentication — they are conditions in the authentication query, so
// there is no version of "authenticated" that skipped them.
//
// Order matters for one reason: the verifier is checked BEFORE liveness, so
// a caller who does not hold the secret cannot distinguish "revoked" from
// "never existed" by timing which branch ran. Every one of these failures
// returns the same error either way.
//
// On success it best-effort stamps last_used_at. A failure to stamp does not
// fail the request — liveness telemetry is not an authorisation input.
func (s *Store) AuthenticateAPIToken(ctx context.Context, selector string,
	verify func(salt, verifierHash string) bool, nowUnix int64) (*APITokenPrincipal, error) {

	if selector == "" || verify == nil {
		return nil, ErrAPITokenUnusable
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var tokenID, accountID, userID, salt, verifierHash string
	var expiresAt, revokedAt sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT id, account_id, user_id, salt, verifier_hash, expires_at, revoked_at
		 FROM api_tokens WHERE selector = ?`, selector).
		Scan(&tokenID, &accountID, &userID, &salt, &verifierHash, &expiresAt, &revokedAt)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrAPITokenUnusable
	}
	if err != nil {
		return nil, err
	}

	// (2) Prove possession of the secret first — nothing below this line
	// runs for a caller who only guessed a selector.
	if !verify(salt, verifierHash) {
		return nil, ErrAPITokenUnusable
	}

	// (3) The token's own liveness.
	if revokedAt.Valid {
		return nil, ErrAPITokenUnusable
	}
	if expiresAt.Valid && expiresAt.Int64 <= nowUnix {
		return nil, ErrAPITokenUnusable
	}

	// (4)(5)(6) The owner's LIVE standing, in one join. A token is a
	// narrower way for this person to act; if this row is gone, so is the
	// token's authority, with no sweep required.
	var role, username string
	err = tx.QueryRowContext(ctx,
		`SELECT m.role, u.username
		 FROM account_members m
		 JOIN users u ON u.id = m.user_id
		 JOIN accounts a ON a.id = m.account_id
		 WHERE m.account_id = ? AND m.user_id = ?
		   AND m.status = 'active' AND u.status = 'active' AND a.status <> 'suspended'`,
		accountID, userID).Scan(&role, &username)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrAPITokenUnusable
	}
	if err != nil {
		return nil, err
	}

	scopeRows, err := s.apiTokenScopes(ctx, tx, tokenID)
	if err != nil {
		return nil, err
	}
	scopes := map[APITokenScope]bool{}
	for _, sc := range scopeRows {
		scopes[sc] = true
	}
	if len(scopes) == 0 {
		// Cannot happen through CreateAPIToken, which refuses a scopeless
		// token. If it ever does, deny — an authenticated principal with no
		// capabilities is not a useful thing to hand downstream.
		return nil, ErrAPITokenUnusable
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, nowUnix, tokenID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &APITokenPrincipal{
		TokenID: tokenID, AccountID: accountID, UserID: userID,
		Username: username, Role: role, scopes: scopes,
	}, nil
}
