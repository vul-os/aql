# Threat Model

Aql is a self-hosted hub that **actuates physical things**. Today the only device class
it actually drives is a gate/door/barrier controller, reached through a chat message, a
web console, or (partially) an offline grant. That combination — local authority plus
physical actuation plus a third-party chat rail — is what this document models.

**How much of this is machine-checked, and how much is prose.** Three claims here are
guarded by `npm run check:claims`, which fails the build if the quoted sentence stops
appearing — the offline-grant client, the automations HTTP surface, and the energy poller.
Everything else is prose, verified when written and unguarded after. That distinction is
worth stating because this document has drifted before, in both directions: it has
described shipped subsystems as unbuilt (which tells a reviewer not to look for a bypass
in live code — §8 says so about geofencing, and it happened again to the device engine,
automations, energy and the phone-side grant client), and it once said automations had no
HTTP surface while eight account-scoped routes shipped, one of which fires a rule
synchronously. When a claim here matters to a decision you are making, read the code.

This is a *mixed* document, and the mix is the point:

- **Sections marked "Shipped"** describe controls that exist in code today and can be
  read, tested and attacked.
- **Sections marked "Target"** describe the intended posture for parts of Aql that are
  not built — today that is the credential vault (§6) and the parts named in §8. It is a
  shorter list than it was: the device engine, the automations runtime, energy metering
  and the phone's half of the offline grant flow have all since shipped, and §8 says what
  each of them is and is not defended against. They are design intent, not a security
  claim.

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
  the offline LAN grant path — which runs end to end, though it has never met real
  hardware — involve no chat platform. The BLE variant of that path is controller-only.

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
| **Offline LAN grants** — a controller can verify a hub-signed grant with no internet, no hub reachable, and no platform involved. | Shipped end to end over LAN/mDNS: hub issuance, the controller's 11-step verification, and the phone's half — requesting, holding and presenting a grant, with the proof anchored on the controller's clock rather than the phone's. **No part of it has met real hardware**, and the BLE path is controller-only: no browser can reach a radio, and the app says so rather than implying otherwise |
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

