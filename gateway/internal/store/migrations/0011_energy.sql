-- 0011_energy.sql
-- Phase 4: energy metering — ingestion, rollups, source-mix accounting.
--
-- The engine that writes these tables is internal/energy. It reads devices
-- declaring the CapMeter capability (internal/devices/capability.go), whose
-- only verb is `read` at TierRead: metering observes, it never actuates, and
-- nothing in this schema is on an actuation path.
--
-- THE ONE RULE THIS SCHEMA EXISTS TO ENFORCE
--
-- A measurement system that quietly invents numbers is worse than none. Every
-- shape below is chosen so that "we did not observe this" is representable and
-- distinguishable from "this was zero":
--
--   * energy_rollups.kwh is NULLABLE. A period with no attributable energy
--     stores NULL, not 0.0, and the Go layer surfaces it as *float64(nil). A
--     renderer that forgets the distinction gets a nil pointer, not a
--     confident low bar.
--   * energy_rollups.coverage_seconds / expected_seconds carry the gap
--     explicitly. gap = expected - coverage. An hour with 900s of coverage is
--     a quarter-observed hour whatever its kwh says.
--   * energy_rollups.estimated_kwh isolates the portion of kwh that was
--     interpolated across a gap. kwh - estimated_kwh is the measured floor.
--   * energy_deltas.quality records HOW each energy difference was obtained,
--     and keeps the two raw counter endpoints, so a bill dispute can be
--     re-derived from the stored evidence rather than re-argued.
--
-- TENANCY — app-layer, as everywhere else in this schema (see 0001_baseline.sql
-- and the internal/store package doc). Every table carries account_id and every
-- accessor scopes on it. Postgres RLS does not exist in SQLite.
--
-- CONVENTIONS — ids TEXT, timestamps INTEGER unix seconds UTC, booleans
-- INTEGER 0/1. Energy is REAL kWh, power is REAL kW; a channel's `scale`
-- converts a device's own units into those two.

-- energy_channels — the ATTRIBUTION table.
--
-- A channel is one (device, metric) pair: a single reading stream. A physical
-- inverter that reports `kwh_charge` and `kwh_discharge` is two channels, which
-- is the only way a battery's charge and discharge can be attributed in
-- opposite directions.
--
-- Attribution is DECLARED, never inferred from a device's name. Guessing that
-- a device called "Solar Inverter" measures solar is exactly the class of
-- invention this package refuses. A channel the engine has never been told
-- about is auto-created with source='unattributed' so its energy is recorded
-- and visible rather than dropped — but source-mix accounting reports it as an
-- explicit unattributed bucket instead of folding it into grid or solar.
--
-- device_key is the registry's globally-unique key, Key(driverID, deviceID)
-- from internal/devices/model.go, e.g. "mqtt:meter-main". It is deliberately
-- NOT a foreign key to the `devices` table: that table is paired access
-- controllers, a different population.
CREATE TABLE energy_channels (
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_key  TEXT NOT NULL,
    metric      TEXT NOT NULL,          -- devices.Reading.Metric, e.g. 'kwh', 'kw'

    -- kind decides how energy is derived, and it changes what a gap MEANS.
    --   counter — a cumulative kWh register. Energy is the difference between
    --             consecutive readings. A comms gap loses time RESOLUTION but
    --             not energy: the next reading still includes everything that
    --             happened while we were not listening.
    --   power   — an instantaneous kW reading. Energy is the trapezoidal
    --             integral between consecutive readings. A comms gap loses the
    --             energy outright; nothing in a later sample recovers it.
    -- That asymmetry is why the engine interpolates counter gaps (marked
    -- estimated) and refuses to interpolate power gaps.
    kind        TEXT NOT NULL CHECK (kind IN ('counter','power')),

    source      TEXT NOT NULL CHECK (source IN
                  ('grid','solar','battery','generator','load','unattributed')),
    -- flow is the direction relative to the site.
    --   supply — energy arriving (grid import, solar production, battery discharge)
    --   sink   — energy leaving or being stored (grid export, battery charge)
    -- 'load' channels are sub-meters measuring consumption downstream of a
    -- supply point. They are reported separately and are NEVER summed into the
    -- source mix, because doing so double-counts energy already attributed at
    -- its source.
    flow        TEXT NOT NULL CHECK (flow IN ('supply','sink')),

    label       TEXT NOT NULL DEFAULT '',
    -- scale converts the device's units to kWh (counter) or kW (power).
    -- 1 for a meter reporting kWh/kW, 0.001 for one reporting Wh/W.
    scale       REAL NOT NULL DEFAULT 1,

    -- counter_max is the value at which a cumulative register rolls over and
    -- restarts (e.g. 99999.9 for a 6-digit display). NULL means unknown, and
    -- unknown is honest: with no declared maximum a backwards step CANNOT be
    -- distinguished from a wrap, so the engine calls it a reset and marks the
    -- affected period as a lower bound rather than inventing a rollover.
    counter_max REAL,
    -- max_kw is the channel's plausible ceiling, used only to sanity-check a
    -- candidate wrap. NULL disables the check.
    max_kw      REAL,

    -- interval_seconds is how often the engine expects a sample.
    -- gap_tolerance_seconds is how long a gap between two consecutive samples
    -- may be before the interval between them stops counting as observed
    -- coverage. Default 300s = five missed 60s polls.
    interval_seconds      INTEGER NOT NULL DEFAULT 60,
    gap_tolerance_seconds INTEGER NOT NULL DEFAULT 300,

    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, device_key, metric)
);
CREATE INDEX energy_channels_source_idx ON energy_channels (account_id, source);

