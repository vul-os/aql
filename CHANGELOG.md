# Changelog

All notable changes to Aql are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Entries before the fold describe this project under its former name, **lintel**. They
> are left as written — rewriting history to say "Aql" would make the record less
> accurate, not more. Older entries also use *gateway* as the product noun for the
> server; from the fold onwards the server is **the hub**, and as of the rename below
> the path, module and binary say so too.

---

## [Unreleased]

### Fixed — a controller with a corrupt state file crashed instead of refusing

`ed25519.Verify` **panics** on a public key that is not exactly 32 bytes rather than
returning false. Every key that arrives off the wire is length-checked by the decoder
that parses it; the one that is not is the *pinned* gateway key, which comes from
`state.json` on disk. A truncated write, a half-flushed SD card or a hand-edited state
file therefore killed the controller daemon on the first command it received — at a
physical gate — instead of refusing that command.

`wire.Verify` and `keys.Verify` now refuse an unusable key. That is the pin taken
literally: with no key to verify against, nothing can be authenticated, so nothing may
be accepted — including a valid command from the real hub. Held by
`TestAnUndecodablePinnedKeyRefusesInsteadOfPanicking`.

### Changed — one JCS canonicalizer in Go instead of three

Every signature in `proto/` is taken over RFC 8785 canonical JSON. Go had three
hand-copied implementations of it — `hub/internal/keys`, `controller/internal/jcs` and
`e2e/jcs.go` — kept apart on the argument that independence made the conformance
vectors meaningful. They were not independent: when the `json.Number` rounding bug was
fixed, it was fixed in two of the three, and the e2e harness — which signs as *both*
sides of the wire — canonicalised 2^53+1 to 2^53 for as long as it existed.

They are now one dependency-free module, `jcs/`, imported by all three. The
cross-implementation check that is real is the one across *languages*: Go, the app's
TypeScript (`src/lib/offline/jcs.ts`) and the vector generator's JavaScript
(`proto/vectors/lib.mjs`). All three are now held to `proto/jcs-cases.json`, which also
pins the one place they diverge on numbers rather than leaving it to be rediscovered.
See [`proto/JCS-PROFILE.md`](proto/JCS-PROFILE.md).

### Added — the outbound webhook wire format is specified and has vectors

[`proto/WEBHOOK-PROFILE.md`](proto/WEBHOOK-PROFILE.md) and
`proto/vectors/webhooks.json`: header names, the exact HMAC preimage, delivery and
retry semantics, and the SSRF discipline — enough to write a receiver without running a
hub. The hub's own constants are now checked against that published file, so renaming a
header is a failing test rather than a silent break for every receiver in the field.

Also added: [`proto/PAIRING-PROFILE.md`](proto/PAIRING-PROFILE.md) (the accountless
pairing + key-pinning ceremony, and how the pin is enforced rather than asserted) and
[`proto/vectors/HARNESS-PATTERN.md`](proto/vectors/HARNESS-PATTERN.md) (how this vector
harness is built, for anyone copying it).

### Fixed — documentation that described features as unbuilt long after they shipped

`ARCHITECTURE.md`, `docs/THREAT-MODEL.md`, `site/docs/api.md` and the console's own API
reference all still said there were no outbound webhooks and no scoped API tokens; the
architecture notes also listed geofences, online time-window rules, analytics and the
maintenance log as unbuilt, and the threat model said there was no 2FA. All of those
ship. The API reference additionally published a webhook-verification recipe that
signed the body alone — it would have rejected every real delivery, which carries the
timestamp inside the preimage.

### Fixed — login and registration were broken for anyone on a build after the email removal

Removing email identity renamed the hub's auth fields to `username`. The console
kept sending `email`. Because `readJSON` calls
`json.Decoder.DisallowUnknownFields()`, an unknown key does not get ignored — it
refuses the whole request, so **every login and every registration returned 400**.
It typechecked, the route existed, and every test in the repo was green.

If you were running a build between the email removal and this release, you could
not sign in. There is nothing to migrate: update and it works.

The same rename left blank fields across members, the account switcher and the
admin views, and left branches handling error codes the hub had stopped emitting
(`email_taken`, `invite_email_mismatch`).

