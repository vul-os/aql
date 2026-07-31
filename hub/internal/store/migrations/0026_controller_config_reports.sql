-- What actuation configuration is a controller ACTUALLY running?
--
-- The hub could send `pulse_ms` and `hold_max` and never ask what they are. An
-- operator changing a gate's pulse had no way to confirm it landed, and a gate
-- nobody had configured showed nothing at all — which reads as "unset" and is
-- not: it is running the firmware's defaults, and always was.
--
-- proto/commands.md's `ctl.report` closes that, and this is where it lands. See
-- docs/CONTROLLER-CONFIG-REPORT.md for why the carrier is a session report
-- rather than the ack: a gate nobody has commanded would otherwise never
-- report, leaving the hub's view emptiest for the quietest controllers.
--
-- # Why this is not the configuration the hub SENDS
--
-- Deliberately its own table, and deliberately not merged into anything that
-- holds outbound config. What the hub sent and what a controller is running are
-- different facts, and the entire point of the feature is that they can differ.
-- Storing them together invites code that reads one and reports the other, at
-- which point the hub is confidently wrong about a gate — the failure this was
-- built to stop.
--
-- It authorises nothing. Nothing here relaxes hold_max, lifts lockdown or
-- affects what a controller will accept. It is display data, and its separation
-- is what keeps that true.
--
-- # Why last-write-wins and not a history
--
-- One row per device, replaced on each report. A configuration is a STATE and
-- the question is always "what is it now". A history would be a second event
-- log, and controller_events (0019) already exists for things that happened; if
-- someone later wants the trail, that is where it belongs.
--
-- # Why the payload is JSON rather than columns
--
-- The report carries only the keys a controller actually resolves — today
-- pulse_ms and hold_max — and that set is expected to grow as the controller
-- learns tunables. Columns would mean a migration per key, and the hub does not
-- need to query inside this: it reads the whole thing to show it. A key the hub
-- has never heard of is stored and displayed rather than dropped, which is the
-- same direction of compatibility the wire has.
--
-- reported_at is the CONTROLLER's clock, from the signed message; received_at is
-- the hub's. Keeping both is what makes a controller with a wrong clock
-- diagnosable instead of merely confusing.

CREATE TABLE controller_config_reports (
    device_id   TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,

    -- The `config` object from the signed report, verbatim JSON:
    --   {"pulse_ms":{"value":700,"source":"default"}, …}
    -- Verbatim so an unknown key survives to be shown. `source` is what makes
    -- 700 and "700 (default)" different claims.
    config      TEXT NOT NULL,

    -- Firmware the controller reported. May be empty: a build that does not
    -- know its own version says so rather than claiming one.
    firmware    TEXT NOT NULL DEFAULT '',

    reported_at INTEGER NOT NULL,  -- the controller's clock, from the message
    received_at INTEGER NOT NULL   -- the hub's clock, when it arrived
);
