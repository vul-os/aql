# Offline grants — v0

Emergency access: the app can open the gate with **no internet, no hub, no Meta** —
only the app, the controller, and math. The hub pre-issues a signed statement of a
member's rights; the controller verifies it offline against its pinned hub key.

## Grant (issued by the hub, refreshed whenever the app is online)

```json
{
  "v": 0,
  "typ": "grant",
  "grant_id": "uuid",
  "member": "uuid",
  "app_pubkey": "base64url(ed25519-pub)",
  "devices": ["uuid"],
  "access_points": ["main", "pedestrian"],
  "windows": [{ "days": "mon-sun", "from": "00:00", "to": "24:00" }],
  "iat": 1789000000,
  "exp": 1789604800,
  "sig": "base64url(ed25519(gateway_key, JCS(grant minus sig)))"
}
```

- TTL default **7 days**; the app refreshes on every online launch, so revocation
  converges within the TTL and is immediate on the normal (online) path.
- The grant binds the **app's own keypair** (generated on device, stored in the
  platform keystore). Possession of the grant alone is worthless.

## Offline redemption (LAN mDNS `_lintel._tcp` or BLE GATT)

```
App                                   Controller
 │  open {grant, access_point}            │
 ├───────────────────────────────────────▶│
 │             challenge {cnonce}         │   cnonce: 128-bit random, 30s validity
 │◀───────────────────────────────────────┤
 │  proof {grant_id, cnonce, access_point, ts, sig}
 ├───────────────────────────────────────▶│
 │                                        │  verify: see order below
 │              result {opened}           │
 │◀───────────────────────────────────────┤
```

### Redemption messages

All three are JSON. Only the proof is signed — by the app key bound in the grant,
over `JCS(message minus sig)` like every other signature in these contracts (no
raw byte concatenation).

```json
{ "v": 0, "typ": "grant.open", "grant": { "…full grant object…": "" }, "access_point": "main" }
```

```json
{ "v": 0, "typ": "grant.challenge", "cnonce": "base64url(128-bit random)",
  "iat": 1789030798, "exp": 1789030828 }
```

```json
{ "v": 0, "typ": "grant.proof", "grant_id": "uuid", "cnonce": "…",
  "access_point": "main", "ts": 1789030799,
  "sig": "base64url(ed25519(app_key, JCS(proof minus sig)))" }
```

### Verification order (controller, fail-closed — first failure wins; reasons
from the cmd.ack `detail` vocabulary, commands.md)

1. Stale-clock rule below (`stale_clock`).
2. Not in lockdown (`lockdown`).
3. `grant.sig` against the pinned hub key (`badsig`).
3a. `grant.grant_id` is not on the cached deny-list (`revoked`). Absent list =
   nothing revoked. After the signature because an id from unverified bytes is
   not an id; before the window because a dead grant needs no further
   evaluation. See [`docs/GRANT-REVOCATION.md`](../docs/GRANT-REVOCATION.md).
4. `grant.iat − 90 ≤ now ≤ grant.exp + 90` (`not_yet_valid` / `expired`).
5. Own `device_id` ∈ `grant.devices` (`wrong_device`).
6. Requested `access_point` ∈ `grant.access_points` and equals
   `proof.access_point` (`wrong_access_point`).
7. `now` falls inside one of `grant.windows` (`window`).
8. `proof.grant_id` equals `grant.grant_id` (`wrong_grant`).
9. `proof.sig` against `grant.app_pubkey` (`badsig`).
10. `proof.cnonce` is the cnonce this controller issued for this exchange
    (`cnonce_unknown`), unexpired — `now ≤ challenge.exp`, 30 s validity
    (`cnonce_expired`) — and single-use (`cnonce_replay`).
11. `|proof.ts − now| ≤ 90` (`expired` if older / `not_yet_valid` if newer).

`windows` entries: `days` is an inclusive range of `mon|tue|wed|thu|fri|sat|sun`
in week order, no wrap-around (`"mon-sun"` = every day); `from`/`to` are `"HH:MM"`
with `to` exclusive and `"24:00"` meaning end of day. Evaluated against the
controller's hub-synced clock in the controller's configured timezone
(default UTC).

Clock rule: controllers check `exp` against their last hub-synced clock; if the
controller has been offline (no hub clock sync) longer than **2 × the default
grant TTL = 14 days in v0** (a fixed constant — not derived from the presented
grant), it refuses offline redemption entirely (stale-clock fail-closed) —
chat/portal paths still work when connectivity returns.

