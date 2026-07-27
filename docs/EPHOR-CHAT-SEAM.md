# The Ephor chat seam — moving the rails out of Aql's hub

> **Status: design specification for a decided direction.** The direction —
> **Ephor does the chat layer; Aql's hub consumes it** — is a founder decision and is not
> re-litigated here. What is settled by a specification is cited. What is my proposal is
> labelled **PROPOSAL**. What I could not settle by reading is labelled
> **uncertain — needs verification**, with what would settle it.
>
> **Nothing here is built.** No code accompanies this document. Read
> [`KOTVA-ALIGNMENT.md`](./KOTVA-ALIGNMENT.md) (what is true across the three repos) and
> [`CHAT-COMMANDS.md`](./CHAT-COMMANDS.md) (the chat command model) first; this document
> depends on both and edits neither.

**Date:** 2026-07-26
**Repos read (read-only; this file is the only thing written):**

| Repo | Path | HEAD at writing |
|---|---|---|
| aql | `/Users/pc/code/vulos/aql` | working tree as read |
| kotva | `/Users/pc/code/vulos/kotva` | `f2d5385` |
| ephor | `/Users/pc/code/vulos/ephor` | working tree as read |

**Citation convention.** Every load-bearing claim is `file:line`, relative to the repo named
in the path. Kotva spec sections are cited by both `§` and line so a section renumber is
detectable.

**Caveat on line numbers.** The aql tree was dirty while this was written (45 changed paths).
`gateway/` — the source of every Go citation below — was **not** among them, so those line
numbers are stable. The root `ARCHITECTURE.md` **was** being edited during the writing, and
was re-verified against its current state before this document was finalised; re-check its
citations before quoting them in a commit.

---

## 0. Three corrections to the brief, verified before anything is designed

Stated first because each changes the work.

### 0.1 `ephor/coordinator/CONTRACT.md` does not exist

There is no `coordinator/` directory in the ephor repo. The contract lives only at
`kotva/coordinator/CONTRACT.md` (294 lines), and Ephor consumes it by reference: its
guardrails say *"**Read** the kotva spec (`coordinator/CONTRACT.md`, …) — never edit it"*
(`ephor/BACKLOG.md:17-18`), and each kind crate restates its own clause posture in rustdoc
(e.g. `ephor/crates/gateway/src/coordinator.rs:1-9`). **Every CONTRACT citation in this
document is to `kotva/coordinator/CONTRACT.md`.** If a mirror is wanted in ephor, it should
be created as an explicit copy with a pinned provenance line — an unmarked mirror of a
normative document is a second source of truth.

### 0.2 The checklist is COORD-1..**10**; the harness implements COORD-1..**8**

`kotva/coordinator/CONTRACT.md:284-293` lists ten rows. `COORD-9` (*"prices service performed
only, never deliverability or classification"*, `:292`) and `COORD-10` (*"where staked, the
stake is verified on-rail"*, `:293`) have **no counterpart** in
`ephor/crates/broker-conformance/src/lib.rs`, whose `check()` pushes exactly eight findings
(`:148-241`) and whose module doc says *"the COORD-1..8 checklist"* (`:4-5`), as does
`ephor/crates/README.md:12` and `ephor/BACKLOG.md:46`. This is not a defect for a chat
adapter — a free rail is not staked, and COORD-9 is satisfied by charging nothing — but the
gap should be named rather than inherited silently.

### 0.3 Kotva already ships four §26 rail adapters — but **not at the tag Ephor pins**

`kotva/crates/kotva-mail/src/adapters/` contains a real §26 framework plus four sanctioned
rail modules: `mod.rs` (395 lines — the four-field declaration types at `:82-146`, the
per-rail property table as data at `:261-333`, the `LegacyAdapter`/`RailTransport` traits at
`:224-257`), `whatsapp_business.rs` (620), `telegram.rs` (428), `discord.rs` (416),
`slack.rs` (379), `sms_hardware.rs` (168) — 2,406 lines total. The canonical
platform-asserted `Headers.ext` key §26.5.1 requires is already a constant
(`adapters/mod.rs:35`), and the per-rail mapping honours it
(`adapters/slack.rs:68-80`: empty `from`, empty `sig`, `verifiable = false`).

**But Ephor pins `kotva-core`/`kotva-mail` by tag `core-v0.2.0`**
(`ephor/crates/gateway/Cargo.toml:25-29`; the isango guardrail, `ephor/BACKLOG.md:10`), and
**that tag predates the adapters**. Verified: `git ls-tree -r core-v0.2.0` lists sixteen
`crates/kotva-mail/src/*` paths and **no `adapters/` entry**; the tag is commit `a4a6ca5`
("crates: carve kotva-core + kotva-mail out of envoir"), and the adapter work landed in
`60a1303`, `f2901b1`, `f2d5385` — all after it.

Consequence: **step 1 of the migration is a kotva retag** (or an explicit, reviewed pin bump),
not Rust code. This is cheap, but it is a hard dependency and it is invisible from the aql
side. KOTVA-ALIGNMENT flagged the adapters table as copyable
(`docs/KOTVA-ALIGNMENT.md:390-400`); the tag detail is new here.

---

## 1. What Ephor gains

### 1.1 Not a new coordinator kind — a new *instance* of `gateway`

The kinds table is closed by its own text: *"**This table is the single canonical,
authoritative list of coordinator kinds for the entire KOTVA family.** It names **twelve**
kinds … and no other document may enumerate a different count or add a kind not listed here"*
(`kotva/coordinator/CONTRACT.md:199-203`). And §26 already assigns adapters a kind:

> *"An adapter is a `gateway`-kind coordinator (CONTRACT §5: "the legacy `adapter`s (§26)… are
> the first, fully-worked instances" of the contract, alongside §7). `AdapterDescriptor` is
> therefore not a bespoke object but the general `CoordinatorDescriptor` (§18.8a.1) with
> `kind = "gateway"`"* — `kotva/26-legacy-adapters.md:160-164`

`kotva/18-wire-format.md:1863-1874` says the same from the wire side, and explicitly retires
the reserved `DMTAP-ADAPT-v0/…` DS-tags: *"an adapter, being a `gateway`-kind coordinator
(CONTRACT §5), signs the same object a mail gateway would, never a second parallel scheme"*
(`:1873-1874`). Ephor's own enum already has exactly eleven variants with no room for a
twelfth (`ephor/crates/broker-economics/src/kinds.rs:11-36`; `infra-service` from CONTRACT §5
is absent, which is a separate pre-existing gap).

**So: no new kind. A new crate.**

**PROPOSAL.** `ephor/crates/chat-adapter/`, exposing a `ChatAdapterCoordinator` that returns
`CoordinatorKind::Gateway` from `Coordinator::kind()` and publishes **one signed descriptor
per (rail, mode)**. §26.3.1's field list is per-rail — `{ adapter_ik, rail, mode,
initiation_class, inbound_transport_class, price_shape, exposure, credential_model,
tariff_ref, region }` (`kotva/26-legacy-adapters.md:147-149`) — and `CoordinatorDescriptor`
carries exactly one `Visibility` (`kotva/18-wire-format.md:1888`, `:1914`), so one descriptor
cannot honestly cover three rails at two modes. Everything rail-specific rides `policy`
(key 5), which is exactly what that field exists for: *"Opaque deterministic-CBOR operator
policy (region, capabilities, contact, and every kind-specific field §7.5/§26.3.1 already
enumerate for `gateway`)"* (`kotva/18-wire-format.md:1915`).

**Naming.** `kotva/STYLE.md:65-66` is explicit: *"the **mail adapter is the "gateway"** — keep
that name for it, and do **not** use "gateway" as the umbrella"*. The wire `kind` string must
be `"gateway"` (the CDDL enumerates no alternative, `kotva/18-wire-format.md:1912`), but the
crate, the type, the docs and the operator UI must all say **chat adapter**, never "gateway".
That collision is uncomfortable and worth reporting to the spec session — it is the first
instance where the wire vocabulary and the prose vocabulary disagree by construction.

### 1.2 The content-visibility declaration, precisely

```
Visibility { class: "terminating", level: "declared" }
```

`ContentVisibility::new(VisibilityClass::Terminating, AssuranceLevel::Declared)` in Ephor's
own types (`ephor/crates/broker-economics/src/visibility.rs:13-25`, `:29-41`).

There is **no other legal value**, and that is worth spelling out rather than presenting the
choice as virtuous restraint:

1. **The class is forced by the function.** A chat adapter must read the plaintext to speak
   the rail — it parses "open the front gate" and renders the reply. That is CONTRACT §3.1's
   `terminating`: *"Terminates encryption and sees plaintext — a deliberate, disclosed trust
   boundary"* (`kotva/coordinator/CONTRACT.md:121`). `blind` and `blind-routing` are not
   available to argue for.
2. **The level is forced by the wire.** *"a `terminating` class MUST declare `"declared"` —
   there is no `"structural"` assurance for a plaintext-terminating role"*
   (`kotva/18-wire-format.md:1896-1898`, restated normatively at `:1914`). `declared` is the
   weakest of the three: *"The operator **promises** it is blind; nothing structurally
   prevents cheating"* (`kotva/coordinator/CONTRACT.md:138`), and Ephor's own code agrees —
   `AssuranceLevel::Declared.is_verifiable()` is `false`
   (`ephor/crates/broker-economics/src/visibility.rs:52`).
3. **The pair still understates the exposure, and the honest declaration must say so
   elsewhere.** `Visibility` has two fields and names only *this* coordinator. It cannot
   express the second plaintext party that never goes away:

   > *"**The platform is always a plaintext party on these four rails, in every mode.** Node
   > mode removes the *gateway operator* as a second intermediary; it cannot remove the
   > platform as the first"* — `kotva/26-legacy-adapters.md:496-501`

   So `{terminating, declared}` is necessary and **not sufficient**. §26.3 field 4 (exposure)
   is the field that carries the rest, *"Stated per rail **and** per mode"*
   (`kotva/26-legacy-adapters.md:135-137`), and it lives in `policy`. Kotva's own table
   already has the strings: `"Meta, always + the operator"` / `"Meta, always + the user
   (self-hosted WABA)"` (`kotva/crates/kotva-mail/src/adapters/mod.rs:288-300`), `"Slack"`
   for both modes (`:312-318`).

   **This is the honest-vs-flattering line.** Declaring `{terminating, declared}` and stopping
   would let an operator truthfully answer CONTRACT §2.4 while a resident still believes the
   only party reading "open the front gate" is their own box. §26.10's rule is the same one
   read from the price side: *"A conformant adapter MUST NOT let "free" read as "private" — the
   exposure field is populated identically whether or not the price shape is `free`"*
   (`kotva/26-legacy-adapters.md:430-434`).

