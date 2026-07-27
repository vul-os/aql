# KOTVA alignment — evidence-based audit

> **Status: audit, not a plan of record.** This document reports what is true in three
> repositories on the date below. It proposes no change to the KOTVA specification, and the
> settled direction it audits against is: **Aql sits on top of KOTVA/DMTAP as it exists today;
> we do not amend the KOTVA spec.**

**Date:** 2026-07-26
**Repos audited (read-only except this file):**

| Repo | Path | HEAD at audit time | Tree state |
|---|---|---|---|
| aql | `/Users/pc/code/vulos/aql` | `bf99a4d` ("fold: lintel becomes Aql's access + chat engine") | **dirty — 77 modified files**, an in-progress `lintel` → `aql` module-path rename |
| kotva | `/Users/pc/code/vulos/kotva` | `e99ffd7` | 4 modified files |
| ephor | `/Users/pc/code/vulos/ephor` | `f57ca81` | clean |

**Citation convention.** Every claim about either side is `file:line`. Kotva paths are relative
to the kotva repo, aql paths to the aql repo, ephor paths to the ephor repo. All line numbers
were verified against the working tree at audit time. **Caveat:** the aql tree was being
modified *during* this audit (the rename touches import lines only, so line numbers are stable,
but re-verify before quoting this document in a commit message).

**What this document does not do.** It does not claim a KOTVA feature exists without quoting the
spec line, and does not claim aql code does something without citing file and line. Where a
question could not be settled by reading, it says **uncertain — needs verification** and states
what would settle it.

---

## 0. Two premises in the commissioning brief are stale

Stated up front because both change the work list.

### 0.1 `GatewayAuthz` is no longer wire-debt in KOTVA — it was closed

The brief cites `26-legacy-adapters.md:421-422` and `07-gateway.md:869` as flagging a
per-address/per-rail `GatewayAuthz` grant type "planned, not yet defined on wire". **Neither line
says that today.**

- `26-legacy-adapters.md:421-422` is now the "Free adapters still carry the exposure statement" /
  "Settlement is delegated" text.
- `07-gateway.md:869` is a blank line. The per-address grant text lives at `07-gateway.md:887-891`
  and already resolves to the wire object: *"an explicit **per-address grant**: a
  `CapabilityToken` (§18.7.3) with `Capability.resource = "gw-addr:"+address` … referenced from
  the operator's `GatewayAuthz.grants` (§12.2, §18.8a.3)"*.
- `26-legacy-adapters.md:441-445` now reads: *"**Resolved — `GatewayAuthz` per-rail authorisation
  scope** (§26.2.1 item 1). No longer a grant-type addition awaiting definition"*.
- The object is defined: `18-wire-format.md:1968-2020` (§18.8a.3), with CDDL at
  `18-wire-format.md:1995-2002` and the appendix restatement at `18-wire-format.md:2943-2951`.
  `18-wire-format.md:1972-1974` states explicitly that it closes both sites: *"§7.11.2 step 2 and
  §26.2.1 item 1 each cited a 'planned… not yet defined on wire' per-address/per-rail grant type;
  this closes both from the same object rather than minting two."*
- Closed by kotva commit `307bf87` ("coordinator+wire: pay the coordinator wire-debt
  (CoordinatorDescriptor/Tariff/UsageReceipt/GatewayAuthz)").

**Ephor E1.4 is still open** (`ephor/BACKLOG.md:29`, unchecked), so the *implementation* debt is
real — see §3. But it is implementation debt, not spec debt, and that distinction matters for
what Aql can build against today.

### 0.2 §26 does not currently bind Aql's chat channels at all

§26 defines an adapter as *"a pluggable bridge between one legacy communication rail and DMTAP
MOTEs"* (`26-legacy-adapters.md:26-27`). Aql's chat channels bridge a legacy rail to Aql's *own*
SQLite/HTTP domain model. **No MOTE is constructed, sealed, verified or consumed anywhere in the
aql tree** — the only DMTAP-shaped code is a scaffold whose sole transport implementation always
fails closed (`hub/internal/channels/dmtap.go:127-141`).

So most of §26 is an obligation Aql would *acquire* on riding KOTVA, not one it is currently
failing. §3 assesses both readings, because two of §26's obligations (§26.6 sovereignty
disclosure, §26.8.2 credential paths) bind on the *facts about the rail*, not on the wire format,
and therefore attach to Aql today under either reading.

---

## 1. Waist mapping — the six capabilities of `DIRECTION.md §1`

| KOTVA capability (`DIRECTION.md:28-36`) | Nearest thing in Aql today | Fit |
|---|---|---|
| **Identity** (`:30`) | Ed25519 keypairs, pinned gateway key, enrolled controller keys | **Good** on the machine leg · **absent** on the human leg |
| **MOTE** (`:31`) | JCS/Ed25519-signed JSON envelopes (`cmd`, `cmd.ack`, `event`, `grant`, `grant.proof`) | **Signed yes; encrypted no; content-addressed no.** Expressible as a MOTE with no spec change — see §1.2 |
| **Transport** (`:32`) | Outbound WSS + long-poll to one pinned URL; LAN mDNS+HTTP; BLE GATT | **Poor** as KOTVA Transport (nothing key-addressed); the LAN/BLE half is philosophically aligned |
| **PUB** (`:33`) | Unsigned SHA-256 hash chain over two SQLite audit tables | **Absent** — and this is the cheapest, highest-value gap |
| **SYNC** (`:34`) | None; single-writer SQLite | **Absent, and correctly so** — see §1.5 |
| **Roles & Wake** (`:35`) | None | **Absent** — but Aql already obeys the one rule OFFLINE.md attaches to Wake |

### 1.1 Identity — good fit for machines, no fit for humans

KOTVA: *"A keypair is the identity. Names (DNS / chain / key-name floor) are swappable
pointers."* (`DIRECTION.md:30`).

What Aql has:

- The controller generates its Ed25519 keypair **on device** at first boot and the private key
  never leaves it (`proto/pairing.md:31-33`).
- The redeem response is the **only** moment the gateway public key is accepted; thereafter the
  controller "rejects any command or config not signed by that key" (`proto/pairing.md:34-36`).