-- energy_samples — raw observations, exactly as the device reported them.
--
-- The primary key is keyed on the reading's OWN timestamp (`at`), not on
-- arrival order. Samples are not assumed to arrive in order and a re-delivered
-- sample for an instant already stored is idempotent rather than a duplicate.
--
-- at_source records whose clock `at` came from. A driver that returns a
-- Reading with a zero At is stamped by the gateway at ingest, and this column
-- says so — a sample timestamped by the receiver is weaker evidence than one
-- timestamped by the meter, and a dispute should be able to see which it has.
--
-- value is stored RAW (pre-scale) so a mis-declared `scale` is a correctable
-- configuration error rather than a corrupted archive.
CREATE TABLE energy_samples (
    account_id  TEXT NOT NULL,
    device_key  TEXT NOT NULL,
    metric      TEXT NOT NULL,
    at          INTEGER NOT NULL,       -- the reading's own clock
    value       REAL,                   -- NULL when the reading was non-numeric
    text        TEXT NOT NULL DEFAULT '', -- Reading.Text, e.g. 'fault'
    at_source   TEXT NOT NULL DEFAULT 'device'
                CHECK (at_source IN ('device','gateway')),
    received_at INTEGER NOT NULL,       -- the gateway's clock at ingest
    PRIMARY KEY (account_id, device_key, metric, at),
    FOREIGN KEY (account_id, device_key, metric)
        REFERENCES energy_channels (account_id, device_key, metric) ON DELETE CASCADE
);
CREATE INDEX energy_samples_at_idx ON energy_samples (at);

-- energy_deltas — one energy difference between two consecutive samples, with
-- the evidence that produced it. This is the audit record: rollups are a
-- summary of this table and can be rebuilt from it, but this table is derived
-- from energy_samples and can itself be rebuilt from them.
--
-- Deltas are recomputed over a window rather than streamed, so a late sample
-- landing between two already-processed ones re-derives the pair it split.
--
-- quality is how the number was obtained:
--   measured   — counter channel, both endpoints in one monotonic run.
--                kwh = (to_value - from_value) * scale. Trustworthy.
--   wrap       — counter went backwards, a counter_max is declared, and the
--                implied rollover is plausible against max_kw.
--                kwh = (counter_max - from_value + to_value) * scale.
--   reset      — counter went backwards with no plausible rollover. The meter
--                restarted. kwh = to_value * scale, which is a LOWER BOUND:
--                whatever accumulated between from_at and the reset instant is
--                unrecoverable. Any rollup containing a reset is flagged.
--   integrated — power channel, normal interval. kwh is the trapezoid
--                (from_value + to_value)/2 * dt/3600 * scale.
--   estimated  — the figure did not come from two observed samples. Reserved
--                for imported or back-filled energy; the engine never writes
--                it, because everything it derives comes from readings it
--                actually holds. It exists so an import path has somewhere
--                honest to put a number instead of calling it measured.
--
-- quality and spans_gap are ORTHOGONAL. quality is how the number was derived;
-- spans_gap is whether the interval it covers was observed. A counter delta
-- across a two-hour outage is genuinely `measured` — the register did not
-- forget — while still spanning time nobody watched. A gap-spanning delta
-- therefore contributes energy but contributes NO coverage: the interior must
-- keep showing as a gap.
--
-- A power channel across a gap produces NO delta row at all. Nothing a power
-- reading says later recovers the energy, and any shape drawn across the gap
-- would be fiction.
CREATE TABLE energy_deltas (
    account_id  TEXT NOT NULL,
    device_key  TEXT NOT NULL,
    metric      TEXT NOT NULL,
    from_at     INTEGER NOT NULL,
    to_at       INTEGER NOT NULL,
    kwh         REAL NOT NULL,
    quality     TEXT NOT NULL CHECK (quality IN
                  ('measured','wrap','reset','integrated','estimated')),
    spans_gap   INTEGER NOT NULL DEFAULT 0,
    from_value  REAL,                   -- raw endpoints, pre-scale, retained
    to_value    REAL,                   -- so the figure can be re-derived
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, device_key, metric, to_at),
    FOREIGN KEY (account_id, device_key, metric)
        REFERENCES energy_channels (account_id, device_key, metric) ON DELETE CASCADE
);
CREATE INDEX energy_deltas_window_idx ON energy_deltas (account_id, device_key, metric, from_at);