Three new drift alarms exist because none of the existing ones caught it:
request-shape parity (the direction that 400s a whole endpoint), response-envelope
parity per endpoint, and error-code parity. They immediately found three more of
the same class, including two list endpoints that would have rendered empty
forever.

### Added — the device engine reaches real hardware protocols

Four drivers now ship, selected with `-device-drivers` and configured from one
JSON file via `-device-config`:

- **MQTT**, which also reaches **Zigbee and Z-Wave** through a `zigbee2mqtt` or
  `zwave-js-ui` bridge — no radio in the hub. A per-metric JSON field selector
  reads the bridge's per-device object, which is what those bridges actually
  publish.
- **Modbus TCP** — read-only, and structurally so: config accepts only
  capabilities whose whole verb set is `TierRead`, so the registry cannot route
  an actuating verb to one. No RTU; it needs a serial port, and the common serial
  deployment already works through a TCP-to-RTU bridge.
- **ONVIF cameras**, with an RTSP `DESCRIBE` probe (`VerifyStream`, off by
  default) so the hub reports what a camera actually streams rather than an
  address it never touched.
- **Generic HTTP/webhook**.

Plus discovery that writes nothing: an MQTT bridge scan that reads
`zigbee2mqtt/bridge/devices` and proposes candidates, and **mDNS controller
discovery** — controllers have advertised themselves for a long time and nothing
listened.

**No driver has met physical hardware.** They are tested against fakes, loopback
servers and an in-process Modbus TCP server. That proves the code agrees with the
protocol as written and proves nothing about the devices in your house.

### Added — automations and energy are reachable

Both runtimes had been complete and had no HTTP surface, so neither could be used.
Both now have one, and both have a console screen — including a rule editor, so
rules no longer have to be written by editing files on the hub.

The automations tier ceiling is unchanged and unchangeable: `MaxActionTier` is a
compile-time constant checked when a rule is saved and again immediately before
the driver call. Every access verb is above it, so **an automation cannot open a
gate**. The editor deliberately does not predict that — it offers every verb, the
hub refuses, and the refusal is shown in the hub's own words.

Energy carries every honesty field through to the caller: an unmeasured hour is
`null`, never `0`, and the console draws it as a gap rather than a zero bar.

### Added — five surfaces the hub served with no way to reach them

Scoped API tokens, two-factor auth, outbound webhooks, time-window rules and
geofence rules all shipped on the hub with handlers and tests, and the console had
no client for any of them. All five now have one, four have screens, and 2FA lives
in Settings.

Also new: **emergency access**. The offline-grant library was complete and nothing
imported it, so no user could obtain a grant — on the one path whose whole purpose
is working when the network is down, and which therefore has to be set up in
advance.

### Added — the GPIO relay is reachable, and refuses to lie

`-relay <chip>:<line>[,active-low][,bias=…][,sensor=<line>]` selects the real
Linux character-device driver. It had existed, tested, for a long time, and
nothing constructed it — every controller ran the mock.

**A controller told to drive a relay it cannot open now refuses to start**, and
there is deliberately no flag to soften that. The mock reports success for every
actuation: the command is acked, the hub writes an `opened` row into a
hash-chained audit trail, and the gate does not move. A gate that fails to open is
a fault someone fixes within the hour; a gate that reports opening while standing
still corrupts the record a dispute is settled with.

### Changed — the BLE peripheral now builds for Windows as well as Linux

Not a port. The backend is one file of portable `tinygo.org/x/bluetooth` calls and
the library ships real peripheral implementations for both. What confined it to
Linux was the **filename**: Go applies an implicit build constraint from a
`_linux.go` suffix that beats the `//go:build` line, so the tag was never
consulted elsewhere. Renaming the file was the change.

Still not hardware-validated on either platform. darwin remains unsupported —
CoreBluetooth has peripheral mode, that library does not bind it, and a CGO
binding nobody can test would be worse than the gap.

### Added — the four KOTVA §26.3 fields, declared in code

Every chat rail now declares whether it can contact a stranger, how it receives,
what it costs each way, and **who sees plaintext** — served at
`GET /v1/rails/disclosure`.

Self-hosting removes the middleman operator. It does not remove the platform:
Meta reads every WhatsApp message, Telegram every Telegram message. Tests fail any
exposure claiming "nobody", "only you" or "end-to-end", or failing to name a
concrete party.

