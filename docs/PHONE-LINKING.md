# Linking a phone number: the ceremony that has to exist first

**Status: built** (migration 0018; the channel-identity sibling is 0020 — see
§ 4). This document was written as a design, and the reasoning below is left in
the tense it was written in because it is *why* the built thing has the shape
it has. The hub has held phone→member
mapping since migration 0002 (`profile_phone_numbers`), and it is how a WhatsApp
message gets resolved to a member who may open a gate. What has never existed is
any way to **prove** a number belongs to the person claiming it.

This document exists because the missing piece looked like a missing route for a
long time, and it is not. `src/lib/api.ts` carried `phones()`, `phoneAdd()` and
`slackUpdate()` for months as calls to endpoints the hub did not serve; Settings
probed one on every visit to discover that; and the WhatsApp onboarding nudge
sent people to a signup page with a "Connect number" button that failed for
every user who pressed it. Building those routes would not have fixed anything,
because the thing they were missing is a **proof of possession**, and proof is
the entire feature.

---

## 1. Why an unverified number is worthless, and a wrongly-verified one is worse

Access resolution requires `verified_at IS NOT NULL`:

```sql
-- store/channels.go, "Member access by verified phone"
WHERE ppn.phone_e164 = ?
  AND ppn.verified_at IS NOT NULL
  AND u.status = 'active'
```

So there are exactly two ways to build a self-service "add my number" form, and
both are wrong:

- **Link it unverified.** The row exists, the UI looks finished, and nothing
  changes: the number still cannot open anything. A form whose success message
  is followed by no capability is a lie with extra steps.
- **Link it verified.** Anyone can now claim any number. Since the WhatsApp
  channel resolves an inbound message to whichever member holds that number,
  claiming a neighbour's number means receiving a menu of *their* gates.

The second is not hypothetical. Migration 0002 carries the scar:

```sql
-- One VERIFIED owner per number (the index invite-accept auto-verify used to
-- let attackers squat — invites now always link phones UNVERIFIED).
CREATE UNIQUE INDEX profile_phone_numbers_verified_unique
    ON profile_phone_numbers (phone_e164) WHERE verified_at IS NOT NULL;
```

An earlier version auto-verified on invite-accept and had to be walked back. The
unique index limits the blast radius — two profiles cannot both hold a number as
verified — but it does not decide *which* one gets it, and first-writer-wins
favours whoever is paying attention.

---

## 2. The shortcut that looks right and is not

The tempting design: let a user link a number unverified, then mark it verified
when the WhatsApp channel receives a message from that number. The inbound
message is signed by the provider, so it really does prove the number sent it.

It proves the wrong thing. An inbound message proves **someone holding that
number sent a message**. It says nothing about who created the pending link. So:

1. Mallory links Bob's number to Mallory's account, unverified.
2. Bob, who has never heard of Mallory, messages the gate bot as usual.
3. The hub sees an inbound message from that number with a pending link and
   verifies it — into Mallory's account.

Bob's own message completed the attack. This is the same squatting shape as the
invite-accept bug, wearing a better disguise, and it would be found by whoever
lost their gate access rather than by a test.

**The rule that falls out of this: possession of the number and control of the
account must be proven by the same act.** Two facts, one ceremony.

---

## 3. The design

A short-lived code, shown in the console, sent from the phone.

1. A signed-in member asks to link a number. The hub mints a **link code** —
   6 characters, `crypto/rand`, a namespace that cannot be confused with a
   gate command — stores it against `(user_id, phone_e164)` with a **10-minute
   expiry**, and shows it in the console. Nothing is written to
   `profile_phone_numbers` yet.
2. The console tells the user to send exactly that code to the gate bot **from
   the number they are linking**.
3. The WhatsApp channel receives it. The provider signature proves the number;
   the code proves the sender is the person looking at that account's console.
   Both facts, one act. The hub then writes the row with `verified_at` set.
4. If the number is already verified to another profile, the link **fails
   loudly** rather than moving it. Moving a verified number is a support
   operation with a human in it, not an API call.

Why this shape and not the alternatives:

- **Not SMS.** The hub sends no mail and no SMS, deliberately — it is meant to
  run on a box someone owns, with no account at a delivery provider. Adding an
  SMS dependency to verify a number for a WhatsApp rail would be adding a
  third-party dependency to remove one.
