# Multi-hub — how the app holds grants from several independent hubs

**Status:** design proposal. No code has been written for it. Everything marked
**PROPOSAL** is a change being argued for; everything else describes code that
exists today, with `file:line` citations.

**Licence constraint (binding on everything below):** Aql is MIT OR Apache-2.0
with no billing code in any binary. Nothing in this document is an "enterprise
edition", a licence gate, a seat count, or a metered feature, and nothing here
introduces a component anyone must run or a service anyone must pay for. Where a
capability would only make sense as a paid product, it is named and left out.

---

## 0. The decision, up front

**There is no hub-to-hub sync. The app is the federation layer.**

The grounding case is one person with a hub at home who also has access to a
friend's office, which runs its own hub. The model is:

- The office hub issues that person a grant, **signed by the office hub's key**,
  naming **only the office hub's access points and controllers**.
- The app holds that grant **alongside** the grant from the home hub.
- **The two hubs never communicate.** No peer protocol, no merge, no CRDT, no
  tombstones, no convergence, no version vectors.

Each hub stays the sole authority over its own gates. That is the product's
stated thesis — `README.md:7` ("One hub owns everything") and
`ARCHITECTURE.md:284-297` §5, which already says in as many words: *"Not
federation. Not P2P. Many independent hubs, each a full authority over its own
tenants, devices and audit log — with zero coordination between them."*
`docs/KOTVA-ALIGNMENT.md:238-252` §1.5 reaches the same conclusion from the
substrate side and argues Aql should be slow to adopt SYNC at all.

This design does not change that sentence. It implements it on the client.

It is also agnostic by construction: with no sync engine there is nothing to
depend on Vulos, KOTVA, DMTAP or anyone else for. The app reaches each hub
directly — LAN at home, whatever URL that hub has when away. A Vulos relay is
one way a hub happens to be reachable, exactly like ngrok or a VPN, and is never
required.

**Most of this already exists.** `src/lib/offline/` requests, stores, and
presents a signed grant from a hub. Holding grants from several hubs is a
**list instead of a single item**. `lintel:open-gateway-picker`
(`src/lib/hub.ts:185`) and "Connect to a different hub"
(`src/pages/Landing.tsx:132`) already ship.

---

## 1. Why this is safe, and why it is safe *without trusting the app*

This is the load-bearing security claim of the whole document, so it goes first.

**A grant from hub A is already structurally incapable of opening a gate at hub
B, and the app is not what enforces that.** The controller does, in shipped,
conformance-tested code.

`controller/internal/grants/grants.go:161-261` runs the fail-closed 11-step
verification on every redemption. Three of those steps make cross-hub
presentation impossible:

| Step | Line | Check | Effect on a foreign grant |
|---|---|---|---|
| 3 | `grants.go:210` | `wire.VerifyRaw(env.GatewayKey, grantRaw)` — the grant's signature against **the controller's own pinned hub key** | Hub A's grant presented to hub B's controller fails immediately: `bad_sig` |
| 5 | `grants.go:221` | `env.DeviceID ∈ grant.devices` | Even a same-hub grant naming other controllers is refused: `wrong_device` |
| 6 | `grants.go:225` | requested access point `∈ grant.access_points`, and equal to the proof's | A grant for another gate is refused: `wrong_access_point` |

`env.GatewayKey` comes from `controller/internal/state/state.go:120-131`, which
returns the key **pinned at pairing**. `state.go:136-151` (`SavePairing`) refuses
any change to it with `ErrKeyChangeRefused` (`state.go:25`); the only sanctioned
rotation is a `repair` command already verified against the *currently* pinned
key (`state.go:153-165`, `ApplyRepair`) or a physical factory reset.

**Therefore:** the app can hold grants from a hundred hubs, mix them up, present
the wrong one, or be actively malicious, and no gate opens that should not. The
worst outcome of an app-side bug is a **denial** (`bad_sig`), which is the safe
direction — the same directional principle stated at
`hub/internal/channels/verb.go:28-30`.

Everything in §2–§5 below is therefore **defence in depth and UI correctness**,
not the security boundary. That ordering matters: it is why multi-hub in the app
is a days-of-work feature and hub-to-hub sync is a weeks-of-protocol feature.

---

## 2. The per-hub record

### 2.1 What exists today

`src/lib/offline/vault.ts:95-115` defines `GrantRecord`, keyed by
`recordId(gatewayUrl, memberId)` = `` `${gatewayUrl}::${memberId}` ``
(`vault.ts:333-335`), with the comment at `vault.ts:96` already stating the
invariant: *"grants never cross hubs or members."*

