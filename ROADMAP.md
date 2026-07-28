# Roadmap

> [!NOTE]
> Aql is early. Phase 0 is the only phase that is actually built — and it is a great deal
> more than a foundation. Everything after it is a plan, not a promise. No dates, because
> none of it is scheduled.

Aql is an open-source command centre for the physical world: one hub that owns the devices
around a home or a business. The device model has seven kinds — **camera, lighting, robot,
climate, energy, sensor and access**.

**Access** is the one driven end to end, against a real controller. The engine for the
other six exists now — one device model, a driver seam, and four drivers wired into the
binary (MQTT, which also reaches Zigbee and Z-Wave through a bridge; Modbus TCP; ONVIF;
generic HTTP) — with automations and energy metering on top of it.

The line that matters is no longer "built or not". It is **hardware**: not one of those
drivers has read a real meter, driven a real lamp, or seen a real camera. They are tested
against fakes, loopback servers and an in-process Modbus TCP server, which proves the code
agrees with the protocol as written and proves nothing about the devices in your house.
That is the whole shape of this roadmap now.

---

## Phase 0 — Foundation and the first real module (done)

Phase 0 was always meant to be the app shell plus the operations console. It ended up
being considerably more, because a complete chat-driven **physical access-control system**
was folded into Aql wholesale. That module is not a demo and not a UI shell — it is a
running system with tests, conformance vectors and a cross-module harness, and it is the
reference for how every other device kind should eventually work: a versioned wire
contract, a device that verifies rather than trusts, and an audit trail you can check
after the fact.

**The hub** (`hub/`) — one Go binary, SQLite inside, **112 HTTP routes over 20
migrations, and more than 870 tests green** across 16 packages:

- [x] Accounts, locations, access points, members with roles, invites
- [x] An **instance-admin** operator seat above every account: one-shot claim
      (constant-time, atomic, fail-closed, fully audited), account suspension, user
      disable, runtime limit overrides, cross-account audit
- [x] **The open path** — one choke point every open funnels through: membership,
      account-suspended and user-disabled (fail-closed), open cooldown, per-member and
      per-account hourly caps, per-member and per-location daily quotas. `close` is never
      denied
- [x] **Visitor / temporary access grants** — dated window, optional use cap, revocable,
      refunded when an open is denied by a limit
- [x] **Ed25519-signed commands** with nonce + expiry, and the WebSocket device hub that
      delivers them (with long-poll fallback)
- [x] **Tamper-evident audit** — SHA-256 hash chain over `access_logs` and
      `admin_audit_log`, append-only DB triggers, `GET /v1/admin/audit/verify`, an
      `aql-hub verify-audit` CLI that works against a cold backup, and an admin console
      view that runs the check and states what a passing chain does *not* prove (it is a
      detection control: it cannot see an attacker who edited the database and recomputed
      every hash forward)
- [x] Login brute-force throttles (per-IP and per-account, fail-closed), live per-request
      session revocation, log-out-everywhere (reachable from Settings, not only as an
      endpoint)
- [x] **Chat identity linking** — a member becomes recognisable on a rail by one
      ceremony: the console mints a short-lived code and the member sends it to the bot
      from the account being linked. WhatsApp binds a verified phone number; Telegram,
      Slack and Discord bind a platform account id and use a longer code, because that
      code cannot name the account allowed to spend it. No SMS and no email — this hub
      sends neither. Until this session nothing in production could write either
      identity, so every rail resolved every sender to a non-member and refused every
      open
- [x] **Controller events stored on the hub** — signed events from a controller are
      persisted, deduped on `event_id`, and the access-relevant kinds appended to the
      hash-chained audit log, so an offline emergency open (the one path with no hub in
      the loop) leaves a record. The envelope is kept verbatim so its signature stays
      re-checkable
- [x] **Offline-grant issuance** (`POST /v1/offline-grants`) — same authorization gates as
      a live open, all-or-nothing, fixed 7-day TTL, audited
- [x] Refuses to bind a non-loopback address without `-behind-proxy` (resolution-aware,
      not a string match)

**The controller agent** (`controller/`) — its own Go module, std-lib first, **over 120
tests green**:

- [x] Claim-token pairing that **pins** the hub's signing key permanently
- [x] Fail-closed command verification in a fixed normative order (signature → addressing
      → validity window → replay → lockdown), with a durable nonce store
