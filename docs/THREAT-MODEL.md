# Threat Model

Aql is a self-hosted hub that **actuates physical things**. Today the only device class
it actually drives is a gate/door/barrier controller, reached through a chat message, a
web console, or (partially) an offline grant. That combination — local authority plus
physical actuation plus a third-party chat rail — is what this document models.

This is a *mixed* document, and the mix is the point:

- **Sections marked "Shipped"** describe controls that exist in code today and can be
  read, tested and attacked.
- **Sections marked "Target"** describe the intended posture for parts of Aql that are
  not built (the device engine, automations, energy, the phone app's half of the offline
  grant flow). They are design intent, not a security claim.

---

## 0. Read this first: the chat rail is not private

**Status: Shipped, and it is the single largest exposure in the system.**

A resident texting `open` to a gate is trusting **Meta, Slack or Telegram** with that
message, not just their hub. There is no way around this, and the rest of this document
would be dishonest if it were buried further down.

Concretely, on every chat-initiated open:

- The message travels over the platform's infrastructure. The hub receives it as a
  **webhook payload the platform sent**, or reads it off a **socket the hub dialled out
  to the platform**. Either way the platform originated it.
- The hub **must read the plaintext** to act on it. This is not an end-to-end-encrypted
  system and cannot become one while chat is an input surface: a message nobody can read
  is a message nobody can act on.
- The platform therefore learns, at minimum, that this number or member id messaged this
  business at this time, and the content of the message — which for Aql is usually the
  literal word `open`. WhatsApp's transport is E2EE between endpoints, but **your hub is
  one of the endpoints**, and Meta's Cloud API is the delivery mechanism; Meta bills per
  conversation precisely because it brokers them.
- The hub's **reply** — "Gate opened · Main entrance" — goes back out through the same
  platform.
- Practical consequence: **a chat platform can observe an occupancy and movement pattern
  for your property.** Who opens which gate, and when, is exactly the kind of metadata a
  chat platform is well positioned to accumulate.

What the platform still **cannot** do:

- **It cannot forge an open.** The command that reaches the controller is Ed25519-signed
  by the hub and verified against a key the controller pinned at pairing. A compromised
  or malicious platform can deliver a message; it cannot manufacture a valid command.
- **It cannot silently rewrite history.** Every open, denial and admin action is written
  to a hash-chained, append-only audit log on your hub.
- **It cannot be in the path at all if you don't put it there.** The web console path and
  the (partially built) offline LAN/BLE grant path involve no chat platform.

**So the honest framing is:** Aql has no cloud *broker* — nothing of ours sits between
you and your devices, there is no account with us, and no telemetry leaves the box. But
Aql *does* have an optional third-party **input rail**, and when you use it you accept
that platform's visibility over that rail. Those are different claims, and this document
keeps them apart deliberately.

**In progress:** the chat adapters (WhatsApp, Slack, Telegram) are being lifted out of
Aql's hub and into [Ephor](https://github.com/vul-os/ephor), a separate, swappable
legacy-rail adapter — not shipped yet. That move relocates *where* the plaintext is
handled (Ephor terminates the rail and hands the hub an authorised command instead of
the hub terminating it directly); it does not remove the exposure described above. A
third party still sees the message either way.

### Reducing chat-rail exposure

- **Use Slack Socket Mode** if the workspace shape fits: the hub dials out and there is
  no inbound webhook or public URL at all. The platform still sees the message — this
  reduces *network* exposure, not *platform* exposure.
- **Use the web console** for anything you don't want a platform to see. It is unlimited
  and always available.
- **Attach fewer channels.** Each channel is another party in the loop.
- **Do not use the unofficial WhatsApp bridge engine.** It routes your traffic through a
  reverse-engineered client, violates KOTVA §26.8.2's unconditional MUST NOT, and risks
  your number being banned. See
  [`site/docs/linking-whatsapp.md`](../site/docs/linking-whatsapp.md) and
  [`KOTVA-ALIGNMENT.md`](./KOTVA-ALIGNMENT.md).

