package httpapi

// Scoped API tokens, HTTP half: create / list / revoke. The persistence half
// (and the "never wider than its owner, never outliving their access"
// invariant it enforces) is store/tokens.go; the authentication middleware
// that spends a token is tokens_auth.go. This file owns exactly one thing
// neither of those can: TOKEN CONSTRUCTION.
//
// WHY THIS EXISTS. An operator who wants a script or a home-automation box
// to list access points and trigger an open has, today, exactly one option:
// give it a username and password. That credential also opens password
// reset, member management, invite issuance and every other route that
// person can reach, it cannot be scoped, and revoking it means changing the
// human's own password. A scoped token is the narrow alternative.
//
// TOKEN FORMAT — "aqlt_<selector>.<verifier>":
//
//	aqlt_     a fixed, greppable prefix. It is not a security control; it is
//	          there so a leaked token is recognisable in a repository, a log
//	          scanner or a paste, and so tokens_auth.go can tell a token from
//	          a session JWT without trial-parsing either. Never treat it as
//	          proof of anything.
//	selector  16 random bytes (128 bits), base64url. PUBLIC. Stored in the
//	          clear so authentication is an indexed equality lookup. It
//	          authorises NOTHING: store.AuthenticateAPIToken runs no liveness
//	          check and grants no principal until the verifier below has been
//	          proven.
//	verifier  32 random bytes (256 bits), base64url. SECRET. Never stored;
//	          what lands in the row is
//	          hex(SHA-256(domain || salt || 0x00 || verifier)) against a
//	          fresh 128-bit per-row salt, compared with
//	          crypto/subtle.ConstantTimeCompare.
//
// Same split, and for the same reason, as authrecovery.go's recovery tokens
// (read that file's doc comment for the full argument, including why a fast
// salted digest rather than argon2id is correct for a 256-bit random secret).
//
// WHERE THE PLAINTEXT IS ALLOWED TO EXIST: in the return value of
// crypto/rand, and in the body of the 201 response to POST
// /v1/accounts/{id}/api-tokens. That is the entire list. Not in the list
// response — store.APITokensByAccount's SQL does not even select the columns
// it would need. Not in a log line, not in an error string, not in an audit
// detail, not in the revoke response. There is no "show token again"
// endpoint and there cannot be one: the plaintext is unrecoverable from the
// database by construction, so an operator who loses it revokes and reissues.
// If you add a debug print here, you have written a gate-opening primitive.
//
// EXPIRY IS THE DEFAULT; IMMORTALITY IS A CHOICE. Omitting expires_in_days
// yields defaultTokenTTLDays, not a token that lives forever. A token with
// no expiry requires never_expires: true — an explicit, auditable act — and
// the two fields are mutually exclusive so nobody sets an expiry and gets
// eternity by precedence.

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/vul-os/aql/gateway/internal/store"
)

const (
	// apiTokenPrefix marks the credential as an API token on the wire. See
	// the format note above: a label, never a control.
	apiTokenPrefix = "aqlt_"

	apiTokenSelectorBytes = 16 // 128 bits, public lookup handle
	apiTokenVerifierBytes = 32 // 256 bits, the secret
	apiTokenSaltBytes     = 16 // 128 bits, per-row

	// apiTokenHashDomain separates these digests from every other SHA-256 in
	// this codebase (recovery verifiers, refresh/invite hashes, the audit
	// chain), so no digest computed for one purpose can ever be replayed as
	// a valid value for another.
	apiTokenHashDomain = "aql/api-token/v1/"

	// defaultTokenTTLDays applies when the caller specifies neither an
	// expiry nor never_expires. Ninety days is short enough that a forgotten
	// credential dies on its own and long enough not to be a nuisance.
	defaultTokenTTLDays = 90
	// maxTokenTTLDays bounds an explicit expiry. Beyond this, the honest
	// request is never_expires, which is visible in the listing forever.
	maxTokenTTLDays = 3650

	maxTokenNameLen     = 120
	maxTokensPerAccount = 100
)

