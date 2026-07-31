# Architecture

A condensed tour of how Aql fits together. The long-form version — including the parts
that are designed but not built — lives in the repository's
[`ARCHITECTURE.md`](https://github.com/vul-os/aql/blob/main/ARCHITECTURE.md).

Aql is one hub that owns the devices around a home or a business. Its device model has
seven kinds — camera, lighting, robot, climate, energy, sensor and **access** — and one of
them, access, is driven end to end today. The engine behind the others is
[running](devices.md), with four drivers on it; what varies is how far each kind's path
goes. Everything below describes the hub as it exists.

## No cloud centre

Aql has no central service that everything depends on, and no hosted service at all. It
is a network of independent **hubs**: anyone can run one, and every hub is somebody's
own. `vulos.org/projects/aql` is the project site (landing, docs, downloads), not a
service. Every line of code is open source (MIT OR Apache-2.0) and everything is free — there is
no billing system, no account, and no telemetry.

"Decentralized" here means neither federation nor P2P. It means **many independent hubs,
each a full authority** over its own tenants, devices and audit log, with zero
coordination between them. The app asks "which hub?" on first run — that question is the
decentralization, made visible.

## The system at a glance

```
resident ── "open" ──► chat rail (WhatsApp / Slack / Telegram)
                              │ adapters in hub/internal/channels/
                              ▼
        ┌──────────────── HUB — one Go binary · SQLite ────────────────┐
        │  input seam → open-path choke point → device hub → audit     │
        │               (membership · rate limits ·     (Ed25519 sign) │
        │                quotas · visitor grants)                      │
        │  embedded web console + app API                              │
        │  ─────────────────────────────────────────────────────────   │
        │  device engine — camera · lighting · robot · climate ·       │
        │  energy · sensor drivers, telemetry, automations: NOT BUILT  │
        └───────────────────────┬──────────────────────────────────────┘
              outbound wss ⇦ dial-out (no inbound ports at the gate)
                              │
                     controller (Wi-Fi / GSM)   ← the "access" kind, today
                              │ verifies pinned-key signature
                              ▼
                     relay closes → 🚧 gate opens
```

> **The chat adapters are in the hub and stay there.** WhatsApp, Slack and Telegram are
> shipped, tested and supported in `hub/internal/channels/`, behind two small
> interfaces: `Channel` (webhook-shaped) and `DialChannel` (the hub dials out, as Slack
> Socket Mode does).
>
> There is a separate, **entirely unbuilt** design in which an external coordinator
> terminates the rail and hands the hub an authorised command instead —
> [`docs/EPHOR-CHAT-SEAM.md`](https://github.com/vul-os/aql/blob/main/docs/EPHOR-CHAT-SEAM.md).
> Treat it as an optional, experimental direction ([Ephor](https://github.com/vul-os/ephor)
> is `pre-alpha` by its own README badge), not as the successor to the rails above.
> Note the naming — Aql's hub is *not* a KOTVA gateway; it bridges chat rails into its own
> local domain, and the gateway/coordinator role in that family is a different component's
> job. The Go backend was renamed from `gateway/` to `hub/` (and the binary from
> `cmd/gateway` to `cmd/hub`, built as `aql-hub`) so that distinction is the default
> reading, not a footnote.

The desktop app talks HTTPS to the hub for admin — and, by design, would talk directly
to the controller over LAN/BLE with an offline-verifiable grant in an emergency. That
last path is only three-quarters built; see [Emergency access](emergency-access.md).

## Components

| Component | What it is | Status | Stack |
| --- | --- | --- | --- |
| **hub** (`hub/`) | The entire server: the open path, console, API, device hub, audit | **Shipped** — 126 routes, 1,100 test functions green | Go · SQLite (`modernc.org/sqlite`, no CGO) · embedded console |
| **controller** (`controller/`) | The unit wired to the gate relay; verifies signatures, drives the motor | **Shipped** — 137 test functions green; GPIO relay and BLE radio still unvalidated | Go, std-lib first, own module |
| **e2e** (`e2e/`) | Cross-module harness: boots the real hub + controller binaries and proves the open path over the wire | **Shipped** | Go, subprocess-driven |
| **console / app** (`src/`, `src-tauri/`) | Web console embedded in the hub, plus a Tauri v2 desktop shell with a hub picker | **Shipped** (admin surfaces) | React 19 · Vite · Tauri v2 |
| **proto** (`proto/`) | The versioned wire contracts + conformance vectors | **Shipped** — 69 vectors, 103 checks | Markdown + JSON fixtures |
| **device engine** (`hub/internal/devices/`) | Registry behind a driver seam; `http`, `modbus` (TCP), `mqtt`, `camera` (ONVIF), `access` (gates, read-only) | **Shipped, default off** — no registry unless `-device-drivers` names one. No radio in the hub — Zigbee and Z-Wave arrive over a bridge. No Matter and no dedicated robot driver. The camera pipeline records and plays back but has never met real hardware | Go |

### One implementation, no second server

Earlier versions of this project carried a Cloudflare Workers + Postgres backend as the
behavioural reference the Go hub was ported from. **That backend has been deleted.** The
Go hub is the only server implementation, and its own tests plus the cross-module `e2e/`
harness are the reference now. Any doc still describing a `backend/` directory is stale;
there isn't one.

## What the open path actually is

Worth stating precisely, because "rules engine" oversells it. The hub does have a rule
object now — see [Devices → Automations](devices.md) — but it is deliberately kept *out*
of this path: every access verb sits above the automations tier ceiling, so no automation
can open anything. What governs an online open is a single choke point that every open
funnels through, in a fixed order:

1. Resolve the access point.
2. Refuse if the account is suspended.
3. Refuse if the user is disabled (fail-closed).
4. Apply rate limits and quotas — open cooldown, opens per member per hour, opens per
   account per hour, opens per member per day, opens per location per day.
5. Write the audit row, in the same transaction as the decision.

Membership (who may open what) is checked at the route above this. Time-bound access for
visitors is a separate first-class object — a per-phone, per-access-point grant with a
date window and an optional use cap, refunded if an open is then denied by a limit.
`close` is never limited: closing is the safe direction.

**Weekly time windows exist only inside offline grants**, and the hub does not evaluate
them — the *controller* does, at redemption time. Geofencing does not exist in any form.

## The three access paths

1. **Chat** — primary. Webhook or dialled socket → identity resolution → the choke point
   → signed command → in-thread reply. See [Chat channels](channels.md). Note the
   platform sees the plaintext, whichever component terminates the rail; see
   [Security](security.md).
2. **App** — emergency. Short-TTL signed grants verified offline by the controller.
   Controller verification, hub issuance and the app's request/hold/present half are all
   real; what is missing is presenting from an https console or over BLE in a browser.
3. **Console** — fallback. Unlimited, served by the hub itself.

## Reachability

Ingress is **configuration, not a component**: there is no reachability service to run,
and the hub's entire interest in the subject is one string, `AQL_PUBLIC_URL`, which it
never dials and never validates. The listener speaks **plain HTTP, full stop** — no TLS
or ACME code of its own — and it refuses to bind a non-loopback address unless you
explicitly declare that TLS is terminated upstream. Three ways to be reachable, in
increasing order of self-sufficiency:

1. **Direct** — a public IP or VPS, behind your own reverse proxy (Caddy, nginx, Traefik)
   that holds the certificate. See [Public URL & TLS](ingress.md) for a working
   Caddy example.
2. **Any tunnel you already trust** — cloudflared, Tailscale Funnel, ngrok — run beside
   the binary; these terminate TLS at their own edge or local agent and forward plain
   HTTP, so they work as-is. A tunnel in raw TCP/SNI-passthrough mode does not, since the
   hub has no TLS of its own — put a reverse proxy behind that instead.
3. **No public URL at all** — real today. Controllers dial out unconditionally, and the
   Slack rail can dial out too (Socket Mode: with an `xapp-…` app-level token the
   connection is a single outbound WebSocket), so a LAN-only hub with no reachable address
   runs a chat rail end to end. Only WhatsApp webhooks, the Telegram webhook, and off-LAN
   console access need a public URL. Full breakdown: [Reachability](reachability.md).

## The contracts that must not break

Deployed hardware is forever, so these wire contracts are versioned from day one and
covered by 63 conformance vectors (70 checks) in `proto/vectors/`, consumed by both the
hub and the controller:

1. **Pairing** — claim-token redemption, key exchange, pinning of the hub key
2. **Signed commands** — open/close; nonce + expiry semantics
3. **Offline grants** — grant format, challenge-response, window evaluation
4. **Controller events** — upstream: button pressed, gate held open, tamper

Binaries can churn; these can only be extended. The same reasoning is why `hub/cmd/hub/env.go`
still accepts the old `LINTEL_*` environment variables as a fallback for their `AQL_*`
replacements, and why the `lintel.db` filename and the controller's `_lintel._tcp` mDNS
service kept their pre-merge names.

## Money is out of scope

There is no billing system anywhere in Aql — no tiers, no wallet, no checkout, and no
code path that could collect money. Operators who want to charge their residents do so
outside the system. Your real costs sit with your own providers: your hardware, and
Meta's per-conversation fees on your own number if you run a WhatsApp channel (Slack and
Telegram cost nothing).

## Tech decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Hub language | Go | Single small static binary, ARM-friendly, embedded console via `go:embed` |
| Database | SQLite (pure-Go driver) | Zero-dependency self-hosting; one file to back up; cross-compiles to a Pi with `CGO_ENABLED=0` |
| Console | React 19 + Vite | One build serves the hub-embedded console and the Tauri shell |
| Desktop app | Tauri v2 | Desktop from one codebase; a native HTTP plugin so the console can reach any hub without a CORS allowlist |
| Rust core | Deliberately thin | One IPC command (`system_pulse`). The device engine could grow here or in the Go hub — undecided, and not started either way |
| Billing | None — no billing code at all | Everything is free; self-hosters pay their own providers directly |
| License | MIT OR Apache-2.0, everything (`LICENSE-MIT`, `LICENSE-APACHE`) | The whole system is the product; nothing is held back |
