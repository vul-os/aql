# Roadmap

> [!NOTE]
> Aql is early. Phase 0 is the only phase that's actually built — everything
> after it is a plan, not a promise. No dates, because none of this is
> scheduled yet.

## Phase 0 — Foundation (done)

- [x] Tauri v2 + SvelteKit/Svelte 5 app shell, builds as native desktop and PWA from one codebase
- [x] Operations-console UI: Overview, Devices, Energy, Automations
- [x] In-memory demo dataset (`src/lib/data.ts`) driving all four screens
- [x] Bundled fonts (no external font fetches)
- [x] Playwright screenshot pipeline (`npm run screenshot`), no backend needed
- [x] `system_pulse` Tauri IPC command (OS/arch/core-count/version round-trip from Rust to the UI)

## Phase 1 — Device engine (not yet built)

- [ ] Rust device/telemetry engine as the runtime behind the Tauri bridge
- [ ] Driver-adapter seam — one internal device model, pluggable protocol adapters:
  - [ ] Matter
  - [ ] MQTT
  - [ ] Zigbee
  - [ ] ONVIF (IP cameras)
  - [ ] Modbus
  - [ ] Generic HTTP/webhook
- [ ] Device discovery replacing the demo dataset with live device state

## Phase 2 — Local persistence & secrets (not yet built)

- [ ] SQLite for device state, history, and configuration
- [ ] OS-keychain-backed credential vault for device/service secrets (no plaintext credentials on disk)

## Phase 3 — Real automations (not yet built)

- [ ] Rule engine executing actual when → do automations against live devices (today's Automations screen is demo data with no execution behind it)
- [ ] Scheduling, conditions, and run history backed by persistence

## Phase 4 — Energy metering (not yet built)

- [ ] Real meter/inverter ingestion replacing the demo 24h chart
- [ ] Historical rollups (hourly/daily/monthly) in SQLite
- [ ] Source-mix accounting (solar/grid/battery) from live readings

## Phase 5 — Security & bots (not yet built)

- [ ] Camera live-view and recording pipeline (ONVIF/RTSP)
- [ ] Robot/bot control (mowers, cleaning, security patrol) beyond static demo status
- [ ] Alerting rules tied to real sensor/camera events

## Phase 6 — Remote access (not yet built)

- [ ] LAN-first control, always
- [ ] Opt-in remote access for when you're away from the LAN (design TBD, off by default)

## Phase 7 — Mobile packaging (not yet built)

- [ ] iOS/Android builds via Tauri mobile
- [ ] Mobile-specific layout passes on the existing console UI

## Phase 8 — Zana hardware integration (not yet built)

- [ ] First-class support for Zana open-hardware devices (mowers, sensor nodes, security/cleaning bots) as reference implementations of the driver-adapter seam
- [ ] Zana remains optional — Aql controls any hardware, Zana devices just work best with it

## Ecosystem

- **Aql** (this repo) — the software command center
- **[Zana](https://github.com/vul-os/zana)** — open-hardware designs for the devices Aql controls