### Added — the camera retention design

[`docs/CAMERA-RETENTION.md`](docs/CAMERA-RETENTION.md). No code implements it.
Recording is a data-retention policy with a UI attached, and the policy is now
decided: 72-hour default with no "keep forever", clips on the filesystem never in
SQLite, a free-space floor that stops recording rather than deleting unexpired
footage, `camera:view` as a permission **not** implied by owner or admin, and
every view audited in a log every member can read.


### Changed — the backend has one name: `hub`

The Go server was called three different things at once. `gateway/` on disk,
"the hub" in every sentence of the docs, and `LINTEL_*` in every environment
variable an operator has to type. One of those names belongs to a different
product — Pier is the gateway — and one belongs to a repo that was folded in
and deleted.

A name is not cosmetic when someone has to type it. `LINTEL_ENERGY_TZ`
configures a product that no longer exists, and a directory called `gateway/`
sends a reader looking for something this repo does not contain.

**Renamed**

- `gateway/` → `hub/`, `cmd/gateway` → `cmd/hub`. The binary is `aql-hub` and
  the Docker image is `aql-hub`.
- Go module `github.com/vul-os/aql/gateway` → `github.com/vul-os/aql/hub`.
- Environment variables `LINTEL_*` → `AQL_*`.
- Browser storage keys `lintel.*` → `aql.*`.
- Frontend `src/lib/gateway.ts` → `src/lib/hub.ts`,
  `components/gateway/GatewayGate.tsx` → `components/hub/HubGate.tsx`.
- The controller's `--gateway` flag → `--hub`.

**Nothing breaks on upgrade.** Three compatibility paths, each chosen for what
the thing actually is:

- *Environment variables.* `AQL_X` is read first; if unset, `LINTEL_X` is read
  and a single WARN names both. The hub cannot rewrite an operator's config, so
  it warns instead. No removal date is set — dropping the fallback is a breaking
  change and belongs in a release that says so.
- *Browser storage.* Read migrates forward: the value is rewritten under the new
  key and the old one deleted, so the fallback is used at most once per browser.
  Without this, every existing user would be signed out, lose the hub they had
  chosen and watch their theme flip — with nothing anywhere to explain it.
- *The controller flag.* `--gateway` still works and warns. A controller is a
  box screwed to a wall with a service file someone wrote once; a renamed flag
  means the unit fails to start after an upgrade, on hardware whose job is
  opening a door.

**Deliberately NOT renamed.** Three names still say the old thing because
renaming them would break something real:

- The wire identifiers `gateway_key`, `gateway_pubkey`, `gateway_ed`,
  `gateway_next`, `gateway_sync` and the route `GET /v1/gateway/key`. These are
  the frozen protocol a deployed door controller implements, pinned by
  `proto/vectors/*.json`.
- The mDNS service `_lintel._tcp`. It is normative in `proto/grants.md`, the
  phone app browses for exactly that string, and every deployed controller
  advertises it.
- The IndexedDB database `lintel.offline-access`. An IndexedDB name cannot be
  migrated on read — opening a different name creates an empty database and
  orphans the old one, destroying the app's signing key and every stored offline
  grant.

The last two matter most: both sit on the **offline** emergency path, which by
definition is in use when there is no network to push a fix over. A cosmetic
rename there hands someone a phone that silently cannot open the gate it was
authorised for, at the moment they can do nothing about it.

`src/lib/__tests__/naming.test.ts` enforces the rename and, just as importantly,
allows those exceptions by name — and asserts the wire identifiers still exist,
so the guard cannot be satisfied by deleting the thing it protects.


### Changed — positioning corrected: Aql is the hub, access control is its first module

A previous documentation pass rewrote this project as if it were a gate opener with a
device roadmap attached. That was backwards, and this pass reverses it.

**Aql is an open-source command centre for the physical world** — one self-hosted hub
meant to own everything physical around a home or a business. Its device model has seven
kinds: camera, lighting, robot, climate, energy, sensor and **access**. Access control is
one kind among seven. What the fold contributed is that it makes that one kind *genuinely
real* — signed commands, a paired controller that pins the hub's key, offline grants, a
tamper-evident trail. **It is the first working module, not the product.**

