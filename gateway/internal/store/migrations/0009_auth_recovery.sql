-- 0009_auth_recovery.sql
-- Account recovery: password reset + email verification tokens.
--
-- 0001_baseline.sql deliberately deferred `password_reset_tokens` and
-- `email_verification_tokens` ("ported when their routes are ported"). The
-- routes are now ported (POST /v1/auth/{forgot-password,reset-password,
-- verify-email,update-password}), so this is that table — ONE table with a
-- `purpose` discriminator rather than the backend's two, because both flows
-- need byte-identical handling of the only part that matters (issue once,
-- redeem once, expire, invalidate) and two tables would be two places for
-- that handling to drift.
--
-- TOKEN STORAGE — split selector/verifier, salted, hashed. The plaintext
-- token handed to the user is "<selector>.<verifier>":
--
--   selector  128 bits, stored in the CLEAR. It is only a lookup handle; it
--             authorises nothing on its own. Storing it plainly is what lets
--             a redemption find its row by an indexed equality lookup
--             WITHOUT the database having to store a directly-searchable
--             hash of the actual secret.
--   verifier  256 bits, NEVER stored in any form that can be reversed or
--             compared without the presented value. What lands here is
--             hex(SHA-256(domain-sep || salt || verifier)) with a fresh
--             128-bit per-row salt, and the redemption path compares it in
--             constant time (crypto/subtle).
--
-- Why not the plain unsalted SHA-256 that refresh_tokens/account_invites use
-- for their token_hash columns? Those are lookup-by-hash designs: the hash
-- IS the index key, so it cannot be salted. That is an acceptable trade for
-- a 256-bit random refresh token, but the selector/verifier split gets both
-- properties at once (indexed lookup AND a per-row salt), and a
-- password-reset token is the one credential in this system that, on its
-- own, converts into control of an account that opens physical gates. A
-- salt means a stolen database offers no precomputation and no cross-row
-- correlation even if an operator's token entropy source were ever weakened.
--
-- LIFECYCLE COLUMNS, and why there are two of them:
--   consumed_at     the token was REDEEMED. Set exactly once, by a guarded
--                   UPDATE (... WHERE consumed_at IS NULL AND
--                   invalidated_at IS NULL AND expires_at > now) inside the
--                   same transaction that changes the password, so a
--                   double-redeem races to zero rows affected and fails
--                   closed rather than applying twice.
--   invalidated_at  the token was KILLED without being used — superseded by
--                   a newer request for the same user+purpose, or wiped
--                   because the password changed by some other route
--                   (POST /v1/auth/update-password, or a completed reset).
--                   A password change MUST leave no live reset token behind;
--                   otherwise "I changed my password because I think someone
--                   has access" would not actually close the door.
-- Kept distinct rather than collapsed into one nullable timestamp because an
-- operator reading this table forensically needs to tell "the recovery mail
-- was acted on" apart from "the recovery mail was never used" — those two
-- are very different stories after an incident.
--
-- NOT APPEND-ONLY, on purpose: this is not an audit table and carries no
-- hash chain or immutability trigger. It is mutable operational state whose
-- whole job is to be spent. The durable record of who requested and who
-- redeemed a recovery lives in admin_audit_log, which IS hash-chained and
-- append-only (0007), written through store.WriteAdminAudit by every one of
-- the four routes above.

CREATE TABLE auth_recovery_tokens (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose        TEXT NOT NULL CHECK (purpose IN ('password_reset','email_verify')),
    selector       TEXT NOT NULL UNIQUE,
    salt           TEXT NOT NULL,
    verifier_hash  TEXT NOT NULL,
    issued_at      INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    consumed_at    INTEGER,
    invalidated_at INTEGER,
    created_at     INTEGER NOT NULL
);

-- Redemption looks up by (selector, purpose): a token minted for email
-- verification must never be redeemable at the password-reset endpoint, so
-- purpose is part of the lookup key, not a field checked afterwards.
CREATE INDEX auth_recovery_tokens_selector_purpose_idx
    ON auth_recovery_tokens (selector, purpose);

-- "Every live token for this user and purpose" — the supersede-on-reissue
-- and invalidate-on-password-change sweeps.
CREATE INDEX auth_recovery_tokens_live_idx
    ON auth_recovery_tokens (user_id, purpose)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;
