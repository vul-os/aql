-- Which deny-list sequence each grant was revoked at.
--
-- docs/GRANT-REVOCATION.md §5, second open question. 0031 lets a controller say
-- which list it holds, which answers "is this gate caught up" — and that is a
-- COARSER question than the one an operator actually asks.
--
-- The real question is "can the person I just fired still get in at this gate",
-- and comparing a controller's sequence with the hub's CURRENT one answers it
-- wrongly in a specific, misleading direction: a gate on list 5, when the grant
-- was revoked at 3 and the hub has since reached 9, HAS the revocation and
-- reads as behind. That errs safe — it never falsely reassures — but it sends
-- an operator to latch lockdown on a gate that is already refusing the grant,
-- and a warning that cries wolf is one people learn to ignore.
--
-- Recording the sequence a grant was revoked AT makes the comparison exact:
-- this controller has this revocation if its reported seq >= the grant's.
--
-- # The name
--
-- `offline_grant_revoked_at`, not `..._revocation_seq`: 0030 already uses that
-- name for the hub-wide counter, and the first draft of this migration reused
-- it. The runner refused with "table already exists", which is the schema
-- catching a collision that would otherwise have been two different meanings
-- behind one name.
--
-- # Why a table and not a column on offline_grants
--
-- The house rule (0028): new state gets a new table, never an ALTER. 0030
-- shipped without this and a column added now is a change every existing row
-- silently participates in — and here that would be actively wrong, because
-- grants revoked before this migration have NO recorded sequence and must not
-- be given a default one. A missing row says "revoked before the hub tracked
-- this", which the console can state honestly; a backfilled 0 would claim every
-- controller has a revocation none of them may have.

CREATE TABLE offline_grant_revoked_at (
    -- One row per REVOKED grant. Active grants have none: there is no sequence
    -- at which something that has not happened happened.
    grant_id TEXT PRIMARY KEY REFERENCES offline_grants(grant_id) ON DELETE CASCADE,

    -- The counter value the deny-list carried when this grant joined it. A
    -- controller reporting a sequence at or above this one is enforcing this
    -- revocation, whatever else it may be behind on.
    seq INTEGER NOT NULL
);
