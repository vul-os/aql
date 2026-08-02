# Controller events — v0

The upstream direction: everything the controller wants the hub (and humans) to
know. Designed in from day one because retrofitting event flow into deployed hardware
is the painful one — the visitor button, held-open alarms and tamper detection all ride
this channel.

## Envelope

```json
{
  "v": 0,
  "typ": "event",
  "event_id": "uuid (controller-generated, idempotency key)",
  "device_id": "uuid",
  "kind": "opened",
  "ts": 1789000000,
  "data": {},
  "sig": "base64url(ed25519(controller_key, JCS(envelope minus sig)))"
}
```

Hub verification: `sig` must verify against that `device_id`'s enrolled
controller key over `JCS(envelope minus sig)`; failures never enter the
audit-of-record (quarantine + security alert instead). `ts` is the controller's
clock and is informational — the hub also records its own receipt time.
Dedupe is on `event_id`.

Delivery: over the standing WebSocket when connected; otherwise queued durably on the
controller (ring buffer, oldest-dropped, capacity ≥ 10k) and drained on reconnect.
The hub dedupes on `event_id`. Offline grant redemptions are **never** dropped before
delivery — they occupy a reserved partition of the queue.

**On receipt** the hub verifies the controller signature (fail-closed, before
any routing), then stores the envelope verbatim in `controller_events` keyed
by `event_id` — that key *is* the dedupe, so a redelivery collides and is
discarded rather than double-logged. Kinds that describe a physical access
outcome (`grant_redeemed`, `opened`, `denied`) additionally append a row to
the hash-chained `access_logs` with `source = offline_grant`, resolving the
access point from the *device* rather than from the event payload — a
controller must not be able to write audit rows against a gate it does not
drive. `boot` is stored but is not an access event and stays out of that view.

### Refused offline redemptions are recorded, and only the attributable ones

A `denied` event is emitted for an offline grant refused at the gate — wrong
gate, outside its window, expired, revoked — with the refused `grant_id` as
`ref`. This did not exist until the deny-list did: the grant path emitted
`denied` only for a hardware failure AFTER verification had already passed, so
a member whose access was taken away was turned away with no trace anywhere.
For a `revoked` refusal in particular, that is the single event an operator
would most want.

**Only refusals made after the grant's signature verifies are recorded.** That
is a security rule, not an optimisation. The queue above is a bounded ring that
evicts the oldest undelivered normal event when full, so recording every
refusal would give anyone within reach of the gate an unauthenticated write into
it: present forged grants in a loop and real events fall out the back. A valid
signature bounds who can write to holders of grants this hub issued. Note that
an attacker can always obtain a *challenge* — the controller issues one to
anyone who asks — so the signature check is the only thing standing between the
gate and the audit ring.

This paragraph describes behaviour that did not exist until migration 0019.
Before it, the hub verified each event and then discarded it (the handler was
a single log line), which made the dedupe sentence above false and left an
offline grant redemption — the one open with no hub in the loop, and so the
one the controller works hardest to record — with no trace on the hub at all.

## Kinds

The **Status** column says whether the reference controller actually sends the
kind. It is not decoration: five of these are RESERVED — the envelope, the
queue, the signature and the hub's store-and-ignore rule all handle them, and
nothing emits one. A hub built against this table without that column would
grow a `button` handler that never fires, and its author would have no way to
tell that from a quiet gate.

Reserved kinds are specified rather than deleted because the point of this
document is that retrofitting event flow into deployed hardware is the painful
change. Reserving the shape now is cheap; renaming a kind after a thousand
controllers ship is not.

| `kind` | `data` | Drives | Status |
| --- | --- | --- | --- |
| `opened` / `closed` | `{cause: "cmd"\|"grant"\|"button", ref}` | audit log, notifications, time & attendance | **sent** |
| `denied` | `{reason, ref}` — `reason` = any cmd.ack `detail` value (commands.md), or any `grant.result` detail (grants.md); `ref` = the command nonce or the refused `grant_id` | security alerting | **sent** |
| `grant_redeemed` | full offline-redemption record (grant_id, cnonce, proof) | audit continuity for offline opens | **sent** |
| `boot` | `{fw, reason}` | fleet health, update tracking | **sent** |
| `button` | `{button_id}` | **intercom-lite**: the hub notifies the resident's chat — "Someone is at the gate. Reply OPEN." | reserved — no button input exists |
| `held_open` | `{seconds}` | gate-left-open alerts, as the `access.held_open` webhook | **sent**, when a position sensor is present and `-held-open-after` is set. `seconds` is how long the sensor has NOT REPORTED CLOSED, which is not the same claim as "the gate was open": an unreadable line reports not-closed too, deliberately, and the controller does not guess which it is |
| `tamper` | `{sensor}` | enclosure opened / supply cut alerts | reserved — no tamper sensing exists |
| `power` | `{source: "mains"\|"battery", level}` | battery/outage telemetry (load-shedding reality) | reserved — no power monitoring exists |
| `net` | `{iface: "wifi"\|"gsm", rssi}` | connectivity telemetry, `last_seen_at` | reserved — no radio telemetry exists |

`eventKinds.test.ts` holds the column against the reference controller's
source, in both directions: a **sent** kind nothing emits, and a **reserved**
kind something has started emitting, both fail.

Additive: new kinds may appear; hubs must store-and-ignore unknown kinds (they
still land in the raw audit log).

## Reconnect, buffering, and audit-log gaps

### What is buffered, and what is not

