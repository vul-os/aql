# Outbound webhook profile — v0

The wire format aql's hub uses to POST events to an operator-configured URL,
specified precisely enough to implement a receiver — or another sender —
without reading the hub's source.

**Vectors:** [`vectors/webhooks.json`](vectors/webhooks.json), self-checked by
`node proto/vectors/verify.mjs` and read by the hub's own tests
(`hub/internal/httpapi/webhookvectors_test.go`). The vector file is the
authority; if this document and it disagree, the vector wins.

**Reference implementation:** `hub/internal/httpapi/webhookdispatch.go` and
`hub/internal/httpapi/webhooktarget.go`.

---

## 1. The rule that shapes everything

A webhook is a notification about something that has **already happened and has
already been audited**. Delivery therefore runs out of band, and no failure in
the delivery path may affect whether the underlying action succeeded.

Concretely, for a sender:

- Dispatch is called **after** the actuation, never before.
- Dispatch **returns immediately**; delivery happens on its own goroutine. A
  receiver that takes ten seconds must not add ten seconds to a resident
  standing at a gate.
- A dispatch failure is recorded and logged. It is never propagated to the
  caller.

## 2. The request

```
POST <configured URL> HTTP/1.1
Content-Type: application/json
User-Agent: aql-hub
X-Aql-Event: access.opened
X-Aql-Timestamp: 1789000000
X-Aql-Signature-256: 02754855b83021f5484d9f7a8d80fa61c4a61fccb888b68e90ea97bce92a8e8e

{"access_point":"ap_main","command":"open","event":"access.opened","location":"loc_office","log_id":"log_000000000001"}
```

| Header | Value |
| --- | --- |
| `X-Aql-Event` | the event name (closed vocabulary, §5) |
| `X-Aql-Timestamp` | Unix **seconds**, decimal, no sign, no fraction |
| `X-Aql-Signature-256` | §3 |

## 3. Signature

```
preimage  = X-Aql-Timestamp || "." || <raw request body bytes>
signature = lowercase_hex( HMAC-SHA256( subscription_secret, preimage ) )
```

- The secret is **per subscription**, not per account or per hub. One receiver
  cannot forge a delivery to another. (Vector: `same-body-different-secret`.)
- The timestamp is **inside** the preimage, not merely beside it, so it cannot
  be altered without invalidating the signature. A receiver that checks skew
  gets replay protection; one that does not still gets authenticity. (Vector:
  `same-body-different-timestamp` — same body, one second later, different
  signature.)
- The signature covers **bytes**, not a parsed object. `.` is U+002E, one byte.
  The body is hashed exactly as transmitted; a receiver that re-serialises
  before verifying will fail on any payload whose key order or spacing differs
  from what it would produce. (Vector: `body-with-non-ascii` fails for any
  implementation that hashes UTF-16 or latin-1 rather than UTF-8 bytes.)
- 64 lowercase hex characters. Not base64, not uppercase, no `sha256=` prefix.

### Verifying, receiver side

1. Read the raw body **before** any JSON parsing. If your framework has already
   parsed and discarded the bytes, you cannot verify — fix that first.
2. Recompute the HMAC over `timestamp + "." + rawBody`.
3. Compare in **constant time** (`hmac.Equal`, `crypto.timingSafeEqual`,
   `hmac.compare_digest`).
4. Reject a timestamp outside your tolerance. The sender cannot enforce this
   for you and does not try. Five minutes is a common choice; pick one and
   write it down.
5. Optionally de-duplicate: retries (§4) resend the *same* body with a *new*
   timestamp and therefore a new signature, so signature-based de-duplication
   does not work. Use `log_id` from the payload.

## 4. Delivery semantics

| Property | Value | Why |
| --- | --- | --- |
| Method | `POST` | — |
| Attempts per event | **3** | This is a notification, not a queue. An endpoint that has failed three times running is down, not briefly unlucky. |
| Backoff | linear — attempt *N* sleeps *N* seconds | Exponential is over-engineering across three attempts. |
| Timeout per attempt | 10 s | A slow receiver must not hold a goroutine per gate opening. |
| Success | HTTP **2xx** | Anything else is a failure that keeps its status code, because "the receiver said no" and "the receiver was never reached" are different operator problems. |
| Redirects | **never followed** | A 302 is a receiver asking the hub to send a signed record of a gate opening somewhere that was never validated — the SSRF hole re-opened by a different door. |
| Response body | **never read, never parsed, never acted on** | A compromised endpoint can learn that a gate opened. It cannot steer the hub. |
| Auto-disable | after **5** consecutive whole-event failures | A dead URL should stop costing attempts, loudly — the disable is logged at WARN with the reason, because an endpoint going quiet is exactly the failure nobody notices until they need the trail it was feeding. |

