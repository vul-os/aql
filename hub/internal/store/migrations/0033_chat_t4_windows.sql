-- Operator-armed windows for T4 verbs over chat — CHAT-COMMANDS.md §3.4.
--
-- WHAT THIS IS. A T4 verb (mower `start`, `disarm`, a robot move) is refused
-- over chat unless an operator has ARMED a window for that exact (device, verb)
-- from the console: "the mower may be started from chat for the next 30
-- minutes". Outside a live window, chat T4 is refused with the honest reason and
-- a console link. This table is the window.
--
-- WHY A NEW TABLE RATHER THAN temporary_access_grants.
--
-- §3.4 says the mechanism "already exists and does not need inventing" and
-- points at the temporary-grant machinery — {starts_at, ends_at, max_uses,
-- status}, an EffectiveStatus ladder, an atomic consume, a refund. That reading
-- is right about the SHAPE and wrong about the table, and the difference is not
-- stylistic:
--
--   * A temporary grant's subject is a VISITOR'S PHONE NUMBER and its object is
--     an ACCESS POINT. Both are columns, both are NOT NULL, and both are joined
--     through temporary_access_grant_access_points. A T4 window has neither: its
--     subject is the operator who armed it and its object is a (device_key,
--     verb) pair the engine owns. Storing a window there would mean either
--     inventing a phone number for a device or widening columns that mean
--     something specific — and this repository does not ALTER, it rebuilds.
--
--   * The consume rules differ. TryConsumeGrant matches on
--     (phone_e164, access_point_id) and picks the SOONEST-EXPIRING match. A
--     window is claimed by whichever linked member sends the message, and the
--     narrower thing to match on is the device and the verb.
--
--   * Revoking a visitor's access and disarming a mower are different operator
--     actions with different audiences, and a shared table makes one list show
--     the other.
--
-- So: the same shape, deliberately, a separate table. The columns below are
-- named to match grants.go so the two read alike and the EffectiveStatus ladder
-- transfers without translation.
--
-- WHAT ARMING A WINDOW IS NOT. It is not authorization and it is not a
-- confirmation. §3.3's T4 row requires all three independently: an operator role
-- for the sender, a confirmation, AND step-up on a different rail. A live window
-- makes a T4 verb ELIGIBLE to be considered; every other check still runs. A
-- window on its own must never actuate anything, which is why nothing here
-- records a verb having been sent — only that a window was consumed.

CREATE TABLE chat_t4_windows (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- The exact (device, verb) this window opens. NOT a device alone: §3.2's
  -- point is that a mower is not "a T4 device", it has a T4 `start` and a T1
  -- `stop`. Arming a window for the mower would arm more than the operator
  -- chose.
  device_key        TEXT NOT NULL,
  verb              TEXT NOT NULL,

  -- Who armed it. An operator action worth attributing: the audit question
  -- after a T4 actuation is "who decided this could be done from chat", and
  -- that person is not the one who sent the message.
  armed_by_user_id  TEXT NOT NULL REFERENCES users(id),

  starts_at         INTEGER NOT NULL,
  ends_at           INTEGER NOT NULL,

  -- NULL means "no cap within the window". Kept nullable rather than defaulted
  -- to a number, matching temporary_access_grants: a default cap would be this
  -- table inventing a policy the operator did not state.
  max_uses          INTEGER,
  uses_count        INTEGER NOT NULL DEFAULT 0,

  -- Stored status is 'active' or 'disarmed' and nothing else. Expiry and
  -- exhaustion are DERIVED from the timestamps and the counter rather than
  -- written back, because a stored 'expired' is a claim that has to be kept
  -- true by a sweeper, and a sweeper that stops running turns every expired
  -- window into a live one. Deriving cannot fail that way.
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'disarmed')),
  disarmed_at       INTEGER,
  disarmed_by_user_id TEXT REFERENCES users(id),

  -- Free-text reason the operator gave. Shown beside the window in the console
  -- so a second operator can tell an intentional window from a forgotten one.
  notes             TEXT NOT NULL DEFAULT '',

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  -- A window that ends before it starts is not a window. Enforced here rather
  -- than only in Go: this is the constraint whose violation would produce a row
  -- that can never be consumed and never expires out of a list, and the
  -- database is the one place no caller can go around.
  CHECK (ends_at > starts_at)
);

-- The consume path's lookup: one account, one device, one verb, ordered by
-- expiry. Matches the WHERE of TryConsumeT4Window exactly.
CREATE INDEX idx_chat_t4_windows_lookup
  ON chat_t4_windows (account_id, device_key, verb, ends_at);

-- The console's list: every window for an account, newest first.
CREATE INDEX idx_chat_t4_windows_account
  ON chat_t4_windows (account_id, created_at DESC);
