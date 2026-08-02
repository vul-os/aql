<!-- no-broker-dep:allow-file: lists `vulos-relayd` as one of several tunnel-based reachability
     alternatives (alongside cloudflared and Tailscale Funnel) beside the recommended
     reverse-proxy setup — illustrative deployment prose, no default, no import. -->

# Aql hub

The whole hub as **one Go binary**: channels, rules, portal, API,
device hub, audit — backed by **one SQLite file**. See `../ARCHITECTURE.md`
for the full picture.

There is no `backend/`. A Cloudflare Workers + Postgres backend was the
behavioural reference this was ported from and has been deleted; `ARCHITECTURE.md`
§2 says so, and this paragraph claimed the opposite for long enough to survive
the sweep that fixed the others.

## Status: product core ported

The product core is ported from the Workers backend onto Go + SQLite: accounts
/ members / invites, locations / quotas, access points, devices + pairing +
the controller WebSocket hub, **the open path** (verdict → signed envelope →
device), temporary grants, and the platform-admin console. `go build ./...`,
`go vet ./...`, `go test ./...` are green (default build). `-tags portal`
builds and tests green **once the bundle exists** — run `make -C hub portal`
first, or the embed fails with `pattern all:dist: no matching files found`.
Nothing under `internal/portal/dist/` is committed, on purpose: see
`internal/portal/portal_embed.go` for why a compile error beats a placeholder
that would let the wrong page ship quietly.

The chat channels are now ported too, and one exceeds the backend spec:
**WhatsApp, Slack (Events API + Socket Mode), Telegram (webhook or dial-out
polling) and Discord (dial-out Gateway — not in the Workers backend at all)**
all funnel opens through the same open-path choke point. See **Chat
channels** below.

Remaining (not blocking the core): device-fed movement metering. Calling it
"remaining" undersells what it needs, so plainly: a controller reports that a
relay pulsed, not how far a leaf travelled. There is no `access_point_meters`
table, no protocol event that could carry a distance — `proto/events.md` defines
none, not even a reserved one — and no sensor to produce it. It is blocked on
hardware, unlike `held_open`, which now ships: the GPIO driver has the position
sensor and `-held-open-after` starts a watcher that emits the event. Until then `meter.movement_m` is null rather than a
fabricated zero, and maintenance intervals by distance are refused with
`movement_not_measured`.

The Vite bundle used to be on this list: it now goes into
`internal/portal/dist/` in the container build and the release workflow, so
every shipped artifact serves the real console rather than the placeholder. See the
porting map below. (Phone verification, analytics, maintenance records and
password reset all shipped since the paragraph above was last true — see
**Chat channels** and the porting map.)

**Works today**

- `cmd/hub` — flags-over-env config, first-boot data dir bootstrap
  (SQLite db, Ed25519 hub signing key, JWT secret; all `0600/0700`), serve.
- `internal/store` — pure-Go SQLite (`modernc.org/sqlite`, no CGO, so
  `CGO_ENABLED=0` cross-compiles), embedded migrations (`go:embed`),
  **app-layer tenancy**: every tenant-data method takes an `accountID` and
  scopes its SQL to it (replaces Postgres RLS; cross-tenant reads are
  indistinguishable from not-found).
- Auth core, real not stubbed: argon2id password hashing (PHC format),
  HS256 JWT (std-lib HMAC, header pinned — no alg confusion), rotating
  refresh tokens with family reuse-detection, per-IP + per-account brute-force
  throttles on the credential endpoints (fail-closed), and per-request live
  revocation (a disabled user's still-valid token stops working on their very
  next request, not at token expiry).
  `POST /v1/auth/{register,login,refresh,logout,logout-all}`, `GET /v1/auth/me`.
  See **Auth & session security** below for the throttle env vars and what
  `logout-all` actually revokes.
- One-shot instance-admin claim per the backend's semantics:
  `GET|POST /v1/admin/claim` — fail-closed when `ADMIN_CLAIM_TOKEN` is unset,
  constant-time token compare, atomic win, burned permanently via the
  `admin_claimed` flag in `instance_settings`.
- `internal/keys` — the hub's Ed25519 identity generated at first boot,
  `GET /v1/gateway/key`, and signed command envelopes per
  `../proto/commands.md` (nonce, iat/exp with the 60 s cap, JCS
  canonicalization).
- `internal/portal` — `go:embed` seam serving a placeholder page at `/`;
  the real React portal bundle (`../src`, Vite) drops in here later — see
  **Build modes** below.
- `GET /health` → `{"ok":true,"version":...}`.

**JCS note**: `internal/keys/jcs.go` no longer implements anything — it
delegates to `github.com/vul-os/aql/jcs`, the one canonicalizer this repository
has (`require` + relative `replace` in `go.mod`). `internal/keys/vectors_test.go`
byte-compares its output against every `canonical` field in `../proto/vectors/`,
and the shared edge cases in `../proto/jcs-cases.json` are checked in the module
that owns the code. Documented deviation, unchanged: general (non-integer)
number formatting is rejected rather than implemented — envelopes only carry
integers and strings. Full detail, including where the TypeScript and
JavaScript implementations diverge from Go: [`../proto/JCS-PROFILE.md`](../proto/JCS-PROFILE.md).

