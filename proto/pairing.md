# Pairing — v0

How a controller becomes owned by exactly one hub. Carries over the legacy
claim-token flow (admin creates a claim, device redeems it) and adds mutual key
exchange with hub-key pinning.

## Flow

```
Admin (portal)                Hub                            Controller
     │  create device          │                                 │
     ├──────────────────────▶  │                                 │
     │  claim_token (TTL ≤ 7d) │                                 │
     │◀──────────────────────  │                                 │
     │        …token entered on controller (QR / config)…        │
     │                         │   POST /pair/redeem             │
     │                         │ ◀───────────────────────────────┤
     │                         │   { claim_token,                │
     │                         │     controller_pubkey,          │
     │                         │     hw: {model, fw, ifaces} }   │
     │                         │                                 │
     │                         │   200 { device_id,              │
     │                         │     gateway_pubkey,   ← PINNED  │
     │                         │     ws_url, poll_interval }     │
     │                         ├────────────────────────────────▶│
```

## Rules

1. `claim_token` is random ≥128-bit, stored **hashed** server-side, single-use,
   expires (`claim_ttl_seconds`, default 1h, max 7d — same bounds as legacy).
2. The controller generates its Ed25519 keypair **on device** at first boot; the
   private key never leaves it.
3. The redeem response is the **only** moment the hub public key is accepted.
   The controller persists `{device_id, gateway_pubkey, ws_url}` to durable storage
   and thereafter rejects any command or config not signed by that key.
4. Re-pairing (hub migration, key rotation) requires a `repair` command signed by
   the **currently pinned key** (see commands.md), or a physical factory-reset.
5. After pairing the controller maintains an outbound WebSocket to `ws_url`
   (wss only), authenticating by signing a server challenge with its device key.
   Reconnect with jittered backoff; fall back to HTTPS long-poll at `poll_interval`.

## Redeem request

```json
{
  "v": 0,
  "typ": "pair.redeem",
  "claim_token": "…",
  "controller_pubkey": "base64url(ed25519-pub)",
  "hw": { "model": "lintel-c1", "fw": "0.1.0", "ifaces": ["wifi", "gsm"] }
}
```

## Redeem response

```json
{
  "v": 0,
  "typ": "pair.grant",
  "device_id": "uuid",
  "gateway_pubkey": "base64url(ed25519-pub)",
  "ws_url": "wss://gate.example.com/api/controller/ws",
  "poll_interval": 30
}
```

Both redeem messages are **unsigned**: authenticity comes from TLS plus possession
of the single-use claim token, and the response is trusted only because it arrives
on the TLS connection the controller itself opened. `controller_pubkey` /
`gateway_pubkey` are raw 32-byte Ed25519 public keys, base64url, no padding.

## WebSocket auth (the "server challenge" of rule 5)

```json
{ "v": 0, "typ": "ws.challenge", "cnonce": "base64url(128-bit random)",
  "iat": 1789000000, "exp": 1789000030 }
```

The controller answers:

```json
{ "v": 0, "typ": "ws.auth", "device_id": "uuid", "cnonce": "…", "ts": 1789000001,
  "sig": "base64url(ed25519(controller_key, JCS(message minus sig)))" }
```

The hub verifies fail-closed: `sig` against that device's enrolled
`controller_pubkey`; `cnonce` is one it issued (`cnonce_unknown`), unexpired
(`cnonce_expired`) and single-use (`cnonce_replay`); `|ts − now| ≤ 90 s`
(`expired` / `not_yet_valid`). Reason strings are the cmd.ack `detail`
vocabulary (commands.md).

## Key rotation

Rule 4 states the mechanism: a `repair` command (commands.md), signed by the
**currently pinned** key, carrying `{"next_pubkey": "…"}`. This section
specifies its operational shape and, plainly, its security tradeoff.

### What `repair` actually is

`repair` is an ordinary signed command envelope — the same `cmd` pipeline as
`open` (commands.md §Verification), the same `exp − iat ≤ 60 s` window, the
same ±90 s skew, delivered over the same live-WS/queued-poll paths. It is
**not** a separate, longer-lived, higher-priority message. Concretely:

- A **connected** controller rotates promptly — same latency as any live
  command.
- A **disconnected** controller only rotates if it reconnects within the
  `repair` envelope's own short window; otherwise the envelope simply
  expires unconsumed, like any other queued command, and the controller
  stays pinned to the old key. Rotating a fleet with any offline controllers
  means re-issuing fresh `repair` envelopes until every device has acked —
  the same "keep trying" posture as dispatching `open` to an intermittently
  connected controller, not a one-shot broadcast.
- There is **no overlap window**: a controller pins exactly one
  `gateway_pubkey` at a time. The old key stops verifying the instant the
  repair is applied — there is no grace period where both the old and new
  key are accepted.

**v0: undefined / not implemented.** The primitive above — a controller
accepting a correctly-signed `repair` and swapping its pinned key — is real
and conformance-tested. The *orchestration* around it (the hub
generating a new keypair, keeping the old private key available exactly
long enough to sign and deliver `repair` to every controller it owns,
retrying stragglers, and confirming full rollout before anything treats the
old key as retired) has no admin-facing trigger in this codebase yet.
Nothing today actually calls `repair`.

### The tradeoff, stated plainly

Because `repair` must be signed by the **currently pinned** key, a hub
that has genuinely lost its old private key — not rotated it deliberately,
but lost it (disk failure with no backup, host rebuilt from scratch,
migrated to a new instance without carrying the seed file) — **cannot
author a valid `repair` for any controller it hasn't already migrated.**
Those controllers can never again accept anything from the new hub
identity. The only recovery path is rule 4's other option: physical factory
reset and re-pairing with a fresh claim token.

This is deliberate, not an oversight. The pinned key is the *entire* trust
anchor after pairing (rule 3: the controller "thereafter rejects any
command or config not signed by that key"). An **unauthenticated** rotation
path — anything that lets a party without the old private key retarget a
controller to a new key — would be a total compromise of the system: it
would convert "the hub that paired this device" into "whoever can
currently reach this device's rotation endpoint," for every gate at once.
Requiring proof of the old key is what makes pinning mean anything. The
brick risk on irrecoverable key loss is the price of that; the real
mitigation is ordinary key-material backup discipline for
`gateway_ed25519.seed`, not a protocol escape hatch.

### v1 proposal — not implemented here, would require a wire change

An explicit bounded overlap — the controller pinning an ordered, small list
of `{gateway_pubkey, valid_from}` and accepting a signature from **any**
currently-valid entry, with old entries expiring after a fixed window —
would let a planned rotation tolerate stragglers without the current
all-or-nothing swap. This needs a new persisted field (or a new pairing
message) and a decision on how many keys a controller pins at once; it is
out of scope for this additive v0 pass and is flagged here for v1, not
specified.