Every event is durably queued locally (fsync'd per append) before it is
ever sent, and drained on reconnect (top of this file). Two loss modes
exist under that, and they are not the same:

- **Normal events, extended disconnection:** the ring is bounded (10k
  total, minus the reserved grant partition). Once full, the oldest
  **undelivered** normal event is dropped to make room for the newest — a
  deliberate tradeoff (bounded storage on small devices vs. unlimited
  retention). A controller offline long enough to fill the ring **will**
  lose normal events (telemetry, `denied`, `button`, …), oldest first.
- **`grant_redeemed` events:** never *dropped* — but "never dropped"
  describes the queue's behavior, not the system's. If the reserved
  partition is itself full of undelivered grant events, enqueue is
  *refused* rather than evicting an old entry, and refusal is not the same
  as delivery.

**The deliberate ordering, and why the gate still opens.** Offline-grant
actuation is recorded *before* it is actuated: the reference controller
durably writes the `grant_redeemed` event first, then pulses the relay —
closing the window (crash, power loss, a full audit queue) between "the
gate physically opened" and "any trace of authorization exists on disk"
for the common case. But this is the offline emergency-access path by
definition: there is no hub reachable to fall back to, so recording is
never allowed to block the open. If the reserved partition is itself full,
recording degrades in two steps rather than failing outright: (1) the
reserved partition, normally; (2) if that is full, an always-on local
overflow log (fsync'd, append-only), so even "partition full" still leaves
a durable, operator-recoverable trace on the device. Only if *both* of
those writes fail — e.g. the filesystem itself is unwritable, a rarer and
more severe condition than "roughly a thousand undelivered offline opens"
— does the controller proceed with **no** audit record at all. Even then,
**the gate still opens.** This is an intentional tradeoff, not an
oversight: an unaudited-but-granted open is judged safer than a stranded
resident during a real emergency. An implementer must not "helpfully" make
this fail-closed — refusing to open because the audit disk is unhappy
trades a paperwork gap for a person locked outside a gate, which is the
worse failure mode for a physical access system. If this tradeoff is ever
revisited, it is a product decision, not something to silently flip in
code.

### No delivery ack for events

Commands get a `cmd.ack`; events get no acknowledgement at all. The
controller marks an event delivered as soon as the outbound frame write
succeeds — there is no confirmation from the hub that it actually
received or persisted the event. If the write lands in a buffer for a
connection that dies immediately after, or the hub accepts the bytes
but crashes before persisting, the controller believes the event delivered
(and drops it from its durable queue) while the hub never has it.
`event_id` dedup makes a *retry* safe, but nothing triggers one — this is a
real, currently unhandled gap, structurally similar to the lost-ack
ambiguity in commands.md but with strictly less mitigation (no timeout, no
"undelivered" signal — nothing is watching for one). **v0: undefined / open
question.** v1 proposal (would need a wire change, not applied here): an
explicit event-ack message, or an equivalent transport-level delivery
confirmation on every path, not just the poll fallback's HTTP response
code.

### Can the audit log tell "nothing happened" from "we lost events"?

Not currently. The signed `event` envelope carries `event_id` (a random
UUID, for dedup) but **no sequence number** — nothing on the wire lets the
hub detect that events are missing between two it did receive. A
hub operator looking at a gap in the timeline cannot distinguish "the
gate was quiet" from "the gate was busy and we lost the record," for
either loss mode above. For an append-only audit log on a system that
opens physical gates, that is a real defect, not a cosmetic one. **v0:
undefined.** v1 proposal (would require a wire change, not applied in this
pass): expose a monotonic per-device sequence number on the event
envelope, or emit a synthetic `queue_gap` event kind
(`{"dropped": n, "from_seq": …, "to_seq": …}`) the next time room exists to
enqueue one, so a gap in the audit view is *visible* rather than silent.

## Clock after a power cut

Controllers with no battery-backed RTC (the assumed common case on
small/GSM boards) come up from a power cut with an untrustworthy wall
clock, often reset to the epoch. A controller reports the system wall
clock as "now" until the **first** live sync of that boot — either the
`iat` on a `ws.challenge` at connect, or an accepted `ping` command's
`iat`. The last-known-good hub sync time, by contrast, survives
reboots (it is persisted and carries forward until overwritten by a real
sync).

What this means per verification path:

- **Live commands:** fail closed, but not necessarily for the reason
  you'd expect. A garbage-low wall clock reads as far *before* any real
  envelope's `iat`, so every command is rejected `not_yet_valid`; a
  garbage-high one reads as far *after* every `exp`, so every command is
  rejected `expired`. Either way nothing actuates on a bad clock, and the
  moment the controller reconnects, the `ws.challenge` handshake re-syncs
  it before any command is served — live commands self-heal as soon as
  connectivity returns.
- **Offline grants — the intended guard:** the 14-day stale-clock limit
  (grants.md) is meant to refuse offline redemption outright once a
  controller has gone too long without a real time reference (elapsed time
  since the last hub sync exceeds the limit, or the controller has
  never synced at all).
- **Offline grants — the backward-clock case, fixed:** the naive staleness
  check computed as *(untrusted now) − (last known sync)* only catches a
  clock that has drifted too far **forward**. A wall clock that resets
  **backward** past the previously persisted sync time (the RTC-less-reboot
  case above) produces a negative elapsed time, which never exceeds the
  14-day limit under that check — the staleness guard would not fire, even
  though the clock is exactly as untrustworthy as the forward-drift case.
  The reference controller's staleness check treats elapsed time outside
  `[0, limit]` in **either** direction as stale — never-synced, drifted too
  far forward, or reset backward past the last sync all deny with
  `stale_clock` — rather than relying on the grant's own `iat`/`exp` window
  to coincidentally catch the same bad "now" a second time. No wire change:
  this is purely controller-side verification logic, and it runs before the
  grant is even inspected (stale-clock is step 1 of the grants.md order).