4. **Aql already says this out loud, in both halves** — *"The chat rail is not private. Meta,
   Slack and Telegram see the plaintext of every message"* (`ARCHITECTURE.md:180-182`) and,
   already written against this very direction, *"Whichever component terminates the rail, the
   exposure is the same … Moving the rail to Ephor relocates *where* the plaintext is handled;
   it does not remove a third party from the loop"* (`ARCHITECTURE.md:191-194`). Moving the
   rails into Ephor must not lose those sentences; it must move them into the descriptor where
   a machine can read them.

### 1.3 What `broker-conformance` will and will not check

Against `ephor/crates/broker-conformance/src/lib.rs:139-247`, for a chat adapter declaring as
above:

| # | Clause | Harness outcome | What it actually proves |
|---|---|---|---|
| COORD-1 | §2.1 | `Behavioral` (`:148-160`) — descriptor `kind` must equal operating kind, then defers with *"verify descriptor signature once kotva-core is pinned"* | Shape only. The `Descriptor` type structurally has no score/price-rank/stake field, so the §2.1 exclusion is by construction. **Note:** `kotva-core` **is** pinned now (`ephor/crates/README.md:16`), so this `Behavioral` is stale and could become a real signature check. |
| COORD-2 | §2.2 | Whatever the crate declares — `LockIn::None` → `Pass`, `LockIn::Requires` → **`Violation`** (`:166-169`) | **This is where the design bites. See §1.4.** |
| COORD-3 | §2.3 | `Pass` for `SelfHost::Backstop`; also `Pass` for `ScarceReachabilityException` **because `is_scarce_reachability()` keys off `kind == Gateway`** (`:178-187`, `ephor/crates/broker-economics/src/kinds.rs:120-125`) | A chat adapter would be *accepted* claiming the port-25 exception it does not have. **The crate must declare `SelfHost::Backstop` and must not take that false pass.** See §1.5. |
| COORD-4 | §2.4/§3 | `Pass`, with **no** behavioral follow-up — `must_not_present_as_verified()` is `false` for `terminating` (`ephor/crates/broker-economics/src/visibility.rs:77-81`, pinned by test at `:135-142`) | Only that exactly one class+level was declared. It does **not** check that a client surfaces it, and it does **not** see §26.3's exposure field at all, because that lives in the opaque `policy` blob. **The entire §26 disclosure burden is outside COORD-4.** |
| COORD-5 | §3.2 | Always `Behavioral` (`:205-211`) | Nothing statically. For a chat adapter there is no blind→terminating downgrade to catch (it declares terminating from the start), so the runtime test is near-vacuous. What it does **not** test is whether the adapter retains or logs the plaintext it legitimately reads. |
| COORD-6 | §4 | `Pass` for `Authorization` / `DerivedViewOnly` / `NoDeliveryPath`; `Violation` for `Classification` (`:217-221`) | See §1.6 — none of the four variants describes this adapter honestly. |
| COORD-7 | §6 | `Pass` (`NotMetered`) for free rails; a metered WhatsApp-outbound deployment must return `SignedReceiptsToPayer` (`:227-231`) | Posture, not behaviour. Nothing checks a receipt was actually delivered. |
| COORD-8 | §6 | `Pass` — no token anywhere (`:237-241`) | Real, and structurally true of this design. |
| COORD-9 | §4, §6 | **not implemented** | — |
| COORD-10 | §6 | **not implemented** (unstaked kind; not applicable) | — |

Beyond the harness entirely: **every ADAPT-N item** in `kotva/26-legacy-adapters.md:517-532`.
The spec's own note says ADAPT-1/6/7/11 are *"manual-attestation shaped (client UX / deployment
disclosure, no wire bytes to recompute)"* (`:534-540`). For a chat adapter that is most of the
honesty surface — ADAPT-6 (node vs gateway portability), ADAPT-7 (the reply-routing map),
ADAPT-11 (free ≠ private) — and **none of it is machine-checked by anything, in either repo,
today.**

### 1.4 The COORD-2 problem this design creates, stated rather than dodged

CONTRACT §2.2: *"Leaving a coordinator MUST be a **configuration change with zero data
migration and zero identity change** … Lock-in is a conformance violation, not a business
model"* (`kotva/coordinator/CONTRACT.md:54-59`).

§26.6, on the same fact for a rail:

> *"**In gateway mode**, the remote party sees the **gateway's** number or handle. Leave that
> gateway and the channel **dies** — and, more sharply than mail's alias residual …
> **everyone who knows that number now reaches someone else**"* —
> `kotva/26-legacy-adapters.md:280-285`

These do not agree. In **node mode** they do: the homeowner's WABA is the homeowner's, so
swapping Ephor for another adapter is config-only and the number survives — `LockIn::None`,
honest `Pass`. In **gateway mode** the rail identity belongs to the operator, and leaving
destroys the channel — which is lock-in in §2.2's own terms, and the harness's `LockIn` enum
has exactly two states, so the honest declaration
(`LockIn::Requires("gateway-mode rail identity is the operator's; leaving kills the channel, §26.6")`)
scores as a **`Violation`** and the report is non-conformant (`:123-128`, `:166-169`).

I do not think this is mine to resolve, and I have not resolved it. Two readings:

- **The harness is under-expressive.** A `LockIn::ModeDependent { node: None, gateway: Requires(…) }`
  variant would let a mode-parameterised descriptor pass honestly. **PROPOSAL**, and the
  smaller change.
- **§26.6 and §2.2 are genuinely in tension** and the spec should say which governs for a
  platform-mediated rail, where the "identity" a user would carry away is a phone number they
  never owned.

**Action: report to `ephor/COORDINATION.md`'s Ephor→Spec section** (the documented channel for
exactly this: *"questions · blockers · spec-gaps found while implementing"*,
`ephor/COORDINATION.md:16`). Do not paper over it by declaring `LockIn::None` for a
gateway-mode chat adapter — that would be the misrepresentation §2.4 names.

### 1.5 COORD-3: declare `Backstop`, and refuse the exception the harness would grant

