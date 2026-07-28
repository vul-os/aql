# Getting started

Aql is meant to be the software brain for your physical space — one self-hosted hub
that owns your cameras, lighting, robots, climate, energy and access control. Step one
of standing that up is always the same regardless of which device kind you care about:
run **your hub**. Step two is making one module real. Today, the module that's real end
to end is physical access control: gates, doors and barriers, opened from chat or the
web console. This chapter gets you from nothing to a hub with a gate wired into it, in
about an evening, assuming the controller hardware is mounted. Everything runs on your
own hub — there is no hosted service and nothing to sign up for. This chapter is the
short path; [Run a hub](self-host.md) has the full install, reachability and backup
detail.

> **What works out of the box** is physical access control: gates, doors and barriers,
> opened from chat or the web console. Lights, meters, cameras and sensors work too, but
> only once you configure the device engine — it is off until `-device-drivers` names a
> driver, and the drivers that exist are MQTT, Modbus TCP, generic HTTP and ONVIF.
> **Mowers and bots have no driver at all**, and cameras give you discovery and readings
> but no video. See [Devices](devices.md) before you plan around them.

## What you'll need

- Somewhere for the hub to live: a VPS, a Pi, any always-on box. Docker or a bare
  binary — your call. This is the thing that will eventually own everything else in
  your space, so it's worth putting it somewhere that stays on.
- A gate, door or barrier with a **dry-contact relay input** (most motors have one) —
  today's working device kind, and the first module you can make real.
- A Pi-class board running the controller agent. **Note:** the GPIO relay driver is not
  implemented — the default build logs actuations instead of pulsing a real relay, so
  driving actual hardware means writing that driver first. See
  [Controllers](controllers.md).
- A chat channel to bring: a Slack workspace is the five-minute start; WhatsApp needs
  your own Meta business number (a WABA) — see [Chat channels](channels.md).
- Ten minutes of ladder time to wire the controller in parallel with your existing motor.

## The six steps

1. **Run the hub.** This is the part every device kind will eventually sit behind — one
   binary, one SQLite file, web console embedded. Build it from source:

   ```sh
   git clone https://github.com/vul-os/aql
   cd aql/gateway && go build ./cmd/hub
   ./gateway -data /var/lib/aql -listen 127.0.0.1:8080
   ```

   > **Status.** The hub runs the access-control core now: auth, accounts, locations,
   > access points, controller pairing and the WebSocket device hub, the signed open
   > path, the admin console, rate limits and quotas, visitor grants, the tamper-evident
   > audit log, offline-grant issuance, and the WhatsApp / Slack / Telegram channels.
   > **Not implemented:** analytics endpoints, Google OAuth and
   > password reset (the console has screens for some of these that the hub does not
   > serve), and the entire device engine. A Docker image builds from the `Dockerfile`
   > in `gateway/`; the `ghcr.io/vul-os/aql-gateway` image is CI-built but published
   > only by a manually-dispatched workflow.
   >
   > The hub **refuses to bind a non-loopback address** unless you pass `-behind-proxy`
   > — it serves plain HTTP and has no TLS of its own. On a LAN-only install you need
   > nothing else: see [Reachability](reachability.md).

   Details, reachability options and backups in [Run a hub](self-host.md).
2. **Claim the admin account.** Open the console and sign up — the first account you
   create is the owner account. If you're also the person *running* the hub,
   claim the **instance admin** seat too: set `ADMIN_CLAIM_TOKEN` in the environment
   before first boot, then redeem it exactly once against `POST /admin/claim`, as
   described in [Instance admin](admin.md).
3. **Name your location** — house, complex, building or other. Give it a name residents
   will recognise. (A map pin is stored but nothing reads it: geofencing is designed and
   **not built** — see [Geofence safety](security.md#geofence-safety).) Then add an
   access point under
   **Access points → New** — main gate, pedestrian gate, parking barrier; each gets its
   own controller.
4. **Pair a controller.** Console → **Devices → Pair new** creates a claim token; the
   controller redeems it and pins the hub's signing key — permanently. Full walkthrough
   in [Controllers](controllers.md).
5. **Link a channel.** Slack first is the pragmatic order: an app manifest and a signing
   secret, minutes not days ([Chat channels](channels.md)). WhatsApp when your WABA is
   ready ([Linking WhatsApp](linking-whatsapp.md)).
6. **Invite yourself as a member** under **Members**, then send your first `open` to
   your hub's number or Slack app. The reply tells you what happened, in plain language.

## Optional: run the desktop app

The same console also ships as a Tauri v2 desktop app, with a hub picker on first run so
one build can point at any hub. It is the admin console — there is no emergency-access
screen in it yet (see [Emergency access](emergency-access.md)).

```sh
git clone https://github.com/vul-os/aql && cd aql
npm install
npm run dev          # console in a browser on :5173, against a hub you point it at
npm run app:dev      # native desktop window (needs Rust + Tauri system deps)
npm run app:build    # platform installers
```

Prerequisites for the desktop build: Rust stable via [rustup](https://rustup.rs/),
Node 20+, and your platform's [Tauri
prerequisites](https://v2.tauri.app/start/prerequisites/). The browser build needs only
Node. Neither build embeds a device engine — the app is a client for a hub.

## Members and roles

Members are people whose chat identity can text the gate. An identity is a
`(channel, external id)` pair — a WhatsApp phone number, a Slack member id — so one
person can be reachable on more than one channel.

- **Owner** — the account holder. Account and danger-zone settings.
- **Admin** — manages devices, members and access for assigned locations.
- **Member** — can open what they've been given. Can't change settings.
- **Guest** — like a member, but time-bound. Contractors and weekend visitors live under
  **Temp access** in the console, and their access expires on its own.

A role on a complex applies to all access points within it unless overridden. Revoking is
immediate: open the member, hit revoke, and the next message they send is declined. The
audit log keeps the history — revocation is not deletion.

## A note on trigger words

The default trigger is `open`, but the hub accepts any phrase you configure per
location. People text things like *oop*, *hey gate*, *buzz me in*, or a single 👍. If
it's on your allow-list, it works. When a member has access to several access points,
the reply is a numbered picker — they answer `1`, `2` or `3`.

## Next

- [Run a hub](self-host.md) — install options, reachability, backup and restore.
- [Chat channels](channels.md) — Slack in minutes, and the channel seam.
- [Linking WhatsApp](linking-whatsapp.md) — bringing your own number and WABA.
- [Controllers](controllers.md) — wiring and pairing.
- [Devices](devices.md) — what Aql is meant to control next, and
  what it cannot control today.
