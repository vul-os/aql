-- 0012_api_tokens.sql
-- Scoped API tokens: the credential an operator hands to a script or a
-- home-automation box so it can list access points and trigger an open
-- WITHOUT being handed a password (which would also hand over password
-- reset, member management, and every other route the person can reach).
--
-- CREATE ONLY. No ALTER, no DROP, no DELETE — the house rule every other
-- migration in this directory now satisfies.
--
-- ============================================================================
-- WHAT A TOKEN IS, STATED PLAINLY
-- ============================================================================
-- A bearer credential that can open a physical gate. Whoever holds the
-- plaintext IS the credential: there is no second factor, no device binding,
-- no challenge. Every column choice below follows from that one sentence.
--
-- TOKEN STORAGE — split selector/verifier, salted, hashed. Identical in
-- shape to 0009_auth_recovery.sql's reasoning, and deliberately so: this is
-- the second credential in the system that converts, on its own, into
-- physical access, so it gets the same treatment rather than the weaker
-- unsalted lookup-by-hash that refresh_tokens/account_invites use.
--
--   selector       16 random bytes, base64url, stored in the CLEAR. A lookup
--                  handle only; it authorises nothing. Storing it plainly is
--                  what makes authentication an indexed equality lookup
--                  without the database holding a directly-searchable digest
--                  of the actual secret.
--   verifier_hash  hex(SHA-256(domain || salt || 0x00 || verifier)) over a
--                  32-byte (256-bit) secret and a fresh 128-bit per-row salt.
--                  Compared with crypto/subtle.ConstantTimeCompare. The
--                  plaintext verifier exists in exactly two places for
--                  exactly one moment: the output of crypto/rand, and the
--                  201 response body of the create call. It is never stored,
--                  never logged, never re-derivable, and never returned
--                  again — see httpapi/tokens.go.
--
-- The salt is not there to slow a dictionary attack (a 256-bit random
-- verifier has no dictionary). It is there so a stolen database file offers
-- no precomputation and no cross-row correlation.
--
-- ============================================================================
-- WHY account_id AND user_id ARE BOTH NOT NULL
-- ============================================================================
-- user_id    the ISSUER, and permanently the principal the token acts as. A
--            token is not an independent identity — it is a narrower way for
--            one specific person to act. Authentication re-derives that
--            person's LIVE membership and role on every single request (see
--            store/tokens.go AuthenticateAPIToken), so a token can never
--            outlive, or exceed, its owner's own access. Removing someone
--            from an account kills their tokens on that account instantly,
--            with no sweep and nothing to remember to run.
-- account_id the single tenant the token may touch. Bounding a token to one
--            account is the difference between "this doorbell box can open
--            the gate at my house" and "this doorbell box can open every
--            gate at every site I happen to be a member of". The fence is
--            enforced per-request in httpapi/tokens_auth.go, at route
--            registration, before any handler runs.
--
-- ON DELETE CASCADE on both: a deleted account or user must not leave live
-- credentials behind pointing at nothing.
--
-- ============================================================================
-- LIFECYCLE
-- ============================================================================
--   expires_at   NULLABLE, and NULL means "never expires". That is a
--                deliberate, explicit choice the API forces the caller to
--                make (never_expires: true) rather than a default anyone can
--                fall into: an unattended, never-expiring gate credential is
--                exactly the thing that is still live in a git history three
--                years later. Omitting the field yields a bounded default
--                TTL, not an immortal token.
--   revoked_at   set by the guarded UPDATE in RevokeAPIToken. Revocation is
--                IMMEDIATE, not eventually-consistent, because there is no
--                cached authorisation anywhere: every request re-reads this
--                row. This is the same discipline requireAuth already
--                applies to sessions (live users-row re-read per request),
--                reused rather than reinvented.
--   revoked_by   who killed it. An account admin may revoke a member's
--                token; forensically "who" matters as much as "when".
--   last_used_at best-effort liveness for the operator ("this token has not
--                been touched in eight months — why does it still exist?").
--                Written on successful authentication only.
--
-- NOT APPEND-ONLY, on purpose, exactly like auth_recovery_tokens: this is
-- mutable operational state, not an audit record. The durable trail of
-- issuance, revocation and USE lives in admin_audit_log, which IS
-- hash-chained and append-only (0007) and is only ever written through
-- store.WriteAdminAudit.

CREATE TABLE api_tokens (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Operator-facing label ("gate-bot", "home-assistant"). Never secret.
    name          TEXT NOT NULL,
    selector      TEXT NOT NULL UNIQUE,
    salt          TEXT NOT NULL,
    verifier_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    -- NULL = never expires. See the lifecycle note above: reaching NULL
    -- requires an explicit request flag, it is not the default.
    expires_at    INTEGER,
    revoked_at    INTEGER,
    revoked_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_used_at  INTEGER
);

-- The listing read path: "every token on this account, newest first".
CREATE INDEX api_tokens_account_idx ON api_tokens (account_id, created_at DESC);

-- "Every token this person issued" — the sweep an operator wants when a
-- member leaves. (Authentication does not need it: membership is re-checked
-- live per request, so a departed member's tokens are already dead.)
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

-- ============================================================================
-- SCOPES — a separate table, not a column, and that is the security property
-- ============================================================================
-- A scope grant is a ROW. A read-only token has no row granting
-- 'access:open', so there is no value in the database that could be
-- misparsed, no substring that could match, and no default that could
-- accidentally widen it. Absence is the denial, and absence cannot be
-- typo'd into presence.
--
-- The CHECK constraint is the second half: an unknown scope string cannot be
-- persisted at all, so the app layer can never end up comparing against a
-- scope the database accepted but no handler understands. New scopes arrive
-- by a new CREATE-only migration and a code change together, or not at all.
--
--   access:read  list and read access points. Cannot actuate anything.
--   access:open  send open/close to a gate. Actuation.
--
-- Both are still bounded by the issuing user's live membership and role —
-- a scope can only ever NARROW what that person could already do, never
-- widen it.
CREATE TABLE api_token_scopes (
    token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
    scope    TEXT NOT NULL CHECK (scope IN ('access:read', 'access:open')),
    PRIMARY KEY (token_id, scope)
);
