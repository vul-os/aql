-- Issued offline grants, so the hub can say which are revoked.
--
-- docs/GRANT-REVOCATION.md §6 step 5. The controller half of revocation ships;
-- this is the prerequisite it surfaced. `POST /v1/offline-grants` minted a
-- grant, signed it, returned it, wrote an admin-audit row and kept NOTHING —
-- so there was no set to select "revoked and unexpired" from, and the revoke
-- button the console already offers had nowhere to write a fact the hub could
-- later send to a controller.
--
-- # Why not read admin_audit_log, which already has every field
--
-- Because it is EVIDENCE, and this is STATE. `admin_audit_log` is hash-chained
-- and append-only precisely so that what it says never changes; a deny-list
-- changes when a grant is revoked, when a member is reinstated, and when an
-- entry expires. Querying the chain to decide what to actuate is the category
-- error 0010 refused for automation_runs, and it would hang a mutable
-- operational read on the one table whose worth is that it is immutable.
--
-- # What is NOT stored, and why
--
-- The grant BYTES. The controller verifies what is presented to it against the
-- pinned hub key; nothing needs the hub to reproduce a signed grant later, and
-- storing it would put a live credential at rest for no purpose. Only the
-- facts needed to answer "is this id revoked, and is it still worth telling a
-- controller about" are kept.
--
-- Also not stored: access points. A grant's access points matter at
-- REDEMPTION, and the controller reads them from the presented grant. For
-- revocation the unit is the whole grant (§3.1), so the access-point list would
-- be recorded and never read.

CREATE TABLE offline_grants (
    -- The id the controller sees and the deny-list names.
    grant_id TEXT PRIMARY KEY,

    -- Who holds it. Nullable actor with a snapshot beside it, matching 0010's
    -- treatment: a deleted user must not erase the record that a grant was
    -- issued, because that record is what makes the grant revocable.
    member_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    member_snapshot  TEXT NOT NULL DEFAULT '',

    -- The grant's own window, copied from what was signed. expires_at is the
    -- load-bearing one: it is what makes the deny-list self-pruning, because a
    -- grant past it is already refused by the controller's validity step.
    issued_at  INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,

    -- Revocation. NULL means active; there is no status column, because two
    -- representations of "revoked" is two chances to read one of them wrong —
    -- the same argument 0028 makes for absence meaning off.
    revoked_at      INTEGER,
    revoked_by      TEXT REFERENCES users(id) ON DELETE SET NULL,

    created_at INTEGER NOT NULL
);

-- The deny-list query: revoked, not yet expired, for one controller.
CREATE INDEX offline_grants_revoked_idx ON offline_grants (revoked_at, expires_at);
-- The console's list: what this member holds.
CREATE INDEX offline_grants_member_idx ON offline_grants (member_user_id, expires_at DESC);

-- Which controllers a grant names.
--
-- A grant can span access points in DIFFERENT accounts — the issuance handler
-- resolves each one independently and checks membership per access point — so
-- the controller list is the only correct way to scope a deny-list to the
-- device that will consult it. Scoping by account would be wrong for exactly
-- the grants that are hardest to reason about.
CREATE TABLE offline_grant_devices (
    grant_id  TEXT NOT NULL REFERENCES offline_grants(grant_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    PRIMARY KEY (grant_id, device_id)
);
CREATE INDEX offline_grant_devices_device_idx ON offline_grant_devices (device_id);

-- The monotonic counter behind a revocation list's `seq`.
--
-- ONE row, hub-wide, for the reason above: a grant can name devices in more
-- than one account, so a per-account counter would not be monotonic from the
-- point of view of a controller that sees such a grant. A controller only
-- requires the number to increase, never that it increase by one, so a shared
-- counter is correct and a shared counter is what this is.
--
-- Stored rather than derived. It cannot come from revocation timestamps — two
-- revocations in the same second collide — and it must survive a restart, or a
-- reboot would let an attacker replay a list the controller had already moved
-- past (§3.5).
CREATE TABLE offline_grant_revocation_seq (
    -- CHECK pins it to a single row: a second row would be a second counter,
    -- and two counters cannot both be the one the controller compares against.
    id  INTEGER PRIMARY KEY CHECK (id = 1),
    seq INTEGER NOT NULL DEFAULT 0
);
INSERT INTO offline_grant_revocation_seq (id, seq) VALUES (1, 0);
