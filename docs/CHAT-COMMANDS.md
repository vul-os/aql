# Chat commands — design specification

> [!IMPORTANT]
> **Status: mostly proposal, and no longer entirely.** What *is* built is the
> single-verb chat access path folded in from lintel (`gateway/`, `controller/`,
> `proto/`) — described here as it exists, with `file:line` citations — plus
> two pieces of §1.2 and §3 that have since landed in the device engine:
>
> - The **closed verb set and the tier ladder** (`hub/internal/devices/capability.go`).
>   Tiers are assigned there from the `(capability, verb)` pair — never parsed
>   from a message, never supplied by a driver, never carried on the wire.
> - The **"stopping is never riskier than starting"** rule, enforced by
>   `checkInverses` at package init: a catalogue where a hazardous verb has no
>   inverse, or an inverse that is itself hazardous, panics the first time any
>   binary importing the package starts.
>
> Everything else is still labelled **PROPOSAL**, including the actuation
> `Port` seam in §1.4 (no `actuate` package exists) and every chat-side change.
> This header said "nothing in this document is built" for as long as those two
> pieces had been shipping.
>
> Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) (Aql's device model) and
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (the gateway that ships today)
> first. The wire contracts in [`../proto/`](../proto/) are normative and this
> document does not change them.

## 0. The problem

The chat layer resolves exactly one verb. Free text is still decided by two
substring tests, but they now sit behind a type rather than loose in a handler:

```go
func TextGateVerb(body string) (GateVerb, bool) {
	switch {
	case strings.Contains(body, "close"):
		return VerbClose, true
	case strings.Contains(body, "open"):
		return VerbOpen, true
	}
	return verbUnset, false
}
```
— `TextGateVerb`, `hub/internal/channels/verb.go`

> **Note.** When this document was written the pair lived inline in the WhatsApp
> handler as `isClose`/`isOpen` booleans, and a body naming neither verb fell
> through to `open`. Two later passes (`e10c06a`, `c5c697b`) closed that: the
> verb is now a `GateVerb` whose unexported zero value renders *close*, and
> `ok == false` means the body asked for neither, so the reply is the welcome
> menu rather than an actuation. Parts of §2.2 below describe defects that are
> now fixed in code; they are kept because the reasoning still explains why the
> current shape is what it is.

Slack and Telegram are stricter still — an exact-match switch, everything else
falls through to the help menu (`hub/internal/httpapi/channels_slack.go:139`,
`hub/internal/httpapi/channels_telegram.go:84`). The choke point itself
refuses anything outside the pair:

```go
if args.Command != "open" && args.Command != "close" {
    return nil, fmt.Errorf("bad command %q", args.Command)
}
```
— `hub/internal/store/openpath.go:243-245`

Aql's device model is heterogeneous by design: an ID, a kind, a zone, a state,
and a set of commands/telemetry per device (`docs/ARCHITECTURE.md:96-127`),
demonstrated today by twelve demo devices spanning Camera, Lighting, Robot,
Climate, Energy, Sensor and Access kinds (`src/lib/demoData.ts`).

This spec generalises "a chat message actuates a device" from one verb on one
device class to a verb registry over Aql's device model — **without** loosening
any property the access path currently holds.

### Non-negotiables carried in from the existing system

| Property | Where it lives today |
|---|---|
| One choke point for every actuation path | `store.LogAccess`, `hub/internal/store/openpath.go:242-307` |
| A channel may deliver intent; it never decides authorization | `hub/internal/channels/channels.go:6-11` (package contract), `:88-94` (same rule for dial-out) |
| Every attempt — allowed or denied — writes an audit row | `openpath.go:251-261` (deny), `:298-306` (allow) |
| Signed Ed25519 envelope, nonce + expiry, controller pins the gateway key | `hub/internal/keys/envelope.go:73-94`, `proto/commands.md:49-70` |
| Fail-closed webhook authentication | `hub/internal/channels/channels.go:192-244` |
| Honest replies — a denial never implies the gate opened | `hub/internal/channels/reply.go:15-30` |

### Design constraints for everything below

- Local-first, no cloud broker (`docs/ARCHITECTURE.md:158-168`).
- Fail-closed on ambiguity.
- No new external dependency — everything proposed here is Go stdlib plus what
  the gateway already links.
- **The signed-command path to the controller stays exactly as-is.**
  `keys.SignCommand` → `hub.Dispatch` → controller verification is untouched.
  No new `cmd` value is added to `proto/commands.md`.

---

## 1. The command model

### 1.1 What resolution has to produce

```
inbound text
  → normalize
  → Intent {
        subject:  who is asking      (member id | verified phone | grant holder)
        target:   what              (device | group | automation | query scope)
        verb:     canonical verb    (from the registry, never free-form)
        args:     bound + validated
        tier:     derived from (capability, verb) — never from the text
        source:   channels.Kind…    (the audit source; see §6.4)
    }
  → authorize
  → actuate | refuse
```

The tier is derived, never parsed. A message cannot assert its own risk level.

### 1.2 Capabilities, not device types

Aql already models a device as *"an ID, a kind, a zone, a state, and a set of
commands/telemetry"* (`docs/ARCHITECTURE.md:100-101`), and the console's shape
is `{id, name, kind, zone, state, read, detail, seen}` (`src/lib/demoData.ts`).

**PROPOSAL.** Add one field to that internal shape — `capabilities: []CapabilityID`
— and keep everything else. A capability is a named, versioned bundle of verbs
with typed arguments and a fixed safety tier. Verbs attach to capabilities, not
to device kinds, so a lock inside a Robot and a lock on a door share one verb.

```
Capability {
  id:    "access.barrier"
  verbs: [
    { name: "open",  args: [],                       tier: T3 },
    { name: "hold",  args: [{seconds: duration?}],   tier: T3 },
    { name: "close", args: [],                       tier: T3 },
  ]
}

Capability {
  id:    "light.dimmable"
  verbs: [
    { name: "on",  args: [],                          tier: T1 },
    { name: "off", args: [],                          tier: T1 },
    { name: "set", args: [{level: percent 0..100}],   tier: T1 },
  ]
}

Capability {
  id:    "mower.job"
  verbs: [
    { name: "start", args: [{zone: zone-ref?}], tier: T4 },
    { name: "stop",  args: [],                  tier: T1 },   // stopping is always safe
    { name: "dock",  args: [],                  tier: T2 },
  ]
}
```

Two rules make this tractable:

1. **The verb set is closed.** Drivers map onto canonical verbs; they do not
   invent them. A driver that needs a verb the registry lacks gets the registry
   extended in a reviewed change, with a tier assigned at that moment. This is
   the property that makes §3 enforceable — an open-ended verb space cannot be
   tiered.
2. **Stopping is never riskier than starting.** For every hazardous verb the
   registry must define its inverse at T1 or below. `stop` on a mower must be
   reachable when `start` is not.

Canonical verb set (**PROPOSAL**, initial):

| Group | Verbs | Typical capabilities |
|---|---|---|
| Read | `read`, `status`, `list` | every capability |
| Binary | `on`, `off`, `toggle` | `light.*`, `switch.*` |
| Continuous | `set` | `light.dimmable`, `climate.setpoint` |
| Job | `start`, `stop`, `pause`, `resume`, `dock` | `mower.job`, `cleanbot.job`, `patrol.route` |
| Barrier | `open`, `close`, `hold` | `access.barrier` |
| Lock | `lock`, `unlock` | `access.lock` |
| Posture | `arm`, `disarm`, `lockdown`, `lift` | `security.posture` |
| Automation | `run`, `enable`, `disable` | `automation` |

### 1.3 `open` as one instance of the model

Today's behaviour, unchanged, expressed in the new model:

| Model element | Today's concrete implementation |
|---|---|
| Target | `store.AvailableAP` — an access point plus its location (`hub/internal/store/channels.go:27-36`) |
| Capability | `access.barrier` — an access point of kind gate/door/barrier/other (`hub/internal/httpapi/access.go:15`) |
| Verb | `"open"` / `"close"`, the only two the choke point accepts (`openpath.go:243-245`) |
| Args | none |
| Tier | T3 (§3) |
| Authorization | active visitor grant, else verified-member-by-phone (`hub/internal/httpapi/channels_open.go:50-94`), or profile membership on Slack/Telegram (`:114-128`) |
| Limits | cooldown + opens/hr + account opens/hr + member/day + location/day (`openpath.go:57-190`) |
| Actuation | `keys.SignCommand` → `hub.Dispatch` (`hub/internal/httpapi/open.go:101-132`) |
| Audit | `access_logs` row, always (`openpath.go:251-261`, `:298-306`) |

Nothing in that row changes. `open` becomes the T3 entry in a table rather than
a hardcoded branch — that is the whole migration for the access path.

### 1.4 The actuation seam — and the honest gap

**PROPOSAL.** One interface between the resolved intent and the physical world:

```go
// package actuate
type Port interface {
    Supports(cap CapabilityID, verb string) bool
    Do(ctx context.Context, in Request) Outcome   // acked | queued | undelivered | no_device
}
```

Exactly one implementation exists on day one — `AccessPort`, which is the
current `dispatchCommand` body verbatim (`hub/internal/httpapi/open.go:101-132`):
sign a `proto/commands.md` envelope, dispatch over the hub, record the outcome.

**Every other capability returns `not_implemented`, and the chat reply says so.**
This is not a placeholder to be quietly filled in with a stub that returns
success. A spec that lets "turn off the garden lights" return "OK" against a
demo dataset would be a lie told by a system that opens doors.

> [!NOTE]
> **The premise of this paragraph has changed, and the design should change
> with it.** When it was written, Aql's device engine did not exist — the
> driver-adapter seam, the automation runtime and robot control were all
> unbuilt phases, so a gate was genuinely the only thing a chat message could
> actuate.
>
> That is no longer true. The engine, its registry and four drivers (MQTT,
> Modbus TCP, generic HTTP, ONVIF) ship, `Registry.Execute` actuates through
> them, and the tier ladder in `hub/internal/devices/capability.go` already
> assigns a safety class to every `(capability, verb)` pair. So a second
> implementation is now honest where it was not: an `EnginePort` routing to the
> registry alongside `AccessPort`.
>
> `not_implemented` remains a first-class outcome — it is simply narrower than
> "everything except gates". Robot control still has no driver, and the rule
> that a stub must never return success is unchanged and is the reason this
> note does not just delete the paragraph.

The `not_implemented` reply is a first-class outcome, alongside the existing
`no_device` (`open.go:96-100`).

### 1.5 What must NOT be reused for non-access devices

`proto/commands.md` is the controller wire contract. Its `access_point` field
is required for `open`/`hold`/`close` and omitted for everything else
(`proto/commands.md:29-30`), and its command table is closed at eight values
(`:38-47`). **Do not** extend that envelope with `cmd: "dim"`. Lights and mowers
are reached through the Rust core's driver seam, which is a different transport
with a different trust model. Deployed gate controllers are forever
(`../ARCHITECTURE.md:246-249`); their contract stays minimal.

---

## 2. Disambiguation

### 2.1 What exists

A two-level narrowing, then a numbered picker:

1. Substring-match a location name, then filter (`channels_whatsapp.go:146-150`;
   matcher at `hub/internal/channels/channels.go:272-275`).
2. Substring-match a gate name within the filtered set
   (`channels_whatsapp.go:151`; matcher at `hub/internal/channels/whatsapp.go:269-276`).
3. Collapse to a single candidate when the filter left exactly one, or when the
   member has exactly one location and one gate (`channels_whatsapp.go:152-156`).
4. Otherwise render a picker — a WhatsApp interactive list, a Telegram inline
   keyboard, or Slack Block Kit sections
   (`channels/whatsapp.go:170-211`, `channels/telegram.go:84-96`,
   `channels/slack.go:88-111`).
5. A tap re-enters the same path with an explicit target id
   (`channels_whatsapp.go:222-255`, `channels_telegram.go:105-134`,
   `channels_slack.go:155-184`).

Step 5 has a property worth naming and keeping: the tap **re-resolves the
caller's authorized set and re-authorizes** (`channels_whatsapp.go:247-253` then
`phoneOpen`; `channels_slack.go:165-170`). The picker row is a hint, never a
capability.