- Public keys on the wire are raw 32-byte Ed25519, base64url, no framing
  (`proto/README.md:32-33`) — the same minimal shape KOTVA's `ik-pub` takes.
- The gateway verifies every controller uplink against that device's enrolled key
  (`hub/internal/hub/hub.go:152-169`).

Where it does not reach KOTVA's row:

- **There is no name layer, and nothing is resolved.** The controller reaches exactly one
  hard-pinned `ws_url` (`proto/pairing.md:39-41`). KOTVA's Identity row pairs the keypair with
  *swappable name pointers*; Aql has zero. Locally that is fine. It stops being fine the moment
  two Aql deployments must address each other.
- **Rotation is weaker than KOTVA's.** `repair` is an all-or-nothing swap with no overlap window
  (`proto/pairing.md:115-118`), and the orchestration around it is unbuilt: *"Nothing today
  actually calls `repair`"* (`proto/pairing.md:120-127`). Aql's own doc already proposes the fix
  (a small pinned list with `valid_from`, `proto/pairing.md:152-161`) — which is a hand-rolled
  approximation of KOTVA's `KeyRotation`/`MoveRecord` machinery.
- **Residents/members have no keypair at all.** They are a verified phone number or a channel
  user id (`hub/internal/store/channels.go:89-102`, `:121-135`). The *only* human-held key
  anywhere in the system is `app_pubkey` inside an offline grant
  (`hub/internal/keys/grant.go:36`) — and the app that would hold it does not exist:
  *"What is **not yet implemented anywhere in this codebase is the app side**"*
  (`proto/grants.md:169-177`).

**Verdict:** the machine leg is already KOTVA-shaped and would cost little to align. The human
leg has no identity layer to align, which is exactly what the DMTAP-channel idea was reaching
for (`ARCHITECTURE.md:274-283`).

### 1.2 MOTE — the load-bearing question: can the signed open-command be a MOTE with no spec change?

KOTVA: *"The universal object: signed, encrypted, content-addressed."* (`DIRECTION.md:31`),
`Envelope` at `02-mote.md:32-49`, `Payload` at `02-mote.md:159-175`.

Aql today has five signed JSON object types over JCS (RFC 8785) + Ed25519
(`proto/README.md:27-31`): `cmd` (`proto/commands.md:9-22`), `cmd.ack`
(`proto/commands.md:74-78`), `event` (`proto/events.md:10-21`), `grant`
(`proto/grants.md:9-23`), `grant.proof` (`proto/grants.md:60-64`). Signed: yes. Encrypted: no.
Content-addressed: no.

#### Answer: **yes — by two independent routes, neither of which touches the KOTVA spec.**

**Route A — a Private Use message kind.** The Message Kinds registry allocation policy is:
*"`0x00`–`0x0B`: assigned … `0x40`–`0x7F`: Specification Required (the extension range named in
§2.3/§10.1). `0x80`–`0xFE`: Private Use. `0xFF`: Reserved."* (`21-errors-iana.md:500`). Private
Use is defined as *"not registered at all; meaningful only within a closed deployment"*
(`21-errors-iana.md:471`). An `0x80` `aql_command` kind is therefore allocatable by Aql alone,
with no registration, no review, and no spec edit. Interop safety is already specified: *"A
recipient MUST NOT `ack` a kind it does not implement. Unknown kinds … are **ignored** … never
rejected as malformed"* (`02-mote.md:126-129`).

**Route B — no new kind at all.** Ride an existing kind and discriminate in the headers, exactly
as KOTVA itself does for `UsageReceipt`, which shares kind `0x0A` with two other object types and
is discriminated by `Headers.mime` (`26-legacy-adapters.md:458-465`). `Headers.ext` additionally
offers an unregistered namespace: *"`x-`-prefixed keys: Private Use / FCFS — no registration
required"* (`21-errors-iana.md:540`, §21.20).

So the brief's question has an unqualified **yes**. But "expressible" and "advisable" are
different claims, and four things are lost or must be re-carried in the body. Stating them is
the point of this section:

1. **A MOTE has no authorisation validity window.** `Envelope` carries `ts` (sender timestamp)
   and no `nbf`/`exp` (`02-mote.md:32-49`). `Payload.expires` exists but is *"requested expiry
   (client-enforced deletion)"* (`02-mote.md:164`) — a deletion hint, not an authorisation bound.
   Aql's `exp − iat ≤ 60` plus ±90 s skew on both bounds (`proto/commands.md:57-60`, enforced at
   `controller/internal/command/command.go:89-98`) has no MOTE-native home and would have to be
   re-carried inside the body. Not a spec change; but it is the loss of "the substrate checks it
   for you".
2. **Replay defence is a different mechanism, not the same one.** Aql uses a durable single-use
   nonce store that fails closed when full (`proto/commands.md:61-65`;
   `controller/internal/command/command.go:99-110`). KOTVA gives content-address dedupe:
   *"idempotent by content-address `id`; duplicates dedup, they do not double-apply"*
   (`substrate/OFFLINE.md:165`). Content-address dedupe makes a *redelivery* a no-op; it does not
   bound how long a valid old command stays actuatable. Both are needed; MOTE supplies one.
3. **Sealing is mandatory, and the recipient is a Raspberry-Pi-class board.** A MOTE's
   *authenticating* signature lives **inside** the sealed payload (`Payload.from` / `Payload.sig`,
   `02-mote.md:81-86`, `02-mote.md:176-186`). A controller verifying a MOTE must therefore do
   HPKE Base-mode open (`02-mote.md:180-186`) + CBOR + BLAKE3 content-addressing *before* it can
   learn who signed. Today it does Ed25519 + RFC 8785 JSON with **zero external dependencies**
   (`controller/README.md:19-21`), on hardware where the GPIO driver and BLE radio are still
   stubs (`controller/README.md:65-67`). This is the single largest cost in the whole alignment
   and "MOTE fits" does not address it.
4. **`sender_sig` proves signing, never authority.** KOTVA states the rule in general terms:
   *"A valid mesh `sender_sig` proves *who signed*, **not** *who may relay* — anyone can sign a
   MOTE"* (`07-gateway.md:876-878`). Applied to a gate: MOTE authenticity gives a controller
   "this key signed this", never "this key may open this gate". The authorisation fact must come
   from elsewhere — which is `CapabilityToken`, §4 below.

