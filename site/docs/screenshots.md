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

![Opening a gate from the console](screenshots/app-emergency.png)

[Dark variant](screenshots/dark/app-emergency.png)

> This is **not** an offline emergency-access screen. That screen does not exist: no
> build of the app requests, stores or presents an offline grant. See
> [Emergency access](emergency-access.md).

## The website

The landing page, for the curious:

![Landing hero](screenshots/landing-hero.png)

[Landing dark](screenshots/dark/landing-hero.png)

## What is not pictured

There are no screenshots of device, energy or automation screens because **those screens
do not exist**. Any older Aql image showing an Overview / Devices / Energy / Automations
console came from a demo build that was replaced when the two projects merged; that UI is
not in this repository. See [Devices, energy & automations](devices.md).