### 2.2 Why it does not scale to a heterogeneous fleet

> [!NOTE]
> **All four failures below have since been fixed.** They are kept because the
> reasoning is why the current behaviour has the shape it does, and because
> §2.3's proposal is still built on top of them — but a reader must not take
> them as a description of today's code. Each is annotated with what replaced
> it. The example in (a) cites `src/lib/demoData.ts`, which no longer exists:
> the console reads live device state.

Four specific failures, all verifiable in the code at the time of writing:

**(a) First match wins, silently.** `FindMentionedGate` returns the first
candidate whose name is a substring of the message
(`channels/whatsapp.go:269-276`). Against lintel's homogeneous gate list that is
usually right. Against Aql's demo fleet it is not: "open the gate" substring-matches
both `Gate Lock` and `Front Gate Camera` (`src/lib/demoData.ts`). First-match
is a fail-**open** on ambiguity, and it is the single most important behaviour to
change.

> **FIXED.** `FindMentionedGate` now collects every hit and returns a
> `GateMatch` carrying an outcome and the full candidate set; the resolved
> access point is populated *only* when the match is unique. An ambiguous
> message actuates nothing and asks — `PushAmbiguousGateMenu` replies "That
> matches more than one gate, so I haven't opened anything", which is the
> fail-**closed** behaviour this item asked for.

