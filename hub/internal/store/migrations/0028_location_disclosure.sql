-- Per-location consent for occupancy disclosure.
--
-- docs/CHAT-COMMANDS.md §4.4 rule 6: "Occupancy proxies are opt-in per
-- location, default off. Presence, away-state, and 'which lights are on' are
-- off unless an operator enables them for that location."
--
-- # Why this is its own table rather than a column on location_settings
--
-- location_settings holds open quotas. This holds a consent decision about what
-- may be said about the people in a building. Those are different kinds of
-- fact with different review needs, and putting them in one row invites a
-- handler that reads the quota and writes the consent, or a settings form that
-- resets one while editing the other.
--
-- It is also the house rule for this repository: new state gets a new table,
-- never an ALTER. A column added to a shipped table is a change every existing
-- row silently participates in; a new table starts empty, which for a consent
-- record is exactly right.
--
-- # Absence is OFF, and that is the whole design
--
-- There is no `enabled` column defaulting to 0. A location that has never opted
-- in has NO ROW, and the reader treats a missing row as off. That makes the
-- safe state the one that requires no action, no migration backfill and no
-- correct default — the failure mode of a boolean column is a backfill that
-- writes 1, and there is no such thing here to get wrong.
--
-- Turning it back off DELETES the row rather than writing 0. The table means
-- "these locations have consented", and a row that says "no" is a different
-- claim that nothing needs.
--
-- # Why who and when are recorded
--
-- This is the switch that lets a chat message report whether someone is home.
-- §2.4 makes the same argument for camera:view: granting is an admin action and
-- has to be answerable later. Enabling occupancy disclosure is the same kind of
-- act, so the row carries the actor and the moment, and the route writes an
-- admin-audit entry besides — this table is state, that log is evidence.

CREATE TABLE location_disclosure (
    -- One row per location that has OPTED IN. No row = not opted in.
    location_id  TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,

    -- Who turned it on, and when. Nullable actor because a user may later be
    -- deleted and the consent still stands — ON DELETE SET NULL keeps the fact
    -- that consent was given even when the giver's row is gone.
    enabled_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    enabled_at   INTEGER NOT NULL
);
