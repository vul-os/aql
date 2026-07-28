-- 0017_maintenance.sql
-- The per-access-point maintenance log.
--
-- CREATE ONLY. No ALTER, no DROP, no DELETE — the house rule every other
-- migration in this directory satisfies.
--
-- ============================================================================
-- WHY THIS EXISTS
-- ============================================================================
-- The console has shipped a maintenance panel on the access-point screen since
-- before this table did: it lists events and offers a "log maintenance" form,
-- both pointed at GET/POST /v1/access-points/{id}/maintenance. Neither route
-- existed. Listing rendered an error and logging failed, every time, for every
-- user. accessPointJSON compensated with a hardcoded "nothing recorded"
-- maintenance block — permanently true, because nothing could ever record.
--
-- ============================================================================
-- WHAT THIS DELIBERATELY DOES NOT MODEL: MOVEMENT
-- ============================================================================
-- The retired Workers schema scheduled service by distance travelled: a gate
-- leaf covers some metres per cycle, so "service every 5000 m" is how the
-- trade actually thinks about it. The console still offers that input.
--
-- Aql cannot honour it. Nothing measures movement — accessPointJSON reports
-- meter.movement_m as a literal 0 and always has, because a controller reports
-- that a relay pulsed, not how far a leaf travelled. Distance would have to
-- come from a per-access-point calibration (metres per cycle) that nobody has
-- entered, or from a sensor that does not exist.
--
-- So there is no movement column here, and the API refuses a movement-based
-- threshold rather than storing one. A stored threshold that can never be
-- evaluated is worse than a missing feature: an operator sets "service after
-- 5000 m", the counter never moves, the reminder never fires, and they find
-- out when a gate fails. The same reasoning internal/energy uses for an
-- unmeasured hour — absence with a reason beats a confident zero.
--
-- Date-based scheduling IS honoured, because a clock exists.
--
-- ============================================================================
-- SCHEDULING IS A PROPERTY OF THE EVENT, NOT OF THE ACCESS POINT
-- ============================================================================
-- next_due_at lives on the event that set it, not on access_points. "When is
-- this gate next due" is then a question about the most recent event, which
-- means the answer is always attributable: a technician logged a service on a
-- date and said the next one is due on another date. A column on
-- access_points would be a running total nobody signed for, and correcting a
-- mistaken due date would overwrite history instead of appending to it.
--
-- The log is append-only by construction: there is no UPDATE or DELETE path in
-- store/maintenance.go. A wrong entry is corrected by logging a new one, the
-- same discipline the audit tables use.

CREATE TABLE maintenance_events (
    id                TEXT PRIMARY KEY,
    access_point_id   TEXT NOT NULL REFERENCES access_points(id) ON DELETE CASCADE,

    -- The trade's own vocabulary, constrained so a typo cannot invent a fifth
    -- category that no reader knows how to group.
    kind              TEXT NOT NULL
                      CHECK (kind IN ('inspection','service','repair','replacement')),

    -- When the work happened, which is NOT when the row was written: a
    -- technician logs Friday's service on Monday. created_at keeps the write
    -- time so the two can never be confused.
    performed_at      INTEGER NOT NULL,

    -- The member who logged it. ON DELETE SET NULL rather than CASCADE: a
    -- technician leaving the account must not erase the record that a gate was
    -- serviced. technician_name survives them as free text.
    performed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    technician_name   TEXT,
    notes             TEXT,

    -- Parts as a JSON array of {name, qty, cost_zar_cents}. JSON rather than a
    -- child table because nothing queries across parts — they are shown with
    -- their event and never aggregated. A join table would be schema for a
    -- report that does not exist.
    parts             TEXT,

    -- Minor units, integer. Never a float: money in a float is a rounding bug
    -- waiting for a total.
    cost_zar_cents    INTEGER CHECK (cost_zar_cents IS NULL OR cost_zar_cents >= 0),

    -- The next service date this event declares, if any. NULL means this event
    -- scheduled nothing, which is the normal case for an inspection.
    next_due_at       INTEGER,

    created_at        INTEGER NOT NULL
);

-- The only two access patterns: one access point's history, newest first, and
-- the single most recent event (which answers "when is it next due").
CREATE INDEX idx_maintenance_events_ap
    ON maintenance_events (access_point_id, performed_at DESC);
