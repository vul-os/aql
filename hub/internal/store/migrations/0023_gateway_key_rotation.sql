-- Rotating the hub's signing key without stranding a controller.
--
-- Controllers pin the hub's Ed25519 public key at pairing and refuse to change
-- it outside a signed `repair` command (controller/internal/state's
-- ErrKeyChangeRefused). The controller half of that has been complete since
-- pairing was written. The hub half — anything that ever SENDS a repair — did
-- not exist, so `repair` was a command the protocol defines, the controller
-- implements, the conformance vectors cover, and nothing could issue.
--
-- # Why two keys have to be retained, and why a precondition cannot avoid it
--
-- Rotation is not atomic and cannot be made so. The obvious design — check that
-- every controller is online, then rotate them all — fails on the controller
-- that drops between the check and its own repair. It is still pinning the old
-- key, and if the hub has discarded that key it can never sign another repair
-- for it. The controller is then unreachable by any command for the rest of its
-- life, recoverable only by a physical factory reset, which for a gate
-- controller means someone with a ladder.
--
-- So the hub retains both keys and signs each command with whichever key the
-- TARGET controller currently pins, until every controller has moved. That is
-- what device_key_pins records. The old key is destroyed only when nothing pins
-- it any more.
--
-- # Why the pinned PUBLIC KEY and not a generation number
--
-- A generation number is a claim about history that has to stay in step with
-- two seed files and a table. The public key is the thing itself: a controller
-- pinning a key that is neither the current nor the previous one is visibly
-- wrong rather than plausibly renumbered, and it survives a restore from a
-- backup taken mid-rotation without anyone having to reason about counters.
--
-- # What is deliberately NOT here
--
-- The private keys. They stay in 0600 files beside the database
-- (keys.Load's gateway_ed25519.seed, and gateway_ed25519.previous.seed for the
-- duration of a rotation) because that is where this hub has always kept them,
-- and moving them into the database would put the signing identity into every
-- backup of it. Only the public halves and the bookkeeping live here.

CREATE TABLE gateway_key_rotations (
    id           TEXT PRIMARY KEY,
    started_at   INTEGER NOT NULL,
    completed_at INTEGER,
    -- Both public keys, base64url unpadded, exactly as controllers pin them and
    -- /v1/gateway/key serves them.
    previous_pub TEXT NOT NULL,
    new_pub      TEXT NOT NULL,
    -- Why someone rotated. A rotation is a rare, deliberate act — usually
    -- because a key is believed compromised — and the reason is the first thing
    -- anyone reading this table later will want.
    reason       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX gateway_key_rotations_open_idx ON gateway_key_rotations (completed_at);

CREATE TABLE device_key_pins (
    device_id     TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    -- The public key this controller is believed to pin. Believed, not known:
    -- it is written when a repair is acknowledged, and a controller that
    -- acknowledged and then failed to persist would disagree. The controller
    -- persists before acking (state.go orders it that way deliberately), so the
    -- disagreement is bounded to a crash inside that window.
    pinned_pub    TEXT NOT NULL,
    -- The nonce of the repair command in flight, and when it was sent. Cleared
    -- when the matching ack arrives.
    --
    -- Nonce-correlated for the same reason controller_clock_syncs is: an ack's
    -- result is "ok" for every command kind, so nothing else distinguishes the
    -- acknowledgement of a repair from the acknowledgement of the lift that
    -- happened to follow it. Rotating a key on the strength of an ambiguous ack
    -- would mean the hub stops signing with a key the controller still pins.
    pending_nonce TEXT,
    pending_at    INTEGER,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX device_key_pins_pinned_idx ON device_key_pins (pinned_pub);
