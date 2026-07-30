<!-- no-broker-dep:allow-file: links to docs/EPHOR-CHAT-SEAM.md, a design analysis of gateway-mode
     authorisation "including the parts that are designed but not built" — spec-analysis prose,
     not a build or startup path. -->

# Chat rail disclosure (KOTVA §26.3)

Aql reaches residents over chat rails it does not own. [KOTVA §26.3][s26] requires any
adapter to declare **four fields** per rail, and — where a rail is asymmetric — per
direction. §26.3 accepts this in documentation for a node-mode-only deployment, which
is what a self-hosted Aql hub is.

This file is that declaration. It is normative for what the hub actually does today; if
the code and this table disagree, the code is the bug.

> **The one-line version.** Every chat rail Aql supports is **inbound-triggered** — the
> resident must message first, and the hub cannot cold-call anyone. Every platform-mediated
> rail puts the platform in the plaintext path on every message, in both directions, in
> both deployment modes. There is no configuration in which a WhatsApp message to your gate
> is private from Meta.

## The four fields

1. **Initiation** — `freely-initiating` (can contact a stranger cold) or `inbound-triggered`
   (the other party must start).
2. **Inbound transport** — `hardware-local`, `outbound-persistent` (works behind CGNAT with
   no public endpoint), `webhook` (needs a reachable HTTPS endpoint), or `listener`.
3. **Price shape** — `metered`, `flat`, or `free`.
4. **Exposure** — who sees plaintext, stated per mode.

## Declaration

| Rail | Dir | Initiation | Inbound transport | Price | Exposure (node mode) | Exposure (gateway mode) |
|---|---|---|---|---|---|---|
| **WhatsApp** (Cloud API) | in | inbound-triggered | webhook | free (in window) | Meta, always + you | Meta, always + the operator |
| | out | inbound-triggered¹ | — | **metered** | Meta, always + you | Meta, always + the operator |
| **Slack** (Events API) | both | inbound-triggered | webhook | free | Slack | Slack + the operator |
| **Slack** (Socket Mode) | both | inbound-triggered | **outbound-persistent** | free | Slack | Slack + the operator |
| **Telegram** | both | inbound-triggered | **webhook**² | free | Telegram | Telegram + the operator |

¹ Outside WhatsApp's service window this leg cannot originate at all — it is template-walled
([§26.4.1][s26]). Aql does not implement templates, so in practice the hub can only reply
inside a window a resident opened.

² **This differs from KOTVA's reference adapter, deliberately.** `kotva-mail`'s Telegram
adapter declares `outbound-persistent` (long-polling). Aql's Telegram is a **webhook**
(`POST /webhooks/telegram`, authenticated by `X-Telegram-Bot-Api-Secret-Token`), so it
needs a reachable HTTPS endpoint that long-polling would not. Declaring the reference
value here would understate what an operator has to stand up.

**Slack Socket Mode is the only zero-URL rail Aql has.** It holds an outbound WebSocket, so
it works behind CGNAT with no inbound reachability and no public hostname. If you cannot
expose an endpoint, that is the rail to use.

## Authenticity — what a chat identity proves

Every rail here is **platform-asserted**. A phone number or Slack user id is what the
platform says it is; there is no cryptographic identity behind it. The hub therefore treats
a chat identity as a *lookup key into its own member table*, never as authority. Membership,
suspension and disabled-user checks are re-evaluated on every message, and the signed
command to the controller is minted from the hub's key, not from anything the rail asserted.

## Sanctioning, and one non-conformance we ship

| Engine | Sanctioning | Gateway mode |
|---|---|---|
| WhatsApp Cloud API (default) | sanctioned API | permitted |
| **WhatsApp bridge** (Evolution API / Baileys) | **unsanctioned** | **MUST NOT** |
| Slack Events API / Socket Mode | sanctioned API | permitted |
| Telegram Bot API | sanctioned API | permitted |

Aql ships an opt-in `AQL_WHATSAPP_ENGINE=bridge` that drives WhatsApp through an
unofficial library. [§26.8.2][s26] places an **unconditional MUST NOT** on exactly this, and
[§26][s26]'s sanctioning rule says an unsanctioned rail must never run in gateway mode — it
may only be self-hosted by someone accepting the ban risk on their own account.

We are declaring this rather than hiding it. The bridge is not the default, it is not
recommended, selecting it logs a ban-risk warning at startup, and it must not be used to
serve identities other than your own. If you want a conformant deployment, use the Cloud
API.

## What is not a rail

`hub/internal/channels/dmtap.go` is a scaffold with no transport behind it. It is not
declared above because nothing can currently arrive on it.

## Gateway mode

A deployment serving more than one identity through an adapter — an estate operator running
one WhatsApp number for many residents — is in **gateway mode**, and §26.2.1 requires an
authorisation layer that node mode does not. Aql's per-account model plus its member table
covers the "who may act" half. See [`../docs/EPHOR-CHAT-SEAM.md`](../docs/EPHOR-CHAT-SEAM.md)
for the full analysis, including the parts that are designed but not built.

[s26]: https://github.com/vul-os/kotva/blob/main/26-legacy-adapters.md
