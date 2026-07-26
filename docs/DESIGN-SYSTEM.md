# Lintel Design System — extracted for Aql

Status: documentation only. Nothing in Aql has been restyled yet. This is a precise,
evidence-based extraction of lintel's visual language (`lintel/src`, `lintel/site`,
`lintel/public`) so the next wave can port it onto Aql's SvelteKit shell.

Every value below is cited `path:line` from the files actually read. Where lintel
itself doesn't determine something (e.g. it has no dedicated wordmark SVG), this
document says so rather than inventing one.

---

## 1. Colour palette

Lintel's palette is defined once, as CSS custom properties, in
`lintel/src/styles/tokens.css:1-76`, and is **duplicated verbatim** (same hex
values) inline in the standalone marketing site at `lintel/site/index.html:51-109`
— confirming these are the canonical, final values rather than a work-in-progress
subset.

The palette is described in its own header comment as: *"warm neutrals + copper
accent... light: near-black ink on warm white paper. dark: true near-black
backgrounds — premium, not brownish."* (`lintel/src/styles/tokens.css:1-4`)

### Light theme (`:root`, `lintel/src/styles/tokens.css:6-40`)

| Role | Variable | Hex / value |
|---|---|---|
| Ink (primary text) | `--ink` | `#141210` |
| Ink, softened | `--ink-soft` | `#302C28` |
| Ink, faint (55%) | `--ink-faint` | `rgba(20, 18, 16, 0.55)` |
| Ink, whisper (9%, hairline rules) | `--ink-whisper` | `rgba(20, 18, 16, 0.09)` |
| Paper (page bg) | `--paper` | `#FAFAF8` |
| Paper, warm (secondary surface / sidebar) | `--paper-warm` | `#F2EDE6` |
| Paper, cool (card / input surface) | `--paper-cool` | `#FDFDFC` |
| Paper edge (hairline border) | `--paper-edge` | `rgba(20, 18, 16, 0.07)` |
| Terracotta (primary accent / CTA) | `--terracotta` | `#C86848` |
| Terracotta, deep (hover / danger-text) | `--terracotta-deep` | `#A24F32` |
| Terracotta, soft | `--terracotta-soft` | `#E8A48A` |
| Gold (secondary accent, admin/invited) | `--gold` | `#B8914A` |
| Gold, soft | `--gold-soft` | `#DEC07A` |
| Slate (tertiary/neutral text) | `--slate` | `#7C746C` |
| Moss (success/allowed) | `--moss` | `#5C7258` |
| Clay (decorative, e.g. lamp glow) | `--clay` | `#C2A88C` |
| Signal (semantic "success" green, distinct from moss) | `--signal` | `#3A6E56` |
| Shadow, paper (ambient card shadow) | `--shadow-paper` | `0 1px 2px rgba(14,12,10,.04), 0 8px 24px -8px rgba(14,12,10,.10)` |
| Shadow, deep (modal/elevated) | `--shadow-deep` | `0 20px 40px -14px rgba(14,12,10,.20)` |
| Aside surface (branded panel, both themes) | `--aside-surface` | `#141210` |
| Aside ink (text on aside) | `--aside-ink` | `#FAFAF8` |

### Dark theme (`:root[data-theme='dark']`, `lintel/src/styles/tokens.css:42-76`)

| Role | Variable | Hex / value |
|---|---|---|
| Ink | `--ink` | `#F5EFE6` |
| Ink, soft | `--ink-soft` | `#D8CFBF` |
| Ink, faint | `--ink-faint` | `rgba(245,239,230,0.55)` |
| Ink, whisper | `--ink-whisper` | `rgba(245,239,230,0.10)` |
| Paper (page bg) — **true near-black, not brown-dark; comment calls this "the signature upgrade"** | `--paper` | `#0F0E0C` |
| Paper, warm | `--paper-warm` | `#181614` |
| Paper, cool | `--paper-cool` | `#131210` |
| Paper edge | `--paper-edge` | `rgba(245,239,230,0.08)` |
| Terracotta | `--terracotta` | `#E0896A` |
| Terracotta, deep | `--terracotta-deep` | `#F0A484` |
| Terracotta, soft | `--terracotta-soft` | `#8A4A38` |
| Gold | `--gold` | `#D4AE6A` |
| Gold, soft | `--gold-soft` | `#8A6E40` |
| Slate | `--slate` | `#B4A89C` |
| Moss | `--moss` | `#8AAA84` |
| Clay | `--clay` | `#6E5A48` |
| Signal | `--signal` | `#88B89C` |
| Shadow, paper | `--shadow-paper` | `0 1px 0 rgba(255,255,255,.03), 0 16px 48px -16px rgba(0,0,0,.55)` |
| Shadow, deep | `--shadow-deep` | `0 32px 64px -24px rgba(0,0,0,.80)` |
| Aside surface (a touch warmer than `--paper` so the panel reads distinct at night) | `--aside-surface` | `#1A1714` |
| Aside ink | `--aside-ink` | `#F5EFE6` |

Note: `lintel/site/index.html:69-73` additionally names `--signal`'s role explicitly
as *"successful gate-open green — not whatsapp"* and pairs it with a `--signal-wash`
(12%/14% tint) and separate `--band`/`--band-text`/`--band-edge` names for what
`tokens.css` calls `--aside-*` — same values, different names between the React
portal and the static site. Treat `--aside-*` (portal) and `--band*` (site) as the
same design concept with a naming mismatch between the two codebases.

