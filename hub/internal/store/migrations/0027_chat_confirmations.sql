-- A second authenticated message, bound to the intent it confirms.
--
-- docs/CHAT-COMMANDS.md §3.4. T2 verbs are "consequential but non-hazardous —
-- costs time, water, power, wear", and the spec requires a confirmation for one
-- that is not idempotent. This is where the pending confirmation lives between
-- the two messages.
--
-- # Why not "reply yes"
--
-- §3.4 rules it out for three reasons and this schema exists to satisfy all
-- three:
--
--   * A bare "yes" is replayable — it authorizes whatever was last asked. Hence
--     `token`, minted per attempt and single-use.
--   * In a group conversation "yes" cannot be attributed to the person asked by
--     anything stronger than the platform's sender field. Hence `subject`,
--     which the redeeming message must match.
--   * A confirmation for "start the mower" must not confirm "unlock the front
--     door" if two exchanges interleave. Hence `intent_hash`.
--
-- # intent_hash is over the RESOLVED intent, not the message
--
-- The hash covers (device_key, verb, args) as the resolver produced them, so it
-- cannot be satisfied by a differently-worded message that resolves elsewhere,
-- and it cannot drift with phrasing. device_key and verb are stored alongside
-- it in plain form: the hash is what is CHECKED, and these are what an operator
-- reads in a support conversation or an incident review. Storing only the hash
-- would make the table unreadable exactly when someone needs to read it.
--
-- # Why single-use is a column and not a delete
--
-- `used_at` rather than deleting the row, so a redeemed confirmation is still
-- visible for the window it covers. A replay attempt then finds a row that
-- exists and is spent — which is a different fact from a token that never
-- existed, and the two deserve different replies.
--
-- The claim is an UPDATE with `used_at IS NULL` in its WHERE, so two deliveries
-- of the same confirming message race in one statement and exactly one wins. A
-- SELECT-then-UPDATE would let both through, which for a confirmation is the
-- entire failure: the second message is the authorization.
--
-- # Expiry
--
-- 60 s, per §3.4, carried as an absolute `expires_at` rather than computed from
-- created_at at read time. A window whose length lives in code can be widened
-- by a deploy without any row changing; one that is stamped on the row means an
-- outstanding confirmation keeps the terms it was issued under.
--
-- Rows are not swept. They are tiny, they are audit-adjacent, and a sweeper is
-- one more thing that can fail silently; the redeem path checks expiry, so an
-- unswept row is inert rather than dangerous.

CREATE TABLE chat_confirmations (
    -- The token the member sends back. Random, not derived: a token derived
    -- from the intent would be predictable to anyone who can guess the intent.
    token       TEXT PRIMARY KEY,

    -- Who may redeem it. The rail's own subject ("profile:<id>"), matched
    -- exactly on redemption — a token minted for one member is not spendable by
    -- another in the same group chat.
    subject     TEXT NOT NULL,

    -- Which conversation it was issued in. §3.4 requires the confirming message
    -- to arrive "in the same conversation", so a token overheard in one channel
    -- cannot be spent in another.
    channel     TEXT NOT NULL,
    chat_id     TEXT NOT NULL,

    -- What it authorizes. intent_hash is the check; the other two are for
    -- humans reading this table later.
    intent_hash TEXT NOT NULL,
    device_key  TEXT NOT NULL,
    verb        TEXT NOT NULL,

    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    -- NULL until spent. The redeem claim is an UPDATE gated on this being NULL.
    used_at     INTEGER
);

-- Redemption looks up by token alone (it is the primary key); this index serves
-- the "does this member already have something pending" question, which the
-- mint path asks so a member is not left holding two live tokens for two
-- different devices with no way to tell which is which.
CREATE INDEX idx_chat_confirmations_subject ON chat_confirmations(subject, expires_at);
