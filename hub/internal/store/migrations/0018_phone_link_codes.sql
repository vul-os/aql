-- Phone link codes (docs/PHONE-LINKING.md § 4.1).
--
-- WHY THIS EXISTS, and why it is not a nice-to-have. Every chat-rail lookup
-- in channels.go requires `verified_at IS NOT NULL` on profile_phone_numbers.
-- The only code that ever set that column was store.AddVerifiedPhone, which
-- has no production caller — it is reached from tests and nowhere else.
--
-- That is not an oversight so much as an unfinished repair. Accepting an
-- invite used to auto-verify the invited number, which let an attacker squat
-- a number they did not control; the fix made invite-accept link phones
-- UNVERIFIED (see 0002's unique index comment and invites.go). Correct fix,
-- but it removed the last production path that set verified_at, and the
-- replacement ceremony was designed and never built. invites.go still carries
-- a comment promising "the OTP verify flow flips verified_at" — a flow that
-- does not exist anywhere in this repo.
--
-- Net effect on a real deployment: nobody can ever hold a verified phone, so
-- every inbound WhatsApp/Telegram/Slack message resolves to a non-member and
-- every chat open is refused. The rails are built, tested, documented as
-- shipped — and inert.
--
-- THE CEREMONY. A 6-character code is minted in the console (proving the
-- person holds an authenticated session on that account) and sent to the bot
-- FROM the number being linked (proving control of the number, via the
-- provider's signature on the inbound webhook). Two facts, one act, no SMS
-- and no email — this hub sends neither, on purpose.
--
-- WHY THE HASH IS DETERMINISTIC, unlike 0009 and 0012. Those store a
-- selector alongside a salted verifier, because the credential carries both
-- halves. A link code does not: the inbound chat message contains the code
-- and nothing else, so the code IS the lookup key and the digest has to be
-- reproducible from it alone.
--
-- Be honest about what that buys. Six characters over a 30-character
-- alphabet is ~2^29 — precomputable, so this hash does not defeat an
-- attacker who can read the database. It defeats the narrower and more
-- likely case: a live code sitting in a backup or a log. The real protection
-- is structural and is in the redemption path, not here — a code is bound to
-- ONE phone number, so guessing it gains an attacker nothing unless they
-- already control that number, in which case there is nothing to gain.
--
-- CREATE-only. Nothing here is ALTERed.

CREATE TABLE phone_link_codes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The number this code may verify, and the ONLY number that may redeem
    -- it. Minting a code for someone else's number produces a code that only
    -- their handset can spend, which is why minting needs no proof of
    -- ownership and why an attacker cannot use it to claim a victim's number.
    phone_e164  TEXT NOT NULL,

    code_hash   TEXT NOT NULL UNIQUE,

    issued_at   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,

    -- Bounded guessing. Cheap to keep, and it caps the one case the phone
    -- binding does not already make pointless: an attacker spending guesses
    -- against a code minted for a number they DO control.
    attempts    INTEGER NOT NULL DEFAULT 0,

    -- Single-use. Set on successful redemption; a consumed code is dead even
    -- before it expires.
    consumed_at INTEGER
);

CREATE INDEX phone_link_codes_user_idx    ON phone_link_codes (user_id, issued_at);
CREATE INDEX phone_link_codes_phone_idx   ON phone_link_codes (phone_e164, expires_at);
CREATE INDEX phone_link_codes_expiry_idx  ON phone_link_codes (expires_at);