- [x] 11-step offline-grant verification, transport-agnostic, including weekly windows
- [x] Hand-rolled WebSocket transport and mDNS responder (no external deps)
- [x] LAN HTTP grant transport, advertised over mDNS
- [x] BLE framing codec and session layer, unit-tested at ATT MTUs 23 / 185 / 512

**Contracts and harnesses:**

- [x] `proto/` — pairing, commands, grants, events, acks and webhooks, with **98 checks**
      consumed by the implementations and an independent `verify.mjs` that trusts none of
      them
- [x] `e2e/` — boots the real hub and controller binaries and drives the open path over
      the wire, including adversarial cases
- [x] `e2e-browser/` — Playwright against the real hub binary with the embedded console

**Console and shell:**

- [x] React 19 + Vite console, embedded in the hub via `go:embed`, and wrapped by a
      Tauri v2 desktop shell with a hub picker on first run
- [x] The operations-console views — devices, energy, automations — reading **live state
      from the device engine** (`GET /v1/engine/devices`). The demo dataset is gone
      entirely: every row is an engine device, and a hub with no engine configured says
      so in words rather than showing an empty list that reads as a failed fetch
- [x] A route-parity test that diffs every frontend API call against the hub's real
      registered routes (AST-extracted), and a docs-vs-code feature-claim guard
      (`npm run check:claims`)

> **What the fold changed.** Aql's original Phase 0 was a Tauri + SvelteKit shell with an
> in-memory demo dataset driving Overview / Devices / Energy / Automations. The fold
> replaced that shell with the access module's React console and ported the demo dataset
> into it verbatim, so the same four screens survived with real access data mixed in.
> That fixture has since been deleted — those screens read the device engine now. The
> SvelteKit app itself is gone. Screenshots of that shell were removed from the repository (and its history) rather than left to mislead; the current console is captured in `site/screenshots/`. The old set
> shows the retired shell.

### Finishing Phase 0

Real work, not new features — listed so it isn't mistaken for done.