### A legacy colour still lurking in shadows

`lintel/src/components/ui/Card.tsx:25` and `lintel/src/components/ui/Button.tsx:29`
hardcode drop-shadow colours as `rgba(26, 31, 54, ...)` — that decimal triple is
`#1A1F36`, a **deep navy that does not appear anywhere in `tokens.css`**. It
matches the background rect fill in `lintel/public/favicon.svg:5` and
`lintel/public/icon.svg:5` (`fill="#1A1F36"`) and the OG-card gradient in
`lintel/public/og.svg:5-6` (`#1A1F36` → `#0F1326`). This means the shipped favicon/
mark predates (or was deliberately kept off) the warm-neutral palette rewrite —
the mark is still on the old navy identity while the rest of the UI moved to warm
near-black. Carry this forward as a decision point, not a bug to silently fix:
Aql's next wave should decide whether to re-key the mark to `--ink` (`#141210`)
or keep the navy as a distinct "mark-only" colour.

---

## 2. Typography

### Families — self-hosted, three variable fonts

Declared via `@font-face` in `lintel/src/styles/main.css:9-51` (portal) and
identically in `lintel/site/index.html:35-46` (site — the site is fully
self-contained HTML/CSS, no build step). All three ship as **variable woff2**
files, vendored so the app makes **no request to fonts.googleapis.com /
fonts.gstatic.com** (explicit comment, `lintel/src/styles/main.css:4-8`).

| Family | Weight axis | Style | File | Found at |
|---|---|---|---|---|
| Fraunces | 100–900 | normal | `fraunces-var.woff2` | `lintel/public/fonts/fraunces-var.woff2`, `lintel/site/fonts/fraunces-var.woff2` |
| Fraunces | 100–900 | italic | `fraunces-italic-var.woff2` | `lintel/public/fonts/fraunces-italic-var.woff2`, `lintel/site/fonts/fraunces-italic-var.woff2` |
| Inter | 100–900 | normal | `inter-var.woff2` | `lintel/public/fonts/inter-var.woff2`, `lintel/site/fonts/inter-var.woff2` |
| Inter | 100–900 | italic | `inter-italic-var.woff2` | `lintel/public/fonts/inter-italic-var.woff2`, `lintel/site/fonts/inter-italic-var.woff2` |
| JetBrains Mono | 100–800 | normal | `jetbrains-mono-var.woff2` | `lintel/public/fonts/jetbrains-mono-var.woff2`, `lintel/site/fonts/jetbrains-mono-var.woff2` |
| JetBrains Mono | 100–800 | italic | `jetbrains-mono-italic-var.woff2` | `lintel/public/fonts/jetbrains-mono-italic-var.woff2`, `lintel/site/fonts/jetbrains-mono-italic-var.woff2` |

The files exist identically in both `lintel/public/fonts/` (used by the React
portal build) and `lintel/site/fonts/` (used by the static marketing/docs site) —
same six files, duplicated per-deployable, per
`lintel/src/styles/main.css:5-7` comment: *"same files web/landing.html uses."*

Role assignment (`lintel/src/styles/main.css:69-71`):
```css
--font-display: "Fraunces", "Iowan Old Style", "Apple Garamond", serif;
--font-sans:    "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono:    "JetBrains Mono", ui-monospace, "SF Mono", monospace;
```
- **Fraunces** (a "soft serif" variable font with an `opsz`/`wght`/`SOFT` axis) is
  the *display* face — headings, stat numbers, the "lintel" wordmark itself.
- **Inter** is the body/UI sans — set as the default on `html, body`
  (`lintel/src/styles/main.css:96-104`).
- **JetBrains Mono** is used for anything tabular/technical: audit-log
  timestamps, IDs, code blocks, "eyebrow" kicker labels.

### The Fraunces `SOFT` variation axis — a distinctive, deliberate detail

Fraunces exposes a custom `SOFT` variable axis (roundness of the serifs). Lintel
uses three named utility classes that dial it differently per context
(`lintel/src/styles/main.css:138-155`):

```css
.font-display        { font-variation-settings: "SOFT" 30;  }              /* default heading softness */
.font-display-tight  { font-variation-settings: "SOFT" 0; letter-spacing: -0.02em; } /* tight hero headline */
.numeral              { font-feature-settings: "lnum","tnum"; font-variation-settings: "SOFT" 100; } /* stat digits — max soft, tabular */
```
The marketing site duplicates this exactly (`lintel/site/index.html:130-132`) and
additionally uses literal `font-weight` alongside the axis (`420` for `.display`,
`440` for `.display-tight`, `lintel/site/index.html:130-131`) — Fraunces variable
weight, not a fixed static weight.

### Sizes / weights / line-heights actually observed

These are Tailwind utility classes and literal `font-size` declarations pulled
from real component/page markup — not a designed "type scale" file (none exists;
lintel has no `tailwind.config.js`, sizing comes from Tailwind v4's CSS-first
`@theme` block in `lintel/src/styles/main.css:53-74`, which only overrides
*colors*, *font families* and one custom radius — font sizes are Tailwind's
stock scale plus a handful of arbitrary `text-[…]` values).