- `README.md` restored to Aql's own identity: the three-column framing (one hub owns
  everything / you own the box / works with any hardware, paired with Zana), the "software
  brain for your physical space" statement, and access control as a strong section rather
  than the headline.
- `ROADMAP.md` restored to the original phase arc — device engine → persistence & secrets
  → automations → energy → security & bots → remote access → mobile → Zana — with Phase 0
  recording honestly that a complete access-control module arrived via the fold, and a
  "Finishing Phase 0" section for the emergency-access loop, the GPIO driver and the BLE
  radio.
- The manual (`site/docs/`) rebalanced to read as a hub's manual. `devices.md` is now the
  chapter about what the hub owns (all seven kinds, with a status per kind) instead of an
  appendix of unbuilt things; `manifest.json` groups follow ("What the hub owns" now sits
  directly after "Start here", and chat moved to "Input surfaces").
- Corrected a stale figure repeated across the docs: the hub's suite is **219 Go tests**,
  not 183. 60 HTTP routes, 45 controller tests and 61 vectors / 68 checks were accurate.

### Changed — the server is "the hub", never "the gateway"

In the KOTVA family *gateway* names the §7 coordinator role — the legacy-rail adapter,
implemented by **[Pier](https://github.com/vul-os/pier)**. Aql's Go component is not
that: it owns devices, evaluates rules, keeps the audit log and issues signed commands.
All prose across the README, `ARCHITECTURE.md`, `ROADMAP.md` and the manual now says
**hub**. Unchanged, because they are compat surface: the `gateway/` directory, the Go
module path `github.com/vul-os/aql/gateway`, the binary and its `gateway verify-audit`
subcommand, the `aql-gateway` image, `AQL_*`, `lintel.db`, `_lintel._tcp`, the JWT
issuer and everything under `proto/vectors/`.

### Changed — the chat rail is moving to Pier (in progress)

The adapters that terminate WhatsApp, Slack and Telegram are being lifted out of Aql and
into Pier. Target shape: a resident texts a channel, Pier terminates that rail and hands
the hub an authorised command, and the hub checks the rules, signs, and actuates. Pier is
separate and swappable — run your own or point at one.

**The move is not finished, and the docs say so.** Texting a gate open works today; the
adapter code in `hub/internal/channels/` is transitional and is no longer documented
as the supported long-term path, and the Pier-backed path is not presented as shipped
either. `scripts/feature-claims.manifest.mjs` still carries `whatsapp-channel`,
`slack-channel`, `telegram-channel` and `slack-socket-mode` as shipped claims — the code
genuinely is still present, so those entries remain truthful and were deliberately left
alone rather than weakened to suit a doc pass.

### Changed — the fold: lintel becomes Aql's first real device kind

**lintel and Aql are now one repository and one product.** Nothing was thrown away on the
lintel side: the Go hub, the controller agent, the wire contracts, and every test came
across intact.

What moved the other way is smaller and worth stating plainly. **Aql's previous frontend —
a Tauri + SvelteKit shell — has been deleted**, and the shipped console (React 19 + Vite,
embedded in the hub) replaced it. Its in-memory demo dataset survived the move and was
ported over verbatim (`src/lib/demoData.ts`: twelve fictional devices across all seven
kinds), so the device, energy and automations views still exist — as demo data, marked as
such at the point of use, sitting beside real hub-backed access data. Any image under
The `assets/screens/` set pictured the retired shell and was scrubbed from history; `site/screenshots/` holds the current console. The Tauri v2 desktop
shell survives, now wrapping the real console, with a hub picker on first run.

### Changed — documentation reconciled to the merged product

- **Two doc sets, one rule.** `site/docs/` is **the manual** — the ordered, published set
  a person reads to install, wire and operate Aql, and the only set `site/docs.html`
  renders via `manifest.json`. `docs/` is **the deep reference** — threat model, KOTVA
  alignment, chat-command reference, design system — read in the repo. The root holds
  front matter, including the one canonical `ARCHITECTURE.md`. Stated in `docs/README.md`.
- Aql's six standalone pages (`ARCHITECTURE`, `CONFIGURATION`, `FAQ`, `GETTING-STARTED`,
  `SCREENSHOTS`, `THREAT-MODEL`) were folded into that structure rather than left
  alongside lintel's fifteen: the first five were merged into the manual and removed;
  `THREAT-MODEL.md` was rewritten and kept.
