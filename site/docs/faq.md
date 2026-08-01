# FAQ

### What is Aql?

Aql (Arabic عقل, "the mind") is an open-source **command centre for the physical world** —
the software brain for your physical space. One self-hosted hub, on a box you own, meant to
see and control everything physical around a home or a business.

Its device model has seven kinds: **camera, lighting, robot, climate, energy, sensor and
access**. One of them — access — is finished and running end to end. The engine behind the
others is running too, with four drivers on it, and energy metering is read end to end —
a camera now records, plays back and streams a recent view — though it decodes no picture
and has never met real hardware — and a robot has no driver of its own. How far each kind's path
goes is the thing to check, not whether the engine exists.

### What can it actually do today?

Physical access control, end to end — the first of the seven kinds to be driven all the
way down to the metal:

- A resident texts `open`; the hub resolves who they are, applies membership, rate limits
  and quotas, signs an Ed25519 command, and a paired controller at the gate verifies it
  against a pinned key and pulses the relay.
- A web console does the same thing without any chat platform, plus members, visitor
  passes, devices, and a tamper-evident audit log.
- An operator seat above every account, with runtime limit overrides and a cross-account
  audit view.

The hub is 136 HTTP routes and 1,397 Go test functions; the controller agent is 192
more; the wire contracts have 83 conformance vectors (118 checks) that both sides are
tested against.

### What can't it do?

No Matter and no robot driver. The camera pipeline **is** built — discovery, stream probe,
recording, retention, a per-camera viewing permission, playback and a recent live view — but
no part of it has met a real camera, and it decodes no picture: it moves frames into a file
a browser can play, rather than interpreting them. The device engine itself, the automations
runtime and energy metering are built, and all of it is off unless you configure it.

The offline emergency-access path works **over the LAN**: the app requests a grant, holds
it, and presents it straight to the controller over mDNS — anchoring the proof on the
*controller's* clock rather than the phone's, so a phone whose clock is wrong after a
blackout still opens the gate. What is missing is the **BLE** variant: the controller
implements it, but no browser can reach a radio, and the app says so rather than implying
otherwise. See [Devices](devices.md) and [Emergency access](emergency-access.md).

### Are the chat rails going away?

No. WhatsApp, Slack and Telegram are **shipped and supported** in the hub
(`hub/internal/channels/`), they are tested, and nothing is being removed.

