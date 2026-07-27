# Reachability — "I run this at home with no static IP, what do I actually need?"

**Nothing.** Unless you want WhatsApp, or you want to reach the console from outside your
LAN. Then you need a URL — and getting a URL is a commodity problem with a half-dozen
equally valid answers, none of which is a component of Aql.

That is the whole chapter. The rest is the detail behind those three sentences:

1. **Nothing needs a gateway.** There is no reachability service to install, no broker to
   run, no provider to pick.
2. **One rail needs a URL** — WhatsApp, because Meta's Cloud API is webhook-only.
3. **Getting a URL is a commodity problem.** ngrok, cloudflared, a Tailscale funnel, a
   $4/month VPS running nginx, a tiny process you deploy anywhere, the Vulos relay,
   Ephor's reachability adapter — the hub cannot tell them apart.

## 1. Nothing needs a gateway

A hub on a Raspberry Pi behind a home router — no static IP, no port forward, no domain,
no tunnel — is a complete installation. It serves the console on your LAN, drives your
controllers, and runs Slack end to end.

Ingress is not a component of this system. It is **one configuration string**:

```sh
LINTEL_PUBLIC_URL=https://your-gate.example    # or the -public-url flag
```

The hub never dials that URL, never validates it, never asks where it came from. It uses
it to build the links it hands out — a signup link in a chat reply, the WebSocket URL a
controller is told to dial — and nothing else (`gateway/cmd/gateway/main.go:96`,
`gateway/internal/httpapi/channels_http.go:29`,
`gateway/internal/httpapi/devices.go:213`). Leave it empty and the hub falls back to the
`Host` header of the request it is answering, which is exactly right for a LAN install.

There is deliberately **no provider abstraction** in the code — no
`ReachabilityProvider` interface, no plugin registry, no vendor list. A string is the
right size for this seam, and anything bigger would be an invented dependency. Switching
from ngrok to your own reverse proxy is editing one line and restarting. Nothing in the
hub notices.

## 2. One rail needs a URL

| Rail / component | Needs inbound reachability? | Why |
| --- | --- | --- |
| **WhatsApp — Meta Cloud API** | **Yes, always** | The Cloud API is webhook-only. Meta offers no polling or socket mode to switch to |
| **Slack — Socket Mode** | **No** | The hub dials **out** over one WebSocket (`apps.connections.open` → `wss://…`). Shipped: `gateway/internal/channels/socketmode.go` |
| **Slack — Events API** | Yes, public HTTPS | Slack POSTs to `/webhooks/slack`. The default only when no `SLACK_APP_TOKEN` is set |
| **Telegram — webhook** | Yes, public HTTPS | Today's shipped path: Telegram POSTs to `/webhooks/telegram` |
| **Telegram — long polling** | **No** *(in progress)* | `getUpdates` is entirely outbound. Being built as an opt-in engine; **not shipped yet** |
| **Controllers** | **No** | They dial out to the hub (WSS, HTTPS long-poll fallback): `controller/internal/transport/runner.go:44`. No inbound port, fine behind CGNAT, fine on a 4G SIM |
| **Web console / desktop app on the LAN** | **No** | Ordinary LAN HTTP to the hub's listener |
| **Web console from outside the LAN** | Yes, public HTTPS | Only if residents or staff need it off the property |
| **Offline grants at the gate** | **No — nothing at all** | The controller verifies a pre-issued grant against its pinned hub key, locally: `controller/internal/grants/grants.go` |

Read down that column: one rail forces the issue, and it does so because of a decision
Meta made, not one Aql made.

### What still works with nothing exposed

- **Slack, completely.** Set `SLACK_APP_TOKEN` (an `xapp-…` app-level token) and the hub
  holds one outbound WebSocket to Slack, acking each envelope and feeding the payload
  through the *same* handlers the Events API webhook uses. Slack never connects to you.
  See [Chat channels](channels.md).
- **Every controller.** Gate hardware dials out and holds the connection, so commands
  arrive down a socket the controller opened. (The transport is real and tested; what is
  still stubbed on real hardware is the GPIO actuation itself — see
  [Controllers](controllers.md).)
- **The console on your LAN**, at the hub's own address.
- **The offline grant path**, which needs no network whatsoever: the controller checks a
  hub-signed grant against a key it pinned at pairing, with the hub down, the internet
  down and every chat platform down. The half that is *not* built is the phone-side
  presenter — see [Emergency access](emergency-access.md) for what that means today.

