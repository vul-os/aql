# Revoking an offline grant before it expires

**Status: built end to end, and never run against a controller on real
hardware.** §3's decisions are code on both sides — the monotonic `seq` rule,
step 3a in the verification core, the `revoke` command, and on the hub side
migration 0030, the revoke route, and delivery both on revocation and on
reconnect. An operator can revoke a grant from the emergency-access screen and
the gates that named it are told.

What is NOT done: §5's open questions, and none of it has run against a
controller on real hardware.

It answers the question `proto/grants.md` § "Revocation vs. in-flight grants"
left open. That section used to end "v0: undefined / open question" and named
option (b) — a revocation list the controller caches and consults while still
offline — as the thing that would close it. It now describes what is built, and
`offline_purity_test.go` is why: the paragraph could not stay as it was once
`Env` gained the field.

Read [`proto/grants.md`](../proto/grants.md) first; this document depends on it
entirely.

---

## 1. The exposure, stated as it is

A grant is a self-contained, offline-verifiable object. The controller's
11-step check touches nothing but the presented bytes and its own pinned key,
clock and lockdown state — and that locality is the feature, not an oversight.
It is what makes the path work when the network is gone.

The cost is spelled out in the contract and is real: **a member revoked the
instant after their app last refreshed keeps everything that grant authorises,
at every controller listing that device, for up to the full TTL** — seven days
by default. Deleting their account does not reach it. Declining to issue the
next grant does not reach it. The only sub-TTL lever is `lockdown`, which stops
*everyone* until `lift`.

For a household firing a domestic worker, "change the locks" today means
"freeze the gate for every resident, or wait a week". That is the gap.

## 2. Why a cached deny-list, and not the alternatives

**Not a live check at redemption.** Asking the hub "is this revoked?" at the
gate defeats the entire path. The one moment this feature exists for is the
moment there is no network.

**Not a shorter TTL.** Cutting seven days to one would shrink the window and
multiply the failure it is there to prevent: a resident whose app has not
refreshed recently standing at a gate that will not open. TTL trades the
revocation window against the stranding window, and stranding is the failure
this whole path was built to avoid.

**Not per-member generation counters.** A counter the controller compares
against the grant's `iat` is more compact than a list, but it requires the
grant to carry a member identity the offline check currently does not use, and
it revokes only at member granularity. A list of grant ids needs no new field
in the grant at all.

## 3. The decisions

### 3.1 The unit is a GRANT, not a member

The controller verifies a presented grant and the grant carries `grant_id`.
Member identity is not part of the offline check and this design does not add
it. Revoking a member is the hub's job: it marks every active grant of theirs
revoked and lists them all. One concept crosses the wire, and it is the one the
controller already has in its hand.

### 3.2 Each entry carries the grant's `exp`, so the list is bounded

An entry is `{grant_id, exp}`. Once `exp` is in the past, the entry is dropped —
by the hub when it composes the list, and by the controller when it prunes.
Nothing is lost: an expired grant already fails step 4.

This is what keeps the list small. It never holds more than the grants that were
issued *and* revoked inside one TTL window. For a household that is a handful of
entries; the bound is a property of the design rather than a limit to configure.

### 3.3 Absence is not denial, and this can never strand anyone

A controller holding no list behaves exactly as it does today. The list only
ever *adds* denials — it can refuse a grant, never authorise one.

This is the property that makes the feature safe to deploy. There is no
migration in which a controller that has not yet received a list starts refusing
legitimate residents, no ordering requirement between hub and controller
rollout, and no failure of the delivery path that locks anyone out. A missed
list means the old behaviour, which is the behaviour shipped today.

It also means a stale list needs no staleness rule. `LastGatewaySync` gates
grant *acceptance* because a wrong clock could accept an expired grant; a
month-old deny-list can only deny things that were already denied a month ago.
Old evidence for a refusal is still evidence.

### 3.4 It rides the command channel, and is signed by being a command

Delivery is a new `revoke` command in `proto/commands.md`, carrying
`{seq, issued_at, entries[]}`. It needs no signature of its own: command
envelopes are already signed by the pinned hub key and verified fail-closed
before dispatch, so the list inherits exactly the trust the `lockdown` command
has.

Not `config`. That command is documented as "update actuation params, additive
keys only", and a deny-list is not an actuation param. Folding it in would mean
a config report that either lists revocations as tunables or silently omits
part of the command it acknowledged.

### 3.5 A monotonic `seq`, because the attack is withholding, not forging

The envelope signature stops forgery. It does not stop **rollback**: an
attacker positioned between hub and controller can replay an older, *emptier*
signed list and un-revoke a grant they hold.

So the controller stores the highest `seq` it has accepted and refuses any list
at or below it. `issued_at` is carried for operator display and is not a
security input — a clock the attacker can influence must not be what decides
whether a revocation sticks.

This is the one genuinely security-critical rule in the design, and it is the
one most easily left out, because a system without it works perfectly in every
test where nobody is attacking it.

### 3.6 The check is a new step, and it goes where a refusal is cheapest

Revocation is checked immediately after step 3 (signature) and before step 4
(validity window): the grant's bytes must be authentic before its id means
anything, and there is no reason to evaluate windows, devices or nonces for a
grant that is dead. It does not go first — step 1's stale-clock rule and step
2's lockdown are controller-wide refusals that do not depend on the grant at
all, and the documented order puts those before anything grant-derived.

### 3.7 The verification core stays offline-pure

`grants.Env` gains one field — a lookup answering "is this grant id revoked" —
handed in by the caller exactly as `Lockdown` and `LastGatewaySync` are. The
verification core still opens no file and no socket.