The record holds exactly six things: `id`, `gatewayUrl`, `memberId`, `grantRaw`
(the hub's signed document as JSON text), `appPubkey`, an `accessPoints`
display-only snapshot, `addresses`, and `fetchedAt`. `vault.ts:104-110` is
explicit that the access-point snapshot is **not** an authorisation cache —
nothing in it decides whether a gate opens.

### 2.2 The one thing that blocks multi-hub today

`vault.ts:406-429` (`pruneRecords`) takes a **single** `keep` record and deletes
every record that is not it:

```
const keepId = keep ? recordId(keep.gatewayUrl, keep.memberId) : null;
for (const rec of all) {
  ...
  if (rec.id !== keepId || expired) { await idbDelete(GRANT_STORE, rec.id); }
}
```

`src/lib/offline/service.ts:53-67` (`loadState`) calls it with the *current*
hub's URL from `getApiBaseUrl()` (`src/lib/hub.ts:44-48`). And
`hub.ts` (`applyGatewayUrl`) reloads the page on a hub switch. So
today, switching hubs deletes the other hub's offline grant on the next load.
**That is the bug that makes multi-hub not work — and it is a one-function fix.**

**PROPOSAL P-1.** `pruneRecords` takes a **set** of enrolled hub identities to
keep, not one. It keeps deleting expired records — `vault.ts:368-376` treats
expiry as a **deletion, not a display state**, which is correct and must not
change. Switching the console's hub must no longer delete any offline record.

### 2.3 Hub identity should be the pinned key, not the URL

**PROPOSAL P-2 (the most important change in this document).** Today a hub is
identified by its URL. URLs are not identities: a home hub is `http://…local`
on the LAN and something else from outside, so the same hub produces two records
and neither can be recognised as the other. Worse, an attacker who controls a
URL inherits its record.

Identify a hub by its **Ed25519 public key**, pinned at first enrolment.

- The key is already published — `hub/internal/keys/keys.go:52-54`
  (`PublicKeyB64`, served at `/v1/gateway/key`), the same key controllers pin.
- `gatewayUrl` demotes to **mutable metadata**: a current address hint, plus a
  list of addresses that have worked. Changing it is routine and requires no
  re-enrolment.
- `recordId` becomes `` `${hubPubkey}::${memberId}` ``.

This is the app-side analogue of `state.go:136-151`, and it should fail the same
way: **a hub URL that answers with a different key than the one pinned for that
record is refused, surfaced to the user, and never silently re-enrolled.** Call
it `ErrHubKeyChanged` and give it the same status `ErrKeyChangeRefused` has.

**PROPOSAL P-3 — turn an honest limitation into a detection control.**
`vault.ts:63-68` currently states, correctly, that the app *"deliberately does
not pretend to verify the hub signature against a key it fetched from the same
hub"* — true for a first fetch, which is trust-on-first-use either way. But once
the key is pinned (P-2), **every subsequent grant can be verified against it**
before storage. WebCrypto Ed25519 is already in use in this file
(`vault.ts:152`, `vault.ts:277`). A grant that does not verify against the
pinned key is refused and reported, exactly as a malformed one already is
(`vault.ts:360-367`). This detects a replaced or compromised hub at refresh time
instead of at the gate.

### 2.4 One app key per hub

Today there is **one** app key: `APP_KEY_ID = 'app-key-v1'` (`vault.ts:77`,
`loadAppKey` at `vault.ts:246-257`, `ensureAppKey` at `vault.ts:268-308`). Every
hub's grant is bound to the same `app_pubkey`.

**PROPOSAL P-4.** Generate one non-extractable key **per hub record**
(`app-key-v1::${hubPubkey}`). Cost is near zero — the generation path already
exists and runs in milliseconds. Benefit: hub A and hub B no longer share a
common identifier for the same device, so two unrelated hub operators cannot
correlate their users by comparing `app_pubkey` values. With a single shared key
that correlation is free and permanent.

Keep every existing property: `extractable: false`, refuse to store if the
platform returns an extractable key (`vault.ts:284-288`), read-back verification
(`vault.ts:300-307`), and no fallback to raw key bytes.

### 2.5 Isolation invariants (normative)

1. **No cross-record reads.** Presenting at a gate resolves the record first,
   then reads `grantRaw`, `appPubkey` and the signing key **from that record
   only**. No global lookup keyed by access-point id.
2. **No shared index.** Access-point ids are hub-local. They are generated
   randomly (`store.NewID()`), so collision is improbable, but improbable is not
   a boundary. Every UI map is keyed by the composite `(hubPubkey,
   accessPointId)`.
3. **No forwarding.** The app never sends anything received from hub A to hub B,
   to hub B's controllers, or to any other party. The only outbound uses of a
   record are: (a) `grant.open` / `grant.proof` to a controller listed in **that
   record's own** `devices`, and (b) a refresh request to **that record's own**
   hub.
4. **Expiry is deletion, everywhere.** `vault.ts:368-376` and `vault.ts:406-429`
   already do this per record; it must hold for every record in the set.

---

## 3. Which hub a gate belongs to

Each `GrantRecord` carries its own `accessPoints` snapshot (`vault.ts:87-93`,
`vault.ts:111`) taken at issuance, and `addresses` mapping a controller
`deviceId` to the last LAN address that worked (`vault.ts:113`,
`rememberAddress` at `vault.ts:392-399`).

So the mapping is already **inside** the record and needs no global structure:

- A gate is `(hubPubkey, accessPointId)`.
- Its controller is `accessPoints[i].deviceId`, and its address is
  `record.addresses[deviceId]`, falling back to the mDNS guess
  (`service.ts:294-299`, `guessControllerAddress`) — which the UI already labels
  as a guess (`service.ts:286-293`).
- `gateStatuses` (`service.ts:325-346`) already computes per-gate status for one
  record. Multi-hub is `records.flatMap(gateStatuses)` with the hub attached.

**No leakage, by construction:** there is no step that consults another record.
A gate's hub is not *inferred*, it is the record the gate was read out of.

---

## 4. What the user sees

**Pick: one unified list for the emergency/offline surface, grouped by hub; a
switcher for the admin console. Both, split by surface.**

Justification for the home+office case:

- **The gate list is unified** because the moment it is used is the worst
  possible moment to make a decision. Someone is standing at a gate, possibly in
  the rain, possibly with no network. A switcher inserts "which hub is this?"
  before "open" — and the user often does not know or care that the office runs
  a different hub. They know *which gate they are standing at*. Group the list
  under hub headings ("Home", "Kirk Street office") so provenance is visible
  without being a step.
- **The admin console stays one hub at a time** because it is hub-authoritative
  and account-scoped. Members, audit, grants, devices and settings all belong to
  one hub's tenancy; interleaving two hubs' admin views is precisely the kind of
  cross-tenant surface §6.5 exists to prevent. This is also already true in the
  code: sessions are per hub and `hub.ts` (`clearPerGatewayState`)
  wipes `lintel.*` on a hub change, and `src/pages/app/Settings.tsx:60` already
  tells the user *"Switching hubs signs you out here — your account stays on its
  hub."*

**PROPOSAL P-5.** `clearPerGatewayState` must be documented and tested as
**localStorage-only**. It must never be extended to clear the IndexedDB grant
store (`lintel.offline-access`, `vault.ts:73`) — that would delete other hubs'
emergency access on an unrelated console switch. Today it happens not to touch
IndexedDB; that needs to become a deliberate, tested invariant rather than an
accident.

Hub names are **local labels chosen by the user**, stored in the record. A hub
supplies a suggested name; the user can rename it. A name is never a security
input and is never matched on.

---

## 5. Identity — a different member at each hub

The person is `user_id` **X** at their home hub and `user_id` **Y** at the office
hub. There is no shared account, no linked identity, and there must be no attempt
to create one.

This mostly falls out of the existing shape:

- `memberId` is already **stored in the record** at enrolment
  (`vault.ts:99`, written at `service.ts:120-131`), not derived at read time.
- The grant itself carries `member` (`hub/internal/keys/grant.go:33`,
  `controller/internal/grants/grants.go:27`) and it is signed, so it is the hub's
  own statement about who the holder is at *that* hub.
- Users are instance-wide per hub (`users` table, `0001_baseline.sql:23`) and
  membership is per account (`account_members`, `0001_baseline.sql:72`, with
  `MemberRole` at `hub/internal/store/tenants.go:140-146`). Two hubs share no
  identifier at all.

**PROPOSAL P-6.** `loadState` (`service.ts:53-67`) currently takes a single
`memberId` — the signed-in member of the *current* hub — and uses it to select
the record. It must instead **enumerate all stored records** and use each
record's own `memberId`. The app is signed in to at most one hub's console, so
it simply does not know its member id at the other hubs; the record is the only
place that knowledge lives, and it is self-describing.

Rules:

1. The app **never** assumes one account, one email, or one person across hubs.
2. The app **never** displays a merged identity. If the office hub knows them as
   "j.dube@…" and home as "jay@…", both are shown against their own hub.
3. Signing out of one hub's console does **not** delete another hub's grant.
   `forgetAll` (`service.ts:207-209` → `forgetEverything`, `vault.ts:432-440`)
   is a deliberate "this is not my device any more" action and must stay a
   wipe-everything action — but the ordinary sign-out path must scope to the hub
   being signed out of.

---

## 6. Security

This is the primary section. Sync between hubs was the largest new attack
surface anyone proposed for this product; not building it removes most of that
surface, but the app now holds **several bearer capabilities that open physical
gates at once**, and that is a real risk that must be earned.

### 6.1 What the app must never hold, and never carry between hubs

Hard list. Nothing on it may exist in the app's storage or on any wire the app
speaks:

| Never held / forwarded | Where it lives | Why |
|---|---|---|
| A hub's Ed25519 **signing seed** | `hub/internal/keys/keys.go:16`, mode `0600` at `keys.go:41` | Controllers pin the public half (`state.go:120-131`). The seed forges every gate that hub guards. |
| **Password hashes** | `users.password_hash`, `0001_baseline.sql:23` | Credential compromise at A must not reach B. |
| **Session / refresh tokens** | `refresh_tokens`, `0001_baseline.sql:46`; localStorage `lintel.*` | A bearer token for hub A in a store shared with hub B's data is a cross-hub escalation path. |
| **API tokens, channel credentials** (WhatsApp app secret, bot tokens, Slack signing secret) | env/config, never in SQLite; used at `hub/internal/channels/channels.go:177-230` | Never app-facing at all. |
| **Audit hash-chain state** | `hub/internal/store/audithash.go`; `prev_hash`/`row_hash` per `0007_audit_hash_chain.sql` | Per-hub, append-only, local. Chains do not merge — see §8. |
| **Another hub's anything** | — | Rule 3 of §2.5. |

**Why this is structural, not a promise not to add a field.**

The app's only cross-hub data structure is `GrantRecord` (`vault.ts:95-115`) — a
**closed struct with a fixed field list**, and the only hub-supplied content in
it is `grantRaw`. `grantRaw` is not stored as whatever the hub sent: it is
validated field by field by `parseGrant` (`src/lib/offline/grant.ts:80-113`),
which checks `v`, `typ`, `grant_id`, `member`, `app_pubkey` (and that it is
exactly a 32-byte Ed25519 key, `grant.ts:90`), `devices`, `access_points`,
`windows`, `iat`, `exp`, `sig` (exactly 64 bytes, `grant.ts:113`) — and
**rejects with a reason** on anything else. `parseStoredGrant` re-runs that on
every read, and a record that fails is **deleted, not repaired**
(`vault.ts:356-367`).

So there is no field a secret could occupy, and a hub that tried to smuggle one
by sending a differently-shaped document gets the document discarded. Combined
with the fact that the app never sends record content to any party other than
that record's own hub and controllers (§2.5 rule 3), a compromise at hub A has
no channel to hub B **that passes through the app**.

The remaining obligation is to keep it that way: **no token, no credential, and
no hub-internal state may ever be added to `GrantRecord`**, and the offline vault
must never become a general-purpose cache. That is a reviewable invariant on one
34-line type in one file.

### 6.2 The compromised-hub question

**If the friend's office hub is fully compromised, what can it do to the home
hub?**

**Nothing that opens a gate at home.** The mechanism, restated concretely:

1. A grant is only ever honoured by the hub that **issued** it, because step 3
   (`grants.go:210`) verifies its signature against the **pinned** key of the
   controller's own hub. A compromised office hub can sign anything it likes; the
   home controller pins the *home* hub's key and answers `bad_sig`.
2. A grant is **scoped to its issuer's own controllers and access points** —
   steps 5 and 6 (`grants.go:221`, `grants.go:225`). Even inside one hub, a
   grant cannot be pointed at a controller it does not name.
3. The compromised hub can therefore only **propose state to the app**: a grant
   for its own gates, a hub name, an access-point list. The app stores it in that
   hub's own record. It confers no authority anywhere else.
4. Under P-2/P-3 a compromised hub cannot even impersonate a *different* hub to
   the app: the key is pinned per record and a mismatch is refused.

**A peer can propose state but never confer authority.** There is no code path
in this design in which one hub's assertion causes an actuation at another hub —
because there is no path from one hub to another at all.

**What a compromised hub *can* do, stated honestly:** everything at *its own*
site. It can mint a grant for anyone it likes, for its own gates, and the app
will store and present it, and its controllers will honour it. That is the hub's
authority by design — it is the signer its controllers pin — and
`vault.ts:64-68` already says so. Containing that is exactly the argument for
one hub per independent authority (§7.6).

### 6.3 Peer authentication — pinning

There are no peers, so there is no peer-authentication protocol to get wrong.
What replaces it:

- **Controller ← hub:** already pinned. `state.go:136-151` refuses a key change
  with `ErrKeyChangeRefused` (`state.go:25`); rotation requires a `repair`
  command verified against the currently pinned key (`state.go:153-165`), or a
  physical factory reset.
- **App ← hub:** pinned per record by **PROPOSAL P-2**, refused on change by
  **P-3**, with the same discipline.

**Rotation.** Both halves of this now SHIP, so this paragraph describes behaviour
rather than intent.

Hub side: `hub/internal/keys/rotation.go` retains two keys and signs each command
with whichever key its target controller pins, moving controllers onto the new one
by `repair` as each acknowledges. Two-key retention is not an optimisation — a
precondition that every controller is online cannot make rotation atomic, and a
controller that drops between the check and its own repair is stranded until
someone factory-resets it physically.

App side: a key change invalidates the record. `vault.ts` refuses it with
`HubKeyChangedError`, the emergency-access screen names the hub and offers an
explicit forget-and-re-enrol, and nothing auto-heals — because auto-healing a key
change is indistinguishable from accepting a hub takeover.

**A lost hub** (decommissioned, friend moved out): the user deletes the record.
Its grants are already scoped to that hub's controllers and expire on their own
(`vault.ts:368-376`).

### 6.4 Replay and rollback

- **A replayed redemption cannot succeed.** The controller issues a single-use
  `cnonce` valid 30 s (`wire.go:34`, `CnonceTTLSeconds = 30`); step 10 consumes
  it and remembers it until expiry, answering `cnonce_replay` on reuse
  (`grants.go:169-172`, `grants.go:244-259`). A captured exchange is not
  replayable.
- **A captured grant is useless without the key.** Step 9 verifies the proof
  against `grant.app_pubkey` (`grants.go:236-243`), and the private half is a
  non-extractable WebCrypto key (`vault.ts:8-20`, `vault.ts:277`).
- **A stored grant cannot outlive its expiry.** `exp` is checked at step 4 with
  ±90 s skew (`grants.go:213-219`, `wire.go:30`), and the app deletes the record
  at expiry rather than displaying it (`vault.ts:368-376`).
- **A hub restored from an old backup cannot un-revoke anyone at the app.** With
  no sync there is no merge to roll back. The old hub can only issue *new*
  grants, and it will only do so for members its restored database still
  considers active — the same authorisation gates as any issuance
  (`hub/internal/httpapi/offline_grants.go:9-31`). This is a genuine
  weakness of restoring a stale backup, but it is a **local** one, identical to
  the risk that already exists today, and it does not propagate.
- **Under the epoch proposal (§7.2), rollback is structurally blocked at the
  controller:** the controller keeps the **highest** epoch it has ever seen and
  never decreases it, so replaying an old signed epoch is a no-op and a restored
  hub advertising a lower epoch cannot lower the bar.

### 6.5 Tenancy

Aql's tenancy is app-layer, not RLS —
`hub/internal/store/store.go:1-9` states the doctrine (*"every method that
reads or writes tenant data takes an accountID and scopes its SQL to that
account"*), and `store.go:142-145` states the contract that a row belonging to
another account is **indistinguishable from one that does not exist**.

**Multi-hub does not become the one path that crosses accounts, because it adds
no server path at all.** Concretely:

1. **No new endpoint.** The only issuance endpoint is the existing
   `POST /v1/offline-grants` (`offline_grants.go:70`), which already runs the
   full gate set per access point: `MemberRole` membership
   (`offline_grants.go:118-127`), account-suspended
   (`offline_grants.go:132-136`), user-disabled
   (`offline_grants.go:98-102`), controller-attached
   (`offline_grants.go:143-146`) — and is **all-or-nothing**
   (`offline_grants.go:16-21`).
2. **No cross-account read.** The app calls each hub with that hub's own base
   URL and that hub's own session. There is no request in this design that names
   two accounts, and none that names an account the caller is not a member of.
3. **Cross-hub is a superset of cross-account.** Two records from two hubs are
   at least as isolated as two accounts on one hub, because they share no
   database, no process, and no key.
4. Where one operator runs several sites on **one** hub, tenancy is unchanged
   and already enforced: sites are `locations` scoped by `account_id`
   (`0001_baseline.sql:85`), with access points and devices scoped transitively
   through them (`tenants.go:220-238`, `tenants.go:241-252`).

### 6.6 Transport is untrusted, always

A LAN, a relay, a shared folder, a USB stick and a hostile Wi-Fi are all the same
thing: a pipe that may **drop, delay, duplicate or reorder**. None of those may
produce an unsafe outcome — only a stale one.

This is already true and already stated:
`controller/internal/lanserver/lanserver.go:1-8` — *"Plain HTTP is acceptable:
every message is Ed25519-signed and single-use; the transport adds no trust."*
Bodies are bounded at 8 KiB (`lanserver.go:26`). `service.ts:269-284`
(`normalizeControllerAddress`) rejects `https` for the LAN listener deliberately,
naming the mistake rather than failing silently.

The properties that make transport irrelevant:

- **Objects verify on their own signatures**, against a key pinned before the
  object arrived. Arrival path contributes nothing.
- **Drop / delay** → the grant is simply not presented, or a refresh does not
  happen. Fail-closed: the grant lapses at `exp`.
- **Duplicate** → the `cnonce` is single-use (`grants.go:244-259`).
- **Reorder** → there is no ordering to corrupt; each redemption is
  self-contained. Under §7.2's epoch, ordering is resolved by max-wins, which is
  order-independent by construction.

**A Vulos relay is one option and never required.** It is a way a hub happens to
be reachable, no different from ngrok, a VPN, port-forwarding, or being on the
same LAN. It is never trusted, because nothing in the path is.

### 6.7 Blast radius, in plain language

> **If someone steals the phone (unlocked, and they can open the app):** they can
> open exactly the gates listed in the grants that phone is holding, at the sites
> that issued them, until those grants expire — and nothing else. They cannot
> add gates, cannot extend the expiry, cannot see or touch any hub's admin
> console, and cannot use one site's access to reach another site. This is the
> same exposure as stealing a keyring, and the fix is the same: the site
> operator stops reissuing, and can latch **lockdown** on the controller to shut
> everything immediately at that site.
>
> **If the friend's office hub is completely taken over by an attacker:** they
> control the office's gates. They cannot open anything at the home hub — not the
> front gate, not the garage, nothing — because the home controllers only accept
> instructions signed by the home hub's key, which the office hub does not have
> and never receives.
>
> **If someone copies the phone's data, or a backup of it, without being able to
> run the app:** they get a document listing which gates the person may use. It
> is not a key and it opens nothing; the part that actually authorises is a
> private key the browser will not let any code read
> (`vault.ts:35-57` states this, including its honest limit: non-extractable is
> not the same as hardware-backed).
>
> **If someone taps the network, the relay, or the Wi-Fi at the gate:** they get
> nothing usable. Every message is signed, and each gate opening uses a
> one-time challenge that is worthless a second time.

---

## 7. Central revocation without hub-to-hub sync

The case previously set aside — *an operator revokes someone centrally and it
must reach many sites with nobody in the loop* — is worth solving, and it can be
solved without any hub-to-hub protocol. This section evaluates the options,
recommends a combination, and states the residual as a number.

**Framing first.** Revocation is only hard when the **controller cannot reach its
hub**. When a controller is online, the hub is authoritative and simply stops
dispatching — a revoked member's live open is denied by the existing choke point
(`hub/internal/store/openpath.go:242-307`, which checks account suspension
at `openpath.go:265-267` and user status at `openpath.go:272-282`). Offline
grants exist precisely for the case where that channel is down
(`offline_grants.go:23-31`), which is why the answer cannot be "tell the
controller".

### 7.1 The TTL dial — necessary, insufficient

**Finding: the 7-day TTL is a compile-time constant at the call site, but
`SignGrant` was already built to take a shorter one.**

- `hub/internal/keys/grant.go:12` — `const DefaultGrantTTL = 7 * 24 * time.Hour`
- `grant.go:82-84` — `SignGrant(..., ttl time.Duration)`, clamped:
  `if ttl <= 0 || ttl > DefaultGrantTTL { ttl = DefaultGrantTTL }`

So `DefaultGrantTTL` is a **ceiling**, and shorter TTLs are already expressible.
The only thing pinning every deployment to 7 days is one hard-coded argument:

```
offline_grants.go:161   s.keys.SignGrant(grantID, c.Sub, req.AppPubkey, devices, resolvedAPs, windows, keys.DefaultGrantTTL)
```

**PROPOSAL P-7.** Make the issued TTL a per-account setting, read at issuance and
passed at `offline_grants.go:161`. Keep `DefaultGrantTTL` as the hard clamp
(never raisable), add a **floor** (suggest 15 minutes — below that, refresh churn
and clock skew of ±90 s, `wire.go:30`, start to dominate), and default to
today's 7 days so no existing deployment changes behaviour. This is a settings
field and one argument; it is not an edition, a licence gate, or a metered
feature.

**The honest tradeoff, which is why the dial alone is not the answer.** A short
TTL revokes well and strands the blackout case — someone whose phone has been
offline longer than the TTL loses exactly the emergency access this path exists
for. A long TTL is the reverse. The dial forces a permanent choice between two
failures, and it charges that cost **continuously**, to everyone, whether or not
a revocation ever happens. It is a genuine security/availability dial and the
right number is deployment-specific; this document deliberately recommends no
number.

### 7.2 Option B — an epoch counter (**recommended as the enforcement rule**)

The hub keeps a monotonic **epoch**, bumped on any revocation (member removed or
disabled, account suspended). Grants carry the epoch they were issued under. Each
controller remembers the **highest epoch it has ever seen from any source** and
refuses any grant carrying a lower one.

Why this fits Aql specifically:

- **It is one integer.** Any contact of any kind updates it. It fits trivially in
  the existing 8 KiB LAN body (`lanserver.go:26`).
- **It needs no new trust.** The epoch assertion is signed by the hub key the
  controller **already pins**, using the JCS + Ed25519 discipline already in the
  codebase (`hub/internal/keys/keys.go:62`, verified with
  `wire.VerifyRaw` as at `grants.go:210`). No new key, no new party, no new
  component to run.
- **Rollback is structurally impossible, not merely checked.** Max-wins never
  decreases, so replaying an old signed epoch is a no-op and an old backup
  advertising a lower epoch cannot lower the bar. This is the same shape as the
  already-shipped monotonic staleness rule in §7.4 — and it is order-independent,
  so §6.6's reorder/duplicate transport hazards do not apply.
- **It is a natural extension of an existing check.** It becomes step 4.5 of the
  11-step order in `grants.go:161-261`, with a new reason token alongside
  `wire.go:54`'s existing vocabulary — one comparison in a function that already
  performs ten.

**The cost, stated plainly:** an epoch bump invalidates **every** grant issued
under an older epoch, not just the revoked person's. Everyone must re-fetch.

**Is that acceptable? Yes, and it is strictly better than a short TTL.** Grants
are cheap to reissue — one authenticated HTTP call, and `refreshIfDue`
(`service.ts:184-200`) already re-fetches on every online launch past half-life,
re-running the hub's full authorisation gates each time. The difference that
matters: a short TTL imposes its lockout risk **continuously and on everyone**,
whereas an epoch imposes it **only at the moment of an actual revocation**, which
is rare. You pay for the security property when you use it, not all the time.

**Who it hurts:** someone offline across a bump. Their grant is refused at the
controller until they reach the hub again. That is the correct fail-closed
direction, and it is the same population a short TTL would have stranded anyway
— but only on revocation days rather than every week.

### 7.3 Option A — the phones carry it (**recommended as the delivery mechanism**)

The controller cannot reach the hub, but **phones can**. Every authorised person's
app already contacts its hub when it has connectivity (`service.ts:184-200`) and
later stands in front of a controller (`service.ts:229-261` →
`lanserver.go:40-41`). So the app can carry hub-signed revocation state from hub
to controller as a **side effect of ordinary use**, with no new component and no
gate connectivity.

Assessment against the questions asked:

- **Size bound.** A revocation *list* is unbounded and therefore the wrong
  primary carrier — at a site with churn it grows without limit and eventually
  exceeds the 8 KiB body cap (`lanserver.go:26`). **Carry the epoch (8 bytes)
  as the primary mechanism.** A bounded list of revoked `grant_id`s may be added
  later as a refinement to reduce collateral (revoke one person without
  invalidating everyone), explicitly capped — suggest 4 KiB inside the existing
  8 KiB frame — with the hub dropping oldest entries first and the list carrying
  its own epoch so a truncated list is never mistaken for a complete one.
- **Supersession.** By epoch, max-wins. A list is only honoured if its epoch is
  ≥ the highest seen; a list at a lower epoch is discarded entirely. There is no
  merge, no union, no ordering question.
- **Replay / un-revocation.** Structurally impossible: the stored value only ever
  increases. An attacker replaying an old signed epoch changes nothing. This is
  the property that makes A safe to run over a fully untrusted courier — the
  phone is a **dumb pipe** in exactly the §6.6 sense, and a hostile phone can
  withhold an update but can never roll one back.
- **A gate nobody else uses.** A degrades to nothing. The revoked person's own
  phone will not deliver their own revocation, and if no one else visits, nothing
  arrives. This is the honest failure mode, and it is why A cannot stand alone
  — the residual at such a gate is bounded only by TTL (§7.1) and the existing
  14-day ceiling (§7.4). **This must be said to operators rather than buried:**
  low-traffic gates revoke slowest.

### 7.4 Option C — the staleness bound that already exists

**It is real, it is already shipped, and it is a constant.**

- `controller/internal/wire/wire.go:37` — `StaleClockLimitSeconds = 1209600`
  (14 days), with `ReasonStaleClock = "stale_clock"` at `wire.go:54`.
- Enforced as **step 1** of the redemption order,
  `controller/internal/grants/grants.go:181`:
  `if clock.Stale(env.Now, env.LastGatewaySync, wire.StaleClockLimitSeconds)`.
- `clock.Stale` fails closed in **both** directions — a clock reset *backward*
  past the last sync (an RTC-less reboot) is also stale, per the test at
  `controller/internal/clock/clock_test.go` ("Stale must fail closed in both
  directions") and the note at `grants.go:174-180`.
- The last-sync instant is persisted across reboots (`state.go:200-210`,
  `clock.NewSynced` at `controller/internal/clock/clock.go:34-44`, wired at
  `controller/internal/agent/agent.go:86-88`), so power-cycling does not reset
  the window.
- The user-facing wording already exists at `src/lib/offline/redeem.ts:76`.

**So a controller already refuses to operate indefinitely without hub contact.**
That is a free, shipped, hard ceiling of 14 days on *any* offline grant.

**Can the same channel carry revocation? No — and that is the important
finding.** The clock sync flows over the **controller↔hub** link
(`agent.go:86-88`). If that link is up, revocation is already solved by the
online path and offline grants are not the mechanism in play. The channel is
therefore unavailable in exactly the scenario that needs it.

**What to reuse is the *shape*, not the channel:** a monotonic, persisted,
fail-closed freshness value that the controller will not operate without. Option
B is that identical shape applied to *authorisation* instead of *time*, which is
why B should be implemented as a sibling of the stale-clock rule in the same
step sequence, sharing its persistence (`state.go:35-41`) and its
refuse-on-regression discipline — rather than as a second, parallel mechanism.

### 7.5 Option D — two-tier / break-glass grants (**not recommended**)

The proposal: a short everyday TTL plus a longer break-glass grant, loudly
audited when used.

**The audit loudness does not compensate, because the loudness is deferred by
exactly the same outage that made the long grant necessary.** The controller is
offline; its record of the break-glass use reaches the hub only when it
reconnects, or never. For a revoked insider — the threat this is supposed to
address — an alarm that arrives days later, after they have already walked
through the gate, is not a control. It moves the problem rather than solving it.

There is also a structural objection: it adds a second grant class, a second TTL,
a second UI affordance and a second wire shape, on the highest-risk path in the
product, to buy a deferred notification.

**What already fills this role better:** the **14-day stale-clock ceiling**
(§7.4) *is* the break-glass bound, and it is free and already enforced; and
**lockdown** is the immediate sub-TTL override, latched at the controller and
checked as step 2 of redemption (`grants.go:186`), documented as the one lever
that works when nothing else can reach the gate
(`offline_grants.go:33-46`). Recommend building neither tier nor alarm.

### 7.6 One authority hub, or one hub per site?

| Shape | Fits | Cost |
|---|---|---|
| **One hub, many sites** — sites are `locations` under one account; controllers at every site pin **the same** hub key | A single operator with several properties — the founder's original multi-site case. **This is already fully supported with no new code**: `locations.account_id` (`0001_baseline.sql:85`), access points and devices scoped through the location (`tenants.go:220-238`, `tenants.go:241-252`). Central revocation is trivial: one member list, one epoch. | One key opens every gate at every site — the blast radius is the whole estate (§6.2). The hub must be reachable from all sites for the online path, or every site runs on offline grants. Site failure is correlated. |
| **One hub per site** — independent hubs, no coordination | Independent authorities (home + a friend's office), and large operators who want failure and compromise isolation between sites. | No central revocation across sites. Each site revokes its own people. The app holds several records (this document). |

**The clarifying point:** the multi-site *operator* case does not need multi-hub
at all — one hub with many locations already does it. Multi-hub in the app is for
**independent authorities**. That distinction shrinks the problem considerably
and should be stated in the user-facing docs, because operators currently reach
for "a hub per building" when "a location per building" is what they want.

### 7.7 Recommendation, and the residual

**Recommended combination:**

1. **P-7 — configurable per-account TTL** (clamped by the existing 7-day
   ceiling, with a floor). The availability dial, defaulting to today's value.
2. **Option B — signed monotonic epoch**, enforced at the controller as a sibling
   of the stale-clock rule. The enforcement mechanism.
3. **Option A — phones as couriers** for that epoch, riding the existing
   `grant.open` exchange. The delivery mechanism. No new component, no gate
   connectivity.
4. **Option C — the existing 14-day stale-clock ceiling**, unchanged. The
   backstop. Do not add a parallel mechanism.
5. **Not D.** Lockdown already fills the break-glass role.

**The residual — how long can a revoked person still open a gate?**

**It is not zero. State it out loud.**

| Case | Window |
|---|---|
| Controller **online** (the normal case) | **Effectively zero** — the hub simply stops dispatching; the online choke point denies at `openpath.go:265-282`. |
| Controller offline, gate with **normal traffic** | **Minutes to hours** — until the first other authorised person, whose phone has since reached the hub, presents at that gate and carries the new epoch. |
| Controller offline, gate with **no other traffic** | **Up to the full configured grant TTL** — 7 days at today's default, 12 hours if configured so. Nothing arrives to carry the epoch. |
| Controller offline **and never synced for 14 days** | **Hard stop at 14 days** — `stale_clock` refuses everything (`wire.go:37`, `grants.go:181`). This binds only when the TTL is longer, which today it never is. |

**So the honest one-line answer: worst case equals the configured grant TTL, at
a gate nobody else uses.** Everything in this section shortens the typical case
from "the full TTL" to "minutes"; nothing shortens the worst case except the TTL
dial itself. An operator who cannot accept 7 days lowers the TTL and accepts the
blackout tradeoff in §7.1 — knowingly, with both numbers in front of them.

All five items are free, open source, add no component anyone must run, and
require no connectivity at the gate.

---

## 8. Why hub-to-hub sync was rejected

Recorded so the decision is not relitigated from scratch.

**What it would have cost:** weeks of new protocol on the highest-risk surface in
the product. A peer-pinning and pairing model; tombstone semantics where
revocation must dominate and a merge that cannot decide must fail closed;
monotonic replay protection; an engine-mismatch handshake (flowstock's peers
advertise their merge engine and refuse to sync across a mismatch, precisely
because two algebras in one mesh converge only by luck — `flowstock/README.md`
"Merges with the shared DMTAP Sync engine"); a stability cut and compaction; and
a conformance-vector suite for all of it. And the audit log — hash-chained per
hub (`audithash.go`), append-only, with immutability triggers since
`0007_audit_hash_chain.sql` — cannot be merged at all: joining two chains either
breaks verification or invents an ordering of events that did not happen.

**Against:** days of work in the app for the same user-visible outcome.

**The decisive asymmetry:** in a sync design, a CRDT bug is an **open gate**. In
this design, an app bug is a **denial** — the controller refuses a grant it
cannot verify against its pinned key (§1). Those are not comparable risks, and
the cheaper option is also the safer one. `docs/KOTVA-ALIGNMENT.md:238-252`
reached the same conclusion independently: Aql's store is single-writer, and
adopting CRDT sync for access policy would be a regression unless the
single-writer rule were preserved explicitly — which, for authorisation, means
not merging it.

**The one case that would justify revisiting:** an operator who must revoke
someone centrally and have it propagate to many sites with nobody in the loop.
Nobody has asked for that yet — and §7 now solves it without sync anyway
(one hub with many locations for a single operator; signed epoch carried by
phones where the hubs really are independent). Revisit only if a case appears
that both of those genuinely fail.

---

## 9. What this does not solve

Stated plainly rather than buried.

1. **Worst-case revocation latency is not zero** — it is the configured TTL at a
   gate no one else uses (§7.7).
2. **A compromised hub owns its own site completely.** Nothing app-side detects
   a hub that mints grants it should not (`vault.ts:64-68`). P-3 detects a hub
   whose *key changes*, not a hub whose *policy* is corrupted.
3. **Non-extractable is not hardware-backed** (`vault.ts:52-57`). An attacker
   with OS-level access to the browser engine's key store on a device they
   control is not defeated. The Rust-side keystore backend named at
   `vault.ts:28-33` remains the upgrade this wants.
4. **A hub restored from an old backup** can reissue grants to people its stale
   database still thinks are members (§6.4). Local, not propagating, and no worse
   than today — but real.
5. **Clock skew at the controller** is bounded but not eliminated: ±90 s
   (`wire.go:30`), and the whole offline path leans on the gateway-synced clock
   (`clock/clock.go`) with the 14-day fail-closed ceiling as its backstop.
6. **First contact with a hub is trust-on-first-use.** P-2 pins the key at
   enrolment; it cannot authenticate the very first fetch. Out-of-band key
   verification (showing a fingerprint the operator can read aloud) would close
   this and is not proposed here.
7. **A stolen unlocked phone opens gates** until the grants expire or the
   operator latches lockdown. This is what a bearer capability means.
8. **Low-traffic gates revoke slowest** (§7.3), which is the opposite of what
   most operators would guess.

---

## 10. Build plan

Ordered. Each step leaves a working system, and step 1 is worth doing alone.

**Step 1 — stop deleting other hubs' grants.** Change `pruneRecords`
(`vault.ts:406-429`) to take a set of hub identities and `loadState`
(`service.ts:53-67`) to enumerate records instead of selecting one (P-1, P-6).
Nothing else changes; the UI still shows one hub. *Standalone value:* switching
the console hub stops silently destroying emergency access — a real bug fixed on
its own, independently testable.

**Step 2 — pin hub identity to the key.** Fetch and store the hub public key at
enrolment, re-key records on it, demote `gatewayUrl` to a mutable address hint,
and refuse a changed key with a surfaced error (P-2). *Value:* a home hub is one
record whether reached by LAN or from outside.

**Step 3 — verify grants against the pinned key on every refresh** (P-3), and
codify the vault invariants of §2.5 and §6.1 as tests. *Value:* a replaced hub
is detected at refresh instead of at the gate.

**Step 4 — per-hub app keys** (P-4). Migrate existing single-key records in
place by re-enrolling on next refresh. *Value:* removes the cross-hub
correlator.

**Step 5 — the unified gate list.** Group by hub, per-hub freshness labelling
per §11, keep the console single-hub (P-5). *Value:* the actual user-facing
feature; home + office in one list.

**Step 6 — configurable TTL** (P-7): one settings field, one argument at
`offline_grants.go:161`, floor and clamp enforced server-side. *Value:* the
availability/security dial, useful with no other change.

**Step 7 — signed epoch, enforcement half** (§7.2): hub mints and signs it,
issuance stamps grants with it, the controller persists max-seen and checks it as
a sibling of the stale-clock rule. Ship with the check **advisory-logged first**,
then enforcing, so no fleet is bricked by a rollout ordering mistake.

**Step 8 — signed epoch, courier half** (§7.3): the app carries the latest epoch
it has seen for a hub and includes it in `grant.open`. *Value:* completes central
revocation; typical latency drops from the full TTL to minutes.

Steps 7 and 8 are the only ones that touch the wire and the controller, and they
are deliberately last — everything the founder's home+office case needs is done
at step 5.

---

## 11. What the user is shown about freshness

**Staleness must never be presented as validity.** Per record:

| State | Shown |
|---|---|
| Refreshed recently | "Confirmed with **Home** 2 hours ago. Opens 3 gates until Friday." |
| Not reachable since | "**Not confirmed since 12 May.** This will still open the office gates until 19 May **unless the office hub has withdrawn it** — this device has not been able to ask." |
| Past half-life, hub unreachable | As above, plus a prompt to connect when possible. `needsRefresh` already exists (`grant.ts:335`, `service.ts:184-200`). |
| Expired | Record deleted; "Your grant for **Office** expired and was removed." (`vault.ts:368-376`) |
| Malformed / fails pinned-key check | Record deleted; the reason shown (`vault.ts:356-367`, extended by P-3). |
| Hub key changed | Refused, not re-enrolled; "The hub at this address is not the one you enrolled with." (P-2) |

The amber wording is the honest one: the app knows the grant is
**cryptographically valid until `exp`**, and it does **not** know whether the hub
has since revoked it. It must say both, and must never render a bare green
"Valid" for a grant it has not re-verified. A verdict type already exists
(`grant.ts:182`, `evaluate` at `grant.ts:246`) and gains a freshness dimension
rather than a new mechanism.

---

## 12. Uncertain — needs verification

- **Does any platform in scope refuse to store several non-extractable
  CryptoKeys?** P-4 assumes per-hub keys store as reliably as one. The existing
  read-back check (`vault.ts:300-307`) would catch a failure at enrolment rather
  than at a gate, so the risk is contained — but it should be exercised on iOS
  Safari and the Tauri webview specifically before P-4 ships.
- **Epoch bump granularity.** This document assumes an epoch bump on member
  removal/disable and account suspension only. Whether role changes or
  access-point removals should also bump it is a policy question that needs an
  operator's opinion; bumping too eagerly recreates the short-TTL problem.
  Settle it by enumerating the mutations in `store/members.go` and
  `store/tenants.go` that can *reduce* someone's standing.
- **Whether `access_points` ids are stable across a hub restore.** §2.5 rule 2
  keys the UI on `(hubPubkey, accessPointId)`; if a restore can reissue ids, the
  display snapshot could mislabel a gate (it would not misauthorise one — the
  controller checks the signed list). Settle by reading the restore path.
- **`ARCHITECTURE.md:121`'s "7 migrations, 22 tables"** is stale — there are 19
  migration files (`0001`–`0020`, no `0008`) and 42 `CREATE TABLE` statements.
  Unrelated to this design, but worth fixing while nearby. Counting them is a
  one-liner, so prefer re-deriving over trusting this note, which has already
  gone stale once.
