package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/aql/hub/internal/store"
)

// Auth endpoints — the skeleton subset of backend/src/routes/auth.ts. Real
// argon2id hashing and real token issuance; the ceremony around them
// (username verification, password reset, Google OAuth, invites) is deferred.

const (
	accessTTL  = 15 * time.Minute
	refreshTTL = 30 * 24 * time.Hour
)

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

type registerReq struct {
	Username     string `json:"username"`
	Password     string `json:"password"`
	DisplayName  string `json:"display_name"`
	LocationName string `json:"location_name"`
	CountryCode  string `json:"country_code"`
}

// POST /v1/auth/register — create user + profile + personal account with one
// anchor location (invite_token path deferred with account_invites).
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "register_ip", s.cfg.AuthRateLimits.RegisterIPPerWindow) {
		return
	}
	var req registerReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if !validUsername(req.Username) {
		writeErr(w, http.StatusBadRequest, "invalid_username")
		return
	}
	if len(req.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password")
		return
	}
	if strings.TrimSpace(req.LocationName) == "" {
		writeErr(w, http.StatusBadRequest, "location_required")
		return
	}
	hash, err := HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	u, err := s.store.CreateUser(r.Context(), req.Username, hash, req.DisplayName, req.CountryCode)
	if errors.Is(err, store.ErrUsernameTaken) {
		writeErr(w, http.StatusConflict, "username_taken")
		return
	}
	if err != nil {
		s.log.Error("register", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	acct, loc, err := s.store.CreateAccountWithOwner(r.Context(), u.ID, req.LocationName, req.CountryCode)
	if err != nil {
		s.log.Error("register account", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	tokens, ok := s.issueTokensCtx(w, r, u)
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":       map[string]any{"id": u.ID, "username": u.Username},
		"account":    map[string]any{"id": acct.ID, "name": acct.Name},
		"location":   map[string]any{"id": loc.ID, "name": loc.Name, "slug": loc.Slug},
		"tokens":     tokens,
		"token_type": "Bearer",
	})
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	// Second factor, when the account has one (twofactor.go). Embedded
	// rather than exchanged for an intermediate challenge token: the
	// password is presented again alongside the code, so there is no
	// short-lived half-authenticated credential to steal or replay. A
	// client that omits these gets 401 totp_required and retries with both.
	twoFactorInput
}

// POST /v1/auth/login
//
// Brute-force protection (security assessment finding — this endpoint had
// NONE): a per-IP throttle (the HARD limit — every attempt counts, see
// authIPGate) runs first, then a per-ACCOUNT soft-lockout check keyed on
// the username — see store/authratelimit.go's package doc comment for why the
// account-level check only ever counts FAILURES and is bounded to one
// fixed window, specifically so an attacker can't cheaply lock a VICTIM
// out by deliberately failing their login from elsewhere.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "login_ip", s.cfg.AuthRateLimits.LoginIPPerWindow) {
		return
	}
	var req loginReq
	if !readJSON(w, r, &req) {
		return
	}
	nowUnix := time.Now().Unix()
	username := strings.ToLower(strings.TrimSpace(req.Username))
	acctSubject := "username:" + username

	if username != "" {
		over, retry, err := s.store.AuthAttemptsOverCap(r.Context(), "login_acct", acctSubject,
			s.cfg.AuthRateLimits.LoginAccountPerWindow, nowUnix)
		if err != nil {
			s.log.Error("login account rate limit check failed", "err", err)
			writeErr(w, http.StatusServiceUnavailable, "rate_limit_unavailable")
			return
		}
		if over {
			w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
			writeErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
	}

	u, err := s.store.UserByUsername(r.Context(), req.Username)
	if err != nil {
		// Burn a verify anyway so user-not-found and bad-password take
		// comparable time (no account enumeration by timing) — unchanged.
		VerifyPassword(req.Password, dummyHash)
		if username != "" {
			if ferr := s.store.RecordAuthFailure(r.Context(), "login_acct", acctSubject, nowUnix); ferr != nil {
				s.log.Error("record auth failure", "err", ferr)
			}
		}
		writeErr(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	if u.Status != "active" || u.PasswordHash == "" || !VerifyPassword(req.Password, u.PasswordHash) {
		if ferr := s.store.RecordAuthFailure(r.Context(), "login_acct", acctSubject, nowUnix); ferr != nil {
			s.log.Error("record auth failure", "err", ferr)
		}
		writeErr(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	// Second factor (twofactor.go). Returns (nil, true) — proceed with no
	// claim — for a user with no ACTIVE TOTP factor, which is what keeps this
	// path byte-for-byte unchanged for everyone who has not enrolled. When a
	// factor IS active, the claim is spent inside the same transaction as the
	// refresh-token insert below, never as a separate step.
	claim, ok := s.secondFactorGate(w, r, u, req.twoFactorInput)
	if !ok {
		return
	}
	tokens, ok := s.issueTokensClaimed(w, r, u, claim)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":       map[string]any{"id": u.ID, "username": u.Username, "is_platform_admin": u.IsPlatformAdmin},
		"tokens":     tokens,
		"token_type": "Bearer",
	})
}

// dummyHash keeps login timing flat when the username doesn't exist.
var dummyHash = func() string {
	h, err := HashPassword("lintel-dummy")
	if err != nil {
		panic(err)
	}
	return h
}()

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

// POST /v1/auth/refresh — rotate the refresh token; a replayed (already
// rotated/revoked) token revokes its whole family (reuse detection, per the
// backend's family model).
func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if !s.authIPGate(w, r, "refresh_ip", s.cfg.AuthRateLimits.RefreshIPPerWindow) {
		return
	}
	var req refreshReq
	if !readJSON(w, r, &req) {
		return
	}
	rt, err := s.store.RefreshTokenByHash(r.Context(), hashToken(req.RefreshToken))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_refresh_token")
		return
	}
	if rt.RevokedAt.Valid || rt.ReplacedBy.Valid {
		// Reuse of a rotated token: kill the family.
		_ = s.store.RevokeRefreshFamily(r.Context(), rt.FamilyID)
		writeErr(w, http.StatusUnauthorized, "refresh_token_reused")
		return
	}
	if time.Now().Unix() >= rt.ExpiresAt {
		writeErr(w, http.StatusUnauthorized, "refresh_token_expired")
		return
	}
	u, err := s.store.UserByID(r.Context(), rt.UserID)
	if err != nil || u.Status != "active" {
		writeErr(w, http.StatusUnauthorized, "invalid_refresh_token")
		return
	}
	newPlain := randomToken()
	newID := store.NewID()
	if err := s.store.RotateRefreshToken(r.Context(), rt.ID, newID, rt.FamilyID, u.ID,
		hashToken(newPlain), time.Now().Add(refreshTTL).Unix()); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	access, err := SignJWT(s.cfg.JWTSecret, u.ID, u.Username, u.IsPlatformAdmin, accessTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tokens":     map[string]any{"access_token": access, "refresh_token": newPlain},
		"token_type": "Bearer",
	})
}

