# `docs/` — deep reference

Two documentation sets live in this repository, and the split is deliberate.

| Where | What it is | Who reads it | Published? |
| --- | --- | --- | --- |
| **[`site/docs/`](../site/docs/)** | **The manual.** One ordered path from "what is this" → "run a hub" → "wire a gate" → "operate it" → reference. Everything a person needs to *use* Aql. | Operators, residents, evaluators | **Yes** — `site/docs.html` renders exactly this set, driven by `site/docs/manifest.json` |
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
| [`THREAT-MODEL.md`](THREAT-MODEL.md) | The adversarial model: what is defended, what is not, and the chat rail's exposure stated up front. Marks every control as *Shipped* or *Target*. |
| [`CHAT-COMMANDS.md`](CHAT-COMMANDS.md) | The exhaustive chat command and reply reference — every intent, every phrasing, every reply string. |
| [`KOTVA-ALIGNMENT.md`](KOTVA-ALIGNMENT.md) | Evidence-based audit of Aql against the KOTVA substrate spec: capability mapping, §26 node-mode obligations, offline-grant conformance, and the work list. |
| [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) | The visual system behind the console and the site — tokens, type, motion, component rules. |
| `assets/` | Images used by the files above. |

## Screenshots

Screenshots live in [`site/screenshots/`](../site/screenshots/) and are documented in the
manual at [`site/docs/screenshots.md`](../site/docs/screenshots.md). Regenerate them with
`npm run screenshotter`.