Every offline open is queued as an audit event and uploaded on reconnect (events.md),
including the full grant_id + proof material, so the audit trail has no offline hole.

## Revocation vs. in-flight grants

The whole point of this path is "no hub involvement" — which means a
controller mid-redemption has no way to ask "has this been revoked?" and no
way to be told. This is a genuine, structural exposure window. Specify it
honestly rather than implying real-time revocation exists.

### What bounds the exposure

Only the grant's own `exp`. Default TTL is 7 days (top of this file). A
member revoked the instant after their app last refreshed a grant keeps
everything that grant authorizes — every `access_point` it lists, for the
rest of its `windows`, at any controller listing this device in `devices`
— for up to that long. There is nothing else:

- Deleting or disabling the member's account on the hub does not reach
  an already-issued grant; the grant is a self-contained, offline-verifiable
  object (the 11-step check above touches nothing but the presented bytes
  and the controller's own pinned key / clock / lockdown state).
- The next `grant` the hub signs for that member can simply not be
  issued, or be scoped down — but that only takes effect on the member's
  *next* refresh, and does nothing to a copy already on their device.

### What an operator can do to revoke fast

**A per-grant deny-list now exists** (`revoke`, commands.md;
[`docs/GRANT-REVOCATION.md`](../docs/GRANT-REVOCATION.md)). The hub sends a
signed, monotonically numbered list of `{grant_id, exp}` pairs; the controller
caches it durably and consults it at **step 3a**, after the signature check and
before the validity window. A revoked grant is denied with `revoked`.

This section previously read "There is no per-member or per-grant offline
deny-list", and the sentence that followed it is the one that still governs:
**the verification core takes no input besides the presented grant and local
controller state, by design — that locality is the feature this whole path
exists for.** That has not changed. The deny-list IS local state, cached while
the controller could reach the hub and consulted when it cannot; the core opens
no socket to check it, and `offline_purity_test.go` holds that.

Three properties bound what it does and does not buy:

- **Absence is never denial.** A controller holding no list behaves exactly as
  it did before the feature existed. The list can refuse a grant; it can never
  authorise one. So there is no rollout ordering to get wrong and no delivery
  failure that locks a resident out.
- **A monotonic `seq` is what makes it real.** Command envelopes are already
  signed, so a list cannot be forged — but it can be *withheld*, and an
  attacker replaying an older, emptier signed list would un-revoke a grant they
  hold. The controller stores the highest `seq` it has accepted and refuses
  anything at or below it.
- **It converges when the controller next hears from the hub, not instantly.**
  A controller that has not been online since the revocation still opens. That
  is irreducible without a live channel at redemption time, which is the thing
  this whole path exists to avoid needing.

`lockdown` remains the lever for "stop everything now", and it is still the
only one that needs no prior contact with the controller: it is blunt on purpose
— it has no notion of "this one member" and stops everyone until `lift`. The
deny-list is the precise lever; lockdown is the immediate one.

### Does the controller learn of revocation on reconnect?

**Yes, now.** `revoke` (commands.md) is that message. A controller that goes
offline and reconnects receives the current list and caches it, so its
offline-grant behaviour from that point reflects every revocation the hub knew
about at contact.

What remains true, and is the honest residue of the old answer: **while it is
offline it learns nothing.** A controller that has not reached the hub since
the revocation is governed only by each grant's own `exp`, exactly as before.

### Honest summary

This is a **bounded-exposure tradeoff**, not a defect to paper over:
offline-capable access control cannot also be instantly revocable without
either (a) a live channel to the controller at redemption time — which
would defeat the entire point of this path — or (b) a revocation list the
controller caches and consults while still offline.

**(b) is now built.** It is the `revoke` command and step 3a above, designed in
[`docs/GRANT-REVOCATION.md`](../docs/GRANT-REVOCATION.md). What it changes is
the TYPICAL case, which used to be identical to the worst case: a controller on
a working LAN learns within one command round-trip instead of waiting out a
seven-day TTL.

What it does not change is the worst case itself. A controller the hub cannot
reach cannot be told anything, so `exp` is still the outer bound and `lockdown`
is still the only lever that needs no prior contact. An operator deciding how
urgently to latch lockdown after a firing should reason about **whether that
controller is reachable**, not about the TTL.

### Implementation status

The controller side of this contract (verification, the 11-step order,
stale-clock, windows, cnonce handling) is real and conformance-tested. The
**hub side — minting a member's `grant` object — is also real and
conformance-tested**: `POST /v1/offline-grants`
(`hub/internal/httpapi/offline_grants.go`) authorizes the request through
the same gates the live `/open` path uses, all-or-nothing across the
requested access points, then signs the grant with
`hub/internal/keys.SignGrant` — verified byte-for-byte against this
file's `grant-redeem-valid` vector. TTL is fixed at the 7-day default above
and is not caller-extendable.

**The app side is now built too**, and this paragraph said the opposite for
long enough to be worth naming: it went on reading "nothing requests, stores or
presents a grant on a resident's device" after all three shipped. A wire
contract that describes a live path as absent is worse than one that is merely
out of date — it stops a reader from exercising the emergency path at all.

What exists: `src/lib/offline/service.ts` requests and refreshes,
`vault.ts` stores (IndexedDB, with the device key a **non-extractable**
WebCrypto `CryptoKey` so copying the database yields no usable key),
`redeem.ts` presents over LAN, and `src/pages/app/EmergencyAccess.tsx` is a
routed screen that a resident can actually reach — the library alone would have
been a path nobody could walk.

One correction to the reasoning above while it is being fixed. "Refreshes on
every online launch" is not what the code does: `refreshIfDue` runs when the
emergency screen is OPENED with a connection, not at app start. That does not
weaken revocation convergence — a grant nobody refreshes simply expires at its
own `exp`, and the hub declines to mint a replacement for a revoked member — but
it does mean a legitimate member who never opens the screen finds an expired
grant rather than a fresh one. Convergence is bounded by `exp` either way, which
is the property this section is about.

**v0 status: hub, controller and app client all real and tested.** What remains
unbuilt is BLE presentation and mDNS resolution, which a browser cannot do and
which therefore need native code (`src-tauri/`); and none of the three halves
has been run against real hardware, so the end-to-end path is proven in
isolation and unproven at a gate.

## Transports

The redemption messages (`grant.open` / `grant.challenge` / `grant.proof` /
`grant.result`) are transport-agnostic JSON. Two transports are specified; both
carry the identical message layer, so verification code is shared.

### LAN (primary)

Controller advertises mDNS `_lintel._tcp` (TXT: `device=<device_id>`,
`proto=0`) and serves plain HTTP on the advertised port: `POST /grant/open`
(body `grant.open`) → `grant.challenge`; `POST /grant/proof` → `grant.result`.
Plain HTTP is acceptable: every message is Ed25519-signed and single-use; the
transport adds no trust.

### BLE GATT (emergency — no network at all)

For the darkest scenario — no Wi-Fi, no LAN, phone in hand at the gate — the
controller MAY expose a BLE peripheral:

- **Service UUID** `9f0a0001-8f7c-4b62-9d5e-7acc00000001` ("lintel-grant"),
  advertised with local name `lintel-<first 8 hex of device_id>`.
- Characteristics:
  | UUID (`9f0a…`) | Name | Properties |
  | --- | --- | --- |
  | `…0002` | `rx` | Write / Write-without-response — app → controller frames |
  | `…0003` | `tx` | Notify — controller → app frames |
  | `…0004` | `info` | Read — JSON `{v:0, device_id, mtu}` |
- **Framing**: each JSON message is sent as one logical frame, chunked to the
  negotiated ATT MTU: 4-byte little-endian total length, then the UTF-8 JSON
  bytes, split across as many writes/notifications as needed. A new frame on
  `rx` aborts any partial previous frame. Max frame 8 KiB (`frame_too_large`).
- **Sequence**: app writes `grant.open` → controller notifies
  `grant.challenge` → app writes `grant.proof` → controller notifies
  `grant.result`. Same cnonce validity (30 s) and single-use rules; the
  controller drops the connection after result or timeout.
- **Security**: BLE pairing/bonding is NOT used or trusted — the message-layer
  Ed25519 signatures and the pinned-key model carry all authority, exactly as
  on LAN. An attacker with radio access gains nothing beyond what the LAN
  transport already exposes (deny-with-reason responses).
- Advertising SHOULD only be enabled while the gate has power and MAY be
  disabled by `config` (`ble_enabled: false`).
