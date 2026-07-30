# Camera recording: the design that has to exist before any of it is built

**Status: design only. No code implements this** — meaning the retention policy
below: there is no retention worker, no clip store, no `camera:view` permission
and no viewer.

The package under it has moved on since that was written, and saying so matters
because "no code implements this" reads as "the camera package does nothing yet".
`hub/internal/devices/camera/` discovers cameras, resolves stream addresses,
probes with RTSP `DESCRIBE` and reports the encoder's real cropped resolution from
the stream's own sequence parameter set; it depacketizes RTP into H.264 NAL units,
groups them into access units, and muxes them into a fragmented MP4 that a real
Chromium `MediaSource` accepts and plays.

What remains true, and is the reason this document is still design-only:
**nothing has ever received a frame from a camera** — the media probe has only
seen an in-process RTSP server — and **nothing in this repository stores one**.

Stated bluntly because it is the shape this repository has been caught by
repeatedly: `Fragmenter` has no production caller. Grep it and the only hit
outside tests is its own definition. That is a component that is complete,
tested, validated against a third-party demuxer, and reachable by nobody —
normally a defect here, and normally the sign of a feature that does not work.

It is deliberate this time, and the ordering is the reason: the consumer would be
a recording worker, a recording worker writes footage to a disk, and writing
footage to a disk without the policy below settled is how a product ends up
retaining video it cannot justify keeping. The muxer exists first so the policy
is written against something real rather than against a guess. When the worker
lands, this note should be deleted along with the design-only status — and if the
worker never lands, the muxer is dead weight and should be said to be.

This document exists because "camera live view and recording" has sat on the
roadmap as blocked on *hardware*, and that was only half true. The other half is
this: **recording is not a feature, it is a data-retention policy with a UI
attached**, and writing the pipeline before deciding the policy produces a
system whose behaviour under pressure — a full disk, a subpoena, a flatmate
reviewing footage of another flatmate — is whatever the code happened to do.

Every other subsystem here has its hard question answered in writing first. The
tier catalogue decided what an automation may actuate before the scheduler
existed. `internal/energy` decided what an unmeasured hour means before the
poller did. This is that document for footage.

---

## 1. Why footage is not like the rest of the product

Everything else this hub stores is a fact about a *device*. A meter read 2.41 kW.
A gate opened at 19:04. A rule fired.

Footage is a record of **people**. It is the only thing in the product where:

- The subject of the data is usually not the person who controls it.
- Looking at it is itself an act that can harm someone, with no actuation
  involved and nothing physically changed.
- Its value to an operator and its risk to a resident both rise with retention
  length, in opposite directions.
- Deleting it can destroy evidence, and keeping it can be the harm.

None of the machinery built so far is shaped for that. The safety-tier model
governs *actuation*: `TierRead` is the bottom of it, the tier nothing worries
about. For footage, reading **is** the sensitive operation, so the tier model
does not help here and must not be stretched to pretend it does.

---

## 2. The decisions

### 2.1 Clips live on the filesystem, never in SQLite

```
<data-dir>/recordings/<account-id>/<device-key>/<YYYY-MM-DD>/<start-unix>-<duration>s.mp4
```

SQLite holds an index row per clip — device, start, duration, size, and the
reason it was kept — and never the bytes. A hub runs on a Raspberry Pi with an
SD card or a USB disk; a database holding video is a database that cannot be
backed up, vacuumed or copied by the ordinary means, and a corrupt page takes the
access audit trail with it.

The layout is date-partitioned so that expiry is a directory walk rather than a
query, and so a human can find and delete a day by hand without the product's
help. **That last property is deliberate**: someone who wants footage of
themselves gone should not need this software to cooperate.

### 2.2 Retention is a per-camera duration, and the default is short

Each camera declares `retain_hours`. The **default is 72 hours**, and there is no
"keep forever" setting.

Three days answers the question recording is actually for — *what happened last
night, or over a weekend* — and does not accumulate into a surveillance archive
by inattention. An operator who needs longer sets it per camera and thereby makes
a decision, which is the point: the risky configuration should require an act,
not a default.

A camera with `retain_hours: 0` records nothing. That is how a camera is used for
live view only, and it is the setting a shared household should reach for first.

### 2.3 The disk limit is a floor on free space, not a cap on footage

`min_free_bytes` (default: **10% of the filesystem, or 2 GB, whichever is
larger**) is checked before every write.

When free space falls below it, the oldest clips are deleted until it recovers —
**oldest first across all cameras, not oldest per camera**. A single busy camera
must not be able to evict a quiet one's footage preferentially, because "the
camera that records most" and "the camera that matters most" are unrelated.

If deleting every expired clip still leaves the hub below the floor, **recording
stops and the hub says so loudly**. It does not delete unexpired footage to keep
recording. The alternative — silently dropping the oldest still-wanted clip to
make room for a new one — means the retention setting is a lie under exactly the
conditions where someone will later go looking.