| Context | Class / rule | Effective size | Source |
|---|---|---|---|
| Hero H1 (site) | `.hero h1` | `clamp(2.9rem, 10.5vw, 7.6rem)`, `line-height: .92` | `lintel/site/index.html:207` |
| Hero H1 (portal landing) | `.font-display-tight` + `leading-[0.94] tracking-[-0.02em]` | fluid, Tailwind text scale | `lintel/src/components/landing/Hero.tsx:52` |
| Section H2 | `.section-head h2` | `clamp(2.2rem, 5.4vw, 4.2rem)`, `line-height: .98` | `lintel/site/index.html:271` |
| Chat-copy H2 | `.chat-copy h2` | `clamp(2.2rem, 5vw, 3.6rem)`, `line-height: 1.02` | `lintel/site/index.html:280` |
| Self-host band H2 | `.selfhost h2` | `clamp(2.2rem, 5.4vw, 4rem)`, `line-height: .98` | `lintel/site/index.html:347` |
| Brand wordmark (nav) | `.brand-name` | `22px`, italic Fraunces, `SOFT 60`, `letter-spacing: -.01em` | `lintel/site/index.html:158` |
| Footer wordmark | `.footer .brand-name` | `38px` | `lintel/site/index.html:397` |
| Stat value (`StatBlock`) | `font-display text-3xl` | `30px` (Tailwind `text-3xl`) | `lintel/src/components/ui/Card.tsx:49` |
| Stat value (site) | `.stat-row dd` | `26px`, `SOFT 100` numeral style | `lintel/site/index.html:228` |
| Card/dashboard numeral | `.numeral` class | inherits, `lnum`/`tnum` + `SOFT 100` | `lintel/src/styles/main.css:151-155` |
| Body copy (base) | `html,body` | browser default `16px` (site sets explicit `font-size:16px; line-height:1.6`, `lintel/site/index.html:117`) | portal: `lintel/src/styles/main.css:96-104` (no explicit size override) |
| Hero tagline (site) | `.hero-tag` | `18px`, `line-height:1.65` | `lintel/site/index.html:211` |
| Hero sub (site) | `.hero-sub` | `15px`, `line-height:1.7` | `lintel/site/index.html:213` |
| Eyebrow / kicker | `.eyebrow` | `11px`, `letter-spacing:.22em`, uppercase, mono | `lintel/site/index.html:133` |
| Table header (`Th`) | Tailwind classes | `10px` (`text-[10px]`), `tracking-[0.18em]`, uppercase | `lintel/src/pages/app/admin/shared.tsx:175` |
| Status pill / badge text | Tailwind | `10px` (`text-[10px]`), `tracking-[0.16em]`, uppercase | `lintel/src/pages/app/admin/shared.tsx:198,209` |
| Field label | Tailwind | `text-sm` (14px), `font-medium` | `lintel/src/components/ui/Field.tsx:79` |
| Field input text | Tailwind | `text-[15px]` | `lintel/src/components/ui/Field.tsx:94` |
| Button text (md) | Tailwind | `text-[15px]` | `lintel/src/components/ui/Button.tsx:22` |
| Code block (`hl-pre`) | `.hl-pre` | `12.5px`, `line-height:1.65`, weight `500`, mono | `lintel/src/styles/main.css:634-643` |
| Code toolbar language tag | `.hl-lang` | `10.5px/1`, `letter-spacing:.18em`, uppercase | `lintel/src/styles/main.css:608-613` |
| Accordion question (FAQ) | Tailwind | `text-xl sm:text-2xl md:text-3xl` (20/24/30px), `font-display` | `lintel/src/components/ui/Accordion.tsx:22` |
| Modal title (`ConfirmModal`) | Tailwind | `text-2xl` (24px), `font-display` | `lintel/src/pages/app/admin/shared.tsx:146` |

**Letter-spacing convention**: uppercase micro-labels ("kickers", table headers,
badges, pill tabs) consistently use very wide tracking — `0.16em`–`0.22em` — at
tiny sizes (`10px`–`11.5px`), in mono or sans. This is a load-bearing, repeated
pattern across both the portal and the site (at least 9 separate call sites
cited above use this exact 10–11.5px / wide-tracking / uppercase combination).

**Numeral treatment**: anywhere a raw count/number is the hero of a UI moment
(dashboard stat cards, audit pagination counts, FAQ index numbers), lintel either
uses the Fraunces `.numeral` class (`SOFT 100`, tabular lining figures) or plain
`tabular-nums`/`font-mono` — never a plain default-figure sans number in a
prominent position.

---

## 3. Spacing, radius, shadows, borders

### Spacing

No custom spacing scale is defined — `lintel/src/styles/main.css:53-74`'s
`@theme` block overrides only colors, font families, and `--radius-arch`.
Spacing is Tailwind v4's stock 4px-based scale used directly
(`gap-2`, `p-6`, `px-4`, `h-11`, etc., seen throughout the components already
cited). Treat "no bespoke spacing scale" as itself a fact worth preserving:
lintel relies entirely on Tailwind defaults for spacing.

### Border radius

One custom radius token exists:
```css
--radius-arch: 999px 999px 4px 4px;   /* lintel/src/styles/main.css:73 */
```
This is the signature "arch" shape (fully rounded top corners, near-square
bottom corners) — used for decorative icon chips on the marketing site
(`lintel/site/index.html:243,372`) and echoed structurally in the actual arch
glyph of the logo mark. It is **not currently used anywhere in the React portal
source** (`grep` for `radius-arch` in `lintel/src` only finds its own
definition, `lintel/src/styles/main.css:73`) — it's a site-only decorative
device today, a real but underused asset.

