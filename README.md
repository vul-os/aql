# Aql

**Aql** (عقل — "the mind") is an open-source command center for the physical world.

Plug in your cameras, lights, lawnmowers, IoT sensors, energy meters, and
autonomous bots (security, cleaning) — Aql discovers them, gives you one control
plane across all of it, and lets you automate anything. Runs on a box in your
home or business. Works with any hardware. Installable on desktop, mobile, and
the web from a single codebase.

## Stack

- **Tauri v2** — native desktop (macOS/Windows/Linux) + mobile (iOS/Android), tiny footprint, Rust core
- **SvelteKit + Svelte 5** (SPA mode) — fast, reactive UI; the same build ships as a PWA
- **Rust** — the device/telemetry engine behind the Tauri bridge

## Ecosystem

- **Aql** — the brain (this repo): the software command center.
- **[Zana](https://github.com/vul-os/zana)** — the body: open-hardware designs for the devices Aql controls (mowers, sensor nodes, security/cleaning bots).

Aql controls *any* device; Zana devices are built to work best with Aql.

## History

This repository's commit history is continuous with its predecessors — the
`main` chain preserves the original development history (the BotKorp lineage)
that Aql grew out of, scrubbed of all secrets, with the hardware split out to
[Zana](https://github.com/vul-os/zana). Aql itself is a clean-slate rebuild on
top of that history.

## Develop

```bash
pnpm install
pnpm tauri dev      # desktop app with hot reload
pnpm dev            # frontend only (browser / PWA)
pnpm tauri build    # package installers
```

## Status

Early — foundation + console UI in active development.
