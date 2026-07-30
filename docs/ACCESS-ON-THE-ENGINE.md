# Access as a device kind: the design before the fold

**Status: §3's decisions are built; §5's questions are still open.**
`hub/internal/devices/accessdev` is the read-only driver, wired behind
`-device-drivers=access`. It is the only driver that needs no `-device-config`,
because it reads the database.

One decision changed in the building, for the better. §2.1 expected the fold to
spend a layer of defence — after it, only the tier ceiling would stop an
automation opening a gate. It does not: a device must declare at least one
capability, and these declare `access.status`, whose only verb is `status` at
`TierRead`. So the engine can route no actuating access verb to an access point
at all, and a rule still cannot NAME one. The ceiling remains the guarantee for
the day somebody declares `CapBarrier` here, which is why the test §6 asked for
was still worth writing first.

Six documents call this out as the outstanding architectural gap — ARCHITECTURE
§8, ROADMAP, `site/docs/devices.md` twice, `src/lib/deviceKinds.ts`, and the todo.
None of them designs it. This is that document, written for the same reason
`CAMERA-RETENTION.md` was: the change touches the one path in this product that
can let a stranger through a gate, and deciding the policy while writing the code
is how a security boundary becomes whatever the code happened to do.

---

## 1. Why now, and not before

`internal/devices/driver.go` records the original deferral, and its reasoning was
correct:

> a future change could expose the controller as a Driver, but that is
> deliberately not done now: rewriting the one path that works, to prove a seam
> that has no other drivers yet, trades a tested system for a symmetry.

**That premise has expired.** The seam now has four drivers — MQTT, Modbus TCP,
generic HTTP and ONVIF/camera — and the generic ones have been shown to carry a
kind they were not written for, with the safety tier surviving the route
(`devices/httpdev`, the robot tests). The seam is no longer unproven, so the
argument that the fold would prove nothing no longer holds.

What has *not* changed is the second half of that sentence. Rewriting a tested
system is still a bad trade, and §3 keeps it.

---

## 2. The safety question, which is already answered

The obvious fear is that folding access into the engine lets an automation open a
gate. It does not, and the reason is worth stating precisely because it is the
thing everyone will check first.

The ceiling is on the **tier**, not on the kind. `automations.MaxActionTier` is
`TierConsequential`, `checkActionTier` refuses anything strictly above it, and
every access verb in the catalogue already sits above it:

| Verb | Tier | Above the ceiling? |
|---|---|---|
| `open` (barrier) | `TierPhysicalAccess` | yes |
| `hold` (barrier) | `TierPhysicalAccess` | yes |
| `unlock` (lock) | `TierPhysicalAccess` | yes |
| `close` / `lock` | `TierReversible` | no — closing is not entry |
| `status` | `TierRead` | no |

`internal/automations`' own package doc anticipated this fold and says so: *"even
if they were [routed through the registry], every access verb in the catalogue
sits at TierPhysicalAccess, above MaxActionTier, so an automation could not fire
one."*

### 2.1 Defence in depth: what this was expected to cost, and what it cost

Before the fold there were **two independent reasons** an automation could not
open a gate:

1. Access points were not in the registry at all, so no rule could name one.
2. The verb's tier is above the ceiling.

This section originally said the fold would spend (1) and leave only (2), and
called that the single most important consequence of the change. **It did not,
and the reason is worth keeping rather than editing away.**

A device must declare at least one capability — `Device.Validate` rejects an
empty list — so "surface the gate and declare nothing" was never available. The
choice was therefore between declaring `CapBarrier`/`CapLock` and declaring
something status-only. Declaring the real access capabilities would have put an
open button in the console in front of a route that refuses, AND would have let a
rule name `open` on a gate. So the driver declares `access.status`, whose only
verb is `status` at `TierRead`.

The result is that (1) substantially survives: the engine can route no actuating
access verb to an access point, because no access device offers one. What the
fold actually spent is narrower — a future edit that declared `CapBarrier` here
would now have somewhere to declare it.

(2) is therefore still the guarantee that matters for that day, and the test
pinning every access verb's tier against the ceiling was still worth writing
first. A compensating control introduced alongside the thing it compensates for
is one review away from being dropped as noise; this one was written before the
driver and outlived the argument that motivated it, which is the better outcome
for a control of this kind.

---

## 3. The decisions

### 3.1 Actuation does NOT move. The access driver is read-only.

The engine gains a driver that **discovers access points and reports their
state**. `Execute` refuses every actuating verb with `ErrUnsupported` and a
message naming the signed path.

This is the whole design, and everything else follows from it. The value of the
fold is that a gate appears in one fleet beside a lamp and a meter — a *view*
problem. The signed Ed25519 path to a paired controller is conformance-tested
against `proto/vectors`, carries offline grants, pins the controller's key at
pairing, and writes its audit row in the same transaction as the decision. None
of that is improved by being reachable through a second door.

Two actuation routes to a gate is strictly worse than one, whatever the second
one's quality: it doubles the surface that has to stay correct, and the failure
it invites — one route enforcing a rule the other does not — is silent.

If actuation ever does move, it moves by the controller becoming the driver's
transport, not by the driver growing its own path to the relay. That is a
different document.

### 3.2 The source of truth is the database, not the config file

