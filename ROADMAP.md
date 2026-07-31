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

**The hub** (`hub/`) — one Go binary, SQLite inside, **129 HTTP routes over 27
migrations, and more than 1,000 tests green** across 18 packages:

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

- [x] `proto/` — pairing, commands, grants, events, acks and webhooks, with **103 checks**
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

- [ ] **GPIO relay driver — written, never validated on a kernel.** This line used to say
      the driver was a stub whose `Pulse`/`Hold`/`Release` panicked. It is not and they do
      not: `controller/internal/relay/` is a complete Linux GPIO character-device (uAPI v2)
      implementation — chip open, line claim with EBUSY detection, polarity mapping, a pulse
      timing/abort state machine, and a fail-safe tied to fd lifetime — across nine files
      with tests, and it contains no `panic` at all. `GateClosed` reads a real
      kernel-debounced input line. What is missing is exactly what `gpio.go`'s own header
      says: **STATUS: NOT VALIDATED ON HARDWARE.** No build in this repo's tests has driven
      a real relay, and that is the open item — not the code
- [ ] **BLE radio validation.** The GATT peripheral glue builds for Linux (BlueZ) and
      Windows (WinRT) behind `-tags ble` — one portable file, since every call is the
      `tinygo.org/x/bluetooth` GATT-server API and the library carries both backings. It
      has never run on hardware on either. darwin returns `ErrUnsupported`: CoreBluetooth
      offers peripheral mode, that library does not bind it, and writing a CGO binding
      that cannot be tested here would be worse than the gap
- [x] **The hub now knows when each controller's clock was last PROVED fresh.** An acked
      `ping` is the only proof it receives — processing one calls the controller's SyncClock,
      so an ack whose nonce matches a ping the hub itself minted is evidence that that
      controller's clock advanced. Recorded per device (migration 0022), on both the
      WebSocket and long-poll ack paths, because a queued ping has no pending waiter and
      both of the existing branches drop its ack. `last_seen_at` is explicitly NOT the
      signal: it is stamped on every long-poll request, so a controller whose clock has not
      moved in a month reads as seen a minute ago. Nor is the ack's `result` — a ping and a
      config both ack "ok", so keying on it would count a relay retune as a clock sync
- [x] A console surface for the above. `GET /v1/accounts/{id}/controllers/clock-freshness`
      serves it — every paired controller oldest-proof-first, never-synced first, with the
      controller's own 14-day limit reported rather than hard-coded — and
      `components/device/ClockFreshness.tsx` renders it on the Devices screen, staying silent
      unless a controller is actually at risk so it does not become furniture
- [x] **`ping` — and it was not the minor one.** A controller learns the hub's time at
      the WS handshake and on an accepted `ping`, and nowhere else. The hub had never sent
      a ping, and a healthy WS connection carries no read deadline, so a controller that
      never drops never re-handshakes. After `wire.StaleClockLimitSeconds` (14 days) its
      grant verification refuses EVERYTHING with `stale_clock` — step 1, before lockdown,
      before the grant is examined. The failure lands exactly inverted: flawless
      connectivity for a fortnight, then a hub outage, and every offline emergency grant
      denied at the gate. A six-hourly sweep of the whole PAIRED fleet fixes it — not the connected subset, which excluded the case that needed it most: a controller on the long-poll fallback never handshakes either, so it had no path to a fresh clock at all. A ping to a device with no live socket queues, and the long-poll handler drains it
- [x] **`repair` — the last command with no sender — now has one.** The hub's signing key
      was in practice permanent: a key believed compromised stayed authoritative until
      somebody physically reset every controller. Rotation is a programme rather than a
      switch and is built as one. Two keys are retained and each command is signed with
      whichever key its TARGET controller pins, because rotation cannot be made atomic — a
      precondition that every controller is online does not help the one that drops between
      the check and its own repair, and if the hub has discarded that key nothing reaches
      that controller again short of a factory reset. Repairs are nonce-correlated (an ack's
      result is `ok` for every command kind, so an uncorrelated one would move a controller
      on the strength of acking an unrelated lift), a five-minute sweep survives a hub
      restart mid-rotation, and the previous private key is destroyed only when a
      transactional check finds nothing still pinning it. Migration 0023; console at
      **Admin → Signing key**.
      The blast radius reaches every phone holding an offline grant, and that is deliberate
      rather than unfinished: a grant is verified against the key a controller pins, so
      grants signed with the old key stop working once that controller is repaired. If the
      reason to rotate is that the old key is not trusted, that is the point. The console
      states the count — an honest upper bound, since the hub keeps no record of which
      grants are still held on a phone — **before** the rotation, not afterwards at a gate.
      (`lockdown`/`lift` are deliberately controller-local — `offline_grants.go` says so —
      and were never part of this gap)
