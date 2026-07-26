# Roadmap

> [!NOTE]
> Phase 0 is the only phase that is actually built — and it is a great deal more than a
> foundation. Everything after it is a plan, not a promise. No dates, because none of it
> is scheduled.

Aql is an open-source command centre for the physical world. The chat-driven physical
access-control system is finished; the wider device engine has not started. That is the
whole shape of this roadmap.

---

## Phase 0 — Chat-driven physical access control (done)

This phase shipped by folding a complete access-control product into Aql. It is not a
demo and not a UI shell — it is a running system with tests, conformance vectors and a
cross-module harness.

**The hub** (`gateway/`) — one Go binary, SQLite inside, **60 HTTP routes, 183 tests
green** across 8 packages:

- [x] Accounts, locations, access points, members with roles, invites
- [x] An **instance-admin** operator seat above every account: one-shot claim
      (constant-time, atomic, fail-closed, fully audited), account suspension, user
      disable, runtime limit overrides, cross-account audit
- [x] **Chat channels** — WhatsApp (Meta Cloud API, HMAC-verified), Slack (Events API
      **and** Socket Mode / zero ingress), Telegram (webhook, secret-token verified),
      behind one device-agnostic channel seam
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
- [x] A route-parity test that diffs every frontend API call against the hub's real
      registered routes (AST-extracted), and a docs-vs-code feature-claim guard
      (`npm run check:claims`)

> **What Phase 0 replaced.** An earlier Aql prototype was a Tauri + SvelteKit shell with
> an in-memory demo dataset driving Overview / Devices / Energy / Automations screens.
> That app is **gone** — the fold replaced it with the real access-control console. Any
> image or doc showing those four screens is from the retired prototype.

### Known gaps inside Phase 0

Real work, not new features — listed so they aren't mistaken for done:

- [ ] **GPIO relay driver.** The `-tags gpio` file is a stub that panics; the default
      build logs instead of actuating. No build has ever driven real hardware in this
      repo's tests
- [ ] **BLE radio validation.** The GATT peripheral glue exists only for Linux/BlueZ
      behind `-tags ble` and has never run on hardware
- [ ] **The phone half of offline emergency access** — see Phase 1
- [ ] Console screens ahead of their backend: analytics, per-access-point maintenance,
      password reset / email verification / Google OAuth
- [ ] Telegram long-polling (the zero-ingress path for that channel)
- [ ] Discord channel — designed into the seam, no code
- [ ] Scoped API tokens and outbound webhooks
- [ ] 2FA, and any in-band recovery for a lost sole instance-admin password
- [ ] Position/tamper sensors on the controller return static values

---

## Phase 1 — Close the emergency-access loop (not built)

The highest-value next piece, because three of its four parts already exist.

- [ ] App-side grant client: request, store and refresh a grant when connectivity allows
- [ ] App-side presentation over LAN/mDNS and BLE, with the challenge-response the
      controller already implements
- [ ] An emergency-access screen that appears when the hub is unreachable and a paired
      controller is in range
- [ ] Grant revocation semantics beyond "wait for expiry" (currently an accepted v0
      non-goal)

---

## Phase 2 — Device engine (not built)

Where "one hub owns everything" becomes real. Nothing here exists in code.

- [ ] Decide where it lives: the Go hub (owns persistence, audit and the always-on box)
      or the Rust core in `src-tauri/` (currently one IPC command). The hub is the likely
      answer; it has not been committed
- [ ] One internal device model — id, kind, zone, state, commands, telemetry
- [ ] Driver/adapter seam so a protocol can be added without touching the console:
  - [ ] Matter
  - [ ] MQTT
  - [ ] Zigbee
  - [ ] ONVIF (IP cameras)
  - [ ] Modbus
  - [ ] Generic HTTP/webhook
- [ ] Discovery (mDNS/SSDP, Zigbee pairing, MQTT topic scan, ONVIF probe, manual add)
- [ ] Device credential vault in the OS keychain, scoped per device, never in the SQLite
      file or a plaintext config
- [ ] Extend the channel seam's intent vocabulary past `open`/`close` so chat reaches the
      new device classes

---

## Phase 3 — Automations (not built)

- [ ] A real `trigger → condition → action` engine over live device state
- [ ] Scheduling, conditions and run history, persisted
- [ ] Fail-closed behaviour on ambiguous sensor state for anything that actuates
- [ ] Online time-window and schedule rules for access too — today there is no rule object
      in the hub at all, and weekly windows exist only inside offline grants (evaluated by
      the controller)

---

## Phase 4 — Energy (not built)

- [ ] Meter and inverter ingestion
- [ ] Historical rollups (hourly / daily / monthly)
- [ ] Source-mix accounting (solar / grid / battery) from live readings

---

## Phase 5 — Security & bots (not built)

- [ ] Camera live view and recording (ONVIF/RTSP)
- [ ] Robot control — mowers, cleaning, patrol — beyond a status row
- [ ] Alerting tied to real sensor and camera events
- [ ] Rate-limiting and scoping on movement commands, so a compromised client cannot drive
      a machine into a person

---

## Phase 6 — Reachability & remote access (partly real)

- [ ] LAN-first control, always — **already true** for the console and controllers
- [x] Zero-ingress operation is real today via Slack Socket Mode and outbound-dialling
      controllers
- [ ] Telegram long-polling
- [ ] A considered story for reaching your hub from outside the LAN beyond "run a tunnel",
      off by default, with its own threat-model addendum

---

## Phase 7 — Mobile (not built)

- [ ] iOS/Android builds via Tauri mobile
- [ ] Mobile layout passes on the console
- [ ] The emergency-access screen from Phase 1 is the reason mobile matters most

---

## Phase 8 — Zana hardware integration (not built)

- [ ] First-class support for [Zana](https://github.com/vul-os/zana) open-hardware devices
      (mowers, sensor nodes, security/cleaning bots) as reference implementations of the
      driver seam
- [ ] Zana stays optional — Aql controls any hardware; Zana devices just work best with it

---

## Ecosystem

- **Aql** (this repo) — the software command centre
- **[Zana](https://github.com/vul-os/zana)** — open-hardware designs for the devices Aql
  is meant to control
