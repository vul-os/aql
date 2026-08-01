-- Step-up on a second rail for T4 chat commands — CHAT-COMMANDS.md §3.3, §3.4.
--
-- WHAT THIS IS. A T4 verb asked for over chat does not execute when the message
-- arrives. It records an INTENT here and answers "approve this in the console".
-- The member then opens the console, authenticated there, and approves it. Only
-- that approval actuates.
--
-- WHY THAT IS A SECOND RAIL, AND TOTP IS NOT.
--
-- §3.3's T4 row asks for step-up "on a different rail". The console's TOTP
-- (httpapi/twofactor.go) is a second FACTOR and would not satisfy it: a code
-- typed into the same chat thread travels the same path as the command, so
-- whoever controls the chat account controls both halves. The requirement exists
-- precisely because compromising the chat account alone must not be enough.
--
-- An approval that must happen in an authenticated console session is a
-- different path with a different credential. Someone holding the member's
-- WhatsApp can ask; they cannot approve.
--
-- WHY THE INTENT IS STORED RATHER THAN HELD IN MEMORY. A hub restarts. An intent
-- that vanished on restart would leave a member who was told "approve this in
-- the console" looking at nothing, with no way to tell whether it had already
-- run. And the record is what makes the audit answerable afterwards: who asked,
-- over which rail, who approved, and what the device did.
--
-- WHAT THIS DOES NOT REPLACE. The chat-side confirmation (§3.4, chat_confirmations)
-- still happens first, and the operator-armed window (0033) must still be live.
-- §3.3 lists the role, the confirmation and the step-up as independent
-- requirements, and folding any two of them together would mean one act standing
-- for two decisions.

CREATE TABLE chat_stepup_intents (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- The member who asked, over chat. NOT the approver: the whole point is that
  -- these may be different sessions, and recording only one of them would lose
  -- the fact the design exists to establish.
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),

  -- Which rail carried the request, and which conversation. Kept so an approval
  -- screen can say "asked over Telegram" — a member who never sent that message
  -- learns something important from reading it.
  source            TEXT NOT NULL,
  chat_id           TEXT NOT NULL DEFAULT '',

  device_key        TEXT NOT NULL,
  verb              TEXT NOT NULL,

  created_at        INTEGER NOT NULL,

  -- Short-lived by construction. An intent is a thing a person is standing next
  -- to; one that is still approvable an hour later is a stored permission, which
  -- is what the window already is and what this deliberately is not.
  expires_at        INTEGER NOT NULL,

  -- pending | approved | rejected. Expiry is DERIVED from expires_at rather than
  -- written back, for the same reason 0033 derives its own: a stored 'expired'
  -- needs a sweeper, and a sweeper that stops running turns every stale intent
  -- into a live one.
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),

  decided_by_user_id TEXT REFERENCES users(id),
  decided_at        INTEGER,

  -- Which window admitted it, recorded at APPROVAL. A window is consumed when
  -- the command actually goes out, not when it is asked for -- an intent that
  -- is never approved must not cost the operator a use.
  t4_window_id      TEXT REFERENCES chat_t4_windows(id),

  -- What the device did, once. '' while pending. Stored rather than derived
  -- from the access log because the approval screen has to show it, and joining
  -- an audit table to answer "did my thing work" would make the log
  -- load-bearing for a UI.
  outcome           TEXT NOT NULL DEFAULT ''
                      CHECK (outcome IN ('', 'sent', 'failed', 'refused')),
  outcome_detail    TEXT NOT NULL DEFAULT '',

  CHECK (expires_at > created_at)
);

-- The approval screen's query: what is pending for this account, newest first.
CREATE INDEX idx_chat_stepup_intents_account
  ON chat_stepup_intents (account_id, status, created_at DESC);

-- One pending intent per (account, device, verb) at a time is NOT enforced here.
--
-- Deliberate. Two members may each ask, and refusing the second would mean one
-- member's unapproved request silently blocking another's -- a denial of service
-- by anyone who can send a message. Both become intents; approving one does not
-- approve the other, and each consumes its own window use.
CREATE INDEX idx_chat_stepup_intents_requester
  ON chat_stepup_intents (requested_by_user_id, status);