**(b) Pickers truncate without saying so.** WhatsApp gate and location menus
break at ten rows (`channels/whatsapp.go:189-191`, `:216-218`), Telegram at ten
(`channels/telegram.go:86-88`). A member with forty devices sees ten and no
indication that thirty are missing.

> **FIXED.** The cap is now the shared `PickerCapacity`, and a truncated menu
> carries `TruncationNotice(shown, total, publicURL)` in the body — the count
> that was dropped and where to see the rest. A list that silently omits a
> resident's gate is indistinguishable from one they do not have access to.

**(c) Slack's picker is unbounded.** `AccessBlocks` appends one section per gate
with no cap at all (`channels/slack.go:99-110`). Block Kit rejects oversized
payloads, so past a certain fleet size the reply simply fails to send and the
member gets nothing.

> **FIXED.** `AccessBlocks` stops at `PickerCapacity`, the same constant the
> other rails use, so a large fleet degrades to a truncated list with a notice
> rather than to silence.

**(d) A selection id with no prefix defaults to `open`.**

```go
func ParseSelection(id string) (cmd, arg string) {
    if i := strings.IndexByte(id, ':'); i >= 0 {
        return id[:i], id[i+1:]
    }
    return "open", id
}
```
— `channels/whatsapp.go:279-284`

Harmless when `open` is the only verb. Under a multi-verb registry, a default
verb is a fail-open, and the default happens to be the T3 one.

> **FIXED.** `ParseSelection` now returns `ok=false` for an id with no prefix,
> for an empty argument, and for any command outside the `selectionCommands`
> table. The verb comes from `SelectionCommandVerb`, never from the id's text,
> and `store/openpath.go` still independently rejects anything outside
> open/close — this is a layer above that boundary, not a replacement for it.

### 2.3 Proposed resolution: narrow, score, then ask

**PROPOSAL.** Replace the flat picker with progressive narrowing. Each stage
runs only if the previous one left more than one candidate.

**Stage 1 — verb-first filtering.** Resolve the verb before the target, then
drop every device whose capabilities do not expose that verb. This is the single
largest reduction available and it is free: "dim" eliminates every gate, camera,
meter and mower in one step. It also fixes (a) structurally — "open the gate"
against `Gate Lock` (capability `access.barrier`) and `Front Gate Camera`
(capability `camera.*`, no `open` verb) has exactly one candidate, not two.

**Stage 2 — scope narrowing.** The existing location filter
(`channels_whatsapp.go:149`) generalises to Aql's `zone` (`src/lib/demoData.ts`)
layered under the gateway's `location` (`store/channels.go:39-42`):
site → zone → device. Match a mentioned scope, filter, re-check.

**Stage 3 — scored matching with a margin, never first-match.** Score each
remaining candidate:

| Signal | Rank |
|---|---|
| Exact name match, case-folded | 100 |
| All message tokens present in the name, in order | 80 |
| Registered alias hit | 70 |
| Name is a substring of the message (today's only signal) | 40 |
| Zone/kind word match only | 20 |

Accept the top candidate **only if** its score is strictly above a floor **and**
exceeds the runner-up by a margin. A tie, a near-tie, or an all-below-floor set
is ambiguous — and ambiguous means ask, never guess. Above T1 a tie must not
even be broken by recency or by "the one you used last time": convenience
heuristics are how the wrong door opens.

**Stage 4 — ask the discriminating question, do not dump a list.** When the
candidate set is larger than the rail's picker capacity, reply with the question
that partitions it — "Which zone: Perimeter, Exterior, or Interior?" — rather
than a truncated list. Per-rail capacities are already known and must become
explicit constants rather than inline `== 10` breaks:

| Rail | Capacity | Today |
|---|---|---|
| WhatsApp interactive list | 10 rows/section | enforced, silently (`channels/whatsapp.go:189-191`) |
| Telegram inline keyboard | 10 rows | enforced, silently (`channels/telegram.go:86-88`) |
| Slack Block Kit | must be capped | **not enforced** (`channels/slack.go:99-110`) |

Whenever a list *is* truncated, it must say so: "showing 10 of 34".

**Stage 5 — groups as explicit targets.** "All lights", "exterior lights", a
saved group. Group expansion is allowed for T0/T1 verbs. **Group expansion is
refused for T2 and above.** There is no "unlock all doors" over chat, and no
"start all mowers". Fan-out multiplies both blast radius and the cost of a
mis-resolution, and the two cases where you would want it are exactly the two
where you would not.

**Stage 6 — bounded selection context.** A picker reply mints a selection
context keyed on `(channel, chat, subject)` so a follow-up ("the second one",
a tap) resolves. It must be:

- **short-lived** — 120 s (proposal), well under the flood-throttle window
  (`store/ratelimit.go:79-84`);
- **single-use** — consumed on first redemption;
- **re-authorized at redemption**, not at issue — preserving the existing
  property from §2.1 step 5;
- **never verb-bearing on its own** — the verb is carried in the context the
  gateway minted, not inferred from the selection id. `ParseSelection`'s
  `return "open", id` default (`channels/whatsapp.go:283`) is removed; an
  unprefixed or unknown selection id is rejected.

**Stage 7 — ambiguity does not widen.** If the answer to a disambiguation
question is itself ambiguous, the exchange ends. No third round, no fallback to
the most likely candidate. The reply names what could not be resolved and points
at the console.

---

## 3. Authorization and safety tiers

This is the section the rest of the document exists to support.

### 3.1 Why tiers

Dimming a light and starting a mower are both "a device command". They are not
the same event. Aql's own threat model already draws the line: *"Some commands
don't just show or hide information — they unlock doors, move machinery, or
arm/disarm security systems. Mistakes there have physical consequences"*
(`docs/THREAT-MODEL.md:21-23`).

A blade-spinning mower starting because a substring matched is an injury, not an
outage.

### 3.2 The tiers

**PROPOSAL.**

| Tier | Definition | Examples |
|---|---|---|
| **T0** | Read-only. No state change. | `read` a sensor, `status` of a device, "how much solar today" |
| **T1** | Reversible comfort. No hazard, trivially undone, no cost. | light `on`/`off`/`set`, thermostat `set` within bounds, **`stop`/`pause` of any job** |
| **T2** | Consequential but non-hazardous. Costs time, water, power, wear. | cleaning bot `start`, irrigation `on`, mower `dock`, automation `run`/`enable`/`disable` |
| **T3** | Physical access. Someone can now get in. | gate/door `open`, `hold`, `close`; lock `unlock`. **This is today's `open`.** |
| **T4** | Hazardous motion or safety-critical posture. Can injure, or removes a protection. | mower `start`, robot move commands, `disarm`, `lift` a lockdown |
| **T5** | Refused over any chat rail, unconditionally. | see §3.6 |

Assignment rules:

- A verb's tier is a property of `(capability, verb)`, fixed in the registry,
  reviewed when added. It is never derived from the message, the sender's role,
  or the device's current state.
- When a device exposes verbs at several tiers, the *verb's* tier governs — a
  mower is not "a T4 device", it has a T4 `start` and a T1 `stop`.
- Unknown capability, unknown verb, or a verb with no tier assigned → **refuse**.
  There is no default tier.

### 3.3 What each tier requires

**PROPOSAL.** "Existing stack" means the limits at `openpath.go:57-190`.

| Tier | Identity | Confirmation | Step-up | Time window | Limits |
|---|---|---|---|---|---|
| T0 | linked identity | — | — | — | chat flood throttle (`store/ratelimit.go:275-288`) + a **separate** `query_1h` counter (§4.4) |
| T1 | linked, active member | — | — | — | + per-`(subject, device, verb)` cooldown |
| T2 | linked, active member | required when not idempotent | — | — | + per-tier daily counter |
| T3 | member **or** active visitor grant | picker tap, as today | operator-settable per location, default off | grant window where applicable | **existing stack, unchanged** |
| T4 | member holding an explicit operator-granted role | **required**, always | **required**, on a different rail | **required**, operator-armed | existing stack + separate T4 counter, and see §3.5 |
| T5 | — | — | — | — | refused |

Notes on the T3 row: it is deliberately identical to shipped behaviour. Today a
successful `open` needs no confirmation beyond tapping the picker row, and no
step-up. That was a reviewed product decision for a system whose entire purpose
is "text 'open' and the gate opens". Generalising the chat layer is not the
moment to silently change it. Operators who want confirmation on T3 get a
per-location toggle, defaulting to today's behaviour.

### 3.4 Confirmation and step-up, defined precisely

**Confirmation (PROPOSAL).** A second inbound message from the same identity, in
the same conversation, carrying a **gateway-minted one-time token** bound to the
hash of the resolved intent, within 60 s, single-use.

It is explicitly **not** "reply yes":

- A bare "yes" is replayable — it authorizes whatever the gateway last asked.
- In a multi-party conversation, "yes" cannot be attributed to the person the
  question was asked of by anything stronger than the platform's sender field.
- An intent-bound token means a confirmation for "start the mower" cannot
  confirm "unlock the front door" if the two exchanges interleave.

The confirming message is authenticated by the same fail-closed channel `Verify`
every inbound message goes through (`channels/channels.go:70-73`, implementations
at `:192-244`). Confirmation adds a second authenticated message; it does not add
a second authentication mechanism.

**Step-up (PROPOSAL).** Approval on a **different rail** than the one that
initiated: the chat message proposes the action; a human approves it in the Aql
console or the app, where a real authenticated session exists.

There is no OTP-over-chat. Sending a six-digit code over WhatsApp to authorize a
WhatsApp command adds a step and no security — the same platform sees both
halves (§5). Cross-rail approval is the only step-up that is honest given the
exposure boundary, and it needs no new dependency: the console already exists.

**This is not a contradiction of the link codes.** Identity linking does send a
code over chat, deliberately, and it is a different claim. A link code binds an
identity ONCE — it answers "which member is this account?" — and it is not
step-up: it authorizes no command, and having linked grants exactly the access
the member already had.

The exposure boundary is unchanged by it, and that is worth saying plainly
rather than letting a ceremony read as an upgrade. A platform that reads every
message can read a link code, and a platform that can inject a message
appearing to come from an account can spend one. Neither ceremony defends
against the platform itself, and neither claims to; what they defend against is
one member claiming another's account, which is the attack that actually
happens. Anyone whose threat model includes Meta should not be opening gates
over WhatsApp at all — which is what the disclosure table exists to tell them
before they choose.

**Time window (PROPOSAL).** T4 verbs are refused unless an operator has *armed*
a window for that `(device, verb)` from the console — "the mower may be started
from chat for the next 30 minutes". Outside the window, chat T4 is refused with
the honest reason and a console link.

The mechanism already exists and does not need inventing: temporary access
grants are `{starts_at, ends_at, max_uses, status}` with an
`EffectiveStatus` of `revoked > exhausted > pending > expired > active`
(`hub/internal/store/grants.go:12-46`), consumed atomically inside their
window by one `UPDATE … RETURNING` (`:194-220`) and refunded when a later check
denies (`:224-230`). Extend the grant target from *access point* to
*(target, verb)* and the whole T4 window falls out of code that already works.

### 3.5 The fail-closed rule

> **If any of — the sender's identity, the target, the verb, an argument, the
> tier, the authorization, or the confirmation state — is unresolved, ambiguous,
> or unverifiable, nothing actuates.** The gateway replies naming what it could
> not resolve, and stops.
>
> There is no most-likely-intent fallback. There is no default verb, no default
> target, and no "it was the only one that matched" shortcut above T1. An
> unparseable message is a question, never a command.

**The one existing exception, stated plainly rather than hidden.** The limiter
fails *open*:

```go
// GuardedCheckOpenLimits is the fail-open wrapper: a counter-store error
// ALLOWS the open, flagged degraded so the audit row records
// error='rate_limit_check_failed'. A gate is physical access — availability
// wins for enforcement, visibility is preserved. (Fail-open reviewed
// upstream 2026-07-17: accepted.)
```
— `hub/internal/store/openpath.go:192-203`, policy restated at
`hub/internal/store/ratelimit.go:22-24`

That is a deliberate, reviewed decision for gates: a member locked out of their
own driveway by a SQLite hiccup is a worse outcome than one un-counted open.

**PROPOSAL: T4 does not inherit it.** A counter-store error on a T4 verb
**denies**. Availability-wins is the right trade for a gate a member is standing
in front of; it is the wrong trade for a machine with blades. T0–T3 keep the
shipped behaviour byte-for-byte. This is the one place where the generalised
path deliberately diverges from the access path, and the divergence is toward
refusal.

### 3.6 T5 — never over a chat rail, at any tier, for any role

These are refused before authorization is even consulted. The refusal is not
role-gated, because the point is that a chat rail is not a control plane for the
control plane.

| Refused | Why | Where it lives today |
|---|---|---|
| `config` — actuation parameters (pulse ms, debounce, `hold_max`) | Changes what "open" physically means | `proto/commands.md:46` |
| `repair` — rotate the gateway signing key | Re-roots the entire trust chain | `proto/commands.md:47` |
| Device pairing / claim-token issuance | Enrolls a new actuator | `POST /v1/devices`, `hub/internal/httpapi/server.go:224`; claim rules `store/devices.go:29-31` |
| Grant issuance and revocation | Authorization changes must not be authorizable through the thing they authorize | `server.go:213`, `:215` |
| Offline-grant issuance | Mints an offline-verifiable capability | `server.go:219` |
| Rate-limit / quota changes | Disables the abuse controls | `PATCH /v1/admin/limits`, `server.go:179` |
| Account/user suspension or enablement | Same as above | `server.go:174`, `:176` |
| Any credential entry (device passwords, tokens, keys) | The keychain is write-only by design | `docs/THREAT-MODEL.md:53-57` |
| Camera media — live view, stills, clips, or links to them | See §5 | — |
| Audit-log reads, member lists, other members' activity | Evidence and roster | `server.go:180-182` |
| Controller firmware update or reboot | Physical-world availability | — |
| Anything that disables or reconfigures the audit path | The audit log is the only durable record | `store/openpath.go:342-348` |

### 3.7 Extending the limits machinery without breaking it

The existing counters are already subject-keyed in a way that generalises. Today:

| Scope | Subject | Cap source |
|---|---|---|
| cooldown sentinel | `user:<id>\|ap:<id>` or `phone:<e164>\|ap:<id>` | `OpenCooldownS` (`openpath.go:83-85`) |
| `opens_1h` | `user:<id>` / `phone:<e164>` (`openpath.go:35-43`) | `OpensPerHour` (`:107-118`) |
| `acct_opens_1h` | `acct:<id>` | `AccountOpensPerHour` (`:120-130`) |
| `opens_1d` | `subject\|loc:<id>` | `MaxOpensPerMemberPerDay` (`:133-150`) |
| `loc_opens_1d` | `loc:<id>` | `MaxOpensPerLocationPerDay` (`:152-166`) |

**PROPOSAL, additive only:**

- **Scope names for access verbs stay byte-identical.** `opens_1h`,
  `acct_opens_1h`, `opens_1d`, `loc_opens_1d` keep counting exactly what they
  count today, so historical counters, the admin override fields
  (`store/ratelimit.go:120-122`) and the usage view (`store/locations.go:288-317`)
  keep meaning what they mean.
- New verbs get new scopes: `verb_1h` on subject `<subject>|verb:<verb>`, and a
  cooldown sentinel on `<subject>|dev:<id>|verb:<verb>`.
- New per-tier daily caps are **new** optional columns on `location_settings`,
  never a redefinition of the two that exist (`store/locations.go:204-231`).
- Three invariants are preserved verbatim for every new counter:
  - **Denials never consume** — counters consumed by an attempt a later limit
    denies are handed back (`openpath.go:87-92`, `:113-117`).
  - **The cooldown claim runs last**, so a denied attempt never restarts anyone's
    cooldown (`openpath.go:168-187`).
  - **A consumed grant use is refunded on a limiter denial**
    (`openpath.go:329-333`, `store/grants.go:224-230`).
- `close` is never limited (`store/ratelimit.go:19`). Generalised: **the T1
  inverse of a job verb is never limited.** `stop` must always get through.

### 3.8 Audit

Every attempt at every tier writes to the **same** `access_logs` table. Do not
add a second log.

The table is hash-chained with append-only triggers, and follow-up facts are
appended as new rows rather than mutating the original — that discipline is
explicit and load-bearing (`store/openpath.go:342-348` for the shared primitive,
`:366-391` for late-ack reconciliation, `:393-417` for dispatch outcomes). A
parallel table for "device commands" would fall outside the chain and outside
`GET /v1/admin/audit/verify` (`server.go:182`).

The `command` column already stores a string, so widening the verb vocabulary is
a data change, not a schema change. `source` must remain the real channel the
request arrived on — the comment at `httpapi/channels_open.go:44-49` explains
why in a system that opens physical gates, and it applies unchanged.

---

## 4. Queries, not just commands

### 4.1 The gateway cannot answer "is the gate closed"

This has to be said before any read-path design, because the obvious query is
the one the system genuinely cannot answer.

`proto/commands.md` has no read command. The eight commands are `open`, `hold`,
`close`, `lockdown`, `lift`, `ping`, `config`, `repair` (`proto/commands.md:38-47`);
`ping` returns liveness and clock, not position. What the gateway knows is:

- the last command it dispatched and whether a `cmd.ack` came back
  (`open.go:114-131`);
- that `undelivered` is a **dispatch outcome, not a negative result** — the gate
  may well have opened (`proto/commands.md:105`, `:108-115`);
- derived counters and a last-operation timestamp from the audit log
  (`store/accesspoints.go:30-35`);
- `last_seen_at` for the controller (`store/devices.go:150-155`).

Real position requires controller I/O — the `held_open` event, which explicitly
*"needs position sensor"* (`proto/events.md:42`), and which the roadmap lists as
protocol-supported but unshipped (`../ARCHITECTURE.md:271`).

**PROPOSAL — the honest reply shape.** Never "The gate is closed." Instead:
*"Last open command acked at 12:04. This gate has no position sensor, so I can't
confirm its current state."* Same discipline as the existing denial copy, which
is a behavioural contract precisely because *"a denial never pretends the gate
opened"* (`channels/reply.go:12-14`).

### 4.2 What a read path may answer

**PROPOSAL.** T0 verbs read from the gateway's own record and, once the device
engine exists, from cached device state — never by inventing a new signed read
command to the controller.

| Query | Source | Answerable today |
|---|---|---|
| "when was the gate last opened" | `access_logs` (`store/accesspoints.go:30-35`) | yes |
| "is the controller online" | `devices.last_seen_at` (`store/devices.go:150-155`) | yes |
| "is the gate closed" | needs a position sensor (`proto/events.md:42`) | **no — say so** |
| "how much solar today" | energy engine (`ROADMAP.md:39-43`) | no |
| "which lights are on" | device state store (`ROADMAP.md:17-27`) | no |

### 4.3 Reads leak more than commands do

A command reply says "Opening Main Gate…". A query reply can hand the platform a
map of the property.

"Which lights are on" is an occupancy question. The energy curve is an appliance
fingerprint and a schedule. A device list is a floor plan with equipment names.
"Is anyone home" never has to be asked directly to be answered — the demo
dataset already contains an `Away arm` automation whose trigger is *"everyone
leaves"* (`src/lib/demoData.ts`), and reporting its state reports occupancy.

### 4.4 Rules for read paths

**PROPOSAL.**

1. **Same authorization as commands.** A query resolves only over the caller's
   authorized set — the exact rule `AvailableAccessPointsByPhone` /
   `AvailableAccessPointsByProfile` already implement
   (`store/channels.go:48-119`, `:124-155`). A device the caller cannot command
   is a device they cannot see.
2. **Aggregate, cap and say so.** Never enumerate a fleet in one message. Cap at
   the rail's picker capacity (§2.3) and state the truncation: "3 of 12 lights
   are on; showing 3." Depth lives in the console — the existing pattern of
   pointing at the portal (`channels/reply.go:22`).
3. **No raw telemetry.** No series, no per-circuit breakdowns
   (`src/lib/demoData.ts`), no coordinates, no camera state, no lock history.
4. **Separate counter.** `query_1h`, its own scope. A query burst must not
   consume the `opens_1h` budget, or a reconnaissance flood becomes a
   denial-of-open against a member standing at their own gate. A query burst is
   itself a signal worth alerting on.
5. **Reads are audited.** Same table, `command` = the read verb. Reads of a
   security system are security-relevant events.
6. **Occupancy proxies are opt-in per location, default off.** Presence,
   away-state, and "which lights are on" are off unless an operator enables them
   for that location.

---

## 5. The exposure boundary

### 5.1 The plain fact

WhatsApp, Slack and Telegram are third-party plaintext rails. On every message,
in both directions, the message body transits the platform's infrastructure —
this is visible in the code as ordinary HTTPS POSTs of the reply body:

- `https://graph.facebook.com/{ver}/{id}/messages` — `channels/send.go:94-100`
- `https://slack.com/api/chat.postMessage` — `channels/send.go:410`
- `https://api.telegram.org/bot{token}/{method}` — `channels/send.go:480`

The self-hosted WhatsApp bridge engine changes the operator, not the property —
and carries its own documented risk (`channels/send.go:172-200`). Telegram bot
messages are not end-to-end encrypted. Slack messages sit under workspace
retention and are readable by workspace admins.

For a project whose non-negotiables are *"local-first"*, *"no cloud
dependency"* and *"the box, not a vendor server, is the root of authority"*
(`docs/ARCHITECTURE.md:158-168`, `docs/THREAT-MODEL.md:19-20`), a chat rail is a
deliberate, bounded exception. The boundary below is what keeps it bounded.

> Aql's own default posture is LAN-only, with remote access opt-in and explicit
> (`docs/THREAT-MODEL.md:38-46`). A chat channel is remote access. It is opt-in
> per install, per channel, and — under this spec — per tier.

### 5.2 What a chat rail MAY carry

Exhaustively:

1. A verb from the registry.
2. An opaque target identifier that is **not bearer-authoritative** (§5.4).
3. A one-time confirmation token bound to one intent hash, short-TTL,
   single-use (§3.4).
4. A short human-readable acknowledgement or refusal.
5. A link to the console for anything deeper.

### 5.3 What MUST NOT be sent over a chat rail — regardless of tier or role

1. **Any secret.** Device passwords, API tokens, claim tokens
   (`store/devices.go:29-31`), grant material, session or refresh tokens, key
   material, or the `sig` of any envelope. Not even to an authenticated admin.
2. **Camera media.** Live view, stills, thumbnails, clips — or any URL that
   resolves to media without independent authentication.
3. **Precise location.** The open path *accepts* `lat`/`long`
   (`httpapi/open.go:23-26`, stored via `store/openpath.go:216`, `:254-255`).
   Geodata goes **in** and never comes back **out**.
4. **Fleet inventories, floor plans, zone maps** — anything that enumerates the
   property in one message.
5. **Occupancy and presence facts**, including automation states that imply them
   (`src/lib/demoData.ts`), unless opted in per location (§4.4 rule 6).
6. **Security posture and lock state** for anything not being acted on in that
   exact exchange.
7. **Audit-log contents, member rosters, other members' activity.**
8. **Anything that narrows a physical attack** — schedules ("mower runs at
   06:00", `src/lib/demoData.ts`), maintenance windows, controller offline
   status framed as an availability gap.

### 5.4 Identifiers in chat payloads are hints, never capabilities

Access-point UUIDs already travel through the platform inside interactive
payload ids — `open_ap:<id>` (`channels/whatsapp.go:179`, `:194`),
`open_gate:<id>` (`channels/slack.go:107`), `open_ap:<id>` on Telegram
(`channels/telegram.go:92`). That is acceptable **only** because possessing the
id grants nothing: the tap is re-authorized against the caller's live authorized
set before anything actuates (`channels_whatsapp.go:247-253`,
`channels_open.go:114-128`).

**Rule.** No identifier that appears in a chat payload may ever become
bearer-authoritative. Every redemption re-resolves identity and re-authorizes.
This is a property the current code has; it must survive the generalisation,
because the number of identifiers on the rail is about to multiply.

### 5.5 Conversation shape

Slack replies go to the channel the event arrived on
(`channels_slack.go:105-106`, `:183`) — in a shared channel, every reply is
visible to everyone in it, including members with no Aql access at all.

**PROPOSAL.** In a multi-party conversation:

- T0 query replies and all T2+ actuations are **refused** unless the operator has
  explicitly marked that conversation as trusted for that location.
- Confirmations and step-up prompts always go to a direct message, never a
  channel, regardless of where the request originated.
- The refusal itself must not leak: "I can't do that here — send me a direct
  message" reveals nothing about the fleet.

### 5.6 Refusals must not leak either

The existing denial copy names a category and nothing more
(`channels/reply.go:15-30`). Two properties to preserve and extend:

- **Unauthorized and non-existent are indistinguishable.** Cross-tenant access
  points already read as missing (`httpapi/open.go:249-251`,
  `httpapi/access.go:96-100`). "No such device" must be byte-identical whether
  the device does not exist or the caller is not authorized for it.
- **A tier refusal names the tier, not the fleet.** "That needs approval in the
  console" — not "the mower is at 81% and docked".

---

## 6. Migration

Every path below was verified against the tree at the time of writing (post-fold,
commit `bf99a4d`, module `github.com/vul-os/aql/gateway`).

### 6.1 Untouched — explicitly

| Path | Why |
|---|---|
| `hub/internal/keys/envelope.go:73-94` (`SignCommand`) | The signed-command path stays exactly as-is |
| `hub/internal/keys/keys.go` | Signing identity |
| `hub/internal/hub/hub.go` | Dispatch, ack correlation, `LateAckWindow` (`:41`) |
| `controller/` (entire module) | Deployed hardware; verification order is `proto/commands.md:49-70` |
| `proto/commands.md`, `proto/pairing.md`, `proto/grants.md`, `proto/events.md` | No new `cmd` value; non-access devices use the driver seam (§1.5) |
| `hub/internal/channels/channels.go:70-106` | The `Channel` / `DialChannel` seam shape is already right |
| `hub/internal/channels/channels.go:178-244` | Signature primitives, fail-closed |
| `hub/internal/channels/channels.go:112-172` | `Config` / `FromEnv` |
| `hub/internal/channels/send.go` | All three senders; WhatsApp engine selection (`:202-268`) |
| `hub/internal/store/ratelimit.go:195-270` | Counter primitives (atomic bump / try-bump / cooldown claim) |
| `hub/internal/store/grants.go` | Grant lifecycle — **extended** in §6.3, not rewritten |
| `hub/internal/store/openpath.go:57-190` | The limit ladder itself |

### 6.2 New — additive packages

**`hub/internal/intent/`** (new)
- `registry.go` — canonical verbs, aliases, capability→verb table.
- `tiers.go` — the `(capability, verb) → tier` table plus
  `RequiresConfirmation` / `RequiresStepUp` / `RequiresWindow`.
- `resolve.go` — `Resolve(candidates []Candidate, text string) (Intent, Ambiguity)`.
  Pure functions, no I/O, table-driven tests. Stdlib `strings` only — the same
  dependency surface `channels.NormalizeText` already has
  (`channels/channels.go:251-275`).

**`hub/internal/actuate/`** (new)
- `port.go` — the `Port` interface (§1.4).
- `access.go` — `AccessPort`, lifted verbatim from `dispatchCommand`
  (`httpapi/open.go:101-132`).
- Everything else → `not_implemented`.

### 6.3 Changed — minimally, with the safety-critical edit called out

**The one line that matters most:**

```go
// hub/internal/store/openpath.go:243-245
if args.Command != "open" && args.Command != "close" {
    return nil, fmt.Errorf("bad command %q", args.Command)
}
```

This is what makes it structurally impossible for any channel — today or after a
future bug — to actuate anything but open/close. It widens to an **explicit
allowlist derived from the tier registry**. It must never widen to "any non-empty
string". Everything else in this migration is refactoring; this line is the
security boundary.

| Path | Change |
|---|---|
| `hub/internal/store/openpath.go:243-245` | Verb allowlist from the registry (above) |
| `hub/internal/store/openpath.go:285-296` | Limits currently gated on `Command == "open"`; gate on tier instead — T3 keeps today's exact ladder |
| `hub/internal/httpapi/channels_open.go:50-94`, `:114-142` | `phoneOpen` / `profileOpen` take verb + tier; add the tier gate before the choke point. Their contract — resolve authority, call the choke point, never decide — is unchanged |
| `hub/internal/httpapi/channels_whatsapp.go:137-181` | Replace the `strings.Contains` branch with one `intent.Resolve` call; `:146-156` becomes generic narrowing. `waAccessCommand` (`:259-280`) keeps its shape |
| `hub/internal/httpapi/channels_slack.go:131-152` | Same substitution for the `txt == "open" \|\| txt == "gates"` switch (`:139`) |
| `hub/internal/httpapi/channels_telegram.go:83-102` | Same substitution (`:84`); the 0/1/many branch becomes the generic narrowing |
| `hub/internal/httpapi/channels_slack.go:160-163` | `open_gate:` prefix check becomes registry-driven selection-context redemption |
| `hub/internal/httpapi/channels_telegram.go:108-110` | Same for `open_ap:` |
| `hub/internal/channels/whatsapp.go:279-284` | `ParseSelection`: **delete the `return "open", id` default**; unknown ids reject (§2.2d) |
| `hub/internal/channels/whatsapp.go:170-211`, `:214-228` | `PushGateMenu`/`PushLocationMenu` → generic over `[]Candidate`; add "showing N of M" when truncating at `:189-191` / `:216-218` |
| `hub/internal/channels/slack.go:88-111` | `AccessBlocks` → generic **and add the missing cap** (§2.2c) |
| `hub/internal/channels/telegram.go:84-96` | `TelegramGateKeyboard` → generic |
| `hub/internal/channels/channels.go:272-275` | `textIncludesName` moves into `intent/` and becomes scored, not first-match (§2.2a) |
| `hub/internal/channels/reply.go:15-30` | Add tier-refusal, `not_implemented`, and unresolved-intent copy. Existing strings are a behavioural contract — extend, don't reword |
| `hub/internal/store/migrations/` | New `0008_*.sql` (current head is `0007_audit_hash_chain.sql`, embedded and applied by `store/store.go:26-27`, `:84-118`): capability/verb columns, the T4 window table, per-tier quota columns. `access_logs.command` already stores a string — no change needed there |

### 6.4 One thing to fix while passing through

`opSources` accepts only `web`, `whatsapp`, `api`
(`hub/internal/httpapi/open.go:20`) — Slack and Telegram are absent, so an
HTTP caller cannot claim them. The chat path does not go through that map: it
passes `channels.Kind…` straight into `LogAccess`
(`channels_open.go:53`, `:84-86`, `:129-134`), which is correct and is why the
audit source is accurate today. When the source vocabulary grows, `opSources`
and the channel `Kind` constants (`channels/channels.go:43-48`) must be derived
from one list rather than drifting as two.

### 6.5 Rollout order

1. **Pure refactor.** Land `intent/` + `actuate/` with the registry restricted to
   `{open, close}` at T3. Behaviour must be byte-identical, provable against the
   existing suites — `hub/internal/channels/channels_test.go`,
   `hub/internal/httpapi/channels_test.go`,
   `hub/internal/httpapi/open_test.go`,
   `hub/internal/store/openpath_test.go`, plus the cross-module `e2e/`
   harness.
2. **Disambiguation hardening.** Scored matching, truncation disclosure, the
   Slack cap, the `ParseSelection` default removal. Still one verb — so any
   behaviour change here is visible in isolation.
3. **T0 reads**, off by default, per location.
4. **T1**, then **T2**, each behind a per-location toggle.
5. **T4 last**, off by default, and only once the device engine can actually
   actuate (`ROADMAP.md:17-27`, `:34-37`, `:48`) — until then a T4 verb returns
   `not_implemented`, which is the truth.

T5 (§3.6) is enforced from step 1, not added at the end.

### 6.6 A note on claiming this is built

lintel carried a docs-vs-code tripwire — `scripts/check-feature-claims.mjs` plus
a hand-maintained manifest (commit `de10f68`) that failed the build when a doc
claimed a feature with no code evidence, *and* when a "planned" claim's evidence
appeared. It did not survive the fold: `scripts/` in this repo contains only
`screenshot.mjs`; the originals are still readable under `lintel/scripts/`.

If it is restored, every claim in this document registers as **planned**, with
the exception of the shipped-behaviour citations in §0, §1.3, §2.1 and §5.4.
Until then, the `PROPOSAL` labels are the only thing standing between this
document and an overclaim — please keep them accurate.

---

## Appendix A — worked examples

| Message | Verb | Target | Tier | Outcome |
|---|---|---|---|---|
| "open" (member, one gate) | `open` | sole candidate | T3 | Actuates. Identical to today (`channels_whatsapp.go:154-156`) |
| "open" (member, 12 devices, 3 with `open`) | `open` | 3 candidates | T3 | Picker over 3 — verb-first filtering did the work (§2.3 stage 1) |
| "open the gate" (fleet has `Gate Lock` + `Front Gate Camera`) | `open` | 1 candidate | T3 | Actuates. The camera has no `open` verb. Today this is a first-match coin flip (§2.2a) |
| "dim the garden lights to 40" | `set{level:40}` | `lights-grd` | T1 | `not_implemented` — no driver seam yet (§1.4) |
| "start the mower" | `start` | `mower-m1` | T4 | Refused unless an operator armed a window; then confirm + console step-up (§3.4) |
| "stop the mower" | `stop` | `mower-m1` | T1 | No confirmation, no limit — the inverse is always reachable (§3.7) |
| "turn everything off" | `off` | group | — | Refused above T1; group fan-out is T0/T1 only (§2.3 stage 5) |
| "is the gate closed" | `status` | `gate-lock` | T0 | "Last open acked 12:04; no position sensor, can't confirm" (§4.1) |
| "how much solar today" | `read` | `solar` | T0 | `not_implemented` — no energy engine (`ROADMAP.md:39-43`) |
| "unlock all doors" | `unlock` | group | T3 | Refused — group fan-out above T1 (§2.3 stage 5) |
| "set the gate pulse to 900ms" | `config` | — | T5 | Refused, unconditionally (§3.6) |
| "opne the gate" | unresolved | — | — | Question, not a command. Nothing actuates (§3.5) |

## Appendix B — reference index

**Chat channel seam** — `hub/internal/channels/`: `channels.go` (seam,
signature verification, text normalization), `whatsapp.go`, `slack.go`,
`telegram.go`, `socketmode.go`, `dmtap.go` (scaffold, fails closed —
`channels.go:47`), `send.go` (outbound), `reply.go` (denial copy).

**Chat handlers** — `hub/internal/httpapi/`: `channels_whatsapp.go`,
`channels_slack.go`, `channels_telegram.go`, `channels_open.go` (the shared
authority resolution), `channels_dmtap.go`.

**Choke point and limits** — `hub/internal/store/`: `openpath.go`
(`LogAccess`, `CheckAndConsumeOpenLimits`, late-ack reconciliation),
`ratelimit.go` (counters, config layering, chat flood throttle), `grants.go`
(visitor grants), `channels.go` (identity → authorized set), `locations.go`
(quotas, usage), `accesspoints.go`, `devices.go`, `audithash.go` (hash chain).

**Actuation** — `hub/internal/keys/envelope.go` (`SignCommand`),
`hub/internal/hub/hub.go` (dispatch, ack), `hub/internal/httpapi/open.go`
(`dispatchCommand`), `controller/`.

**Wire contracts** — `proto/commands.md`, `proto/events.md`, `proto/grants.md`,
`proto/pairing.md`, `proto/vectors/`.

**Aql device model** — `src/lib/data.ts` (demo shapes),
`docs/ARCHITECTURE.md` (driver seam, non-negotiables), `ROADMAP.md` (what is
built), `docs/THREAT-MODEL.md` (target posture).
