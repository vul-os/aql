# A controller reporting its configuration back

**Status: the controller half is built; the hub half is not.** The contract and
its vectors exist (`proto/commands.md`, `proto/vectors/reports.json`), and a
controller signs and sends `ctl.report`. Nothing yet STORES or SHOWS it — the hub
has no case for the type and no table, so today the message is sent and ignored,
which is exactly what an older hub does with it and therefore safe.

ROADMAP has carried this since the controller gained tunable actuation: `cmd.ack`
carries a result and a detail and nothing else, so the hub can send `pulse_ms`,
`hold_max` and `sensor_debounce_ms` to a controller and can never ask what they
currently are. The console says so plainly rather than leaving empty boxes to be
read as "unset", which is the honest stopgap and not a fix.

This is the document that has to exist first, for the same reason
`CAMERA-RETENTION.md` did: it is a change to a signed wire contract with
conformance vectors on both sides, and deciding the shape while writing the code
produces a protocol nobody can extend later.

---

## 1. What an operator actually needs to see

Not what was last sent. **What is in effect.**

The controller resolves every value as `config[key]` or a compiled-in default
(`command.go`'s `cfgInt`). So a controller that has never been configured is
running on `DefaultPulseMs`, and one configured months ago may be running on a
value no one remembers sending. Those are indistinguishable from the hub today,
and reporting only the stored overrides would keep them indistinguishable.

The report is therefore the **resolved** value plus, per key, whether it came
from configuration or from the default. A single number would answer "what will
this gate do" but not "did my change land", and both questions are why the
feature exists.

---

## 2. The compatibility question, already answered

This looked like the expensive part and is not.

Uplink verification canonicalises the bytes it RECEIVED minus `sig`
(`hub.VerifyFromController` → `jcsMinusSig`), not a rebuild of the fields
`hub.Ack` declares. So:

- A newer controller adding a field is accepted by an older hub, which verifies
  the signature over everything it received and then ignores what it cannot
  parse. **No version bump, no flag day for a mixed-version fleet.**
- That field is genuinely inside the signature, so nothing on the path can
  rewrite a reported configuration.

Both halves are pinned by `TestAnUplinkWithAnUnknownFieldStillVerifies`, which
also fails if verification is ever "tidied" into verifying the parsed struct —
the refactor that looks better and silently breaks every mixed-version fleet.

---

## 3. The decisions

### 3.1 The carrier is the SESSION, not the ack

Three candidates, and the ack is the obvious one that is wrong:

| Carrier | Reports when | Problem |
|---|---|---|
| `cmd.ack` | a command is sent | A gate nobody has commanded never reports. The hub's view is emptiest exactly for the quietest controllers. Also puts the same unchanging object on every ack forever. |
| `ws.auth` | every connect | Already signed, already in the pairing vectors — but auth is the security handshake, and widening it means every future report change touches the one message whose failure modes are `cnonce_replay`, `badsig`, `stale_clock`. |
| **new `ctl.report`** | every connect, and on change | Its own message, its own vectors, no coupling to authentication. |

**`ctl.report`, sent once after `ws.auth` succeeds and again whenever the
resolved configuration changes.** A controller that is merely connected reports;
one that is never commanded still reports; and a `config` command that lands is
followed by a report showing the new resolved values, which is what "did my
change land" needs.

### 3.2 It is a report, not a request

The hub records it and shows it. It does not diff it against what it sent, and
it does not re-send on mismatch. An automatic reconciler is a loop that fights
a human with a serial cable, and this product's answer to divergence is to show
it, not to win it.

### 3.3 Storage is last-write-wins per device, not a history

One row per device, replaced on each report — `controller_config_reports`,
**migration 0026** (claimed here so a parallel change does not collide).

A history would be a second event log, and `controller_events` (0019) already
exists for things that happened. A configuration is a state, and the question is
always "what is it now". If someone later wants the trail, the events table is
where it belongs.

### 3.4 A report is never authorisation

It changes nothing about what the controller will accept. It cannot relax
`hold_max`, cannot lift lockdown, cannot alter the pinned key. The hub treats it
as display data, and it is stored in its own table precisely so it cannot be
mistaken for the configuration the hub *sends* — that stays where it is.

### 3.5 An unreported controller says so

A device with no report reads as **"not reported yet"**, never as defaults.
Inferring the defaults would be the same failure the console's current honest
placeholder avoids: showing a number nobody confirmed. Old controllers never
send this, and there must be no version in which the console invents their
settings.

---

## 4. Wire shape

```json
{ "v": 0, "typ": "ctl.report", "device_id": "uuid", "ts": 1789000001,
  "firmware": "0.1.0",
  "config": {
    "pulse_ms": { "value": 700, "source": "default" },
    "hold_max": { "value": 30,  "source": "config"  }
  },
  "sig": "base64url(ed25519(controller_key, JCS(message minus sig)))" }
```

`source` is `config` or `default`, and it is the field that makes the report
answer both questions in §1. Unknown keys are ignored by the hub rather than
rejected, so a controller that learns a new tunable does not need the hub
updated first — the same direction of compatibility §2 establishes.

**Only keys the controller RESOLVES appear.** An earlier draft of this document
and of the spec listed `sensor_debounce_ms` beside the other two, which was
wrong: `config` accepts it and the controller stores it, but nothing reads it —
the debounce that applies is a property of the relay wiring
(`-relay …,sensor-debounce=20ms`). Reporting a stored-but-unread key as
`source: "config"` is precisely the lie this message exists to stop, so absence
is the answer, and `report-omits-an-unresolved-key` pins it.

---

## 5. Open questions this document does not settle

- **Does a report on change need debouncing?** A controller applying a burst of
  `config` commands would emit a report each time. Probably coalesce on a short
  timer, but the burst has never been observed and inventing a threshold for it
  now would be a guess.
- **Should the relay's identity be in it?** Knowing a controller is on the MOCK
  relay rather than a GPIO line is arguably the single most useful thing the hub
  could display — a gate that acks every open and moves nothing. It is not
  configuration, though, and hanging it here because there is a message going
  spare is how a protocol turns into a junk drawer.
- **What does the console do with `source: "default"`?** Showing 700 ms and
  showing "700 ms (default)" are different claims, and the second is the true
  one. That is a console decision and this is not that document.

---

## 6. The order of work

1. ~~`proto/commands.md` — the `ctl.report` message, and vectors in
   `proto/vectors/`.~~ **Done.** The spec section is `commands.md`
   "Configuration report", and `proto/vectors/reports.json` carries five
   vectors: all-defaults, mixed sources, an unknown key accepted, a bad
   signature, and a correctly-signed report from the wrong device. verify.mjs
   evaluates them with its OWN checker rather than the signature-only one, so
   `typ`, `v` and `device_id` are checked by the independent verifier and not
   only by the implementations.
2. ~~Controller: emit after `ws.auth`, and on resolved-config change.~~ **Done.**
   `wire.SignCtlReport` signs it, `command.ResolvedConfig` decides what may
   honestly be in it, and `Runner.reportConfig` sends it — on every connect, and
   again after a command whose RESOLVED values changed, compared on value AND
   source so re-sending a value already in effect reports nothing new. Sending is
   best-effort: a failed report must not cost a connection that can still open a
   gate, and the next connect sends a fresh one.
   **Unblocked, and the precondition is pinned.** A controller can send this
   unconditionally because a hub that predates the message ignores it rather than
   dropping the session: `handleControllerUplink`'s switch has no default branch,
   so an unrecognised `typ` is verified, recorded as device activity, and falls
   through. `TestAnUnknownUplinkTypeDoesNotEndTheSession` holds that, and fails
   against the regression that would actually be written — closing the connection
   on a type the hub cannot parse, in the read loop where the connection lives.
   Without it an upgraded controller authenticates, reports, and is hung up on,
   in a loop, at a gate.
3. Hub: verify (the existing uplink path already covers an unknown type's
   signature), store under migration 0026, expose on the device detail route.
4. Console: replace the honest placeholder with the reported values, marking
   defaults as defaults.

Steps 2 and 3 are small and independent once step 1 exists. Step 4 is the one
that has to decide §5's last question.
