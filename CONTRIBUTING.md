# Contributing to Aql

Thanks for helping build a command centre for the physical world. Small, focused PRs
against `main` are the easiest to review and land.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — it is the contract, and it is explicit
about what is shipped versus what is only designed.

## What the repo is

| Directory | What it is |
| --- | --- |
| `hub/` | The hub: one Go binary, SQLite inside — chat channels, the open path, the embedded console, the API, the device hub, the audit log |
| `controller/` | The reference gate-device agent, its own Go module — pairing, signed-command verification, offline grants, events |
| `e2e/` | Cross-module Go harness that boots the real hub and controller binaries and drives them over the wire |
| `proto/` | The versioned wire contracts plus `vectors/` conformance fixtures (63 vectors, 70 checks) |
| `src/` | The React 19 + Vite console — embedded into the hub binary and wrapped by the desktop shell |
| `src-tauri/` | The Tauri v2 desktop shell (thin: one IPC command today) |
| `e2e-browser/` | Playwright suite that drives the **real** hub binary with the embedded console |
| `site/` | The static mini-site: `index.html`, the self-contained `docs.html` viewer, and `site/docs/` markdown |
| `docs/` | Deep engineering reference (threat model, design system, protocol alignment, command reference) |
| `scripts/` | Screenshotter and the docs-vs-code feature-claim guard |

## Dev setup

Prereqs: **Node 20+**, **Go** (version pinned in `hub/go.mod`), and — only if you
touch the desktop shell — **Rust stable** plus your platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/vul-os/aql && cd aql

npm install                                   # console deps

# hub
cd hub && go build -o aql-hub ./cmd/hub && cd ..
./hub/aql-hub -data ./data -listen 127.0.0.1:8080

# console (Vite dev server, points at a hub you choose on first run)
npm run dev

# desktop shell
npm run app:dev
```

The hub **refuses to bind a non-loopback address** unless you pass `-behind-proxy`; it
serves plain HTTP and has no TLS of its own. That is deliberate — see
[`site/docs/ingress.md`](site/docs/ingress.md).

## Checks

Run these before opening a PR; CI (`.github/workflows/ci.yml`) runs the same set.

| Command | Where | What |
| --- | --- | --- |
| `npm run typecheck` | root | `tsc --noEmit` |
| `npm test` | root | Vitest unit tests — includes the **route-parity** test, which shells out to `go run ./cmd/routegen` and fails if the console calls a route the hub does not serve |
| `npm run build` | root | `tsc -b && vite build` |
| `npm run check:claims` | root | The docs-vs-code feature-claim guard — fails if the docs claim a feature with no code behind it |
| `npm run test:e2e` | root | Playwright against a real hub binary with the embedded console (builds it first) |
| `go test ./...` | `hub/` | 1,411 test functions |
| `go test ./...` | `controller/` | 194 test functions |
| `go test ./...` | `e2e/` | Cross-module, real binaries over the wire |
| `cargo fmt --check` / `cargo clippy` | `src-tauri/` | Only if you touched the Rust shell |
| `node proto/vectors/verify.mjs` | root | Independently re-verifies all 63 conformance vectors |

## Ground rules

- **Be honest in docs and status.** This repo has a documented history of truth-up passes
  correcting overclaims, and `CHANGELOG.md` records them. If something is not built, say
  *not built* — plainly, in the same sentence as the feature. `npm run check:claims`
  exists to make that mechanical, and it is not the whole of the duty.
- **Fail closed** on anything touching webhooks, auth, signing or pairing. The one
  documented exception is the open-path rate limiter, which fails *open* on a counter
  error and tags the audit row — because locking residents out of a gate is the worse
  physical failure. Do not add new exceptions without saying why in the code.
- **Changes to [`proto/`](proto/) are additive-only** within a major version. Deployed
  controllers are forever. Add a vector for anything you add.
- **Do not rename the `AQL_*` environment variables, `lintel.db`, or the controller's
  `_lintel._tcp` mDNS service** — and do not remove the `LINTEL_*` fallback in
  `hub/cmd/hub/env.go` either; it is deprecated but no removal date has been decided.
  All of it is a deployment and wire contract for hubs and controllers already in the
  field. Everything user-facing is Aql; those identifiers are not user-facing.
- **Keep the hub local-first**: no default outbound calls, no cloud dependency, no
  telemetry, no billing code. Ever.
- **The Rust core stays small** and owns device I/O behind the IPC seam if and when the
  device engine lands.
- TypeScript throughout the frontend; keep `npm run typecheck` clean. Match the file you
  are editing — the codebase favours small modules, explicit error handling, and comments
  that explain *why*, not *what*.
- If you change the UI meaningfully, regenerate screenshots (`npm run screenshotter`).
- Security-sensitive findings go to [SECURITY.md](SECURITY.md), not the issue tracker.

The highest-value contributions right now are **device adapters** (the driver seam that
does not exist yet — see [`site/docs/devices.md`](site/docs/devices.md)), the phone half
of the offline-grant flow, a real GPIO relay driver, and honest docs.

Open an issue to discuss anything structural before a large PR.

## License

Aql is dual-licensed **MIT OR Apache-2.0** — see [LICENSE-MIT](LICENSE-MIT) and
[LICENSE-APACHE](LICENSE-APACHE). By contributing you agree your contributions are
licensed under the same terms. There is no CLA.