---

## 1. Scope and trust model

### Multi-account is in scope (it used to be scoped out — that was wrong)

**Status: Shipped.** The hub is genuinely multi-tenant. It models accounts, locations,
access points, members with roles (owner / account admin / member / guest), and an
**instance admin** seat that sits above every account. One operator can host several
estates on one binary. Tenant isolation is therefore a live security property, not a
future concern.

| Component | Trust level |
|---|---|
| The hub (the box) | Full authority. Owns the Ed25519 signing key, every account's data, and command issuance. |
| Instance admin | Trusted, but watched: every admin action and every *denied* admin attempt is written to an append-only trail. Cannot disable itself or the last remaining admin. |
| Account owner / admin | Trusted only within their own account. Cross-account reads are impossible for them, enforced by the same scoping machinery that serves admin views. |
| Member / guest | Can open what they were granted, subject to rate limits and quotas. Guests are time-bound. |
| Web / desktop clients | Untrusted until authenticated to the hub. Views and controllers, never sources of truth. |
| Chat platforms (Meta, Slack, Telegram) | **Untrusted, and unavoidably in the loop for chat opens.** They see plaintext and can withhold or delay delivery. They cannot forge a signed command. See §0. |
| Controllers | Semi-trusted hardware at the perimeter. They verify content, not network position. A stolen controller's key is revocable server-side; it never learns another controller's key. |
| LAN | Semi-trusted reachability boundary, never a trust boundary for control actions. |
| WAN / remote access | Untrusted. The hub refuses to bind a non-loopback address unless the operator declares TLS is terminated upstream. |
| Third-party device firmware (cameras, sensors, bots) | Untrusted. *Target* — no such devices are integrated yet. |
| Zana hardware | Held to the same untrusted-device bar as any other hardware. No special trust for being the companion line. |

### Tenant isolation

**Status: Shipped.** Isolation is app-layer org scoping applied on every query in the Go
hub (the retired Postgres reference enforced the same boundary with forced row-level
security). Rate-limit and quota counters are scoped the same way, so tenants can neither
inspect nor exhaust each other's counters. Instance-admin cross-account reads are an
explicit, audited context evaluated by the *same* scoping rules — tenant isolation is
never switched off so that an admin view can work.

---

## 2. What is genuinely local

Keeping this separate from §0 is the whole point of this document. These claims involve
no third party at all:

| Property | Status |
|---|---|
| **No account with us.** There is no Aql service to sign up for, no license check, no phone-home. | Shipped |
| **No telemetry.** The binaries emit no usage data anywhere. | Shipped |
| **No cloud broker in the command path.** The hub signs commands itself; controllers dial out to *your* hub and verify against *your* pinned key. | Shipped |
| **The box is the root of authority.** Nothing off-box can authorise an open. | Shipped |
| **The audit log lives on your disk**, hash-chained and append-only, verifiable against a cold backup with no server running. | Shipped |
| **Offline LAN/BLE grants** — a controller can verify a hub-signed grant with no internet, no hub reachable, and no platform involved. | Controller side and hub issuance shipped and conformance-tested; **the phone app's half does not exist**, so no resident can use this path today |
| **Keeps working offline.** Controllers keep verifying and actuating while the hub is unreachable; queued events reconcile later. | Shipped |

---

## 3. Command integrity

**Status: Shipped.**

- Every controller command is Ed25519-signed by the hub, carries a random nonce, and
  expires seconds after issue.
- The controller learned the hub's public key exactly once, at pairing, and **pins** it.
  A hostile network, a DNS hijack, or a malicious tunnel provider cannot forge an open —
  at worst they delay traffic.
- Captured packets are paperweights: the nonce window rejects replays and the expiry
  rejects late delivery.
- Each controller has its own keypair, generated on first boot; the private key never
  leaves the device. Compromising one device does not compromise another.
