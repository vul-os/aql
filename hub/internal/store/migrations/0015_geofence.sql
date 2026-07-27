-- 0015_geofence.sql
-- Geofence rules: refuse an open when the requester is not near the gate.
--
-- WHAT THIS IS, AND WHAT IT IS NOT. The coordinates a geofence is tested
-- against arrive from a phone, in the request body. Nothing verifies them —
-- not a signature, not a second source, not a physical measurement. A caller
-- who wants to claim they are standing at the gate can, and no schema here can
-- stop them. This table therefore describes a CONVENIENCE, not a security
-- boundary: it catches the resident who opens the wrong gate from the office,
-- the fat-fingered tap from the couch, the automation firing from a laptop in
-- another city. It does not stop an attacker, and an operator who believes it
-- does is worse off than one who never enabled it. See internal/store/
-- geofence.go's package comment for the full statement of that claim.
--
-- THE DATA WAS ALREADY THERE. access_logs has carried lat/long since 0001 and
-- the open path has recorded them since it existed. Capture without
-- enforcement is exactly the gap this closes; nothing about the capture side
-- changes.
--
-- WHY A ROW PER TARGET AND NOT PER (MEMBER, TARGET). Unlike a time window
-- (0014), which is a statement about ONE PERSON's schedule, "you must be near
-- the gate" is a property of the GATE. Everyone who opens it is subject to it,
-- including visitors holding a one-off grant. Making it per-member would mean
-- an operator hand-writing a row per resident and a NEW resident silently
-- getting no fence at all — a default that fails open, quietly, exactly when
-- somebody is relying on it.
--
-- WHY THE ANCHOR IS COPIED ONTO THE RULE INSTEAD OF READ FROM THE TARGET.
-- access_points and locations both already carry lat/long, and the create path
-- seeds the anchor from them. It is COPIED rather than joined because a map
-- pin is edited for reasons that have nothing to do with access control —
-- correcting a postal address, nudging a marker on a site plan — and a fence
-- whose centre moves as a side effect of an unrelated edit is a fence nobody
-- can reason about. The rule owns its anchor; changing the fence is an
-- explicit act against the fence.
--
-- WHY on_missing_location IS A COLUMN. A request can arrive with no
-- coordinates at all: every chat rail (WhatsApp/Telegram/Slack/Discord) sends
-- none today, and a browser can be refused location permission. That case must
-- be a decision the operator made in advance, in writing, per rule — not a
-- silent pass (a fence bypassed by omitting a field) and not a silent lockout.
-- The default is 'deny', because a fence that any caller can switch off by
-- leaving a field out is not a fence; the operator who needs the chat rails to
-- keep working sets 'allow' knowingly and can see that they did.
--
-- WHY slack_m EXISTS. A phone reports a position with an error radius —
-- 5-15 m outdoors with a clear sky, 30-50 m against a building, over 100 m on
-- a wifi-only fix indoors — and the anchor is itself a hand-dropped pin with
-- its own error. A hard cutoff at exactly radius_m refuses people standing at
-- the gate. slack_m is the forgiveness band added to the radius, set by the
-- OPERATOR rather than taken from the client, for the same reason the whole
-- feature is not a security control: a client-reported accuracy figure is
-- exactly as unverifiable as the position, and honouring one would let any
-- caller widen the fence to any size by claiming a bad fix.
--
-- MIGRATION DISCIPLINE: CREATE only. No ALTER, no DROP, no DELETE anywhere in
-- this directory. Account scoping is enforced in the app layer (see the
-- package comment in internal/store/store.go); the FKs below are for
-- referential integrity and cascade-on-delete, not for tenancy.

CREATE TABLE geofence_rules (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Exactly one target. An access-point rule and a location rule can both
    -- apply to one open; when they do, BOTH must allow it (see geofence.go —
    -- rules narrow, never widen). ON DELETE CASCADE so a rule can never
    -- outlive the door it is about.
    access_point_id TEXT REFERENCES access_points(id) ON DELETE CASCADE,
    location_id  TEXT REFERENCES locations(id) ON DELETE CASCADE,
    -- The centre of the fence, in WGS84 degrees. NOT NULL: a fence with no
    -- centre is not a fence, and a NULL anchor would have to mean either
    -- "allow everything" or "deny everything", both of which are worse than
    -- refusing to create the rule.
    anchor_lat   REAL NOT NULL CHECK (anchor_lat  BETWEEN  -90 AND  90),
    anchor_long  REAL NOT NULL CHECK (anchor_long BETWEEN -180 AND 180),
    -- Metres. Bounds mirror internal/store/geofence.go, which re-checks them
    -- on every read: a radius under 10 m is smaller than the error of the
    -- measurement it is compared against, and one over 50 km is not a fence.
    radius_m     REAL NOT NULL CHECK (radius_m BETWEEN 10 AND 50000),
    -- Metres of GPS/anchor error forgiven on top of radius_m. Default 75:
    -- generous enough that a phone against a wall at the gate still gets in,
    -- small enough that a 200 m fence still means something.
    slack_m      REAL NOT NULL DEFAULT 75 CHECK (slack_m BETWEEN 0 AND 1000),
    -- 'deny' | 'allow' — what happens when the request carries no usable
    -- coordinates. CHECKed here as well as in Go; the evaluator additionally
    -- treats ANY value that is not exactly 'allow' as deny, so a corrupted or
    -- future value fails closed rather than opening the gate.
    on_missing_location TEXT NOT NULL DEFAULT 'deny'
        CHECK (on_missing_location IN ('deny', 'allow')),
    -- Operator-facing note ("front gate, complex boundary"). Never interpreted.
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
-- way the choke point asks (this door, or the location this door is in).
CREATE INDEX geofence_rules_ap_idx      ON geofence_rules (access_point_id);
CREATE INDEX geofence_rules_loc_idx     ON geofence_rules (location_id);
CREATE INDEX geofence_rules_account_idx ON geofence_rules (account_id, created_at DESC);

-- One rule per target, for 0014's reason: two fences on the same door would
-- intersect invisibly, and an operator writing the second one expecting it to
-- replace the first would get the overlap of both. coalesce() because SQL
-- NULLs do not compare equal to each other, so a plain
-- UNIQUE(access_point_id, location_id) would let duplicates through on
-- exactly the rows that need it most.
CREATE UNIQUE INDEX geofence_rules_target_uniq
    ON geofence_rules (coalesce(access_point_id, ''), coalesce(location_id, ''));