- [x] **A controller reports its configuration back.** `ctl.report` (proto/commands.md)
      carries the RESOLVED `pulse_ms` and `hold_max` with their source, so "700 ms" and
      "700 ms (default)" are distinguishable; the hub stores it (migration 0026) and serves
      `GET /v1/devices/{id}/config-report`. A controller that has never reported answers
      `reported:false` rather than the defaults, because inferring them would show numbers
      nobody confirmed. The console shows those values per field and labels a firmware
      default as one, so "did my change land" is answered by the device rather than by the
      form assuming its own success; a key the console has no field for is listed rather
      than dropped, so a controller that learns a tunable is not silenced by an older
      console. `sensor_debounce_ms` was removed from the console AND from the hub's
      accepted set in the same pass: the controller stores it and reads it nowhere, so the
      form took a number, the hub signed a command and the controller acked it while the
      gate behaved exactly as before. The original note follows, for the record.
- [ ] ~~**A controller never reports its configuration back.**~~ `cmd.ack` carries a result
      and a detail and nothing else, so the hub cannot show an operator what `pulse_ms`,
      `hold_max` are currently set to — only send new ones. (`sensor_debounce_ms` is not
      one of them: `config` accepts it and the controller stores it, but nothing reads it —
      the debounce that applies comes from the `-relay` spec. Stored is not in effect.) The
      console says so plainly rather than leaving empty boxes to be read as "unset". Fixing
      it means widening the ack (or adding a report) in `proto/`, which is a wire-contract
      change across both modules and the conformance vectors.
      **Cheaper than that reads, and the reason is now pinned by a test.** Uplink
      verification canonicalises the bytes it RECEIVED minus `sig`, not a rebuild of the
      fields it knows, so an older hub accepts an ack carrying a field it has never heard
      of — and the unknown field is still inside the signature, so nothing on the path can
      rewrite it. An additive `config` object therefore needs no version bump and no flag
      day for mixed-version fleets. **Designed** in
      [`docs/CONTROLLER-CONFIG-REPORT.md`](docs/CONTROLLER-CONFIG-REPORT.md): the carrier is
      a session-scoped `ctl.report` rather than the ack, because a gate nobody has
      commanded would otherwise never report; the value carried is the RESOLVED one with
      its source, since "700 ms" and "700 ms (default)" are different claims; and a device
      with no report reads as "not reported yet", never as defaults
- [ ] Controller TAMPER sensing does not exist, and the MOCK relay's position sensor is a
      constant. The GPIO build's `GateClosed` is real — it reads a kernel-debounced input line
      claimed alongside the relay output. This line previously said "sensors return static
      values", which was true of one of the two backends and neither of the two signals

**Console screens ahead of their backend** (tracked mechanically by the route-parity test):

- [x] **Scoped API tokens** — hashed at rest, scope enforced by a route wrapper rather
      than a handler check, bounded by the holder's membership at the time of use
- [x] **Outbound webhooks** — HMAC-signed, with the target re-validated against SSRF
      immediately before every delivery, because DNS belongs to whoever owns the name
- [x] **Password reset** (forgot / reset / update)
- [x] Analytics and per-access-point maintenance — both backends ship (three analytics
      routes over `httpapi/analytics.go`, two maintenance routes over `httpapi/maintenance.go`
      and migration 0017), and the console's Analytics screen consumes them
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
- [x] A console surface for claiming — the routes exist (`GET
      /v1/accounts/{id}/devices/claimable`, `POST|DELETE .../devices/claims`) and the Devices
      screen offers them: `components/device/ClaimableDevices.tsx` lists unclaimed devices and
      claims them, with a release control beside each claimed one
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
      one kind among seven rather than a parallel stack. Designed in
      [`docs/ACCESS-ON-THE-ENGINE.md`](docs/ACCESS-ON-THE-ENGINE.md) and now HALF DONE: the
      read-only `access` driver surfaces gates in the engine's fleet (status only, every verb
      refused). Actuation deliberately does not move — two routes to a gate is worse than one
