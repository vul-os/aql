-- The clip index for camera recording (docs/CAMERA-RETENTION.md §2.1).
--
-- SQLite holds one row per clip — device, start, duration, size, and why it was
-- kept — and never the bytes. A hub runs on a Pi with an SD card or a USB disk,
-- and a database holding video is one that cannot be backed up, vacuumed or
-- copied by ordinary means; worse, a corrupt page takes the access audit trail
-- down with the footage.
--
-- The path is stored rather than derived. It is derivable — the layout is
-- `<data>/recordings/<account>/<device>/<YYYY-MM-DD>/<start>-<dur>s.mp4` — but
-- deriving it at delete time means a change to the layout silently orphans every
-- older clip, leaving files nothing will ever reclaim on the one resource this
-- feature is most likely to exhaust.
--
-- # Why the row can outlive the file, and must
--
-- §2.1 makes a deliberate promise: "someone who wants footage of themselves gone
-- should not need this software to cooperate" — the layout is date-partitioned
-- so a human can `rm -rf` a day by hand. That means a missing file is a
-- SUPPORTED state, not corruption, and nothing here may treat it as an error or
-- try to recreate it.
--
-- deleted_at is what distinguishes the two ways a clip ends: expired by the
-- retention worker, or gone because someone removed it. Both leave the index row
-- so the gap in the timeline is visible — §2.6 is explicit that a resident who
-- goes looking for the evening they cared about must be told it was dropped and
-- when, not shown an empty list that reads the same as a camera that never
-- recorded.

CREATE TABLE camera_clips (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- The engine device key, not a devices(id): a camera is an engine device
    -- discovered by a driver, and those are not rows in `devices` (that table is
    -- access controllers). No foreign key for the same reason.
    device_key  TEXT NOT NULL,
    -- Unix seconds. started_at is the wall-clock instant the first frame in this
    -- clip was received, which is the hub's clock and not the camera's — a
    -- camera's clock is frequently wrong and is never authoritative here.
    started_at  INTEGER NOT NULL,
    duration_s  INTEGER NOT NULL,
    size_bytes  INTEGER NOT NULL,
    -- Relative to the recordings root, so moving the data directory does not
    -- invalidate every row.
    rel_path    TEXT NOT NULL,
    -- Why this clip was kept, for the operator reading a timeline later.
    -- 'continuous' is the only producer today; motion/event recording would add
    -- values here rather than a second table.
    reason      TEXT NOT NULL DEFAULT 'continuous',
    -- NULL while the clip is on disk. Set when the retention worker expires it
    -- or when a sweep finds the file already gone.
    deleted_at  INTEGER,
    -- Distinguishes the two ways deleted_at gets set, because they mean opposite
    -- things to someone auditing a gap: 'expired' is the policy working,
    -- 'missing' is a file that left without the product's involvement — which
    -- §2.1 explicitly permits and which must therefore not read as a fault.
    deleted_why TEXT,
    created_at  INTEGER NOT NULL
);

-- The retention sweep's two queries: expire per camera by age, and evict oldest
-- first ACROSS all cameras when free space runs low (§2.3 — a busy camera must
-- not be able to evict a quiet one preferentially).
CREATE INDEX camera_clips_live_idx ON camera_clips (deleted_at, started_at);
CREATE INDEX camera_clips_device_idx ON camera_clips (account_id, device_key, started_at DESC);