Everything else uses Tailwind's stock radius scale directly:
- `rounded-full` — buttons (`lintel/src/components/ui/Button.tsx:21-23`), pills/chips/badges, pagination buttons, filter tabs
- `rounded-3xl` — cards (`lintel/src/components/ui/Card.tsx:25`), modal panel (`lintel/src/components/ui/Modal.tsx:60`)
- `rounded-xl` — inputs (`lintel/src/components/ui/Field.tsx:83`), search box (`lintel/src/pages/app/admin/shared.tsx:279`)
- `rounded-lg` — nav links (`lintel/src/components/nav/AppSidebar.tsx:26,45`)
- `rounded-md` — small icon buttons (`lintel/src/components/ui/Field.tsx:64`)
- `rounded-[42px]` / `rounded-[38px]` — one-off arbitrary values for the phone-mockup illustration (`lintel/src/components/landing/WhatsAppDemo.tsx:112,116`)

### Shadows

Two named tokens exist in `tokens.css` (`--shadow-paper`, `--shadow-deep`,
see §1 tables) but are **not referenced by variable name anywhere in
`lintel/src`** (`grep` for `shadow-paper|shadow-deep` in `lintel/src` only
matches their own definitions in `tokens.css`). In practice every component
hardcodes its own arbitrary Tailwind shadow value that approximates the same
idea:
- Buttons: `shadow-[0_1px_0_rgba(0,0,0,0.08),0_8px_24px_-12px_rgba(214,98,77,0.55)]` (primary, tinted with terracotta) / `rgba(26,31,54,0.6)` (ink variant) — `lintel/src/components/ui/Button.tsx:28-29`
- Cards: `shadow-[0_1px_0_rgba(26,31,54,0.04),0_12px_32px_-16px_rgba(26,31,54,0.18)]` — `lintel/src/components/ui/Card.tsx:25`
- Modal: `shadow-[0_24px_64px_-24px_rgba(0,0,0,0.5)]` — `lintel/src/components/ui/Modal.tsx:60`
- Toasts: `shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]` — `lintel/src/pages/app/admin/shared.tsx:104`
- Code figure (`.hl-figure`): `box-shadow: 0 1px 2px rgba(14,12,10,.06), 0 12px 32px -16px rgba(14,12,10,.30)`, dark variant swaps to `rgba(255,255,255,.03)`/`rgba(0,0,0,.55)` — `lintel/src/styles/main.css:591,596`

Pattern: soft, large-blur, negative-spread drop shadows (never hard/sharp), with
shadow colour tinted toward the surface's own ink or the component's accent
colour — never pure black at any opacity above ~0.55, and never used at all in
light-mode outside cards/modals/toasts (nav, sidebar and inputs use borders,
not shadows, for separation).

### Borders

Hairline borders are the primary separator, not shadows or heavy dividers.
Standard idiom: `border border-ink/10` (sidebar, top bar dividers —
`lintel/src/components/nav/AppSidebar.tsx:10`, `AppTopBar.tsx:18`), `border-ink/8`
(cards — `Card.tsx:7-10`), `border-ink/15` (inputs, filter-pill borders —
`Field.tsx:74`, `shared.tsx:243,251,279`). Opacity step-down (`/8` → `/10` →
`/15` → `/25`) is used consistently as the "how much emphasis does this line
need" dial, always relative to `--ink` (so it inverts correctly in dark mode
automatically since `--ink` itself flips from near-black to near-white).

---

## 4. Theme-switching mechanism

Single source of truth: **one HTML attribute**, `data-theme`, set on
`<html>` (`document.documentElement`):

```ts
// lintel/src/lib/theme.tsx:43-48
useEffect(() => {
  document.documentElement.dataset.theme = theme;
}, [theme]);
```

- Storage key: `localStorage['lintel.theme']` (`lintel/src/lib/theme.tsx:19,35`).
- Initial resolution order (`lintel/src/lib/theme.tsx:22-27`): explicit stored
  value (`'light'`/`'dark'`) → else `window.matchMedia('(prefers-color-scheme: dark)')`
  → else `'light'`.
- All colour tokens are re-declared under `:root[data-theme='dark']` in
  `tokens.css:42-76` — no JS-driven colour swapping, no separate dark
  stylesheet; CSS custom-property cascade does all of it.
- `color-scheme: light` / `color-scheme: dark` is set alongside (`tokens.css:7,43`)
  so native form controls / scrollbars also flip.
- The switch is **deliberately not** globally transitioned (explicit comment,
  `lintel/src/styles/main.css:76-82`): only `html { background-color, color }`
  and `body { background-color, background-image }` get a short crossfade
  (`0.3s`–`0.4s ease`, `main.css:83-94`). A prior attempt at transitioning
  *every* element for 1.6s produced visible artifacts and was reverted — this
  is a "don't regress" note for whoever ports this.
- The toggle control (`lintel/src/components/nav/ThemeToggle.tsx`) is a single
  button with two stacked SVG icons (sun/moon) whose opacity/rotation/scale are
  driven purely by `:root[data-theme='dark'] .theme-toggle-sun / .theme-toggle-moon`
  CSS rules (`lintel/src/styles/main.css:205-273`) — no icon-swap in JS, just a
  CSS state selector.