**Retries are at-least-once and are not idempotent by signature.** Each attempt
re-signs with a fresh timestamp. Receivers must be idempotent on `log_id`.

## 5. Event vocabulary

A **closed** set, validated when a subscription is created — an unknown name in
config is an operator typo worth refusing, not a subscription that silently
never fires.

| Event | Meaning |
| --- | --- |
| `access.opened` | an access point actuated |
| `access.denied` | an access attempt was refused; payload carries `reason` |

Payload members: `event`, `command`, `access_point`, `location`, `log_id`, and
`reason` on denials. **No member identity.** A webhook target is an address on
somebody else's network, and "who tried to open the gate at 3am" is not
something to post to it by default.

## 6. Target validation — the part most implementations get wrong

An outbound webhook is a request-forgery primitive handed to whoever can
configure one. A hub sits **inside** a home or office network, so a URL it will
faithfully POST to reaches things nothing on the internet can: the router admin
page at 192.168.1.1, a printer, a NAS, another hub, a cloud instance's metadata
service at 169.254.169.254 handing credentials to any local caller.

**Refused unless the operator sets `allow_private`:**

- loopback
- link-local unicast and multicast (169.254.0.0/16 — cloud metadata)
- RFC 1918 private ranges
- carrier-grade NAT, 100.64.0.0/10 — *not* covered by Go's `IsPrivate`, and a
  hub on a CGNAT'd link shares it with other subscribers
- unspecified and multicast addresses (never allowed at all)

Also refused, unconditionally: schemes other than `http`/`https`; credentials
embedded in the URL (they would be logged by anything that logs a URL, and the
signature already authenticates the sender); `http://` without `allow_private`
(a plaintext target on the public internet would put a signed record of every
gate opening on the wire in clear).

A hostname is **resolved**, not trusted: `metadata.example.com` is a
public-looking name that can point anywhere. **Every** resolved address must be
acceptable — one bad answer is enough to refuse, because the dialler chooses
which to use. A name that will not resolve is refused rather than allowed: at
configuration time a clear refusal costs the operator nothing.

### The part that is genuinely load-bearing

> **Validate again immediately before every delivery, against a fresh
> resolution.**

Configuration-time validation alone is not enough. A hostname that resolved to
a public address when it was saved can resolve to 169.254.169.254 tomorrow —
DNS belongs to whoever owns the name, not to the hub — so a webhook configured
innocently in January is a request-forgery primitive in March. The re-check
closes that window. It is one call in `attempt()`; it is also the single
difference between this profile and most webhook implementations.

**Known residual gap, stated rather than papered over:** the re-validation
resolves the name, and then `http.Client` resolves it *again* when it dials. A
DNS answer that changes between those two lookups is not caught. Closing it
fully requires pinning the validated IP into the dialler (a custom
`DialContext` that connects to the address that was checked). The current
design narrows the window from *months* to *milliseconds*; it does not
eliminate it. Anyone copying this profile for a higher-stakes deployment should
pin the dial.

## 7. Error handling and what is *not* logged

Transport errors are reduced to one of `timeout`, `dns failure`,
`connection error` before being stored or logged. The underlying `*url.Error`
is deliberately dropped: it stringifies the full URL, which can carry a
path-embedded token on receivers that use one.

## 8. Conformance checklist

A sender claiming this profile:

- [ ] signs `timestamp + "." + body` with HMAC-SHA256, lowercase hex, per-subscription secret
- [ ] emits `X-Aql-Signature-256`, `X-Aql-Timestamp`, `X-Aql-Event`
- [ ] re-validates the target against a fresh resolution before **every** attempt
- [ ] never follows redirects
- [ ] never reads the response body
- [ ] retries at most 3 times, linear backoff, 10 s per attempt
- [ ] disables a subscription after 5 consecutive failed events, loudly
- [ ] reproduces every signature in `vectors/webhooks.json`
