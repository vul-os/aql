# Chat channels

Chat is an **input surface** onto the hub, not the whole product. The hub exposes a
**channel seam** — a small interface that resolves a sender to an identity, turns a
message into an intent (`open`, a picker reply, a visitor-pass request), and sends
replies. Everything behind the seam (the open-path checks, signing, audit) is
channel-agnostic, and a channel decides how to ask and how to reply — never whether the
gate may open.

Today the only intent the seam resolves to is opening or closing an access point,
because that is the only device class the hub drives. Texting a light or a mower is the
design intent, not a shipped capability — see
[Devices](devices.md). The full command surface is documented in
[`docs/CHAT-COMMANDS.md`](https://github.com/vul-os/aql/blob/main/docs/CHAT-COMMANDS.md).

> **The three rails below are shipped and supported.** WhatsApp, Slack and Telegram are
> in the hub, in `hub/internal/channels/`, working and tested. They are not going
> anywhere and they are not deprecated — configure them and text your gate open today.
>
> There is a *designed, optional* alternative in which a separate coordinator terminates
> the rail and hands the hub an authorised command instead — see
> [`docs/PIER-CHAT-SEAM.md`](https://github.com/vul-os/aql/blob/main/docs/PIER-CHAT-SEAM.md).
> **Nothing of it is built**, and [Pier](https://github.com/vul-os/pier) is `pre-alpha`
> by its own README badge, so it is an experimental path for people who want it, never a
> requirement and never a replacement for what is documented here. A naming note that
> often confuses people: Aql's hub is not a KOTVA gateway — it bridges chat rails to its
> own local domain, and the gateway/coordinator role in that family is a separate job
> (see
> [`docs/KOTVA-ALIGNMENT.md`](https://github.com/vul-os/aql/blob/main/docs/KOTVA-ALIGNMENT.md)).

Identity is keyed on `(channel, external id)` — not phone-number-only — so one person
can be reachable on WhatsApp and Slack at once without being two people in your records.

**A member has to link each account before that rail answers them.** Being invited to an
account is not enough: every rail resolves an inbound message through a *verified*
identity, and accepting an invite deliberately verifies nothing, because accepting proves
nothing about who holds the handset. The ceremony is one step, from **Settings**: the
console mints a short-lived `LINK-` code and the member sends it to the bot from the
account they are linking. The code proves they are looking at this account's console; the
inbound message proves they control the account. No SMS and no email — this hub sends
neither.

WhatsApp's code is six characters because it is bound to the number that may spend it, so
possession of the handset carries most of the security. The other rails use a twelve-
character code: nobody knows their own Telegram numeric id, so the code cannot name the
account allowed to spend it and whoever sends it first gets linked. Those are secrets, and
the console says so where it shows them.

Until a member links, their messages are **ignored rather than refused** — which is what
"the bot doesn't answer me" looks like from the outside.

Linking does not change the exposure boundary in the warning below. A platform that reads
every message can read a link code, and one that can inject a message appearing to come
from an account can spend one. The ceremony stops one member claiming another's account —
the attack that actually happens — and nothing about the platform.

| Channel | Identity | Status | Self-host friction |
| --- | --- | --- | --- |
| WhatsApp | phone number | **Shipped** — Meta Cloud API | **High** — verified Meta business + WABA + number |
| Slack | member id | **Shipped** — Events API **and** Socket Mode | Minutes — an app manifest + signing secret |
| Telegram | chat id | **Shipped** — opens wired through the shared pipeline | Minutes — a BotFather token + webhook secret |
| Discord | user id | **Shipped** — Gateway WebSocket, outbound-only like Slack Socket Mode | Minutes — a bot token, the MESSAGE CONTENT intent, and no Interactions Endpoint URL |
| DMTAP | keypair / `name@domain` | **Not built** — a `DialChannel` scaffold exists whose only transport implementation fails closed | — |

> **Every chat channel puts a third party in the loop.** Meta, Slack and Telegram see
> the plaintext of every message — the hub must read it to act on it. That is the
> largest privacy exposure in the system and it is documented plainly in
> [Security](security.md) and the repository's threat model.

The full per-rail disclosure — initiation class, inbound transport, price shape and who
sees plaintext, stated per direction and per deployment mode — is
[`proto/rails.md`](https://github.com/vul-os/aql/blob/main/proto/rails.md), the format
[KOTVA §26.3](https://github.com/vul-os/kotva/blob/main/26-legacy-adapters.md) requires.
Two things there are worth knowing before you pick a rail:

- **Every rail is inbound-triggered.** The hub cannot message a resident who has never
  messaged it. There is no rail on which Aql can cold-call.

  One caveat, opt-in only: the WhatsApp *bridge* engine is an unofficial Web client,
  which is a regular account and technically can message a stranger. Aql never does,
  but the rail's own capability changes — and so does its
  disclosure at `GET /v1/rails/disclosure`, which answers for the engine you
  actually configured.
- **Two rails need no public endpoint at all.** Slack Socket Mode and Discord both hold
  an outbound WebSocket and work behind CGNAT with no hostname. WhatsApp arrives by
  webhook and has no alternative — Meta's Cloud API only speaks webhooks — so it is the
  one rail that genuinely requires ingress. Telegram defaults to webhook and has an
  opt-in long-polling engine that needs no public URL either.

  One Discord footgun worth knowing before you set it up: leave the **Interactions
  Endpoint URL unset**. Setting it turns button taps into webhooks, which puts the rail
  back into needing ingress and undoes the reason to pick it.

## WhatsApp (Meta Cloud API)

The primary channel, and the hard one to self-host. The short version:

1. Verified Meta Business portfolio → WhatsApp Business Account (WABA) → registered
   phone number.
2. Point Meta's webhook at `https://your-gate.example/webhooks/whatsapp` with your verify
   token; subscribe to `messages`.
3. Put the permanent token, app secret and phone-number id in the hub's `.env`.

The hub verifies Meta's HMAC signature on every webhook and drops anything that
fails. Replies use the Cloud API send endpoint — including interactive numbered lists
for gate pickers.

The full walkthrough, including number advice and failure modes, is in
[Linking WhatsApp](linking-whatsapp.md). WhatsApp is the one channel that always needs
a public HTTPS endpoint — Meta's Cloud API only speaks webhooks, there is no
alternative. [Reachability](reachability.md) covers whether you need one at all;
[Public URL & TLS](ingress.md) covers the options for getting one (your own reverse
proxy, any tunnel you already trust, or one someone else operates).

### The non-conformant escape hatch: a self-hosted bridge

`AQL_WHATSAPP_ENGINE=bridge` swaps the sender above for a self-hosted, **unofficial**
WhatsApp Web bridge (Evolution API, fronting Baileys). It is off by default, opt-in
only, and **not an equal option to the Cloud API**: it violates KOTVA §26.8.2's
unconditional *MUST NOT* on unofficial WhatsApp client libraries, and it puts your own
WhatsApp number at real ban risk (Meta bans unofficial clients, commonly within weeks
rather than years, and tightened enforcement further on 2026-01-15). The hub logs a
ban-risk warning on every boot whenever `bridge` is selected.

It is documented rather than hidden because the code path exists
(`hub/internal/channels/send.go`) and pretending otherwise would be dishonest — not
because it is recommended. **The official WABA path is the conformant one.** Full
detail: [Linking WhatsApp](linking-whatsapp.md).

**The required fallback whenever that engine is in use is the web console and/or a
second chat channel** (Slack Socket Mode or Telegram, below) — **not** the offline
LAN/BLE grant path. The hub does mint and sign real grants now, but nothing on a
resident's phone can present one, so that path cannot save you (see
[Emergency access](emergency-access.md)).

## Slack

The five-minute channel, and the recommended first channel for self-hosters:

1. Create a Slack app from a manifest at api.slack.com. This one requests exactly
   what the hub uses — message events, mentions, interactivity for the gate
   buttons, and `chat:write` for replies (substitute your hub's URL):

   ```yaml
   display_information:
     name: Aql
     description: Text your gate open
   features:
     bot_user:
       display_name: Aql
       always_online: true
     shortcuts:
       - name: Open a gate
         type: global
         callback_id: open_gates_shortcut
         description: Pick one of your gates to open
   oauth_config:
     scopes:
       bot:
         - chat:write
         - im:history
         - channels:history
         - app_mentions:read
   settings:
     event_subscriptions:
       request_url: https://your-gate.example/webhooks/slack
       bot_events:
         - message.im
         - message.channels
         - app_mention
     interactivity:
       is_enabled: true
       request_url: https://your-gate.example/webhooks/slack/interactions
   ```

2. The **Events API** request URL is `https://your-gate.example/webhooks/slack`
   (interactive button clicks arrive at `/webhooks/slack/interactions`). Slack
   sends a challenge; the hub answers it automatically.
3. Configure the hub:

```sh
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
```

Every incoming event is verified against the signing secret (Slack's signed-request
scheme, timestamp-checked against replay, with a 300 s window; requests missing the
signature or timestamp headers are never skipped); anything unverifiable is dropped
and logged.

### Socket Mode — the zero-URL install

**Socket Mode works today.** Set `SLACK_APP_TOKEN` to an app-level token (`xapp-…`) and
the hub **dials out** to Slack over a single outbound WebSocket
(`apps.connections.open` → `wss://…`) instead of receiving webhooks — it acks each
envelope and feeds the payload through the *same* handlers the Events API webhook uses.
A hub on a LAN with **no public URL at all** runs Slack fully: this is what makes
"a Pi on the estate LAN is a complete installation" real. Enable Socket Mode in the app
manifest, mint the app-level token, and set:

```sh
SLACK_APP_TOKEN=xapp-…   # optional — presence enables Socket Mode (no public URL needed)
```

With no `SLACK_APP_TOKEN`, the hub stays on the Events API webhook
(`/webhooks/slack`), which needs a reachable URL. Either mode works; Socket Mode is the
one that needs zero ingress — see [Reachability](reachability.md).

Residents then DM the app — or use a channel you allow — with `open`. Their Slack
member id is their identity, and they attach it themselves with a link code from
**Settings** (above); there is no way for an administrator to type someone's Slack id in
on their behalf, because that would be a claim about an account nobody had proven they
control. Workspaces map naturally onto complexes and offices, which makes Slack a
favourite for gated workplaces and co-working spaces.

Slack replies support the same numbered pickers and quota warnings as WhatsApp.

## Telegram

Telegram is wired to the **real open path** in the hub:

- **What works now** — the hub receives updates on `/webhooks/telegram`,
  verifying the `X-Telegram-Bot-Api-Secret-Token` header against your configured
  webhook secret (mismatches are rejected). A linked user texting `open` runs the
  **same rules-and-signing pipeline** as every other channel: identity resolution,
  quotas, then the Ed25519-signed command to the controller. When several
  gates are available the reply is an **inline-keyboard picker**, and tapping a button
  re-enters the same verdict path. Every chat and message is recorded and the shared
  per-sender flood throttle applies.

- **Opt-in long polling** — set `AQL_TELEGRAM_ENGINE=polling` and the hub calls
  `getUpdates` outbound instead of receiving webhooks. Entirely outbound, so it needs
  **no public URL at all**. The default is unchanged and stays the webhook: anything
  other than the exact string `polling` (including unset and misspelled) resolves to
  webhook, because a hub should not quietly stop authenticating its inbound updates
  because a variable was fat-fingered.

  **What changes when you select it.** The webhook path authenticates every request with
  the `X-Telegram-Bot-Api-Secret-Token` header. Polling has no per-request secret; TLS to
  `api.telegram.org` plus your bot token establish authenticity instead. The hub logs
  that trade-off once at startup rather than leaving it implicit. See
  [Reachability](reachability.md).

Setup:

1. Create a bot with **@BotFather** and keep the bot token.
2. Register the webhook with a secret:
   `https://api.telegram.org/bot<token>/setWebhook?url=https://your-gate.example/webhooks/telegram&secret_token=<secret>`.
3. Configure the hub:

```sh
TELEGRAM_BOT_TOKEN=123456:ABC-…
TELEGRAM_WEBHOOK_SECRET=…   # must match the secret_token you registered
```

## Discord

The Discord channel ships: a Gateway WebSocket connection, identity by user id, and the
same open path as every other rail. It is outbound-only like Slack's Socket Mode, so it
needs no inbound reachability. Setup is a bot token, the MESSAGE CONTENT intent, and no
Interactions Endpoint URL — leaving that URL set is the one footgun, because Discord then
stops delivering over the Gateway.

## Trigger words and pickers

- Default trigger: `open`. Per-location allow-lists accept any phrase — *oop*,
  *hey gate*, 👍.
- One access point → the gate just opens.
- Several access points → the reply is a numbered picker; the member answers `1`/`2`/`3`.
- Quota warnings appear when an admin has set a daily open quota on the location;
  denials say so honestly and link to the web portal — see
  [Rate limits & quotas](limits.md).

## Flood protection

Every channel shares one throttle: past 10 inbound messages per minute from the same
sender (tunable via `RATE_CHAT_MSGS_PER_MIN`), **the bot goes quiet** — it stops
replying until the minute window rolls over. The webhook itself still answers `200`,
deliberately: an error would make Meta, Slack or Telegram retry and amplify the flood.
Going
quiet only silences replies; gate opens are governed separately by the open limits in
[Rate limits & quotas](limits.md), and denials of actual open attempts always get an
honest reply rather than silence.

## Writing a new channel

The seam is deliberately small: resolve sender → identity, message → intent, reply →
send. Every open on every channel funnels through the one open-path choke point — a
channel decides how to ask and how to reply, never whether the gate may open.

`hub/internal/channels/` is where a new rail goes. There are two interfaces to pick
from: `Channel` for a webhook-shaped provider (the hub verifies an inbound POST), and
`DialChannel` for a subscribe-shaped one where the hub dials out instead — Slack Socket
Mode is the worked example of the second. If you want Signal, SMS or another rail, copy
whichever shape matches.

(A separate, unbuilt design puts rail termination in an external coordinator instead —
[`docs/PIER-CHAT-SEAM.md`](https://github.com/vul-os/aql/blob/main/docs/PIER-CHAT-SEAM.md).
It is a design for an option, not a reason to hold off building a rail here.)

Contributions and design discussion are welcome on
[GitHub](https://github.com/vul-os/aql) — Aql's code is MIT.