**Verdict:** expressible with no spec change (high confidence). A poor *first* substitution to
make (high confidence) — it replaces something that works with something heavier, on the piece of
hardware with the least headroom, and buys the least.

### 1.3 Transport — poor fit as-is; the LAN/BLE half is aligned in spirit

KOTVA: *"Reach anyone by key — online, offline, or over a mesh. Store-and-forward at the edge."*
(`DIRECTION.md:32`), profiled as announce/resolve, signalling, circuit relay, mailbox, cache/pin
(`substrate/ROLES.md:35-41`).

Aql: an outbound WSS to a single URL pinned at pairing, with HTTPS long-poll fallback
(`proto/pairing.md:39-41`); LAN mDNS `_lintel._tcp` + plain HTTP (`proto/grants.md:185-190`); BLE
GATT (`proto/grants.md:193-219`).

- **Nothing is key-addressed.** There is no announce/resolve, no rendezvous, no relay. The
  controller reaches one URL belonging to one gateway. `substrate/ROLES.md:1-30`'s premise —
  roles addressed by identity key, no privileged node type — has no counterpart in Aql.
- **The LAN and BLE paths are closer to KOTVA than the WSS path is.** They are transport-agnostic
  at the message layer (*"transport-agnostic JSON. Two transports are specified; both carry the
  identical message layer, so verification code is shared"*, `proto/grants.md:180-183`) and
  explicitly refuse to derive trust from the transport (*"Plain HTTP is acceptable: every message
  is Ed25519-signed and single-use; the transport adds no trust"*, `proto/grants.md:190-191`;
  *"BLE pairing/bonding is NOT used or trusted"*, `proto/grants.md:214-217`). That is precisely
  the posture of `R-MOTE-1`: *"because the MOTE is sealed and signed, a carrier is
  `blind`/`blind-routing` … and is **trusted for nothing**"* (`substrate/OFFLINE.md:98-102`).
- **What KOTVA Transport would actually buy Aql** is concrete: reaching a controller behind CGNAT
  without the operator standing up a publicly reachable gateway URL — announce/resolve plus
  circuit relay (`substrate/ROLES.md:36-38`). Today that scenario requires a reachable gateway,
  full stop.

### 1.4 PUB — absent, and this is the biggest cheap win

KOTVA: *"Signed public objects + author feeds — authenticity without confidentiality"*
(`DIRECTION.md:33`); feeds carry `seq` + `prev` so *"a fork in an author feed is a **detectable
equivocation**, surfaced not merged"* (`substrate/OFFLINE.md:164`).

Aql's nearest object is the audit hash chain over `access_logs` and `admin_audit_log`. It is a
SHA-256 chain over `{chain, prev_hash, fields}` rendered as JCS
(`hub/internal/store/audithash.go:103-110`) and it is **not signed** — there is no Ed25519
anywhere in that file. Its own header says the consequence plainly:

> *"a hash chain does NOT stop an attacker who edits the SQLite file directly AND recomputes
> every hash after their edit forward through the end of the chain. That attacker can still
> rewrite history undetectably."* — `hub/internal/store/audithash.go:6-13`

That is exactly the gap a signed, `seq`-chained PUB feed closes: rewriting becomes a *detectable
equivocation* rather than an undetectable recompute. And it composes with the second audit defect
Aql already self-discloses — controller events carry no sequence number, so *"a gateway operator
looking at a gap in the timeline cannot distinguish 'the gate was quiet' from 'the gate was busy
and we lost the record'"* (`proto/events.md:113-126`). A feed `seq` is the missing field in both
places.

**This is the strongest, cheapest, most under-appreciated item in the whole alignment**, and it
requires no MOTE, no MLS, no HPKE and no KOTVA transport.

### 1.5 SYNC — absent, and Aql should be slow to adopt it

KOTVA: *"Multi-author signed CRDT — shared mutable state with no server"* (`DIRECTION.md:34`).
Aql has none; the gateway's SQLite is single-writer.

Adversarial note in Aql's favour: `R-SYNC-1` says *"A CRDT guarantees the two replicas reach
**byte-identical state** on reconnect; it does **not** guarantee that state satisfies an
application invariant that neither replica could check while partitioned"*, and requires such
invariants to be enforced *"by a **single-writer authority** for that resource"* or surfaced as a
detectable conflict (`substrate/OFFLINE.md:131-139`). Visitor-grant use caps are exactly that
invariant class: `max_uses`/`uses_count` are enforced by a server-side counter in a single SQL
predicate (`hub/internal/store/channels.go:56-68`,
`hub/internal/store/grants.go:37`). Aql's current shape — one gateway is the sole writer for
a location's access state — *is* the shape R-SYNC-1 prescribes. Adopting SYNC for access policy
would be a regression unless the single-writer rule is preserved explicitly.

### 1.6 Roles & Wake — absent; but Aql already obeys R-ROLE-1

KOTVA: *"Infrastructure roles any node may take; content-free push to offline nodes"*
(`DIRECTION.md:35`). Aql has no role vocabulary and no push at all — reachability is a standing
outbound socket or a poll (`proto/pairing.md:39-41`).

Worth recording in Aql's favour: `R-ROLE-1` says *"A profile MUST NOT design a flow whose
*correctness* depends on a wake arriving; wake is an optimisation over polling"*
(`substrate/OFFLINE.md:148-151`). Aql's dispatch already treats non-delivery as a first-class,
never-fabricated outcome: `undelivered` is *"a **dispatch outcome, not a negative result**"*, the
gateway *"never reports success when the controller did not answer"*, and the chat reply is
*"deliberately non-committal"* (`proto/commands.md:108-126`). That is `R-GRADE-2` compliance
(`substrate/OFFLINE.md:61-63`) in a codebase that has never read `OFFLINE.md`.

---

## 2. §26 node-mode obligations, checked against `hub/internal/channels/`

### 2.1 Which obligations are node-mode obligations

Read carefully, §26 splits into three groups.

**Gateway-mode only** — do not bind a node-mode adapter. §26.2's table gives node mode
*"Authorisation layer: none — there is only one identity, so there is nothing to authorise
between"* and *"Billing: none"* (`26-legacy-adapters.md:54-59`), and §26.2.1's four additions are
scoped to *"The moment an adapter serves more than one identity"*
(`26-legacy-adapters.md:74-78`). This covers **ADAPT-1**, **ADAPT-7**, **ADAPT-12**
(`26-legacy-adapters.md:508`, `:514`, `:519`).

**Binding in node mode.** §26.3 is explicit that the four-field declaration applies to a
node-mode-only adapter, in its documentation: *"A conformant adapter — in its own documentation
if node-mode-only, and additionally in a published `AdapterDescriptor` … if it ever runs in
gateway mode — MUST declare four fields"* (`26-legacy-adapters.md:105-108`). §26.5.1 is explicit
that its rule survives mode: *"This holds **regardless of adapter mode**. Node mode does not
upgrade a platform-asserted claim to a cryptographic one"* (`26-legacy-adapters.md:255-257`). The
node-mode checkable set is therefore **ADAPT-2, 3, 4, 5, 6, 8, 9, 10, 11**.

**Applicability caveat.** Per §0.2 above, Aql's channels are not §26 adapters today (no MOTEs).
The table below assesses them anyway, on the reading that they *will be* the moment
`DMTAPTransport` gains a real implementation — and flags separately the items that bind now
regardless.

### 2.2 Assessment

| # | Obligation (ref) | Aql today | Evidence |
|---|---|---|---|
| **ADAPT-2** | Declare all four fields; per-direction where asymmetric (`:509`) | **Missing entirely** | Zero occurrences of initiation class / inbound transport class / price shape / exposure in `gateway/`, `controller/`, `proto/` or `docs/`. The *distinction* exists in code — `Channel` is webhook-shaped, `DialChannel` is outbound-persistent, with the CGNAT rationale stated verbatim (`hub/internal/channels/channels.go:65-80`) — but no declaration exists for a user. |
| **ADAPT-3** | Template-walled outbound-cold presented as a functional wall, never a price tier (`:510`) | **Not satisfied; latent** | Nothing models a service window or a template anywhere. Masked today because every outbound send is a reply to a verified inbound webhook. **But** `proto/events.md:41` specifies the intercom feature (`button` → *"gateway notifies the resident's chat — 'Someone is at the gate. Reply OPEN.'"*), and `ARCHITECTURE.md:271-272` lists it as "protocol supports now, ship later". That is a **gateway-initiated cold send** — exactly §26.4.1's wall (`26-legacy-adapters.md:192-202`). Verified unimplemented: controller `event` uplinks are signature-verified and then only logged (`hub/internal/httpapi/devices.go:351-352`). |
| **ADAPT-4** | `AuthResults` carries a structurally distinct platform-asserted entry (`:511`) | **N/A, and blocked in KOTVA itself** | `26-legacy-adapters.md:452-457` lists this as *"**Still open** — `AuthResults` platform-asserted entry"*. Aql cannot conform even in principle until it lands. |
| **ADAPT-5** | No visual parity between a platform-asserted claim and `dmarc=pass` (`:512`) | **Vacuously satisfied; substantively not carried** | There is no verified-sender badge in the UI, so nothing is mis-rendered. But the underlying honesty is absent: the webhook is HMAC-verified (`hub/internal/channels/channels.go:189-244`), the phone/user-id is then resolved straight to a member (`hub/internal/store/channels.go:89-102`), and a **physical actuation** is signed on the strength of it — with no marker anywhere that the origin is platform-asserted. §26.5's point is that this is *"evidence of what the platform's backend says, never of what a signature proves"* (`26-legacy-adapters.md:250-254`). A gate is the highest-consequence place to lose that distinction. |
| **ADAPT-6** | Client can say whether a conversation is node-mode (portable) or gateway-mode (dies, handle reassignable) (`:513`) | **Not satisfied — and Aql is structurally in gateway mode** | Credentials are a single **process-global** set read from env (`hub/internal/channels/channels.go:112-144`, `:154-172`), wired once at startup (`hub/cmd/hub/main.go:270-271`), while the store is multi-account (`hub/internal/store/channels.go:93-95`; cross-tenant admin listings at `hub/internal/store/admin.go:294`, `:369`, `:435`). One WhatsApp number ID serves every account on the instance (`hub/internal/httpapi/channels_whatsapp.go:59-66`). By §26.2's table that is *"Identities served: many"* → gateway mode (`26-legacy-adapters.md:54-59`). **See §2.3 for the honest counter-argument.** |
| **ADAPT-8** | WhatsApp defaults to BYO credentials; BSP option labelled distinctly (`:515`) | **Satisfied by construction, not by declaration** | No path provisions Meta access on a user's behalf; the operator supplies `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` themselves (`hub/internal/channels/channels.go:156-160`). No BSP path exists, so nothing is mislabelled. Nothing is declared either. |
| **ADAPT-9** | No unofficial WhatsApp libraries or ban-evasion rotation as a credential path (`:516`) | **NOT SATISFIED — a genuine conflict** | See §2.4. |
| **ADAPT-10** | Node core ships no adapter but hardware SMS; every other adapter versions independently (`:517`) | **Not satisfied; N/A today** | All four rails are in-tree in one Go module (`hub/internal/channels/{whatsapp,slack,telegram,socketmode}.go`, `hub/go.mod`) started by one call (`hub/cmd/hub/main.go:278`). §26.9's rule is about *"The node core"* (`26-legacy-adapters.md:350-352`) and Aql's gateway is not a KOTVA node — so this is N/A now and binding the moment it becomes one. It is a real architectural constraint on the DMTAP plan, because `dmtap.go` currently sits in the same package as the legacy rails. |
| **ADAPT-11** | A free adapter still populates the exposure field; "free" never reads as "private" (`:518`) | **Not satisfied** | No exposure statement exists (see ADAPT-2). Concretely: Telegram and Slack are free and both put the platform in the plaintext path of a message that **opens a physical gate** (`26-legacy-adapters.md:187-189`, `:417-421`). `docs/THREAT-MODEL.md` contains **zero** mentions of WhatsApp, Meta, Slack, Telegram, "platform" or "chat" — verified by grep across all 146 lines. Worse, it still asserts *"No cloud broker sits between you and your devices"* (`docs/THREAT-MODEL.md:19`) and scopes out *"Multi-tenant / multi-user permission models … single-operator model only"* (`docs/THREAT-MODEL.md:119-120`), both of which the folded gateway contradicts. |

### 2.3 The honest counter-argument on ADAPT-6, and why the disclosure duty survives it

Two readings are available and I do not think the evidence settles between them:

- **Reading A (Aql is in gateway mode).** One set of rail credentials, many accounts served ⇒
  §26.2's "Identities served: many".
- **Reading B (§26 does not attach).** §26's "identity" is a *DMTAP identity*, and Aql has none.
  Further, Aql's channels are **terminating endpoints**, not relays: the gateway replies as
  itself and never sends *as* a member to a third party, so §26.2.1 item 1's *"which identity may
  send as what"* (`26-legacy-adapters.md:80-89`) has no referent.

Reading B is the stronger technical reading today. **But §26.6's consequence binds under either
reading**, because it is a fact about the phone number, not about the wire:

> *"In gateway mode, the remote party sees the **gateway's** number or handle. Leave that gateway
> and the channel **dies** — and … **everyone who knows that number now reaches someone else**"*
> — `26-legacy-adapters.md:267-272`

A self-hosted Aql operator using their own WABA has a portable channel. A shared, operator-run
Aql instance does not. **Nothing in the product tells a user which one they have.** That
disclosure obligation is real today, independent of MOTEs.

Likewise §26.7's reply-routing state — *"(rail, remote party, which number/bot/account) → identity"*,
which the operator *"can corrupt"* and *"can leak"* (`26-legacy-adapters.md:288-305`) — exists in
Aql right now as `channel_identities` / `channel_chats`
(`hub/internal/store/channels.go`, `hub/internal/store/migrations/0005_channels.sql`),
and is undisclosed.

### 2.4 ADAPT-9 — the one place Aql is squarely non-conformant

§26.8.2 rules out two credential paths, *"not merely discouraged"*:

> *"a conformant implementation MUST NOT offer either as a WhatsApp credential path: **Unofficial
> WhatsApp libraries** that speak the consumer app's protocol rather than the Business Platform
> API…"* — `26-legacy-adapters.md:331-339`

Aql ships exactly that as an opt-in engine. `BridgeWhatsAppSender` targets Evolution API, and
Aql's own comment names what that is:

> *"a self-hosted bridge (Evolution API / OpenWA / MultiWA — anything fronting Baileys, an
> unofficial reverse-engineered WhatsApp Web client) carries a real account-ban risk"*
> — `hub/internal/channels/send.go:172-178`