`is_scarce_reachability()` returns true for `CoordinatorKind::Gateway`
(`ephor/crates/broker-economics/src/kinds.rs:120-125`), so a chat adapter declaring kind
`gateway` **could** claim `SelfHost::ScarceReachabilityException` and the harness would pass it
(`ephor/crates/broker-conformance/src/lib.rs:178-187`). It must not. The disclosed exception is
*"a reputable IP + unblocked port 25 for legacy SMTP egress"*
(`kotva/coordinator/CONTRACT.md:67-70`); a WhatsApp adapter needs no such thing.

The honest declaration is **`SelfHost::Backstop`**, and it is true: a user who can obtain their
own WABA / bot token can run the adapter for themselves and depend on no third party. The
platform account is a real barrier (Aql says so plainly — *"the WhatsApp number is hard"*,
`ARCHITECTURE.md:253-255`) but it is a barrier §2.3 does not list, and inventing a third
exception class for it is a spec change, not an implementation choice.

One nuance to declare rather than hide: WhatsApp's inbound transport class is `webhook`
(`kotva/26-legacy-adapters.md:128-130`; `kotva/crates/kotva-mail/src/adapters/mod.rs:283-301`), so
a self-hosting user needs a reachable HTTPS endpoint. That need is met by **hiring a
`reachability-adapter`** — a different coordinator kind that already exists in Ephor
(`ephor/crates/reachability-adapter/`, `blind-routing`) — not by the chat adapter claiming
scarcity it does not have. Telegram and Slack are `outbound-persistent`
(`kotva/26-legacy-adapters.md:125-127`) and need nothing.

### 1.6 COORD-6: none of the four `Gate` variants is honest

`Gate` offers `Authorization`, `Classification`, `DerivedViewOnly`, `NoDeliveryPath`
(`ephor/crates/broker-conformance/src/lib.rs:64-74`). For the chat adapter under §3's design:

- `NoDeliveryPath` is **false** — inbound rail→hub *is* a delivery path.
- `Classification` is **false and must stay false** — the adapter runs no spam scoring, no ML
  filter, no content-basis drop (`kotva/coordinator/CONTRACT.md:167-179`). This is a live
  constraint, not a formality: it is one of the two reasons intent resolution stays in the hub
  (§4). An adapter that parsed "open the front gate" into a verb and a target would be reading
  content in order to decide what reaches the hub.
- `DerivedViewOnly` is **false** — no derived view exists.
- `Authorization` is **true in gateway mode** (the `GatewayAuthz` egress check of §2 below is
  exactly identity-and-rate authorisation) and **hollow in node mode**, where §26.2's table
  says outright: *"Authorisation layer: none — there is only one identity, so there is nothing
  to authorise between"* (`kotva/26-legacy-adapters.md:59`).

**PROPOSAL:** declare `Gate::Authorization` in gateway mode; in node mode declare
`Gate::Authorization` **with a rustdoc disclosure** that the only gate on this path is applied
by the relying application (Aql's hub), and propose a
`Gate::AuthorizationDelegated { to: &'static str }` variant upstream so the declaration is
machine-readable rather than a comment. Report alongside §1.4.

---

## 2. Node mode vs gateway mode

### 2.1 The discriminant, applied to Aql's two shapes

§26.2's table separates the modes on one countable fact — *"Identities served: exactly one /
many"* (`kotva/26-legacy-adapters.md:54-59`).

**PROPOSAL (the counting rule).** The identity Ephor serves is **the hub it terminates the rail
for**, not the resident who texts. A resident is the *remote party* on the far side of the
rail; they hold no rail credential, present as nothing, and cannot cause an outbound send that
claims an identity. Under the §3 wire, Ephor never even learns which member a remote id maps
to. So the count is: *how many distinct Aql hubs' rail credentials does this Ephor process
hold?*

This reading is narrower — and I think sharper — than KOTVA-ALIGNMENT's Reading A/Reading B
pair (`docs/KOTVA-ALIGNMENT.md:310-330`), because the Ephor split makes the boundary physical:
identity resolution moves *out* of the rail terminator, so "many residents" stops being
evidence of "many identities served". **This is my proposal, not a spec ruling.**
**Uncertain — needs verification** by the same founder call KOTVA-ALIGNMENT already asked for
(`:656-660`).

| Shape | Rail credential | Hubs served | Mode | §26.2.1 authz layer |
|---|---|---|---|---|
| **Homeowner** — own WABA / own bot, Ephor co-located with the hub on their own box | theirs | 1 | **node** | none required (`:59`) |
| **Estate operator** — one estate, one WhatsApp number, many residents | the estate's | 1 | **node** (by the rule above) | none required — but see §2.2 |
| **Hosted Ephor** — one deployment, several estates' numbers/bots | the operator's | many | **gateway** | **all four of §26.2.1 REQUIRED** |

### 2.2 Node mode — including the estate operator, which is the subtle case

Node mode adds no authorisation layer, no billing, and no descriptor obligation *on the wire*.
It does **not** relieve the disclosure obligations, and §26.3 says so explicitly: *"A conformant
adapter — **in its own documentation if node-mode-only**, and additionally in a published
`AdapterDescriptor` … if it ever runs in gateway mode — MUST declare four fields"*
(`kotva/26-legacy-adapters.md:105-108`). §26.5.1 likewise: *"This holds **regardless of adapter
mode.** Node mode does not upgrade a platform-asserted claim to a cryptographic one"*
(`:255-257`).

**The estate operator owes §26.6's disclosure even in node mode.** The resident's channel runs
on the estate's number. A resident who moves out does not take it; a number the estate later
reassigns reaches a stranger — *"a phone number or bot handle a gateway operator reassigns to a
different tenant does not go silent, it goes to a stranger"* (`:280-285`). ADAPT-6 requires the
**client** be able to state which of the two a given conversation is (`:526`). That is Aql's UI
job, not Ephor's, and it is unbuilt today
(`docs/KOTVA-ALIGNMENT.md:304`, ADAPT-6 "Not satisfied").

**PROPOSAL.** The hub, not the adapter, renders the portability fact, because the hub is what
the resident has an account with. One line in the chat channel settings and in the first-run
reply: *"This WhatsApp number belongs to <Estate>. If you leave, this channel stops working and
the number may be reassigned."* — with the node-mode variant for a homeowner running their own
WABA: *"This is your own WhatsApp number; it keeps working if you stop using Aql."*

### 2.3 Gateway mode — the authorisation layer, concretely

Gateway mode adds *"exactly four things"* and *"gateway mode MUST provide all four and MUST NOT
be represented as providing less"* (`kotva/26-legacy-adapters.md:73-102`). For the hosted-Ephor
shape:

**(1) Authorisation scope — `GatewayAuthz`.**

The record is `kotva/18-wire-format.md:1994-2003`:

```cddl
GatewayAuthz = {
  1 => ik-pub,      ; identity     the (would-be) authorized sender's IK
  2 => u8,          ; mode         1 = open, 2 = key-registered (§7.12.1)
  3 => ts,          ; granted_at
  ? 4 => [* hash],  ; grants       content-addresses of CapabilityToken per-address/per-rail grants
  ? 5 => ts,        ; expires
  ? 6 => bool,      ; revoked
}
```

Applied here: `identity` is the **served hub's** substrate IK. `mode = 2` (key-registered,
`kotva/18-wire-format.md:2008`) — an Ephor operator should never run `mode = 1` open admission
for a rail that actuates gates. `grants` holds the content-addresses of the per-rail
`CapabilityToken`s.

A per-rail grant is a `CapabilityToken` (§18.7.3) with:

```
Capability.resource = "gw-rail:" ++ rail ++ ":" ++ remote_id
Capability.ability  = "send-as"
```

— `kotva/18-wire-format.md:1984-1992`, `kotva/26-legacy-adapters.md:84-89`. Concretely, for an
estate whose WhatsApp Business number is `+27821234567`:

```
resource = "gw-rail:whatsapp:+27821234567"
ability  = "send-as"
iss      = the Ephor operator (the adapter operator issues rail grants, §18.8a.3 item 2)
aud      = the estate hub's IK
exp      = MUST be present — "no non-expiring capability" (18-wire-format.md:1737)
```

Four properties that matter and are easy to lose:

- **It is gateway-local, unsigned, and never on the mesh.** *"`GatewayAuthz` is **gateway-local
  state** … it is **not mesh-transmitted** and carries **no signature of its own**. Its
  authenticity is not a property of its own bytes but of how it was **populated**"*
  (`kotva/18-wire-format.md:1976-1978`; the signing table records `— (none) … no DMTAP sig` at
  `:2113`). So Ephor stores it; it does not publish it, and a hub cannot verify it by receiving
  it. The verifiable artefacts are the `CapabilityToken`s it references and the §13.3
  `Assertion` that admitted the identity (`:1980-1992`).
