-- Widen the automation trigger vocabulary to include 'clip'.
--
-- A camera writing a clip is a fact the hub knows first-hand — it wrote the
-- row — so "alert me when the driveway camera records" needs no new sensing,
-- only a trigger kind. 0010 closed the vocabulary with a CHECK, and closed
-- vocabularies are the point: an open trigger space cannot be reviewed. So
-- adding a kind is a schema change, deliberately, rather than a string that
-- quietly starts appearing in a column.
--
-- # Why this rebuilds the table rather than dropping the constraint
--
-- SQLite cannot widen a CHECK in place. The alternatives were to drop the
-- constraint and rely on automations.Trigger.Validate alone, or to rebuild.
-- Validation in Go already runs on every write, but 0010's comment states the
-- reason the database holds it too: the row is data, and data can be edited by
-- something that is not this engine — a support session with a sqlite3 prompt,
-- a restore, a future writer. A rule that actuates the physical world on an
-- unreviewed trigger kind is the failure the CHECK exists to prevent, so the
-- constraint survives the migration rather than being traded for convenience.
--
-- # Why the rebuild is safe here
--
-- Nothing has a foreign key pointing AT automation_rules: 0010 gave
-- automation_runs.rule_id no FK on purpose, so a rule's history outlives the
-- rule. That is what makes DROP + RENAME safe — with an inbound FK and
-- foreign_keys(1) on, this same procedure inside a transaction would take the
-- run history with it. The table's OUTGOING references (accounts, users) are
-- unaffected: every copied row already satisfies them.
--
-- The copy is column-by-column and explicit. `INSERT INTO … SELECT *` would
-- bind by position, and a rebuild is exactly the moment position is easiest to
-- get wrong.
--
-- Indexes go with the dropped table and are recreated verbatim from 0010.
--
-- # This does not break 0028's house rule
--
-- 0028 states it: new state gets a new table, never an ALTER. The rule is about
-- adding STATE — a column bolted onto a shipped table is a change every
-- existing row silently participates in. Nothing is added here. The columns are
-- 0010's, unchanged, and the ALTER is a RENAME that is the last step of the
-- rebuild rather than a way to smuggle a column in. If this migration needed to
-- store something new about a rule, it would still be a new table.

CREATE TABLE automation_rules_next (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,

    created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by_snapshot TEXT NOT NULL DEFAULT '',

    -- The one line this migration exists to change: 'clip' joins the closed set.
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule','threshold','event','clip')),
    trigger_json TEXT NOT NULL DEFAULT '{}',

    condition_json TEXT NOT NULL DEFAULT '[]',

    action_json TEXT NOT NULL DEFAULT '{}',
    action_tier INTEGER NOT NULL DEFAULT 0,

    min_interval_s INTEGER NOT NULL DEFAULT 0,

    last_occurrence_at INTEGER,
    last_fired_at      INTEGER,
    last_outcome       TEXT NOT NULL DEFAULT '',

    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    disabled_reason      TEXT NOT NULL DEFAULT '',
    disabled_at          INTEGER,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO automation_rules_next (
    id, account_id, name, enabled,
    created_by, created_by_snapshot,
    trigger_kind, trigger_json,
    condition_json,
    action_json, action_tier,
    min_interval_s,
    last_occurrence_at, last_fired_at, last_outcome,
    consecutive_failures, disabled_reason, disabled_at,
    created_at, updated_at
)
SELECT
    id, account_id, name, enabled,
    created_by, created_by_snapshot,
    trigger_kind, trigger_json,
    condition_json,
    action_json, action_tier,
    min_interval_s,
    last_occurrence_at, last_fired_at, last_outcome,
    consecutive_failures, disabled_reason, disabled_at,
    created_at, updated_at
FROM automation_rules;

DROP TABLE automation_rules;
ALTER TABLE automation_rules_next RENAME TO automation_rules;

CREATE INDEX automation_rules_account_idx ON automation_rules (account_id, created_at DESC);
CREATE INDEX automation_rules_due_idx ON automation_rules (enabled, trigger_kind);