- Three toggle visual variants (`default`, `landing`, `auth`) share the same
  mechanism, differing only in size/border/background chrome
  (`lintel/src/components/nav/ThemeToggle.tsx:14-25`).

---

## 5. Component patterns

### Buttons (`lintel/src/components/ui/Button.tsx`)
- 5 variants: `primary` (terracotta fill), `ink` (near-black fill), `paper`
  (paper-cool fill + hairline border), `outline` (transparent, border, inverts
  to ink fill on hover), `ghost` (transparent, tints `bg-ink/5` on hover).
- 3 sizes, all **fully pill-shaped** (`rounded-full`): `sm` = 36px tall / 16px
  horizontal padding / 14px text; `md` = 44px / 20px / 15px; `lg` = 56px / 28px /
  16px (`Button.tsx:20-24`).
- Hover motion: `hover:translate-y-[-1px]` on the two filled variants (primary,
  ink) — a 1px lift, paired with the shadow, not a scale or colour-only change
  (`Button.tsx:28-29`).
- Focus ring: `focus-visible:ring-2 ring-ink ring-offset-2 ring-offset-paper` —
  always ink-coloured, never accent-coloured (`Button.tsx:18`).
- `LinkButton` is a parallel component sharing the same class tables so
  `<Link>` and `<button>` are visually indistinguishable (`Button.tsx:52-68`).

### Cards (`lintel/src/components/ui/Card.tsx`)
- 4 "tones": `paper` (default, `bg-paper-cool` + `border-ink/8`), `ink` (fully
  inverted, dark fill even in light mode — used for the hero stat tile seen in
  the dashboard screenshot), `cream` (`bg-paper-warm`), `transparent`.
- Always `rounded-3xl`, `p-6`, plus the two-layer shadow described in §3.
- `StatBlock` sub-component: uppercase 11px/`0.18em`-tracked label at 55%
  opacity, a big `font-display text-3xl` value, optional muted hint line
  (`Card.tsx:35-53`) — this is the exact shape of the "OPENS TODAY / 47 / +6 vs
  yesterday" tile in the dashboard screenshot.

### Tables (audit/activity log — `lintel/src/pages/app/admin/AdminAudit.tsx`,
`shared.tsx:171-186`)
- `Th`: left-aligned, `10px` uppercase, `0.18em` tracking, 55%-opacity ink,
  *not* bold (`font-normal`) — a deliberately quiet header, not a loud one.
- `Td`: plain padding, vertically centered.
- Row separators are hairlines (`border-b border-ink/8`, last row has none),
  with a `hover:bg-paper-warm/40` row highlight — no zebra striping.
- Two distinct audit trails share one page via a pill-tab switcher
  (`Access log` / `Admin actions`, `AdminAudit.tsx:39-60`) and the access log
  has its own row of filter-kind pills below that (`Success/Denied/Opens/
  Closes/Rate limited/Quota/Suspended`, `AdminAudit.tsx:23-32,80-98`).
- Status is conveyed via a small coloured dot + label (`ResultDot`,
  `lintel/src/pages/app/admin/AdminAccounts.tsx:377-394`): moss = success-open,
  ink = success-close, gold = rate-limited, terracotta = denied/other — dot
  colour is the primary signal, text is secondary.
- Timestamps and IDs are always `font-mono`, small (10–12px), muted
  (`text-ink/45` to `/60`) — technical data is visually demoted relative to
  the human-readable columns next to it.

### Nav
- **Sidebar** (`AppSidebar.tsx`, desktop only, `hidden lg:flex`, fixed 240px
  (`w-60`)): logo mark in a `bg-ink` rounded-md chip + italic Fraunces
  wordmark at the top; nav items are `rounded-lg` rows, active state is a
  **solid ink pill** (`bg-ink text-paper`), not an underline or accent border;
  an "Operator" section is visually separated by a `border-t` + tiny uppercase
  label + a gold dot next to the admin link (`AppSidebar.tsx:38-56`).
- **Top bar** (`AppTopBar.tsx`): sticky, `bg-paper/85` + `backdrop-blur`,
  hairline bottom border; shows a breadcrumb-style
  `lintel / <page title>` (title from the route segment, `.replace(/-/g,' ')`
  then `capitalize`); theme toggle + account switcher live on the right; explicit
  design decision recorded in a comment that there is **no global "open gate"
  CTA in the top bar** because it would be ambiguous which gate (`AppTopBar.tsx:44-48`).
- **Mobile**: a hamburger opens a full drawer (`MobileNavDrawer`), not present
  in desktop layout (`lg:hidden`, `AppTopBar.tsx:20-34`).

### Badges / chips / pills
- `StatusPill` (`shared.tsx:188-205`): rounded-full, 10px uppercase text,
  `0.16em` tracking, tone-coloured background+border+text at low opacity
  (e.g. `active` = `bg-moss/15 text-moss border-moss/30`; `suspended` =
  terracotta; `disabled` = neutral ink; `invited` = gold).
- `AdminBadge` (`shared.tsx:207-214`): same shape, gold-only, with a tiny
  1px dot prefix, reading "admin".
- Filter/tab pills throughout (`AdminAudit.tsx:46-59,82-97`) share one idiom:
  unselected = transparent + `border-ink/15` + muted text; selected = solid
  `bg-ink text-paper` (or `bg-ink/90` for the outer tab row) — no accent-colour
  fill is ever used for "selected", only ink.