Nothing about this may ever affect the access path. Recording is best-effort and
runs on its own goroutine; a full disk must not delay or fail a gate opening. The
audit database and the recordings directory should ideally be on different
filesystems, and the hub warns at startup when they are not.

### 2.4 Who may watch: a new permission, not an existing role

Viewing footage requires an explicit `camera:view` grant per member. It is **not**
implied by `owner` or `admin`.

This is the one place this document breaks the pattern of the rest of the
product, and it is worth the inconsistency. Everywhere else, admin means "can
configure the thing". Here it would mean "can watch the other residents", and
those are not the same authority. An account owner in a shared house is usually
just whoever set up the hub.

Consequences, stated rather than left implicit:

- A fresh install grants `camera:view` to nobody. Recording without a viewer is
  a valid and reasonable state — the clips exist for an incident.
- Granting it is an admin action and lands in the hash-chained
  `admin_audit_log`, so "who gave themselves the ability to watch, and when" is
  answerable later.
- It can be granted for a **time window**, reusing the machinery
  `internal/store/timewindows.go` already has. An investigation is usually
  bounded and the permission should be too.

### 2.5 Watching is audited, and the subject can see the audit

Every view and every export writes an audit row: who, which camera, which time
range, when.

This is the part most systems skip, and it is the part that makes the rest
defensible. A permission that is checked but not recorded turns "can the owner
watch me?" into a question nobody can answer after the fact.

**Every member of the account can read the camera-access log** — not just admins.
The audit trail for footage is the one log whose subject has the strongest claim
to it, and restricting it to admins would mean the people most affected are the
only ones who cannot check.

The hash chain already covers this: `admin_audit_log` is append-only with
per-row hashing, verifiable off-box against a cold backup. Direct database edits
remain detectable rather than preventable, and that limit is already documented
in the threat model — it does not get weaker for footage, and it does not get
stronger, and the docs must not imply otherwise.

### 2.6 What a resident is told when retention drops the evening they cared about

Nothing, at the time — there is nobody to tell, and a notification for every
expiring clip is noise that trains people to ignore it.

But the index row is **not** deleted with the bytes. A tombstone survives for
30 days after the clip: device, time range, size, and `expired_at`. So the answer
to "was there footage of Tuesday night?" is *"yes, and it expired on Friday under
a 72-hour policy"* rather than silence.

The distinction is the same one `internal/energy` draws between an unmeasured
hour and an hour of zero: **absence with a reason is a different fact from
absence.** A camera page showing an empty Tuesday and a camera page showing
"Tuesday expired under the retention you set" are not the same answer, and only
one of them is honest.

---

## 3. What is deliberately not in this design

- **No cloud upload, no off-box copy, no "secure backup".** Footage leaving the
  hub is a different product with a different threat model. If it is ever built
  it gets its own document, not a flag in this one.
- **No motion detection, no person detection, no analytics.** Deciding what is
  interesting is a much larger claim than recording, and a false negative is a
  camera that did not record the thing it was bought for.
- **No live-view recording-by-default.** Watching a stream must not silently
  start storing it.
- **No sharing links.** A URL that shows footage to whoever holds it defeats
  §2.4 entirely.

---

## 4. What building this actually requires

For the record, since "needs hardware" has been the summary until now. The
hardware is necessary and it is not sufficient:

1. **An RTSP client that receives media** — `SETUP`, `PLAY`, RTP over interleaved
   TCP. The current probe stops at `DESCRIBE` deliberately.
2. **A container writer.** The RTP payload is H.264/H.265 NAL units; a playable
   file needs fMP4 remuxing. No transcoding — that means a codec dependency and
   CPU a Pi does not have.
3. **The retention worker** — expiry sweep, free-space floor, tombstones.
4. **The permission and its audit surface** — §2.4 and §2.5.
5. **A viewer**, which is where fMP4 pays off: a browser can play it without a
   plugin.

Steps 1 and 2 need a real camera. Steps 3, 4 and 5 do not, and could be built and
tested against synthesised files — but building them first would mean shipping a
retention policy for footage that does not exist, which is the wrong order.

---

## 5. Open questions this document does not settle

Listed because pretending a design is complete is how the gaps become someone
else's surprise.

- **Is `camera:view` per-camera or per-account?** Per-camera is obviously more
  correct — a doorbell and a bedroom hallway are not the same permission — and
  obviously more UI. Not decided.
- **What happens to footage when a member is removed?** Their past views stay in
  the audit trail, which is correct. Whether footage *of* them should be
  affected is a question this document cannot answer, because the hub does not
  know who is in a frame and must not start guessing.
- **Legal retention floors.** Some jurisdictions require a minimum retention for
  premises recording and others cap it. A 72-hour default is a product opinion,
  not legal advice, and the docs must never present it as compliance.
- **Multi-hub.** `docs/MULTI-HUB.md` aggregates app-side across hubs. Whether
  footage should appear in that aggregate at all is unexamined.
