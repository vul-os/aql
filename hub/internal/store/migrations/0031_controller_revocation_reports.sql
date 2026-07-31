-- What deny-list a controller says it is actually enforcing.
--
-- docs/GRANT-REVOCATION.md §5, first open question. The hub knows which
-- controllers it DISPATCHED a revocation to. It does not know which have
-- APPLIED one — and those differ exactly when it matters, because a command
-- queued for a gate that never reconnects looks identical to one delivered.
-- An operator asking "did my revocation land" was being answered by the hub
-- assuming its own success, which is the failure CONTROLLER-CONFIG-REPORT.md
-- was written to fix for actuation config and which applies here word for word.
--
-- # Why its own table rather than a column on controller_config_reports
--
-- The house rule (0028): new state gets a new table, never an ALTER. There is
-- also a substantive reason. 0026's row is the RESOLVED ACTUATION CONFIG — what
-- the gate will do when told to open. This is enforcement state about access
-- that has been taken away. They arrive in the same message and answer
-- different questions, and a console reading one must not accidentally write
-- the other.
--
-- They also have different absences. A controller that has never reported its
-- config reads as "not reported yet". A controller that has never reported a
-- SEQ is saying something narrower: either its firmware predates the field, or
-- it has genuinely never been sent a list. Keeping them apart lets each say its
-- own "unknown" without one being read as the other's.
--
-- # seq 0 is a real value here, and absence is a different one
--
-- A row with seq 0 means the controller reported, and reported that it holds no
-- list. NO ROW means it has told us nothing — an older firmware, or one that
-- has not connected since this shipped. The console must distinguish them: the
-- first says "this gate has never been sent a revocation", the second says
-- "this gate cannot tell us", and only the second leaves an operator unable to
-- confirm anything at all.

CREATE TABLE controller_revocation_reports (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,

    -- The highest deny-list the controller has ACCEPTED. Compared against the
    -- hub's own counter to answer "has this gate caught up".
    seq INTEGER NOT NULL,

    -- How many entries it holds. Display only: the sequence is what decides
    -- whether a revocation landed, and a count that disagreed with it would be
    -- a second, weaker answer to the same question.
    entries INTEGER NOT NULL DEFAULT 0,

    reported_at INTEGER NOT NULL,  -- the controller's clock, from the message
    received_at INTEGER NOT NULL   -- the hub's clock, when it arrived
);