- **Two new manual chapters**: `devices.md`, covering all seven device kinds and stating
  the unbuilt engine honestly instead of implying it from a screenshot, and `faq.md`.
- Rebranded lintel → Aql across the manual, **except** the identifiers that are a
  deployment or wire contract: the `AQL_*` environment variables, the `lintel.db`
  filename, and the controller's `_lintel._tcp` mDNS service. Those were deliberately left
  alone — renaming them would break upgrades and force re-pairing for hardware already in
  the field. `hub/Dockerfile`'s `AQL_*` block is preserved for the same reason.
- Merged `lintel/CONTRIBUTING.md` and `lintel/SECURITY.md` into the root files (the fold's
  `git mv` had left them stranded behind same-named Aql scaffolds), rebranded, and pointed
  both at the dual **MIT OR Apache-2.0** licence.

### Fixed — honesty corrections found while merging

Each of these was a doc claiming something the code does not do:

- **The threat model claimed "no cloud broker sits between you and your devices" and
  scoped multi-tenancy out.** Both were false. The hub is genuinely multi-account, and
  every chat-initiated open routes through Meta, Slack or Telegram, who see the plaintext.
  `docs/THREAT-MODEL.md` now leads with the chat rail's exposure and keeps the
  genuinely-local claims (controller path, offline grants, no telemetry, no account)
  visibly separate from it.
- **The WhatsApp bridge engine was presented as a peer option.** It violates KOTVA
  §26.8.2's unconditional MUST NOT on unofficial WhatsApp client libraries and risks the
  operator's own number. It is documented — hiding a live code path would be its own
  dishonesty — but no longer as an equal or recommended choice.
- **"Rules engine" oversold the open path.** There is no rule object in the hub: no rules
  table, no per-member schedules, no online time windows. What exists is one fixed
  choke point plus numeric limits and visitor grants. Weekly windows live only inside
  offline grants and are evaluated by the *controller*. Documented as such.
- **The API reference claimed a 1,000 req/min soft token limit and that "opens are never
  denied because of rate limits".** Neither is true; opens are limited exactly as chat is.
- **The GPIO relay driver was described as a "scaffold".** It is a stub that panics by
  design, and the default build only logs. No build in this repository has ever actuated
  real hardware.
- **The screenshots page captioned `/app/open` as an offline emergency-access screen.**
  That screen does not exist. The Analytics screenshot's endpoints do not exist either;
  both are now flagged in place.
- **Several docs still described a `backend/` directory** (the retired Cloudflare Workers
  + Postgres reference) as live. It has been deleted; those references are gone.
- **`security.md` linked to a safety addendum "appended to LICENSE".** No such addendum is
  in the file; the link now points only at the README's Safety section.
- The licence is stated as **MIT OR Apache-2.0** everywhere, matching `LICENSE-MIT`,
  `LICENSE-APACHE` and `package.json` — not the bare single-MIT `LICENSE` copy left by
  Aql's scaffold.

### Changed — CI

- Moved the workflows out of the stranded `lintel/.github/` into the repository root.
- **Removed the `backend` and `backend-integration` jobs.** They tested the Cloudflare
  Workers backend that was deleted in the fold, and took the Postgres 16 service
  container, the `DATABASE_URL` / `JWT_SECRET` env, and the `lintel_internal` role
  bootstrap with them.
- **Re-added a `rust` job** for the Tauri shell — WebKitGTK/GTK system deps, `cargo fmt
  --check`, `clippy -D warnings`, `cargo check`, with a Vite build first because
  `frontendDist` must exist before cargo can configure.
- The `frontend` job now matches the real toolchain: npm + Vite + React (`npm run
  typecheck`, `npm test`, `npm run build`), keeping the Go toolchain step the route-parity
  test needs.
- Dropped the "skip cleanly if the module isn't present" guards from the `gateway`,
  `controller` and `e2e` jobs — all three modules exist now, so a missing module should
  fail rather than pass silently.
- `docker.yml` and `release.yml` publish `aql-gateway` / `aql-controller` / `aql_*.dmg`
  artifacts. The image's own `AQL_*` runtime env block is untouched, and both files say
  why.

## [0.1.0] — 2026-07-21

