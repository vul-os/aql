# Access as a device kind: the design before the fold

**Status: designed, not built.** No code implements this. `internal/devices` still
declines to drive access points, and it is right to until the questions below are
settled.

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

### 2.1 But defence in depth gets thinner, and that is the real cost

Today there are **two independent reasons** an automation cannot open a gate:

1. Access points are not in the registry at all, so no rule can even name one.
2. The verb's tier is above the ceiling.

After the fold, **only the second remains.** That is a genuine reduction, and it
is the single most important consequence of this change. A tier assigned wrongly
in a future edit to `capability.go` would, today, still be caught by (1); after
the fold it would not be caught by anything.

The compensating control is not a bigger comment. It is a test that pins every
access verb's tier against the ceiling directly, so that lowering one fails the
build rather than quietly widening what an unattended rule may do. That test is
worth having *before* the fold and independently of it — it costs nothing now and
it is the thing the fold spends.

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

---

## 4. What this buys, stated plainly

One list. `GET /v1/engine/devices` returns the gate beside the lamp, the meter
and the camera, and the console stops having a device screen that structurally
cannot show the one kind the product is best at.

That is worth doing and it is not worth much more than that. Anyone expecting the
fold to unify the *actuation* paths should read §3.1 and stop.

---

## 5. Open questions this document does not settle

- **Does the console merge the screens?** A gate appearing in the device list
  while also having its own screen is two places showing one thing. Probably the
  device list should link out rather than duplicate controls, but that is a
  design question about the console and this is not that document.
- **What does a gate's `status` reading contain?** Controller connectivity is
  known; whether the barrier is physically open is not, on most installations,
  because there is no sensor. Reporting `closed` when nobody knows would be an
  invention. A reading that says "the controller is reachable" and nothing about
  the barrier is honest and less useful than it sounds.
- **Do access points get engine health semantics?** `AvailDegraded` means
  reachable-and-not-working. For a controller that is a genuinely useful state and
  it may already be better expressed by the existing pairing/heartbeat surface.
- **What happens to `KindAccess` in the catalogue if this is never built?** It is
  currently modelled and undriven, which is honest today and would be dead weight
  if the fold is abandoned. If that happens, say so here rather than leaving the
  kind to look like an oversight.

---

## 6. The order of work

1. **The tier-ceiling test** (§2.1). Independent of the fold, valuable now, and
   it is what the fold spends. Do this first, and if nothing else is ever done,
   this was still worth doing.
2. The read-only driver: `Discover` and `Read` from the store, `Execute`
   refusing.
3. Wiring it into the registry behind the same `-device-drivers` switch as the
   others, so a hub with no engine is unchanged.
4. The console question in §5, which is a separate piece of work and may
   reasonably be answered with "link, do not duplicate".

Steps 2 and 3 are small. Step 1 is the one that matters, and step 4 is the one
that will take the longest to agree.
