# FAQ

### What is Aql?

Aql (Arabic عقل, "the mind") is an open-source **command center for the
physical world**: one self-hosted hub that discovers and controls cameras,
lights, lawnmowers, IoT sensors, energy meters, and autonomous bots
(security, cleaning) — for homes and businesses. It's meant to work with any
hardware, not a curated device list.

### How is it different from Home Assistant?

Same neighborhood, different center of gravity:

| | Home Assistant | Aql |
|---|---|---|
| Primary audience | Home | Home **and** business |
| Scope | Smart-home devices | Smart-home devices **and** autonomous bots (security, cleaning, mowing) as first-class citizens |
| Model | One hub, huge integration ecosystem | One hub owns *everything* physical — cameras, energy, access control, and robots under one control plane, not siloed integrations |
| Hardware | Broad but curated ecosystem | Designed to work with any hardware; paired with an open-hardware line ([Zana](https://github.com/vul-os/zana)) for devices built to work best with it |
| Packaging | Server-first (add-ons, HAOS) | Tauri-based: one codebase ships as native desktop, mobile, **and** PWA |

Aql isn't trying to out-integrate Home Assistant's ecosystem on day one — it's
starting from a narrower, more opinionated shape (one hub, one authority,
robots and business use cases included from the start) and a different
delivery model (a single Tauri/Svelte codebase instead of a server appliance).

### Does it need the cloud?

No. Aql is local-first by design: it's meant to run entirely on a box you own,
with no required account and no cloud broker in the control path. See
[`THREAT-MODEL.md`](./THREAT-MODEL.md) and
[`CONFIGURATION.md`](./CONFIGURATION.md) for the target model.

### What hardware does it support?

**Honestly: none yet.** The device/driver engine — discovery, protocol
adapters, the pieces that would actually talk to a camera or a mower — is
**planned, not built**. Today's build is a console UI (Overview, Devices,
Energy, Automations) rendered against a static in-memory demo dataset
(`src/lib/data.ts`); it doesn't discover or talk to real devices.

The goal is broad, protocol-level support (works with *any* hardware) rather
than a fixed compatibility list, with [Zana](https://github.com/vul-os/zana)
hardware tuned to work best with Aql specifically. That goal isn't reflected
in shipped code yet.

### Does it run on desktop, mobile, and the web?

Yes, from one codebase: Tauri v2 provides native desktop (macOS/Windows/Linux)
and mobile (iOS/Android) builds around a Rust core, and the same
SvelteKit/Svelte 5 frontend also builds as a static PWA for the browser. The
Rust core currently exposes a single IPC command (`system_pulse`, basic host
telemetry) — the seam the real device engine will grow behind.

### Is it production-ready?

No. Aql is early: foundation and console UI on mock data, no real device
engine, no persistence, no network protocols, and no auth yet. Don't point it
at real locks, cameras, or robots expecting it to control them today — treat
this as an active work-in-progress, not a usable hub.

### What's Zana?

[Zana](https://github.com/vul-os/zana) is Aql's companion open-hardware line
— designs for the physical devices Aql is meant to control (mowers, sensor
nodes, security/cleaning bots). Aql is the software half of the pair; Zana is
the hardware half. Aql controls any hardware, and Zana devices are built to
work best with Aql specifically.

### What's VulOS?

Aql is part of the [VulOS](https://vulos.org) ecosystem, which builds
sovereign, self-hosted alternatives to cloud-dependent software. Aql applies
that same posture — your box, your data, no required cloud — to controlling
the physical world.

### License

MIT.
