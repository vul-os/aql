-- 0006_late_ack_reconcile.sql
-- Stage 6: late cmd.ack reconciliation (proto/commands.md "The lost-ack
-- case, specified honestly" — the v1 fix for a stated v0 gap). A cmd.ack
-- that verifies but arrives after the ack-wait deadline carries the
-- controller's own signed word on whether the gate actually opened, and
-- must not just be logged and dropped.
--
-- Append-only discipline: the ORIGINAL row (already tagged 'undelivered' at
-- the time) is never mutated — "we didn't hear back by the deadline" stays
-- true forever, exactly as recorded. The late ack instead lands as a NEW
-- row that references the original via reconciles_log_id, so "we heard
-- back late, and here is what it said" is a separate, equally durable
-- fact — the two are never collapsed into one.
CREATE INDEX access_logs_reconciles_idx ON access_logs (reconciles_log_id);

-- The reconciles_log_id column is now declared in 0001 alongside the table.
-- Migrations here are CREATE-only: a schema is stated once, in the file that
-- creates the table, rather than assembled from a trail of ALTERs.
