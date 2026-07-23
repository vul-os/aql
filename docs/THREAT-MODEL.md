# Threat Model

> [!NOTE]
> This is a **target** threat model, not a description of a shipped, audited
> security posture. Aql today is a static Tauri + SvelteKit console rendering
> an in-memory demo dataset — there is no device engine, no network protocol
> handling, no credential store, and no auth wired up yet, so most of the
> controls below don't exist as code yet. This document exists so the
> security posture is designed intentionally from the start, and so
> contributors and users can hold future code to it.

## Scope and intent

Aql is a **sovereign command center for the physical world**: it discovers
and actuates cameras, locks, lights, energy systems, and autonomous bots on a
box you own. That combination — local authority + physical actuation — sets
the bar:

- No cloud broker sits between you and your devices.
- The box, not a vendor server, is the root of authority for every command.
- Some commands don't just show or hide information — they unlock doors,
  move machinery, or arm/disarm security systems. Mistakes there have
  physical consequences, not just data-confidentiality ones.

## Trust model (target)

| Component | Trust level |
|---|---|
| The box (Aql host) | Full authority. Owns device credentials, automation rules, and command issuance. |
| Desktop/mobile/PWA clients | Untrusted until authenticated to the box; treated as views/controllers, not sources of truth. |
| LAN | Semi-trusted by default (see below) — assumed to be the home/business's own network, but not assumed free of hostile devices. |
| WAN / remote access | Untrusted by default. Not reachable unless explicitly opted into. |
| Third-party device firmware (cameras, sensors, bots) | Untrusted. Aql should not assume device firmware is honest or unexploitable, and should isolate blast radius accordingly (see Residual risks). |
| Zana hardware | Designed to work well with Aql but held to the same "untrusted device" bar as any other hardware — no special trust just because it's the companion hardware line. |

## Network exposure

- **LAN-only by default.** The intended default posture is that Aql's
  control plane is reachable only from the local network the box sits on —
  no port forwarding, no default WAN listener, no built-in relay.
- **Remote access is opt-in and explicit.** Reaching your box from outside
  the LAN (e.g. checking cameras while away) is planned as a feature you
  turn on deliberately, not a default-on convenience. It is not designed yet;
  when it is, it will get its own threat-model addendum rather than being
  folded quietly into the default posture.
- **No cloud broker in the data path.** Unlike hub models that route your
  camera feed or device commands through a vendor's servers, Aql's design
  goal is that command-and-control traffic stays between your clients and
  your box.

## Credentials

- Device credentials (camera passwords, RTSP/API tokens, third-party hub
  keys) are planned to live in the **OS keychain**, not in a config file or
  the local database. See [`CONFIGURATION.md`](./CONFIGURATION.md).
- The UI is intended to be **write-only** for secrets in normal operation:
  you set a credential once; the app doesn't need to redisplay it.
- No credential sync across boxes/devices is planned — each box's keychain
  is local, so compromising one box's keychain doesn't hand over every box's
  secrets.

## What an attacker gets, by position

### Attacker on the LAN (no box access)

Target posture, once the network layer exists:

- Can potentially see that an Aql instance is discoverable/advertising on
  the network (mDNS/SSDP-style discovery is expected for device onboarding),
  which is itself minor information leakage.
- Should **not** be able to issue device commands or read device state
  without authenticating to the box first — LAN presence alone should not be
  an implicit trust boundary for control actions, even though it's the
  default *reachability* boundary.
- Could attempt to impersonate a device during discovery/pairing; onboarding
  flows need to defend against rogue-device spoofing, not just rogue-client
  access.

### Attacker with access to the box (OS-level compromise, physical access, or a supply-chain foothold)

- Game over for that box: full authority over every connected device,
  the keychain entries the OS will release to the app, and the local
  database. This is inherent to the "box is the authority" model — Aql does
  not (and architecturally cannot, without reintroducing a cloud broker) 
  protect against a fully compromised host.
- This is the same trust boundary every local-first, self-hosted system
  accepts (e.g. a NAS, a self-hosted Home Assistant instance). The
  mitigation is standard host hardening (OS updates, disk encryption,
  physical security of the box), which is out of Aql's scope to enforce but
  in scope to document.

### Attacker who compromises a single device (e.g. a cheap IoT camera)

- Not yet designed for, flagged here as a required design constraint: a
  compromised camera or sensor should not be able to pivot into controlling
  unrelated devices (a lock, a bot) just because both are managed by the
  same Aql instance. Per-device credential scoping (see Configuration) is a
  first step; command-level authorization/segmentation is future work.

## Physical-actuation-specific concerns

Because Aql is designed to actuate the physical world, not just report on
it, a few classes of command need extra care that a pure dashboard wouldn't:

- **Safety-critical commands** (unlock a door/gate, start a mower, arm/disarm
  a security bot) should get confirmation and/or stronger authorization than
  read-only telemetry, once command authorization exists at all.
- **Automations** that chain physical actions (e.g. "away arm" disarming
  vs. arming locks and bots) need to fail closed on ambiguous sensor state —
  designed intent, not yet implemented since automations are demo data only
  today.
- **Fleet/robot commands** (movement, patrol routes) should be rate-limited
  and scoped so a compromised client can't be used to, say, drive a mower
  into a person or pet. No such limits exist yet because there's no robot
  control path yet.

## Explicitly out of scope (for now)

- Multi-tenant / multi-user permission models (owner-vs-guest roles, etc.) —
  single-operator model only for the foreseeable future.
- Formal security audit — premature before there's a device engine to audit.
- Supply-chain verification of third-party device firmware — Aql controls
  devices, it doesn't attest to their firmware integrity.
- Remote-access threat model — deferred until the feature is designed.

## Residual risks (accepted, by design)

- **A fully compromised box has full authority.** This is the cost of "no
  cloud broker, box is the authority." There is no remote kill-switch or
  vendor-side revocation, by design — that would reintroduce the cloud
  dependency Aql exists to avoid.
- **Third-party hardware may be untrustworthy.** Aql promises to work with
  *any* hardware; it cannot promise that hardware isn't itself compromised
  or poorly secured. Aql's job is to contain the blast radius, not to fix
  vendor firmware.
- **LAN is a reachability boundary, not a trust boundary**, and the current
  design intent tries to say so explicitly above — but until authentication
  exists on the control plane, anything on the LAN is, in practice, trusted.
  That gap is real and is called out here rather than hidden.

## Reporting

There is no dedicated security-disclosure process yet, consistent with the
project's early stage. Until one exists, open an issue or contact the
maintainers directly for anything sensitive rather than filing a public
report with exploit details.
