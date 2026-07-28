-- Per-device ownership: the thing the device engine has never had.
--
-- A driver discovers devices from an MQTT broker, a Modbus PLC or an ONVIF
-- probe. None of those carries a tenant, so a device cannot say whose it is,
-- and until now nothing could answer "may this member drive this lamp". The
-- interim gate (httpapi/engine.go's requireEngineAuthority) answered a
-- narrower question instead — is this caller's authority hub-wide — which
-- closed a real cross-account hole but left a multi-account hub with no
-- usable device screens at all.
--
-- This is the model that replaces the guess. It does NOT try to infer an
-- owner. It records a CLAIM: a human with admin rights over an account says
-- "this device is ours", and that assertion is what every later decision
-- reads. Inference was never available; assertion is, and it has the great
-- advantage of being auditable.
--
-- # Why a separate table rather than a column on a devices table
--
-- There is no devices table to add a column to. The engine's fleet is not
-- persisted — it is whatever the drivers report at runtime, rebuilt on every
-- start, and a device that vanishes from the broker vanishes from the fleet.
-- Ownership must outlive that: an unplugged lamp is still yours, and it must
-- still be yours when it comes back. So the claim is keyed on the engine's
-- stable device key ("driver:id", the value the registry already guarantees
-- is stable across restarts for the same physical device) and holds no
-- foreign key to a device row that does not exist.
--
-- The consequence to be honest about: a claim can name a device the engine
-- has never seen, and a device can disappear while its claim remains. Both
-- are correct — the alternative is silently forgetting who owns something the
-- moment it goes offline, which is exactly when ownership matters most.
--
-- # First claim wins, and only an account admin may make one
--
-- Same shape as controller pairing, for the same reason: the first assertion
-- is the one that cannot be authenticated against anything, so it is the one
-- that must be deliberate and recorded. A second account claiming an owned
-- device is REFUSED rather than allowed to take it over — a takeover would
-- let anyone with an account on the hub steal a neighbour's devices one
-- request at a time, which is the hole this whole change exists to close.
--
-- Releasing is a separate, audited act. It is how a device legitimately
-- changes hands.

CREATE TABLE device_ownership (
    -- The engine's stable key: "driver:id" (devices.IndexedDevice.Key).
    -- PRIMARY KEY is the enforcement of first-claim-wins: a second INSERT for
    -- the same device fails at the database rather than at an if-statement
    -- somebody has to remember.
    device_key  TEXT PRIMARY KEY,

    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    -- Who asserted it. ON DELETE SET NULL because a claim outlives the
    -- person who made it — the device is still the account's.
    claimed_by  TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Operator-facing label recorded AT CLAIM TIME, so an audit reader can
    -- tell what was claimed even after the device has gone offline and the
    -- engine can no longer say what it was. Never authoritative: the live
    -- name comes from the driver.
    label       TEXT NOT NULL DEFAULT '',

    claimed_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- The read every engine request makes: "which devices does this account own".
CREATE INDEX device_ownership_account_idx ON device_ownership (account_id);
