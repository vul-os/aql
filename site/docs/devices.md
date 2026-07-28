# Devices

This chapter is about the thing Aql is for: **one hub that owns everything physical**
around a home or a business. It is also the chapter with the largest gap between design
and code, so it says which is which on every line.

> **The device engine is built, and it is off unless you turn it on.** `hub/internal/devices`
> is a real registry behind a driver seam, with four drivers: generic HTTP/webhook, Modbus
> TCP, MQTT, and ONVIF cameras. An automations runtime and energy metering sit on top of it.
> None of it constructs itself: a hub started without `-device-drivers` has no registry, no
> poller and no goroutine, which is the default.
>
> What is still absent is worth naming as plainly: **no Matter**, **no radio in the hub**
> (Zigbee and Z-Wave are reached through a `zigbee2mqtt` or `zwave-js-ui` bridge over the
> MQTT driver — deliberately, since a bridge already owns the radio and does it better),
> **no robot driver at all**, and **no camera pipeline** — the ONVIF driver discovers
> cameras and probes their streams but has never received a frame, and nothing here stores
> one. See [Camera recording](https://github.com/vul-os/aql/blob/main/docs/CAMERA-RETENTION.md),
> which is the design that has to exist before any of it is written.

## The seven device kinds

Aql's device model has seven kinds. They are what the console renders, what the
automations runtime would fire on, and what a driver has to map its protocol onto:

| Kind | Examples | Status |
| --- | --- | --- |
| **Camera** | Gate camera, yard camera (ONVIF/RTSP) | Driver ships — discovery, status and readings. **No video**: no live view, no recording |
| **Lighting** | Zigbee groups, individual fixtures | No dedicated driver. Drivable today through MQTT (zigbee2mqtt) or generic HTTP |
| **Robot** | Robot mower, security patrol bot, cleaning bot | **No driver.** The one kind with no path at all |
| **Climate** | Thermostats, HVAC | No dedicated driver. Drivable today through MQTT or generic HTTP |
| **Energy** | Solar array, grid meter, battery | Readings through Modbus TCP, MQTT or HTTP; ingestion, rollups and source mix ship |
| **Sensor** | Water tank level, contact and motion sensors | Readings through MQTT, Modbus TCP or HTTP |
| **Access** | Gate lock, door lock, barrier | **Real, end to end** — and still its own stack, not yet a kind inside the engine |

**Access is the exception, and it is deliberately the reference shape.** It has a
versioned wire contract with conformance vectors, a device agent that verifies an
Ed25519 signature instead of trusting its network, offline verification for when the hub
is unreachable, and an audit row written in the same transaction as the decision. Those
are the parts that are painful to retrofit, which is why the first kind was taken all the
way down. See [Controllers](controllers.md) and [Emergency access](emergency-access.md).

## What the hub actually drives today

Two separate things, and the separation is worth knowing.

**Access points** — a gate, door, barrier or "other" — through a paired controller that
verifies an Ed25519-signed command. The only dispatchable commands are `open` and
`close`. Access-point kinds are constrained to those four values by a database check
constraint. This path does **not** go through the device engine; bringing it onto the
same internal model, so `access` is one kind among seven rather than a parallel stack, is
still ahead.

**Configured devices**, through the engine, when a hub is started with `-device-drivers`
and a `-device-config` file. Those devices report readings and accept the verbs their
capability catalogue declares. A hub with no device config has no engine at all and says
so — the console shows `engine: false` rather than an empty list, because "no engine" and
"no devices" are different answers.

## What the console shows

Every device row the console renders comes from the engine. There is no demo device
dataset behind those screens any more — the fixture that used to stand in for six of the
seven kinds is gone, along with the per-row "Demo data" marks it needed.

What the console does still distinguish, and must: a device the engine has **never heard
from** is `unknown`, which is a third state and not a synonym for "off". Collapsing them
would make a device that has never reported look like one that is known down.

## Why the scope is wider than a smart-home hub

Two things make this scope wider than a typical smart-home hub, and they are the reason
the project exists rather than deferring to one:

- **Business, not just home.** Locations, access points, accounts and an operator seat
  above them are already modelled that way in the shipped hub — multiple sites under one
  binary is not a retrofit.
- **Autonomous bots as a first-class device kind**, alongside cameras and sensors, with
  their own state machine (patrol, dock, charge) — rather than an afterthought
  integration.

## The driver/adapter seam

"Works with any hardware" is a control-plane stance, not a promise that Aql ships every
protocol. The shape is a single internal device abstraction — an id, a kind, a zone, a
state, and a set of commands and telemetry — that every driver maps onto:

- **Discovery** finds devices on the network or bus (mDNS/SSDP, Zigbee pairing, MQTT
  topic scanning, ONVIF probe, manual add).
- **Drivers** translate a protocol's wire format into the internal device shape and back.
  Each protocol is its own adapter behind a common interface; adding one should not
  require touching the console or the other adapters.
- **The console only ever sees the internal shape.** It renders devices, zones and events
  generically, with no protocol-specific code.

Adapters, and what each one is:

| Driver | Covers | Status |
| --- | --- | --- |
| `http` | Anything with an API — the catch-all escape hatch | **Ships.** Reads and executes |
| `modbus` | Energy meters, industrial/building sensors | **Ships, TCP only.** Read-only — no serial/RTU, though a TCP-to-RTU bridge covers the common case |
| `mqtt` | Broad IoT/DIY ecosystem, and Zana devices. Also how Zigbee is reached, via a zigbee2mqtt bridge | **Ships.** Reads and executes; verbs come from the capability catalogue, never invented from a topic |
| `camera` | IP cameras over ONVIF | **Ships, partially.** Discovery, stream-address resolution and an RTSP probe. Receives no frames |
| Zigbee / Z-Wave | Battery sensors, switches, bulbs, older ecosystems | **Reachable now, through a bridge.** `zigbee2mqtt` or `zwave-js-ui` owns the radio and republishes to MQTT; the hub has no radio and is not getting one |
| Matter | Modern smart-home devices | **No code.** Needs a certified device and a stack |

A driver never decides what a device may be asked to do. Capabilities come from the
catalogue, so a discovery pass proposes a *candidate* with an address attached and a
human decides what joins the fleet — the same rule the MQTT bridge scan and the mDNS
browse follow, and for the same reason: anything on the LAN can answer.

Bringing the existing access path onto the same internal model — so `access` is one kind
among seven rather than a parallel stack — is still ahead.

**Where it lives: the Go hub.** It owns persistence, audit and the open path, and it runs
on the always-on box. The Rust core in the Tauri shell was the alternative and is not it.

## Automations

The model is `trigger → condition → action`, evaluated against live device state, with
scheduling and run history persisted. It is built (`hub/internal/automations/`) and
managed over `/v1/accounts/{id}/automations`.

Triggers are `schedule` (a minute of the day on chosen weekdays, in a named timezone, so
a rule written as "at seven" still means seven after a DST shift), `threshold` (a device
metric *crossing* a bound — edge-triggered, so a tank already below 20% at boot does not
fire a rule written for "when it drops below 20%"), and `event` (a device changing
availability).

The property to know before writing a rule: **an unattended action is bounded by a
compile-time ceiling.** `MaxActionTier` is `TierConsequential`, checked both when a rule
is saved and again immediately before the driver call, and no flag, request or config
file can raise it. Every access verb in the catalogue sits above that line, so **an
automation cannot open a gate** — that is structural, not a setting. A mower's blades sit
above it too.

A rule that fails repeatedly disables itself and records why. Rules can be written while
the scheduler is off, which is useful when setting a hub up; the list response carries
`scheduler_running` so a console can say plainly that nothing will fire them.

The *access* side is governed separately and deliberately so — see
[Architecture → What the open path actually is](architecture.md). Per-member time windows
for online opens do exist now (`hub/internal/store/timewindows.go`), enforced inside
the open path's choke point rather than by the automations engine, and geofence rules
alongside them. Weekly windows inside offline grants remain a different mechanism
entirely: the **controller** evaluates those at redemption, against its own clock, with
no hub involved.

## Energy

Meter ingestion, hourly/daily/monthly rollups and source-mix accounting (solar / grid /
battery) are built (`hub/internal/energy/`) and readable over
`/v1/accounts/{id}/energy/{channels,series,mix}`. A poller reads meters through the
device engine; counter wraps and resets are handled explicitly.

The design rule worth knowing, because it shapes every response: **the engine never
states a number it cannot support.** Every bucket carries a quality label, how much of it
was interpolated across a gap, and a measured-versus-expected coverage pair; every mix
carries `complete` and `attributed`. An hour nobody measured reports `kwh: null`, never
`0` — an outage and a house that used nothing are different facts. A chart drawn without
checking those flags is confidently wrong.

The API is read-only. Samples come from a poller reading real meters; an endpoint that
injects them would be a way to forge a bill.

Untested against physical meters.

## Security & bots

Built: an ONVIF driver (`hub/internal/devices/camera/`) that discovers cameras via
WS-Discovery, authenticates with WS-UsernameToken digest, and asks a camera for the RTSP
address of a chosen encoder profile.

There is also an RTSP client, and it does exactly one thing: **DESCRIBE**. Turn it on with
`VerifyStream` and the driver follows the address it resolved — authenticating with digest,
or basic where a camera offers nothing else — asks what the stream is, and reports the
answer: `H264 video · digest auth`. It holds no session.

Turn on `VerifyMediaFlow` and it goes one step further — SETUP the video track over
interleaved TCP, PLAY, count RTP packets for a couple of seconds, TEARDOWN — answering what
`DESCRIBE` cannot: whether anything actually **comes out**. A camera that describes a
perfectly good stream and sends nothing is an ordinary failure (a dead encoder, a transport
it will not really do, a firewall permitting control and dropping media), and the only
symptom is a black player after the product said all was well. Such a camera reports as
**degraded**, not online.

That probe occupies an RTSP session, so it is opt-in and always tears down: cheap cameras
support very few, and one held by a health check competes with whoever is watching.

It counts packets and **decodes none** — that line is deliberate. RTP framing and the RTP
header are specified tightly enough to serve faithfully in a test; H.264 depacketization is
not, and a fake written from the same RFC would simply agree with whatever the code
assumed.

That one request is the difference between "ONVIF handed us a URL" and "that URL streams,
and these credentials work on it". Cameras routinely want a different account on the media
leg than on the device service, and without the probe an operator finds that out in VLC
rather than here. A camera whose ONVIF answers but whose stream does not reports as
**degraded** — it is reachable and it is not working, and both extremes lose that.

**Live view and recording are still not built.** Anything that touches a pixel needs a real
camera to develop against and a storage design this repo does not have: where clips live,
for how long, who may see them, what happens when the disk fills, and what a resident is
told when retention silently drops the evening they care about.

Robot control beyond a status row, and alerting tied to real sensor or camera events, are
not built either.

Movement commands are the one place where "just add a driver" is not enough: a compromised
client must not be able to drive a machine into a person, so rate-limiting and scoping on
movement belong in the engine from the start rather than after.

## Reaching devices: input surfaces

The input surfaces — chat, the console, the app — are deliberately device-agnostic. A
surface resolves a person to an identity and a request to an intent, then hands off to a
choke point that decides. The intent vocabulary is currently `open`, `close` and picker
replies, because that is the only thing there is to command. Extending it to "turn the
lights off" is a small change *at the surface* and a large change *behind it*: the device
engine has to exist first. See [Chat channels](channels.md).

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