First versioned release. lintel is a self-hosted physical access-control system:
a resident texts a chat channel (WhatsApp, Slack or Telegram), the Go gateway
checks the rules, signs an Ed25519 command, and a controller at the gate opens
it. One MIT Go binary, SQLite inside, no cloud and no billing.

This release also marks the rename from the project's former name and a
suite-wide audit that reconciled documentation, the web portal, and the gateway
against each other.

### Added
- **Gateway-side offline-grant issuance** (`POST /v1/offline-grants`) — the
  gateway now mints Ed25519-signed grants, verified byte-for-byte against the
  `proto/vectors/` conformance fixtures the controller already enforces. This
  closes three of the four pieces of the offline emergency path (contract,
  controller redemption, and gateway issuance). The phone-side app client that
  holds and presents a grant over LAN/BLE is **not yet built**, so offline
  access does not run end to end today.
- **Tamper-evident audit log** — `access_logs` and `admin_audit_log` carry a
  `prev_hash`/`row_hash` chain plus append-only database triggers that reject
  direct `UPDATE`/`DELETE`. Verify with `GET /v1/admin/audit/verify` or the
  `gateway verify-audit` CLI, which checks a cold backup without booting the
  server. Honest ceiling: the chain makes tampering *detectable*, not
  impossible — an attacker who edits the database and recomputes every
  downstream hash is not stopped by it.
- **Login brute-force protection** — per-IP and per-account rate limiting on
  `login`/`register`/`refresh`/`admin-claim`, fail-closed, structured so an
  attacker cannot cheaply lock a victim out.
- **Live session revocation** — `requireAuth` re-checks live user status per
  request; `POST /v1/auth/logout-all` revokes every refresh-token family.
- **Pluggable WhatsApp engine** — Meta Cloud API by default, with an opt-in
  self-hosted bridge engine (Evolution-API-shaped) that logs a blunt
  account-ban-risk warning on startup. The bridge is untested against a live
  instance.
- **Route-parity, feature-claim, and browser-E2E checks** in CI — a
  mechanical guard that every portal API call targets a real gateway route, a
  guard that documented features have code behind them, and a Playwright suite
  that drives the real embedded-portal binary through signup → open → audit.
- **Failure-semantics specification** for all four `proto/` wire contracts
  (partition mid-command, key rotation vs pinning, in-flight grants vs
  revocation, reconnect/clock), plus a draft DMTAP-channel binding.
- **Safety notice** in the README and a LICENSE addendum: lintel actuates
  physical barriers and must never be the sole egress path — it must run in
  parallel with code-compliant fail-safe hardware.

### Changed
- Renamed to **lintel** across the codebase, Go module path, container image,
  environment-variable prefix (`AQL_*`), and product site
  (`vulos.org/products/lintel`). The WhatsApp channel integration is unchanged;
  only the product name moved.
- **Web portal API client rewritten** — every call had been targeting a retired
  backend's route scheme and could not reach the shipped Go gateway (nested
  auth-token shape, Unix-seconds timestamps, `/v1` prefix). Now correct and
  guarded by the route-parity test.
- **Documentation reconciled to shipped reality** — corrected capability claims
  that described unbuilt features (geofencing, built-in TLS/ACME, CSV export,
  recurring time windows, Discord, mobile apps, webhooks) and strengthened
  claims that undersold real ones (Slack Socket Mode, Telegram, the running Go
  gateway).

### Fixed
- Channel opens were audited with the wrong source tag (Telegram/Slack visitor
  opens logged as WhatsApp).
- A signed-out user hitting `/app/*` got a permanent loading spinner instead of
  a redirect to login.
- Late controller acks now reconcile the audit row (append-only) instead of
  being dropped; an emergency open records durably before actuating; backward
  clock resets no longer bypass the stale-clock guard.

### Security
- The gateway refuses to bind a non-loopback address unless `-behind-proxy`
  (env `AQL_BEHIND_PROXY`) is set. The binary serves **plain HTTP** — there
  is no built-in TLS; terminate TLS in a reverse proxy. Documentation corrected
  accordingly.
- Disclosure contact and secret-file guidance corrected (the Ed25519 signing
  key and JWT secret live in the data directory, not `.env`).

[Unreleased]: https://github.com/vul-os/aql/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vul-os/aql/releases/tag/v0.1.0