### Form fields (`lintel/src/components/ui/Field.tsx`)
- Label row: 14px medium label left, optional trailing hint/link right
  (`labelTrailing`, e.g. a "Forgot password?" link sits inline with the label,
  not below the field).
- Input chrome: 44px tall, `rounded-xl`, `bg-paper-cool`, 1px border that
  brightens on focus (`border-ink/15` → `border-ink/40`) plus a
  `focus-within:ring-2 ring-ink/20`; error state swaps the whole ring/border
  to terracotta (`Field.tsx:72-74`).
- Password fields get a built-in show/hide eye toggle rendered as the `suffix`
  slot automatically (`Field.tsx:57-70`), with custom hand-drawn eye/eye-off
  SVG icons (not a library icon set — `Field.tsx:108-126`).
- Errors render below the field in small terracotta-deep text with `role="alert"`
  (`Field.tsx:99-103`).

### Modal (`lintel/src/components/ui/Modal.tsx`)
- Responsive shape-shift: **bottom sheet on mobile** (`rounded-t-3xl`, pinned
  to bottom edge, full width), **centered dialog on desktop**
  (`sm:rounded-3xl`, translate-centered, `max-w-md`) — one component, two
  layouts via Tailwind breakpoints, not two components.
- Scrim: `bg-ink/60 backdrop-blur-sm` (so the scrim tints toward ink, not pure
  black, and still frosts what's behind it).
- Escape-to-close and body-scroll-lock are both handled with plain
  `useEffect`/`addEventListener`, no dialog library (`Modal.tsx:25-37`).

### Empty and error states
No dedicated `<EmptyState>` component exists — every page inlines its own
short, specific, human-voiced sentence inside a plain `Card`, e.g.:
- `"No access points yet. Add one and pair a device to start tracking opens."` (`lintel/src/pages/app/AccessPoints.tsx:94`)
- `"No members yet — that's unusual, you should at least be in here."` (`lintel/src/pages/app/Members.tsx:82`)
- `"No devices yet. Hit Pair new device to get a claim token."` (`lintel/src/pages/app/Devices.tsx:107`)
- `"No activity yet — opens and closes will appear here."` (`lintel/src/pages/app/Dashboard.tsx:284`)
- `"Nothing logged for this filter."` (`lintel/src/pages/app/admin/AdminAudit.tsx:107`)

Convention: `text-ink/55`–`/65` at `text-sm`, left-padded inside an otherwise
empty `Card`, always a full sentence with a next action named in it, never a
generic "No data" or an icon-only illustration. Loading states are equally
terse (`"Loading…"`, `LoadingRow`, `shared.tsx:336-338`) and error states are a
single `text-terracotta-deep` sentence with `role="alert"` (`ErrorNote`,
`shared.tsx:340-346`; ad-hoc equivalent at `lintel/src/pages/app/AccessPoints.tsx:81-84`).
There is an explicit comment ruling out fabricated empty-state data even in
degraded scenarios (`lintel/src/pages/app/Analytics.tsx:58`: *"'not available'
rather than rendering a fabricated empty state"*).

### Prism / code blocks (`lintel/src/styles/main.css:580-696`)
Dedicated dark "figure" chrome independent of page theme — code blocks stay a
near-black surface (`#14110E` light-mode host page / `#0B0A09` dark-mode host
page) with a toolbar (language tag + copy button) on top and warm/editorial
token colours (terracotta `#E0896A`, gold `#DEC07A`/`#D4AE6A`, soft moss-green
`#B8C7A8`) rather than a generic Discord-style syntax palette — explicit
comment: *"so code reads like part of the page, not a Discord screenshot"*
(`main.css:582-583`).

---

## 6. Aesthetic characterisation

Lintel reads as **warm editorial / boutique hospitality software** — the
reference points implied by its own tokens and comments are premium print and
signage (a serif display face with a hand-tunable softness axis, a physical
"arch/lintel" doorway motif as the logo, terracotta/gold/moss as if lifted from
sun-baked clay and brass) rather than anything screen-native or "SaaS-generic."
Key distinguishing choices, all evidenced above:

- **Warm, not cool or neutral, greys.** Every "black" and "white" in the
  palette is warmed — `#141210` ink, `#FAFAF8` paper — never a true `#000`/`#fff`
  or a blue-grey. Dark mode goes out of its way to be *true* near-black rather
  than the more common "brown-dark," per its own header comment.
- **Serif display type with a tunable "soft" axis** used for numerals and
  headlines — a distinctly editorial, not dashboard-y, typographic voice.
  Numbers (dashboard stats, FAQ indices) get the serif/soft treatment, not a
  cold tabular sans.
- **Pill-everything for interactive chrome** — buttons, tabs, filters, badges,
  pagination controls are all fully rounded; only cards/modals/inputs use the
  large-radius-but-not-pill `rounded-3xl`/`rounded-xl` family. Sharp corners
  appear almost nowhere.
- **Colour used sparingly and semantically, not decoratively.** Terracotta is
  reserved for primary actions and danger/error text; gold for admin/invited
  states; moss for success/allowed; the vast majority of surface area is
  ink-on-paper with opacity-stepped hairlines, not colour blocking.
- **Soft, warm-tinted, large-blur shadows** rather than crisp/hard drop
  shadows, and hairline borders as the default separator ahead of shadows.
- **A literal architectural mark** (a tunnel/gate arch with a terracotta
  keystone dot) plus a day/night gate-opening hero animation on the marketing
  site — the brand metaphor (physical access, a doorway) is carried into the
  logo geometry itself, not just the product copy.
- **Human, specific micro-copy** everywhere a generic system would show a
  blank/placeholder state — this is a content-voice trait as much as a visual
  one, but it's consistent enough to be part of "the look."

### Contrast with Aql's current look

Aql today (`src/app.css:1-157`, `site/index.html:1-40`) is a **dark-only
ops/telemetry console**: pure near-black backgrounds (`--ink-950: #08090a`, no
light theme exists at all — `<meta name="color-scheme" content="dark">`,
`site/index.html:8`), a single molten-amber signal colour (`--signal: #f2a72c`)
against cool bone/grey text (`--bone: #ece7dc`), monospace-first body type
(`font-family: var(--font-mono)` on `body`, `src/app.css:68`) with a bold
geometric sans (Bricolage) reserved for display, hairline `rgba(233,228,218,…)`
borders, "registration-mark" corner-tick panel decoration
(`.panel::before/::after`, `src/app.css:120-135`), scanline/grain texture
overlays, and breathing/blinking status dots for live telemetry
(`src/app.css:141-152`). Rectangular, not pill-shaped, chrome throughout (no
`border-radius` at all on `.panel`, `.btn`, or `.dot` beyond the dot's own
50%).

The two systems disagree on nearly every axis:

| Axis | Aql (current) | Lintel |
|---|---|---|
| Themes | Dark-only | Light + dark, user-toggleable, `data-theme` driven |
| Base palette temperature | Cool ink/bone + amber signal | Warm ink/paper + terracotta/gold/moss |
| Display type | Bold geometric sans (Bricolage) | Soft variable serif (Fraunces) |
| Body type | Monospace | Humanist sans (Inter) |
| Shape language | Rectangular, corner-tick panels | Pill buttons/tabs, large-radius cards, one arch-radius token |
| Shadow/texture | Flat panels + scanline grain overlay, no shadow depth | Soft warm-tinted blur shadows, no grain |
| Motion | Breathing/blinking status dots (telemetry feel) | Gentle crossfades, sun/moon theme-toggle, no ambient blinking |
| Brand metaphor | Rotated-square "compass/target" mark | Literal doorway arch mark |

This is a near-total aesthetic reversal (console/telemetry → editorial/warm
hospitality), not a palette swap — the migration is a full skin replacement,
not a token tweak.

---

## 7. Migration notes

### Aql files that will need to change to adopt this system

Verified to exist in this repo (`/Users/pc/code/vulos/aql`) as of this wave:

- `src/app.css` — the entire file is Aql's current design system (fonts,
  palette, base body/panel/dot rules); this is the direct equivalent of
  lintel's `tokens.css` + `main.css` combined and will need a full rewrite,
  not a patch.
- `src/routes/+layout.svelte` — imports `../app.css` as the single global
  stylesheet entry point (`src/routes/+layout.svelte:2`); this is where a new
  `tokens.css`-equivalent import would be wired in.
- `src/routes/+layout.ts`, `src/routes/+page.svelte` — exist but were not
  found to contain styling; check for inline classes/styles when the actual
  restyle wave begins.
- `static/fonts/` — currently holds Aql's five font files
  (`bricolage-700.woff2`, `bricolage-500.woff2`, `plexmono-400/500/600.woff2`).
  Lintel's six vendored variable fonts (`fraunces-var.woff2`,
  `fraunces-italic-var.woff2`, `inter-var.woff2`, `inter-italic-var.woff2`,
  `jetbrains-mono-var.woff2`, `jetbrains-mono-italic-var.woff2` — currently
  sitting in `lintel/public/fonts/`) will need to be copied into `static/fonts/`
  in a future wave (not done in this wave — this wave is docs/asset-extraction
  only for brand marks, not fonts, per the task scope).
