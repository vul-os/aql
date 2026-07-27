-- 0013_webhooks.sql
-- Outbound webhooks: tell something else that a gate opened.
--
-- The use case is a hub telling a home-automation box, a SIEM, or a chat room
-- that an access point was actuated — one direction, hub to elsewhere, no
-- inbound anything. It is deliberately NOT a control surface: nothing a
-- receiver replies with is read, so a compromised endpoint cannot steer the
-- hub. It can only learn.
--
-- WHY THE SECRET IS STORED IN PLAINTEXT, unlike every other credential here:
-- an HMAC signing key must be recoverable to sign with. It is not a password
-- and there is nothing to compare it against — the hub is the signer, not the
-- verifier. Hashing it would make signing impossible. It is therefore treated
-- as what it is: a secret at rest, never returned by any read path (see the
-- projection in internal/store/webhooks.go), never logged, and shown to the
-- operator exactly once at creation, the same discipline api_tokens uses for a
-- value that genuinely cannot be re-derived.
--
-- WHY DELIVERIES ARE A SEPARATE TABLE: an endpoint that has been unreachable
-- for a week must not be able to grow a row in the subscription table or slow
-- an open. The open path never writes here; the dispatcher does, out of band,
-- after the actuation has already happened and been audited. A webhook is a
-- notification about the past, and no failure to deliver one may ever affect
-- whether a gate opens.

CREATE TABLE webhooks (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Operator-facing label. Never used for routing.
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    -- HMAC-SHA256 signing key, hex. See the note above on why this is not
    -- hashed. Never selected by any listing query.
    secret       TEXT NOT NULL,
    -- Comma-separated event names this endpoint wants. A closed vocabulary
    -- validated in Go (webhooks.go), not a free-text filter: an unknown event
    -- name in config is an operator error worth refusing, not a subscription
    -- that silently never fires.
    events       TEXT NOT NULL,
    -- allow_private permits a target on a loopback, link-local or private
    -- address. OFF by default and deliberately explicit: a hub sits inside a
    -- home network, so an unguarded webhook URL is a request-forgery primitive
    -- pointed at everything else on the LAN — the router's admin page, a
    -- cloud metadata endpoint, another hub. An operator wiring one to their own
    -- Home Assistant is the legitimate case and says so by setting this.
    allow_private INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    -- Set when the dispatcher gives up on a persistently failing endpoint, so
    -- a dead URL stops costing a delivery attempt on every open forever.
    disabled_at  INTEGER,
    disabled_reason TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX webhooks_account_idx ON webhooks (account_id, enabled);

CREATE TABLE webhook_deliveries (
    id          TEXT PRIMARY KEY,
    webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event       TEXT NOT NULL,
    -- The exact bytes that were signed and sent, so an operator debugging a
    -- receiver can compare like for like. Payloads carry no secret: see
    -- webhooks.go's event builders.
    payload     TEXT NOT NULL,
    attempt     INTEGER NOT NULL,
    -- 'pending' | 'delivered' | 'failed' — 'failed' means every attempt was
    -- used, not that one attempt errored.
    status      TEXT NOT NULL CHECK (status IN ('pending','delivered','failed')),
    -- HTTP status when there was one. NULL means the request never got a
    -- response, which is a different thing from a 500 and is kept distinct.
    response_code INTEGER,
    error       TEXT,
    created_at  INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX webhook_deliveries_account_idx ON webhook_deliveries (account_id, created_at DESC);
