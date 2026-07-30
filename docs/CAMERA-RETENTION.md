# Camera recording: the design that had to exist before any of it was built

**Status: built, and never run against a camera.** Those are two different
statements and both matter.

Built means §2's policy is code. `hub/internal/devices/camera/` discovers
cameras, resolves stream addresses, opens an RTSP session — `DESCRIBE`, `SETUP`,
`PLAY`, RTP over interleaved TCP — depacketizes RTP into H.264 NAL units, reports
the encoder's real cropped resolution from the stream's own sequence parameter
set, groups NAL units into access units and muxes them into a fragmented MP4.
`hub/internal/recording/` writes those clips, indexes them, expires them on the
per-camera window, holds the free-space floor, and sweeps files the index does
not know about. `camera:view` is a grant per member per camera, every viewing is
in the hash-chained audit log, and every member of the account can read that log.
There is a clip list that renders its own gaps and an MSE live view.

Never run against a camera means exactly that: **nothing here has received a
frame from real hardware.** Every test drives an in-process RTSP server, and the
fixture payloads are not decodable pictures. A real Chromium `MediaSource`
ACCEPTS the muxer's output — its container parser validates the boxes, the
`avcC` and the SPS — and its decoder never gets a real frame. That distinction is
load-bearing and a streaming test pins it: given time to try, the decoder errors
and the appends after it are refused. So the container is verified against a
third-party demuxer and the *pictures* are verified against nothing.

Two other things this document will not pretend about. The retention arithmetic
deletes real files under rules nobody has exercised on real footage. And live
view is a window behind — the capture loop records a window and then muxes it —
which is recent rather than live, said in the UI to the person watching rather
than left to be discovered while watching a gate.

The ordering below was deliberate and is worth keeping in the record: the muxer
was written before its consumer, because the consumer writes footage to a disk,
and writing footage to a disk before settling the policy is how a product ends up
retaining video it cannot justify keeping.

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

**Expiry works from the index, so something else has to sweep the disk.** Every
query above starts from the clip index, which means a file with no index row is
invisible to all of them. That is not hypothetical: a clip is renamed into place
and *then* indexed, so a crash between those two steps — or an insert that fails
after the rename succeeds — leaves a file nothing would ever reclaim, and so does
a `.part` abandoned mid-write. The retention pass therefore also walks the
recordings tree and deletes files the index does not know about, skipping
anything modified within the last hour so it cannot take a clip that is being
written right now. Without it, the retention setting would be honoured exactly
and the disk would still fill.

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

Kept because "needs hardware" was the summary for a long time, and it was only
half true. The hardware is necessary and it was never sufficient — five things
had to be built, and all five now are:

1. **An RTSP client that receives media** — `SETUP`, `PLAY`, RTP over interleaved
   TCP, RFC 6184 depacketization. `camera/rtsp.go`, `camera/accessunit.go`. The
   probe used to stop at `DESCRIBE`.
2. **A container writer.** The RTP payload is H.264 NAL units; a playable file
   needs fMP4 remuxing. `camera/fmp4.go`, with the SPS parsed in `camera/sps.go`
   so `avcC` and the cropped dimensions come from the stream rather than a guess.
   No transcoding — that means a codec dependency and CPU a Pi does not have.
3. **The retention worker** — expiry sweep, free-space floor, tombstones, and a
   sweep of files the index does not know about, because every other query here
   starts from the index and cannot see them. `internal/recording/`.
4. **The permission and its audit surface** — §2.4 and §2.5.
   `store/cameraview.go`, `httpapi/cameraview.go`.
5. **A viewer**, which is where fMP4 pays off: a browser plays it without a
   plugin. `src/pages/app/Footage.tsx`, `src/components/camera/LiveView.tsx`.

Steps 1 and 2 were said to need a real camera. They were built against an
in-process RTSP server instead, which is why the status at the top of this
document distinguishes built from run: the wire format is exercised and the
hardware is not. Steps 3, 4 and 5 never needed one — but building them first
would have meant shipping a retention policy for footage that did not exist,
which is the wrong order and is the reason this document exists at all.

---

## 5. Open questions this document does not settle

Listed because pretending a design is complete is how the gaps become someone
else's surprise.

- ~~**Is `camera:view` per-camera or per-account?**~~ **Decided: per-camera**, and
  built that way — a grant row per member per camera, with no wildcard, because a
  doorbell and a bedroom hallway are not the same permission. It did cost the
  extra UI this question anticipated.
- **What happens to footage when a member is removed?** Their past views stay in
  the audit trail, which is correct. Whether footage *of* them should be
  affected is a question this document cannot answer, because the hub does not
  know who is in a frame and must not start guessing.
- **Legal retention floors.** Some jurisdictions require a minimum retention for
  premises recording and others cap it. A 72-hour default is a product opinion,
  not legal advice, and the docs must never present it as compliance.
- **Multi-hub.** `docs/MULTI-HUB.md` aggregates app-side across hubs. Whether
  footage should appear in that aggregate at all is unexamined.