The engine is opt-in and fails closed toward the official Cloud API
(`hub/internal/channels/send.go:179-181`, `:210-225`), and the code's honesty about the ban
risk is exemplary. But §26.8.2's MUST NOT is unconditional — it is not "node-mode only", it is
"MUST NOT offer". **Aql is non-conformant with ADAPT-9 today, on a non-default path.**

**Noted, but not mine to resolve:** kotva's own Rust framework appears *softer* than §26.8.2's
prose. It defines `Sanctioning::Unsanctioned` — *"No sanctioned bridge exists (consumer WhatsApp,
iMessage, Signal) … **node-mode only**, never operator-hosted"*
(`crates/kotva-mail/src/adapters/mod.rs:88-93`) — and enforces only that such a rail cannot run in
gateway mode (`crates/kotva-mail/src/adapters/mod.rs:123-130`), not that it must not be offered.
That is a possible internal inconsistency in kotva between §26.8.2 and its reference
implementation. **Reported, not acted on** — no kotva file was modified.

### 2.5 What §26 already gets from Aql for free

Not everything is a gap. These are genuinely satisfied, several of them exceeding what §26 asks:

- **One binary, two modes.** *"An implementation MUST NOT require a separate build, fork, or
  reimplementation to move an adapter from node mode to gateway mode or back"*
  (`26-legacy-adapters.md:61-65`). Satisfied: mode is entirely env configuration
  (`hub/internal/channels/channels.go:154-172`).