- `assets/brand/` — Aql's current mark set
  (`favicon.svg`, `logo-mark.svg`, `logo-wordmark.svg`, `logo-wordmark-dark.svg`,
  all confirmed present) uses the old amber/navy rotated-square identity and
  will eventually be replaced or retired once a new mark is designed; this
  wave only adds lintel's source assets alongside them (see §8 below) — it does
  not touch or delete the existing four files.
- `site/index.html` — Aql's self-contained marketing/landing page
  (`<title>Aql — command center for the physical world</title>`,
  `site/index.html:6`) has its entire palette/type system inlined in a
  `<style>` block (`site/index.html:8-40`+), mirroring `src/app.css`; would
  need the same full rewrite lintel's own `lintel/site/index.html` represents
  for lintel.
- No `tailwind.config.js` exists in either `lintel/` or the Aql root — Aql does
  not currently use Tailwind at all (plain CSS + Svelte), so adopting lintel's
  system means either introducing Tailwind v4 to Aql's SvelteKit build, or
  (more consistent with Aql's existing plain-CSS approach) manually
  transcribing the *values* this document captures into hand-written CSS
  classes/utilities rather than porting Tailwind's utility-class approach
  wholesale.

### React/Tailwind assumptions that need translating to SvelteKit + plain CSS

- **Tailwind utility classes are the actual styling mechanism** for nearly
  every component cited in §5 (`Button.tsx`, `Card.tsx`, `Field.tsx`,
  `Modal.tsx`, `shared.tsx`, etc.) — there is no separate `.css`/`.module.css`
  per component. Porting to Aql (plain CSS, per `src/app.css`'s existing
  convention) means each Tailwind utility string in this document needs to be
  hand-expanded into real CSS rules/classes; there is no drop-in equivalent
  file to copy.
- **CSS custom properties (`tokens.css`) port cleanly** — this part is
  framework-agnostic and can be carried over close to verbatim into a new
  `:root` / `:root[data-theme='dark']` block in `app.css`.
- **The `@theme` block in `main.css` (`lintel/src/styles/main.css:53-74`) is
  Tailwind-v4-specific config-as-CSS** (it's how Tailwind v4 maps custom
  properties to utility class names like `bg-terracotta`). If Aql doesn't
  adopt Tailwind, this block's *values* still port (they're just aliases back
  to the `tokens.css` variables) but the block itself has no meaning outside
  Tailwind.