- **Refusal is fail-closed with a named error.** `ERR_ADAPTER_CREDENTIAL_UNAUTHORIZED`
  (`0x0B03`) — `kotva/26-legacy-adapters.md:89`, `kotva/18-wire-format.md:2010`. Absent,
  expired (`:2011`) or revoked (`:2012`) all mean **no authorisation**, never "probably fine".
- **Revocation reuses existing machinery** — `CapabilityRevocation` on the existing path, *"no
  new DS-tag, no new signature scheme, no new revocation channel"*
  (`kotva/18-wire-format.md:1989-1992`).
- **It authorises the RAIL, never the GATE.** This is the whole point and it is the same
  sentence §7 already had to write for mail:

  > *"A valid mesh `sender_sig` proves *who signed*, **not** *who may relay* — anyone can sign a
  > MOTE — so signature-validity is necessary but **not sufficient** to authorise egress."*
  > — `kotva/07-gateway.md:876-878`

  Read for this seam: a valid `gw-rail:whatsapp:+27821234567` grant proves that estate hub H may
  speak as that number. It proves nothing whatsoever about whether resident R may open gate G.
  The two facts live in different systems and must never be collapsed. §3.4 is where that
  becomes a rule.

**(2) A signed published tariff, (3) signed usage receipts.** Telegram, Slack and Discord are
free at the platform layer, and WhatsApp inbound / in-window reply is free
(`kotva/26-legacy-adapters.md:185-189`, `:387-393`). The only genuinely metered path a chat
adapter could hit is **WhatsApp outbound outside the service window** — which Aql does not use
today (every outbound is a reply to a verified inbound) but which the roadmapped intercom
feature would need (`docs/KOTVA-ALIGNMENT.md:301`). Until then: publish a `Tariff` with a
free-shape schedule or omit the field (`tariff` is *"Present **iff** this coordinator charges"*,
`kotva/18-wire-format.md:1916`), and declare `Metering::NotMetered`. If it ever meters, the
receipt is a `UsageReceipt` on a `system` MOTE, `kind = 0x0A`, `Headers.mime =
application/vnd.dmtap.usage-receipt+cbor`, delivered directly to the payer and never published
(`kotva/18-wire-format.md:1953-1960`).

**(4) The content-visibility disclosure** — §1.2 above, plus §26.7's map, next.

### 2.4 §26.7's reply-routing map is small under this design — and still must be disclosed

Gateway mode requires the operator to hold *"a mapping from **(rail, remote party, which
number/bot/account)** to a DMTAP identity"*, which the operator *"can corrupt"* and *"can
leak"*, and which MUST be disclosed (`kotva/26-legacy-adapters.md:296-325`, ADAPT-7 at `:527`).

Because §3 keeps member resolution in the hub, Ephor's map is at the granularity of **which hub
receives this rail's traffic**, not **which resident this remote party is**. That is a real
privacy win — the aggregate "which of our users talks to which outside parties"
(`kotva/26-legacy-adapters.md:315-318`) stays in each hub's own SQLite (`channel_identities` /
`channel_chats`, `hub/internal/store/channels.go`,
`hub/internal/store/migrations/0005_channels.sql`), where it already is today
(`docs/KOTVA-ALIGNMENT.md:332-336`).

It is **not** a privacy elimination: Ephor still sees every message body, every remote id, and
the full traffic pattern of every estate it serves. Disclose that, not the smaller fact.

---

## 3. The wire between Ephor and Aql's hub

This is the crux, so it is specified as a contract rather than sketched.

### 3.1 Direction of dial: the hub dials Ephor

**PROPOSAL, and it is load-bearing.** Aql's hub must keep working with **no inbound
reachability at all**: *"**Zero-infrastructure mode** — real today … A hub on a LAN Pi with no
public URL already does chat + LAN console + controllers end to end. Only the WhatsApp and
Telegram webhooks and remote app access need a public URL. **Which component holds that
outbound socket is exactly what §3a's move to Ephor is about**"* (`ARCHITECTURE.md:270-275`),
and the hub refuses to bind a non-loopback address without `-behind-proxy`
(`ARCHITECTURE.md:257-262`). A hosted Ephor has a public URL by construction.

So the hub holds an **outbound-persistent** connection to Ephor and receives intents over it —
the shape Aql's seam already has a name and a precedent for:

> *"`DialChannel` is the per-provider seam for a SUBSCRIBE-shaped provider: one that has no
> webhook to receive because the gateway dials OUT to it … so a LAN-only gateway with no public
> URL can still run the channel fully."* — `hub/internal/channels/channels.go:77-96`

`SocketMode` (`hub/internal/channels/socketmode.go:52-107`) is the working precedent;
`DMTAP` (`hub/internal/channels/dmtap.go:143-235`) is the second, generalised one. **The
Ephor channel is the third instance of a seam that already exists.** That is the strongest
engineering argument for this whole direction and it should be stated as such: the split does
not merely relocate the rails, it makes WhatsApp and Telegram reachable from a hub behind CGNAT,
which they are not today.

### 3.2 The two objects

**PROPOSAL.** Both are JCS (RFC 8785) + Ed25519, matching the discipline Aql already uses for
every signed object (`proto/README.md:27-31`, canonicalisation at
`hub/internal/keys/jcs.go`, envelope precedent at `hub/internal/keys/envelope.go:18-30`,
`:49-94`). Deliberately **not** a MOTE: KOTVA-ALIGNMENT's §1.2 verdict — *"expressible with no
spec change … A poor *first* substitution to make"* (`docs/KOTVA-ALIGNMENT.md:183-185`) — applies
with more force here, since this leg is a private link between two processes an operator runs.

**`chat.intent` — Ephor → hub.** One inbound rail message, already authenticated *by the rail's
own means*.

```json
{
  "v": 0,
  "typ": "chat.intent",
  "adapter_id": "eph_9f3…",
  "rail": "whatsapp",
  "remote_id": "+27821234567",
  "chat_key": "+27821234567",
  "text": "open the front gate",
  "selection_id": null,
  "platform_message_id": "wamid.HBg…",
  "platform_asserted": { "rail": "whatsapp", "claim": "+27821234567", "verifiable": false },
  "nonce": "…",
  "iat": 1789000000,
  "exp": 1789000060,
  "sig": "…"
}
```

Field notes, each with a reason:

- **`platform_asserted` is REQUIRED, and its shape is fixed by spec.** `{ rail, claim,
  verifiable }` with `verifiable = false`, *"the **same** key and shape for **every** rail
  (Telegram, Slack, Discord, WhatsApp, …), so a client reads a bridged origin uniformly"*
  (`kotva/26-legacy-adapters.md:258-270`). Kotva already has the constant
  (`kotva/crates/kotva-mail/src/adapters/mod.rs:35`) and the builder (`:49-56`). Carrying it
  makes ADAPT-5's client-side obligation *possible* in Aql for the first time — today the
  gateway has no marker at all that an origin is platform-asserted
  (`docs/KOTVA-ALIGNMENT.md:303`).
- **`remote_id` is a platform handle, never an identity key.** The spec is explicit that the
  origin *"is **never** placed in `Payload.from` (a cryptographic identity key, which a phone
  number or platform handle is not)"* (`kotva/26-legacy-adapters.md:266-269`); kotva's Slack
  adapter enforces it by leaving `from` and `sig` empty
  (`kotva/crates/kotva-mail/src/adapters/slack.rs:68-80`).
- **`text` is rail-de-framed but not intent-resolved.** Ephor strips rail packaging (Slack's
  `<@U…>` mention wrapper — `hub/internal/channels/channels.go:257-270`) and nothing else.
  It does not resolve the verb, does not match a gate name, does not decide anything. §4 argues
  why.
- **`selection_id` is an opaque echo.** When the resident taps a picker row, the rail returns
  the id verbatim; Ephor forwards it without parsing. The allowlist that validates it stays in
  the hub (`hub/internal/channels/whatsapp.go:459-501`).
- **What the intent MUST NOT contain:** a member id, a user id, an account id, an access-point
  id resolved from text, a verb, a tier, an authorisation verdict, or any claim that the sender
  is entitled to anything. If a field like that ever appears, the trust boundary has moved and
  §3.4 no longer holds.

**`chat.reply` — hub → Ephor.** A rail-agnostic reply model. The hub authors **all** text.

