# Changelog

All notable changes to Aql are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Entries before the fold (see Unreleased) describe this project under its former name,
> **lintel**. They are left as written — rewriting history to say "Aql" would make the
> record less accurate, not more. That also means older entries use *gateway* as the
> product noun for the server; from the fold onwards the server is **the hub**, and only
> the `gateway/` path, the Go module path and the binary name keep that spelling.

---

## [Unreleased]

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
implemented by **[Ephor](https://github.com/vul-os/ephor)**. Aql's Go component is not
that: it owns devices, evaluates rules, keeps the audit log and issues signed commands.
All prose across the README, `ARCHITECTURE.md`, `ROADMAP.md` and the manual now says
**hub**. Unchanged, because they are compat surface: the `gateway/` directory, the Go
module path `github.com/vul-os/aql/gateway`, the binary and its `gateway verify-audit`
subcommand, the `aql-gateway` image, `LINTEL_*`, `lintel.db`, `_lintel._tcp`, the JWT
issuer and everything under `proto/vectors/`.

### Changed — the chat rail is moving to Ephor (in progress)

The adapters that terminate WhatsApp, Slack and Telegram are being lifted out of Aql and
into Ephor. Target shape: a resident texts a channel, Ephor terminates that rail and hands
the hub an authorised command, and the hub checks the rules, signs, and actuates. Ephor is
separate and swappable — run your own or point at one.

**The move is not finished, and the docs say so.** Texting a gate open works today; the
adapter code in `gateway/internal/channels/` is transitional and is no longer documented
as the supported long-term path, and the Ephor-backed path is not presented as shipped
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
  deployment or wire contract: the `LINTEL_*` environment variables, the `lintel.db`
  filename, and the controller's `_lintel._tcp` mDNS service. Those were deliberately left
  alone — renaming them would break upgrades and force re-pairing for hardware already in
  the field. `gateway/Dockerfile`'s `LINTEL_*` block is preserved for the same reason.
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
  artifacts. The image's own `LINTEL_*` runtime env block is untouched, and both files say
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
  environment-variable prefix (`LINTEL_*`), and product site
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
  (env `LINTEL_BEHIND_PROXY`) is set. The binary serves **plain HTTP** — there
  is no built-in TLS; terminate TLS in a reverse proxy. Documentation corrected
  accordingly.
- Disclosure contact and secret-file guidance corrected (the Ed25519 signing
  key and JWT secret live in the data directory, not `.env`).

[Unreleased]: https://github.com/vul-os/aql/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vul-os/aql/releases/tag/v0.1.0
