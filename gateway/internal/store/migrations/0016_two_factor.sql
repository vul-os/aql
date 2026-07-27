-- 0016_two_factor.sql
-- Two-factor authentication (TOTP, RFC 6238) for console login, plus the
-- single-use recovery codes that are its escape hatch.
--
-- CREATE ONLY. No ALTER, no DROP, no DELETE — the house rule every other
-- migration in this directory satisfies.
--
-- ============================================================================
-- WHY THIS SCHEMA LOOKS DIFFERENT FROM EVERY OTHER CREDENTIAL TABLE HERE
-- ============================================================================
-- 0009_auth_recovery.sql and 0012_api_tokens.sql both store a SALTED DIGEST
-- of the secret and nothing else, because verification there means "hash what
-- the caller presented and compare". A TOTP shared secret cannot work that
-- way: the server must recompute HMAC-SHA1(secret, counter) itself on every
-- verification, so it must hold the secret in a RECOVERABLE form. There is no
-- clever hashing that changes this — it is a property of the algorithm.
--
-- So user_totp.secret is the same class of value as a webhook signing key
-- (0013_webhooks.sql), NOT the same class as a password hash, and it gets the
-- webhook key's discipline rather than the password's:
--
--   * it is selected by exactly ONE query in store/twofactor.go
--     (LiveTOTPFactor), used only to verify a presented code;
--   * the status/listing read path (TOTPStatus) does not select the column at
--     all, so no projection that reaches a response body can carry it;
--   * it is emitted to a client in exactly one place — the 201 body of
--     POST /v1/auth/2fa/enroll, as the base32 secret and the otpauth:// URI
--     the authenticator app scans — and never again;
--   * it is never logged, never in an audit detail, never in an error string.
--
-- Anyone who can read this table can mint valid codes for every enrolled
-- user. That is inherent to TOTP and is stated plainly rather than implied:
-- 2FA here defends against a stolen PASSWORD, not against a stolen database
-- file. The database file is already the thing that must not be stolen.
--
-- ============================================================================
-- ENROLMENT IS TWO-PHASE, AND THAT IS A SAFETY PROPERTY, NOT CEREMONY
-- ============================================================================
-- activated_at NULL means "enrolled, unproven". A pending row gates NOTHING:
-- login ignores it entirely. Only after the user proves possession by
-- submitting a code that verifies (POST /v1/auth/2fa/activate) does
-- activated_at get set, and only then does login start demanding a second
-- factor.
--
-- The alternative — a secret that gates login the moment it is generated —
-- locks a user out of the hub that opens their own gates if the QR scan
-- failed, if they scanned it into an app on a phone with a wrong clock, or if
-- they simply closed the tab. Enrol, prove, THEN activate.
--
-- ============================================================================
-- REPLAY: last_step
-- ============================================================================
-- A TOTP code is valid for a whole time step (30 s) plus the accepted skew, so
-- an attacker who observes one — shoulder-surfing, a phishing proxy, a
-- keylogger with a slow exfil path — has a usable window unless the server
-- remembers. last_step is the highest counter this factor has ever spent.
-- Every claim is a guarded UPDATE requiring the new step to be strictly
-- greater, so a replayed code affects zero rows and the login it was going to
-- authorise is refused. One integer per user; no separate table, no sweep.
--
-- It is deliberately monotonic rather than a set of recently-seen steps: a
-- code from an EARLIER step inside the skew window is refused too, which is
-- the correct outcome and cheaper to reason about than a sliding set.
--
-- ============================================================================
-- ONE LIVE FACTOR PER USER, ENFORCED BY THE DATABASE
-- ============================================================================
-- user_totp_live_idx is a PARTIAL UNIQUE index over (user_id) WHERE
-- disabled_at IS NULL. Two live factors for one user would mean two secrets
-- that both open the account, one of which the user may not know about — the
-- exact shape of a persistence backdoor. The database refuses to hold that
-- state; it is not left to application discipline.
--
-- disabled_at is how a factor ends. There is no DELETE: the row stays as
-- evidence that 2FA was once on and when it came off, and re-enrolment
-- inserts a fresh row rather than resurrecting an old secret.
--
-- ============================================================================
-- RECOVERY CODES — THE OPPOSITE TREATMENT FROM THE SECRET, ON PURPOSE
-- ============================================================================
-- A recovery code is presented verbatim by the holder and compared, so it CAN
-- be hashed, so it MUST be: hex(SHA-256(domain || salt || 0x00 || code)) over
-- a fresh 128-bit per-row salt, compared with crypto/subtle.ConstantTimeCompare.
-- Same construction as 0012_api_tokens.sql's verifier_hash, and for the same
-- reason a fast salted digest rather than argon2id is right there: each code
-- is 80 bits of crypto/rand (16 characters of a 32-symbol alphabet), so there
-- is no dictionary to run and no feasible offline search — the salt is there
-- to deny precomputation and cross-row correlation from a stolen database.
--
-- SINGLE USE is consumed_at, claimed by a guarded UPDATE inside the same
-- transaction as the thing it authorises (the refresh-token insert for a
-- login, or the disable for a teardown) — authrecovery.go's discipline,
-- reused rather than re-derived. There is no path that checks a code and then
-- acts on it in a second statement.
--
-- Codes are minted at ACTIVATION, not at enrolment: a pending factor that
-- never gets proven must not leave live gate-opening credentials behind.
--
-- totp_id ties a batch to one factor. Because every claim joins back to a
-- LIVE, ACTIVATED user_totp row, disabling a factor kills its whole batch
-- structurally — no sweep to remember to run, no orphaned code that still
-- works after 2FA was turned off and on again.
--
-- ============================================================================
-- NOT APPEND-ONLY, on purpose, exactly like auth_recovery_tokens and
-- api_tokens: this is mutable operational state, not an audit record. The
-- durable trail of enrolment, activation, disablement and second-factor
-- failure lives in admin_audit_log, which IS hash-chained and append-only
-- (0007) and is only ever written through store.WriteAdminAudit.