```json
{
  "v": 0, "typ": "chat.reply",
  "rail": "whatsapp", "chat_key": "+27821234567",
  "in_reply_to": "<intent nonce>",
  "body": "That matches more than one gate, so I haven't opened anything. Which one did you mean?\n\nShowing 10 of 34 — this list is incomplete. See all of them here: https://…/app",
  "choices": [ { "id": "open_ap:ap_123", "title": "Open Front Gate", "subtitle": "Home" } ],
  "nonce": "…", "iat": …, "exp": …, "sig": "…"
}
```

`body` is final prose the hub composed (including the truncation notice —
`hub/internal/channels/reply.go:40-49`). `choices` is a structure Ephor maps onto a WhatsApp
interactive list, Slack Block Kit sections, or a Telegram inline keyboard. Ephor renders; it
never writes copy. §4 argues why that line and not another.

### 3.3 Authentication, replay, and failure semantics

**Authentication — mutual, key-pinned, enrolled out of band.**

**PROPOSAL.** The adapter holds an Ed25519 keypair and is **enrolled** with the hub the way a
controller is: a hashed, expiring, single-use claim token (the existing pattern —
`hub/internal/store/devices.go:29-45`, rules at `proto/pairing.md`), producing a
`chat_adapters` row holding `{adapter_id, public_key, rails[], status, paired_at}`. The hub
serves its own public key at `GET /v1/gateway/key`
(`hub/internal/httpapi/server.go:156`), which the adapter pins.

- **Hub → adapter (connection):** the hub proves itself with the existing challenge/response
  shape — `ws.challenge` / `ws.auth`, single-use cnonce, 30 s TTL, ±90 s skew, replay-checked
  (`hub/internal/hub/hub.go:23-24`, `:113-149`). Roles are inverted (the adapter issues the
  challenge) but the state machine is byte-identical in structure, so the verifier already has
  a production twin and a vector suite (`hub/internal/hub/hub.go:1-7`).
- **Adapter → hub (every intent):** `sig` over `JCS(intent ∖ sig)` under the enrolled adapter
  key. **A signature is checked against the adapter enrolled for `rail`.** An intent asserting
  `rail: "slack"` signed by an adapter whose `rails[]` does not include `slack` is refused and
  logged. Fail-closed: an unknown `adapter_id`, an unenrolled rail, or a missing `sig` is a
  refusal, never a downgrade — the same rule the channel seam already states for credentials:
  *"an unset credential means "this channel does not run", never "this channel runs
  unauthenticated""* (`hub/internal/channels/channels.go:87-90`).

**Replay — two mechanisms, because they defend different things.**

1. **Envelope replay:** 128-bit `nonce`, `exp − iat ≤ 60 s`, ±90 s skew on both bounds, and a
   single-use seen-nonce store that **fails closed when nil**
   (`hub/internal/keys/envelope.go:32-46`, `:132-143`, `:192-205`). This bounds how long a
   captured intent stays actuatable.
2. **Rail redelivery:** dedupe on `platform_message_id` through the existing unique index —
   exactly what WhatsApp already does (`hub/internal/httpapi/channels_whatsapp.go:90-97`)
   and what the DMTAP scaffold specifies (`hub/internal/httpapi/channels_dmtap.go:39-50`).
   This makes a platform's own retry a no-op.

Both are needed and neither substitutes for the other — the same distinction KOTVA-ALIGNMENT
draws between content-address dedupe and a validity window
(`docs/KOTVA-ALIGNMENT.md:163-168`).

**Failure semantics — never fabricate, never buffer an actuation.**

| Failure | Behaviour |
|---|---|
| Adapter unreachable from the hub | Chat is **unavailable**, and says so. In `OFFLINE.md` grade terms this is `blocked` — the grade Aql's own mapping already assigns to a chat-initiated open (`docs/KOTVA-ALIGNMENT.md:562`). The web portal and the LAN/controller paths are unaffected (`ARCHITECTURE.md:244-247`). |
| Hub unreachable from the adapter | The adapter **MUST NOT queue intents for later delivery.** They expire with the envelope (≤ 60 s) and the adapter sends the resident an honest reply. A queued "open" delivered twenty minutes later is a gate that opens for no one who is standing there. This is the one place the design deliberately diverges from `hub.Dispatch`'s offline queue (`hub/internal/hub/hub.go:298-304`) — that queue carries commands to a controller the hub has already authorised, which is a different fact. |
| Reply undeliverable | The hub records a `failed:<reason>` outbound row rather than dropping it, so an operator can see the channel tried and could not speak — the existing precedent (`hub/internal/httpapi/channels_dmtap.go:159-165`). |
| Ack/dispatch outcome | Unchanged. `undelivered` remains *"a **dispatch outcome, not a negative result**"* and the reply stays non-committal (`proto/commands.md`, quoted at `docs/KOTVA-ALIGNMENT.md:262-266`). The seam adds no new certainty and must not imply any. |

### 3.4 The trust boundary — and containment of a compromised or substituted Ephor

**The rule, stated once.**

> **An Ephor-asserted identity is evidence of what a platform's backend said, relayed by a
> component the operator can swap. The hub MUST resolve identity and authorise the action
> itself, from its own state, on every single intent. An intent is a question. It is never a
> permission.**

This is `kotva/07-gateway.md:876-878` applied one layer out: a valid `chat.intent` signature
proves *which adapter relayed this*, not *who may open this gate*. And §26.5 forecloses ever
strengthening it: *"Every other rail is platform-asserted and cryptographically unverifiable …
there is no signature the adapter itself can verify independently of trusting the platform's own
backend"* (`kotva/26-legacy-adapters.md:227-234`), a *"structural ceiling, not an implementation
gap"* that *"MUST NOT be described as a limitation a future adapter version will lift"*
(`:490-494`).

**How the hub authorises, unchanged from today.** On every intent, the hub:

1. resolves `(rail, remote_id)` → member or grant holder from its own store —
   `ResolveChannelIdentity` (`hub/internal/store/channels.go:235`),
   `AvailableAccessPointsByPhone` (`:48`) / `AvailableAccessPointsByProfile` (`:124`),
   `MemberUserIDByPhoneForAP` (`:207`);
2. resolves the verb and the target from `text` against **that member's authorised set**
   (`hub/internal/channels/verb.go:160-168`,
   `hub/internal/channels/whatsapp.go:402-434`), failing closed on ambiguity
   (`MatchAmbiguous`, `whatsapp.go:340-344`);
3. runs the single choke point — `store.LogAccess`, which independently refuses any verb outside
   `open`/`close` (`hub/internal/store/openpath.go:242-245`), applies the whole limit ladder
   (`:57-190`), consumes/refunds visitor grant uses, and **writes an audit row whether it allows
   or denies** (`:251-261`, `:298-306`);
4. signs the controller envelope with the hub's own key and dispatches
   (`hub/internal/httpapi/open.go:101-132`; the controller pins that key and rejects
   anything else — `proto/pairing.md:34-36` per `docs/KOTVA-ALIGNMENT.md:94-96`).

Steps 1–4 are exactly what happens today (`hub/internal/httpapi/channels_open.go:50-142`).
**Nothing about them changes.** That is the design.

**What a compromised or substituted Ephor gains.** Stated in full, because a containment claim
that lists only the good news is not a containment claim:

- It can **forge an inbound origin** on any rail it is enrolled for — assert that
  `+27821234567` said "open" when they did not. This is **not new**: whoever holds
  `WHATSAPP_APP_SECRET` today can forge a webhook that passes `verifyWhatsAppSig`
  (`hub/internal/channels/channels.go:192-207`). The seam moves that secret into another
  process; it does not create the capability.
- It can **read every message body** in both directions. Also not new — the platform already
  does (`kotva/26-legacy-adapters.md:496-501`), and so does the hub. But it is now a *second*
  operator-run process holding plaintext, which is a genuine addition. §6 counts it.
- It can **suppress or alter replies**, including turning a denial into silence. The hub's
  outbound log records what it *asked* to be sent, so the divergence is detectable after the
  fact, not prevented.
- It can **map traffic** across every estate it serves (§2.4).

**What it does not gain, structurally:**

- It cannot open a gate for a `remote_id` with **no membership and no active grant** — step 1
  runs against hub state it does not hold (`hub/internal/store/channels.go:48-119`).
- It cannot **exceed limits or quotas** — cooldown, opens/hr, account opens/hr, member/day,
  location/day all live behind the choke point (`hub/internal/store/openpath.go:57-190`).