There is a designed alternative in which an external coordinator —
**[Ephor](https://github.com/vul-os/ephor)**, the KOTVA family's rail-bridging component —
terminates the rail and hands the hub an authorised command instead. **None of it is
built**, and Ephor is `pre-alpha` by its own README badge, so it is an optional,
experimental path for people who want it, not a replacement for the rails you can use
today. The design is
[`docs/EPHOR-CHAT-SEAM.md`](https://github.com/vul-os/aql/blob/main/docs/EPHOR-CHAT-SEAM.md);
what actually runs is [Chat channels](channels.md).

### How is it different from Home Assistant?

Same neighbourhood, different centre of gravity — and Home Assistant has a vast shipped
integration ecosystem that Aql does not:

| | Home Assistant | Aql |
| --- | --- | --- |
| Primary audience | Home | Home **and** business |
| Shipped integrations | Thousands | One device kind: gate/door/barrier controllers |
| Access control | An integration among many | The first kind taken all the way down — signed commands, a device that verifies rather than trusts, a tamper-evident audit log |
| Chat control | Add-on / notification-shaped | A first-class input surface with identity resolution, quotas and per-rail signature verification |
| Model | One hub, huge integration ecosystem | One hub intended to own everything physical — cameras, lighting, robots, climate, energy, sensors, access — under one control plane |
| Packaging | Server-first (add-ons, HAOS) | One Go binary for the hub, plus a Tauri desktop console |

Aql is not trying to out-integrate Home Assistant, and today it is nowhere close. It starts
from a narrower, more opinionated shape — one hub, one authority, business and robots
included from the start, with the access-control and audit path taken seriously — and grows
outward. The reach is the ambition; one device kind is the evidence.

### Does it need the cloud?

No. There is no Aql service, no account with us, no license check and no telemetry. The
hub runs on your box and is the sole authority for every command; controllers verify
signatures, not network position, so a hostile network cannot forge an open.

**One honest exception:** if you use a chat channel, that chat platform is in the loop
and sees the plaintext of every message. The hub must read the message to act on it. Use
the web console for anything you don't want Meta, Slack or Telegram to see. Full detail
in [Security](security.md) and the repository's
[threat model](https://github.com/vul-os/aql/blob/main/docs/THREAT-MODEL.md).

### Does it work offline?

The controller keeps verifying and actuating while the hub is unreachable, and queues its
events to reconcile later. The hub itself needs no internet for the console path. What
does *not* work offline today is the phone-based emergency open — see above.

### I run this at home with no static IP. What do I actually need?

Nothing — unless you want WhatsApp, or console access from outside your LAN.

Controllers dial **out** to the hub, so gate hardware needs no inbound port and works
behind CGNAT or on a 4G SIM. Slack Socket Mode dials out too, so a Pi on your LAN with no
public address runs Slack end to end. Offline grants need no network at all.

WhatsApp is the one rail that genuinely requires a public HTTPS endpoint, because Meta's
Cloud API is webhook-only. If you need one, the hub does not care where it comes from —
ngrok, cloudflared, a Tailscale funnel, a small VPS running nginx, or a relay someone else
operates all end with you pasting a URL into `AQL_PUBLIC_URL`. Whatever provides that
URL also terminates TLS, because the hub speaks plain HTTP only.
See [Reachability](reachability.md).

### What hardware does it support?

For access control: any gate, door or barrier motor with a dry-contact relay input, driven
by a Pi-class board running the controller agent. **With one blunt caveat** — the GPIO
relay driver is not implemented. The default build uses a mock relay that only logs, and
the `-tags gpio` file is a stub that panics by design. Driving real hardware means
writing that driver to the fail-safe specification first.

For anything else: nothing yet. The goal is protocol-level breadth rather than a fixed
compatibility list, with [Zana](https://github.com/vul-os/zana) hardware tuned to work
best with Aql. That goal is not reflected in shipped code.

### Is it production-ready?

The access-control path is real, tested, and honest about its edges — but it is pre-1.0,
the GPIO driver has never driven a relay, the BLE radio has never run on hardware, and a
sole admin who loses both their password and their 2FA recovery codes has no in-band way
back in. Read [Security](security.md) and the threat model before you put it on a gate
people depend on.

**And a non-negotiable:** Aql must never be the only way out of a building. Fire and
building codes require code-compliant fail-safe egress hardware regardless of what any
access-control system does. Aql runs in parallel with that hardware, never in series and
never as a replacement.

### Can I run several properties on one hub?

Yes. The hub is genuinely multi-account: accounts, locations, access points, members with
roles, and an instance-admin seat above all of them. Tenant isolation is enforced by org
scoping on every query, including the rate-limit and quota counters.

### Is there a hosted version? What does it cost?

No, and nothing. There is no hosted service and no billing code anywhere in the binaries.
Your costs are your own hardware and, if you run a WhatsApp channel on your own number,
Meta's per-conversation fees billed directly to you. Slack and Telegram cost nothing.

### Why isn't the hub called a "gateway"?

Because in the KOTVA family "gateway" names a different, separate component's job — the
legacy-rail coordinator role, filled by [Ephor](https://github.com/vul-os/ephor). Aql's
hub is not that: it bridges chat rails into its own local domain. The backend used to live
in `gateway/` and build as `cmd/gateway`; it has since been renamed to `hub/` and `cmd/hub`
(binary: `aql-hub`) so that distinction is the default reading, not something you have to
be told about.

### Why do some things still say "lintel"?

Aql's access module shipped under the name *lintel* before the two projects merged.
The SQLite filename (`lintel.db`) and the controller's mDNS service (`_lintel._tcp`) are
a deployment and wire contract for hubs and controllers already in the field, so they
were deliberately left alone — renaming them would break upgrades and force re-pairing
for no benefit. The environment variables did get renamed to `AQL_*`; the old `LINTEL_*`
names still work as a fallback (logged once at WARN) so nothing already deployed breaks
on upgrade.

### What's Zana?

[Zana](https://github.com/vul-os/zana) is Aql's companion open-hardware line — designs
for the physical devices Aql is meant to control (mowers, sensor nodes, security and
cleaning bots). Aql is the software half of the pair; Zana is the hardware half. Aql
controls any hardware, and Zana devices are built to work best with Aql specifically.

### What's VulOS?

Aql is part of the [VulOS](https://vulos.org) ecosystem, which builds sovereign,
self-hosted alternatives to cloud-dependent software. Aql applies that posture — your
box, your data, no required cloud — to controlling the physical world.

### License

MIT OR Apache-2.0. Every line, including the hub, the controller agent and the wire
contracts.
