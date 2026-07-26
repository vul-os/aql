# Aql documentation

**An open-source command centre for the physical world.** One hub you run yourself that
owns the devices around a home or a business — and, today, a finished chat-driven
physical-access-control system inside it: a resident texts WhatsApp, Slack or Telegram,
and a gate opens.

Aql has no cloud centre and no hosted service. It is a network of independent **hubs**;
anyone can run one, and every hub is somebody's own. `vulos.org/products/aql` is the
project site — this landing, these docs, the downloads — not a service: there is nothing
to sign up for, no account, no telemetry, and no billing code anywhere in the binaries.

> ### What is built, plainly
>
> **Built and running:** the hub (a single Go binary, SQLite inside), chat channels
> (WhatsApp, Slack, Telegram), the rules and quota engine, the tamper-evident audit
> log, the embedded web console, controller pairing with gateway-key pinning,
> Ed25519-signed commands, and gateway-side offline-grant issuance.
>
> **Not built:** the wider device engine (Matter, MQTT, Zigbee, ONVIF, Modbus drivers),
> the automations runtime, energy metering, and the phone half of the offline-grant
> flow. Those are the roadmap, not the product — see [Devices, energy &
> automations](devices.md) and [ROADMAP.md](https://github.com/vul-os/aql/blob/main/ROADMAP.md).

## The pieces

| Piece | What it is | Status |
| --- | --- | --- |
| **Hub (gateway)** | One Go binary with an embedded SQLite database. It receives chat webhooks, runs your access rules, serves the web console and the app's API, keeps the audit log, and pushes signed commands to controllers. | **Shipped** |
| **Controller** | The small device wired to a gate's relay. It dials *out* to the hub over a persistent connection, verifies command signatures against a pinned key, and pulses the motor. Wi-Fi or GSM. | **Shipped** (GPIO relay + BLE radio still need hardware validation — see [Controllers](controllers.md)) |
| **Console** | The web dashboard, embedded inside the hub binary. No separate deployment. | **Shipped** |
| **Desktop app** | A Tauri v2 shell around the same console, with a hub picker so one build points at any hub. | **Shipped** (admin only — no emergency-access screen; see [Emergency access](emergency-access.md)) |
| **Device engine** | Protocol drivers, discovery, telemetry, automations, energy metering. | **Not built** — see [Devices, energy & automations](devices.md) |

The private things worth protecting on any hub are its data directory — which holds the
SQLite database (`lintel.db`) plus the unencrypted Ed25519 signing key and JWT secret the
hub generates on first boot — and its `.env` (channel credentials, and
`ADMIN_CLAIM_TOKEN` before it's claimed). See [Security](security.md) for what is
actually in each.

> **Why some identifiers still say `lintel`.** Aql's access-control half shipped under
> the name *lintel* before the two projects merged. The environment variables
> (`LINTEL_DATA_DIR`, `LINTEL_LISTEN`, …), the SQLite filename (`lintel.db`) and the
> controller's mDNS service (`_lintel._tcp`) are a **deployment and wire contract** for
> hubs and controllers already in the field, so they were deliberately left alone.
> Renaming them would break upgrades and re-pairing for no benefit. Everything
> user-facing is Aql.

## Chat is an input surface, not the product

The flagship case is opening a gate from a chat message — because it is the case that is
finished end to end, and because it is the one people actually use daily. The design
intent is wider than that: chat is *an* input surface onto whatever the hub owns, and
the choke point every open funnels through is device-agnostic by construction.

Today that choke point drives exactly one device class: gate/door/barrier controllers.
Lights, cameras, mowers, meters and bots are the roadmap, not a shipped capability — no
driver for any of them exists in the code.

## The three ways in (access control)

1. **Chat — the primary path.** Residents text `open` from the channel they already use.
   The hub resolves who they are, runs the rules, signs a command, replies in-thread.
   See [Chat channels](channels.md).
2. **The app — emergency access (partially built).** The plan: the app holds a
   short-lived grant signed by the hub and proves itself to the controller directly over
   LAN or Bluetooth with no internet at all. The controller side and the hub's issuance
   side are both real and conformance-tested; the app does not request, store or present
   a grant yet, so nothing on a resident's phone can use this path today. See
   [Emergency access](emergency-access.md).
3. **The web console — the fallback.** Unlimited opens through the hub's own dashboard.

## Running it

There is one way to run Aql: yourself. That is the product — the whole system, nothing
held back, MIT-licensed.

- **Run a hub** on a VPS, a Pi, or a box in the gatehouse — one binary, one SQLite file.
  Start with [Getting started](getting-started.md) or the full
  [Run a hub](self-host.md) chapter.
- **Bring your own channel credentials.** Slack takes minutes; WhatsApp needs your own
  verified Meta business number (a WABA), and Meta bills you directly for your own
  conversations. See [Chat channels](channels.md).
- **Reachability is your choice**: a public IP behind your own reverse proxy or a
  TLS-terminating tunnel (the hub itself speaks plain HTTP only — see
  [Ingress & reachability](ingress.md)), any tunnel you already trust running beside the
  binary (including a self-hosted, no-account-needed `vulos-relayd`, or the hosted Ephor
  convenience) — or, with **Slack Socket Mode (shipped)**, no public URL at all: the hub
  dials out to Slack over a WebSocket instead of receiving webhooks. Controllers already
  dial out too. Telegram and WhatsApp still need a reachable URL today (Telegram webhook;
  WhatsApp's Cloud API is webhook-only by Meta's design) — long-polling for Telegram is
  on the roadmap. Full breakdown: [Ingress & reachability](ingress.md).

## Zana — the open-hardware companion

**[Zana](https://github.com/vul-os/zana)** is the open-hardware half of the pair:
reference designs for the devices Aql is meant to control (robot mowers, sensor nodes,
security and cleaning bots). Aql controls any hardware that speaks a supported protocol;
Zana devices are simply designed to work well with it. Zana is not required to use Aql,
and no Zana-specific code exists in this repository.

## Where to go next

- New here, want the fastest path? → [Getting started](getting-started.md)
- Self-hosting on your own hardware? → [Run a hub](self-host.md)
- Wiring a gate? → [Controllers](controllers.md)
- Wondering what Aql will control beyond gates? → [Devices, energy &
  automations](devices.md)
- Evaluating for a complex or a security review? → [Security](security.md) and
  [Architecture](architecture.md)
- Straight answers, including how this differs from Home Assistant? → [FAQ](faq.md)