- **Fail-closed inbound authentication, better than §26 requires.** Unset secret refuses; missing
  or malformed signature refuses; constant-time compare; Slack's 300 s replay window enforced
  (`hub/internal/channels/channels.go:189-244`, `:52`).
- **The fail-closed rule §26.2.1 wants, stated as a seam invariant.** *"an unset credential means
  'this channel does not run', never 'this channel runs unauthenticated'"*
  (`hub/internal/channels/channels.go:82-88`).
- **A choke point that no channel can bypass.** *"A channel decides how to ask and how to reply;
  it NEVER decides whether the gate may open"* (`hub/internal/channels/channels.go:8-11`),
  with every open funnelling through `store.LogAccess` → `SignCommand` → `hub.Dispatch`
  (`hub/internal/httpapi/open.go:4-7`, `:57`, `:101-127`).
- **The DMTAP scaffold's honesty is exactly right.** `NotImplementedTransport` fails closed on
  every call and is documented as *"never a silent no-op that could be mistaken for 'it works,
  just quietly does nothing'"* (`hub/internal/channels/dmtap.go:127-141`); `Enabled()` is
  false without a real transport (`:168`); the contract doc leads with **"v0 DRAFT, NOT
  IMPLEMENTED"** (`proto/dmtap-channel.md:1-11`).

### 2.6 KOTVA already ships the §26 decision table Aql is missing

Relevant to the work list: `crates/kotva-mail/src/adapters/mod.rs` implements the §26 framework
as pure, network-free data and logic — `InitiationClass` (`:29-37`), `InboundTransportClass`
(`:39-52`), `PriceShape` (`:54-63`), `DeploymentMode` (`:65-73`), `RailAuthenticity` (`:75-82`),
and the canonical per-rail table for SMS/WhatsApp/Telegram/Discord/Slack (`:205-275`), with
`OutboundDisposition::{Deliverable, BlockedNoWindow, RequiresTemplate}` (`:141-152`) and tests
pinning it to the spec (`:279-322`). The four per-rail modules are empty placeholders
(`crates/kotva-mail/src/adapters/{slack,telegram,discord,whatsapp_business}.rs`, 5 lines each).

Aql can copy that decision table as data rather than re-deriving §26 from prose.

---

