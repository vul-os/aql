-- 0014_time_windows.sql
-- Online time-window rules: WHEN a member may open, not whether.
--
-- THE ASYMMETRY THIS CLOSES. An offline grant has carried weekly windows since
-- proto/grants.md v0 — the controller evaluates them itself, with no network
-- (controller/internal/grants, gateway/internal/keys/grant.go). The ONLINE path
-- had no equivalent: a member with access could open at any hour. A cleaner who
-- should only get in on weekday mornings got in at 3am. This table is the
-- online half, and it deliberately reuses the offline vocabulary verbatim
-- (days/from/to, mon..sun, "HH:MM", `to` exclusive, "24:00" = end of day) so
-- the product has ONE window format, not two.
--
-- WHY A ROW PER (MEMBER, TARGET) AND NOT A COLUMN ON account_members. A window
-- is per access point as often as it is per site: the cleaner may use the front
-- door on weekday mornings and the server-room door never. A column could not
-- say that, and the table also keeps the DEFAULT — no row, no restriction —
-- structurally impossible to get wrong: an install that never uses this feature
-- has an empty table and behaves exactly as it did before the migration.
--
-- WHY THE TIMEZONE IS A COLUMN AND NOT A SETTING. "The hub's local time"
-- silently changes meaning when a hub is moved, when a DST rule changes, or
-- when a container is rebuilt without /etc/localtime. A window without a zone
-- is not a window; it is an opinion about where the server is. Each rule
-- therefore stores its own IANA zone, required, never defaulted (see
-- internal/store/timewindows.go — a rule with an empty or unloadable zone is
-- refused at write time and DENIES at evaluation time, never falls back to
-- UTC and lets someone in an hour early).
--
-- MIGRATION DISCIPLINE: CREATE only. No ALTER, no DROP, no DELETE anywhere in
-- this directory. Account scoping is enforced in the app layer (see the
-- package comment in internal/store/store.go), and the FKs below are for
-- referential integrity and cascade-on-delete, not for tenancy.

CREATE TABLE time_window_rules (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- The member the rule constrains. Rules are per-USER; visitor/offline
    -- grants carry their own windows and are not touched by this table.
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Exactly one target. An access-point rule and a location rule can both
    -- apply to the same open; when they do, BOTH must allow it (see
    -- timewindows.go — a rule can only ever narrow access, never widen it).
    -- ON DELETE CASCADE: deleting the door deletes the rule about the door,
    -- so a stale rule can never outlive its subject and deny at a target that
    -- no longer means what it did.
    access_point_id TEXT REFERENCES access_points(id) ON DELETE CASCADE,
    location_id  TEXT REFERENCES locations(id) ON DELETE CASCADE,
    -- IANA zone name, e.g. 'Africa/Johannesburg'. NOT NULL and never '' —
    -- CHECKed here as well as in Go, because a zoneless window is the one
    -- error that would silently shift every decision by an hour twice a year.
    tz           TEXT NOT NULL CHECK (tz <> ''),
    -- JSON array of {"days","from","to"} — byte-identical in shape to an
    -- offline grant's `windows` (proto/grants.md). Stored as text rather than
    -- normalised into rows because it is read as a unit, written as a unit,
    -- and is the SAME value the offline issuer already serialises; splitting
    -- it here would create the second format this feature exists to avoid.
    -- Contents are validated in Go on write AND re-validated on every read
    -- that matters: an unparseable rule denies, it never degrades to "no
    -- rule" (timewindows.go, fail-closed).
    windows      TEXT NOT NULL,
    -- Operator-facing note ("cleaner, weekday mornings"). Never interpreted.
    note         TEXT NOT NULL DEFAULT '',
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    -- Exactly one target, enforced in the schema so no code path can create a
    -- rule that applies everywhere or nowhere.
    CHECK ((access_point_id IS NOT NULL AND location_id IS NULL)
        OR (access_point_id IS NULL AND location_id IS NOT NULL))
);

-- The open-path lookup: one indexed read per open attempt, keyed exactly the
-- way the choke point asks (this member, at this door or in this location).
CREATE INDEX time_window_rules_user_ap_idx ON time_window_rules (user_id, access_point_id);
CREATE INDEX time_window_rules_user_loc_idx ON time_window_rules (user_id, location_id);
CREATE INDEX time_window_rules_account_idx  ON time_window_rules (account_id, created_at DESC);

-- One rule per (member, target). Two rules on the same door for the same
-- person would intersect invisibly — an operator would write the second one
-- expecting it to replace the first and instead get the overlap of both.
-- Editing one rule is comprehensible; accumulating hidden intersections is
-- not. coalesce() because SQL NULLs do not compare equal to each other and a
-- plain UNIQUE(user_id, access_point_id, location_id) would let duplicates
-- through on exactly the rows that need it most.
CREATE UNIQUE INDEX time_window_rules_target_uniq
    ON time_window_rules (user_id, coalesce(access_point_id, ''), coalesce(location_id, ''));
