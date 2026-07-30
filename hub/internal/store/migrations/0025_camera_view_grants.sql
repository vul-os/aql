-- Who may watch recorded footage (docs/CAMERA-RETENTION.md §2.4).
--
-- `camera:view` is a grant per member, and it is NOT implied by `owner` or
-- `admin`. That breaks the pattern everywhere else in this product, where admin
-- means "can configure the thing", and the inconsistency is the point: here it
-- would mean "can watch the other residents", and those are not the same
-- authority. An account owner in a shared house is usually just whoever set up
-- the hub.
--
-- A fresh install therefore grants this to nobody. Recording with no viewer is a
-- valid and reasonable state — the clips exist for an incident.
--
-- # Per camera, not per account
--
-- §5 left this open: "Is `camera:view` per-camera or per-account? Per-camera is
-- obviously more correct — a doorbell and a bedroom hallway are not the same
-- permission — and obviously more UI. Not decided."
--
-- Decided here: per camera. The objection was UI cost, and UI cost is a reason
-- to ship a narrower UI, not a reason to widen an authority over recordings of
-- people's homes. It is also the direction that cannot be taken later without a
-- migration AND a permission-model change, whereas an account-wide grant can
-- always be expressed as a grant per camera.
--
-- # Windowed by construction
--
-- ends_at is nullable but the product should usually set it. §2.4: "An
-- investigation is usually bounded and the permission should be too." Expiry is
-- evaluated on read rather than by a sweep, so a grant that has run out stops
-- working even if nothing has run to tidy it up — the failure direction that
-- matters for a permission is closed, not open.

CREATE TABLE camera_view_grants (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- The member who may watch.
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The engine device key of ONE camera. There is deliberately no wildcard:
    -- an account-wide grant is expressible as several rows, and a wildcard is
    -- the thing that quietly turns into "everything, including the camera added
    -- next year".
    device_key TEXT NOT NULL,
    -- NULL means no expiry, which the console should discourage.
    starts_at  INTEGER,
    ends_at    INTEGER,
    -- Who granted it. ON DELETE SET NULL like every other actor column here:
    -- the audit chain covers a snapshot of this, so the row may lose the
    -- reference without losing the fact.
    granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    -- One live grant per (member, camera). A second is an update, not a stack:
    -- two overlapping grants with different windows is a question about which
    -- one governs, and there is no good answer to it.
    UNIQUE (account_id, user_id, device_key)
);
CREATE INDEX camera_view_grants_member_idx ON camera_view_grants (account_id, user_id, revoked_at);

-- Note on what is NOT here: a table of views.
--
-- §2.5 requires every view and export to be recorded, and says where: "The hash
-- chain already covers this: admin_audit_log is append-only with per-row
-- hashing, verifiable off-box against a cold backup." A second, unchained table
-- would be the one place in this product where a record of who watched whom is
-- easier to edit than the record of who opened a gate.
--
-- What that leaves is a READ problem rather than a write one. admin_audit_log is
-- admin-only, and §2.5 is explicit that "every member of the account can read
-- the camera-access log — not just admins ... restricting it to admins would
-- mean the people most affected are the only ones who cannot check." That is
-- solved with a scoped query over the existing table, not a new one.
