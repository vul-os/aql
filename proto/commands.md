# Signed commands — v0

Every actuation the controller performs is a signed envelope from its paired hub.
Transport (WebSocket push, long-poll response, LAN relay via the app) is irrelevant to
validity — only the signature, expiry and nonce are.

## Envelope

```json
{
  "v": 0,
  "typ": "cmd",
  "cmd": "open",
  "device_id": "uuid",
  "access_point": "main",
  "nonce": "base64url(128-bit random)",
  "iat": 1789000000,
  "exp": 1789000030,
  "cause": { "kind": "chat", "channel": "whatsapp", "member": "uuid", "event": "uuid" },
  "sig": "base64url(ed25519(gateway_key, JCS(envelope minus sig)))"
}
```

Field rules:

- `cause` is **optional** (portal/scheduled commands may omit it). Optional fields
  are omitted entirely when absent — never `null` — and are covered by `sig` when
  present.
- `access_point` is **required** for `open` / `hold` / `close` and **omitted** for
  all other commands. It must name an access point this controller serves.
- Commands that carry parameters put them in an optional `payload` object, covered
  by `sig`: `config` → the params being set (e.g. `{"pulse_ms": 700}`), `repair` →
  `{"next_pubkey": "base64url(ed25519-pub)"}`, `hold` → optionally
  `{"seconds": 900}` (absent = hold until `close` / `hold_max`).

## Commands

| `cmd` | Effect | Notes |
| --- | --- | --- |
| `open` | pulse the relay for the configured duration | the one that matters |
| `hold` | hold open until `close` or `hold_max` seconds | gate-day mode |
| `close` | end a `hold` | |
| `lockdown` | refuse all opens (incl. offline grants) until `lift` | emergency freeze |
| `lift` | end lockdown | |
| `ping` | liveness + clock check; reply carries controller time | drift telemetry |
| `config` | update actuation params (pulse ms, sensor debounce, `hold_max`) | additive keys only |
| `repair` | accept a new hub key: payload carries `next_pubkey` | key rotation; signed by the *current* pinned key |

## Verification (controller side, fail-closed)

Checked in this order; the first failure wins and is the reported reason (in
parentheses, from the `detail` vocabulary below):

1. `sig` verifies against the pinned hub key (`badsig`).
2. `device_id` matches self (`wrong_device`); for `open`/`hold`/`close`,
   `access_point` is present and served by this controller (`wrong_access_point`).
3. `iat ≤ exp` and `exp − iat ≤ 60` (`window_too_long`), and
   `iat − skew ≤ now ≤ exp + skew` with skew = 90 s applied to **both** bounds
   (`not_yet_valid` / `expired`) — GSM clocks drift; controllers sync clock from
   the hub on every ping/connect.
4. `nonce` never seen before (`replay`). A nonce must be remembered until its
   envelope's `exp + skew` has passed (after which step 3 rejects it anyway), so
   the store is small and bounded; 1024 slots is ample at that horizon. If the
   store ever fills with live nonces, reject new commands fail-closed rather than
   evict a live nonce.
5. During `lockdown`, only `lift`, `ping`, `config`, `repair` are accepted
   (`lockdown`).

Any failure → no actuation, log an `event` (see events.md) with the reason. Never
"open on doubt".

## Acknowledgement

```json
{ "v": 0, "typ": "cmd.ack", "device_id": "uuid", "nonce": "…",
  "result": "opened|held|closed|denied|error", "detail": "replay", "ts": 1789000001,
  "sig": "base64url(ed25519(controller_key, JCS(ack minus sig)))" }
```

