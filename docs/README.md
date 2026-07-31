# `docs/` — deep reference

Two documentation sets live in this repository, and the split is deliberate.

| Where | What it is | Who reads it | Published? |
| --- | --- | --- | --- |
| **[`site/docs/`](../site/docs/)** | **The manual.** One ordered path from "what is this" → "what the hub owns" → "run a hub" → "operate it" → reference. Everything a person needs to *use* Aql. | Operators, residents, evaluators | **Yes** — `site/docs.html` renders exactly this set, driven by `site/docs/manifest.json` |
| **`docs/` (here)** | **The deep reference.** Long-form engineering material that is too detailed, too internal, or too exhaustive for the manual. | Contributors, auditors, implementers | No — read in the repo |
| Repo root | Front matter: [`README.md`](../README.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`ROADMAP.md`](../ROADMAP.md), [`CHANGELOG.md`](../CHANGELOG.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md) | Anyone landing on the repo | GitHub renders them |

**The rule, stated once:** if a page answers *"how do I use Aql?"* it belongs in
`site/docs/` and must be listed in `manifest.json`. If it answers *"how does Aql work
inside, and why?"* it belongs here. If it is the one canonical statement of the system's
shape, it is `ARCHITECTURE.md` at the root. Nothing should be answerable in two places —
cross-link instead of duplicating.

## What's here

| File | What it covers |
| --- | --- |
| [`CAMERA-RETENTION.md`](CAMERA-RETENTION.md) | Where footage lives, how long, who may watch it, and what a full disk does. **Built, and never run against a camera** — every decision here is code; no frame has come from real hardware. Written before the pipeline on purpose: recording is a data-retention policy with a UI attached. |
| [`CONTROLLER-CONFIG-REPORT.md`](CONTROLLER-CONFIG-REPORT.md) | A controller reporting its resolved actuation config back, so the hub can show what is in effect rather than only what it sent. **Designed, not built.** The carrier is a session report, not the ack — a gate nobody has commanded would otherwise never report. |
| [`ACCESS-ON-THE-ENGINE.md`](ACCESS-ON-THE-ENGINE.md) | Folding access into the device engine as a seventh kind. **Designed, not built.** Actuation deliberately does not move — the fold buys one fleet list, and two actuation routes to a gate is worse than one. |
| [`THREAT-MODEL.md`](THREAT-MODEL.md) | The adversarial model: what is defended, what is not, and the chat rail's exposure stated up front. Marks every control as *Shipped* or *Target*. |
| [`CHAT-COMMANDS.md`](CHAT-COMMANDS.md) | The exhaustive chat command and reply reference — every intent, every phrasing, every reply string. |
| [`KOTVA-ALIGNMENT.md`](KOTVA-ALIGNMENT.md) | Evidence-based audit of Aql against the KOTVA substrate spec: capability mapping, §26 node-mode obligations, offline-grant conformance, and the work list. It is also the canonical statement of the boundary: Aql's hub is **not** a KOTVA gateway — that role belongs to [Ephor](https://github.com/vul-os/ephor), which is where Aql's chat rail is moving. |
| [`EPHOR-CHAT-SEAM.md`](EPHOR-CHAT-SEAM.md) | Design specification for moving the chat rails out of Aql's hub and into Ephor. **Nothing in it is built** — it is the shape of a decided direction, not a description of shipped code. |
| [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) | The visual system behind the console and the site — tokens, type, motion, component rules. |
| `assets/` | Images used by the files above. |

## Screenshots

Screenshots live in [`site/screenshots/`](../site/screenshots/) and are documented in the
manual at [`site/docs/screenshots.md`](../site/docs/screenshots.md). Regenerate them with
`npm run screenshotter`.
