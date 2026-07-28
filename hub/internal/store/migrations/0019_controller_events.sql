-- Controller-originated events, persisted (proto/events.md).
--
-- WHY THIS EXISTS. The controller does a great deal of work to make these
-- events durable: it signs each one, holds it in a bounded ring with a
-- RESERVED partition for grant_redeemed that is never evicted, falls back to
-- an fsync'd append-only overflow log when that partition is full, and
-- deliberately records a grant redemption BEFORE pulsing the relay so a
-- crash between the two cannot leave a gate that opened with no trace
-- (agent.OnRedeemed, events.Queue). All of that ended at the hub in a single
-- `s.log.Info("controller event")` — verified, then dropped on the floor.
--
-- The consequence was specific, not theoretical. An offline emergency-access
-- open is the ONE path with no hub in the loop: nothing else records it.
-- The controller's grant_redeemed event was the only evidence that a gate
-- opened, and the hub discarded it on arrival. A hub operator reviewing the
-- audit log saw nothing at all.
--
-- events.md's line "The hub dedupes on `event_id`" was also false for the
-- same reason — there was nothing to dedupe against. That claim is the only
-- mitigation the spec offers for its two acknowledged delivery gaps (no
-- event ack, no sequence number), so it needs to be true before it can be
-- leaned on: event_id is this table's PRIMARY KEY, which makes a replay an
-- ON CONFLICT DO NOTHING no-op rather than a duplicate audit row.
--
-- CREATE-only, append-only. No ALTER, no UPDATE path in the store.

CREATE TABLE controller_events (
    -- The dedupe key, per events.md. A retried or replayed delivery of the
    -- same event collides here and is discarded.
    event_id    TEXT PRIMARY KEY,

    -- ON DELETE SET NULL + snapshot, matching access_logs' rationale in 0001:
    -- deleting a device must not rewrite what history says happened.
    device_id          TEXT REFERENCES devices(id) ON DELETE SET NULL,
    device_id_snapshot TEXT NOT NULL,

    kind        TEXT NOT NULL,
    -- The controller's clock at the time of the event. Untrusted: a device
    -- with no RTC may report a wildly wrong ts after a power cut (events.md,
    -- "Clock after a power cut"), which is exactly why received_at is stored
    -- separately rather than trusting this one.
    ts          INTEGER NOT NULL,
    data        TEXT NOT NULL DEFAULT '{}',
    sig         TEXT NOT NULL,

    -- The exact bytes the signature covers. Stored verbatim so the signature
    -- remains re-verifiable by an auditor later; re-serialising the parsed
    -- columns would not reproduce them, which would make the stored sig
    -- decorative.
    envelope    TEXT NOT NULL,

    -- The hub's clock on arrival. Trustworthy, and the only ordering signal
    -- available: events.md v0 has no per-device sequence number.
    received_at INTEGER NOT NULL,

    -- Set when this event also produced an access_logs row (the physical
    -- access kinds), linking the raw signed evidence to the audit entry it
    -- justifies.
    access_log_id TEXT REFERENCES access_logs(id) ON DELETE SET NULL
);

CREATE INDEX controller_events_device_idx   ON controller_events (device_id_snapshot, received_at);
CREATE INDEX controller_events_kind_idx     ON controller_events (kind, received_at);