// mintedAPIToken is a freshly generated token in both of its forms: the
// plaintext to hand out exactly once, and the three columns to store.
type mintedAPIToken struct {
	plain        string // "aqlt_<selector>.<verifier>" — never persisted, never logged
	selector     string
	salt         string
	verifierHash string
}

// mintAPIToken generates a token. Both halves and the salt come from
// crypto/rand; an error is fatal to the request (fail closed — never fall
// back to a weaker source, never reuse a salt).
func mintAPIToken() (mintedAPIToken, error) {
	sel, err := randB64(apiTokenSelectorBytes)
	if err != nil {
		return mintedAPIToken{}, err
	}
	ver, err := randB64(apiTokenVerifierBytes)
	if err != nil {
		return mintedAPIToken{}, err
	}
	saltRaw := make([]byte, apiTokenSaltBytes)
	if _, err := rand.Read(saltRaw); err != nil {
		return mintedAPIToken{}, err
	}
	salt := hex.EncodeToString(saltRaw)
	return mintedAPIToken{
		plain:        apiTokenPrefix + sel + "." + ver,
		selector:     sel,
		salt:         salt,
		verifierHash: apiTokenVerifierHash(salt, ver),
	}, nil
}

// apiTokenVerifierHash is the one derivation both issuance and
// authentication use.
func apiTokenVerifierHash(salt, verifier string) string {
	h := sha256.New()
	h.Write([]byte(apiTokenHashDomain))
	h.Write([]byte(salt))
	h.Write([]byte{0})
	h.Write([]byte(verifier))
	return hex.EncodeToString(h.Sum(nil))
}

// splitAPIToken splits "aqlt_<selector>.<verifier>". A token with the wrong
// prefix, no separator, an empty half or extra dots is rejected here rather
// than guessed at.
func splitAPIToken(tok string) (selector, verifier string, ok bool) {
	rest, found := strings.CutPrefix(strings.TrimSpace(tok), apiTokenPrefix)
	if !found {
		return "", "", false
	}
	sel, ver, found := strings.Cut(rest, ".")
	if !found || sel == "" || ver == "" || strings.Contains(ver, ".") {
		return "", "", false
	}
	return sel, ver, true
}

// dummyAPITokenSalt/Hash keep authentication timing flat for an unknown
// selector: tokens_auth.go burns one digest+compare against these before
// answering, so "no such token" and "wrong secret" cost the same. Same
// technique handleLogin uses with dummyHash.
var (
	dummyAPITokenSalt = hex.EncodeToString(make([]byte, apiTokenSaltBytes))
	dummyAPITokenHash = apiTokenVerifierHash(dummyAPITokenSalt, "never-a-real-verifier")
)

