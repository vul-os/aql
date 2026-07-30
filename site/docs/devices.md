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
> **no robot driver of its own** (the generic HTTP and MQTT ones reach them), and a camera
> pipeline that is complete in code and has never met a camera — it receives RTSP media,
> depacketizes, muxes, records, retains and plays back, entirely against an in-process test
> server. See [Camera recording](https://github.com/vul-os/aql/blob/main/docs/CAMERA-RETENTION.md),
> which is the retention policy it implements, settled before any of it was written.

## The seven device kinds

Aql's device model has seven kinds. They are what the console renders, what the
automations runtime would fire on, and what a driver has to map its protocol onto:

| Kind | Examples | Status |
| --- | --- | --- |
| **Camera** | Gate camera, yard camera (ONVIF/RTSP) | Driver ships — discovery, status and readings. Video ships too: recording, retention, a per-camera view permission and MSE live view. **No camera has ever been involved** |
| **Lighting** | Zigbee groups, individual fixtures | No dedicated driver. Drivable today through MQTT (zigbee2mqtt) or generic HTTP |
| **Robot** | Robot mower, security patrol bot, cleaning bot | **No dedicated driver.** Drivable through MQTT or generic HTTP — kind `robot`, capability `robot.job`/`robot.blade-job`, one action per verb — with the hazardous-motion tier intact. Nothing speaks a mower's own protocol |
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
constraint. Opening does **not** go through the device engine and deliberately never will
— see [ACCESS-ON-THE-ENGINE.md](https://github.com/vul-os/aql/blob/main/docs/ACCESS-ON-THE-ENGINE.md)
§3.1. Gates DO now appear in the engine's fleet, read-only, through the `access` driver:
status only, every verb refused, and it is the one driver that needs no device config
because it reads the database.

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
| Zigbee / Z-Wave | Battery sensors, switches, bulbs, older ecosystems | **Reachable now, through a bridge.** `zigbee2mqtt` or `zwave-js-ui` owns the radio and republishes to MQTT; the hub has no radio and is not getting one. **Discovery reads zigbee2mqtt only** — it decodes that bridge's `bridge/devices` announcement, and reports any other known bridge as unreadable rather than silent, so a Z-Wave fleet is configured by topic instead of listed for you |
| Matter | Modern smart-home devices | **No code.** Needs a certified device and a stack |

A driver never decides what a device may be asked to do. Capabilities come from the
catalogue, so a discovery pass proposes a *candidate* with an address attached and a
human decides what joins the fleet — the same rule the MQTT bridge scan and the mDNS
browse follow, and for the same reason: anything on the LAN can answer.

Access points now appear in the engine's device list through the read-only `access` driver,
so the console can show a gate beside a lamp and a meter. ACTUATION stays on the signed
path permanently: two routes to a gate is worse than one, whatever the second one's
quality.

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

**Retention.** Raw samples are kept for 30 days by default and then pruned
(`AQL_ENERGY_SAMPLE_RETENTION`; set it to `0` to keep everything forever). Deltas are
never pruned at any age — they carry the counter endpoints a bill dispute is argued
from, and they are small. Neither is a channel's most recent sample, however old: deltas
are derived from consecutive samples, so that one row is the anchor a meter returning
after a long silence pairs against. Without it, its first reading back would be accepted
and then produce no delta at all.

Untested against physical meters.

## Security & bots

Built: an ONVIF driver (`hub/internal/devices/camera/`) that discovers cameras via
WS-Discovery, authenticates with WS-UsernameToken digest, and asks a camera for the RTSP
address of a chosen encoder profile.

There is also an RTSP client. Its cheapest mode does one thing — **DESCRIBE** — and the
full one receives media; this section is about the probing, and [Recording and live
view](#recording-and-live-view) below is about the media. Turn the probe on with
`VerifyStream` and the driver follows the address it resolved — authenticating with digest,
or basic where a camera offers nothing else — asks what the stream is, and reports the
answer: `H264 video · digest auth`. It holds no session.

Turn on `VerifyMediaFlow` and it goes one step further — SETUP the video track over
interleaved TCP, PLAY, watch RTP packets for a couple of seconds, TEARDOWN — answering what
`DESCRIBE` cannot: whether anything actually **comes out**. A camera that describes a
perfectly good stream and sends nothing is an ordinary failure (a dead encoder, a transport
it will not really do, a firewall permitting control and dropping media), and the only
symptom is a black player after the product said all was well. Such a camera reports as
**degraded**, not online.

It also reads the RTP **sequence numbers**, which answers a second question the packet
count cannot: whether the media arrived *intact*. A camera on a weak Wi-Fi link, or behind
a switch dropping frames, streams continuously and produces a smeared or frozen picture —
flowing, but lossy, and a probe that only counted packets would call it healthy. The
summary reports how many of the expected packets never arrived. Reordering, duplication
and the 16-bit sequence wrap are all kept out of that figure, because each of them makes a
naive count report a fault on a perfectly good stream.

A stream losing **2% or more** reports as **degraded**, not online — the same verdict a
camera that sends nothing gets, and for the same reason: it is reachable and not
delivering, and "online" sends you looking somewhere else. That threshold only applies
once at least 100 packets were expected; on a shorter burst one dropped packet is a large
percentage and no evidence at all, and degrading on it would flap the state between polls.
Both numbers are judgement calls rather than measurements, and they are written down as
such in `driver.go`. The counts (`media_lost`, `media_expected`) are reported whatever the
verdict, so a health graph has a baseline on the good days too.

None of this decodes anything, and that is a statement about the **probe**, not about the
package: depacketization, SPS parsing, access-unit assembly and muxing all exist and are
what the recording path below is made of. The probe deliberately does not use them,
because counting packets is the question it is asking and holding a decode pipeline open
for a health check is not free.

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

### Recording and live view

Both are built now, and the sentence that used to sit here — that they needed "a storage
design this repo does not have" — was answered first, on purpose:
[docs/CAMERA-RETENTION.md](https://github.com/vul-os/aql/blob/main/docs/CAMERA-RETENTION.md)
settles where clips live, how long they last, who may watch, and what a full disk does.
Recording is a data-retention policy with a UI attached, so the policy went first.

The path from a camera to a file, in order:

| Stage | What it does |
|---|---|
| `ConsumeMedia` | the SETUP/PLAY above, with the packets **kept** rather than counted |
| `h264.go` | RFC 6184 depacketization — single-NAL, STAP-A, FU-A → NAL units |
| `sps.go` | parses the sequence parameter set for the encoder's real size |
| `accessunit.go` | groups NAL units into pictures |
| `fmp4.go` | muxes pictures into a fragmented MP4 |
| `recording/` | writes clips, expires them, streams live viewers |

**Frame cropping is why the SPS is parsed at all.** 1080 is not a multiple of 16, so every
1080p camera encodes 1088 lines and crops 8 away. A muxer that writes the coded height
produces a file with a band of encoder padding along the bottom — and every box in it is
structurally valid, so nothing complains. The probe reports the cropped size, which is also
how you spot an ONVIF profile claiming one resolution while the encoder does another.

**Pictures are grouped by RTP timestamp**, not by parsing slice headers: RFC 3550 §5.1
requires every packet of one picture to share a timestamp, so the boundary costs four bytes
of header instead of a second bitstream parser. The marker bit is recorded and
cross-checked but never trusted to end a picture — real cameras set it early, late or never,
and a count of the disagreements is exposed so an unreliable one shows up as a number
rather than as split frames.

**Retention.** Clips live on the filesystem, never in SQLite — a database holding video
cannot be backed up or vacuumed by ordinary means, and a corrupt page would take the access
audit trail down with the footage. The layout is date-partitioned
(`<account>/<device>/<YYYY-MM-DD>/…`) so expiry is a directory walk and **so a human can
delete a day by hand without this software's cooperation**. Each camera has its own
`retain_hours`, default 72, and `0` means live-view-only — nothing is written at all.

Free space is a **floor**, not a cap: 10% of the filesystem or 2 GB, whichever is larger.
Below it, expired clips go oldest-first *across all cameras*, so a busy camera cannot evict
a quiet one's history. If that still does not clear the floor, **recording stops and says
so** — it will not delete unexpired footage to keep going, because that would make
`retain_hours` a lie under exactly the conditions where someone later goes looking.

**Who may watch is a permission, not a role.** `camera:view` is granted per member per
camera and is deliberately **not** implied by `owner` or `admin`. Everywhere else in this
product admin means "can configure the thing"; here it would mean "can watch the other
residents", and the owner of a shared house's hub is usually just whoever set it up. A fresh
install grants it to nobody. Grants can carry a time window, because an investigation is
usually bounded and the permission should be too.

Every view **and every refusal** is written to the hash-chained audit log, and that log is
readable by *every member* of the account rather than admins only — the subjects of footage
must not be the only people who cannot check who watched. A listing is not served if its
audit row cannot be written.

**Playback and live view.** Each clip is a self-contained fragmented MP4, so the console
plays one in a plain `<video>` with no plugin and no transcoding. A clip dropped by
retention answers **410 Gone with the reason**, not 404 — "gone" and "never existed" are
different answers, and someone looking for the evening they cared about is owed the first.
Live view fans the same fragments out over Media Source Extensions; it is **about ten
seconds behind**, because the hub captures a window at a time, and the response says so in
a header rather than leaving you to discover it by waving at a gate.

**What none of this establishes.** No part of this pipeline has met a camera. Every test
runs against fakes and an in-process RTSP server, and the container output is checked by
Chromium's MP4 parser, which *accepts* it — it does not play it, because the test payloads
are not decodable pictures. The retention arithmetic deletes real files under rules nobody
has exercised against real footage.

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
