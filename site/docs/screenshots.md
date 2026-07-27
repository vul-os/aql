# Screenshots

A visual tour of the web console. Every screen ships in both themes; these pages follow
your theme choice, so the light set is shown here with the dark set linked alongside.

> **How these are made, and what that means.** They are real captures of the real React
> console, driven by Playwright (`npm run screenshotter`) with the hub's API responses
> replaced by fixtures in `scripts/screenshotter-fixtures/`. The **layout and components
> are exactly what ships**; the names, numbers and events in them are fabricated sample
> data, and a couple of screens draw on endpoints the hub does not actually serve yet —
> each of those is flagged below rather than left to imply otherwise.

## Dashboard

The first screen after sign-in: recent activity across your locations, controller health,
and the day's opens.

![Aql console dashboard](screenshots/portal-dashboard.png)

[Dark variant](screenshots/dark/portal-dashboard.png)

> This screen has grown since the capture above: it now also surfaces tiles for the
> device kinds beyond access control (lighting, cameras, energy, and the rest) so the
> "one hub, seven device kinds" idea is visible on day one, not just implied. Those
> tiles run on the built-in demo dataset and carry a small demo marker; the
> access-control panels next to them (opens, access points, recent activity) are real
> and unmarked. A refreshed capture is pending.

## Access points & controllers

Where gates, doors and barriers live — each access point with its paired controller and
online state.

![Access points and controllers](screenshots/portal-locations.png)

[Dark variant](screenshots/dark/portal-locations.png)

> The per-access-point **maintenance log** on the detail view posts to routes the hub
> does not serve; those fields come back as fixed nulls against a real hub. It is UI
> ahead of backend, and it is tracked as such.

## Analytics

Opens over time, denials and their reasons, per-member and per-access-point breakdowns.

![Analytics](screenshots/portal-analytics.png)

[Dark variant](screenshots/dark/portal-analytics.png)

> **This screen has no backend today.** The hub serves no analytics endpoints; against a
> real hub the console degrades to an empty state. The underlying data does exist in the
> audit log — an instance admin can read it via `GET /v1/admin/audit` — but the
> aggregation API is not built.

## The security page

Served by the hub itself: the trust model — pinned keys, tenant isolation, identity by
verified sender — spelled out where residents and trustees can read it.

![The hub's security page](screenshots/security.png)

[Dark variant](screenshots/dark/security.png)

## Usage & limits

An access point's quota panel: today's opens against the location cap, per-member usage,
and the admin's inline editor for the two daily quotas.

![The usage and limits panel](screenshots/portal-limits.png)

[Dark variant](screenshots/dark/portal-limits.png)

## The instance-admin console

The hub operator's view: instance totals, opens, and the denial breakdown —
rate-limited, quota, suspended — with accounts, users, limits and audit a tab away.

![The instance-admin overview](screenshots/portal-admin.png)

[Dark variant](screenshots/dark/portal-admin.png)

## Open a gate from the console

The console's own open path — pick an access point, open it, see the result. This is the
fallback that always works when a chat channel is down.

![Opening a gate from the console](screenshots/app-open.png)

[Dark variant](screenshots/dark/app-open.png)

> This is the ordinary **online** open path, not emergency access. The emergency screen is
> separate — see below and [Emergency access](emergency-access.md).

## Emergency access

Where you set up an offline grant, and where you present one at a gate. Captured on the
mobile viewport because that is where it is used.

![Emergency access](screenshots/app-emergency.png)

[Dark variant](screenshots/dark/app-emergency.png)

> Requesting and holding a grant works in any build. **Presenting one does not work from a
> browser tab**: it talks straight to the controller on the LAN, which sets no CORS headers
> and is not a web API, so that leg needs the desktop or packaged app. The screen says so
> itself rather than failing at the gate.

## The website

The landing page, for the curious:

![Landing hero](screenshots/landing-hero.png)

[Landing dark](screenshots/dark/landing-hero.png)

## Devices, energy & automations

The console also has screens for the other device kinds Aql means to own — devices,
energy and automations — alongside the access-control screens above. They are not
screenshotted in this tour yet. What they show today is not a live reading of anything:
there is no device engine, so every figure on those three screens comes from a
built-in demo dataset, marked per item with a small chip rather than hidden or left to
imply otherwise, and every control on the demo side renders disabled. That is different
from the access-control screens pictured above, which talk to your hub for real.

Any older Aql image showing an Overview / Devices / Energy / Automations console as a
fully live product predates this repository — it came from a demo build that was
replaced when the two projects merged. See
[Devices](devices.md) for exactly what's built and what's fixture
data on each of these screens.