Every other driver is built from `-device-config`. This one is not: access points
are created through the product, by people, and live in SQLite. The registry's
"one source of truth" rule (see `registry.go`) is satisfied — the driver derives
its device list from `access_points` at `Discover`, and nothing is written back.

This is a real asymmetry between drivers and it should be stated in the driver's
own doc, not smoothed over.

### 3.3 Device ids are `access:<access_point_id>`

The Driver contract requires ids stable across restarts for the same physical
device. Access point ids already are. Deriving from a name would break the moment
someone renames a gate.

### 3.4 The engine writes no audit row for access

Reading a gate's status through `/v1/engine/devices` is not an access event and
must not appear as one. The open path's audit stays exactly where it is, and the
engine's read path stays silent. An audit log where "someone looked at the
console" and "someone opened the gate" are adjacent rows is a log that gets
skimmed.

### 3.5 Ownership reconciles to the account that owns the access point

`device_ownership` scopes engine devices to accounts, and access points already
belong to an account. The driver reports the latter; nothing new is stored. A
device claimed twice, by two mechanisms, is the two-sources-of-truth failure
again.

**This was designed here and then not built, for a commit.** The driver carried
the account id and dropped it, and `engineScope` resolves ownership only from
`device_ownership` — where a gate has no row, because nothing claims a gate. So
every access device read as UNCLAIMED, and on a multi-account hub `permits`
denies an unclaimed device to everyone but the instance admin: a member could not
see their own gates. Fail-closed, and therefore silent — no error, just a fleet
that never mentioned them, on a screen that hides those rows anyway. The scope
now derives the keys from the caller's access points, still storing nothing, and
`engineaccess_test.go` holds both halves: my gate yes, yours no.

**And there were two consumers of ownership, not one.** The automations engine
resolves it separately, through `DeviceOwner`, and it takes the OPPOSITE default:
unclaimed is *permitted* there, deliberately, so that a hub which predates
ownership keeps working. A gate being permanently unclaimed therefore meant a
rule in one account could name another account's gate. Same state, opposite
readings, one of them hiding your own gate from you and the other offering
somebody else's.

Both now go through `store.AccountForDeviceKey`, which answers for both kinds of
device: claimed ones from `device_ownership`, gates from their location's
account. Still nothing stored. The store spells the `access:` prefix as its own
constant rather than importing the driver — a store that depends on a driver is
the wrong direction — and a test in `cmd/hub`, the one package that imports both,
asserts the two cannot drift. That test earns its place: when the prefix was
drifted deliberately, the store's own tests still passed, because they use the
same constant on both sides of the question.

---

## 4. What this buys, stated plainly

One list. `GET /v1/engine/devices` returns the gate beside the lamp, the meter
and the camera, and the console stops having a device screen that structurally
cannot show the one kind the product is best at.

That is worth doing and it is not worth much more than that. Anyone expecting the
fold to unify the *actuation* paths should read §3.1 and stop.

---

## 5. Open questions this document does not settle

- ~~**Does the console merge the screens?**~~ **Answered, and the console had
  mostly answered it already.** `Devices.tsx` was already contributing an Access
  row per access point — sourced from the access-point API, carrying operation
  counts and last-op time, and linking through to the screen where opening lives
  rather than duplicating its controls. "Link, do not duplicate" was the shipped
  behaviour before this design asked the question.

  What the fold broke, briefly, was that: the list is a concatenation of hub rows
  and engine rows, so once `-device-drivers=access` was on, every gate rendered
  TWICE. The console now suppresses engine-sourced access rows
  (`suppressEngineRow`), because the hub's row is strictly richer. The
  suppression is of a ROW, not of the device: `GET /v1/engine/devices` still
  returns access points, which is where a unified fleet is genuinely useful — an
  API consumer asking the engine what exists should be told about the gates.
- ~~**What does a gate's `status` reading contain?**~~ **Answered: nothing.**
  `Read` returns no readings at all. Whether the barrier is physically open is
  not known without a sensor most installations do not have, and the one fact
  that IS known — whether the controller can be reached — is availability, which
  the engine already carries on the device. Inventing a reading to look complete
  is how a console ends up drawing a chart of a number nobody measured. A test
  pins the emptiness so that filling it later is deliberate.
- **Do access points get engine health semantics?** `AvailDegraded` means
  reachable-and-not-working. For a controller that is a genuinely useful state and
  it may already be better expressed by the existing pairing/heartbeat surface.
- **What happens to `KindAccess` in the catalogue if this is never built?** It is
  currently modelled and undriven, which is honest today and would be dead weight
  if the fold is abandoned. If that happens, say so here rather than leaving the
  kind to look like an oversight.

---

## 6. The order of work

1. ~~**The tier-ceiling test** (§2.1).~~ **Done.** Independent of the fold and
   valuable regardless, which is exactly how it turned out.
2. ~~The read-only driver.~~ **Done** — `hub/internal/devices/accessdev`.
   `Discover` maps access points onto devices, `Read` returns nothing, `Execute`
   refuses every verb in the catalogue.
3. ~~Wiring it behind `-device-drivers`.~~ **Done**, with one deviation: `access`
   is the only driver that does NOT require `-device-config`, because it reads
   the database. Requiring a JSON file to list devices the product already knows
   about would be a file written to satisfy a check.
4. ~~The console question in §5.~~ **Done**, and it turned out to be the
   smallest of the four: the console had already chosen link-over-duplicate, and
   the work was keeping that true once the engine could also see a gate.