**Proving a test can fail.** `scripts/tamper.sh FILE OLD NEW -- go test ./pkg/`
breaks something on purpose and reports whether a test noticed. It refuses to
give a verdict it has not earned: `CAUGHT`, `NOT CAUGHT` (the guard is blind),
or `INVALID` when the tamper did not apply, changed nothing, or did not compile
— which are the three ways a hand-run tamper quietly reports success while
testing nothing. The file is restored on any exit, including Ctrl-C.

**Checking a backup before you need it.** `aql-hub verify-restore -data DIR`
answers "can this directory start a hub without losing anything", from the copy,
without starting a server. It reports the two losses that are unrecoverable
rather than inconvenient: a missing `gateway_ed25519.seed` on a hub that has
paired controllers (starting it mints an identity none of them trusts, and the
`repair` that would move them must be signed by the key that is gone), and a
missing retained key while a rotation is recorded (every controller that had not
repaired is unreachable and unrepairable). A missing `jwt_secret` is reported as
harmless, because it is — sessions end and people sign in again.

It also runs SQLite's `integrity_check` on the copy, because a backup can be
damaged rather than incomplete and the two look nothing alike from outside. A
`cp` of a live database, a partial write or a bad sector can leave a file that
opens, answers every question this command asks about keys and pairing, and is
still missing a page — measured, not assumed. Damage to the tail fails at open;
damage in the middle used to pass silently.

**Copy the directory, not the database file.** The hub opens SQLite in WAL mode,
so recent writes live in `lintel.db-wal` until a checkpoint folds them in. A hub
that has been up for a few minutes can have a 4 KiB `lintel.db` sitting beside a
1.9 MiB `lintel.db-wal` — that is a measurement from the test suite, not an
estimate. Copying "the database" then gives you a file that opens, reports zero
integrity faults, and does not contain your tables, because an empty database is
a perfectly valid one. `verify-restore` prints the WAL's size when it is present
and says so plainly when it is not: an absent `-wal` means either a clean
checkpoint or a copy that left it behind, and those are identical on disk.

It opens the database READ-ONLY and does not migrate it: the directory you are
asking about may be the only copy you have. Run it after every restore, and
after taking a backup if you want to find out then rather than later.

**Encrypting the signing key at rest.** Generate a key with `aql-hub
gen-data-key` — it prints one base64 32-byte key and writes nothing, so
`aql-hub gen-data-key > /run/secrets/aql-data-key` puts it where you want it.
Until that subcommand existed this paragraph asked for a key and left you to
invent the format. Set `AQL_DATA_KEY` to it — it accepts
`${file:/run/secrets/aql-data-key}` like any device secret —
and the hub seals `gateway_ed25519.seed` with AES-256-GCM. A plaintext seed is
sealed in place the first time it starts with a key set, so turning this on is
setting a variable rather than running a migration. Leave it unset and nothing
changes.

Be exact about what it buys: it protects the data directory once it has LEFT the
running host — a stolen disk, a snapshot, a `tar czf`. It does not protect
against anyone who can read the hub's environment or the key file it points at,
because the hub must decrypt unattended. There is no passphrase prompt on
purpose: this software opens gates, and a hub that will not come back after a
power cut until somebody drives out to it is worse than one whose key root can
read.

The same key seals `jwt_secret`. Its axes point opposite ways: losing it is
harmless (sessions end, people sign in again) while leaking it lets anyone mint
a session for any user, so it is worth encrypting for the stolen-backup case
even though it is not worth backing up carefully.

**Losing the data key is losing the hub's identity.** A sealed seed with no key
REFUSES to start and says so — it never mints a replacement, because a hub no
paired controller obeys is the outcome this whole design avoids. Keep the key
somewhere other than the backup it protects, and run `verify-restore`: it
resolves `AQL_DATA_KEY`, parses it, and actually DECRYPTS the seed with it, so a
`${file:}` pointing somewhere that is not mounted, a truncated paste and the
wrong key are each reported — with the different thing each one needs you to
do — rather than all reading as "the variable is set".

**Device secrets.** Any credential in `-device-config` may be a reference instead
of a value: `${env:NAME}` reads an environment variable, `${file:/path}` reads a
file and trims the trailing newline every way of making one adds. It applies to
the MQTT password, ONVIF camera passwords and HTTP device headers. Anything not
matching those two forms is used literally, so a password containing a brace is
still a password. A reference that cannot be resolved refuses the whole file —
never an empty credential, because a broker that accepts anonymous connections
would take one and the hub would report success.

**Schema** (folded migrations, `internal/store/migrations/`).