// POST /v1/auth/logout — revoke the presented refresh token's family.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if !readJSON(w, r, &req) {
		return
	}
	if rt, err := s.store.RefreshTokenByHash(r.Context(), hashToken(req.RefreshToken)); err == nil {
		_ = s.store.RevokeRefreshFamily(r.Context(), rt.FamilyID)
	}
	// Idempotent: unknown tokens still get 200 (nothing to enumerate).
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// POST /v1/auth/logout-all — revoke EVERY refresh-token family for the
// caller, not just the one the presented token belongs to (contrast
// handleLogout, above). The "stolen phone" answer: end every session on
// every device without needing to know which one leaked. Requires a live
// access token — see store.RevokeAllRefreshTokensForUser's doc comment for
// the honest bound on what this does and does not invalidate immediately.
func (s *Server) handleLogoutAll(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if err := s.store.RevokeAllRefreshTokensForUser(r.Context(), c.Sub); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /v1/auth/me
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	u, err := s.store.UserByID(r.Context(), c.Sub)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	accounts, err := s.store.AccountsForUser(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	list := make([]map[string]any, 0, len(accounts))
	for _, a := range accounts {
		list = append(list, map[string]any{"id": a.ID, "name": a.Name, "role": a.Role})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":     map[string]any{"id": u.ID, "username": u.Username, "is_platform_admin": u.IsPlatformAdmin},
		"accounts": list,
	})
}

// issueTokensCtx issues access+refresh with the request context, for the
// paths where no second factor can be in play — registration, where the
// account is milliseconds old and cannot have enrolled one.
//
// It delegates to issueTokensClaimed (twofactor.go) with a nil claim rather
// than holding its own copy of the insert, so there is exactly ONE funnel that
// mints a session and no way to add a login path that quietly skips a claim.
func (s *Server) issueTokensCtx(w http.ResponseWriter, r *http.Request, u *store.User) (map[string]any, bool) {
	return s.issueTokensClaimed(w, r, u, nil)
}