## 3. The gateway-mode gap — corrected status, and exactly what it blocks

### 3.1 Status in each repo

| | Status | Evidence |
|---|---|---|
| **kotva spec** | **CLOSED** | §18.8a.3 defines `GatewayAuthz` (`18-wire-format.md:1968-2020`), CDDL at `:1995-2002`; a per-rail grant is a `CapabilityToken` with `Capability.resource = "gw-rail:"+rail+":"+remote_id`, `ability = "send-as"` (`18-wire-format.md:1983-1991`; `26-legacy-adapters.md:84-89`). `26-legacy-adapters.md:441-445` marks it "Resolved". |
| **ephor impl** | **OPEN** | `ephor/BACKLOG.md:29` — `[ ] E1.4 Authz — authenticated-sender + per-address/per-rail scope (GatewayAuthz shape, §7.11.2/§26)`, unchecked. What exists is a **per-domain** policy trait: `fn authorize(&self, direction: BridgeDirection, domain: &str) -> AuthzDecision` (`ephor/crates/gateway/src/provenance.rs:438-440`), with a domain→account allowlist (`:442-468`). **There is no rail dimension and no `CapabilityToken` grant handling anywhere in ephor.** `ephor/COORDINATION.md:136-140` still describes it as open wire debt — that note is now itself stale on the spec half. |
| **aql** | **N/A** | No authorisation-scope concept exists in any form; grep for tariff/exposure/descriptor/authz across `gateway/` returns nothing. |

### 3.2 Multi-tenant scenarios this blocks

1. **One Aql instance operating a rail on behalf of multiple accounts, where a member of account
   A could cause an outbound send presenting as a handle belonging to account B.** Today this is
   impossible only because there is exactly one handle per rail per process
   (`hub/internal/channels/channels.go:112-144`) — a coincidence of configuration, not an
   enforced rule. §26.2.1 item 1 requires the operator to *"know, for every outbound message it
   relays, which of its served identities is authorised to present as which remote-facing
   number/handle/account"* and to refuse otherwise (`26-legacy-adapters.md:80-89`). Aql has no
   such record and no such check.
2. **Per-account rail credentials** (several WABAs, several Slack workspaces, several bot tokens
   on one instance). This needs an authorisation scope keyed by (identity, rail, remote id) —
   literally the `"gw-rail:"+rail+":"+remote_id` resource string. The wire is defined; nothing
   implements it.
3. **Hosted/resold Aql**, where the operator's own handle fronts many customers. Needs (2), plus
   §26.6's portability disclosure (`26-legacy-adapters.md:267-280`) and §26.7's reply-routing
   disclosure (`26-legacy-adapters.md:307-312`).

### 3.3 Single-tenant scenarios this does *not* block

1. **A self-hosted Aql with the operator's own WABA / bot / Slack workspace, serving one
   account.** §26.2's node-mode row: *"Authorisation layer: none — there is only one identity, so
   there is nothing to authorise between"* (`26-legacy-adapters.md:59`). Nothing to build.
2. **The entire controller path** — pairing, signed commands, acks, events. `GatewayAuthz`
   governs *legacy-rail egress authorisation*; it has no bearing on gateway→controller actuation,
   which is a pinned-key relationship (`proto/pairing.md:34-36`), not a rail.
3. **The entire offline-grant path** — issuance (`hub/internal/httpapi/offline_grants.go`),
   LAN/BLE redemption, controller verification
   (`controller/internal/grants/grants.go:174-250`). No rail, no adapter, no coordinator.
4. **A real `DMTAPTransport`, single-identity.** A node-mode DMTAP channel — the gateway holding
   its own DMTAP identity and talking to members' identities — needs no authorisation scope at
   all. That is exactly the shape `ARCHITECTURE.md:274-283` describes.

---

## 4. Offline grants vs `substrate/OFFLINE.md`

### 4.1 The obligation

> **The sneakernet test** — *"does it still work with the network unplugged, and heal when it
> returns?" A capability passes iff (a) every action a user can take offline is either
> **completed locally** or **captured as a signed intent that completes on reconnect** — never
> silently dropped and never silently treated as if it completed; and (b) on reconnect the
> capability **reconciles deterministically** from the two replicas' state alone, with no
> coordinator required to referee.*
> — `substrate/OFFLINE.md:28-34`

### 4.2 Clause (a) — the action passes; the record does not

**Completed locally: yes, cleanly.** The controller's 11-step verification *"touches nothing but
the presented bytes and the controller's own pinned key / clock / lockdown state"*
(`proto/grants.md:115-117`), implemented step-for-step at
`controller/internal/grants/grants.go:174-250` (step 1 stale-clock at `:174-182`, step 11 at
`:248`). No coordinator is in the path, by construction — *"that locality is the feature this
whole path exists for"* (`proto/grants.md:130-133`).

**Never silently treated as complete: yes, and stronger than asked.** The offline open is
recorded **before** actuation, into a reserved queue partition, degrading to an always-on
fsync'd overflow log rather than failing outright (`proto/events.md:71-82`).

**Never silently dropped: NO — and this is the honest failure.** Three documented paths lose the
record:

1. If both the reserved partition and the overflow log fail to write, *"the controller proceeds
   with **no** audit record at all. Even then, **the gate still opens**"* (`proto/events.md:82-86`).
   Aql argues this is the right tradeoff (a stranded resident is worse than a paperwork gap) and
   that argument is defensible — but the sneakernet test does not grade tradeoffs, it grades
   silence.
2. Normal events are dropped oldest-first once the ring fills (`proto/events.md:59-64`).
3. There is no delivery ack at all, so *"the controller believes the event delivered (and drops
   it from its durable queue) while the gateway never has it"* (`proto/events.md:95-111`), and no
   sequence number makes the resulting gap detectable (`proto/events.md:113-126`).

Against `R-GRADE-2` — *"A `deferred` action MUST carry, and display, its *unsettled* status until
reconcile confirms it"* (`substrate/OFFLINE.md:61-63`) — an event the controller has already
dropped from its queue has had its unsettled status erased. **Clause (a): passes for the
actuation, fails for the audit.**

### 4.3 Clause (b) — idempotent reconcile yes; conflict surfacing not exercised

