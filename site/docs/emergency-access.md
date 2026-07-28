# Emergency access

The Aql app (desktop, iOS, Android — one Tauri codebase) is deliberately **not**
the daily driver. It exists for two jobs: the admin console, and opening the gate when
everything else is down — no internet, no hub, no Meta.

## The idea: offline-verifiable grants

Whenever the app opens with connectivity, the hub issues it a **grant**: a
short-lived signed statement of that user's rights — which locations, which access
points, until when — bound to the app's own keypair. Think of it as a signed hall pass
that the controller can check without phoning anyone.

```
online, earlier:            hub ── signs ──► grant (rights + expiry + app key)
internet down, at the gate: app ◄── mDNS / BLE ──► controller
                            controller: verify grant sig  (pinned hub key)
                                        verify nonce sig  (app key)
                                        check rights + expiry
                                        ✓ open · queue audit event
```

## What happens at the gate

1. The app discovers the controller directly — **mDNS** if your phone is on the same
   LAN, or **Bluetooth (BLE)** when there's no network at all.
2. The app presents its grant and asks to open.
3. The controller replies with a random **nonce**; the app signs `grant ‖ nonce` with
   its own key.
4. The controller verifies the grant's signature against its **pinned hub key**,
   checks expiry and rights, verifies the nonce signature against the app key named in
   the grant — and opens.
5. The audit event is queued on the controller and uploaded when connectivity returns.
   Offline opens are still audited opens.

No step involves the internet, the hub, or any Aql server. A recorded exchange
is useless later: the nonce makes every challenge unique.

## What's implemented

The controller side of this path is **real and conformance-tested** in the reference
agent ([`controller/`](https://github.com/vul-os/aql/tree/main/controller)): the
11-step offline-grant verification (signature, expiry, rights, single-use nonce,
stale-clock handling), shared by both transports. **LAN/mDNS works today** — the agent
advertises `_lintel._tcp` and serves grants over LAN HTTP. The **BLE** path's framing
codec and open→challenge→proof→result session are implemented and unit-tested at ATT
MTUs 23/185/512; the **BLE radio (GATT peripheral) still needs hardware validation** —
its BlueZ glue compiles behind `-tags ble` on Linux but has not been exercised on real
hardware yet.

**Hub-side issuance is now real.** `POST /v1/offline-grants`
([`hub/internal/httpapi/offline_grants.go`](https://github.com/vul-os/aql/blob/main/hub/internal/httpapi/offline_grants.go))
authenticates the caller, re-checks the exact same membership / account-suspended /
user-disabled gates the live `/open` path enforces (all-or-nothing — a caller not
currently entitled to every requested access point gets nothing, never a grant
silently narrowed to a subset they didn't notice), and signs a `typ:"grant"` object
with [`keys.SignGrant`](https://github.com/vul-os/aql/blob/main/hub/internal/keys/grant.go)
— the identical JCS/Ed25519 discipline `Envelope` uses, verified byte-for-byte against
[`proto/vectors/grants.json`](https://github.com/vul-os/aql/blob/main/proto/vectors/grants.json)'s
`grant-redeem-valid` fixture. TTL is fixed at the proto default (7 days) and is not
caller-extendable, and every issuance is written to the admin audit trail. The
cross-module e2e test that exercises the LAN redemption path
(`e2e/harness_test.go` / `TestOfflineGrant_Redeem`) now calls this real endpoint
instead of self-signing a grant with the hub's key, as it used to — the
hub → controller half of the path is proven end to end against real issuance.

One deliberate gap: issuance does **not** check a controller's lockdown state — the
hub has no visibility into that, by design (lockdown is controller-local; see
"that locality is the feature this whole path exists for" in `proto/grants.md`) — so a
grant can be minted while a controller happens to be in lockdown. That isn't an
oversight: lockdown is still enforced, unmodified, at redemption time (step 2 of the
controller's 11-step verification, already conformance-tested), which is the freshest
possible signal anyway — a lockdown state cached at mint time could go stale seconds
later regardless.

**Where the app half stands.** Requesting and holding a grant is real and driven
end to end in a browser against a live hub: the console mints a device key, asks the
hub, and stores the grant in an IndexedDB vault that survives a reload
(`e2e-browser/safety-copy.spec.ts`).

Presenting one at a gate works in the desktop shell, and now in a browser tab too —
but only where the browser can reach the controller:

| You are using | Presenting works? | Why |
| --- | --- | --- |
| The desktop app | Yes | Requests go through a native HTTP client, subject to neither CORS nor mixed content |
| A browser, console served over **http** | Yes | The controller answers with a CORS header naming the console of the hub it is paired to |
| A browser, console served over **https** | **No** | The controller speaks plain http on the LAN, so the request is blocked as mixed content before CORS is consulted. No header fixes this |

Two limits worth knowing before you rely on it. The controller allows exactly one
origin — the hub console it paired with — so reaching the console at a different
address than the controller stored (an IP where it paired by hostname, say) is
refused, and the attempt fails at the network layer rather than at the gate. And
**BLE presentation is desktop-only**: a browser cannot speak the controller's GATT
service at all, so a gate out of Wi-Fi range needs the app.

## Revocation and expiry

Grants are short-TTL — a fixed 7 days, not caller-extendable — and the design refreshes
them whenever the app opens with connectivity. Revoking a person therefore converges
within the grant TTL at worst; the normal, online path checks live permissions anyway.
The trade is explicit: a bounded window of worst-case grant validity buys you a gate that
opens during a blackout.

**There is no revocation channel for an already-issued grant.** That is an accepted v0
non-goal, stated in the code: a grant that has been minted stays valid until it expires.
Every issuance is written to the admin audit trail so an operator can at least see what
is outstanding.

Losing a phone is the same story as losing a controller: revoke the device's key in the
console; existing grants die at their expiry, new ones are never issued.

## Setting it up

**You can't, yet — and that is the honest answer.** The steps below describe the intended
flow, and none of them work today because the app has no emergency-access surface.

1. Install the Aql app and sign in to your hub. On first run the app asks *which hub* —
   you enter your hub's URL. That question is the decentralization, made visible. **This
   part works.**
2. *(Planned)* Grants would refresh silently from then on, with the current grant's expiry
   visible under **App → Emergency access**. **That screen does not exist.**
3. *(Planned)* Near the gate with no internet, the emergency screen would appear
   automatically when the hub is unreachable and a paired controller is in range.

Practical notes for whoever builds it: BLE range is tens of metres — emergency access is a
standing-at-the-gate feature, not an open-from-the-freeway feature (that's what chat is
for). And the emergency path is for people, rate-limited by the controller; it is not an
API.

## What to rely on instead, today

- **The web console** — unlimited opens, always available, no chat platform in the loop.
- **A second chat channel** — Slack Socket Mode or Telegram, so one platform going down or
  banning a number doesn't mean *no way to open the gate*.
- **Your existing remotes and keypads** — the controller sits in parallel with them and
  never in the way.