**Adding one: new state gets a new TABLE, never a column on a shipped one.** A
column added to a table that already has rows is a change every existing row
silently participates in, and the migration has to invent a value for all of
them — which is a claim about the past. `0028` makes the argument for a consent
flag, where a backfilled `1` would assert that locations agreed to something
nobody asked them; `0032` makes it again for a revocation sequence, where a
backfilled `0` would claim every controller holds a revocation none of them may
have. A new table starts empty, so there is no default to get wrong.

Changing a CONSTRAINT is the one case that needs more: SQLite cannot widen a
`CHECK` in place, so `0029` creates a replacement table, copies row by row,
drops the original and renames. That is the supported shape, and the rename is
the swap rather than a way to smuggle a column in.
`TestNoMigrationAltersAShippedTable` holds both halves — the rule was written in
four migration comments before it was mechanised, which is four places nobody
reads *before* writing a migration.


- `0001_baseline.sql` — users, profiles, accounts, account_members, locations,
  access_points, devices, access_logs, refresh_tokens, instance_settings.
- `0002_members_invites_settings.sql` — location_members, location_settings
  (quota columns), account_invites, profile_phone_numbers (+ one-verified-owner
  unique index).
- `0003_openpath.sql` — temporary_access_grants (+ access-point join),
  rate_limit_counters, rate_limit_cooldowns.
- `0004_admin_audit.sql` — admin_audit_log.
- `0005_channels.sql` — channel_identities (`(channel, external_id)` →
  profile), channel_chats + channel_messages (chat/message log, inbound dedupe
  via a partial unique index on `(channel, provider_message_id)`).
- `0006_late_ack_reconcile.sql` — `reconciles_log_id` self-reference on
  `access_logs` for late `cmd.ack` reconciliation: a verified ack that arrives
  after the ack-wait deadline lands as a **new** row referencing the original,
  never a mutation of it.
- `0007_audit_hash_chain.sql` — tamper-evident hash chain + append-only DB
  triggers for `access_logs` and `admin_audit_log` — see **Tamper-evident
  audit log** below.

Still deferred: countries. `oauth_identities` is NOT deferred — Google OAuth is not
planned (ROADMAP says why: identity is a local username, and a gate must open during
an outage),
device_commands (dispatch is in-memory via the hub for now), and
access_point_meters (device-fed movement metering). `auth_recovery_tokens`
(`0009_auth_recovery.sql`) and `maintenance_events` (`0017_maintenance.sql`)
have since landed — see the porting map. (The channel chat/message tables
landed in `0005_channels.sql`.)

## Chat channels

The channel seam (`internal/channels`) is deliberately small: authenticate an
inbound webhook (fail-closed), turn a message into an intent, render a reply.
Everything behind it is channel-agnostic — **every open, on every channel,
funnels through the one `store.LogAccess` choke point** (`store/openpath.go`)
the HTTP `/v1/.../open` route uses, then the same sign-and-dispatch to the
controller. A channel decides how to ask and how to reply; it never decides
whether the gate may open. Identity is keyed on `(channel, external id)`
(`channel_identities`), except WhatsApp whose identity is the **verified phone**
(`profile_phone_numbers`).

A rail only answers people it recognises, and recognition has to be earned
once per identity, not assumed. `POST /v1/phones/me/link` (`internal/httpapi/phones.go`,
migration `0018_phone_link_codes.sql`) is that ceremony for WhatsApp: the
console mints a short code (proving an authenticated session on this
account) and the member sends it to the bot from the number being linked
(proving control of the number, via the provider's signature on the inbound
webhook). It is **not SMS OTP** — the hub sends no SMS and no email, ever;
the "verification" is a code round-tripped through the chat rail itself.
Telegram, Slack and Discord identities are linked the same way, one level up
(`internal/httpapi/channellink.go`, migration `0020_channel_link_codes.sql`):
a twelve-character code minted from the console, redeemed from the platform
account itself.

| Channel | Endpoint(s) | Auth (fail-closed) | Identity |
| --- | --- | --- | --- |
| WhatsApp | `GET/POST /webhooks/whatsapp` | `X-Hub-Signature-256` HMAC (app secret); GET verify-token handshake; `phone_number_id` filter | verified phone |
| Slack | `POST /webhooks/slack` + `/webhooks/slack/interactions`, **or Socket Mode** | signing secret, 300 s replay window (missing headers never skip); Socket Mode uses the app token | `slack_user_id` |
| Telegram | `POST /webhooks/telegram`, **or dial-out long-poll** (`AQL_TELEGRAM_ENGINE=polling`) | `X-Telegram-Bot-Api-Secret-Token` on the webhook; the bot token itself authenticates `getUpdates` on the poll path | telegram user id |
| Discord | dial-out Gateway WebSocket only — no webhook, no inbound port at all | `Authorization: Bot <token>`; the bot token is the entire trust root on the way in | discord snowflake |