**Target:** device credentials for the device engine (camera passwords, RTSP/API
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
- **The hold watchdog bounds continuous energised time, not one latch.** `MaxHold`
  de-energises a held relay, and after it fires a new hold is refused for the same
  duration. Without that cooldown the bound was defeatable by repetition: each `hold`
  command re-latched with a fresh watchdog, so a retrying client or a misfiring
  automation could keep a gate open indefinitely, dropping it only for the gap between
  commands. A signed command is needed to reach it, so this was never an
  unauthenticated attack — but a last-resort bound that the layer above can defeat is
  not a bound.
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

- **No Matter driver, and no native Zigbee or Z-Wave radio.** Four drivers ship —
  HTTP/webhook, ONVIF camera, MQTT and Modbus TCP — and Zigbee/Z-Wave hardware is
  reachable through a bridge (`zigbee2mqtt`, `zwave-js-ui`) that republishes onto MQTT.
  Those are a real onboarding surface and are defended: every driver validates its whole
  config at construction, capabilities are a closed catalogue, and a verb above the
  engine's tier ceiling is refused rather than attempted. Modbus is read-only
  *structurally* — its config accepts only capabilities whose entire verb set is
  `TierRead`, verified against the catalogue rather than an allowlist — so the registry
  cannot route an actuating verb to one. Discovery exists (MQTT bridge scan, ONVIF
  WS-Discovery, mDNS for controllers) but **registers nothing**: it proposes candidates
  with their evidence and a human decides, because the capability a device is given is
  what decides which verbs the engine will route to it.

- **The device engine has no tenancy.** A driver discovers devices from a broker, a PLC
  or an ONVIF probe, and none of those carries an account, so a device cannot say whose
  it is. This was worse than it sounds until recently: all four engine routes were
  authenticated only, so on a hub serving more than one account any signed-in member of
  any account could enumerate every device on the hub, actuate a reversible one, and —
  with the `confirm` flag, which is a deliberateness check and never was a permission —
  start a mower belonging to someone else. That was demonstrated against the mock driver,
  not merely inferred from the routes.

  Ownership is now recorded rather than inferred (`0021_device_ownership.sql`). An
  account admin CLAIMS a device the engine actually reports; first claim wins, enforced by
  a primary key rather than a check-then-insert two admins would race through; a second
  account's claim is refused rather than allowed to take over; and release is how a device
  changes hands. On a multi-account hub a caller sees and drives exactly what their
  accounts have claimed. An unclaimed device belongs to nobody, and "nobody owns it" is
  not "anybody may drive it" — that equivalence was the original hole.

  Two deliberate limits. The single-household deployment claims nothing and is unchanged:
  one account means "everyone on this hub" and "everyone in this account" are the same
  people. And engine *health* keeps the hub-wide gate, because it reports DRIVER state —
  is the broker connected, is the PLC answering — which is a property of the hub's
  plumbing, not of any one device; there is no honest way to show a member the half of an
  MQTT connection that carries their lamp.

  What a claim is NOT is proof. Nobody can demonstrate a lamp is theirs; they can only say
  so first, and be recorded doing it. That is the same trust-on-first-use shape as
  controller pairing, and it is safe for the same reason: the first assertion is
  deliberate and audited, and every later one is refused.
- **Automations and energy DO have an HTTP surface, and it is defended rather than
  absent.** An earlier revision of this bullet said the opposite — *"there is no endpoint
  to create a rule or read a meter … an automation cannot be created, altered or triggered
  by a request"* — and every clause of that was false. Eight automation routes and three
  energy routes ship, account-scoped: create, update, delete, enable/disable, list, run
  history, and `POST /v1/accounts/{id}/automations/{ruleID}/run`, which fires a rule
  **synchronously**. This is the error the geofencing bullet below warns about, in its
  worst form: telling a reviewer there is no surface here stops them looking at an
  actuation endpoint.

  What is true is the defence, and it is layered:

  - Every route is `requireAuth` **and** `requireAutomationsAdmin` — account membership
    resolved server-side, then an admin-role check. A member cannot reach any of them.
  - `MaxActionTier` (`internal/automations/automations.go:65`) is a compile-time ceiling on
    what an unattended rule may actuate, checked on the save path and again immediately
    before the driver call. Every access verb in the catalogue sits above it, so **no
    automation can open a gate** — including via `/run`. That is structural, not a setting.
  - A refused run is a 200 carrying a refusal, not an error, so a cooldown or an unmet
    condition cannot be mistaken for the hub being unreachable.

  What remains genuinely unproven is hardware: the only devices any rule has driven are the
  mock driver's.
- **The phone-side offline-grant client does ship**, over LAN/mDNS: it requests, holds and
  presents a grant, anchoring the proof on the controller's clock rather than the phone's.
  It is stated here for the same reason geofencing is, two bullets down — an earlier
  revision listed it as absent, and telling a reader an emergency path cannot be exercised
  is exactly the error that stops them looking at it. What is still true: **it has never
  met real hardware**, and there is no BLE half, because no browser can reach a radio.
- **Geofencing and time-window rules do ship** and are enforced on the open path
  (`internal/httpapi/geofence.go`, `timewindows.go`). They are stated here rather than
  omitted because an earlier revision of this section listed them as not built, which is
  a worse error than the reverse: it tells a reader not to look for a bypass in code that
  is live.
- **No in-band recovery for a sole instance-admin who loses both their password and their
  recovery codes.** 2FA does ship (TOTP, opt-in per user, ten single-use recovery codes
  shown once at activation), and so does password reset — but the last resort on a
  self-hosted box is still direct database access, which is why "who can touch the host"
  *is* your real admin list. Grant a second admin early.
- Outbound webhooks and scoped API tokens **do** ship. A webhook is a standing instruction
  to POST from inside your network, so treat configuring one as a privileged act: the hub
  refuses private, loopback, link-local and CGNAT targets unless `allow_private` is set,
  and re-checks against a fresh resolution before every delivery
  ([`proto/WEBHOOK-PROFILE.md`](../proto/WEBHOOK-PROFILE.md) §6, including the residual
  DNS-rebinding window it does *not* close).

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