- `R-REC-1` (*"Replaying the drain twice … MUST converge to the same state"*,
  `substrate/OFFLINE.md:168-170`): **satisfied.** Events drain on reconnect and dedupe on
  `event_id` (`proto/events.md:27-32`).
- `R-REC-2` (*"equivocation and over-commitment are surfaced, not swallowed"*,
  `substrate/OFFLINE.md:171-176`): **not exercised, and — verified — not currently reachable.** I
  expected to find a live problem here (a visitor use cap that two partitioned parties could
  jointly overspend) and checked it directly. It does not arise:
  - Offline grants are **member-only**: issuance requires an authenticated user
    (`hub/internal/httpapi/offline_grants.go:69-70`) who is an active member of the access
    point's account (`hub/internal/httpapi/offline_grants.go:113-125`).
  - Visitor passes are a separate, phone-keyed mechanism whose cap is a **server-side counter**
    enforced in one SQL predicate (`hub/internal/store/channels.go:56-68`,
    `hub/internal/store/grants.go:37`) — the single-writer authority `R-SYNC-1` prescribes.
  - Member grants carry no counter at all; windows are unrestricted by design, matching the
    online path's own lack of a member schedule
    (`hub/internal/httpapi/offline_grants.go:151-160`).

  **Conclusion: the one offline-violable invariant in the product is structurally excluded from
  the offline path today.** If offline grants are ever extended to visitors, `R-SYNC-1` and
  `R-REC-2` become live obligations immediately.

### 4.4 Does it need anything KOTVA does not already provide? No — the mapping is unusually clean

Aql's grant is, field for field, a `CapabilityToken`:

> *"a signed, offline-verifiable, **attenuable** grant of a *specific, least-privilege* right,
> from an issuer key to an audience key … Delegation is verified **without contacting any
> server**"* — `18-wire-format.md:1722-1728`

| Aql `grant` (`proto/grants.md:9-23`, `hub/internal/keys/grant.go:31-43`) | KOTVA `CapabilityToken` (`18-wire-format.md:1731-1745`) |
|---|---|
| gateway signing key | `iss` (key 2) |
| `app_pubkey` | `aud` (key 3) |
| `access_points[]` + implicit "open" verb | `caps` → `Capability.resource` / `.ability` |
| `devices[]`, `windows[]` | `Capability.caveats` |
| `iat` | `nbf` (key 5) |
| `exp` (clamped to 7 d, `hub/internal/keys/grant.go:12`, `:83-85`) | `exp` (key 6) — *"MUST be present — no non-expiring capability"* (`18-wire-format.md:1737`) |

Two things this buys immediately:

- **A stricter caveat rule than Aql has.** Caveats are *"purely restrictive and conjunctive"* and
  *"A verifier that does **not recognise** a caveat key MUST **fail closed**"*
  (`18-wire-format.md:1780`). Aql's controller has no equivalent rule for unknown grant fields.
- **A defined revocation object and channel** — `CapabilityRevocation` (`18-wire-format.md:1750-1756`),
  where Aql has none at all (*"v0: undefined / open question"*, `proto/grants.md:135-142`).

**But be honest about what KOTVA does not fix.** `CapabilityRevocation` is *"a separately
published, KT-logged object"* (`18-wire-format.md:1726-1728`) — which an offline controller
equally cannot fetch. **KOTVA has the same offline-revocation residual Aql does.** What it adds is
a defined object to consult the moment the controller is online, and the right vocabulary for the
residual: `R-MOTE-2` distinguishes *self-contained* proofs (verifiable offline with no
coordinator) from *issuer-redemption* proofs (which offline *"MUST"* be treated as
`deferred`/`blocked` and *"MUST NOT"* be accepted on signature validity alone)
(`substrate/OFFLINE.md:103-115`). Aql's grant is a self-contained proof; a revocation check is an
issuer-redemption-shaped fact. Naming it that way costs nothing and is more precise than the
current prose.

### 4.5 The one OFFLINE.md obligation Aql does not meet at all

`OFF-1`: *"classifies every offline-reachable action into exactly one degradation grade and
surfaces it"* (`substrate/OFFLINE.md:269`), against the four grades at
`substrate/OFFLINE.md:48-53`. Aql has no degradation vocabulary anywhere. The mapping is short
and would be a real honesty improvement:

| Aql action offline | Grade | Why |
|---|---|---|
| Offline grant redemption over LAN/BLE | `full` | No coordinator was ever in the path (`substrate/OFFLINE.md:50`) |
| The audit record of that redemption | `deferred` | Captured now, delivered on reconnect (`proto/events.md:29-32`) — and per `R-GRADE-2` it must display as unsettled until it lands |
| Chat-initiated open (any rail) | `blocked` | Needs the platform *and* the gateway; must fail closed and say why (`substrate/OFFLINE.md:53`) |
| Revocation of an issued grant | `blocked` | No channel exists (`proto/grants.md:135-142`) |

`R-GRADE-1` then requires the resident be told which state they are in
(`substrate/OFFLINE.md:57-60`). Aql's chat copy already does a version of this for the online
path — *"couldn't reach the gate — it may be offline"* (`proto/commands.md:113-115`) — so the
product instinct is already right; only the vocabulary and the coverage are missing.

---

## 5. Verdict and work list

### 5.1 Verdict

**Aql is not "on KOTVA" in any sense today, and no part of it is close to being so by accident.**
It is a well-built, internally consistent, JCS/Ed25519 access-control protocol that shares
KOTVA's *values* — fail-closed everywhere, self-authenticating objects, honestly disclosed
residuals — while sharing none of its *bytes*.

Ranked honestly:

- **Best fit:** Identity on the machine leg (§1.1) and PUB (§1.4). PUB is the only place where
  riding KOTVA fixes a defect Aql has already documented against itself, twice
  (`hub/internal/store/audithash.go:6-13`, `proto/events.md:113-126`).
- **Real but second-order:** Transport, for CGNAT reach without a public gateway URL (§1.3).
- **Expressible but expensive and low-value first:** MOTE (§1.2). Yes, the open-command can be a
  MOTE with zero spec change. No, it should not be the first thing built — it replaces working
  code with heavier code on the hardware with the least headroom, and it does not, on its own,
  carry the validity window or the authority fact that make the current envelope correct.