- It cannot **actuate anything but `open`/`close`** — `openpath.go:243-245` is a structural
  allowlist, and CHAT-COMMANDS.md names that exact line as the security boundary that must
  never widen to "any non-empty string" (`docs/CHAT-COMMANDS.md:781-794`).
- It cannot **mint a controller command** — it has no access to the hub signing key, and the
  controller rejects anything not signed by the key it pinned at pairing.
- It cannot **escape the audit log** — every attempt, allowed or denied, writes a hash-chained
  row (`hub/internal/store/audithash.go`).
- It cannot **assert a rail it is not enrolled for** (§3.3).

**Additional containment this design should add. PROPOSAL, all four:**

1. **Per-adapter rail allowlist**, checked on every intent, fail-closed (above).
2. **Attribution in the audit row.** Add the asserting `adapter_id` alongside the existing
   `source` column so a forged open is attributable to a component, not just a rail. The
   comment at `hub/internal/httpapi/channels_open.go:44-49` explains why `source` must be
   the real channel — the same argument extends to which adapter asserted it. This needs a new
   migration (head is `0007_audit_hash_chain.sql`).
3. **A per-adapter ceiling** independent of the per-subject limiters, so a compromised adapter
   cannot spread a burst across many residents and stay under every individual cap.
4. **Node-mode co-location as the default posture.** For the homeowner shape, Ephor runs on the
   same box as the hub and the link never leaves loopback. The trust boundary is unchanged in
   principle; the attack surface is much smaller in practice.

**The residual, not softened.** After all of this, a physical gate still opens on the strength
of a platform assertion relayed by a swappable component. That was true before this design —
it is Aql's largest disclosed exposure (`ARCHITECTURE.md:180-182`,
`docs/CHAT-COMMANDS.md:640-658`) — and moving the rails into Ephor does not reduce it by one bit.
`ARCHITECTURE.md:191-194` already says exactly this about exactly this move.
What the seam buys is that the exposure becomes **declarable** (§1.2), the assertion becomes
**labelled** (`platform_asserted`, §3.2), and the component becomes **swappable and
attributable** (CONTRACT §2.2's whole point). Those are real. "More private" is not among them.

---

## 4. What each side owns

My prior going in was that authorisation and actuation must stay in the hub and only rail
termination and message rendering move. **The code and the contract both support it, and one
point goes further than I expected: user-visible *copy* must also stay in the hub.** The
argument, then the table.

**Why the line is where it is.**

1. **The hub's own package contract already says it.** *"A channel decides how to ask and how to
   reply; it NEVER decides whether the gate may open"* — and the same rule is restated for
   dial-out channels so a subscribe-shaped provider cannot claim an exception
   (`hub/internal/channels/channels.go:6-11`, `:88-96`). Ephor is a dial-out channel behind
   the same seam. The invariant is inherited, not renegotiated.
2. **CONTRACT §4 forbids the adapter reading content to decide what reaches the hub.**
   *"Every gate a coordinator applies **on a delivery path** … MUST be an **authorisation**
   question answered from **sender identity and rate**… a coordinator MUST NOT run content
   classification"* (`kotva/coordinator/CONTRACT.md:167-179`). Intent resolution — verb, target,
   ambiguity — is reading content in order to decide an action. Keeping it in the hub keeps the
   adapter clearly on the right side of §4 and lets it honestly declare `Gate::Authorization`
   (§1.6).
3. **Authorisation needs data the adapter must not have.** The authorised set is a join over
   memberships, visitor grants, locations, account status and grant windows
   (`hub/internal/store/channels.go:48-119`); the limit ladder is keyed on account, location
   and member (`hub/internal/store/openpath.go:57-190`). Replicating any of it into Ephor
   would replicate the tenant graph into the component with the widest blast radius.
4. **Disambiguation needs the candidate list, which is authorisation output.** `FindMentionedGate`
   scans the caller's authorised access points (`hub/internal/channels/whatsapp.go:419-434`).
   You cannot resolve the target before you know what the caller may reach.
5. **Copy is a safety property here, not presentation.** `DenialMessage`'s strings are *"a
   behavioral contract — a denial never pretends the gate opened"*
   (`hub/internal/channels/reply.go:11-14`); `TruncationNotice` exists so *"a resident is
   never shown a list that looks complete and is not"* (`:34-39`,
   `hub/internal/channels/channels.go:335-341`). If the adapter composes prose, a swapped or
   buggy adapter silently drops the honesty. Hub composes; adapter renders structure. **This is
   my one refinement to the stated prior.**

**Feature by feature:**

| Capability | Today | Owner after the seam | Why |
|---|---|---|---|
| Rail credentials (`WHATSAPP_APP_SECRET`, bot tokens, `SLACK_APP_TOKEN`) | hub (`channels.go:112-174`) | **Ephor** | The whole point: the hub stops holding platform secrets |
| Webhook authentication (Meta HMAC, Slack v0 sig + 300 s window, Telegram secret token) | hub (`channels.go:192-246`) | **Ephor** | Belongs with the credential; fail-closed contract carries over verbatim |
| Connection-native auth (Slack Socket Mode app token) | hub (`socketmode.go:74`, `:179-211`) | **Ephor** | Same |
| Public HTTPS endpoint for webhook rails | hub, or a proxy in front | **Ephor** | Removes Aql's only remaining reason to need ingress for WhatsApp/Telegram (`ARCHITECTURE.md:270-275`) |
| Inbound wire parsing (`WAPayload`, `SlackEnvelope`, `TGUpdate`) | hub (`whatsapp.go:47-114`, `slack.go:31-59`, `telegram.go:32-89`) | **Ephor** | Pure platform shape; churns with vendor APIs (ADAPT-10, `26-legacy-adapters.md:363-369`) |
| Rail de-framing (strip `<@U…>` mentions) | hub (`channels.go:257-270`) | **Ephor** | Platform packaging, not meaning |
| Message-id dedupe | hub (`channels_whatsapp.go:90-97`) | **hub** (adapter forwards the id) | Dedupe is an audit-integrity property; the store holds the unique index |
| Flood throttle (`chat_1m`) | hub (`store/ratelimit.go:275+`) | **hub** authoritative; adapter MAY self-protect | A limiter in a swappable component is not a limiter |
| Identity resolution `(rail, remote_id)` → member | hub (`store/channels.go:235`, `:48`, `:124`, `:207`) | **hub — never moves** | §3.4. The single most important row in this table |
| Verb resolution (`TextGateVerb`, fail-closed to close) | hub (`verb.go:160-168`, `:42-52`) | **hub** | CONTRACT §4 (point 2); and the fail-closed-toward-close property is safety-critical |
| Target resolution + ambiguity (`MatchOutcome`, `FindMentionedGate`) | hub (`whatsapp.go:326-434`) | **hub** | Needs the authorised set (point 4) |
| Selection-id allowlist (`ParseSelection`, `SelectionCommandVerb`) | hub (`whatsapp.go:459-501`) | **hub** | Ids are hints, never capabilities (`docs/CHAT-COMMANDS.md:696-709`); the adapter echoes opaquely |
| Rate limits, quotas, cooldowns, grant windows | hub (`openpath.go:57-190`, `store/grants.go`) | **hub — never moves** | Point 3 |
| Account-suspended / user-disabled gates | hub (`openpath.go`) | **hub** | Same |
| The choke point `store.LogAccess` + verb allowlist | hub (`openpath.go:242-245`) | **hub — never moves** | Named as *the* security boundary (`docs/CHAT-COMMANDS.md:781-794`) |
| Audit row + hash chain | hub (`openpath.go:251-261`, `:298-306`, `audithash.go`) | **hub — never moves** | A log the rail terminator could edit is not evidence |
| Signed controller envelope + dispatch | hub (`keys/envelope.go:73-94`, `hub/hub.go:291-340`) | **hub — never moves** | Controller pins the hub key |
| Reply **text** (denials, truncation notices, honest copy) | hub (`reply.go:11-49`) | **hub** | Point 5 |
| Reply **structure** (interactive list / Block Kit / inline keyboard) | hub (`whatsapp.go:197-305`, `slack.go:96-134`, `telegram.go:91-105`) | **Ephor** | Rail widget shapes; the adapter is the thing that knows them |
| Per-rail picker capacity (`PickerCapacity = 10`, `SlackMaxBlocks = 50`) | hub constants (`channels.go:329-347`) | **declared by Ephor, enforced by the hub** | The adapter knows its rail's ceiling; the hub must be the one that truncates, because the truncation notice is hub-authored copy |
| Outbound HTTP to the platform | hub (`send.go:94-166`, `:393-434`, `:476-525`) | **Ephor** | Follows the credential |
| Chat transcript (`channel_chats`, inbound/outbound rows) | hub (`store/channels.go:295-370`) | **hub** | Operator-visible record; also the dedupe index |
| §26.7 reply-routing map | n/a | **Ephor**, at hub granularity only (§2.4) | Minimised by construction |
| §26.3 four-field declaration + descriptor | nowhere | **Ephor** | It is the coordinator; it is what publishes descriptors |
| ADAPT-5/ADAPT-6 rendering (platform-asserted marker, node-vs-gateway portability) | nowhere | **hub** | The resident's account is with the hub; the adapter supplies the facts, the hub shows them |

