-- 0010_automations.sql
-- Phase 3: the automations runtime — a persisted rule object (when → do), the
-- scheduler's restart-surviving state, and a run history.
--
-- The engine that reads these tables is internal/automations. It is NOT part
-- of internal/store: it takes a *sql.DB (or anything with the three standard
-- methods) and the audit choke point as narrow interfaces, so the rule engine
-- can be tested without the HTTP server and cannot reach past its own tables.
--
-- WHY AN AUTOMATION IS NOT ORDINARY CRUD, restated in the schema because this
-- is where a future reader looks first: a rule is an UNATTENDED actuation.
-- Nobody is watching when it fires. So the tier ladder (internal/devices/
-- capability.go) is applied twice — once when the row below is written, and
-- again immediately before the driver is called, because the catalogue can
-- change under a stored rule (a device re-declaring robot.blade-job where it
-- used to declare robot.job turns a saved "start the bot" into blades). A rule
-- whose action resolves above TierConsequential is refused at both points.
-- action_tier below is a RECORD of the tier at save time, kept for forensics
-- and for the console; it is never the authority at execution time.
--
-- Conventions, unchanged from 0001: ids are UUIDv4 TEXT, timestamps are
-- INTEGER unix seconds (UTC), booleans are INTEGER 0/1, json is TEXT.
-- Tenancy is APP-LAYER: every automations store method takes an accountID and
-- scopes its SQL to it.

CREATE TABLE automation_rules (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    -- The member who authorised this unattended actuation. Recorded as the
    -- actor on every audit row the rule's runs write, so "who let this fire at
    -- 3am" has an answer. ON DELETE SET NULL matches 0001's treatment of
    -- actor pointers; created_by_snapshot keeps the id permanently.
    created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by_snapshot TEXT NOT NULL DEFAULT '',

    -- WHEN. trigger_kind is a CHECK-closed vocabulary rather than free text
    -- for the same reason the verb catalogue is closed: an open trigger space
    -- cannot be reviewed. trigger_json holds the kind's own fields
    -- (automations.Trigger), validated in Go before it is written.
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule','threshold','event')),
    trigger_json TEXT NOT NULL DEFAULT '{}',

    -- AND ONLY IF. Zero or more device-metric guards, all of which must hold
    -- at fire time. An unreadable or non-numeric guard is a refusal, never a
    -- pass — ROADMAP Phase 3's "fail-closed behaviour on ambiguous sensor
    -- state for anything that actuates".
    condition_json TEXT NOT NULL DEFAULT '[]',

    -- DO. One capability verb on one device key, or on a zone (the grouping
    -- field on devices.Device — grouping only, it never authorises).
    action_json TEXT NOT NULL DEFAULT '{}',
    -- Tier at save time. Forensic record only; see the header.
    action_tier INTEGER NOT NULL DEFAULT 0,

    -- Flap guard: the shortest interval between two runs of this rule,
    -- whatever fires it. A sensor oscillating around a threshold must not
    -- become a device oscillating around a threshold.
    min_interval_s INTEGER NOT NULL DEFAULT 0,

    -- Scheduler state, persisted so time-based rules survive a restart.
    -- last_occurrence_at is the SCHEDULED instant most recently accounted for
    -- (fired or deliberately skipped as stale), not the wall time it ran at;
    -- the scheduler resumes from it, which is what makes a restart neither
    -- replay a missed evening nor silently swallow one.
    last_occurrence_at INTEGER,
    last_fired_at      INTEGER,
    last_outcome       TEXT NOT NULL DEFAULT '',

    -- Circuit breaker. consecutive_failures counts runs that did not actuate;
    -- a success resets it. At the engine's budget the rule disables itself and
    -- records why — an unattended actuator that cannot tell whether it is
    -- working must stop trying, not keep pushing into the physical world.
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    disabled_reason      TEXT NOT NULL DEFAULT '',
    disabled_at          INTEGER,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX automation_rules_account_idx ON automation_rules (account_id, created_at DESC);
-- The scheduler's own scan: enabled rules of one trigger kind.
CREATE INDEX automation_rules_due_idx ON automation_rules (enabled, trigger_kind);

-- Run history. Every attempt lands here, including the ones that refused to
-- actuate, because "it did not fire, and here is why" is the answer an
-- operator needs most often.
--
-- This is NOT the audit trail. The audit trail is admin_audit_log, written
-- through store.WriteAdminAudit (SHA-256 hash-chained, append-only triggers,
-- migration 0007) and nothing in this package ever inserts into it directly.
-- This table is the operational view: cheap, queryable, prunable, and
-- deliberately not claiming tamper-evidence it does not have.
--
-- rule_id carries NO foreign key on purpose. Deleting a rule must not delete
-- the record of what it did, and 0001's ON DELETE SET NULL + snapshot pattern
-- would leave a history row that cannot say which rule it belonged to. The
-- name is snapshotted alongside for the same reason.
CREATE TABLE automation_runs (
    id         TEXT PRIMARY KEY,
    rule_id    TEXT NOT NULL,
    rule_name  TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL,

    -- What asked for this run.
    cause TEXT NOT NULL CHECK (cause IN ('schedule','threshold','event','manual')),
    -- For a schedule cause, the instant the occurrence was due (distinct from
    -- started_at, which is when the tick got round to it).
    occurrence_at INTEGER,

    -- executed      — the driver reported the action happened.
    -- refused       — policy said no BEFORE anything actuated (tier, unknown
    --                 device, unknown verb, ambiguous condition, no targets).
    -- failed        — the driver said the action did not happen.
    -- indeterminate — the driver could not tell (devices.ErrIndeterminate).
    --                 Never retried: retrying an unknown physical outcome is
    --                 how a gate gets opened twice.
    -- skipped       — nothing was attempted (cooldown, stale missed occurrence).
    outcome TEXT NOT NULL CHECK (outcome IN ('executed','refused','failed','indeterminate','skipped')),
    reason  TEXT NOT NULL DEFAULT '',

    -- What it was about to do, as resolved. device_key/verb are empty for a
    -- run that never got as far as resolving a target.
    device_key   TEXT NOT NULL DEFAULT '',
    verb         TEXT NOT NULL DEFAULT '',
    tier         INTEGER NOT NULL DEFAULT 0,
    target_count INTEGER NOT NULL DEFAULT 0,

    -- Whether the hash-chained audit row for this run was written. 0 on a run
    -- that actuated is the loud case: the trail is incomplete, and the engine
    -- disables the rule when it happens.
    audited INTEGER NOT NULL DEFAULT 0,

    started_at  INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX automation_runs_rule_idx    ON automation_runs (rule_id, created_at DESC);
CREATE INDEX automation_runs_account_idx ON automation_runs (account_id, created_at DESC);