**Close the emergency-access loop.** The highest-value next piece, because three of its
four parts already exist (the wire contract, the controller's 11-step verification, the
hub's issuance endpoint):

- [x] App-side grant client: requests, stores and refreshes grants, holding them for
      several hubs at once keyed by each hub's pinned Ed25519 key — a URL is not an
      identity, since a home hub is one address on the LAN and another from outside
- [x] App-side presentation over **LAN/mDNS**, with the proof anchored on the
      controller's clock from the challenge rather than the phone's, so a phone whose
      clock is wrong after a blackout still opens the gate
- [ ] App-side presentation over **BLE** — the framing and session layer exist on the
      controller, but nothing in this app can reach a radio, and the UI says so rather
      than implying otherwise
- [ ] **The two halves meeting on real hardware.** Every part now exists and is tested
      in isolation; none of it has been run against a real controller. Until someone
      stands at a gate with the network off, treat this as unproven
- [x] An emergency-access screen that appears when the hub is unreachable and a paired
      controller is in range. All three conditions are observed, not assumed: the hub is
      known unreachable from ordinary traffic (apiFetch reports it; there is no poll, and
      `unknown` before the first request is its own state so a cold start is not an
      emergency), this device actually holds a grant, and a controller answered a probe.
      The probe is `GET /grant/open`, which the LAN server does not route and answers 405
      — the alternatives all cost something, and a liveness check must cost the thing it
      probes nothing. The banner says a controller is *responding*, never that the gate
      will open: the probe carries no signature, so identity is still settled at the gate
      against the controller's pinned hub key
- [ ] Grant revocation semantics beyond "wait for expiry" (currently an accepted v0
      non-goal)

**Hardware the reference controller has never actually touched:**

- [ ] **GPIO relay driver.** `controller/internal/relay/gpio.go` is a `-tags gpio` stub
      whose `Pulse`/`Hold`/`Release` all panic by design; the default build logs instead of
      actuating. No build has ever driven real hardware in this repo's tests
- [ ] **BLE radio validation.** The GATT peripheral glue builds for Linux (BlueZ) and
      Windows (WinRT) behind `-tags ble` — one portable file, since every call is the
      `tinygo.org/x/bluetooth` GATT-server API and the library carries both backings. It
      has never run on hardware on either. darwin returns `ErrUnsupported`: CoreBluetooth
      offers peripheral mode, that library does not bind it, and writing a CGO binding
      that cannot be tested here would be worse than the gap
- [ ] **Two signed command types the hub still cannot send.** `proto/commands.md` defines
      eight; the controller implements and conformance-tests all eight. `config` and
      `hold` now have senders. Standalone `ping` and — the serious one — `repair` do not.
      `repair` is the recovery path for a leaked or rotated hub signing key, and doing it
      properly is a programme rather than a feature: the hub needs two-key retention and
      per-controller ack tracking (switching the signing key while one controller is
      offline strands it until a factory reset), and the blast radius reaches past
      controllers to every phone holding an offline grant, since those pin the hub key too
      and the app already treats a change as a re-enrolment event. (`lockdown`/`lift` are
      deliberately controller-local — `offline_grants.go` says so — and are NOT part of
      this gap)
- [ ] Controller position/tamper sensors return static values

**Console screens ahead of their backend** (tracked mechanically by the route-parity test):

- [x] **Scoped API tokens** — hashed at rest, scope enforced by a route wrapper rather
      than a handler check, bounded by the holder's membership at the time of use
- [x] **Outbound webhooks** — HMAC-signed, with the target re-validated against SSRF
      immediately before every delivery, because DNS belongs to whoever owns the name
- [x] **Password reset** (forgot / reset / update)
- [ ] Analytics and per-access-point maintenance
- [ ] Google OAuth
- [x] **2FA (TOTP)** — opt-in per user, enrol-prove-activate so a half-enrolled secret
      never gates login, ±1 step of skew, replay refused by a monotonic last-step, and ten
      single-use recovery codes minted in the same transaction as activation so 2FA is
      never on without an escape hatch
- [x] `aql-hub 2fa disable -user NAME -reason TEXT`, so the last-resort recovery for
      someone who lost both their authenticator and their recovery codes is not a manual
      SQL update. No claim is required and none can be — the authority is possession of
      the data directory, which is shell access to the host and already permits more.
      `-reason` is mandatory and the audit entry is written in the same transaction as
      the disable, so a second factor cannot come off without a record saying why. The
      path is pinned out of the HTTP surface by a test: serving it would turn "holds the
      host" into "holds a session", which is the reduction the second factor exists to
      prevent

---

## Phase 1 — Device engine (built, unproven against hardware)

Where "one hub owns everything" stops being a sentence. This section described an empty
repository for a long time; it is not one now. Four drivers ship, wired into the binary,
and none has met physical hardware.

- [x] Decide where it lives — the Go hub (`hub/internal/devices`), which already owns
      persistence, audit and the always-on box. The Rust core in `src-tauri/` was the
      alternative and is not used for this
- [x] Persistence: **deliberately none**, and that is the answer rather than an unfinished
      item. The registry is rebuilt at every start from the device config file, because a
      devices table would be a second source of truth that disagrees with the file the
      moment somebody edits it while the hub is down. Automations and energy DO persist —
      they hold state the hub itself created; a device list is a restatement of a file. The
      full reasoning, including why a "device disappeared" roster was rejected, is in
      `hub/internal/devices/registry.go` beside the type it governs
- [x] One internal device model — id, kind, zone, state, commands, telemetry — that the
      console renders generically, with no protocol-specific code
- [x] Driver/adapter seam so a protocol can be added without touching the console. Every
      driver below satisfies one `Driver` interface and the console renders all of them
      with no protocol-specific code:
  - [ ] Matter — needs a certified device and a stack to develop against
  - [x] MQTT — wired into the binary as `-device-drivers mqtt`
  - [x] Zigbee / Z-Wave via a bridge (`zigbee2mqtt`, `zwave-js-ui`) over MQTT. No radio
        in the hub; a per-metric JSON field selector reads the bridge's per-device object.
        Not yet exercised against physical hardware.
  - [x] ONVIF (IP cameras)
  - [x] Modbus TCP — read-only, and structurally so: config accepts only
        capabilities whose whole verb set is `TierRead`, so the registry can never
        route an actuating verb to one. No RTU (needs a serial port, which cannot
        be tested); the common serial deployment is already reachable through a
        TCP-to-RTU bridge
  - [x] Generic HTTP/webhook
- [x] ONVIF probe (WS-Discovery) and MQTT bridge scan — `mqtt.Scan` reads
      zigbee2mqtt's retained `bridge/devices` announcement and proposes candidates
      with their evidence. It writes no config and registers nothing: a capability
      decides which verbs the engine will route, so that stays a human's call
- [x] mDNS controller discovery — the controller has advertised `_lintel._tcp` for a
      while and nothing listened; `hub/internal/discovery` is the other half, served at
      `POST /v1/accounts/{id}/discover/controllers`. It pairs nothing: mDNS is
      unauthenticated, so a found controller is an address to check and a claim token is
      still typed by a human
- [ ] SSDP/UPnP discovery, and Zigbee pairing (turning join on is an actuation with a real
      security consequence, not a discovery side effect)
- [x] **Per-device ownership.** A device discovered from a broker, a PLC or an ONVIF
      probe carries no account, so ownership cannot be inferred — it is ASSERTED. An
      account admin claims a device the engine actually reports, first claim wins
      (enforced by a primary key, not a check-then-insert two admins would race through),
      a second account's claim is refused rather than allowed to take over, and release is
      how a device legitimately changes hands. On a multi-account hub a caller sees and
      drives exactly what their accounts have claimed; an unclaimed device belongs to
      nobody, and "nobody owns it" does not mean "anybody may drive it". The
      single-household deployment claims nothing and is unchanged. Engine *health* keeps
      the hub-wide gate deliberately: it reports driver state, not device state, and there
      is no honest way to show a member the half of an MQTT connection that carries their
      lamp
- [ ] A console surface for claiming — the routes exist (`GET
      /v1/accounts/{id}/devices/claimable`, `POST|DELETE .../devices/claims`) and the
      Devices screen does not yet offer them, so on a multi-account hub claiming is
      currently an API call
- [x] **Automations check device ownership.** A rule named a device key and nothing
      verified it belonged to the rule's account — not at save, not at firing — so on a
      multi-account hub an admin of one account could write a rule that drove another
      account's claimed device. The tier ceiling bounded what that could do
      (`MaxActionTier = TierConsequential` stops entry and hazardous motion) but bounded
      is not prevented. The check now runs in the execution path for the same reason the
      tier check does — `engine.go` is explicit that a stored rule "carries no authority
      of its own", and a device claimed when a rule was written may have been released
      since. The save-time refusal is a courtesy so an admin is told immediately rather
      than saving a rule that is refused every time it fires. Unclaimed devices stay
      drivable (a one-household hub claims nothing); a failed lookup refuses, because not
      knowing whose a device is, is not a licence to actuate it. The refusal names neither
      the owning account nor that one exists
- [ ] Bring the existing access module onto the same internal device model, so `access` is
      one kind among seven rather than a parallel stack
- [x] Extend the input surfaces' intent vocabulary past `open`/`close` — `hold` now
      reaches the gate from chat and the console. Adding a third verb to a fail-closed
      type is where its safety property breaks if it is going to: every `GateVerb` method
      was "if explicitly open, do the open thing, else the close thing", and a careless
      third branch inverts that so an unset verb lands on the MOST permissive one. Hold is
      reachable only on an explicit match, in all six mappings, and an unset verb still
      resolves to close everywhere. In the text matcher hold is checked BEFORE open, which
      is a correctness requirement rather than a preference: every natural phrasing ("hold
      the gate open", "keep it open") contains the word "open"
- [ ] Extend it further, to the other device classes. Chat still reaches only the access
      module; the engine's verbs (`on`/`off`/`set`/`start`…) are recognised and honestly
      refused (`channels/unsupported.go`) rather than driven

---

## Phase 2 — Local persistence & secrets (partly real)

- [x] SQLite for state, history and configuration — shipped with the hub (19 migrations,
      42 tables), one file to back up, pure-Go driver so it cross-compiles to a Pi
- [ ] Extend that schema to device state, telemetry and history once Phase 1 exists
- [ ] **OS-keychain-backed credential vault** for device and service secrets, scoped per
      device, so nothing sits in plaintext in the SQLite file or a config file. Not built:
      there is no keychain or keyring code anywhere in the repository today. The hub's own
      signing key and JWT secret currently live unencrypted in its data directory

---

## Phase 3 — Automations (built, unproven against hardware)

- [x] A real `trigger → condition → action` engine over live device state
      (`hub/internal/automations/`), managed over `/v1/accounts/{id}/automations`
- [x] Scheduling, conditions and run history, persisted; the scheduler survives restart
- [x] Fail-closed behaviour on ambiguous sensor state for anything that actuates
- [x] A compile-time `MaxActionTier` ceiling on unattended actuation, checked on the save
      path and again immediately before the driver call. Every access verb is above it, so
      an automation cannot open a gate — structural, not a setting
- [x] Online time-window rules for access (`hub/internal/store/timewindows.go`) and
      geofence rules, enforced inside the open path's choke point rather than by the
      automations engine, which is deliberately kept out of that path
- [ ] Any rule that has actually driven physical hardware — the only devices exercised so
      far are the mock driver's
- [x] The console's automations screen reading live rules instead of the demo dataset

---

## Phase 4 — Energy metering (built, unproven against hardware)

- [x] Meter ingestion through the device engine, with counter wrap-vs-reset detection
- [x] Historical rollups (hourly / daily / monthly) in SQLite
- [x] Source-mix accounting (solar / grid / battery) from live readings
- [x] A read API (`/v1/accounts/{id}/energy/{channels,series,mix}`) that carries every
      honesty field — quality, estimated share, coverage vs expected, `complete`,
      `attributed` — rather than flattening them into a confident number. An unmeasured
      hour is `null`, never `0`
- [ ] A real meter. None of this has been read from physical hardware
- [ ] Inverter ingestion specifically — the model covers it, no driver speaks to one
- [x] The console's energy screen reading live buckets instead of the demo 24h chart

---

## Phase 5 — Security & bots (camera reachability built; pixels are not)

- [x] ONVIF discovery and stream-address resolution (`hub/internal/devices/camera/`)
- [x] RTSP reachability probe (`VerifyStream`) — DESCRIBE, digest/basic auth, SDP parse, so
      the hub reports what a camera actually streams instead of an address it never touched
- [x] RTSP media-flow probe (`VerifyMediaFlow`) — SETUP over interleaved TCP, PLAY, count
      RTP packets, TEARDOWN. Catches the camera that describes a good stream and sends
      nothing, which DESCRIBE cannot. Counts packets and decodes none; holds a session, so
      it is opt-in and always tears down. Both tested against an in-process RTSP server
      that streams real interleaved framing; neither has met a real camera
- [x] The retention design — [`docs/CAMERA-RETENTION.md`](docs/CAMERA-RETENTION.md). Where
      clips live, how long they last, who may watch, what a full disk does, and what a
      resident is told when retention drops the evening they cared about. Design only; no
      code implements it
- [ ] Camera live view and recording. **H.264 depacketization now exists** — RFC 6184
      single-NAL, STAP-A and FU-A, emitting Annex-B, with the failure modes that matter
      covered explicitly: a lost middle fragment discards the partial NAL rather than
      emitting it half-formed, a continuation with no start bit is dropped rather than
      given a fabricated header, and every length read off the wire is bounds-checked
      (STAP-A's inner sizes are attacker-controlled). Two fuzz targets, ~590k execs clean.
      What that does NOT prove is stated plainly: the vectors were written from the RFC,
      so they establish that this code agrees with our reading of the spec, not that it
      agrees with a real camera. The fMP4 writer, and validation against actual hardware,
      remain. The retention worker, the `camera:view` permission and the viewer do not — but building a retention policy for footage that
      does not exist yet is the wrong order
- [ ] Robot control — mowers, cleaning, patrol — beyond a static status row
- [ ] Alerting tied to real sensor and camera events
- [ ] Rate-limiting and scoping on movement commands, so a compromised client cannot drive
      a machine into a person

---

## Phase 6 — Reachability & remote access (partly real)

- [x] LAN-first control, always — true today for the console and for controllers
- [x] Zero-ingress operation, real today via outbound-dialling controllers and a chat rail
      that can dial out rather than receive webhooks
- [ ] A considered story for reaching your hub from outside the LAN beyond "run a tunnel",
      off by default, with its own threat-model addendum
- [ ] Chat rails move to **[Ephor](https://github.com/vul-os/ephor)**, the coordinator
      implementation in the KOTVA family, so the hub consumes a rail terminator instead of
      implementing adapters. In progress; the adapters currently in `hub/internal/
      channels/` are transitional and neither half of that move is finished

---

## Phase 7 — Mobile packaging (not built)

- [ ] iOS/Android builds via Tauri mobile
- [ ] Mobile layout passes on the console
- [ ] The emergency-access screen from "Finishing Phase 0" is the reason mobile matters
      most

---

## Phase 8 — Zana hardware integration (not built)

- [ ] First-class support for [Zana](https://github.com/vul-os/zana) open-hardware devices
      (mowers, sensor nodes, security/cleaning bots) as reference implementations of the
      driver seam
- [ ] Zana stays optional — Aql controls any hardware; Zana devices just work best with it

---

## Ecosystem

- **Aql** (this repo) — the software command centre
- **[Zana](https://github.com/vul-os/zana)** — open-hardware designs for the devices Aql is
  meant to control
- **[Ephor](https://github.com/vul-os/ephor)** — the coordinator/gateway implementation in
  the KOTVA family, and where Aql's chat rail is heading