`device_id` identifies the signing controller (the hub verifies `sig` against
that device's enrolled key). `detail` is **optional** — omitted on success —
and carries a machine-readable reason from this shared vocabulary (also used by
events.md `denied` and grants.md):

`badsig | expired | not_yet_valid | window_too_long | replay | lockdown |
wrong_device | wrong_access_point | wrong_grant | window | stale_clock |
cnonce_unknown | cnonce_expired | cnonce_replay | hw:…`

The hub records the ack in the audit log; an unacked command past `exp` is recorded
as `undelivered` and surfaces in chat ("couldn't reach the gate — it may be offline").

## Configuration report (`ctl.report`)

A controller reports the actuation configuration it is **actually running**, so
the hub can show what is in effect rather than only what it last sent.

```json
{ "v": 0, "typ": "ctl.report", "device_id": "uuid", "ts": 1789000001,
  "firmware": "0.1.0",
  "config": {
    "pulse_ms":           { "value": 700, "source": "default" },
    "hold_max":           { "value": 30,  "source": "config"  },
    "sensor_debounce_ms": { "value": 20,  "source": "default" }
  },
  "sig": "base64url(ed25519(controller_key, JCS(message minus sig)))" }
```

Sent once after `ws.auth` succeeds, and again whenever the resolved
configuration changes. **Not** carried on `cmd.ack`: a gate nobody has commanded
would never report, leaving the hub's view emptiest for the quietest controllers.

`value` is the RESOLVED number — what the controller will actually use — and
`source` is `config` when it came from a `config` command and `default` when it
came from the firmware's compiled-in value. Both are required. A controller that
has never been configured and one configured a year ago are otherwise
indistinguishable, and "700 ms" and "700 ms (default)" are different claims.

The hub verifies it as any controller uplink: `sig` against the enrolled
`controller_pubkey`, then `device_id` against the device the session belongs to
(`wrong_device`). It is DISPLAY DATA and authorises nothing — it cannot relax
`hold_max`, lift lockdown, or affect what the controller will accept. The
configuration the hub *sends* is unchanged by anything here.

Unknown keys inside `config` are ignored rather than rejected, so a controller
that learns a new tunable does not require the hub to be updated first. That
direction is safe because uplink verification canonicalises the bytes it
received minus `sig`, not a rebuild of known fields — an older hub accepts a
message carrying a field it has never heard of, and the field is still covered
by the signature.

A device that has sent no report is **"not reported yet"**. It is never rendered
as the defaults: inferring them would show numbers nobody confirmed, and every
controller predating this message sends none.

See [`docs/CONTROLLER-CONFIG-REPORT.md`](../docs/CONTROLLER-CONFIG-REPORT.md)
for why the carrier is a session report, and what is deliberately left open.

## Delivery semantics under partition

A signed envelope can be lost at any of three points: before the controller
receives it, after actuation but before the ack is sent, or after the ack is
sent but before the hub receives it. The hub cannot tell these three
apart. This section specifies what each visible outcome means — and, just as
important, what it does not resolve.

### Dispatch outcomes

| Outcome | Wire meaning | What it does NOT tell you |
| --- | --- | --- |
| `acked` | A verified `cmd.ack` for this exact `nonce` arrived within the ack-wait deadline (reference hub: 5 s default, configurable, always shorter than the envelope's own up-to-60-s window). | — |
| `undelivered` | No `cmd.ack` for this `nonce` arrived within the deadline. | Whether the controller ever received the envelope, actuated it, or sent an ack still in flight. The envelope stays valid — and the controller will still act on it and reply — until `exp + skew`, which can be well *after* the hub has already reported `undelivered`, because the ack-wait deadline is shorter than the envelope's own validity window. |
| `queued` | The controller was offline; the envelope was appended to its poll queue, TTL'd to the envelope's own `exp`. | Whether the controller reconnects before `exp`. Reconnect backoff is jittered exponential (seconds up to minutes); an envelope's window is ≤ 60 s + skew. In practice `queued` only turns into an actual open if the controller happens to reconnect within roughly a minute of dispatch; for a controller offline longer than that, `queued` quietly expires with no further signal to the hub or the resident. |

### The lost-ack case, specified honestly

If the link drops between the controller acting and its ack reaching the
hub, the hub reports `undelivered` — a **dispatch outcome, not a
negative result**. The gate may have opened. The chat reply reflects that
ambiguity and never claims a definite outcome it cannot back up: "couldn't
reach the gate — it may be offline" is deliberately non-committal, not "the
gate did not open."

What IS guaranteed:

- **A lost ack can never itself cause a second physical open.** The hub
  does not retry a dispatch — `undelivered` is terminal for that one signed
  envelope. If the *same* envelope were ever redelivered (e.g. a duplicate
  frame at the transport layer), the controller's nonce store (step 4 above)
  makes the redelivery a no-op, not a second actuation.
- **The hub never reports success when the controller did not answer.**
  `acked` only ever reflects a verified `cmd.ack`; there is no "assume
  success" path.

### Late-ack reconciliation

A `cmd.ack` for a `nonce` can legitimately arrive after the ack-wait
deadline has already elapsed — the envelope stays valid, and the controller
keeps acting on and replying to it, until `exp + skew`, which is routinely
later than the deadline (see the `undelivered` row above). The reference
hub does not just log a late ack and move on: it reconciles it against
the access-log row the original dispatch wrote, **within a bounded window**
and **without ever rewriting that row**.

- **Bounded window.** A late-arriving, correctly-verified ack is only
  eligible to reconcile for a fixed window after its dispatch (reference
  hub: 10 minutes — comfortable headroom over the envelope's worst-case
  validity plus reconnect jitter, without being "arbitrarily long"). Outside
  that window the ack is logged and dropped, not reconciled: a controller's
  signed word has no business rewriting an audit row from a shift that
  ended hours or days ago, and an unbounded window only widens the
  (already-authenticated) opportunity for a compromised-but-still-enrolled
  controller to backdate outcomes. Matching is exact and one-shot: the
  same `nonce`, addressed to the same `device_id` the original dispatch
  targeted, consumed on first match — a duplicated/replayed late ack cannot
  reconcile twice.
- **Append, not overwrite.** A reconciled ack does not edit the original
  access-log row. It inserts a **new** row, tagged `late_ack:<result>`
  (`late_ack:<result>:<detail>` when `detail` is present) and pointing back
  at the original row it reconciles. "We didn't hear back by the deadline"
  stays true forever, exactly as it was recorded at the time; "we heard
  back late, and here is what it said" becomes a second, equally durable
  fact instead of silently replacing the first. This is a deliberate audit
  property, not an implementation detail: an implementer must not
  "simplify" this into an in-place update — the whole point is that both
  facts remain independently visible in the audit-of-record. The
  reconciliation row's success reflects the controller's own signed word:
  `opened` / `held` / `closed` mean the gate did the thing; `denied` /
  `error` mean it did not.
- Reconciliation only ever runs on an ack that has **already passed full
  signature verification** against the enrolled controller key (the same
  check the on-time path applies) — the window and nonce/device match above
  are what decide whether an already-authenticated message is still
  entitled to correct the record, never a substitute for authenticating it.

A late ack outside the window, or one whose nonce the hub no longer
recognizes at all, is logged and otherwise dropped — same as before.

### Resending "open" is not the same as retrying a dispatch

The nonce only makes the *exact signed envelope* idempotent — it says
nothing about the resident. If an "open" appears to fail or stall and the
resident sends "open" again, the hub mints a **new** envelope with a
**new** nonce: a fresh authorization event, not a retry of the first one. If
the first envelope's ack was merely delayed (the lost-ack case above) and it
lands after the second envelope has already been dispatched, the controller
will legitimately actuate **twice** — once per envelope, each individually
valid and correctly authorized. That is correct per-envelope behavior, but
it means the system-level assumption a resident might reasonably make — "if
it doesn't confirm, nothing happened, so asking again is safe" — does not
hold for `open`/`hold` across an ambiguous outcome. **v0: undefined /
unaddressed.** De-duplicating *repeated human intent* (as opposed to
de-duplicating one signed envelope) is a UX/rate-limit concern, not a wire
contract concern, so it is flagged here rather than specified.