## 3. Getting a URL is a commodity problem

For WhatsApp you need something with a domain that Meta can `POST` to. Any of these does
the job, and they are listed in **no order of preference** because the hub genuinely
cannot distinguish them — each one ends with you setting `LINTEL_PUBLIC_URL`:

- **ngrok** — run it beside the hub, point it at the local port.
- **cloudflared** — same shape, standard (HTTP) mode.
- **A Tailscale funnel** — if you already run Tailscale.
- **A $4/month VPS running nginx or Caddy** — a reverse proxy in front of the hub.
- **A small process you deploy anywhere** — anything that can forward HTTP to your box.
- **A self-hosted `vulos-relayd`** — MIT, no account, run the agent yourself.
- **The Vulos relay**, or **Ephor's reachability adapter** — the same tunnel model,
  operated for you if you would rather not operate it.

Configs and trade-offs for each shape are in [Public URL & TLS](ingress.md).

### Whatever you put there is a dumb pipe, not a gateway

This is the load-bearing point, and it is why "deploy a box in the cloud if you want" is
an ordinary operational choice rather than a betrayal of the self-hosted model.

The thing providing your URL **holds no state, stores no keys, makes no authorisation
decision, and never sees a member list.** It moves bytes. Every check that matters
happens inside the hub, on your box:

- The hub verifies Meta's `X-Hub-Signature-256` itself — an HMAC-SHA256 over the **raw
  request body** under your `WHATSAPP_APP_SECRET`, compared in constant time, before the
  body is even parsed as JSON (`gateway/internal/channels/channels.go:194`, called from
  `gateway/internal/httpapi/channels_whatsapp.go:48`; failure is a `403` and the request
  goes no further). It is fail-closed: an unset secret rejects everything rather than
  accepting anything.
- Identity resolution, membership, suspension, quotas and the open decision are all
  re-evaluated in the hub per message.
- The command a controller obeys is Ed25519-signed by the hub and verified against a key
  the controller pinned at pairing.

So an ingress point that is compromised — or simply operated by someone who is not you —
**cannot forge an open.** It can drop your messages or delay them, which is a denial of
service and worth knowing about. It cannot manufacture a message the hub will act on,
because it does not have the app secret and could not sign a controller command if it
did.

What it *can* see is plaintext in transit if it terminates TLS, which is the same
exposure the chat platform already has by design — see [Security](security.md) and the
[threat model](https://github.com/vul-os/aql/blob/main/docs/THREAT-MODEL.md).

## Whatever provides the URL also terminates TLS

This is the part people discover painfully at setup, so it goes in bold:

> **The hub ships zero TLS and zero ACME code.** No TLS server, no
> `ListenAndServeTLS`, no `autocert`, no certificate management of any kind. It speaks
> plain HTTP on its listener, full stop.

And it will not let you get this wrong quietly. The binary **refuses to start** if
`-listen` resolves to anything that is not loopback, unless you pass `-behind-proxy`
(env `LINTEL_BEHIND_PROXY=1`) to declare that TLS is terminated upstream
(`gateway/cmd/gateway/main.go:159`, tested in `gateway/cmd/gateway/main_test.go:222`).
The refusal names the flag and explains why: binding a public interface with nothing in
front would serve the admin portal, the login endpoint and the signing API in cleartext —
credentials, JWTs and refresh tokens included.

Two things follow:

- Whatever gives you the public URL is also what holds the certificate. A tunnel
  terminates TLS at its own edge or local agent; a reverse proxy terminates it on your
  box. Either way the last hop into the hub is plain HTTP over loopback.
- A tunnel run in **raw TCP / SNI-passthrough** mode does not work — it forwards still
  encrypted bytes to a listener with no TLS code to receive them. If you want that shape
  (so the tunnel operator never has TLS-terminating access), run your own reverse proxy
  locally behind the passthrough.

## The suite rule this follows

Aql has no hard runtime dependency on any Vulos product, ever. It is a standalone,
MIT-licensed system that runs to completion with nothing but a box and, optionally, your
own channel credentials. `vulos-relayd`, the Vulos relay and Ephor appear above strictly
as options on equal footing with cloudflared and nginx, for one feature-scoped job on one
rail. Nothing breaks, degrades, or nags you if you never touch any of them.

Full self-host walkthrough: [Run a hub](self-host.md). Per-rail setup:
[Chat channels](channels.md). Ingress how-to: [Public URL & TLS](ingress.md).