**One conclusion I did not expect and will state plainly:** under this split, `verb.go`,
`reply.go`, the `MatchOutcome` machinery, `ParseSelection` and the DMTAP scaffold **all stay in
Aql's Go tree**. What moves is roughly `whatsapp.go` + `slack.go` + `telegram.go` +
`socketmode.go` + `send.go` and the `Verify*` primitives. That is a smaller move than "the chat
layer moves to Ephor" sounds like, and it is the right size: the parts with recent
safety-critical work stay where their tests are.

---

## 5. Migration sequencing

The constraint is absolute: **the product must never sit in a state where chat is simply gone.**
Every step below leaves a working system.

**Step 0 — Aql declares the four §26 fields, with no Ephor involved. — DONE (2026-07-27).**
`hub/internal/channels/disclosure.go` declares all four for WhatsApp, Telegram, Slack and
Discord, per-direction where asymmetric; `GET /v1/rails/disclosure` serves them
unauthenticated. In Go rather than markdown on purpose — a disclosure table is exactly the
prose that goes stale, and tests now fail if a rail is added without one, if an exposure
claims privacy the rail does not have, or if a rail declares it can cold-initiate.
Documentation and product UI only, per §26.3's node-mode allowance
(`kotva/26-legacy-adapters.md:105-108`). This is KOTVA-ALIGNMENT work-list item 1
(`docs/KOTVA-ALIGNMENT.md:601-605`), it discharges ADAPT-2/ADAPT-11 and most of ADAPT-6, and it
is worth doing **whether or not** the Ephor split ever happens. Working system: unchanged.

**Step 1 — kotva retag.** `crates/kotva-mail/src/adapters/` exists only on HEAD (§0.3). Cut a
tag (or bump the pin under review) so Ephor can depend on the §26 framework and the four rail
modules. No user-visible change. Working system: unchanged.

**Step 2 — Ephor `chat-adapter` crate, contract-only.** Descriptor, visibility declaration, the
four-clause posture, `broker-conformance` wiring, per-rail policy blobs from
`kotva-mail::adapters`. No network, no credentials, no Aql integration. Green `cargo test`.
Ship the §1.4/§1.6 findings to `ephor/COORDINATION.md` at this point, not later. Working system:
unchanged.

**Step 3 — Aql grows the seam, off by default.** Add `chat.intent`/`chat.reply`, the
`chat_adapters` enrollment, and an `EphorChannel` implementing the existing `DialChannel`
interface (`hub/internal/channels/channels.go:97-108`) — plus the **one rail-agnostic hub
handler** the whole design turns on. That handler already exists in miniature:
`hub/internal/httpapi/channels_dmtap.go:26-123` is a rail-agnostic conversation flow that
resolves an identity from an external id, dedupes, throttles, resolves verb and target, and
funnels through `profileOpen`. It is the template. Wired behind config, defaulting **off**.
Working system: all three Go rails still default and untouched.

**Step 4 — Ephor implements Telegram, end to end.** Telegram first for four reasons, all
verifiable: `outbound-persistent` so no public endpoint is needed
(`kotva/26-legacy-adapters.md:125-127`), free (`:187`), the smallest Go surface being replaced
(`telegram.go` is 112 lines), and §26.4.2's "cannot initiate at all" ceiling
(`:212-220`) makes its honest declaration trivially true. Run it beside the Go Telegram channel
in a staging install and diff behaviour against
`hub/internal/httpapi/channels_telegram_test.go`. Working system: production still on Go.

**Step 5 — per-rail engine toggle, defaulting to built-in.** The pattern already exists and is
proven: `ResolveWhatsAppEngine` fails closed toward the safe default and refuses to switch on
anything but the exact opt-in string (`hub/internal/channels/send.go:217-228`), with an
operator-facing warning constant for the risky choice (`:238-246`). Reuse it verbatim:
`AQL_TELEGRAM_ENGINE=ephor|builtin`, then the same for Slack and WhatsApp. Working system:
every install picks, and the default keeps working.

**Step 6 — Slack, then WhatsApp.** Slack second: Socket Mode is already dial-out on both sides,
so the shape is familiar and `socketmode.go`'s reconnect/backoff behaviour has a direct Rust
counterpart. WhatsApp last, because it is where Ephor actually earns its keep — the adapter
takes the app secret, the webhook endpoint and the reachability requirement off the hub — and
because it is the rail with the §26.8.2 conflict to resolve first (§6.3). Working system: mixed,
per-rail, per-install.

**Step 7 — flip the defaults, one rail at a time, one release apart.** Working system: yes, with
a one-env-var rollback.

### The point of no return

`hub/internal/channels/{whatsapp,slack,telegram,socketmode}.go`, the `Verify*` primitives,
`send.go`'s three senders, and `hub/internal/httpapi/channels_{whatsapp,slack,telegram}.go`
may be **deleted only when all six hold**:

1. Every shipped rail has an Ephor implementation that has been the **default** for at least one
   full release cycle, in production, with no fallback use observed.
2. The per-rail engine toggle has had **no `builtin` selections** for a release.
3. Those files have **no non-test callers** (verify by build, not by reading — the lesson
   recorded in the housekeeping notes is that dead-code claims must be build-verified).
4. The `e2e/` and `e2e-browser/` suites exercise the Ephor path, not the Go path.
5. **The `BridgeWhatsAppSender` question is settled** (§6.3). It cannot ride into Ephor: kotva's
   own framework classifies an unofficial bridge as `Sanctioning::Unsanctioned` and
   `permits_mode` returns false for gateway mode
   (`kotva/crates/kotva-mail/src/adapters/mod.rs:137-146`, `:176-182`), while §26.8.2's MUST NOT
   is unconditional (`kotva/26-legacy-adapters.md:344-359`). Deleting the Go WhatsApp channel
   deletes the bridge with it. That may be the right outcome — it is not a decision to make by
   accident during a refactor.
6. **A homeowner can run Ephor in node mode with one command, co-located with the hub.** If they
   cannot, deleting the Go channels makes Aql's primary access path depend on a hosted third
   party — which breaks CONTRACT §2.3's self-host backstop at the *product* level even while the
   coordinator crate honestly declares `SelfHost::Backstop`
   (`kotva/coordinator/CONTRACT.md:61-68`). **This is the real gate, and it is the one most
   likely to be skipped.**

Two things that are **not** deleted at that point: `hub/internal/channels/dmtap.go` and its
handler (a separate seam, and ADAPT-10 says move it out rather than fold it in —
`docs/KOTVA-ALIGNMENT.md:637-642`), and `verb.go` / `reply.go` / the `MatchOutcome` machinery,
which §4 keeps hub-side permanently.

---

## 6. What this costs

Honest accounting. Nothing here is softened, and the offsets are stated where they are real.

### 6.1 A Rust reimplementation of three working, tested Go adapters

Non-test Go in scope (`wc -l`, verified):

| | lines |
|---|---|
| `hub/internal/channels/` non-test, total | 2,414 |
| — of which moves: `whatsapp.go` 501 + `slack.go` 134 + `telegram.go` 112 + `socketmode.go` 245 + `send.go` 536 | **1,528** |
| — of which stays (per §4): `verb.go` 168, `reply.go` 62, `dmtap.go` 309, most of `channels.go` 347 | ~886 |
| `hub/internal/httpapi/channels_*.go` non-test | 1,096 |
| **Tests being re-earned:** `channels/*_test.go` 1,416 + `httpapi/channels_*_test.go` 1,217 | **2,633** |

The tests are the expensive part, and they are where the recent safety work lives —
`disambiguation_test.go` (353), `verb_test.go` (334), `socketmode_test.go` (177). A Rust port
does not inherit them.