- **WhatsApp** ports the full conversational contract from the retired Workers
  backend's `routes/whatsapp.ts` (deleted — see `../ARCHITECTURE.md` §2): interactive **list picker** for multiple
  access points, location select, welcome / linked-locations copy, unlinked
  **signup prompt**, **visitor grants** (consume + refund-on-denial), honest
  denial replies (`rate_limited`/`quota_exceeded`/`account_suspended`/
  `user_disabled` — exact strings), message-id **dedupe**, and the flood
  throttle (bot goes quiet past the per-minute cap, webhook still `200`).
- **Slack** runs the Events API + interactions webhooks, **and Socket Mode**.
- **Telegram** — the Workers backend is an honest stub (links, logs,
  flood-throttles, replies `success`/`failed`). **This hub wires it to the
  REAL open path**: a linked user's `open` runs the choke point, with an
  inline-keyboard picker when several gates are available and callback taps
  re-entering the same path. This **exceeds the backend stub**. It also has a
  second transport the backend never had: `AQL_TELEGRAM_ENGINE=polling` swaps
  the authenticated webhook for a dial-out long-poll against `getUpdates`, the
  same no-inbound-port shape as Slack Socket Mode, for a hub with no public URL.
- **Discord** has no equivalent in the Workers backend at all — this hub adds
  it whole. It dials out to the Discord Gateway (`internal/channels/discord_gateway.go`)
  and never opens an inbound port: no webhook, no Interactions Endpoint URL
  configured in the developer portal. Component taps (button presses) arrive
  as `INTERACTION_CREATE` dispatches over the same held-open socket. The
  origin of an inbound message is platform-asserted only — Discord's snowflake
  is a lookup key into `channel_identities`, never a signature — the same
  standing Slack and Telegram user ids already have here.

### Slack Socket Mode — the zero-URL install (ARCHITECTURE §4)

