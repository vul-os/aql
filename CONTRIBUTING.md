# Contributing to Aql

Aql is early and the architecture is still taking shape — the highest-value
contributions right now are **device adapters** (the driver seam), UI screens,
and honest docs. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first; it is
the contract.

## Setup

```sh
pnpm install
pnpm dev              # frontend on :1420 (demo data)
pnpm tauri dev        # full app against the Rust core
pnpm check            # svelte-check
pnpm run screenshot   # regenerate docs/screenshots
```

## Ground rules

- Keep the app **local-first** — no default network calls, no cloud dependency.
- Frontend is SvelteKit (SPA) + Svelte 5 runes; the Rust core stays small and
  owns device I/O behind the IPC seam.
- If you add a screen or change the UI meaningfully, regenerate screenshots.
- Be honest in docs and status — mark anything not built as *planned*.

Open an issue to discuss anything structural before a large PR.
