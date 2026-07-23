# Configuration

> [!NOTE]
> Aql is early. This document describes the **intended** local-first
> configuration model. Today's build is a static Tauri + SvelteKit shell with
> **no persisted configuration at all** — nothing is read from or written to
> disk yet. Every screen renders from an in-memory demo dataset
> (`src/lib/data.ts`). Treat everything below marked *(planned)* as design
> intent, not shipped behavior.

## Principles

- **Local-first.** Aql runs on a box you own (home or business). All
  configuration and state are intended to live on that box. No account, no
  cloud broker, no phone-home is required for Aql to function.
- **No required cloud.** Any future cloud-adjacent feature (remote access,
  update checks) will be opt-in and clearly separated from the core control
  plane.
- **The box is the source of truth.** Desktop, mobile, and PWA clients are
  views onto the box's state, not independent stores of it.

## Current state (what actually exists today)

| Layer | Status |
|---|---|
| Frontend | SvelteKit SPA (`adapter-static`, `ssr = false`), rendered by Tauri's webview or a plain browser |
| Rust core | One Tauri IPC command, `system_pulse` (host OS/arch/cores/version) — no config reads/writes |
| Data | Static in-memory arrays in `src/lib/data.ts` (devices, events, automations, circuits) |
| Persistence | None. Reload the app and you get the same demo data; nothing survives a real restart because nothing is saved in the first place |
| Fonts/assets | Bundled locally (`static/fonts/*.woff2` — Bricolage, IBM Plex Mono); no external font/CDN fetches |
| Network | None. The app makes no outbound requests |

There is no settings screen, no config file, and no credential store wired up
yet. `pnpm tauri dev` / `pnpm tauri build` produce the same demo UI on every
machine.

## Planned configuration model

### Where things will live

| What | Planned location |
|---|---|
| App config (ports, feature flags, discovery settings) | A local config file under the OS-standard app-config directory (e.g. `~/.config/aql/` on Linux, `~/Library/Application Support/org.vulos.aql/` on macOS, `%APPDATA%\aql\` on Windows), via Tauri's path APIs |
| Runtime/device state (device list, automation rules, event history) | A local embedded database — most likely **SQLite** — file, stored next to the config |
| Device credentials (Wi-Fi PSKs, camera RTSP passwords, API tokens for third-party hubs) | The **OS keychain** (Keychain on macOS, Credential Manager on Windows, Secret Service/libsecret on Linux) via a Tauri keychain plugin — never written to the SQLite file or a plaintext config in cloud text |
| Logs | A local log directory, rotated, no remote shipping by default |

None of these paths or mechanisms are wired up yet — this is the target
layout, chosen so it matches how other local-first Tauri apps store state and
so device secrets never end up in a file that might get synced, committed, or
backed up in plaintext.

### Environment variables

No environment variables are read by the app today. Planned/likely future
variables (names not finalized):

| Variable | Purpose (planned) |
|---|---|
| `AQL_CONFIG_DIR` | Override the default config/data directory (useful for running multiple instances or in containers/CI) |
| `AQL_LOG_LEVEL` | Log verbosity |
| `AQL_DISCOVERY_DISABLE` | Turn off LAN device auto-discovery for a run |
| `AQL_BIND_ADDR` | Interface/port the local control-plane HTTP server (if any) listens on |

Standard Tauri/Vite dev variables (`VITE_*`) already work as usual for the
frontend build, but that's tooling, not app configuration.

### Credential handling (planned)

- Device credentials are **write-only from the UI's perspective in normal
  operation** — you enter a camera password or API key once, Aql hands it to
  the OS keychain, and the UI never needs to display it again.
- Credentials are scoped per device/integration, not stored as one shared
  blob.
- No credential sync between machines is planned; each box's keychain is
  local to that box, consistent with the local-first model.

### What "no required cloud" means in practice

- Aql is not intended to require a hosted account to add a device, run an
  automation, or view telemetry.
- Any optional remote-access feature (e.g. reaching your box from outside the
  LAN) is expected to be off by default and require explicit configuration —
  see [`THREAT-MODEL.md`](./THREAT-MODEL.md) for the exposure model that will
  govern that.

## Multi-instance / advanced setups

Not designed yet. A single box running a single Aql instance against its own
local store is the only configuration in scope right now. Fleet/multi-box
coordination is out of scope until the single-box engine exists.
