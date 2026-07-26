# Devices, energy & automations

This chapter is about the half of Aql that is **not built**. It exists so the ambition is
written down honestly instead of implied by a screenshot.

> **Nothing on this page ships today.** There is no device driver of any kind in the
> codebase — no Matter, no MQTT, no Zigbee, no ONVIF, no Modbus, no Z-Wave. There is no
> automations runtime, no scene engine, no energy ingestion, and no camera pipeline. A
> grep of the hub and controller sources for any of those protocol names returns nothing.
> The only device class Aql drives is a gate/door/barrier controller.

## What Aql actually controls today

One thing: an **access point** — a gate, door, barrier, or "other" — through a paired
controller that verifies an Ed25519-signed command. The only dispatchable commands are
`open` and `close`. Access-point kinds are constrained to those four values by a database
check constraint; there is no generic device model behind them.

The console's **Devices** page lists paired *controllers* — their access point, online
state and pairing status. It is not a smart-home device list.

## What is intended

The design goal is one hub that owns everything physical in a home or a business:
cameras, lights, mowers, IoT sensors, energy meters, and security/cleaning bots —
**plus** the physical access control that already works. One control plane, one audit
trail, one place to automate across all of it.

Two things make that scope wider than a typical smart-home hub, and they are the reason
the project exists rather than deferring to one:

- **Business, not just home.** Locations, access points, accounts and an operator seat
  above them are already modelled that way in the shipped hub — multiple sites under one
  binary is not a retrofit.
- **Autonomous bots as a first-class device class**, alongside cameras and sensors, with
  their own state machine (patrol, dock, charge) — rather than an afterthought
  integration.

## The driver/adapter seam (design, not code)

"Works with any hardware" is a control-plane stance, not a promise that Aql ships every
protocol. The intended shape is a single internal device abstraction — an id, a kind, a
zone, a state, and a set of commands and telemetry — that every driver maps onto:

- **Discovery** finds devices on the network or bus (mDNS/SSDP, Zigbee pairing, MQTT
  topic scanning, ONVIF probe, manual add).
- **Drivers** translate a protocol's wire format into the internal device shape and back.
  Each protocol is its own adapter behind a common interface; adding one should not
  require touching the console or the other adapters.
- **The console only ever sees the internal shape.** It renders devices, zones and events
  generically, with no protocol-specific code.

Planned adapters, roughly in the order that unlocks the most devices:

| Protocol | Covers | Status |
| --- | --- | --- |
| Matter | Modern smart-home devices (lights, locks, sensors) | Planned — no code |
| MQTT | Broad IoT/DIY ecosystem, and Zana devices | Planned — no code |
| Zigbee | Battery sensors, switches, bulbs | Planned — no code |
| ONVIF | IP cameras (most brands) | Planned — no code |
| Modbus | Energy meters, industrial/building sensors | Planned — no code |
| Generic HTTP/webhook | Anything with an API — the catch-all escape hatch | Planned — no code |

**Where would it live?** Undecided, and worth stating rather than hand-waving. Aql has
two plausible homes for a device engine: the Go hub (which already owns persistence,
audit and the open path) or the Rust core in the Tauri shell (`src-tauri/`, which today
exposes exactly one IPC command, `system_pulse`, and is not even called by the frontend).
The hub is the more likely answer, because the hub is what runs on the always-on box and
already holds the audit log — but nothing has been committed.

## Automations

The intended model is `trigger → condition → action`, evaluated against live device
state, with scheduling and run history persisted. None of it exists: there is no rule
object, no scheduler, and no execution engine.

Note that even the *access* side has no rule engine in the sense people expect — no
per-member schedules, no time-of-day windows for online opens. Weekly windows exist only
inside offline grants, and the **controller** evaluates them at redemption, not the hub.
See [Architecture → What the open path actually is](architecture.md).

## Energy

Intended: meter and inverter ingestion, hourly/daily/monthly rollups, and source-mix
accounting (solar / grid / battery) from live readings. Built: nothing. The word "meter"
appears in the hub only as an open/close counter derived from the access log, and the
maintenance fields next to it return fixed nulls.

## Security & bots

Intended: camera live view and recording (ONVIF/RTSP), robot control for mowers,
cleaning and patrol beyond a status row, and alerting tied to real sensor or camera
events. Built: nothing.

## Chat as the input surface for all of it

The channel seam is deliberately device-agnostic — a channel resolves a sender to an
identity and a message to an intent, then hands off to a choke point that decides. The
intent vocabulary is currently `open`, `close` and picker replies, because that is the
only thing there is to command. Extending it to "turn the lights off" is a small change
*at the seam* and a large change *behind it*: the device engine has to exist first.

## Zana

**[Zana](https://github.com/vul-os/zana)** is the companion open-hardware line — mowers,
sensor nodes, security and cleaning bots. The relationship is one-directional: Aql
controls any hardware that speaks a supported protocol; Zana devices are built to speak
one of those (most likely MQTT) out of the box, so they need no bespoke adapter. Zana is
not required to use Aql, and there is no Zana-specific code in this repository.

## Tracking this

Phase-by-phase status lives in
[ROADMAP.md](https://github.com/vul-os/aql/blob/main/ROADMAP.md). If a page in these docs
ever describes one of these features without a "not built" marker, that is a bug —
please report it.
