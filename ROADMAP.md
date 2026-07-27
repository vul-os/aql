# Roadmap

> [!NOTE]
> Aql is early. Phase 0 is the only phase that is actually built — and it is a great deal
> more than a foundation. Everything after it is a plan, not a promise. No dates, because
> none of it is scheduled.

Aql is an open-source command centre for the physical world: one hub that owns the devices
around a home or a business. The device model has seven kinds — **camera, lighting, robot,
climate, energy, sensor and access**. Exactly one of them, **access**, is driven end to end
today. The engine that would drive the other six does not exist yet. That is the whole
shape of this roadmap.

---

## Phase 0 — Foundation and the first real module (done)

Phase 0 was always meant to be the app shell plus the operations console. It ended up
being considerably more, because a complete chat-driven **physical access-control system**
was folded into Aql wholesale. That module is not a demo and not a UI shell — it is a
running system with tests, conformance vectors and a cross-module harness, and it is the
reference for how every other device kind should eventually work: a versioned wire
contract, a device that verifies rather than trusts, and an audit trail you can check
after the fact.

**The hub** (`gateway/`) — one Go binary, SQLite inside, **60 HTTP routes, 219 tests
green** across 8 packages:

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
      `admin_audit_log`, append-only DB triggers, `GET /v1/admin/audit/verify` and a
      `gateway verify-audit` CLI that works against a cold backup
- [x] Login brute-force throttles (per-IP and per-account, fail-closed), live per-request
      session revocation, log-out-everywhere
- [x] **Offline-grant issuance** (`POST /v1/offline-grants`) — same authorization gates as
      a live open, all-or-nothing, fixed 7-day TTL, audited
- [x] Refuses to bind a non-loopback address without `-behind-proxy` (resolution-aware,
      not a string match)

**The controller agent** (`controller/`) — its own Go module, std-lib first, **45 tests
green**:

- [x] Claim-token pairing that **pins** the hub's signing key permanently
- [x] Fail-closed command verification in a fixed normative order (signature → addressing
      → validity window → replay → lockdown), with a durable nonce store
- [x] 11-step offline-grant verification, transport-agnostic, including weekly windows
- [x] Hand-rolled WebSocket transport and mDNS responder (no external deps)
- [x] LAN HTTP grant transport, advertised over mDNS
- [x] BLE framing codec and session layer, unit-tested at ATT MTUs 23 / 185 / 512

**Contracts and harnesses:**

- [x] `proto/` — pairing, commands, grants and events, with **61 conformance vectors /
      68 checks** consumed by both implementations and an independent `verify.mjs`
- [x] `e2e/` — boots the real hub and controller binaries and drives the open path over
      the wire, including adversarial cases
- [x] `e2e-browser/` — Playwright against the real hub binary with the embedded console

**Console and shell:**

- [x] React 19 + Vite console, embedded in the hub via `go:embed`, and wrapped by a
      Tauri v2 desktop shell with a hub picker on first run
- [x] The operations-console views — devices, energy, automations — reading **live state
      from the device engine** (`GET /v1/engine/devices`), with the demo dataset now
      confined to the kinds no driver can yet serve. Every row says which it is: engine
      devices are chipped live, fixtures keep a demo chip, and a hub with no engine
      configured says so in words rather than showing an empty list that reads as a
      failed fetch
- [x] A route-parity test that diffs every frontend API call against the hub's real
      registered routes (AST-extracted), and a docs-vs-code feature-claim guard
      (`npm run check:claims`)

> **What the fold changed.** Aql's original Phase 0 was a Tauri + SvelteKit shell with an
> in-memory demo dataset driving Overview / Devices / Energy / Automations. The fold
> replaced that shell with the access module's React console and ported the demo dataset
> into it verbatim, so the same four screens survive with real access data mixed in. The
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
- [ ] An emergency-access screen that appears when the hub is unreachable and a paired
      controller is in range
- [ ] Grant revocation semantics beyond "wait for expiry" (currently an accepted v0
      non-goal)

**Hardware the reference controller has never actually touched:**

- [ ] **GPIO relay driver.** `controller/internal/relay/gpio.go` is a `-tags gpio` stub
      whose `Pulse`/`Hold`/`Release` all panic by design; the default build logs instead of
      actuating. No build has ever driven real hardware in this repo's tests
- [ ] **BLE radio validation.** The GATT peripheral glue exists only for Linux/BlueZ behind
      `-tags ble` and has never run on hardware; every other platform returns
      `ErrUnsupported`
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
- [ ] A `gateway 2fa disable --user` subcommand, so the last-resort recovery is not a
      manual SQL update

---

## Phase 1 — Device engine (not built)

Where "one hub owns everything" stops being a sentence. Nothing here exists in code — no
protocol driver of any kind is present in this repository.

- [ ] Decide where it lives: the Go hub (which already owns persistence, audit and the
      always-on box) or the Rust core in `src-tauri/` (currently one IPC command). The hub
      is the likely answer; it has not been committed
- [ ] One internal device model — id, kind, zone, state, commands, telemetry — that the
      console renders generically, with no protocol-specific code
- [ ] Driver/adapter seam so a protocol can be added without touching the console:
  - [ ] Matter
  - [ ] MQTT
  - [ ] Zigbee
  - [ ] ONVIF (IP cameras)
  - [ ] Modbus
  - [ ] Generic HTTP/webhook
- [ ] Discovery (mDNS/SSDP, Zigbee pairing, MQTT topic scan, ONVIF probe, manual add)
      replacing the demo dataset with live device state
- [ ] Bring the existing access module onto the same internal device model, so `access` is
      one kind among seven rather than a parallel stack
- [ ] Extend the input surfaces' intent vocabulary past `open`/`close` so chat and the
      console reach the new device classes

---

## Phase 2 — Local persistence & secrets (partly real)

- [x] SQLite for state, history and configuration — shipped with the hub (7 migrations,
      22 tables), one file to back up, pure-Go driver so it cross-compiles to a Pi
- [ ] Extend that schema to device state, telemetry and history once Phase 1 exists
- [ ] **OS-keychain-backed credential vault** for device and service secrets, scoped per
      device, so nothing sits in plaintext in the SQLite file or a config file. Not built:
      there is no keychain or keyring code anywhere in the repository today. The hub's own
      signing key and JWT secret currently live unencrypted in its data directory

---

## Phase 3 — Automations (not built)

- [ ] A real `trigger → condition → action` engine over live device state (today's
      automations screen is demo data with no execution behind it)
- [ ] Scheduling, conditions and run history, persisted
- [ ] Fail-closed behaviour on ambiguous sensor state for anything that actuates
- [ ] Online time-window and schedule rules for access too — today there is no rule object
      in the hub at all, and weekly windows exist only inside offline grants (evaluated by
      the controller, not the hub)

---

## Phase 4 — Energy metering (not built)

- [ ] Real meter and inverter ingestion replacing the demo 24h chart
- [ ] Historical rollups (hourly / daily / monthly) in SQLite
- [ ] Source-mix accounting (solar / grid / battery) from live readings

---

## Phase 5 — Security & bots (not built)

- [ ] Camera live view and recording (ONVIF/RTSP)
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
      implementing adapters. In progress; the adapters currently in `gateway/internal/
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