-- energy_rollups — hourly, daily and monthly aggregates, one row per
-- (channel, grain, timezone, bucket).
--
-- Buckets are timezone-anchored because a bill is a local-time document: a
-- "day" is midnight to midnight where the meter is, and a DST day is 23 or 25
-- hours long, which is why expected_seconds is stored per row rather than
-- assumed to be 86400. tz is part of the key so the same channel can be rolled
-- up under two zones without one silently overwriting the other.
--
-- Day rows are computed from that day's hour rows and month rows from the
-- month's day rows, so a late sample re-rolls one hour and two summaries
-- rather than rescanning a year of samples.
--
-- The source is NOT denormalised here. Re-tagging a channel from
-- 'unattributed' to 'solar' must change every report immediately; a copy of
-- the attribution frozen into a year of rollup rows would make corrections
-- silently partial. Reports join energy_channels.
CREATE TABLE energy_rollups (
    account_id  TEXT NOT NULL,
    device_key  TEXT NOT NULL,
    metric      TEXT NOT NULL,
    grain       TEXT NOT NULL CHECK (grain IN ('hour','day','month')),
    tz          TEXT NOT NULL,          -- IANA name; 'UTC' by default
    bucket_start INTEGER NOT NULL,      -- inclusive
    bucket_end   INTEGER NOT NULL,      -- exclusive

    -- kwh is NULLABLE and NULL is the point. It is NULL exactly when no
    -- energy was attributed to this bucket at all — whether because nothing
    -- was recorded, or because what was recorded could not honestly be
    -- attributed here. It is never 0.0 standing in for "we did not see". The
    -- Go layer surfaces it as *float64, so a renderer that forgets the
    -- distinction gets a nil pointer rather than a confident low bar; quality
    -- says which of the two cases it is.
    kwh         REAL,
    -- estimated_kwh is the part of kwh that was interpolated across a gap.
    -- kwh - estimated_kwh is the measured floor.
    estimated_kwh REAL NOT NULL DEFAULT 0,

    -- coverage_seconds is how much of [bucket_start, bucket_end) is actually
    -- covered by observed sample intervals. Intervals longer than the
    -- channel's gap tolerance contribute none of it.
    coverage_seconds INTEGER NOT NULL DEFAULT 0,
    expected_seconds INTEGER NOT NULL,

    sample_count INTEGER NOT NULL DEFAULT 0,
    delta_count  INTEGER NOT NULL DEFAULT 0,
    -- reset_count > 0 means at least one counter restart falls in this bucket,
    -- so kwh is a lower bound however complete the coverage looks.
    reset_count  INTEGER NOT NULL DEFAULT 0,

    -- Power statistics, populated only for kind='power' channels: a counter
    -- channel has no instantaneous reading to take a minimum of, and deriving
    -- one from kwh/hours would be a different quantity wearing the same name.
    min_kw      REAL,
    max_kw      REAL,
    mean_kw     REAL,

    -- quality is the single field a renderer may branch on:
    --   complete  — fully covered, no reset, nothing interpolated.
    --   partial   — a gap exists and was NOT filled. kwh is a floor; the true
    --               value is higher. Render the missing span as absent, never
    --               as zero. Also used when a counter reset falls inside.
    --   estimated — a gap exists and WAS filled by interpolation.
    --               estimated_kwh of the total is a guess about time nobody
    --               observed. Render with an explicit estimate marker.
    --   empty     — no evidence at all. kwh IS NULL.
    quality     TEXT NOT NULL CHECK (quality IN ('complete','partial','estimated','empty')),
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, device_key, metric, grain, tz, bucket_start),
    FOREIGN KEY (account_id, device_key, metric)
        REFERENCES energy_channels (account_id, device_key, metric) ON DELETE CASCADE
);
CREATE INDEX energy_rollups_range_idx
    ON energy_rollups (account_id, grain, tz, bucket_start);

-- energy_rollup_dirty — the incremental-rollup work queue.
--
-- Ingest marks the buckets a new or re-derived delta touches; the roller drains
-- the queue and recomputes only those. This is what keeps a read from
-- recomputing history, and — because the marks are durable rows rather than an
-- in-memory set — what makes a crash between ingest and rollup recoverable
-- instead of silently leaving a stale bucket behind.
--
-- Ingest marks grain='hour'. The roller marks the covering 'day' and 'month'
-- rows as it recomputes each hour, so an interrupted pass resumes rather than
-- losing the summaries.
CREATE TABLE energy_rollup_dirty (
    account_id  TEXT NOT NULL,
    device_key  TEXT NOT NULL,
    metric      TEXT NOT NULL,
    grain       TEXT NOT NULL CHECK (grain IN ('hour','day','month')),
    tz          TEXT NOT NULL,
    bucket_start INTEGER NOT NULL,
    marked_at   INTEGER NOT NULL,
    PRIMARY KEY (account_id, device_key, metric, grain, tz, bucket_start),
    FOREIGN KEY (account_id, device_key, metric)
        REFERENCES energy_channels (account_id, device_key, metric) ON DELETE CASCADE
);
CREATE INDEX energy_rollup_dirty_order_idx ON energy_rollup_dirty (grain, marked_at);