- **Not "message the bot first, then we ask you to confirm in the console."**
  Same two facts, but it lets an unsolicited inbound message create pending
  state for a number nobody has asked to link — free spam surface, and a
  notification the recipient did not ask for.
- **Not email confirmation.** There is no email in this product.

---

## 4. What has to be built

**Status: built.** Migration 0018 is taken, the store layer is
`hub/internal/store/phonelink.go`, the routes are
`hub/internal/httpapi/phones.go`, and the channel side is
`hub/internal/httpapi/phonelink_chat.go`. Two clarifications the build
produced, both recorded rather than quietly resolved:

- **The hash is deterministic**, unlike the selector+verifier pairs in 0009
  and 0012. It has to be: the inbound message carries the code and nothing
  else, so the code is the lookup key. At six characters that digest does not
  defeat someone who can read the database — the real protection is the phone
  binding in step 3, and the migration says so explicitly rather than
  implying the hash is doing more work than it is.
- **The mint quota is per user, not per phone.** Item 2 below asks for both.
  Per-phone is the wrong shape: it hands an attacker a way to exhaust a
  victim's budget by minting codes against their number, which is the very
  lockout that item warns about.

1. A `phone_link_codes` table (**migration 0018 is unclaimed — take it**): code
   hash, user, phone, expiry, attempt count. The code is stored **hashed**, like
   every other credential here (`0009_auth_recovery.sql`, `0012_api_tokens.sql`)
   — a six-character code in plaintext in a backup is a six-character code.
2. `POST /v1/phones/me/link` to mint one, and `GET /v1/phones/me/phones` to list
   what is linked. Rate-limited per user **and** per phone: an attacker must not
   be able to burn a victim's number through the attempt counter and lock it.
3. The channel side: recognise a link code in an inbound message, resolve it,
   write the verified row, and reply. This is where the security actually is.
4. `DELETE` to unlink, which is the easy half and must not be forgotten — a
   number you can add and never remove is worse than one you cannot add.
5. The console: the ask, the code, the "send this to the bot" instruction, the
   waiting state, and the list.

Steps 1, 2, 4 and 5 are ordinary work. Step 3 is the one that deserves an
adversarial read before it merges.

That read is written down in `phonelink_chat.go`'s package comment — what a
complete stranger can reach, and what each thing they can send does. It is
worth restating one conclusion here: the redemption attempt has to run
**before** the membership lookup, because someone linking a number is by
definition not yet recognised and every access check would otherwise answer
"you have no access" and stop. That ordering is load-bearing and is pinned by
a test (`TestLinkCodeIsReachableBeforeTheMembershipCheck`) that fails if the
call is moved after the check.

This ceremony covers **WhatsApp only**, because WhatsApp's identity is a phone
number. Telegram, Slack and Discord identify a sender by a platform account
id, so there is no number for a code to be bound to.

That was first written here as "a separate unsolved problem". It is not: the
same two facts are available on those rails (a code proves console access, an
inbound direct message proves control of the account), so migration 0020 runs
the same ceremony against `channel_identities` instead of
`profile_phone_numbers`. See `hub/internal/store/channellink.go`.

**But the two are not interchangeable, and the difference is the interesting
part.** A phone code names the number that may spend it, because the member
knows their own number and types it in. Nobody knows their own Telegram
numeric id — learning it is what the inbound message is *for* — so a channel
code cannot name its target, and whoever sends it gets bound.

The phone code is therefore short (six characters) because possession of the
handset is a second factor it does not have to carry. The channel code is
twice as long (~2^59) because there is no second factor at all: the code is
the only thing between a stranger and someone else's gate access, and its
console copy says so rather than treating it as a convenience string.

---

## 5. Open questions this document does not settle

- **Attempt limits versus denial of service.** Locking a number after N failed
  codes protects it from guessing and hands an attacker a way to freeze a
  victim's linking. Per-user limits do not have that problem, per-phone limits
  do, and both are wanted.
- **Slack.** `slackUpdate()` had the same shape and the same absence. Slack has
  no phone-like identifier and the chat rail is moving to Pier
  (`docs/PIER-CHAT-SEAM.md`), so whether the hub should hold a Slack identity
  at all is a question for that migration, not this document.
- **Does this belong in the hub after Pier?** If Pier terminates the rail and
  hands the hub an authorised command, then Pier knows the sender and the hub
  may not need a phone table at all. Building the ceremony here and moving it
  later is real work done twice. Deciding that is a prerequisite to step 3, not
  a detail of it.
