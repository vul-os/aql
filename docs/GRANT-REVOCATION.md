# Revoking an offline grant before it expires

**Status: design. No code accompanies this document.** It settles the question
`proto/grants.md` § "Revocation vs. in-flight grants" leaves open — the section
ends *"**v0: undefined / open question.**"* and names option (b), a revocation
list the controller caches and consults while still offline, as the thing that
would close it.

Read [`proto/grants.md`](../proto/grants.md) first; this document depends on it
entirely and changes nothing in it until the code lands.

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

`controller/internal/grants/offline_purity_test.go` will fail when that field is
added. That is the test working: it is written to force this document's
paragraph and `proto/grants.md`'s revocation section to change in the same
commit as the code, because an operator reading today's text would under-react
to a firing.

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

1. **The rollback test first** (§3.5), against the current code, asserting the
   controller has no notion of `seq` yet — so it fails for the right reason
   when the feature lands rather than being written afterwards to match it.
2. `proto/grants.md`'s revocation section and `proto/commands.md`'s command
   table, together, since the purity test requires the prose to move with the
   code.
3. The controller: persisted `seq` + entries, the `Env` field, the new step.
4. Conformance vectors for accept, refuse-revoked, and refuse-rollback.
5. The hub: compose the list, send it on revocation and on reconnect.
6. The console, if §5's first question is answered yes.