- The wire contracts (pairing, commands, grants, events) are versioned and covered by
  conformance vectors in [`proto/`](../proto/), which both the hub and the controller are
  tested against.

**The ceiling:** the hub's signing key (`gateway_ed25519.seed`) sits unencrypted at mode
`0600` in the data directory. Steal it and you can forge signed opens for every access
point that hub manages, indefinitely, until every controller is re-paired. Backups of the
data directory therefore carry the same weight as the key itself.

---

## 4. Audit

**Status: Shipped, with a stated ceiling.**

`access_logs` and `admin_audit_log` are hash-chained — each row's hash covers its own
content plus the previous row's hash — and database triggers reject direct `UPDATE` and
`DELETE` against both. The chain is verifiable live (`GET /v1/admin/audit/verify`) and
offline against a cold backup (`gateway verify-audit`), which is the more important form:
you can ask "was this tampered with?" of a copy sitting on a shelf.

**Be precise about what that buys.** It does not stop an attacker who edits the SQLite
file directly *and* recomputes every downstream hash — that attacker rewrites history
undetectably. What it does is turn *silent* tampering into *detectable* tampering for
anyone who doesn't do that work, and turn an unanswerable question into a checkable one.
It is a detection control, not a prevention control, and the test suite proves the
boundary by tampering a row, recomputing the chain the way a careful attacker would, and
confirming verification reports clean.

---

## 5. What an attacker gets, by position

### Attacker who controls a chat-platform account, or the platform itself

See §0. They see plaintext and metadata over that rail, and they can withhold or delay
messages — a denial of service on that channel, which is exactly why the docs insist on a
second channel or the web console as a fallback. They **cannot** forge a signed command,
mint a grant, or edit your audit log through the application.

### Attacker on the LAN (no hub access)

- Can see that a controller advertises `_lintel._tcp` for the LAN grant transport, and
  that a hub serves HTTP on a port. Minor information leakage.
- Cannot issue commands: the controller verifies signatures, not network position, and
  the hub requires authentication.
- Can attempt to impersonate a device during pairing. Pairing is claim-token-gated and
  one-shot, but a leaked claim token is a real risk — treat claim tokens as secrets and
  let them expire.

### Attacker with an authenticated session

- Bounded by their role and account. Every open path — console, API, WhatsApp, Slack,
  Telegram — funnels through one enforcement point applying membership checks, rate
  limits and quotas, so no channel can be chosen to bypass them.
- Brute-forcing their way in is throttled per-IP and per-account, fail-closed, on
  `login` / `register` / `refresh` / `admin-claim`.
- Revocation is live: every authenticated request re-reads the user row, so a disabled
  user's still-valid token stops working on their very next request.

### Attacker with access to the box

Game over for that box: the signing key, every account's data, the SQLite file and its
audit triggers. This is inherent to "the box is the authority", and Aql architecturally
cannot defend against it without reintroducing the cloud broker it exists to avoid. The
mitigation is standard host hardening — out of Aql's scope to enforce, in scope to state.

### Attacker who compromises a single connected device

**Target, not shipped.** No non-controller devices are integrated yet. When they are, a
compromised camera or sensor must not be able to pivot into controlling unrelated devices.
Per-device credential scoping is the first step; command-level segmentation is future
work.

---

## 6. Credentials and secrets

**Shipped:** the hub's data directory holds `lintel.db`, `gateway_ed25519.seed` (the
command signing key) and `jwt_secret` (the session HMAC key), all raw and unencrypted at
mode `0600`. Channel credentials live in the environment or an `.env`. A plain `tar czf`
of the data directory captures the database and both keys in one unencrypted archive —
encrypt that archive at rest and restrict who can read it.

**Target:** device credentials for the unbuilt device engine (camera passwords, RTSP/API
tokens, third-party hub keys) are intended to live in the **OS keychain**, scoped per
device rather than as one shared blob, write-only from the UI's perspective, and never
synced between boxes. None of that exists yet.

