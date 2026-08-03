# Aql documentation

**An open-source command centre for the physical world.** Aql (Arabic عقل — *"the mind"*)
is the software brain for your physical space: one hub you run yourself that owns the
devices around a home or a business — cameras, lighting, robots, climate, energy, sensors
and access control — with automations that span all of them and several ways to reach it.

Think of it as the reach of Home Assistant pushed wider: not just consumer smart-home
gadgets, but autonomous robots and business fleets, under one hub that owns everything.

Aql has no cloud centre and no hosted service. It is a network of independent **hubs**;
anyone can run one, and every hub is somebody's own. `vulos.org/projects/aql` is the
project site — this landing, these docs, the downloads — not a service: there is nothing
to sign up for, no account, no telemetry, and no billing code anywhere in the binaries.

> ### What is built, plainly
>
> Aql's device model has **seven kinds** — camera, lighting, robot, climate, energy,
> sensor and **access**. Exactly one of them is real end to end.
>
> **Built and running:** the hub (a single Go binary, SQLite inside), the rules and quota
> engine, the tamper-evident audit log, the embedded web console, pairing in which the
> controller permanently pins the hub's signing key, Ed25519 command signing, and
> hub-side offline-grant issuance — i.e. the whole **access** kind, from the message to
> the motor.
>
> **Not built:** the device engine that would drive the other six kinds (no Matter, MQTT,
> Matter; a robot driver; and the camera pipeline. The device
> engine, the automations runtime and energy metering are built and ship off by default.
> The phone half of the offline-grant flow is half done — a grant can be requested and
> stored, not presented. See [Devices](devices.md) and
> [ROADMAP.md](https://github.com/vul-os/aql/blob/main/ROADMAP.md).

## The pieces

| Piece | What it is | Status |
| --- | --- | --- |
| **The hub** (`hub/`) | One Go binary with an embedded SQLite database. It owns state, runs your rules, serves the web console and the app's API, keeps the audit log, and pushes signed commands to devices. | **Shipped** |
| **Access module** | The first device kind wired all the way down: signed commands, a paired controller, offline grants, a tamper-evident trail. | **Shipped** |
| **Controller** | The small device wired to a gate's relay. It dials *out* to the hub over a persistent connection, verifies command signatures against a pinned key, and pulses the motor. Wi-Fi or GSM. | **Shipped** (GPIO relay + BLE radio still need hardware validation — see [Controllers](controllers.md)) |
| **Console** | The web dashboard, embedded inside the hub binary. No separate deployment. | **Shipped.** Admin surfaces, plus device / energy / automations screens over the real engine |
| **Desktop app** | A Tauri v2 shell around the same console, with a hub picker so one build points at any hub. | **Shipped.** Includes the emergency-access screen — see [Emergency access](emergency-access.md) |
| **Device engine** | Protocol drivers, discovery, telemetry, automations, energy metering. | **Shipped, default off.** `http`, `modbus`, `mqtt`, `camera` — see [Devices](devices.md) |

The private things worth protecting on any hub are its data directory — which holds the
SQLite database (`lintel.db`) plus the unencrypted Ed25519 signing key and JWT secret the
hub generates on first boot — and its `.env` (channel credentials, and
`ADMIN_CLAIM_TOKEN` before it's claimed). See [Security](security.md) for what is
actually in each.

> **Two naming notes.**
>
> **Aql's hub is not a KOTVA gateway.** In the KOTVA family that word names the
> legacy-rail coordinator role — a separate job, filled by
> [Pier](https://github.com/vul-os/pier). Aql's hub bridges chat rails into its own
> local domain; it is not that component. The backend lives in `hub/`, builds as
> `cmd/hub`, and ships as the `aql-hub` binary — renamed from `gateway/` /
> `cmd/gateway` so that distinction is the default reading, not a footnote.
>
> **Why some identifiers still say `lintel`.** Aql's access module shipped under the name
> *lintel* before the two projects merged. The SQLite filename (`lintel.db`) and the
> controller's mDNS service (`_lintel._tcp`) are a **deployment and wire contract** for
> hubs and controllers already in the field, so they were deliberately left alone —
> renaming them would break upgrades and re-pairing for no benefit. The environment
> variables did get renamed: `AQL_DATA_DIR`, `AQL_LISTEN`, … are now primary, and the old
> `LINTEL_*` names still work as a fallback (logged once at WARN) so no deployment already
> in the field breaks on upgrade. Everything user-facing is Aql.

## Access control: the first module that is real

Access is one device kind among seven, and it is the one that has been driven all the way
down to the metal. It is also the reference shape for how the other six should eventually
work — a versioned wire contract, a device that verifies rather than trusts, and an audit
trail you can check after the fact.

- **One choke point** every open funnels through, whichever surface it came from:
  membership, account-suspended and user-disabled checks (fail-closed), then open
  cooldown, per-member and per-account hourly caps, and optional per-location daily
  quotas. `close` is never denied.
- **Ed25519-signed commands** with nonce and expiry. The controller pins the hub's key at
  pairing, so a hostile network, a DNS hijack or a malicious tunnel cannot forge an open.
- **Offline grants** the controller can verify with the hub, the internet and every chat
  platform down — eleven normative verification steps, conformance-tested.
- **Tamper-evident audit** — hash-chained, append-only, verifiable against a cold backup.

Chapters: [Controllers](controllers.md) · [Emergency access](emergency-access.md) ·
[Rate limits & quotas](limits.md).

## Chat is an input surface, not the product

Chat is one of the ways you reach your hub. The seam behind it resolves a sender to an
identity and a message to an intent, then hands off to a choke point that decides — and
that choke point is device-agnostic by construction. A resident texting `open` and a gate
swinging is today's working instance of a wider idea.

The intent vocabulary is currently `open`, `close` and picker replies, because gates are
the only device class there is to command. Lights, cameras, mowers, meters and bots are
the roadmap, not a shipped capability.

> **The WhatsApp, Slack and Telegram rails are shipped and supported.** They live in the
> hub, in `hub/internal/channels/`, and they are what [Chat channels](channels.md)
> documents. A *designed but unbuilt* alternative would move rail termination into an
> external coordinator — [`docs/PIER-CHAT-SEAM.md`](https://github.com/vul-os/aql/blob/main/docs/PIER-CHAT-SEAM.md)
> — and that is an optional, experimental path, not a replacement for the rails above.

Whichever component terminates the rail, the exposure is the same: the chat platform sees
the plaintext of every message, because something has to read it to act on it. The web
console path has no chat platform in it at all. See [Security](security.md).

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
held back, MIT OR Apache-2.0.

- **Run a hub** on a VPS, a Pi, or a box in the gatehouse — one binary, one SQLite file.
  Start with [Getting started](getting-started.md) or the full
  [Run a hub](self-host.md) chapter.
- **Bring your own channel credentials.** Slack takes minutes; WhatsApp needs your own
  verified Meta business number (a WABA), and Meta bills you directly for your own
  conversations. See [Chat channels](channels.md).
- **Reachability is a config string, not a component.** Most installs need **no public URL
  at all**: controllers dial out, Slack Socket Mode dials out, and offline grants need no
  network. If you want WhatsApp or off-LAN console access you need a URL, and any of
  ngrok, cloudflared, a Tailscale funnel, a small VPS running nginx, or a relay someone
  else operates will produce one — the hub only ever sees the string you paste into
  `AQL_PUBLIC_URL`. Whatever provides it also terminates TLS, because the hub speaks
  plain HTTP only. Full breakdown: [Reachability](reachability.md); how-to:
  [Public URL & TLS](ingress.md).

## Zana — the open-hardware companion

**[Zana](https://github.com/vul-os/zana)** is the open-hardware half of the pair:
reference designs for the devices Aql is meant to control (robot mowers, sensor nodes,
security and cleaning bots). Aql controls any hardware that speaks a supported protocol;
Zana devices are simply designed to work well with it. Zana is not required to use Aql,
and no Zana-specific code exists in this repository.

## Where to go next

- New here, want the fastest path? → [Getting started](getting-started.md)
- Self-hosting on your own hardware? → [Run a hub](self-host.md)
- Wondering what the hub will own beyond gates? → [Devices](devices.md)
- Wiring a gate? → [Controllers](controllers.md)
- Evaluating for a complex or a security review? → [Security](security.md) and
  [Architecture](architecture.md)
- Straight answers, including how this differs from Home Assistant? → [FAQ](faq.md)