If `SLACK_APP_TOKEN` (an `xapp-…` app-level token) is configured, the hub
**dials out** to Slack over a single outbound WebSocket instead of receiving
webhooks: `apps.connections.open` → `wss://…` → receive `events_api` /
`interactive` envelopes → ack each `envelope_id` → feed the payload through the
**same** handlers the webhook uses. A hub on a LAN with **no public URL**
still runs Slack fully — this is what makes "a Pi on the estate LAN is a
complete installation" real. It is gated behind config (no token → no dial),
uses `github.com/coder/websocket` (the hub's existing dependency), and is
launched by `Server.StartChannels(ctx)` from `main` with automatic reconnect.

### Configuration (env, names match the backend where the backend has the feature at all)

```sh
# WhatsApp (Meta Cloud API)
WHATSAPP_APP_SECRET=…          # HMAC secret for POST webhooks (required to accept)
WHATSAPP_VERIFY_TOKEN=…        # GET handshake token
WHATSAPP_ACCESS_TOKEN=…        # Graph send (unset → outbound is a logged no-op)
WHATSAPP_PHONE_NUMBER_ID=…     # ours; other numbers on the WABA are ignored
WHATSAPP_GRAPH_VERSION=v21.0   # optional

# Slack
SLACK_SIGNING_SECRET=…         # required to accept webhooks (fail-closed)
SLACK_BOT_TOKEN=xoxb-…         # chat.postMessage
SLACK_APP_TOKEN=xapp-…         # OPTIONAL → enables Socket Mode (zero public URL)

# Telegram
TELEGRAM_BOT_TOKEN=…           # Bot API send
TELEGRAM_WEBHOOK_SECRET=…      # must match the secret_token you register
AQL_TELEGRAM_ENGINE=polling    # OPTIONAL, hub-only (no backend equivalent) → dial-out
                                #   getUpdates instead of the webhook; unset/misspelled
                                #   keeps the webhook

# Discord — hub-only, no backend equivalent at all
DISCORD_BOT_TOKEN=…            # the entire trust root; dial-out Gateway only, no other config
```

**WhatsApp also has an opt-in `AQL_WHATSAPP_ENGINE=bridge` mode** —
`AQL_WHATSAPP_BRIDGE_URL` / `AQL_WHATSAPP_BRIDGE_API_KEY` /
`AQL_WHATSAPP_BRIDGE_INSTANCE` point it at a self-hosted bridge (target:
Evolution API) instead of the Meta Cloud API. Selecting it logs a startup
warning naming the risk, and this README is **not** recommending it: it
routes traffic through a reverse-engineered client, violates KOTVA
§26.8.2's unconditional MUST NOT, and risks the linked number being banned.
See `../docs/THREAT-MODEL.md` § Reducing chat-rail exposure and
`../site/docs/linking-whatsapp.md` before turning it on. The default,
`AQL_WHATSAPP_ENGINE=cloud` (or unset), is the Meta Cloud API row documented
above and carries none of that risk.

Every sender no-ops (returns a logged `…_unset` error) when its credentials are
unconfigured, so a half-configured install still records replies without
crashing — exactly the backend's behaviour.

## Build / run / test

```sh
make build                       # CGO_ENABLED=0 go build -o bin/aql-hub ./cmd/hub
make test                        # or: go test ./...
./bin/aql-hub -data ./data -listen :8080
```

Config (flags override env):

| Flag | Env | Default | |
| --- | --- | --- | --- |
| `-data` | `AQL_DATA_DIR` | `./data` | SQLite db + keys live here |
| `-listen` | `AQL_LISTEN` | `:8080` | listen address |
| `-public-url` | `AQL_PUBLIC_URL` | — | external base URL (webhooks, links) |
| `-admin-claim-token` | `ADMIN_CLAIM_TOKEN` | — | one-shot admin claim; empty = claiming disabled |
| `-behind-proxy` | `AQL_BEHIND_PROXY` | `false` | permit binding a non-loopback `-listen` address — only set this when TLS is terminated upstream by a reverse proxy; see **Deployment & TLS** below |
| `-device-drivers` | `AQL_DEVICE_DRIVERS` | — | comma-separated device drivers to construct (`access`, `camera`, `http`, `modbus`, `mqtt`); empty disables the device engine entirely |
| `-device-config` | `AQL_DEVICE_CONFIG` | — | path to the JSON device-driver config file; required by every driver **except `access`**, which is built from the database rather than a file |
| `-energy-account` | `AQL_ENERGY_ACCOUNT_ID` | — | account id the energy poller writes meter readings under; empty disables polling |
| `-automations` | `AQL_AUTOMATIONS` | `false` | run the automation rule scheduler (tick interval: `AQL_AUTOMATIONS_INTERVAL`, default 30s) |

Three more settings have no flag and are environment-only. They were documented
in `cmd/hub/main.go`'s header and nowhere an operator would look:

| Variable | Default | What it does |
| --- | --- | --- |
| `AQL_DEVICE_REFRESH_INTERVAL` | `5m` | how often every driver is re-discovered — how quickly a device that came back on the network reappears, and how quickly one that went away stops being asserted as live |
| `AQL_CLOCK_SYNC_INTERVAL` | `6h` | how often each paired controller is pinged to prove its clock advanced. A controller that goes 14 days without a proof refuses **every** offline emergency grant it holds — at the gate, with the person standing there — so the default is deliberately far inside that budget. Shorten it for a fleet on links that drop for days; there is no reason to lengthen it, since a ping costs one signed envelope and one ack |
| `AQL_ENERGY_INTERVAL` | `60s` | meter polling interval |
| `AQL_ENERGY_SAMPLE_RETENTION` | `30d` | how long raw meter samples are kept before pruning. Deltas and a per-channel anchor sample survive, so history stays correct; `0` keeps everything forever |
| `AQL_ENERGY_TZ` | UTC | the IANA timezone (`Africa/Johannesburg`) the hour/day/month rollup buckets are anchored to. **Set this before you start metering.** Left unset, a "day" of energy runs midnight-to-midnight UTC, so every daily and monthly total splits at the wrong hour for anybody not on UTC — and the numbers look plausible rather than wrong. Changing it later does **not** fix the history: the timezone is part of each rollup's identity in the database, every query filters on the current one, and rollups are only recomputed when new samples arrive for a bucket. The old rows stay where they are, correct and invisible. The hub warns at startup if metering is running without this set |

Every `AQL_*` variable above still accepts its old `LINTEL_*` name: if `AQL_DATA_DIR` is
unset, the hub reads `LINTEL_DATA_DIR` instead and logs a `WARN` naming both, once, after
startup (`lookupEnv`/`warnLegacyEnv` in `cmd/hub/env.go`). The old names are deprecated —
no removal date has been decided — so an install still typing `LINTEL_*` keeps working.

### Running the gates

```bash
npm run check      # every local gate, one command
```

Fourteen of them across four modules — gofmt, vet, build and tests for `hub/`,
`controller/` (including the `gpio` and `ble` tagged builds) and `e2e/`, the wire
vector verifier, plus tsc, vitest and the feature-claims check. Each prints a
line whether it passes or fails, because a gate that silently does not run is the
failure this exists to prevent.

It is not everything CI runs. The race detector across all three modules, fuzz
seeds, the cross-platform builds, Playwright and the container image are CI-only
— they are too slow to sit in front of every commit.

### Subcommands

```
aql-hub verify-audit [-data DIR]
aql-hub 2fa disable -user NAME -reason TEXT [-data DIR]
aql-hub energy rebucket -account ID [-tz ZONE] [-dry-run]
```

**Every subcommand refuses a directory with no `lintel.db` rather than creating
one.** Pointed at a wrong path or an incomplete backup they would otherwise
answer a question about a database they had just made: `verify-audit` reported
`OK (0 rows)` for chains that never existed, `2fa disable` said "no such user"
when the truth was "no hub here", and `energy rebucket` said "no account on this
hub". All three also wrote into a directory you asked them only to read.

Anything else that is not a flag is refused with exit 2 and that list. It has to
be: the hub takes no positional arguments, so a mistyped subcommand used to fall
through and **start a server** — writing a fresh signing key and running
migrations into whatever `-data` pointed at. `verify-audit` is meant to be run
against a cold backup, which is exactly the directory you would least like that
to happen to.

### `aql-hub energy rebucket -account ID`

The way back if you set `AQL_ENERGY_TZ` after metering had already been running.

Rollups carry their timezone in their identity and every read filters on the one
configured now, so changing it leaves the history in the database keyed to a zone
nothing asks about — the console shows a hub that has metered for months as
having no past. This marks the retained span for recomputation under the current
zone and rebuilds it from the raw samples.

```bash
aql-hub energy rebucket -account <id> -dry-run   # report the span, change nothing
aql-hub energy rebucket -account <id>
```

**It cannot recover everything, and it says which part.** Rollups are rebuilt from
samples, and samples are pruned on `AQL_ENERGY_SAMPLE_RETENTION` (30 days by
default). Anything older than the oldest surviving sample is unrecoverable in any
zone. The command prints the span it can cover *before* it starts, so a long run
does not bury the part you need to know.

Safe to re-run: it queues work rather than writing rollups, it leaves the buckets
under the previous zone untouched, and an interrupted run is finished by running
it again.

First-boot claim flow: register a user, then
`POST /v1/admin/claim {"token": "<ADMIN_CLAIM_TOKEN>"}` with that user's
bearer token. Exactly one caller can ever win; the mechanism burns forever.

## Deployment & TLS

This binary serves **plain HTTP only** — there is no built-in TLS/ACME code at all.
Because of that, `-listen` **refuses to start** on anything but a loopback address
(`127.0.0.1`, `::1`, `localhost`, or a hostname that resolves *exclusively* to
loopback addresses) unless `-behind-proxy` (env `AQL_BEHIND_PROXY=1`) is set —
binding a public interface here in plain HTTP would otherwise silently serve the
admin portal, login and signing API in cleartext. `checkListenAddr` in
`cmd/hub/main.go` resolves the address the same way `net/http.Server` would:
`:8080`, `0.0.0.0` and `[::]` all count as non-loopback wildcard binds, and a
hostname is checked by resolving it and requiring *every* address it returns to be
loopback.

Two supported shapes:

- **Reverse proxy on the same host** — bind the hub to loopback
  (`-listen 127.0.0.1:8080`) and put Caddy/nginx/Traefik in front, terminating TLS
  there and forwarding plain HTTP to the loopback port. `-behind-proxy` is not
  needed here — the hub's own bind is still loopback-only. See
  [Run a hub → Reachability](../site/docs/self-host.md#reachability) for a
  four-line Caddy config and the tunnel-based alternatives (cloudflared,
  Tailscale Funnel, `vulos-relayd`, …).
- **A container, or a proxy on a different host** — the hub's *own* bind has
  to be a wildcard (`:8080`) so Docker's `-p` mapping (or an external load
  balancer) can reach it at all, since a container's loopback interface isn't
  reachable from outside it. Pass `-behind-proxy` / `AQL_BEHIND_PROXY=1` to
  declare, explicitly, that TLS is handled upstream of this process — the flag
  does not add TLS, it only turns off the startup guard. `hub/Dockerfile`
  sets this env var for exactly this reason (`docker run -p` always needs the
  in-container bind to be non-loopback). Put the actual TLS termination in front
  of the published port — a reverse proxy, or restrict the host's `-p` mapping to
  `127.0.0.1` and proxy from there.

## Auth & session security

- **Credential-endpoint brute-force throttles** (`internal/store/authratelimit.go`)
  — separate from the four product `RATE_*` quotas above, and deliberately **not**
  admin-overridable at runtime (env-only: a compromised admin console can't
  quietly turn brute-force protection off the way `opens_per_hour` can be
  zeroed). A per-IP **hard** limit counts every attempt (success or failure)
  against `POST /v1/auth/{login,register,refresh}` and `POST /v1/admin/claim`;
  a per-account **soft** limit on top of that only counts *failed* logins,
  in a single fixed 5-minute window that never compounds — so a distributed
  attacker guessing one victim's password is still capped, but flooding failed
  logins against a victim's username costs them at most one bounded 5-minute
  window of friction, never an indefinite lockout. (There is no email identity
  here to flood against — identity is a local username, `0001_baseline.sql`.)
  A rate-limit-store error
  here **fails closed** (`503`) — the opposite policy from the physical-access
  limiter in `openpath.go` (which fails open because a locked gate is the
  worse outcome; a brute-force gate silently disabling itself is not).

  | Env | Default | Guards |
  | --- | --- | --- |
  | `RATE_LOGIN_IP_PER_5MIN` | 20 | `POST /v1/auth/login`, per source IP |
  | `RATE_LOGIN_ACCOUNT_PER_5MIN` | 10 | `POST /v1/auth/login`, failed attempts per account (username) — `auth.go` builds the subject as `"username:" + username` |
  | `RATE_REGISTER_IP_PER_5MIN` | 10 | `POST /v1/auth/register`, per source IP |
  | `RATE_REFRESH_IP_PER_5MIN` | 30 | `POST /v1/auth/refresh`, per source IP |
  | `RATE_ADMIN_CLAIM_IP_PER_5MIN` | 10 | `POST /v1/admin/claim`, per source IP |

- **Live revocation on every authenticated request.** `requireAuth` re-reads the
  user's row (not just the JWT claims) on every request, so disabling a user cuts
  them off on their very next request rather than waiting out the 15-minute
  access-token TTL. (`requireAdmin`'s live platform-admin check already worked
  this way; it now also applies to ordinary auth, not just admin routes.)
- **`POST /v1/auth/logout-all`** — revokes every refresh-token family for the
  calling user in one call (the "stolen phone" button): every other session's
  refresh token stops working immediately. The caller's *own* current access
  token still works until its normal TTL expires — access tokens aren't
  individually revocable, only refresh-token families are, so the practical
  effect is that no session can *renew* past its current access token.

## Tamper-evident audit log

`access_logs` and `admin_audit_log` are hash-chained
(`internal/store/audithash.go`): every row gets `prev_hash`/`row_hash` —
`SHA-256` over a JCS-canonical envelope of `{chain, prev_hash, fields}`, chained
to the previous row in the same table. DB triggers reject any direct
`UPDATE`/`DELETE` against either table except two narrow, schema-verified
exceptions — a one-time hash backfill of a pre-chain row, and SQLite's own
`ON DELETE SET NULL` cascade nulling a live FK when its target is deleted — see
`migrations/0007_audit_hash_chain.sql` for the exact trigger conditions. The old
live mutation this replaced, `store.UpdateAccessLogError`, is gone; a late
`cmd.ack` now lands as an append-only follow-up row (`RecordDispatchOutcome`),
the same pattern `0006`'s late-ack reconciliation established.

**Coverage.** The hash covers every content column plus permanent `*_snapshot`
copies of `account_id`/`location_id`/`access_point_id`/`user_id`
(`admin_audit_log`: `actor_user_id_snapshot`). The *live* FK columns themselves
are deliberately **not** hashed: this schema already nulls them via
`ON DELETE SET NULL` when the referenced row is deleted (so history survives
deletes), and hashing a column the schema is designed to mutate would make an
ordinary location delete indistinguishable from tampering. The snapshot carries
the same who/where information permanently instead — a coverage *relocation*,
not a coverage loss.

**Verify.** `GET /v1/admin/audit/verify` (admin-gated) walks both chains and
reports the first row that fails to verify, if any. `aql-hub verify-audit -data
DIR` does the same thing from the command line, **against a cold backup,
without booting the server or its HTTP surface at all** — point it at a copy of
a backup data directory and it prints pass/fail per table with a non-zero exit
code on failure. Run it against a *copy*, never the original evidence file:
opening the store applies any pending migration, a real (if small) mutation.

**The other operator subcommand: `aql-hub 2fa disable -user NAME -reason TEXT
[-data DIR]`.** This is the last-resort escape hatch for a user who has lost
both their authenticator *and* every recovery code — every route in the
product requires a live TOTP code or an unspent recovery code to turn 2FA
off (`store.DisableTOTP`'s `SecondFactorClaim`), so that person holds no
claim and no route can help them. What authorises this command is not a
claim and not a role: it is possession of the hub's data directory. The CLI
opens the SQLite file directly, which already means shell access to the
host — game over for the deployment regardless — so the command grants no
power the filesystem did not already grant; what it adds is a record. `-user`
and `-reason` are both required — `-reason` is mandatory specifically
because it is what the audit entry is *for*: the disable and the audit write
happen in the same transaction (`store.DisableTOTPByOperator`,
`internal/store/twofactor_operator.go`), the actor is recorded as the empty
string rather than a user id (whoever holds the host is not a user of this
hub, and naming one would misattribute the act), and nothing served over the
network may reach this path — `TestNoHTTPHandlerCanDisableTOTPWithoutAClaim`
pins that half.

**The honest ceiling.** A hash chain does **not** stop an attacker who edits the
SQLite file directly *and* recomputes every downstream hash after their edit —
that attacker can rewrite history undetectably, exactly as before this
migration existed. What it does is turn *silent* tampering into *detectable*
tampering for anyone who edits a row without also redoing that work, and it
turns "was this tampered with?" from an unknowable question into a checkable
one. It is a detection control, not a prevention control — and the test suite
proves the limit directly: `TestHashChainTamperRecomputingDownstreamIsUndetected`
shows a fully re-hashed tamper verifies clean. The two triggers are defense in
depth against the *running application* (so a future code bug can't reintroduce
a silent `UPDATE`/`DELETE`), not against an attacker with filesystem access to
`lintel.db` — they can't stop someone who edits bytes directly or drops a
trigger.

## Porting map (backend route → hub package)

| Backend (spec) | Hub | Status |
| --- | --- | --- |
| `routes/auth.ts` register/login/refresh/logout/me | `internal/httpapi/auth.go` | core done — password reset (`authrecovery.go`) and profile patch (`profile.go`) also done. Google OAuth is **not planned**, for the same reason email verification was **removed** rather than deferred: identity is a local username (`0001_baseline.sql`), and a hub that needs a remote identity provider to let you through your own gate has given away the thing it exists for |
| `routes/admin.ts` claim | `internal/httpapi/admin.go` | done |
| `routes/admin.ts` overview/accounts/users/limits(+kill-switch)/audit | `internal/httpapi/adminops.go` + `store/admin.go` | **done** |
| `routes/accounts.ts` (list/create/get/rename, members, invites) | `internal/httpapi/accounts.go` + `store/{members,invites}.go` | **done** (accept never auto-verifies phones) |
| `routes/locations.ts` (CRUD, limits/quotas, usage) | `internal/httpapi/locations.go` + `store/locations.go` | **done** |
| `routes/access.ts` access points + **open/close** + grants | `internal/httpapi/{access,open}.go` + `store/{accesspoints,openpath,grants}.go` | **done** — open path signs envelopes (`internal/keys`) and dispatches via the hub; maintenance records **done** (`internal/httpapi/maintenance.go`), device-fed movement metering (`access_point_meters`) still deferred |
| `lib/rate-limit.ts` | `store/ratelimit.go` + `store/openpath.go` | **done** (SQLite atomic try-bump; exact-once under concurrency) |
| `routes/devices.ts` (+ `proto/pairing.md`) | `internal/httpapi/devices.go` + `internal/hub` | **done** — claim/redeem, WS challenge/auth, ack correlation, HTTPS long-poll fallback |
| `routes/whatsapp.ts` / `slack.ts` / `telegram.ts` | `internal/channels/` seam + `internal/httpapi/channels_*.go` | **done** — WhatsApp full contract, Slack Events API **+ Socket Mode** (zero-URL), Telegram wired to the real open path (exceeds the backend stub) **and** dial-out polling; **plus Discord**, which has no backend route at all |
| `routes/analytics.ts` | `internal/httpapi/analytics.go` | **done** — `GET /v1/analytics/accounts/{id}/{summary,insights}`, `GET /v1/analytics/locations/{id}/summary`, read-only over the hash-chained audit rows |
| `routes/phones.ts` | `internal/httpapi/phones.go` + `profile_phone_numbers`/`phone_link_codes` migrations | **done** — not OTP: the console mints a code and the member sends it back over WhatsApp from the number being linked; see **Chat channels** above |
| React portal (`../src`, Vite) | embedded via `internal/portal` (`-tags portal`) | **seam done** — placeholder default; `make portal && make build-portal` embeds the real bundle |

Backend vitest cases (unit/integration/security/contract) are ported alongside
each route group as store-level + `httptest` handler tests, including the
open-path verdict matrix and concurrency hammers.

### Device transport (Stage 2/3)

`internal/hub` is the live registry (`device_id` → WebSocket, via
`github.com/coder/websocket` — chosen over gorilla for its context-native API
and zero transitive deps). An allowed open is signed (`internal/keys`) and
pushed to the access point's controller; the reply `cmd.ack` is correlated by
envelope nonce and the outcome (`acked` / `undelivered` / `queued` /
`no_device`) is written back onto the `access_logs` row. Offline controllers
fall back to the HTTPS long-poll (`/api/controller/{challenge,poll,ack}`),
each poll gated by a single-use, signed `ws.auth` proof. `hub.VerifyAuth` is
the production twin of the `proto/vectors/pairing.json` reference verifier and
is tested against those vectors.

## Layout

```
hub/
├── cmd/hub/          # main: config, bootstrap, serve
├── internal/store/       # SQLite + embedded migrations + tenancy-scoped methods
│   └── migrations/       # folded baseline + 0002..0021 (no 0008; SQLite)
├── internal/httpapi/     # net/http 1.22-pattern router; auth, accounts,
│                         #   locations, access, open path, devices, admin
├── internal/hub/         # device registry, ws.challenge/auth, ack correlation
├── internal/keys/        # Ed25519 identity, JCS, signed command envelopes
├── internal/channels/    # chat-channel seam: verify, wire parse, render, senders,
│                         #   Slack Socket Mode (coder/websocket)
├── internal/devices/     # device engine: driver registry + capability catalogue
│                         #   (MQTT/Modbus/ONVIF/HTTP drivers under it), default off
├── internal/discovery/   # mDNS controller discovery, POST /v1/accounts/{id}/discover/controllers
├── internal/automations/ # rule engine + scheduler, GET/POST /v1/accounts/{id}/automations/*
├── internal/energy/      # meter polling, retention-pruned samples, GET .../energy/*
└── internal/portal/      # go:embed portal seam: static/ default, dist/ (-tags portal)
```

### Build modes

```sh
go build ./...                       # default: portal placeholder
make portal && make build-portal     # embed the real React bundle (-tags portal)
```

`make portal` runs `npm run build` in the repo root and copies `dist/` into
`internal/portal/dist/`; `make build-portal` then builds with `-tags portal`.
A committed `dist/index.html` placeholder keeps the tagged build compilable
before that copy runs.