- [x] Extend the input surfaces' intent vocabulary past `open`/`close` — `hold` now
      reaches the gate from chat and the console. Adding a third verb to a fail-closed
      type is where its safety property breaks if it is going to: every `GateVerb` method
      was "if explicitly open, do the open thing, else the close thing", and a careless
      third branch inverts that so an unset verb lands on the MOST permissive one. Hold is
      reachable only on an explicit match, in all six mappings, and an unset verb still
      resolves to close everywhere. In the text matcher hold is checked BEFORE open, which
      is a correctness requirement rather than a preference: every natural phrasing ("hold
      the gate open", "keep it open") contains the word "open"
- [x] **A question about a gate no longer opens the gate.** `TextGateVerb` matched
      `Contains(body, "open")` and "opened" contains "open", so on the free-text rails
      "when was the gate last opened?" opened it and "is the gate closed?" closed it —
      driven end to end through the WhatsApp webhook, each produced a real audited open
      against a one-gate household, because a body naming no gate collapses onto the only
      one. `channels/question.go` classifies a body as command, question or neither, and
      `TextGateVerb` now answers `ok` only for a command: the narrowing is in the OLD door
      so every existing caller became safe without changing, rather than a guard each rail
      has to remember. The rails answer the question plainly instead of offering a gate
      menu, and the reply names the message that WOULD have opened it, because the
      classifier will sometimes be wrong about a real request and a false refusal has to be
      recoverable in one message. Polite requests stay commands — "could you open the
      gate" is not a question — which is the half a one-directional test would miss
- [x] **"Keep the gate open" asked for a hold and got a pulse.** The hold branch was
      already checked before `open` — that ordering is commented at length as the thing
      standing between a hold and a gate swinging shut — but it matched literal two-word
      substrings (`keep open`, `keep it open`, `leave open`), so any words in between fell
      through: "keep the gate open", "keep the main gate open for 10 min" and "leave the
      back gate open please" all pulsed, and the member was answered "Opening Main gate…"
      before it shut behind them. `holdOpenPhrasing` reads word ORDER instead of adjacency,
      and the order is what keeps it narrow — "open the gate and keep the dog inside" has
      the two words the other way round and is still an open, which is the direction that
      would otherwise leave a barrier standing open
- [x] **Chat answers questions as well as commanding.** `docs/CHAT-COMMANDS.md` §4's T0
      read path: "when was the gate last opened", "when was it last closed" and "is the
      controller online" are answered from the hub's own record, and "is the gate closed"
      is refused with its reason — the hub has no position sensor and says so rather than
      guessing about a physical barrier. Every §4.4 rule is code: the authorized set only,
      capped at `PickerCapacity` with the truncation stated, a `query_1h` counter that
      cannot exhaust the open budget, and a `read` row in the same hash-chained audit table
      as an open. "Who opened the gate" is REFUSED although the log holds it — a member of
      a shared gate should not be able to track another resident from their phone — and is
      refused before classification so it cannot be answered with the adjacent fact.
      **On all five rails.** It landed on WhatsApp and DMTAP first because those are where
      a question ACTUATED; Telegram, Slack and Discord match their command words exactly,
      so a question there fell through to the welcome menu — an offer to open the gate the
      member had just asked about. One shared branch (`answerProfileGateQuestion`), because
      five hand-rolled actuation branches is how a third verb made five rails wrong at once
      before, and each rail is tested through its own real webhook: "the helper is correct"
      and "this rail calls it" are different claims
- [x] **Documentation citations are checked, and four documents were wrong.**
      `docs/DESIGN-SYSTEM.md` cited 104 paths under a `lintel/` prefix — the repo this
      frontend was folded in from — so not one resolved, and three named components deleted
      since (`Accordion.tsx`, `Hero.tsx`, `WhatsAppDemo.tsx`). Worse than the paths: EVERY
      row of its type-scale table stated a size the site stopped using when the landing was
      redesigned (hero H1 documented as `clamp(2.9rem, 10.5vw, 7.6rem)`, actually
      `clamp(2.45rem, 5.6vw, 4.25rem)`) — a design system anyone building to would have
      produced type most of a third too large. Corrected against the CSS and verified
      mechanically. `docs/CHAT-COMMANDS.md` cited the deleted `demoData.ts` nine times and
      still called §1.2's `capabilities` field a PROPOSAL when `EngineDevice.capabilities`
      has shipped. `src/lib/__tests__/docCitations.test.ts` now resolves every cited path
      across `docs/`, `proto/`, README, ROADMAP and ARCHITECTURE. Line numbers were dropped
      rather than corrected: `AccessPoints.tsx:94` was still IN RANGE and pointed at
      unrelated code, and a citation that looks precise and is not is worse than one that
      does not pretend
- [x] **"Never over a chat rail" is enforced, not just written down.**
      `docs/CHAT-COMMANDS.md` §3.6 lists eleven operations a chat message must never
      reach — grant issuance and revocation, device claim, account suspension, credential
      entry, audit-log reads, member lists, camera media, anything reconfiguring the audit
      path — because "a chat rail is not a control plane for the control plane". Nothing
      violated it; nothing checked it either. `httpapi/chatexposure_test.go` denies each
      implementing symbol to every chat entry point. Tampering found two holes in the
      guard itself: a typo'd denial matches nothing and passes, and dropping a file from
      the scanned list left every other assertion green while that rail went unread — both
      now have their own check. A rail may still WRITE the audit row §4.4 rule 5 requires,
      because writing evidence is not consulting it
- [x] **Every chat picker that truncates says so — now including the three nobody was
      checking.** `TestEveryPickerDisclosesTruncation` covered WhatsApp, Telegram, Slack
      and one of DMTAP's three renderers; Discord and DMTAP's other two were capped by
      code no test read. All three were correct, so this closed a COVERAGE gap rather than
      a defect — but a renderer that stops asking for the notice fails no test it is not
      in, and the failure is invisible: a member with 34 gates is shown 10, picks the
      nearest name, and never learns theirs was not on the list. Discord additionally now
      asserts that the number the notice STATES equals the number actually rendered — its
      buttons are packed into action rows with a ceiling at each level, and those agree
      only because `DiscordMaxButtons` is defined as rows × per-row. `docs/CHAT-COMMANDS.md`
      §2.3 recorded Slack as "not enforced" and asked for constants that already exist;
      corrected
- [x] **Device resolution over the engine fleet** — `docs/CHAT-COMMANDS.md` §2.3 stages 1
      (verb-first filtering) and 3 (scored matching with a margin). Stage 1 is the
      correctness one: a device whose capabilities do not expose the verb is not a worse
      match, it is not a match, so "open the front gate camera" resolves to nothing rather
      than scoring a camera on its name. A tie is never broken — not by slice order, not by
      recency — and a zone or kind word alone is below the floor, because "the shed" is a
      hint about which devices are plausible and not an identification of one. Nothing
      actuates through it: the consumer is the REFUSAL, which now names the device it
      understood, so the resolver is wrong in public before it is ever wrong at a relay
- [x] **Chat drives engine devices, at T1 and no higher.** `docs/CHAT-COMMANDS.md` §3:
      "turn on the garden lights" resolves, actuates and is audited in the same
      hash-chained `access_logs` a gate open goes to (§3.8 — never a second table). The
      ceiling is `TierReversible` and it is load-bearing rather than decorative: `resume`
      is a verb chat sends and `resume` on a mower's blade-job is HAZARDOUS MOTION, so the
      ceiling is the only thing between a text message and spinning blades. It refuses by
      naming the tier and where the command DOES work, because the member has done nothing
      wrong and the limit is a property of the surface. A per-(subject, device, verb)
      cooldown makes a duplicate webhook delivery idempotent without blocking the inverse
      verb or another device; it fails CLOSED, unlike the gate path's reviewed fail-open,
      because there is no member-at-their-own-gate argument for a lamp. Verbs taking a
      value are not sent at all — parsing "30" out of "dim the lounge to 30%" is a second
      resolution problem — and an ambiguity actuates nothing
- [x] **T2 over chat, behind an intent-bound confirmation** — §3.4, migration 0027. A
      consequential verb answers with a one-time token; the member sends it back within a
      minute, in the same conversation, and only then does anything run. Explicitly not
      "reply yes": a bare yes is replayable and, in a group, cannot be attributed to the
      person asked. The token is bound to a hash of the RESOLVED intent and the intent is
      re-resolved at redemption, so a confirmation for one device cannot authorize another
      — the case §3.4 exists for. A confirmation raises the ceiling by exactly one tier:
      T4 stays refused however many messages arrive, because it wants step-up on a
      different rail and an operator-armed window and a token is neither
- [x] **Two defects the unit tests could not see, found by driving the real webhooks.**
      Every actuation test called the helper directly, and `setupChannels` attaches no
      engine — so no rail test had ever reached the actuation path at all. With one
      attached: (1) engine commands were audited with NO account_id, so the row existed in
      the hash chain and was invisible to `AccessLogsByAccount`, which is how the console
      and every member actually read the log — an audit row nobody can find is close to no
      audit row; unit tests counting rows across the whole table could not tell the
      difference. (2) The confirmation token was UNREDEEMABLE on every rail: bodies are
      lowercased by `NormalizeText` before anything sees them, and the scan was
      case-sensitive, so a T2 command answered its own confirmation with a fresh
      confirmation, forever. The store tests passed throughout because they carried the
      raw token
- [ ] Extend it further, to the other device classes. `set`, groups and T4 remain in the
      console. T4 needs step-up on a second rail (§3.4) and an operator-armed time window;
      neither exists, and a confirmation is not a substitute for either. Of §4.2's two
      once-unbuilt queries, **"how much solar today" is built** — one number per source for
      one day, which rule 3 permits where a curve would be the appliance fingerprint §4.3
      warns about; a meter that was down makes the figure a floor and says so. **"Which lights are on" is
      ANSWERED**, over `devices.ActiveFrom` and behind rule 6's consent — the count is over
      the lights whose state the hub knows and names the ones it cannot speak for, capped
      and stated, with names and on/off and nothing else. Consent must cover EVERY location
      the account holds: engine devices are owned per account and carry no location, so
      partial consent is no consent. The reasoning that blocked it is kept below because it
      still holds for any unmapped driver — such a device is unknown, not off.
      Historically: a device's state
      exists only as `Device.Summary`, free text a driver wrote for a human, which the model
      documents as "presentational; never parsed". Counting lights would mean guessing each
      driver's vocabulary and reporting the guess as a fact about someone's home; it needs a
      machine-readable state on the device model, and `devices/summarycontract_test.go` now
      denies the shortcut. **Designed in [`docs/DEVICE-STATE.md`](docs/DEVICE-STATE.md)**,
      where the hard part turned out not to be adding a field: three of the five in-tree
      drivers let the OPERATOR name the metric, so a hub seeing `level` on an MQTT topic
      does not know it means brightness rather than a water tank. The decision is that a
      capability declares a SEMANTIC state and a driver MAPS its metric onto it — stated in
      configuration, never inferred — and that devices with no mapping are excluded from any
      count and said to be. **The catalogue half is now built**: `StateSpec` declared for
      lighting and jobs, read by `devices.ActiveFrom`, whose three-valued answer makes
      UNKNOWN distinct from off — a device that was never polled, or whose driver emits an
      undeclared metric, is not counted as off. **The driver mapping needed no new
      mechanism**: `StateTopic.Metric` already uses the catalogue's vocabulary, so an
      operator naming their MQTT topic's metric `level` on a device claiming
      `light.dimmable` IS the mapping — proved end to end against a broker, alongside its
      opposite, where a metric the operator named `brightness` resolves to unknown rather
      than being guessed at. What is still open is only the DISCOVERED case: a device
      claimed from discovery has no config entry, and until a driver emits the catalogue's
      name itself it simply has no state — the safe default. §4.4 rule 6's per-location opt-in that has to precede it IS
      built (`location_disclosure`, migration 0028): off unless an admin
      turns it on, per location, recorded with who and when, audited both ways, and a member
      asking a location that has not opted in is told the switch exists rather than met
      with silence

---

## Phase 2 — Local persistence & secrets (partly real)

- [x] SQLite for state, history and configuration — shipped with the hub (27 migrations,
      51 tables), one file to back up, pure-Go driver so it cross-compiles to a Pi
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
- [x] Conditions come in two shapes: a numeric comparison, or a **state** test resolved
      through the capability's own declaration (`docs/DEVICE-STATE.md`) rather than a
      metric name the author had to know — so "while the mower is docked" is sayable, and
      keeps meaning the same thing after an operator renames a metric. A device whose
      state the hub does not know satisfies neither and refuses the run
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

## Phase 5 — Security & bots (the camera pipeline records and plays; no camera has been involved)

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
      resident is told when retention drops the evening they cared about. Every decision in
      it is now code, and its §5 open question about grant scope is decided
- [x] Camera live view and recording. **H.264 depacketization now exists** — RFC 6184
      single-NAL, STAP-A and FU-A, emitting Annex-B, with the failure modes that matter
      covered explicitly: a lost middle fragment discards the partial NAL rather than
      emitting it half-formed, a continuation with no start bit is dropped rather than
      given a fabricated header, and every length read off the wire is bounds-checked
      (STAP-A's inner sizes are attacker-controlled). Two fuzz targets, ~590k execs clean.
      **Sequence-parameter-set parsing now exists too** (`sps.go`) — ITU-T H.264 §7.3.2.1.1
      exp-Golomb, the high-profile scaling-list walk, and frame cropping, which is the field
      that matters: 1080 is not a multiple of 16, so every 1080p camera encodes 1088 lines
      and crops 8 away, and a muxer that writes the coded height produces a file with a band
      of encoder padding along the bottom that no demuxer complains about. It is wired into
      the RTSP probe, so `Describe` now reports the resolution the encoder is *actually*
      using — read from the stream's own parameter set in `sprop-parameter-sets` — beside
      the one an ONVIF profile claims. Those two disagree in practice.
      **The fMP4 writer now exists** (`fmp4.go`) — ISO/IEC 14496-12 and -15, init segment
      plus moof/mdat fragments, 64-bit `tfdt` (a 32-bit decode time wraps after ~13 h at
      90 kHz, and a continuous recorder is what runs longer than that), `default-base-is-moof`
      so a fragment is playable on its own, and signed composition offsets through a
      version-1 `trun`. Fragmented rather than plain MP4 because a plain MP4 truncated
      mid-write is not a shorter video, it is a file with no index — and a recorder is
      precisely the workload a full disk or a reboot kills mid-clip.
      **Access-unit assembly now closes the chain** (`accessunit.go`). h264.go produced NAL
      units and fmp4.go consumed access units, and nothing turned one into the other — the
      path from a camera's packets to a file was broken in the middle. Grouping does not need
      the slice-header parser that made it look expensive: RFC 3550 §5.1 requires every packet
      of one picture to share an RTP timestamp, so the boundary costs four bytes of header.
      The marker bit is deliberately *not* trusted to close a picture — real senders set it
      early, late or never — and is cross-checked instead, so an unreliable camera shows up as
      a number rather than as split frames. In-band parameter sets are captured and kept out
      of the samples, which is what makes a camera that advertises no `sprop-parameter-sets`
      usable at all.
      **This is the first part of the camera pipeline checked by something outside this
      repository.** `e2e-browser/fmp4.spec.ts` feeds real output to a Chromium `MediaSource`,
      which parses the boxes, pulls the SPS out of `avcC` with its own parser, and reports
      back 320x240 and contiguous buffered ranges — for the muxer alone, and for the whole
      RTP→Depacketizer→Assembler→Fragmenter chain with the parameter sets taken in-band. Both
      gates are verified to fail rather than assumed to: a four-byte `data_offset` error makes
      Chromium refuse the segments, and halving every assembled duration is caught as a
      0.167 s range against the 0.333 s the packet timestamps imply. A deliberately corrupted
      `moov` length is asserted to be refused, so acceptance means something.
      **The chain is now joined end to end** (`ConsumeMedia`). `countInterleaved` had every
      RTP packet in hand and threw it away after counting, so the four tested components of
      this package — depacketizer, SPS parser, assembler, muxer — were reachable from no
      camera. `ConsumeMedia` runs the same SETUP/PLAY as the probe and pushes each packet
      through to the assembler, returning access units and the flow statistics side by side:
      a stream that delivers a thousand packets and assembles no picture is a real
      diagnosis, and distinct from one that delivers nothing.
      What none of it proves is stated plainly: the vectors were written from the RFC and
      the standard, and NO CAMERA HAS BEEN INVOLVED ANYWHERE IN THIS PACKAGE. Chromium
      agreeing is a real independent check on the container and the parameter sets; it is not
      a real camera, and the sample payloads are not decodable pictures.
      **The chain now runs by itself.** A capture worker enumerates the cameras whose stream
      address has resolved, records a window from each, muxes it and writes a clip; an hourly
      retention sweep expires them per `docs/CAMERA-RETENTION.md` (migration 0024). Until this
      landed every piece of that — `ConsumeMedia`, `NewFragmenter`, `WriteClip` — was complete,
      tested and called by nothing, which is the shape this repository has been bitten by
      repeatedly. Cameras nobody has CLAIMED are not recorded: footage is written under an
      account id and there is no correct directory for footage nobody owns.
      **`camera:view` and the footage list now exist too** (migration 0025). The permission is
      per member PER CAMERA and is deliberately NOT implied by owner or admin — the one place
      this product's "admin can configure the thing" pattern is broken on purpose, because here
      it would mean "admin can watch the other residents", and the owner of a shared house's hub
      is usually just whoever set it up. A fresh install grants it to nobody. Every view and
      every REFUSED attempt is written to the hash-chained audit log, and the access log is
      readable by every member rather than admins only: the subjects of the footage must not be
      the only people who cannot check who watched. Dropped clips stay in the list as gaps, so a
      missing evening reads as dropped-and-when rather than as a camera that never recorded.
      `docs/CAMERA-RETENTION.md` §5 left per-camera-vs-per-account open; it is decided as per
      camera, because the objection was UI cost and that is a reason to ship a narrower UI, not
      to widen an authority over recordings of people's homes.
      **Playback works too**: each clip is a self-contained fragmented MP4, so the console plays
      one in a plain `<video src>` — no plugin, no transcode, no Media Source plumbing, which is
      the whole reason the muxer writes that container. The same per-camera grant gates it, the
      same audit records it (once per playback, not once per range request — a `<video>` issues
      many, and a log with forty rows for one watch is a log nobody reads), and an expired clip
      answers 410 with the reason rather than 404, because "gone" and "never existed" are
      different answers and this is the one place the difference is the entire point.
      **Live view exists too, and is honestly named.** The capture loop's fragments fan out to
      watchers over MSE — one RTSP session however many people watch, because cheap cameras
      support few and the second viewer would take a slot from the recording. It is NOT
      low-latency: the hub captures a window at a time, so a viewer is about ten seconds behind,
      and the response says so in a header the UI renders rather than leaving someone to
      discover it by waving at a gate. A viewer that falls behind is dropped rather than allowed
      to apply back-pressure into the capture loop — recording is the durable job and watching
      the disposable one.
      **Retention had a hole and it is closed.** Every expiry query starts from the clip
      index, so a file with no index row was invisible to all of them — and a clip is renamed
      into place and THEN indexed, so a crash between those two steps left one, as did a
      `.part` abandoned mid-write. Nothing would ever have reclaimed either: the retention
      setting would have been honoured exactly and the disk would still have filled. The
      hourly pass now also walks the recordings tree and deletes what the index does not know
      about, skipping anything touched in the last hour so it cannot take a clip being written
      right now. Found by looking, not by a test failing, in code written earlier the same day.
      That completes `docs/CAMERA-RETENTION.md` §4's five steps in code. What is left is the
      thing no amount of code closes: **hardware**. Nothing in this pipeline has met a camera,
      and the retention arithmetic now deletes real files, so it wants review before it runs
      anywhere that matters. Recording is one RTSP session per window rather than one held open, which is
      worse on a real camera and honest about what has been verified — a long-lived session
      means keepalives, mid-stream parameter-set changes and servers that drop connections,
      none of which can be developed against a fake without inventing the behaviour.
- [x] **The camera LIVE route is tested.** It had no tests at all: `Config.Live` is nil in
      every harness, so the handler 404'd before reaching §2.4's `camera:view` check or
      §2.5's audit — both of which it implements a second time, alongside the clip path
      that was thoroughly covered. Found by auditing which `Config` fields no test ever
      sets, after the same shape (a helper proved correct, a call site nobody exercised)
      produced two real defects on the chat path. Tampering also showed a refusal test
      using a plain `httptest` request HANGS on a regression — the handler streams and the
      request context never ends — so it ran for ten minutes instead of reporting that an
      owner had watched a camera without permission; the refusal tests now carry deadlines
- [x] **The camera permission routes are tested** — grant, revoke, list, and the
      access log. Every camera test issued its grant by calling the store directly, so the
      routes carrying §2.4's and §2.5's claims had never been exercised. Now pinned: a
      non-admin cannot grant, granting lands in the hash-chained `admin_audit_log` (not the
      camera-access log, which deliberately selects only the WATCHING actions), revoking
      stops access and is audited, a revoked grant stays in the listing because it is the
      record of who once could watch, and — the claim most worth pinning because it breaks
      the pattern of the rest of the product — EVERY member can read the camera-access log,
      not just admins. Found by asking which handlers a coverage run never enters
- [x] **Outbound webhooks are actually delivered under test.** The signing helpers, the
      SSRF checks and the store were all covered; `deliverOne` — the function that performs
      the POST, retries it, records the outcome and RETIRES an endpoint that keeps failing
      — was at zero. A real `httptest` receiver now proves a delivery arrives signed with
      the exact bytes, a failing one is retried to the cap and recorded as `failed`, and
      the retirement threshold holds in BOTH directions: one failure short leaves the
      endpoint enabled, reaching it disables it with a reason, and a success in between
      resets the count so a flaky receiver is never retired. The backoff became an
      injectable field so those paths cost milliseconds instead of fifteen real seconds —
      production still installs the linear one, and nothing else sets it
- [x] **Key-rotation repair dispatch is tested.** The store's half was already thorough;
      the ORCHESTRATION — `dispatchRepairs`, `noteRepairAck`, the sweep — was at zero. The
      property that matters is one line of comment: a repair is signed with the key the
      controller PINS, never the new one it has never seen. Getting that wrong compiles,
      signs, dispatches and looks healthy while every controller rejects its repair, no
      rotation ever completes, and the fleet runs on the retained key until someone removes
      it — at which point nothing opens. Also pinned: the nonce is recorded BEFORE dispatch
      (an ack can arrive faster than the write), a repaired controller is not sent another,
      and a rotation completes only once every controller has moved
- [x] **The controller's clock is tested.** `internal/clock` had a test file and one
      function at 100% — `Stale`, which is pure — while every stateful path was at zero:
      `NewSynced`, `Now`, `SyncFromGateway`, `LastGatewaySync`. A test file plus a green
      function is the shape that stops anyone looking. This clock is the time base every
      OFFLINE grant is verified against, so a wrong `Now()` either honours expired grants
      or refuses valid ones, and neither is visible from the hub. Now pinned: after a sync
      `Now()` follows the gateway base advanced by the LOCAL MONOTONIC clock and never the
      wall clock (the reason the package exists — an RTC-less board's wall clock is a boot
      guess NTP may step at any moment); before the first sync it falls back to the wall
      clock but still reports the PERSISTED sync instant, which is what keeps the
      stale-clock rule working across a reboot; an unsynced clock reports stale, so offline
      decisions fail closed; and a corrective sync may move the clock BACKWARD, because the
      gateway is the authority and a clock that only advanced would be unfixable
- [x] **The controller's device identity is tested** — it had no test file at all, and it
      is the keypair the hub knows a controller BY (`proto/pairing.md` rule 2), so a failure
      here is not a degradation, it is a controller the hub no longer recognises. Pinned:
      an identity survives a reload (a regenerating `Load` would present an unknown key
      after every restart and every gate behind it would stop opening); two controllers
      never share one; a CORRUPT seed refuses to load rather than quietly minting a new
      identity — the helpful fix there turns a repairable fault into a silent re-pairing
      that overwrites the original seed; the seed file is 0600 and holds the seed ALONE,
      with the public key derived; and `PublicKeyB64` is unpadded base64url, the format
      `pair.redeem` carries
- [x] **The controller's event recorder is tested** — `Record`, `RecordGrantRedeemed` and
      `NewEventID` were at zero over a well-covered queue. These carry every event a
      controller emits while the hub is UNREACHABLE, so a fault is discovered late or not
      at all. Pinned: an event is signed by the controller and stamped with the synced
      clock rather than the wall clock; `grant_redeemed` lands in the reserved partition
      and survives a flood that overruns the ordinary ring; and the deliberate asymmetry
      holds — `Record` logs its errors because recording must never block actuation, while
      `RecordGrantRedeemed` RETURNS them, because the caller has to know whether the only
      evidence of an offline emergency open was captured
- [x] **The agent's grant snapshot and pairing precondition are tested** — `GrantEnv` and
      `EnsurePaired` were at zero, closing the controller coverage audit. `GrantEnv` is the
      entire context an offline redemption is judged against, and each field fails
      differently if dropped: no lockdown means a gate opens while sealed, no pinned key
      means signatures are checked against the wrong one, a wall-clock `Now` breaks the
      stale-clock rule the clock package exists to serve. Every field is asserted against a
      deliberately non-default state, so a zero-valued Env cannot pass. Lockdown is read at
      snapshot time rather than cached, so one set while running binds the very next
      redemption. `EnsurePaired` is idempotent and refuses a half-configured first run
      rather than dialling
- [x] **The camera driver's redirect policy is tested**, closing the hub-side coverage
      audit. `checkRedirect` is installed on the ONVIF client unconditionally — "not
      negotiable from config", because the request carries that camera's credentials — and
      had no tests: a redirect leaving the host would hand those credentials wherever the
      camera pointed and make the hub fetch from an address nobody validated. Pinned:
      same-host redirects pass, a different host or PORT is refused with a sentinel that
      distinguishes policy from a dial failure, the chain is bounded, and the comparison is
      against the ORIGINAL request rather than the previous hop — otherwise a chain walks
      away one host at a time, each hop "same as the last"
- [x] **The mDNS responder is tested and fuzzed.** The whole package was at zero, found by
      re-running the coverage audit with `-coverpkg` — it parses datagrams ANYONE on the LAN
      can send to a device that opens gates, and it is hand-rolled DNS wire format. The
      classic hazard is there and holds: a compression pointer that points at itself, or a
      two-pointer cycle, terminates rather than spinning forever in a UDP read path. Also
      pinned: labels and pointers running past the end are refused, a RESPONSE is never
      answered (two advertisers on one LAN would otherwise answer each other indefinitely),
      and `consumed` counts bytes at the ORIGINAL offset rather than wherever a pointer
      chain ended. Two fuzz targets are wired into CI beside the existing four; 900k
      executions found no crash. The RESPONSE side is checked too — the PTR/SRV/TXT/A a
      phone's resolver reads to find a controller — by a walker that recomputes every
      position from the DECLARED lengths and requires the last record to end exactly at the
      end of the packet, so a wrong answer count or rdlength lands it somewhere else. That
      is STRUCTURAL, not proof a resolver accepts it: there is no DNS library in the module
      and the real consumer is Bonjour/NSD, so this is the same built-versus-run-against-
      hardware distinction `docs/CAMERA-RETENTION.md` draws
- [x] **The console shows a device's resolved state, served rather than re-derived.**
      `GET /v1/engine/devices/{key}/readings` now carries `active` and `state_declared`,
      computed by the same `devices.ActiveFrom` the chat read path uses — deriving it in
      TypeScript would be a second copy of the catalogue's declarations in a language that
      cannot see them, and the two would disagree the first time a capability gained a
      state. `active` is always present including `"unknown"`, because a field that appeared
      only when the answer was known would make absence ambiguous between "this hub does not
      support it" and "this device did not report". The device page shows On / Off / **Not
      reporting** — never assuming the third is the second
- [ ] Robot control — mowers, cleaning, patrol — beyond a static status row
- [x] **Alerting tied to sensor and availability events.** Triggers already covered
      schedules, thresholds and availability changes; the ACTION side could only actuate, so
      "tell me when the tank is low" was inexpressible — the nearest an operator could write
      was a rule that moved a device they did not want moved, purely to make a run happen. A
      rule may now alert instead: it resolves no device, so it skips the tier gate, the
      ownership check and execution, all of which exist to govern moving something, and it
      keeps the run record and audit row so an alert that did NOT arrive is still visible as
      a run that happened. Delivered through the existing webhook dispatcher rather than a
      second path — that one already signs, retries, records every delivery and retires a
      dead endpoint, and the retirement is the part most likely to be got wrong twice.
      `automation.alert` is in the closed event set with a published conformance vector,
      because a dispatchable event without one fails the repo's own guard. **Reachable from
      the console**: "Just alert me" sits beside "One device" and "A zone", because being
      told is a peer of doing something rather than a lesser option. The client's action
      type declared `verb` as required, so every alert rule the hub returned rendered as
      "undefined unnamed target" — the type is honest now, which makes the compiler catch
      the next one, and a test holds the ORDER (notify before verb), which it cannot
- [ ] Camera-event alerting specifically — the trigger vocabulary covers device availability
      and sensor thresholds, not "motion seen" or "a clip was written", because the camera
      driver emits neither as an engine event yet
- [x] **Rate-limiting and scoping on movement commands.** The scoping half existed
      (`engineScope`); there was NO rate limit on `POST /v1/engine/devices/{key}/execute` at
      all, so a stolen token could loop `start` on a mower and nothing on that path would
      slow it — authentication and the tier ceiling both answer "may this caller do this",
      and neither answers "may they do it two hundred times a second". Now a cooldown per
      (caller, device, verb), scaled by tier: none at or below `TierReversible` because a
      dimmer slider legitimately streams `set` and a lamp cannot injure anyone, 3s at
      consequential, 10s at physical-access and above. It fails CLOSED, unlike the gate
      path's reviewed fail-open — there is no member-standing-at-their-own-gate argument
      for blades. Reuses `rate_limit_cooldowns`, so no migration. The console reads both new
      codes rather than falling through to "did not go through", which would have read as
      though a cooled-down command might have half-happened: `too_soon` says nothing was
      sent and when to retry, and `rate_limit_unavailable` names it as the operator's
      problem rather than one a member can retry past

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
