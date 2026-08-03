# lintel e2e — cross-module integration harness

Proves the **hub** (`../hub`) and the **controller** (`../controller`)
interoperate over the *real* wire protocol (`../proto`), by booting the actual
shipped binaries and driving them over real HTTP + RFC 6455 WebSocket + the LAN
grant HTTP surface.

```
go test ./...            # from this dir; builds both binaries, runs the suite (~15–20s + build)
go test -run TestMoneyPath -v ./...
```

Requires the Go toolchain and the sibling `../hub` and `../controller`
modules on disk (their deps are fetched on first build). Nothing else — no
Postgres, no Docker, no network at runtime.

## Why subprocess, not in-process

The task asked for an in-process harness that imports both modules (optionally
via `go.work` / `replace`). **That is impossible here, and no `go.work` or
`replace` can fix it:** every package in both modules lives under `internal/`
(`hub/internal/...`, `controller/internal/...`). Go's internal-package rule
keys on *import paths*, not modules or workspaces — an importer is allowed only
if its path is under the parent of `internal/`. This module's path is
`github.com/vul-os/aql/e2e`, a **sibling** of
`github.com/vul-os/aql/hub`, so it can never import
`.../hub/internal/*` (or the controller's). `go.work`/`replace` only change
module *resolution*; they do not relax `internal/`. The only in-process routes
would be relocating this module under one of the others, or adding public
re-export shims to those modules — both out of scope ("do not modify
hub/controller source").

So the harness drives the two **binaries** as subprocesses. This is a *stronger*
interop proof than importing would be: it exercises the shipped artifacts and
the real TCP/WebSocket/LAN transports.

Consequently:

- **No imports from the hub or controller modules.** `e2e/go.mod` depends
  on nothing either of them owns. Each module's `go test ./...` stays exactly
  as it was; adding this module is invisible to the hub/controller CI jobs
  (they run with `working-directory` set and there is no repo-root `go.mod`).
- The harness signs offline **grants** as the hub and **proofs** as the
  app, so it needs the same canonical JSON both sides use. It used to keep its
  own hand-copy of `jcs.go` for that, and the copy drifted: it missed the
  `json.Number` rounding fix and canonicalised 2^53+1 to 2^53 for as long as it
  existed, while both production copies refused it. It now imports the one
  shared canonicalizer, `github.com/vul-os/aql/jcs` — a small module with no
  dependencies, which exists precisely so a sibling module blocked by
  `internal/` can still use it. **That is a `require` + a relative `replace` in
  `e2e/go.mod`**, and it is not a hole in the rule above: a canonicalizer is
  not the hub or the controller, and the harness still speaks to both only
  over the real wire. Its correctness is still checked at runtime too — a grant
  it produces is accepted by the real controller in `TestOfflineGrant_Redeem`.

## What each test proves

| Test | Path exercised |
| --- | --- |
| `TestMoneyPath` | member open → verdict → signed `open` envelope → WS push → controller verifies vs pinned key → relay pulse → `cmd.ack` → hub records **acked** (nonce-correlated) + clean audit row, within the 5s window |
| `TestClose_Acked` | `close` command round-trips (second actuation direction) |
| `TestOpen_NoDevice` | AP with no controller → open still audited, delivery `no_device` |
| `TestOpen_Queued` | AP bound to an offline device → delivery `queued` (poll-fallback queue) |
| `TestRateLimit_NeverReachesController` | cooldown-denied open → 429, **no** dispatch (relay never pulses, no command processed) |
| `TestControllerEvent_FlowsToGateway` | controller signs `opened` event, drains it over the WS, hub verifies, persists and accepts |
| `TestOfflineGrant_Redeem` | hub-signed grant redeemed over the LAN with the hub absent → relay pulse + `grant_redeemed` drains on the live WS |
| `TestOfflineGrant_Rejects` | adversarial grants at the real `grants.Exchange`: tampered→`badsig`, wrong device→`wrong_device`, replayed cnonce→`cnonce_replay`, each fail-closed with no pulse |
| `TestLockdown_DeniesOfflineRedeem` | lockdown latch (set via `controller-sim` stdin) denies a valid offline redemption → `lockdown`, no pulse |
| `TestHold_Acked` / `TestHold_WithSecondsIsAcceptedAndSigned` / `TestHold_RateLimitNeverReachesController` | `hold` end to end — the first command whose PAYLOAD the signature covers. Proves the hub's signed map and the controller's canonicalisation agree (they would not if key ordering differed, and each module's own tests would still pass), that the controller reports `held` rather than `opened`, and that a rate-limited hold never reaches the controller at all |
| `TestPairing_PathContract` / `TestPairing_DocumentedInvocationWorks` | pairing redeem path at both `/pair/redeem` and `/api/pair/redeem`, including the controller's documented bare `--hub` invocation — see the fixed **interop finding #1** below |

## Interop findings (for the module owners)

These are documented by tests here; the fixes belong in `hub/` /
`controller/` / `proto/`, not in this harness.

1. **Pairing redeem path mismatch — fixed, kept as a regression test.** The
   controller builds its redeem request at `<hub>/pair/redeem` (matching
   `proto/pairing.md`'s flow diagram and the controller README's `--hub
   https://host`); it used to be that the hub served the handler at
   **`/api/pair/redeem`** only, so the documented invocation 404'd to the
   portal and the controller failed to pair. The hub now mounts the redeem
   handler at **both** `/pair/redeem` and `/api/pair/redeem`
   (`internal/httpapi/server.go`), so the bare, documented `--hub` invocation
   works with no workaround. `TestPairing_PathContract` asserts both paths
   return `pair.grant` and burn their claim; `TestPairing_DocumentedInvocationWorks`
   proves it end to end with the real controller binary, invoked exactly as
   its README documents.

2. **Long-poll fallback fully mismatched (known/documented).** The controller's
   `longPollCycle` does `GET <ws_url>/../poll?device_id=…` then `POST` with
   `{acks,events}`; the hub instead exposes `POST /api/controller/challenge`
   + `POST /api/controller/poll` (body = a signed `ws.auth`) + `POST
   /api/controller/ack`. The controller code already flags its poll endpoints as
   "not yet specced"; only the primary WebSocket path currently interoperates.
   (Not asserted here — it triggers only after 3 consecutive WS failures.)

3. **Controller events are now persisted — fixed.** The hub used to verify
   uplink `event`s against the enrolled key and then only *log* them, with no
   event store and no API to read them back. Migration `0019_controller_events.sql`
   plus `hub/internal/store/controllerevents.go` and `GET /v1/devices/{id}/events`
   closed that gap: events are stored (deduped on `event_id`) and retrievable.
   `TestControllerEvent_FlowsToGateway` still asserts on the log, which remains
   a true observable, but the underlying gap it was written to document is gone.

4. **No hub API dispatches non-open/close commands (gap).** The open path is
   the only command dispatcher, so `lockdown/lift/ping/config/repair` defined in
   `proto/commands.md` have no server-side trigger. The controller's command
   verification (replay/lockdown/window/etc.) is thus unreachable from an
   external harness via the WS path; it is covered by the controller's own
   vector tests, and the lockdown *matrix* is exercised here via the offline
   grant surface instead.

5. **Provisioning coupling (not a bug, note).** The hub signs command
   envelopes with `access_point` = the AP's **id** (a UUID), so a controller
   must be configured to *serve that id* (`--access-points <AP_ID>`), not a
   friendly name. The harness reads the id from the create-AP response and
   passes it through.

6. **No chat rail is exercised here, and that is where the gaps were.** Every
   test in this suite reaches the open path over HTTP or the LAN grant surface.
   Nothing posts a webhook, so `finishOpen` — the open path shared by WhatsApp,
   Telegram, Slack and Discord — has no real-binary coverage at all.

   That is not a theoretical gap. Two defects found on 2026-08-02 were both on
   chat paths, and both were invisible here: a refusal that still dispatched a
   signed open to the gate (`finishOpen`), and a webhook processed before its
   signature was verified. The equivalent mutation on the HTTP path is caught
   immediately, by `TestRateLimit_NeverReachesController` and
   `TestHold_RateLimitNeverReachesController`. Same property, same hub, one
   entry point covered and one not.

   **Partly closed.** `TestChatRail_TelegramOpensARealGate` now drives the whole
   product flow against the binaries: mint a link code over the console API,
   spend it from Telegram, then open a gate and watch a real controller pulse.
   Both defects above fail it — a rail that never dispatches, and an unsigned
   webhook that pulses the relay before its signature is checked.

   **Closed for the three webhook rails.**
   `TestChatRail_WhatsAppAndSlackReachARealGate` covers the other two, each
   through its own signature scheme (Meta's `X-Hub-Signature-256` over the raw
   body; Slack's `v0:timestamp:body` with a replay window) and its own linking
   ceremony — WhatsApp by VERIFIED PHONE via `/v1/phones/me/link`, because
   `channels/me/link` answers `unsupported_channel` for it on purpose
   (channellink.go: offering both would be a second, weaker path to the same
   access).

   Discord stays uncovered and cannot be covered the same way: it has no
   inbound webhook at all, being bot-token dial-out over the gateway socket.

   Both tests also drive **close**, not only open. `channels_slack.go` records
   why: AccessBlocks once minted only `open_gate:` buttons and the switch
   recognised only "open", so a resident who could open a gate from chat had no
   way to close one — "close is never harder to reach than open" violated in
   the one direction that matters. Fixed on all three rails, regressed on two.
   Matched on `cmd=close` rather than a relay pulse, because a close is
   `Relay.Release` and waiting for `state=pulsing` would pass on an open and
   prove nothing about the verb.

   **hold** is covered too, and what it revealed is worth reading before
   changing that rail. A `hold_ap:` selection ACTUATES — the controller records
   `cmd=hold` and the gate stays open until something closes it — while no rail
   produces one: there is no "hold" command word in any handler (the vocabulary
   is open, close, gates) and nothing mints a hold button. So an auditor reading
   the command words concludes chat cannot hold a gate, and the plumbing behind
   it is complete. Staged, not holed: only the platform can deliver a selection
   and it only echoes ids the bot minted. Pinned so that wiring hold up, or
   closing it off, is a decision someone makes rather than discovers.

   The **narrowing** rule is asserted alongside it: a `select_loc:` /
   `select_loc_close:` / `select_loc_hold:` tap renders the next picker and
   actuates nothing. Those ids sit in the same allowlist as the ones that DO
   actuate, so the distinction is a table entry rather than a type.

   Two notes on tampering that rule, both learned the hard way.

   The obvious mutation does not work. Making `LocationCommandVerb` return
   `isNarrowing=false` does NOT cause an actuation — the handler falls through
   to "unknown selection" and nothing moves, which is correct, so the assertion
   rightly passes. The mutation that produces the actual harm replaces the
   picker render with `waAccessCommand(...)` on the first narrowed gate; that
   one fails with "a location tap actuated: commands 2 → 5".

   And tamper this suite from the REPOSITORY ROOT: `-- bash -c 'cd e2e && go
   test ...'`. tamper.sh runs CMD from the module root only when CMD is a Go
   command, so a `bash -c` wrapper starts at the repo root and `cd ../e2e`
   resolves outside the checkout. It fails with "No such file or directory",
   the exit code is non-zero, and the old script called that CAUGHT — for every
   chat-rail tamper run that way. The guards were fine; the verdicts were not.
   `EXPECT="assertion text"` now refuses to say CAUGHT unless that text is in
   the output, and the script reports INVALID when nothing that looks like a
   test runner produced output at all.

   Related, for whoever runs `scripts/check-external-citations.mjs`: it verifies
   the siblings that ARE checked out and names the count it could not reach,
   exiting non-zero either way. As of 2026-08-03 kotva is present and ephor is
   not, so it reports 91 verified and 42 unchecked rather than refusing to look
   at anything.

   All three rails carry close now, each by its own route: Telegram from the
   typed word, Slack through a `close_gate:` block interaction, WhatsApp
   through the `close_ap:` BUTTON that opening pushes (there is no typed
   "close" on that rail). Each is tampered against the verb mapping itself —
   `SelectionCommandVerb(close_ap) → "open"` and its Slack equivalent — which
   is the historical defect rather than a proxy for it.

   Three things about the rails that only writing this surfaced, all of which
   made a working rail look broken:

   - Slack NEVER opens from a message. "open" always renders a picker, and the
     open is a block interaction posted form-encoded to
     `/webhooks/slack/interactions`. Telegram opens directly when there is one
     gate. Same product verb, different plumbing.
   - Slack dedupes inbound by `event.ts`, so two messages stamped with the same
     second are one message as far as the hub is concerned.
   - The open cooldown is keyed (subject | access point) and defaults to 10s,
     so a second rail opening the same gate as the same member is refused. Set
     `RATE_OPEN_COOLDOWN_S=0` when the subject under test is the rail rather
     than the limit.

   One note for whoever extends it. The unsigned probe in that test posts a body
   that WOULD open the gate, sent by a linked user. The first version posted
   `{}` before linking and passed against a handler that verified last, because
   an empty body does nothing either way. A negative probe has to be capable of
   the harm it is checking for.