**The real offset, and its limit.** Kotva's `crates/kotva-mail/src/adapters/` is 2,406 lines of
already-written, already-tested §26 framework and per-rail mapping (§0.3). That is genuinely
free — the four-field table, the initiation/transport/price/exposure types, the sanctioning rule,
`OutboundDisposition`, and the canonical platform-asserted carriage. But it stops exactly where
the work starts: its network boundary is an **unimplemented trait**
(`RailTransport`, `kotva/crates/kotva-mail/src/adapters/mod.rs:222-226`;
`slack.rs`'s `HttpPost` likewise), it maps rail messages to **MOTE `Payload`s**
(`adapters/slack.rs:68-80`) rather than to an Aql intent, and it contains no HMAC verification,
no webhook server, no Socket Mode WebSocket client, and no interactive-widget rendering. Call it
a genuine head start on the *declaration* half and approximately nothing on the *transport* half.

### 6.2 Operators now run two components instead of one

This is the cost that will be felt daily, and it cuts against Aql's own pitch. The hub is
currently *one binary* that *"binds a listener and serves plain HTTP, full stop — no TLS/ACME
code, no tunnel protocol, no relay dependency"* (`ARCHITECTURE.md:257-259`), and the flagship
deployment is *"A hub on a LAN Pi with no public URL"* doing chat, console and controllers end
to end (`ARCHITECTURE.md:272-275`).

After the split, a homeowner runs: a Go hub, a Rust adapter, an enrollment between them, two
upgrade cycles, and a new failure mode (schema skew between `chat.intent` versions) on the path
that opens their gate. For the **hosted** shape this is a clear win — Ephor already exists and
already runs. For the **node-mode homeowner** it is a straight loss unless Ephor ships as a
co-located sidecar with a one-command install, which is why that is migration gate 6.

Note also that Aql's docs position Ephor as *"the same tunnel model as a convenience, never a
requirement"* (`ARCHITECTURE.md:266-269`). This design makes it a requirement for chat unless
gate 6 holds. That is a change in the product's stated relationship to Ephor and should be made
deliberately, in the docs, at the same time.

### 6.3 The §26.8.2 conflict with `BridgeWhatsAppSender`

Aql ships an opt-in engine targeting Evolution API — a Baileys-fronting unofficial WhatsApp Web
client (`hub/internal/channels/send.go:270-291`, engine selection at `:255-268`). The code's
own honesty is exemplary: it names the ban risk in a non-negotiable comment block (`:172-200`),
fails closed toward the Cloud API (`:217-228`), and logs a long warning at startup (`:238-246`).
`ARCHITECTURE.md:184-189` states the non-conformance out loud.

It is still squarely against an unconditional MUST NOT: *"a conformant implementation MUST NOT
offer either as a WhatsApp credential path: **Unofficial WhatsApp libraries**…"*
(`kotva/26-legacy-adapters.md:344-359`, ADAPT-9 at `:529`).

The seam **forces the decision** rather than resolving it, because Ephor is a coordinator and
cannot carry it: kotva's own framework makes `Unsanctioned` rails node-mode-only by construction
(`kotva/crates/kotva-mail/src/adapters/mod.rs:137-146`, `:176-182`). Three outcomes, all real:

- **Drop it.** Loses the escape hatch for operators who cannot complete Meta business
  verification — a real constituency, given *"the WhatsApp number is hard"*
  (`ARCHITECTURE.md:253-255`).
- **Keep it in Aql's Go tree after the cutover.** Then "the rails moved out" is false for the
  rail that matters most, and the Go WhatsApp sender must be maintained indefinitely.
- **Keep it and declare the non-conformance in the descriptor's `credential_model`.** Honest,
  and it makes ADAPT-9's failure machine-readable — but it publishes a signed object that admits
  a MUST NOT violation, which is a different thing from a paragraph in a README.

KOTVA-ALIGNMENT already called this *"a founder call, not an engineering one"*
(`docs/KOTVA-ALIGNMENT.md:610-613`) and separately noted that kotva's own Rust framework reads
*softer* than §26.8.2's prose (`:358-364`) — that inconsistency is still unresolved and still
changes which outcome is correct.

### 6.4 Everything else found

- **A second plaintext-holding component and a second key.** The split relocates the exposure
  and adds one hop; it does not reduce it (§3.4). Any framing of this work as a privacy
  improvement is wrong.
- **Extra latency and a new partition mode** on a path that opens physical gates. Platform →
  Ephor → WSS → hub → controller, inside a 60 s envelope. Fine on the numbers; the new state is
  "chat up, gate unreachable" and its mirror, and both need honest copy.
- **The COORD-2 gateway-mode lock-in becomes Aql's problem too** (§1.4). A hosted Ephor makes
  every resident's channel the operator's, with §26.6's blunt failure mode. Node mode does not
  have this; the product must be able to say which one a user is in.
- **Docs churn that this design creates.** `docs/CHAT-COMMANDS.md` §6 is a migration map written
  against the Go channel file layout (`:745-813`); a large part of §6.3's table loses its
  referent at the point of no return. The document is accurate today and this design is what
  will make it stale — that is a cost of the decision, not a defect in the document.
- **A doc citation that has already drifted, worth re-verifying before anyone cites it.**
  `docs/CHAT-COMMANDS.md:19-23` quotes `isClose := strings.Contains(body, "close")` at
  `channels_whatsapp.go:137-138`. That code is no longer there: `channels_whatsapp.go:141` now
  calls `channels.TextGateVerb(body)` and the `strings.Contains` pair lives at
  `hub/internal/channels/verb.go:160-168`, behind the fail-closed `GateVerb` type. The
  *substance* of §2.2(a)/(b)/(d) has likewise been partly fixed since it was written —
  `MatchOutcome` is now three-state (`whatsapp.go:326-344`), `ParseSelection` now rejects
  unprefixed ids (`:467-485`), and truncation now discloses (`reply.go:34-49`). **Uncertain —
  needs verification** whether other citations in that document drifted the same way; a re-run
  of its `file:line` claims against the current tree would settle it. Nothing in this document
  depends on the drifted lines.
- **What this design does not fix, and cannot.** ADAPT-4 is blocked in kotva itself —
  `AuthResults`' platform-asserted entry is *"Still open"* (`kotva/26-legacy-adapters.md:465-470`),
  so the interim `x-dmtap-mail-platform-asserted` carriage (`:258-270`) is the ceiling. ADAPT-5's
  client half is satisfiable today and remains unbuilt (`docs/KOTVA-ALIGNMENT.md:648-652`). And
  the platform remains a plaintext party on every rail, in every mode, forever
  (`kotva/26-legacy-adapters.md:490-501`).

---

## 7. Open questions

| # | Question | What would settle it |
|---|---|---|
| 1 | Is a served *hub* the right unit for §26.2's identity count (§2.1)? | A founder or spec-session ruling. KOTVA-ALIGNMENT asked the adjacent question and left it open (`docs/KOTVA-ALIGNMENT.md:656-660`). My counting rule is a **PROPOSAL**. |
| 2 | Does CONTRACT §2.2's lock-in prohibition or §26.6's gateway-mode portability disclosure govern for a platform rail (§1.4)? | Spec session, via `ephor/COORDINATION.md`. Until then a gateway-mode chat adapter cannot honestly pass COORD-2. |
| 3 | Should `broker-conformance` gain `LockIn::ModeDependent` and `Gate::AuthorizationDelegated` (§1.4, §1.6)? | Ephor maintainer decision once (2) is answered. Both are **PROPOSAL**. |
| 4 | Is `BridgeWhatsAppSender` dropped, retained in Go, or declared non-conformant (§6.3)? | Founder call. It gates migration step 6. |
| 5 | Does kotva intend `Sanctioning::Unsanctioned` (node-mode-only) and §26.8.2's unconditional MUST NOT to be the same rule? | Kotva spec owner. Unchanged since `docs/KOTVA-ALIGNMENT.md:661-663` raised it; it changes the answer to (4). |
| 6 | Should the descriptor be published at all in node mode? | §26.3.1 makes it a MAY (`kotva/26-legacy-adapters.md:147`), so this is a product choice. **Uncertain — needs verification** whether an Aql homeowner has any use for a discoverable descriptor. |
| 7 | Is `chat.intent` the right granularity, or should Ephor deliver the raw rail message and let the hub own de-framing too? | A prototype. The argument for de-framing in Ephor is that `<@U…>` stripping is platform packaging; the argument against is that it is the last content-touching step outside the hub. |
