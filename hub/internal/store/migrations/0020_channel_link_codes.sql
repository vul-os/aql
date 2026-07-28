-- Channel identity link codes — the Telegram/Slack/Discord/DMTAP half of the
-- ceremony that 0018 built for WhatsApp.
--
-- SAME DEFECT, FOUR MORE RAILS. Telegram, Slack, Discord and DMTAP resolve a
-- member through channel_identities (0005). The only writer of that table is
-- store.LinkChannelIdentity, and like AddVerifiedPhone before 0018 it has
-- test callers and no others. So no production deployment can bind a platform
-- account to a profile, every inbound message on those four rails resolves to
-- a non-member, and every open is refused. Built, tested, documented as
-- shipped, inert.
--
-- WHY THIS IS A SEPARATE TABLE, AND A DIFFERENT CODE.
--
-- 0018's security rests on a code being spendable only by the phone number it
-- was minted FOR. That works because the member knows their own number and
-- types it into the console, so the code can be bound to a target in advance,
-- and possession of the number is a second factor the code does not have to
-- carry.
--
-- That is impossible here. Nobody knows their own Telegram numeric user id or
-- Slack member id — discovering it is precisely what the inbound message is
-- for. So a channel code cannot name its target, which means the code ALONE
-- authorises the binding: whoever sends it gets bound.
--
-- The consequence is not cosmetic. A guessed or observed channel code lets a
-- stranger attach THEIR account to someone else's profile and inherit that
-- member's gate access. In the phone flow the equivalent guess is worthless
-- without the handset.
--
-- So the entropy has to live in the code itself. These are 12 characters over
-- a 31-symbol alphabet (~2^59) rather than 0018's 6 (~2^29), which is the
-- whole difference between "short because possession is the second factor"
-- and "long because there is no second factor". Six characters here would be
-- guessable inside the ten-minute window by anyone willing to spend messages.
--
-- Everything else matches 0018: deterministic hash (the inbound message
-- carries the code and nothing else, so the code is the lookup key), short
-- expiry, bounded attempts, single use.
--
-- CREATE-only.

CREATE TABLE channel_link_codes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Which rail this code may bind on. A code minted for Telegram must not
    -- be spendable on Slack: they are different account namespaces, and a
    -- member choosing to link one has not consented to the other.
    channel     TEXT NOT NULL,

    code_hash   TEXT NOT NULL UNIQUE,

    issued_at   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER
);

CREATE INDEX channel_link_codes_user_idx   ON channel_link_codes (user_id, issued_at);
CREATE INDEX channel_link_codes_expiry_idx ON channel_link_codes (expires_at);