---

## 7. Physical-actuation concerns

Aql actuates the physical world, so some commands need care a dashboard would not:

- **Aql must never be the only way out of a building.** Fire and building codes require
  code-compliant fail-safe egress hardware regardless of what any access-control system
  does. Aql is designed to run **in parallel** with that hardware, never in series and
  never as a replacement. The reference controller's relay driver is *specified*
  fail-safe (normally-open, line drops on process exit or panic), but the `-tags gpio`
  driver is a documented scaffold that has **not been hardware-validated**.
- **Rate limits fail *open* on purpose.** If the limiter's counter store errors, the open
  is allowed and the audit entry is tagged `rate_limit_check_failed`. Locking residents
  out because a bookkeeping table hiccuped is the worse physical failure. Visibility is
  preserved; enforcement yields. Contrast with webhook signature checks and the login
  throttles, which fail **closed**.
- **`close` is never denied** — not by suspension, quota or rate limit. Closing is the
  safe direction.
- **Target:** automations that chain physical actions must fail closed on ambiguous
  sensor state, and robot/fleet commands must be rate-limited and scoped. No automation
  runtime or robot control path exists, so neither control exists either.

---

## 8. Not built, therefore not defended

Stated plainly so nobody mistakes design intent for a control:

- **No Matter driver, and no native Zigbee or Z-Wave radio.** Three drivers do ship —
  HTTP/webhook, ONVIF camera, MQTT — and Zigbee/Z-Wave hardware is reachable through a
  bridge (`zigbee2mqtt`, `zwave-js-ui`) that republishes onto MQTT. Those are a real
  onboarding surface and are defended: every driver validates its whole config at
  construction, capabilities are a closed catalogue, and a verb above the engine's tier
  ceiling is refused rather than attempted. A Modbus `Driver` does not exist (the
  frame/decode layer does), and there is no device discovery — every device is configured
  by hand, which is a smaller attack surface than pairing, deliberately.
- **No HTTP surface for automations or energy.** Both runtimes exist, are tested, and run
  as background workers when configured (`internal/automations/`, `internal/energy/`).
  Neither is reachable over the API: there is no endpoint to create a rule or read a
  meter. So an automation cannot be created, altered or triggered by a request — which
  removes a threat surface rather than defending one, and is not a shipped feature.
- No phone-side offline-grant client — the emergency path does not run end to end.
- **Geofencing and time-window rules do ship** and are enforced on the open path
  (`internal/httpapi/geofence.go`, `timewindows.go`). They are stated here rather than
  omitted because an earlier revision of this section listed them as not built, which is
  a worse error than the reverse: it tells a reader not to look for a bypass in code that
  is live.
- No 2FA on hub accounts, and **no in-band recovery for a lost sole instance-admin
  password**. Regaining the seat requires direct database access, which is also why "who
  can touch the host" *is* your real admin list. Grant a second admin early.
- No outbound webhooks and no scoped API tokens — integrations authenticate as a user.

---

## 9. Residual risks (accepted, by design)

- **The chat rail's platform visibility.** Accepted as the price of the input surface
  people actually use. Mitigated only by choosing not to use it (§0).
- **A fully compromised box has full authority.** No remote kill-switch, no vendor-side
  revocation — that would reintroduce the cloud dependency Aql exists to avoid.
- **Third-party hardware may be untrustworthy.** Aql's job is to contain blast radius,
  not to attest to vendor firmware. *Target* — there is no blast-radius containment yet
  because there are no such devices yet.
- **LAN is a reachability boundary, not a trust boundary.** The hub's control plane
  enforces that with authentication; controllers enforce it with signature verification.
- **Audit tampering by a host-level attacker is detectable at best**, not preventable.

---

## Reporting

See [SECURITY.md](../SECURITY.md). Report privately; do not open a public issue for
anything exploitable. Given the physical-safety angle, please allow reasonable time for
operators to update before publishing details.
