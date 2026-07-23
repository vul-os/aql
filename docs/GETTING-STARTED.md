# Getting Started

> [!NOTE]
> Aql is early-stage: the console runs on an in-memory demo dataset, and the
> Rust core exposes a single IPC command (`system_pulse`) so far. There is no
> real device integration, persistence, or auth yet. See
> [ARCHITECTURE.md](./ARCHITECTURE.md) for what's built vs. planned.

## Prerequisites

| Requirement | Notes |
|---|---|
| **Rust** (stable) | Install via [rustup](https://rustup.rs/) |
| **Node.js 20+** | |
| **pnpm** | `corepack enable` or `npm i -g pnpm` |
| **Tauri system dependencies** | Platform-specific native libs (WebView, build tools). Follow the official [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your OS before running `tauri dev`/`tauri build` |

The web/PWA build (`pnpm dev`) only needs Node + pnpm — the Rust toolchain and
Tauri system deps are only required for the desktop/mobile app.

## Clone and install

```bash
git clone https://github.com/vul-os/aql.git
cd aql
pnpm install
```

## Run the desktop app

```bash
pnpm tauri dev
```

Builds the Rust core, launches the native window, and hot-reloads the Svelte
frontend on save. First run will take longer while Cargo compiles
dependencies.

## Run in the browser (PWA mode)

```bash
pnpm dev
```

Starts a plain Vite dev server at `http://localhost:1420`. No Rust/Tauri
toolchain is invoked. Because there's no Tauri IPC bridge available in a
browser, the console falls back to the in-memory demo dataset in
`src/lib/data.ts` for devices, events, automations, and energy circuits — this
is the same fallback the production PWA build uses when it can't reach a
native backend.

## Regenerate screenshots

```bash
pnpm run screenshot
```

Drives a headless Chromium (Playwright) against the running console — starts
its own `vite dev` server on `:1420` if one isn't already up — and captures
each screen (Overview, Devices, Energy, Automations) via the `?view=` deep
link. Output goes to `docs/screenshots/` and is mirrored into `assets/screens/`
for the README/site. Uses the demo dataset, same as `pnpm dev`.

## Build installers

```bash
pnpm tauri build
```

Produces platform-native installers/bundles (`.app`/`.dmg`, `.msi`/`.exe`,
`.deb`/`.AppImage`, depending on OS) under `src-tauri/target/release/bundle/`.
Requires the Rust toolchain and Tauri system dependencies for the platform
you're building on/for.

## Other useful scripts

| Command | Purpose |
|---|---|
| `pnpm build` | Static SPA build only (no Tauri packaging) — same output the desktop/mobile shell embeds |
| `pnpm preview` | Preview the static build locally |
| `pnpm check` | Type-check the Svelte/TypeScript sources |