`controller/internal/grants/offline_purity_test.go` failed the moment that field
was added, which is the test working. It is written to force `proto/grants.md`'s
revocation section to change in the same commit as the code, because an operator
reading the old text would under-react to a firing. There was no way to land the
field without rewriting the paragraph, which is exactly the property wanted from
a test guarding prose.

### 3.8 It must land WHILE lockdown is latched

Found by building it, not by designing it: `revoke` was refused during lockdown,
because the matrix in `proto/commands.md` step 5 predates the command.

That is backwards for the sequence an operator actually performs. Someone is
fired; the operator latches lockdown, because it is the only lever that works
instantly; and now they need to narrow the freeze to that one person so everyone
else can get back in. With `revoke` refused, the only route to a targeted
revocation is to **lift first** — opening every gate to everyone, including the
person just fired — which is exactly the state the freeze exists to prevent.

Allowing it costs nothing. The matrix is there to stop ACTUATION while latched,
and a deny-list actuates nothing: it can only add refusals. So `revoke` joins
`lift`, `ping`, `config` and `repair`, in all three places the matrix is
written — the contract, the controller, and the hub's second implementation of
the same check.

## 4. What this does NOT fix, stated plainly

**A controller that has not been online since the revocation still opens.** If
the hub cannot reach it, it cannot tell it. This is irreducible without a live
channel at redemption time, which §2 rules out. The honest summary in
`proto/grants.md` stays true in shape: revocation converges when the controller
next hears from the hub, bounded by the grant's own `exp` in the worst case.

What changes is the *typical* case, which today is identical to the worst case.
A controller on a working LAN learns within one command round-trip.

**It does not make revocation instant.** Nothing offline can.

**It does not help if the hub itself is compromised**, which is already the
ceiling `docs/THREAT-MODEL.md` §5 names for every signed object.

## 5. Open questions this document does not settle

- **Does the controller report which list it holds?** `ctl.report` carries
  resolved configuration; `seq` and entry count would fit the same shape and
  would answer "did my revocation land" from the device rather than from the
  hub assuming its own success. Probably yes, for the reason
  `CONTROLLER-CONFIG-REPORT.md` gives — but it is a second wire change and this
  design does not need it to be correct.
- **What does the console show?** A revoked grant is already a row in the
  grants screen. Whether it should show per-controller convergence ("3 of 4
  controllers have this") depends on the question above.
- **Should a revoked redemption be an audited event kind of its own?** A refusal
  is already queued as an audit event with its denial reason, so this may be
  nothing more than a new reason string.

## 6. The order of work

1. ~~The rollback test first (§3.5).~~ **Done**, and written from this document
   before the code existed rather than afterwards to match it —
   `TestAnOlderListIsRefusedSoARevocationCannotBeRolledBack`.
2. ~~`proto/grants.md`'s revocation section and `proto/commands.md`'s command
   table.~~ **Done**, and not by choice: adding `Env.Revoked` failed
   `offline_purity_test.go`, which exists to make the prose move with the code.
   It worked exactly as written.
3. ~~The controller: persisted `seq` + entries, the `Env` field, the new step.~~
   **Done**, plus the `revoke` command handler, which was not on this list and
   should have been — without it the list is unreachable and every other test
   passes anyway.
4. ~~**Conformance vectors.**~~ **Done** — four, replayed by three independent
   implementations (the Go core, `verify.mjs`, and the app's own canonicaliser):
   a revoked grant refused; a deny-list naming a DIFFERENT grant changing
   nothing; an entry past its own `exp` inert; and a forged grant on the list
   reported as `badsig` rather than `revoked`, which is §3.6's ordering rule
   made cross-implementable rather than merely tested here.

   `check.revoked` is OPTIONAL in the vector schema, so every vector written
   before step 3a existed still carries no list — which makes "absence is never
   denial" the default the whole corpus exercises rather than one case.

   Doing this found a FOURTH copy of the lockdown matrix. The guard added with
   §3.8 compared the contract, the controller and the hub verifier; `verify.mjs`
   had it inline as a JS array and still refused `revoke`. It is now a named
   constant, the guard reads all four, and it also fails if an inline literal
   reappears.
5. ~~**The hub**: compose the list, send it on revocation and on reconnect.~~
   **Done**, and larger than this line first assumed — building the controller
   half surfaced a prerequisite nobody had written down.

   **The hub did not persist the grants it issued.** `POST /v1/offline-grants`
   minted, signed and returned a grant, wrote an admin-audit row and kept
   nothing. So there was no set to select "revoked and unexpired" from. The
   audit log was not the answer despite holding every field: `admin_audit_log`
   is hash-chained append-only EVIDENCE, and a deny-list is operational state
   that changes on revocation, reinstatement and expiry. Reading evidence to
   decide what to actuate is the category error migration 0010 refused for
   `automation_runs`.

   **Migration 0030** therefore adds `offline_grants` (what was issued, to whom,
   until when, and whether it is revoked — never the grant BYTES, which nothing
   needs and which would put a live credential at rest), `offline_grant_devices`
   (which controllers a grant names, so a deny-list can be scoped to the gate
   that will consult it — a grant can span accounts, so scoping by account would
   be wrong for exactly the grants hardest to reason about), and a single-row
   monotonic counter for `seq`.

   Delivery happens twice. On revocation, to every controller the grant named.
   And on RECONNECT, which is what makes §4's claim true — sending only at
   revocation time would leave a controller that was offline at that moment
   ignorant forever, and the gate on a flaky link is the one an operator worries
   about. The reconnect push READS the counter rather than bumping it, or every
   reconnect would look like new information.

6. The console, if §5's first question is answered yes.
