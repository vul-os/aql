-- When did this controller last actually sync its clock?
--
-- The hub needs the answer because the controller refuses EVERY offline grant
-- once its own LastGatewaySync is older than 14 days
-- (controller/internal/wire's StaleClockLimitSeconds, enforced at
-- grants/grants.go step 1, before lockdown and before the grant is examined).
-- That failure lands at the gate, during exactly the outage offline grants
-- exist for, and nothing on the hub could see it coming.
--
-- # Why not last_seen_at
--
-- `devices.last_seen_at` looks like the answer and is not. It is stamped on
-- WS auth, on uplink events, on acks AND on every long-poll request
-- (httpapi/devices.go's four TouchDeviceSeen calls) — but a controller only
-- syncs its clock at a WS handshake or on an accepted `ping`. A controller on
-- the long-poll fallback therefore stamps last_seen_at every poll interval
-- while its clock does not move at all.
--
-- A warning built on last_seen_at would be confidently wrong in the reassuring
-- direction, which is worse than no warning.
--
-- # What IS proof
--
-- An acked `ping`. Processing one calls the controller's SyncClock
-- (command.go's "ping" case), so an ack for a ping the hub itself minted is
-- proof that that controller's clock advanced to that ping's iat. Nothing else
-- the hub receives proves it: an `open` ack means a relay fired, not that a
-- clock moved.
--
-- So this table records the correlation. The hub remembers the nonce it minted
-- for a device's ping; when an ack for exactly that nonce comes back verified,
-- the sync is recorded.
--
-- # Why a pending nonce rather than trusting the ack's result
--
-- A ping acks with result "ok" — and so does `config`. Keying on the result
-- would count a config acknowledgement as a clock sync, which is a subtler
-- version of the last_seen_at mistake: right most of the time, wrong exactly
-- when an operator is relying on it.
--
-- The nonce is unforgeable in the way that matters here: the hub minted it, and
-- the ack carrying it is signed by the controller's pinned key and verified
-- before this table is ever touched.

CREATE TABLE controller_clock_syncs (
    device_id      TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,

    -- The nonce of a ping dispatched but not yet acked, and when it went out.
    -- Cleared on the matching ack. A pending nonce that is never answered is
    -- simply overwritten by the next sweep — the hub does not need a timeout
    -- here, because an unanswered ping is not an event, it is a controller that
    -- will be pinged again in six hours.
    pending_nonce  TEXT,
    pending_at     INTEGER,

    -- Unix seconds when a ping was last PROVED to have been processed. NULL
    -- means no ping has ever been acked by this controller — which is a real
    -- and reportable state, not the same as "recently synced".
    synced_at      INTEGER,

    updated_at     INTEGER NOT NULL
);

-- The read the staleness report makes: every device ordered by how long it has
-- been since its clock was last proved fresh, oldest first.
CREATE INDEX controller_clock_syncs_synced_idx ON controller_clock_syncs (synced_at);
