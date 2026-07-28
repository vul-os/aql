# API reference

The HTTP API isn't required to use Aql — most people only ever touch chat. But if
you're integrating with property-management software, wiring the gate into a home
automation, or building on top of a hub, this is for you.

The API is served by the hub itself — every hub, the same way — under `/v1`.

> The `/v1` surface is stabilising alongside the Go hub; pre-1.0, expect additive
> changes — the repository's route code is the source of truth for what exists today.

## Authentication

**Today**, the hub only issues short-lived bearer session tokens from
`POST /v1/auth/login` / `/v1/auth/refresh` — the same tokens the portal itself uses —
sent as:

```
Authorization: Bearer <session_token>
```

`POST /v1/auth/login`, `/register`, `/refresh` and `POST /v1/admin/claim` are all
throttled against brute-force guessing (per-IP hard limit on every attempt; login
adds a per-account soft limit on failed attempts only) — a `429` with `Retry-After`
means you've hit one of those, not a bug in your client. `POST /v1/auth/logout-all`
revokes every refresh-token family for the calling user in one call (every other
session stops being able to renew; the token you called it with keeps working until
its own TTL runs out).

**Planned**: long-lived, location-scoped, read/read-write **API tokens** issued from
the portal under **Settings → API tokens** (tracked in the repo todo), shaped like
`Authorization: Bearer aql_live_<token>`. Until that ships, integrating means logging
in a service account and refreshing its session token like any other client.

Every hub issues its own tokens/sessions — there is no central token authority.

## Open an access point

This one is real today, authenticated with the bearer session token from
`POST /v1/auth/login` (not a scoped `aql_live_…` API token yet — see
[Authentication](#authentication)):

```
POST /v1/access-points/:id/open

{
  "lat": -29.858,
  "long": 31.021,
  "source": "web"
}
```

`source` is one of `web`, `whatsapp`, `api` (default `web`); `lat`/`long` are optional
unless the access point's rules demand a location signal. The request runs the same
rules pipeline as a chat message — membership, rate limits/quota — then signs and
dispatches a command to the controller. The response reports the outcome:

```
200 OK
{ "ok": true, "command": "open", "delivery": "acked" }
```

`delivery` is one of `acked`, `undelivered`, `queued` (offline, long-poll fallback) or
`no_device` (access point has no controller attached yet — the open still succeeds).
A disallowed request gets `403` (`account_suspended` / `user_disabled`) or `429`
(`rate_limited` / `quota_exceeded`, with `Retry-After`) instead of `200`.

## List events

**Not implemented as a token-scoped surface yet.** Today the audit log is readable
only through the admin console/API (`GET /v1/admin/audit`, `GET
/v1/admin/audit/actions` — instance-admin only, see [Instance admin](admin.md)), not
via a per-account, per-token events feed. A scoped `GET /v1/events` for regular API
tokens is planned alongside the API-token system below, not shipped.

Both audited tables are hash-chained and append-only at the database layer;
`GET /v1/admin/audit/verify` (also instance-admin only) checks the chain and
reports the first tampered row, if any — see
[Security → Tamper-evident audit log](security.md) for the design and its honest
limits.

## Webhooks

```
GET    /v1/accounts/{id}/webhooks               # list subscriptions
POST   /v1/accounts/{id}/webhooks               # create one; the signing secret is shown ONCE
DELETE /v1/accounts/{id}/webhooks/{webhookID}   # remove one
```

Admin-only, and there is a `Settings → Webhooks` panel in the console. The event
vocabulary is closed: `access.opened` and `access.denied`. The payload carries the
access point, location, command and audit `log_id` — and deliberately **no member
identity**, because a webhook target is an address on someone else's network.

Each delivery is signed:

```
X-Aql-Event:            access.opened
X-Aql-Timestamp:        1789000000
X-Aql-Signature-256:    hex( HMAC-SHA256( secret, timestamp + "." + rawBody ) )
```

Verify against the **raw** body before parsing it, compare in constant time, and reject
a timestamp outside your own skew tolerance — the hub cannot enforce that for you.
Retries re-sign with a fresh timestamp, so de-duplicate on `log_id`, not on the
signature.

Two things worth knowing before you point one at your LAN: private, loopback,
link-local and carrier-grade-NAT targets are refused unless you set `allow_private`,
and the target is re-resolved and re-checked immediately before **every** attempt — a
name that was public when you saved it can point at a metadata service tomorrow.

## Devices

```
GET  /v1/devices                 # controllers, their access points, online + claim state
POST /v1/devices                 # account admin: create a device + one-shot pairing claim token
```

`POST /v1/devices` is the pairing claim creation route — the same one the portal's
**Devices → Pair new** calls — see [Controllers](controllers.md) for the redemption
flow (`POST /pair/redeem`) it feeds. There is no revoke-by-DELETE endpoint yet;
revoking a controller's key is a planned admin-ops surface.

## Rate limits

There is **no global per-token request limit**. Two families of limit exist, and both are
real:

- **Open limits and quotas** apply to `POST /v1/access-points/:id/open` exactly as they
  do to a chat message — the API is not a bypass. A denial is `429` with `Retry-After`
  and a reason of `rate_limited` or `quota_exceeded`. See
  [Rate limits & quotas](limits.md).
- **Auth throttles** apply to `login` / `register` / `refresh` / `admin-claim`,
  per-IP and (for login) per-account, fail-closed.

`close` is never limited.