// verifyAPIToken is the constant-time comparison. It is the function handed
// to store.AuthenticateAPIToken as its `verify` callback, which is why the
// store package never sees a plaintext verifier.
//
// subtle.ConstantTimeCompare returns 0 for unequal lengths without looking
// at the contents; both operands here are fixed-width hex digests, so that
// path only fires on corrupt data, and it fires as a denial.
func verifyAPIToken(verifier, salt, want string) bool {
	got := apiTokenVerifierHash(salt, verifier)
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// ---------------------------------------------------------------------------
// JSON shapes
// ---------------------------------------------------------------------------

// apiTokenJSON is the ONLY rendering of a token, used by create, list and
// revoke alike. There is deliberately no field here for the secret: the
// create handler adds "token" to its own response map after calling this, so
// the plaintext appears in exactly one code path and cannot leak into the
// other two by someone extending a shared shape.
func apiTokenJSON(t store.APIToken) map[string]any {
	scopes := make([]string, 0, len(t.Scopes))
	for _, s := range t.Scopes {
		scopes = append(scopes, string(s))
	}
	return map[string]any{
		"id":            t.ID,
		"account_id":    t.AccountID,
		"user_id":       t.UserID,
		"username":      nilIfEmpty(t.Username),
		"name":          t.Name,
		"scopes":        scopes,
		"created_at":    t.CreatedAt,
		"expires_at":    nullInt64(t.ExpiresAt),
		"never_expires": !t.ExpiresAt.Valid,
		"revoked_at":    nullInt64(t.RevokedAt),
		"revoked_by":    nilIfEmpty(t.RevokedBy),
		"last_used_at":  nullInt64(t.LastUsedAt),
		"live":          t.Live(time.Now().Unix()),
	}
}

type apiTokenCreateReq struct {
	Name          string   `json:"name"`
	Scopes        []string `json:"scopes"`
	ExpiresInDays *int     `json:"expires_in_days"`
	NeverExpires  bool     `json:"never_expires"`
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /v1/accounts/{id}/api-tokens — issue a token for the caller, on this
// account, with the requested scopes.
//
// AUTHORITY: active membership, nothing more. A token cannot be wider than
// its holder, and store.AuthenticateAPIToken re-derives the holder's role on
// every request, so letting a plain member mint one grants them nothing they
// did not already have — it only lets them hand a NARROWER version of
// themselves to a script. Requiring admin here would not add security; it
// would push members back to sharing passwords, which is strictly worse.
//
// A token is always issued to the CALLER. There is no "issue on behalf of"
// parameter, because that would be a way for an admin to mint a credential
// that acts as someone else and is attributed to them in the audit trail.
func (s *Server) handleAPITokenCreate(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	accountID := r.PathValue("id")

	var req apiTokenCreateReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > maxTokenNameLen {
		writeErr(w, http.StatusBadRequest, "invalid_token_name")
		return
	}

	// Scopes: at least one, all known, deduplicated. An unknown scope is a
	// hard 400 rather than a silent drop — a caller who asked for a
	// capability this build does not implement must not walk away believing
	// they got it.
	if len(req.Scopes) == 0 || len(req.Scopes) > len(store.APITokenScopes) {
		writeErr(w, http.StatusBadRequest, "invalid_scopes")
		return
	}
	seen := map[string]bool{}
	scopes := make([]store.APITokenScope, 0, len(req.Scopes))
	for _, sc := range req.Scopes {
		if !store.ValidAPITokenScope(sc) || seen[sc] {
			writeErr(w, http.StatusBadRequest, "invalid_scopes")
			return
		}
		seen[sc] = true
		scopes = append(scopes, store.APITokenScope(sc))
	}

	// Expiry: bounded by default, immortal only on request, and never both.
	if req.NeverExpires && req.ExpiresInDays != nil {
		writeErr(w, http.StatusBadRequest, "conflicting_expiry")
		return
	}
	var expiresAt *int64
	if !req.NeverExpires {
		days := defaultTokenTTLDays
		if req.ExpiresInDays != nil {
			days = *req.ExpiresInDays
		}
		if days < 1 || days > maxTokenTTLDays {
			writeErr(w, http.StatusBadRequest, "invalid_expiry")
			return
		}
		exp := time.Now().Add(time.Duration(days) * 24 * time.Hour).Unix()
		expiresAt = &exp
	}

	// Membership gate: non-members get 404, indistinguishable from a
	// missing account (memberRole's convention).
	if _, ok := s.memberRole(w, r, accountID); !ok {
		return
	}

	// Bound on how many credentials one account can have outstanding. Not a
	// quota — a blast-radius limit, so a compromised session cannot quietly
	// mint an unbounded number of independently-revocable back doors.
	existing, err := s.store.APITokensByAccount(r.Context(), accountID, "")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if len(existing) >= maxTokensPerAccount {
		writeErr(w, http.StatusConflict, "too_many_tokens")
		return
	}

	minted, err := mintAPIToken()
	if err != nil {
		s.log.Error("api token mint failed", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	tok, err := s.store.CreateAPIToken(r.Context(), store.CreateAPITokenArgs{
		AccountID: accountID, UserID: c.Sub, Name: req.Name,
		Selector: minted.selector, Salt: minted.salt, VerifierHash: minted.verifierHash,
		ExpiresAt: expiresAt, Scopes: scopes,
	})
	if err != nil {
		s.log.Error("api token create failed", "account_id", accountID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}

	// Durable trail, through the existing hash-chained choke point. The
	// detail names WHAT was granted and for how long; it must never name the
	// credential itself, and it does not.
	scopeStrs := make([]string, 0, len(scopes))
	for _, sc := range scopes {
		scopeStrs = append(scopeStrs, string(sc))
	}
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "api_token_create", "api_token", tok.ID, true,
		map[string]any{
			"account_id": accountID, "name": tok.Name, "scopes": scopeStrs,
			"expires_at": nullInt64(tok.ExpiresAt), "never_expires": expiresAt == nil,
		}); err != nil {
		s.log.Error("api token create audit write failed", "token_id", tok.ID, "err", err)
	}

	// The ONE moment the plaintext is visible. There is no second one.
	body := apiTokenJSON(*tok)
	body["token"] = minted.plain
	body["token_shown_once"] = true
	writeJSON(w, http.StatusCreated, body)
}

// GET /v1/accounts/{id}/api-tokens — list.
//
// An account admin sees every token on the account (they need to, to revoke
// a departed colleague's). A plain member sees only their own: enumerating
// which other credentials exist, when they were last used and what they can
// do is reconnaissance a member has no need for.
//
// No response from here can contain a plaintext token; the store's listing
// query does not select the columns that would make that possible.
func (s *Server) handleAPITokensList(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	accountID := r.PathValue("id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	owner := c.Sub
	if isAdminRole(role) {
		owner = ""
	}
	toks, err := s.store.APITokensByAccount(r.Context(), accountID, owner)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	list := make([]map[string]any, 0, len(toks))
	for _, t := range toks {
		list = append(list, apiTokenJSON(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"api_tokens": list})
}

// POST /v1/accounts/{id}/api-tokens/{token_id}/revoke — immediate.
//
// Owner or account admin. A member may always kill their own token (the
// "I pasted it into a public repo" path must never require finding an
// admin); an admin may kill any token on the account (the "that contractor
// left" path). Everything else is a 404 — a non-member, or a member probing
// for a token id, learns nothing about whether it exists.
func (s *Server) handleAPITokenRevoke(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	accountID := r.PathValue("id")
	tokenID := r.PathValue("token_id")
	role, ok := s.memberRole(w, r, accountID)
	if !ok {
		return
	}
	tok, err := s.store.APITokenByID(r.Context(), accountID, tokenID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "api_token_not_found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if tok.UserID != c.Sub && !isAdminRole(role) {
		// Same 404 a missing token gets: a plain member must not be able to
		// probe for the existence of a colleague's credential.
		writeErr(w, http.StatusNotFound, "api_token_not_found")
		return
	}
	revoked, err := s.store.RevokeAPIToken(r.Context(), accountID, tokenID, c.Sub)
	if errors.Is(err, store.ErrNotFound) {
		// Already revoked. Not an error worth distinguishing from missing.
		writeErr(w, http.StatusNotFound, "api_token_not_revocable")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := s.store.WriteAdminAudit(r.Context(), c.Sub, "api_token_revoke", "api_token", revoked.ID, true,
		map[string]any{"account_id": accountID, "name": revoked.Name, "owner_user_id": revoked.UserID}); err != nil {
		s.log.Error("api token revoke audit write failed", "token_id", revoked.ID, "err", err)
	}
	writeJSON(w, http.StatusOK, apiTokenJSON(*revoked))
}