- **Correctly absent:** SYNC (§1.5).
- **Squarely non-conformant, today, independent of any of the above:** ADAPT-9 (§2.4), and the
  missing §26.3/§26.6 disclosures (§2.2, §2.3).

The biggest single honesty gap found is not a protocol gap at all: `docs/THREAT-MODEL.md` still
describes a single-operator, no-cloud-broker product (`:19`, `:119-120`) while the folded gateway
is multi-account and routes gate-open commands through Meta, Slack and Telegram.

### 5.2 Work list, ordered by value ÷ cost

1. **Declare the four §26 fields for each chat rail, in `proto/` and in the product UI.**
   `[no spec change needed]` — §26.3 explicitly accepts documentation for a node-mode-only
   adapter (`26-legacy-adapters.md:105-108`). Discharges ADAPT-2, ADAPT-11, and most of ADAPT-6's
   disclosure duty at once. Copy the table from `crates/kotva-mail/src/adapters/mod.rs:205-275`
   rather than re-deriving it from prose.
2. **Update `docs/THREAT-MODEL.md` to match the folded product.** `[no spec change needed]` —
   name the platforms as plaintext parties in the actuation path, drop or qualify "no cloud
   broker" (`:19`), and remove multi-tenancy from "out of scope" (`:119-120`) now that
   `account_members` and cross-tenant admin exist.
3. **Resolve the ADAPT-9 conflict on the WhatsApp bridge engine.** `[no spec change needed]` —
   either drop `BridgeWhatsAppSender` (`hub/internal/channels/send.go:256-271`), or keep it
   and declare the §26.8.2 non-conformance explicitly in (1). Do not leave it undeclared. This is
   a founder call, not an engineering one.
4. **Gate the intercom / `button` feature behind an initiation-class check *before* it ships.**
   `[no spec change needed]` — port `OutboundDisposition`
   (`crates/kotva-mail/src/adapters/mod.rs:141-152`, `:186-203`): a cold outbound on
   Telegram/Slack becomes a surfaced `BlockedNoWindow`, WhatsApp cold a surfaced
   `RequiresTemplate`, never a silent send failure. The feature is currently unimplemented
   (`hub/internal/httpapi/devices.go:351-352`) — the cheapest possible moment to get it right.
5. **Sign the audit chain and give it `seq` + `prev` — make it PUB-shaped.**
   `[no spec change needed]` — closes `hub/internal/store/audithash.go:6-13`'s self-declared
   limit. Requires no MOTE, no MLS, no KOTVA transport. Highest value per unit cost in this list.
6. **Add a per-device monotonic event `seq` on the wire.** `[no spec change needed]` — this is
   Aql's own v1 proposal (`proto/events.md:121-126`); `R-ID-1` additionally requires it be
   persisted *before* the object bearing it is emitted (`substrate/OFFLINE.md:87-90`), which the
   controller's fsync-per-append ordering (`proto/events.md:53-56`, `:71-79`) nearly gives already.
7. **Adopt `OFFLINE.md`'s degradation vocabulary (OFF-1/OFF-2).** `[no spec change needed]` — the
   four-row table in §4.5 above, surfaced to the user. Mostly documentation and UI copy over
   behaviour that is already correct.
8. **Re-express the offline grant as a `CapabilityToken` at the object level.**
   `[no spec change needed]` — mapping in §4.4. Adopt the fail-closed-on-unrecognised-caveat rule
   (`18-wire-format.md:1780`) even before adopting the encoding. State plainly that this does
   *not* fix revocation.
9. **Keep visitor passes out of the offline-grant path, or handle `R-SYNC-1` when they enter it.**
   `[no spec change needed]` — currently safe by construction (§4.3); make it a written invariant
   rather than an accident of the endpoint's auth model.
10. **Build a real `DMTAPTransport`.** `[no spec change needed]` for the open-command-as-MOTE
    question specifically (Private Use kind `0x80`–`0xFE`, `21-errors-iana.md:500`; or
    `Headers.mime` + an `x-` ext key, `21-errors-iana.md:540`). Blocked on engineering, not spec:
    no Go binding for MOTE construction or MLS exists (`proto/dmtap-channel.md:21-49`). Move
    `dmtap.go` out of `internal/channels/` when it lands, per ADAPT-10's independent-versioning
    rule (`26-legacy-adapters.md:348-356`).
11. **Multi-tenant chat egress with per-account rail identity.** `[blocked on ephor E1.4]` — the
    wire is defined (`18-wire-format.md:1968-2020`, resource `"gw-rail:"+rail+":"+remote_id`,
    ability `"send-as"`), the implementation is not: ephor's `GatewayAuthz` is a per-**domain**
    trait with no rail dimension (`ephor/crates/gateway/src/provenance.rs:438-440`) and E1.4 is
    unstarted (`ephor/BACKLOG.md:29`). Blocks the three scenarios in §3.2; blocks none of §3.3.
12. **Mark platform-asserted origins as such in `AuthResults`.**
    `[blocked on kotva §26.11's own open item]` — `26-legacy-adapters.md:452-457` records this as
    "Still open" in the spec, so ADAPT-4 is unreachable. **The client-side half (ADAPT-5) is
    satisfiable today and should be done anyway**: a gate is the highest-consequence place to
    conflate "the platform says so" with "a signature proves so".

### 5.3 What I could not settle

- **Whether an Aql instance is "gateway mode" under §26.2** — two defensible readings (§2.3).
  **Uncertain — needs verification.** What would settle it: a founder ruling on whether an Aql
  account is an "identity" for §26 purposes, or (cleaner) a decision on whether hosted multi-
  account Aql is a product at all. If it is not, Reading B holds permanently and items 11 and
  much of 1 shrink.
- **Whether kotva's `Sanctioning::Unsanctioned` (node-mode-only) and §26.8.2's unconditional MUST
  NOT are meant to be the same rule** (§2.4). **Uncertain — needs verification** by the kotva
  spec owner. It changes whether item 3 is "drop it" or "declare it".
- **Whether the `lintel` → `aql` rename in flight changes any of the cited line numbers.** The
  rename touches import paths (same-line substitutions), so line numbers should be stable, but
  the tree was dirty (77 files) throughout this audit. Re-verify before citing in a commit.