CREATE TABLE user_totp (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The shared secret, base32 (RFC 4648, no padding), 20 random bytes /
    -- 160 bits — RFC 4226 §4 R6's recommended length for an HMAC-SHA1 key.
    -- RECOVERABLE BY NECESSITY. Read this file's header before touching it.
    secret       TEXT NOT NULL,
    -- Per-row so the parameters a user's authenticator was provisioned with
    -- survive any future change of the defaults, without an ALTER and without
    -- silently invalidating everyone's existing enrolment.
    digits       INTEGER NOT NULL,
    period_s     INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    -- NULL = enrolled but unproven. A NULL here gates nothing; see the
    -- two-phase note above.
    activated_at INTEGER,
    -- NULL = live. Set by POST /v1/auth/2fa/disable, which requires a current
    -- code or a recovery code to reach.
    disabled_at  INTEGER,
    -- Highest RFC 6238 counter ever spent by this factor. NULL = none yet.
    last_step    INTEGER
);

-- At most one live (pending OR active) factor per user. See the header.
CREATE UNIQUE INDEX user_totp_live_idx ON user_totp (user_id) WHERE disabled_at IS NULL;

-- "Every factor this user has ever had", for the audit/forensic read.
CREATE INDEX user_totp_user_idx ON user_totp (user_id, created_at DESC);

CREATE TABLE user_totp_recovery_codes (
    id          TEXT PRIMARY KEY,
    totp_id     TEXT NOT NULL REFERENCES user_totp(id) ON DELETE CASCADE,
    -- Denormalised from user_totp so every guarded claim can scope by user_id
    -- directly, without trusting a join to carry the tenancy check.
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    salt        TEXT NOT NULL,
    code_hash   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    -- NULL = unspent. Set by the guarded single-use claim.
    consumed_at INTEGER
);

-- The verification read path: "every unspent code for this factor".
CREATE INDEX user_totp_recovery_codes_factor_idx ON user_totp_recovery_codes (totp_id, consumed_at);