- **React-specific mechanics** with no Svelte equivalent to reuse directly:
  `ThemeProvider`/`useTheme` context (`lintel/src/lib/theme.tsx`) → would
  become a Svelte store; `createPortal`-based `Modal` (`Modal.tsx:41,71`) →
  Svelte has no portal primitive built in, needs `svelte:element`/action-based
  portal or a library; `forwardRef` on `Field`/`Button` → not needed in
  Svelte, bindings work differently.
- **`cn()` (a `tailwind-merge` + `clsx` helper, `lintel/src/lib/cn.ts`)** is a
  Tailwind-ecosystem convenience with no purpose if Aql doesn't adopt Tailwind;
  Svelte's native class directives (`class:foo={cond}`) or plain template
  strings would replace it.
- **The Fraunces `SOFT` variable-font axis usage (`font-variation-settings`)**
  is plain CSS and ports with no framework translation needed — this is the
  one component of lintel's type system that is *not* Tailwind-coupled.
- **Prism syntax-highlighting classes** (`.hl-*`, `main.css:580-696`) assume a
  Prism.js-tokenized `<pre><code>` structure from the React docs pages
  (`lintel/src/pages/docs/CodeBlock.tsx` — present but not read in this wave);
  Aql would need its own code-block component/tokenizer if it wants this exact
  look for any docs surface.

---

## 8. Asset extraction (this wave)

Copied read-only from `lintel/public/` into `assets/brand/` (additive — none
of Aql's existing four brand files were modified or removed):

| New file | Source | Notes |
|---|---|---|
| `assets/brand/lintel-favicon.svg` | `lintel/public/favicon.svg` | Exact copy, original filename prefixed. 64×64 viewBox, navy `#1A1F36` field, cream `#F4EDE2` arch stroke, terracotta `#D6624D` keystone dot (see §1's navy-vs-warm-palette note — this exact mark's colours don't match `tokens.css`). |
| `assets/brand/lintel-icon.svg` | `lintel/public/icon.svg` | Byte-identical to `favicon.svg` in the source repo. |
| `assets/brand/lintel-og.svg` | `lintel/public/og.svg` | Full 1200×630 social-card composition: same arch mark at 5.5× scale, plus the wordmark **rendered as literal `<text>`** (`font-family="Georgia, 'Times New Roman', serif" font-style="italic"`, not Fraunces — this OG card predates/bypasses the vendored-font system since OG images are static rasterized-at-share-time), tagline "Texts that open gates.", and footer captions. Useful as a reference composition, not a component to reuse as-is. |
| `assets/brand/aql-mark.svg` | `lintel/public/favicon.svg` (copy) | Placeholder for the next wave to wire up as Aql's new mark. **Content is currently byte-identical to `lintel-favicon.svg`** — including its `<title id="t">lintel</title>` and lintel-specific `<desc>` — deliberately left unedited per this wave's read-only/no-restyle scope. The next wave must update the title/desc text (and decide on the navy-vs-tokens.css colour question from §1) before treating this as Aql's real mark. |

**No wordmark SVG asset exists in lintel.** Confirmed by listing
`lintel/public/` in full (`favicon-16x16.png`, `apple-touch-icon.png`,
`icon.svg`, `og.svg`, `sitemap.xml`, `robots.txt`, `og.png`, `favicon.svg`,
`favicon-32x32.png`, `images/auth-hero.jpg`, `fonts/*`) — there is no
`wordmark.svg` or equivalent. Lintel's wordmark is **rendered as live text**,
not a vector asset, in two places:
- `Wordmark` component: `<em class="font-display italic tracking-tight">lintel</em>`
  (`lintel/src/components/illustrations/ArchMark.tsx:50-56`)
- Sidebar: `<span class="font-display italic text-lg">lintel</span>`
  (`lintel/src/components/nav/AppSidebar.tsx:15`)

Per the task instruction, **no `aql-wordmark.svg` was created** — inventing one
would mean drawing a wordmark lintel itself doesn't have as a standalone asset.
The equivalent for Aql is: once "Aql" is set in Fraunces (or whatever face the
next wave picks) at the CSS level, no wordmark SVG is needed at all — this is a
CSS-only pattern, not an asset-porting one. Aql's existing
`assets/brand/logo-wordmark.svg` / `logo-wordmark-dark.svg` (mono "AQL" text
baked into an SVG, `letter-spacing="5"`, `font-family="ui-monospace,'SF Mono',
'JetBrains Mono',Menlo,monospace"`) are a genuine SVG-wordmark today and remain
untouched; the next wave should decide whether to keep that approach or switch
to lintel's live-text convention.
