// Data file for scripts/check-feature-claims.mjs — see that file's header for
// the full design rationale and honesty caveats before trusting anything in
// here. This file is just the list of claims; it has no logic of its own.
//
// Each entry is one feature CLAIM as it currently reads in the docs (README's
// status table, ARCHITECTURE.md's §8 roadmap, site/index.html's `.soon`
// badges, or an explicit "Status:" line in a doc). `docStatus` records what
// the docs say TODAY:
//
//   'shipped' — the docs claim this exists and works (no 🔨/soon/"designed,
//               not implemented" marker attached). Evidence MUST be found,
//               or the check fails ("documented feature, zero code" — the
//               2026-07-20 audit's failure mode, nine times over).
//   'planned' — the docs explicitly mark this not-yet-real (🔨, `.soon`,
//               "designed, not implemented", "coming", "not started", a
//               stub/panic notice, etc). Evidence MUST NOT be found, or the
//               check fails the other direction — something shipped and the
//               docs are now stale and undersell it (which is exactly how
//               Slack Socket Mode, Telegram and the Go gateway's product-core
//               status went unnoticed until today).
//
// `evidence` is a list of checks that ALL must pass for the feature to count
// as "implemented" (AND across the list). Each item may itself be an array,
// meaning "at least one of these" (OR within that slot). An item is one of:
//
//   { file, pattern }         — file must exist AND its content must match
//                                the regex `pattern` (source string, 'm' flag).
//   { file, patternAbsent }   — file must exist AND its content must NOT
//                                match `patternAbsent`. Used for "the real
//                                thing replaced the stub" checks (e.g. the
//                                GPIO panic placeholder is gone).
//   { file }                  — file or directory must merely exist.
//   { root, pattern }         — at least one file somewhere under `root`
//                                (walked recursively, skipping the usual
//                                junk — see WALK_EXCLUDES in the checker)
//                                matches `pattern`.
//
// Evidence roots are deliberately restricted to IMPLEMENTATION code —
// hub/, controller/, proto/, src-tauri/ config — never
// src/ (the React portal's UI copy) or site/ (marketing). Scanning UI copy
// for evidence would be circular: it's the exact layer that lies. See the
// checker's header for what that means this tool cannot catch.

export const FEATURES = [
  // ── access as a device kind. Designed in docs/ACCESS-ON-THE-ENGINE.md and
  // then built, one iteration apart. This entry was 'planned' for exactly that
  // gap and it did its job: the driver landed and the check went red until the
  // six documents calling the fold outstanding were corrected.
  //
  // The label is precise about WHAT shipped, because the interesting half is
  // what did not: the driver is READ-ONLY and Execute refuses every verb. Any
  // future edit that lets the engine actuate a gate is a different claim and
  // must not inherit this one.
  {
    id: 'access-on-the-engine',
    label: 'Access points surfaced in the device engine as a seventh kind, READ-ONLY — status-only capability, Execute refuses every verb, actuation stays on the signed Ed25519 path',
    docStatus: 'shipped',
    docRefs: [
      'docs/ACCESS-ON-THE-ENGINE.md — the design, and why actuation deliberately does not move',
      // Quoted so the guard bites on the half that matters. If a future change
      // routes actuation through the engine, this sentence has to go, and the
      // build breaks until somebody decides that deliberately.
      'ARCHITECTURE.md §8 — "ACTUATION still runs as its own stack, deliberately"',
      'site/docs/devices.md — the seven-kinds table',
    ],
    evidence: [
      [{ root: 'hub/internal/devices', pattern: 'func NewAccessDriver|package accessdev' }],
      [{ file: 'hub/cmd/hub/main.go', pattern: 'deviceDriverAccess' }],
      [{ root: 'hub/internal/devices/accessdev', pattern: 'ErrUseSignedPath' }],
    ],
    // Both halves, because the read-only half is the load-bearing one: the
    // driver must exist AND be constructible from the binary AND still refuse.
    // Evidence on the package alone would pass for a driver that had quietly
    // grown an actuation path.
  },
  // ── the controller reporting its configuration back.
  // docs/CONTROLLER-CONFIG-REPORT.md is the design and says "designed, not
  // built" in those words. This holds that line in both directions: nobody can
  // imply the hub can show a controller's live pulse_ms/hold_max, and the day
  // ctl.report lands the check fails until ROADMAP's open item and the console's
  // honest placeholder are updated.
  // Split, because only one half is built and one claim cannot say that
  // honestly. The controller SENDS; the hub does not yet store or show.
  {
    id: 'controller-config-report-sender',
    label: 'The controller signs and sends ctl.report on connect and on resolved-config change, carrying only keys it actually resolves',
    docStatus: 'shipped',
    docRefs: [
      'docs/CONTROLLER-CONFIG-REPORT.md § 6 step 2',
      'proto/commands.md § Configuration report',
    ],
    evidence: [
      [{ root: 'controller/internal/wire', pattern: 'func SignCtlReport' }],
      [{ root: 'controller/internal/command', pattern: 'func ResolvedConfig' }],
      [{ root: 'controller/internal/transport', pattern: 'func \\(r \\*Runner\\) reportConfig' }],
    ],
  },
  {
    id: 'automation-clip-trigger',
    label:
      'A rule can fire when a camera records: trigger kind "clip" (migration 0029), ' +
      'polled against the clip index, creatable and readable in the console',
    docStatus: 'shipped',
    docRefs: ['ROADMAP.md § "A clip was written" now fires a rule'],
    evidence: [
      // The DB half. 0029 widens a CHECK by rebuilding the table, so the claim
      // names the constraint rather than the file: a migration that dropped
      // the vocabulary instead of widening it would still be a file.
      [
        {
          file: 'hub/internal/store/migrations/0029_automation_clip_trigger.sql',
          pattern: "trigger_kind IN \\('schedule','threshold','event','clip'\\)",
        },
      ],
      [{ root: 'hub/internal/store', pattern: 'func \\(s \\*Store\\) NewestClipAt' }],
      [{ root: 'hub/internal/automations', pattern: 'TriggerClip TriggerKind = "clip"' }],
      // The runner half. Without this the kind saves and nothing ever polls it.
      [{ root: 'hub/internal/automations', pattern: 'func \\(rn \\*Runner\\) tickClip' }],
      // Wired at the one construction site, or every clip rule is inert.
      [{ file: 'hub/cmd/hub/main.go', pattern: 'Clips: h.store' }],
      // The console half, both directions: create and render.
      [{ file: 'src/components/automations/RuleEditor.tsx', pattern: "kind: 'clip'" }],
      [{ file: 'src/pages/app/Automations.tsx', pattern: "case 'clip'" }],
    ],
  },
  {
    id: 'controller-config-report-hub-side',
    label: 'The hub verifies, stores (migration 0026) and serves a reported controller configuration at GET /v1/devices/{id}/config-report',
    docStatus: 'shipped',
    docRefs: [
      'docs/CONTROLLER-CONFIG-REPORT.md § 6 step 3',
      'proto/commands.md § Configuration report',
    ],
    evidence: [
      [{ file: 'hub/internal/store/migrations/0026_controller_config_reports.sql' }],
      [{ root: 'hub/internal/store', pattern: 'func \\(s \\*Store\\) SaveConfigReport' }],
      [{ root: 'hub/internal/httpapi', pattern: 'handleControllerConfigReport' }],
      [{ file: 'hub/internal/httpapi/server.go', pattern: 'devices/\\{id\\}/config-report' }],
    ],
  },
  {
    id: 'controller-config-report-console',
    label: 'The console shows what a controller reported, marking firmware defaults as defaults instead of the honest placeholder',
    docStatus: 'shipped',
    docRefs: [
      'docs/CONTROLLER-CONFIG-REPORT.md § 6 step 4',
      'ROADMAP.md — "A controller never reports its configuration back"',
    ],
    // src/ is UI copy and never evidence elsewhere in this file; here the claim
    // IS about the UI. The client CALL alone would not be enough — a route that
    // is fetched and not rendered is the same screen it was — so the component
    // has to distinguish a firmware default too, which is the half of the claim
    // that says "marking firmware defaults as defaults".
    evidence: [
      [{ file: 'src/lib/api.ts', pattern: 'config-report' }],
      [{ file: 'src/components/device/ControllerConfig.tsx', pattern: 'deviceConfigReport' }],
      [{ file: 'src/components/device/ControllerConfig.tsx', pattern: "source === 'default'" }],
    ],
  },
  // ── planned / not implemented — the nine (ten, by plain count) 2026-07-20
  // overclaims, now correctly marked in the docs. This check's job is to
  // make sure nobody re-overclaims them by accident, and to catch the day
  // any of them actually ships (evidence appears → docs must be updated).
  // ── geofence enforcement shipped 2026-07-27: hub/internal/store/
  // geofence.go + migration 0015, enforced inside the LogAccess choke point,
  // with POST/GET/DELETE /v1/accounts/{id}/geofences to manage the rules.
  //
  // DOC DEBT, now CLOSED except for one file. This entry was flipped to
  // 'shipped' when the code landed, and the prose everywhere else still said
  // "designed, not built" — undersell rather than overclaim, but wrong.
  //
  // Corrected since: site/index.html (the ledger), site/docs/getting-started.md
  // and src/pages/docs/GeofenceSafety.tsx, whose banner claimed "there is no
  // geofencing code in the Go hub" while three routes and the open-path check
  // were live. README.md and site/docs/security.md were checked and carry no
  // stale claim. STILL OPEN: ARCHITECTURE.md §8, which is mid-edit under
  // another change and was left alone deliberately rather than edited
  // underneath it.
  //
  // The one thing this copy MUST keep saying, and still does everywhere it was
  // corrected: this is a convenience and not a security control. The position
  // it tests is client-supplied and unverified, so it stops mistakes, not
  // attackers (see hub/internal/store/geofence.go's package comment).
  {
    id: 'geofencing',
    label: 'Geofencing (block opens outside a per-access-point/per-location radius)',
    docStatus: 'shipped',
    docRefs: [
      'hub/internal/store/geofence.go — package comment: what it buys, and what it explicitly does not',
      'hub/internal/store/migrations/0015_geofence.sql — the geofence_rules table',
      'hub/internal/store/openpath.go — the check inside LogAccess, after time windows, before the limit block',
      'src/pages/docs/GeofenceSafety.tsx — "Status: enforced" and why the JSON below it is historical',
      'STILL STALE: ARCHITECTURE.md §8 (left alone — mid-edit under another change)',
    ],
    evidence: [{ root: 'hub/internal', pattern: 'geofenc', flags: 'i' }],
  },
  // ── offline-grant issuance is the 2026-07-20 evening's headline ship: the
  // gateway side is now real, but the third leg (the app holding/presenting
  // a grant) still is not — see proto/grants.md § "Implementation status"
  // for the full three-of-four picture. A single shipped/planned binary
  // entry can't say "some of this is real, some isn't" honestly, so this is
  // split into the two claims the docs now actually make.
  // ── the app half, added 2026-07-27. The LIBRARY had existed for a while and
  // nothing imported it, which is a component being complete and unreachable —
  // the sixth instance of that shape found in this repo. The claim worth
  // tracking is not "the code exists" but "a person can get to it".
  {
    id: 'offline-grant-app-half',
    label: 'The app can request, hold and present an offline grant (a routed screen, not just a library)',
    docStatus: 'shipped',
    docRefs: [
      'README.md § Access control — offline emergency access',
      'site/docs/emergency-access.md',
      'site/docs/screenshots.md § Emergency access',
      // The threat model was missing from this list, and went stale for it: it
      // went on saying the phone half did not exist for days after it shipped,
      // while README stayed correct because README was guarded and it was not.
      // That is the more dangerous direction of drift — telling a reader an
      // emergency path cannot be exercised stops them looking at it — and the
      // document warns against exactly this in its own §8. The quote is what
      // makes the guard bite: reverting the claim breaks the build.
      'docs/THREAT-MODEL.md § 8 — "it requests, holds and presents a grant"',
      // The wire contract is the document a protocol reader reaches for first,
      // and it was the one still calling this unbuilt. Pinned the same way the
      // threat model is, and for the reason the threat model comment gives.
      'proto/grants.md § Implementation status — "The app side is now built too"',
    ],
    // Both halves: the library AND a routed screen that imports it. Evidence on
    // the library alone would have passed for weeks while no user could reach
    // it, which is exactly what happened.
    evidence: [
      { root: 'src/lib/offline', pattern: 'export async function requestGrant|export async function presentAtGate' },
      { file: 'src/pages/app/EmergencyAccess.tsx', pattern: "from '@/lib/offline/service'" },
      { file: 'src/routes.tsx', pattern: 'EmergencyAccess' },
    ],
  },
  {
    id: 'offline-grant-issuance',
    label: 'Gateway-side minting/issuance of offline LAN/BLE grants (POST /v1/offline-grants)',
    docStatus: 'shipped',
    docRefs: [
      "README.md § What's real, and what isn't — offline grants: both the controller side and the hub's issuance side",
      'site/docs/emergency-access.md — hub-side issuance',
      'proto/grants.md § Implementation status — the issuance half of the contract',
      "hub/internal/channels/send.go — the ban-risk warning, and why offline grants are not the fallback for a banned number",
    ],
    // Deliberately narrow: "offline" alone appears constantly in this
    // codebase for unrelated things (the HTTPS long-poll device queue,
    // comments explaining this exact gap). Look for the specific route this
    // half of proto/grants.md would need to land on.
    evidence: [{ root: 'hub/internal', pattern: '"POST /v1/offline-grants"|handleOfflineGrantIssue', flags: 'i' }],
  },
  {
    id: 'offline-grant-revocation-hub',
    label:
      'The hub remembers issued grants (migration 0030), revokes one, and pushes the ' +
      'deny-list to every controller it named — on revocation and on reconnect',
    docStatus: 'shipped',
    docRefs: [
      'docs/GRANT-REVOCATION.md § 6 — "Delivery happens twice"',
      'ROADMAP.md § Grant revocation semantics',
    ],
    evidence: [
      // Remembering is the load-bearing half and the invisible one: a grant the
      // hub never recorded cannot be revoked, and nothing at issue time says so.
      [
        {
          file: 'hub/internal/store/migrations/0030_offline_grants.sql',
          pattern: 'CREATE TABLE offline_grants',
        },
      ],
      [{ file: 'hub/internal/httpapi/offline_grants.go', pattern: 'RecordOfflineGrant' }],
      // Revocation and the counter move together or not at all.
      [{ root: 'hub/internal/store', pattern: 'func \\(s \\*Store\\) RevokeOfflineGrant' }],
      [{ root: 'hub/internal/store', pattern: 'func \\(s \\*Store\\) DenyListForDevice' }],
      // Delivery, both times it happens. Reconnect is the one that makes
      // "converges when the controller next hears from the hub" true.
      [{ file: 'hub/internal/httpapi/offline_grant_revoke.go', pattern: 'signForDevice\\(ctx, "revoke"' }],
      [{ file: 'hub/internal/httpapi/devices.go', pattern: 'pushDenyListOnConnect' }],
      // Reachable from a screen, not just from a route.
      [{ file: 'src/components/access/IssuedGrantsPanel.tsx', pattern: 'offlineGrantRevoke' }],
      [{ file: 'src/pages/app/EmergencyAccess.tsx', pattern: 'IssuedGrantsPanel' }],
      // Proven over REAL binaries, which is the only place the wiring between
      // the two modules is exercised. Every part of this feature is unit-tested
      // in isolation and its one shipped bug lived in the seam between them.
      [{ file: 'e2e/revocation_e2e_test.go', pattern: 'want denied/revoked' }],
    ],
  },
  {
    id: 'signing-key-can-be-encrypted-at-rest',
    label:
      'AQL_DATA_KEY seals gateway_ed25519.seed with AES-256-GCM, and a sealed seed with no ' +
      'key REFUSES to start rather than minting a replacement',
    docStatus: 'shipped',
    docRefs: ['hub/README.md — "Losing the data key is losing the hub\'s identity"'],
    evidence: [
      [{ root: 'hub/internal/sealed', pattern: 'func Seal\\(key, plaintext' }],
      // The refusal is the load-bearing half: without it a sealed seed fails
      // hex-decoding and a caller could reach the generate branch.
      [{ file: 'hub/internal/keys/keys.go', pattern: 'ErrSealedNoKey' }],
      [
        {
          file: 'hub/internal/keys/sealed_test.go',
          pattern: 'TestASealedSeedWithNoDataKeyRefusesRatherThanMinting',
        },
      ],
      [{ file: 'hub/cmd/hub/main.go', pattern: 'keys.WithDataKey' }],
      // And the restore check knows about the loss encryption ADDS.
      [{ file: 'hub/cmd/hub/verifyrestore.go', pattern: 'sealed.IsSealed' }],
      // Proven in a real hub process, with a real controller pinning the key it
      // serves and the identity surviving a restart — the seam unit tests
      // cannot reach, and where an identity change would orphan the fleet.
      [
        {
          file: 'e2e/sealedkey_e2e_test.go',
          pattern: 'TestSealedSigningKey_PairsOpensAndSurvivesARestart',
        },
      ],
      // The session key too, which is the opposite trade: losing it is
      // harmless, leaking it lets anyone mint a session for any user.
      [
        {
          file: 'hub/cmd/hub/jwtsealed_test.go',
          pattern: 'TestASealedJWTSecretWithNoDataKeyRefusesRatherThanRegenerating',
        },
      ],
    ],
  },
  {
    id: 'tamper-harness-refuses-unearned-verdicts',
    label:
      'scripts/tamper.sh distinguishes CAUGHT from NOT CAUGHT from INVALID, so a tamper ' +
      'that never applied cannot read as a working guard',
    docStatus: 'shipped',
    docRefs: ['hub/README.md — "Proving a test can fail"'],
    evidence: [
      [{ file: 'scripts/tamper.sh', pattern: 'INVALID  — the tampered tree does not compile' }],
      // The three invalid cases are the point; a harness that only reported
      // pass/fail would repeat the mistake it exists to prevent.
      [{ file: 'scripts/tamper.sh', pattern: 'the replacement produced an identical file' }],
      [{ file: 'scripts/tamper.sh', pattern: 'the text appears' }],
    ],
  },
  {
    id: 'verify-restore-checks-a-backup-before-it-is-needed',
    label:
      'aql-hub verify-restore reports the unrecoverable losses in a data directory, ' +
      'read-only, before a hub is pointed at it',
    docStatus: 'shipped',
    docRefs: ['hub/README.md — "Checking a backup before you need it"'],
    evidence: [
      [{ file: 'hub/cmd/hub/verifyrestore.go', pattern: 'func runVerifyRestore' }],
      [{ file: 'hub/cmd/hub/main.go', pattern: '"verify-restore"' }],
      // Read-only is the load-bearing part: the directory being checked may be
      // the only copy, so the check must not migrate it.
      [{ root: 'hub/internal/store', pattern: 'func OpenReadOnly' }],
      [
        {
          file: 'hub/cmd/hub/verifyrestore_test.go',
          pattern: 'TestVerifyRestoreUsesTheReadOnlyOpener',
        },
      ],
    ],
  },
  {
    id: 'a-lost-signing-key-refuses-to-start',
    label:
      'A hub with paired controllers refuses to start without its signing key, rather than ' +
      'minting a new identity and orphaning the fleet',
    docStatus: 'shipped',
    docRefs: [
      'docs/THREAT-MODEL.md § 6 — "Losing that seed file is now a refusal to start, not a silent new identity"',
    ],
    evidence: [
      [{ root: 'hub/internal/keys', pattern: 'ErrNoKeyForPairedHub' }],
      // Keyed on paired_at, not on a status value: the first version asked for
      // `status = 'paired'`, which nothing writes, and the unit test agreed
      // with it because the fixture invented the same value.
      [{ file: 'hub/internal/store/pairedcount.go', pattern: 'paired_at IS NOT NULL' }],
      [{ file: 'hub/cmd/hub/main.go', pattern: 'keys.RequireExisting' }],
      // Proven by stopping a real hub, deleting the seed and restarting it.
      [{ file: 'e2e/lostkey_e2e_test.go', pattern: 'RefusesToStartRatherThanOrphanItsFleet' }],
      // The same loss one step in: a rotation recorded with the retained key
      // gone. Not a refusal — controllers that already repaired are fine — but
      // reported, because signForDevice stops consulting pins once
      // HasPrevious() is false and silently signs with the current key.
      [{ file: 'hub/internal/httpapi/keyrotation.go', pattern: 'retained_key_present' }],
      [
        {
          file: 'hub/internal/httpapi/rotationretained_test.go',
          pattern: 'TestRotationStatusReportsAMissingRetainedKey',
        },
      ],
    ],
  },
  {
    id: 'device-secrets-can-live-outside-the-config',
    label:
      'Device credentials may be ${env:NAME} or ${file:/path} references, resolved at all ' +
      'three places one can appear, and an unresolvable reference refuses the whole file',
    docStatus: 'shipped',
    docRefs: ['hub/README.md § Device secrets'],
    evidence: [
      [{ root: 'hub/internal/secretref', pattern: 'func Resolve\\(where, value string\\)' }],
      // The wiring, enumerated by hand at three sites — a resolver nothing
      // calls is the same as no resolver.
      [{ file: 'hub/cmd/hub/main.go', pattern: 'func resolveDeviceSecrets' }],
      [{ file: 'hub/cmd/hub/main.go', pattern: 'secretref.ResolveMap' }],
      // The refusal, which is the security-relevant half: an empty credential
      // is accepted by MQTT brokers and ONVIF cameras alike.
      [
        {
          file: 'hub/cmd/hub/devicesecrets_test.go',
          pattern: 'the hub would connect anonymously',
        },
      ],
      // And the backstop against a FOURTH credential appearing unresolved: the
      // resolver enumerates its sites by hand, so a driver gaining a Password
      // or Token field would silently be the one place a reference is not
      // honoured — and the literal "${env:NAME}" would be sent as the secret.
      [
        {
          file: 'hub/cmd/hub/credentialsurface_test.go',
          pattern: 'these look like credentials and resolveDeviceSecrets does not resolve them',
        },
      ],
    ],
  },
  {
    id: 'hazardous-verbs-need-an-explicit-confirm',
    label:
      'Starting a mower needs confirm: true, and a refused command never reaches the driver',
    docStatus: 'shipped',
    docRefs: ['ROADMAP.md — "Robot control is a control surface, not a status row"'],
    evidence: [
      [{ file: 'hub/internal/httpapi/engine.go', pattern: 'confirm_required' }],
      // The assertion that matters: a 409 that actuated anyway looks identical
      // from the response, so the test reads the driver's call log.
      [
        {
          file: 'hub/internal/httpapi/engineconfirm_test.go',
          pattern: 'the driver received %d calls for a refused command',
        },
      ],
      [{ file: 'src/components/device/engineState.ts', pattern: "'robot.blade-job'" }],
    ],
  },
  {
    id: 'no-telemetry-is-checked-not-asserted',
    label:
      'Every host compiled into the hub and controller binaries is listed with a reason, ' +
      'so the no-telemetry claim fails when a new destination appears',
    docStatus: 'shipped',
    docRefs: ['docs/THREAT-MODEL.md — "The binaries emit no usage data anywhere"'],
    evidence: [
      [{ file: 'src/lib/__tests__/noPhoneHome.test.ts', pattern: 'every hard-coded external host' }],
      // Both directions: an unjustified host fails, and so does an allowlist
      // entry nothing uses — otherwise the list stops being decisions and
      // becomes things somebody once typed.
      [{ file: 'src/lib/__tests__/noPhoneHome.test.ts', pattern: 'every allowed host is still actually used' }],
    ],
  },
  {
    id: 'chat-rails-cannot-reach-forbidden-operations',
    label:
      "Every §3.6 row has a denied symbol, including the four that had none — config, " +
      'repair, offline-grant issuance and rate-limit changes',
    docStatus: 'shipped',
    docRefs: ['docs/CHAT-COMMANDS.md § 3.6 — "FOUR of the rows below had no denied symbol at all"'],
    evidence: [
      // The rows that were uncovered. Named individually because a count would
      // pass while any one of them silently dropped out.
      [{ file: 'hub/internal/httpapi/chatexposure_test.go', pattern: '"SignGrant":' }],
      [{ file: 'hub/internal/httpapi/chatexposure_test.go', pattern: '"handleDeviceConfig":' }],
      [{ file: 'hub/internal/httpapi/chatexposure_test.go', pattern: '"handleKeyRotationStart":' }],
      [{ file: 'hub/internal/httpapi/chatexposure_test.go', pattern: '"handleAdminLimitsPatch":' }],
      [{ file: 'hub/internal/httpapi/chatexposure_test.go', pattern: '"RevokeOfflineGrant":' }],
      // And the narrowness that made them impossible to add.
      [{ file: 'hub/internal/httpapi/chatexposure_test.go', pattern: 'func defines\\(src, sym string\\)' }],
    ],
  },
  {
    id: 'clock-proof-requires-a-successful-ack',
    label:
      'A controller clock proof is recorded only when the ping ack reports success, and ' +
      'the whole path is exercised over real binaries',
    docStatus: 'shipped',
    docRefs: ['hub/README.md § environment settings — AQL_CLOCK_SYNC_INTERVAL'],
    evidence: [
      // The gate. RecordAckIfPing matches on the nonce alone, which is right —
      // it proves the round-trip — but a failed ack is not proof of a clock.
      [{ file: 'hub/internal/httpapi/clocksync.go', pattern: 'result != ackResultOK' }],
      // Both transports, since the design's own argument is that long-poll is
      // the case that needs this most.
      [{ file: 'hub/internal/httpapi/devices.go', pattern: 'recordClockProof\\(ctx' }],
      [{ file: 'hub/internal/httpapi/devices.go', pattern: 'recordClockProof\\(r.Context\\(\\)' }],
      [{ file: 'e2e/clocksync_e2e_test.go', pattern: 'AControllersProofReachesTheHub' }],
    ],
  },
  {
    id: 'go-test-gates-cannot-serve-a-cached-pass',
    label:
      'Every go test gate runs with -count=1, so a change to the shared conformance ' +
      'corpus cannot leave a stale PASS standing',
    docStatus: 'shipped',
    docRefs: ['ARCHITECTURE.md § Conformance vectors'],
    evidence: [
      [{ file: 'scripts/check.sh', pattern: 'hub go test -count=1' }],
      [{ file: '.github/workflows/ci.yml', pattern: 'go test -count=1' }],
      // The guard, which is the half that survives someone tidying the flag
      // away as noise.
      [
        {
          file: 'src/lib/__tests__/testGatesAreFresh.test.ts',
          pattern: 'every go test invocation re-runs instead of trusting the cache',
        },
      ],
    ],
  },
  {
    id: 'event-kinds-say-which-are-sent',
    label:
      'proto/events.md marks which event kinds the reference controller actually sends, ' +
      'and the marking is held against its source in both directions',
    docStatus: 'shipped',
    docRefs: [
      'proto/events.md § Kinds — "five of these are RESERVED"',
    ],
    evidence: [
      [{ file: 'proto/events.md', pattern: 'reserved — no button input exists' }],
      [{ file: 'src/lib/__tests__/eventKinds.test.ts', pattern: 'no kind the table calls reserved is already being emitted' }],
    ],
  },
  {
    id: 'refused-redemptions-are-recorded',
    label:
      'A grant refused at the gate emits a `denied` event naming it — but only when its ' +
      'signature verified, so the bounded audit ring cannot be flooded from outside',
    docStatus: 'shipped',
    docRefs: [
      'proto/events.md § Refused offline redemptions are recorded, and only the attributable ones',
      'proto/grants.md § "a member refused at the gate left\nno trace at all"',
    ],
    evidence: [
      // The id is set only after the signature check. Matched on the field the
      // wire never carries, because that is what makes it local plumbing.
      [{ file: 'controller/internal/grants/grants.go', pattern: 'GrantID string `json:"-"`' }],
      [{ file: 'controller/internal/agent/agent.go', pattern: 'func \\(a \\*Agent\\) OnDenied' }],
      // BOTH transports, wired separately — a hook set on one and forgotten on
      // the other is exactly the shape that ships.
      [{ file: 'controller/internal/lanserver/lanserver.go', pattern: 's.OnDenied\\(res.GrantID' }],
      [{ file: 'controller/internal/blesession/session.go', pattern: 's.OnDenied\\(res.GrantID' }],
      [{ file: 'controller/internal/bleperiph/start_gatts.go', pattern: 'sess.OnDenied = cfg.OnDenied' }],
    ],
  },
  {
    id: 'revocation-per-gate-convergence',
    label:
      'The grants screen says which of a revoked grant\'s gates are actually refusing it, ' +
      'compared against the sequence THAT grant was revoked at (migration 0032)',
    docStatus: 'shipped',
    docRefs: ['docs/GRANT-REVOCATION.md § 5 — "records the sequence each grant\nwas revoked AT"'],
    evidence: [
      [
        {
          file: 'hub/internal/store/migrations/0032_offline_grant_revoked_at.sql',
          pattern: 'CREATE TABLE offline_grant_revoked_at',
        },
      ],
      // Recorded in the same transaction as the revocation, or a gate can never
      // be compared against it.
      [{ file: 'hub/internal/store/offlinegrants.go', pattern: 'INSERT INTO offline_grant_revoked_at' }],
      // The comparison itself. Against the grant's own sequence — comparing
      // with the hub's CURRENT counter is the coarser answer 0032 replaces.
      [{ file: 'hub/internal/store/offlinegrants.go', pattern: 'seq.Int64 >= at' }],
      [{ file: 'hub/internal/httpapi/offline_grant_revoke.go', pattern: 'RevocationConvergence' }],
      [{ file: 'src/components/access/IssuedGrantsPanel.tsx', pattern: 'function GateConvergence' }],
      [{ file: 'src/components/access/IssuedGrantsPanel.tsx', pattern: '<GateConvergence' }],
    ],
  },
  {
    id: 'revocation-applied-not-just-dispatched',
    label:
      'A controller reports which deny-list it is enforcing (ctl.report `revocation`, ' +
      'migration 0031), so "did my revocation land" is answered by the gate, not assumed',
    docStatus: 'shipped',
    docRefs: [
      'proto/commands.md § `revocation` — which deny-list the controller is enforcing',
      'docs/GRANT-REVOCATION.md § 5 — "dispatched is not applied"',
    ],
    evidence: [
      [{ file: 'controller/internal/wire/wire.go', pattern: 'type RevocationState struct' }],
      // The CALL, not the type. `wire.RevocationState` alone is satisfied by
      // `var rev *wire.RevocationState` — a declaration that sends nothing —
      // which is how the first version of this claim passed while the report
      // carried no revocation block at all.
      [{ file: 'controller/internal/transport/runner.go', pattern: 'Entries: len\\(list.Entries\\)' }],
      [
        {
          file: 'hub/internal/store/migrations/0031_controller_revocation_reports.sql',
          pattern: 'CREATE TABLE controller_revocation_reports',
        },
      ],
      // The out-of-order guard: without it a late report shows a gate falling
      // behind a revocation it had already applied.
      [{ root: 'hub/internal/store', pattern: 'excluded.seq >= controller_revocation_reports.seq' }],
      // Likewise: the function existing proves nothing, since a handler that
      // stopped calling it keeps the definition. Matched on the response key
      // being populated from it.
      [{ file: 'hub/internal/httpapi/devices.go', pattern: '"revocation":\\s+revocation' }],
      [{ file: 'src/components/device/ControllerConfig.tsx', pattern: 'function RevocationState' }],
      // The report must fire when the DENY-LIST changes, not only when config
      // does. Without this the hub's view is stale until the controller happens
      // to reconnect, which for a gate on a flaky link could be days — and the
      // whole point is answering "did it land" now.
      [{ file: 'controller/internal/transport/runner.go', pattern: 'configChanged \\|\\| revChanged' }],
      [{ file: 'e2e/revocation_e2e_test.go', pattern: 'ControllerReportsWhatItIsEnforcing' }],
    ],
  },
  {
    id: 'offline-grant-revocation-controller',
    label:
      'The controller half of sub-TTL grant revocation: a `revoke` command caches a ' +
      'monotonically numbered deny-list, consulted at verification step 3a',
    docStatus: 'shipped',
    docRefs: [
      'docs/GRANT-REVOCATION.md',
      'proto/commands.md § Revocation list (`revoke`)',
      // Quoted, because this is the paragraph an operator reads when deciding
      // how urgently to latch lockdown after a firing, and it said the
      // opposite until this landed.
      'proto/grants.md § Revocation vs. in-flight grants — "A per-grant deny-list now exists"',
    ],
    evidence: [
      // The rule the whole thing rests on. Named by its behaviour, not its
      // file: a deny-list without rollback protection is worse than none,
      // because it reads as protection.
      [{ root: 'controller/internal/state', pattern: 'ErrRevocationRollback' }],
      [{ root: 'controller/internal/state', pattern: 'func \\(s \\*Store\\) RevokedAt' }],
      // The verification step, and the Env field that carries it.
      [{ file: 'controller/internal/grants/grants.go', pattern: 'env\\.Revoked\\(g\\.GrantID\\)' }],
      [{ file: 'controller/internal/wire/wire.go', pattern: 'ReasonRevoked' }],
      // Delivery. Without this the list is unreachable and every test above
      // still passes.
      [{ file: 'controller/internal/command/command.go', pattern: 'case "revoke":' }],
      // Bound into the live redemption path, not merely available.
      [{ file: 'controller/internal/agent/agent.go', pattern: 'St\\.RevokedAt' }],
    ],
  },
  {
    id: 'offline-grant-app-client',
    // RE-SCOPED. This used to read "App client that requests, stores and
    // presents an offline grant", which has stopped being the right question:
    // requesting and storing are real and driven end to end in a browser, and
    // presenting over LAN works in the desktop shell and in an http-served
    // browser tab since the controller began allowing its paired hub's origin.
    //
    // What a browser genuinely cannot do is BLE and mDNS. Those need native
    // code, and native code here means src-tauri/ — so that is what this
    // claim now tracks, and it is still correctly 'planned'.
    label: 'Native (Rust/Tauri) support for the parts a browser cannot do — BLE grant presentation and mDNS resolution',
    docStatus: 'planned',
    docRefs: [
      'site/docs/emergency-access.md § Where the app half stands — the per-build table and the BLE limit',
      // Quoted, not paraphrased. This ref named the section and nothing else,
      // so the section went on saying the app side did not exist for as long
      // as it took someone to read it — a bare section name pins nothing.
      // The quote is the half that is still genuinely unbuilt, so it breaks
      // the build in both directions: if BLE ships and the doc is not updated,
      // and if the doc is reverted to calling the whole app side missing.
      'proto/grants.md § Implementation status — "What remains unbuilt is BLE presentation and mDNS resolution"',
    ],
    // src/ is deliberately never an evidence root (see this file's header —
    // it's UI copy, the exact layer that lied nine times already), so this
    // checks the one implementation-code root a native capability could live
    // in: the Rust shell in src-tauri/ (target/ is walked out by
    // WALK_EXCLUDES). Today src-tauri/src/main.rs is a small shell with none
    // of it.
    // Rooted at src-tauri/src, not src-tauri: a bare 'ble' matched a substring
    // of a crate name in Cargo.lock and reported this shipped. Word-bounded
    // for the same reason.
    evidence: [{ root: 'src-tauri/src', pattern: '\\b(ble|gatt|bluetooth|mdns)\\b|_lintel\\._tcp', flags: 'i' }],
  },
  {
    id: 'hardware-failsafe-gpio',
    label: 'A real GPIO relay driver exists behind `-tags gpio` (NOT that it has ever driven hardware — see the note below)',
    docStatus: 'shipped',
    docRefs: [
      "README.md § What's real, and what isn't — the GPIO relay driver, never run against hardware",
    ],
    // WHY THIS IS 'shipped' AND NOT 'hardware-validated': this checker greps.
    // It can see that a driver file exists; it cannot see whether that file has
    // ever moved a relay, and no pattern will ever tell it. Leaving the claim
    // as 'planned' meant a permanent red that trains people to ignore the
    // tool — the worst outcome for a tripwire. So the claim tracks existence,
    // which is checkable, and the hardware caveat lives in the README prose
    // where a person reads it before wiring a motor.
    // Real evidence would be the panic placeholders gone, replaced by an
    // actual gpiochip driver.
    evidence: [{ file: 'controller/internal/relay/gpio.go', patternAbsent: 'panic\\(' }],
  },
  {
    id: 'recurring-time-windows',
    label: 'Recurring per-member/per-location access windows enforced on the ONLINE open path',
    docStatus: 'shipped',
    docRefs: [
      'README.md — online time-window rules no longer listed as a gap',
      'ROADMAP.md — the console-screens-ahead-of-backend list',
    ],
    // The old pattern was /recurring|rrule/ and matched neither the schema nor
    // the code, because the implementation reuses keys.GrantWindow's vocabulary
    // rather than inventing an RFC 5545 one — deliberately, so the product has
    // one window format instead of two. It also tripped on the IDENTIFIER
    // MaxWindowsPerRule ("...erRule..."), which is the kind of accidental match
    // that makes a tripwire look like it works when it does not.
    //
    // Three pieces: the table, the check inside the open-path choke point, and
    // the route that lets an operator create one. A rule nobody can create and
    // a check nothing calls are both just code.
    evidence: [
      { file: 'hub/internal/store/migrations/0014_time_windows.sql', pattern: 'CREATE TABLE time_window_rules' },
      { file: 'hub/internal/store/openpath.go', pattern: 'CheckTimeWindows' },
      { file: 'hub/internal/httpapi/server.go', pattern: 'time-windows' },
    ],
  },
  {
    id: 'discord-channel',
    label: 'Discord as a working chat channel — registered, env-configured, reaching the shared open path',
    docStatus: 'shipped',
    docRefs: [
      'site/docs/channels.md — the channel table lists Discord as shipped',
    ],
    // Three separate things, because "the file exists" was never the claim: the
    // adapter, the env read that lets an operator turn it on, and the
    // registration without which no message reaches a gate.
    evidence: [
      { root: 'hub/internal/channels', pattern: 'KindDiscord', flags: 'i' },
      { file: 'hub/internal/channels/channels.go', pattern: 'DISCORD_BOT_TOKEN' },
      { file: 'hub/internal/httpapi/server.go', pattern: 's\\.wireDiscord\\(\\)' },
    ],
  },
  {
    id: 'tauri-mobile',
    label: 'Tauri iOS/Android app targets',
    docStatus: 'planned',
    docRefs: [
      'README.md § Develop — the shell ships desktop only; iOS/Android are the target',
    ],
    // A generated mobile target leaves `gen/apple` or `gen/android` behind
    // (`tauri ios init` / `tauri android init`); today gen/ only has the
    // desktop schemas.
    // expectMissing: these are GENERATED by `tauri android init` / `ios init`.
    // Their absence is the evidence, not a broken path — see checkItem.
    evidence: [[
      { file: 'src-tauri/gen/apple', expectMissing: true },
      { file: 'src-tauri/gen/android', expectMissing: true },
    ]],
  },
  {
    id: 'outbound-webhooks',
    label: 'Outbound webhooks — HMAC-signed delivery of access events, with SSRF re-validation at send time',
    docStatus: 'shipped',
    docRefs: ['README.md — listed among the things that are no longer gaps'],
    // Four separate pieces, because any one of them going missing turns this
    // from a feature into a liability: the schema, the route that creates one,
    // the signing, and the emit that makes it fire at all. A webhook system
    // with no emit is inert; one with no signature is unauthenticated; one
    // with no SSRF check is a request-forgery primitive.
    evidence: [
      { file: 'hub/internal/store/migrations/0013_webhooks.sql', pattern: 'CREATE TABLE webhooks' },
      { file: 'hub/internal/httpapi/server.go', pattern: 'POST /v1/accounts/\\{id\\}/webhooks' },
      { file: 'hub/internal/httpapi/webhookdispatch.go', pattern: 'func signWebhook' },
      { file: 'hub/internal/httpapi/channels_open.go', pattern: 'emitAccessWebhook' },
    ],
  },
  {
    id: 'gateway-analytics',
    // Shipped. Read-only over the hash-chained audit rows: three endpoints,
    // account-scoped, 90-day cap, and a day with no rows carries JSON null
    // rather than a zero that would be drawn as a bar.
    label: 'Analytics endpoints in the Go gateway (backend/ Workers reference still has these; gateway defers them)',
    docStatus: 'shipped',
    docRefs: [
      "README.md § What's real, and what isn't",
      'site/docs/self-host.md — deferred surfaces',
    ],
    evidence: [{ root: 'hub/internal', pattern: '/v1/analytics|handleAnalytics', flags: 'i' }],
  },
  {
    id: '2fa',
    label: 'Two-factor authentication (TOTP), opt-in per user, with single-use recovery codes',
    docStatus: 'shipped',
    docRefs: [
      'ROADMAP.md — listed as done',
      'ARCHITECTURE.md §9 — the residual: losing both the password and the recovery codes',
      'site/docs/troubleshooting.md, site/docs/faq.md',
    ],
    // Three pieces. A secret with no activation gate locks people out of their
    // own hub; recovery codes minted anywhere but activation mean 2FA can be on
    // with no escape hatch. Both are worse than no 2FA.
    evidence: [
      { file: 'hub/internal/store/migrations/0016_two_factor.sql', pattern: 'CREATE TABLE user_totp' },
      { file: 'hub/internal/httpapi/server.go', pattern: '2fa/activate' },
      { file: 'hub/internal/store/twofactor.go', pattern: 'ClaimSecondFactorAndIssueRefresh' },
    ],
  },
  {
    id: 'csv-export',
    label: 'CSV export of the audit log',
    docStatus: 'planned',
    docRefs: ['No current README/ARCHITECTURE/site claim ships this; verified absent to guard against re-introduction.'],
    evidence: [[
      { root: 'hub/internal', pattern: 'text/csv|ExportCSV|\\.csv"', flags: 'i' },
    ]],
  },

  // ── Aql-wide product claims, added by the 2026-07-26 positioning
  // correction. Aql is a command centre for the physical world whose device
  // model has SEVEN kinds — camera, lighting, robot, climate, energy, sensor
  // and access — and exactly one of them (access) is real end to end. The
  // README, ROADMAP, ARCHITECTURE §8 and site/docs/devices.md now say that
  // in those words, which makes "no device engine exists" a load-bearing
  // documented claim rather than an omission. These entries hold that line
  // in both directions: nobody can quietly re-imply the engine ships, and
  // the day any of it actually lands the check fails until the docs catch
  // up. Evidence roots stay on implementation code only (never src/, which
  // is UI copy — see this file's header). The console's demo dataset, which
  // used to live at src/lib/demoData.ts and was deliberately not evidence of
  // anything, has been deleted: every device row now comes from the engine.
  {
    id: 'device-engine-drivers',
    label: 'Device-engine code naming a device protocol exists (NOT that any protocol driver talks to a real device network)',
    docStatus: 'shipped',
    docRefs: [
'README.md § Real protocol drivers — MQTT (Zigbee/Z-Wave via bridge), Modbus TCP, ONVIF, generic HTTP',
      'ARCHITECTURE.md §8 The device engine — built, default off, four drivers named',
      'site/docs/devices.md — the per-kind status table and the driver table',
    ],
    // "Matter" is deliberately absent from the pattern: it is an ordinary
    // English word and matches prose all over this codebase. The other five
    // protocol names are unambiguous, and no plausible Matter driver lands
    // without at least one of them landing too.
    evidence: [[
      { root: 'hub/internal', pattern: 'MQTT|Zigbee|ONVIF|Modbus|Z-?Wave', flags: 'i' },
      { root: 'controller/internal', pattern: 'MQTT|Zigbee|ONVIF|Modbus|Z-?Wave', flags: 'i' },
      { root: 'src-tauri/src', pattern: 'MQTT|Zigbee|ONVIF|Modbus|Z-?Wave', flags: 'i' },
    ]],
  },
  {
    id: 'automations-runtime',
    label: 'Automations runtime (a real trigger → condition → action engine over device state)',
    docStatus: 'shipped',
    docRefs: [
      'README.md § Automations running against real devices',
      'ROADMAP.md Phase 3',
      'site/docs/devices.md § Automations — trigger/condition/action, MaxActionTier ceiling',
      'site/docs/architecture.md § What the open path actually is — the rule object exists but is kept OUT of the open path',
      // Added after THREAT-MODEL.md was found claiming the exact opposite —
      // "there is no endpoint to create a rule", when eight account-scoped
      // routes ship including a synchronous /run. That is the dangerous
      // direction of drift: it tells a reviewer there is no surface to examine
      // where there is an actuation endpoint. Guarded by quote so it cannot
      // silently revert.
      'docs/THREAT-MODEL.md § 8 — "which fires a rule"',
    ],
    // Deliberately narrow. A loose /schedul|cron/ matches the controller's
    // scheduleRelease() relay timer, which is not an automations engine.
    evidence: [[
      { root: 'hub/internal', pattern: 'AutomationRule|RuleEngine|automations_|type Automation\\b|EvaluateRule', flags: 'i' },
      { root: 'controller/internal', pattern: 'AutomationRule|RuleEngine|automations_|type Automation\\b|EvaluateRule', flags: 'i' },
    ]],
  },
  {
    id: 'energy-metering',
    // The caveat here used to read "nothing constructs a poller in cmd/hub".
    // That stopped being true when wireEnergy landed: cmd/hub builds an
    // energy.NewPoller and runs it as a worker. It is still OFF by default —
    // -energy-account/AQL_ENERGY_ACCOUNT_ID must name an account that exists,
    // and it refuses to start without a device driver — but "off unless
    // configured" and "cannot happen" are different claims, and this manifest
    // exists precisely to stop documents blurring them.
    label: 'Energy-metering engine code exists, and cmd/hub wires a poller that is off unless -energy-account is set (NOT that any physical meter has been read)',
    docStatus: 'shipped',
    docRefs: [
"README.md § Energy metering that won\'t flatter you",
      'ROADMAP.md Phase 4',
      'site/docs/devices.md § Energy — built, read-only, untested against physical meters',
    ],
    evidence: [[
      { root: 'hub/internal', pattern: 'MeterReading|kWh|inverter|EnergyReading|solar', flags: 'i' },
      { root: 'controller/internal', pattern: 'MeterReading|kWh|inverter|EnergyReading|solar', flags: 'i' },
    ]],
  },
  {
    id: 'camera-pipeline',
    // This label read "NOT live view, NOT recording — there is no RTSP client
    // and no pixel ever moves" for a while AFTER all three shipped. The docs it
    // points at were corrected; this was the last copy of the falsehood, which
    // is a fair illustration of why the 'planned' guards below exist.
    label: 'ONVIF discovery, an RTSP client that receives media, RTP→H.264 depacketization, fMP4 muxing, recording with retention, and MSE live view',
    docStatus: 'shipped',
    docRefs: [
      "README.md § What's real, and what isn't — the camera pipeline",
      'ROADMAP.md Phase 5',
      'docs/CAMERA-RETENTION.md § 4',
      'site/docs/devices.md § Cameras',
    ],
    // One clause per stage, so the claim cannot survive any single stage being
    // deleted. A single `rtsp|onvif` pattern passed on the discovery code alone
    // and would have gone on passing with the whole media path removed.
    evidence: [
      [{ root: 'hub/internal/devices/camera', pattern: 'func ConsumeMedia' }],
      [{ root: 'hub/internal/devices/camera', pattern: 'func ParseSPS' }],
      [{ root: 'hub/internal/devices/camera', pattern: 'func NewFragmenter' }],
      [{ root: 'hub/internal/recording', pattern: 'func \\(r \\*Recorder\\) WriteClip' }],
      [{ root: 'hub/internal/recording', pattern: 'func \\(r \\*Recorder\\) ReclaimOrphans' }],
      [{ root: 'src/components/camera', pattern: 'addSourceBuffer' }],
    ],
  },
  // ── claims that something is NOT built ────────────────────────────────
  //
  // These use docStatus 'planned', which INVERTS the check: the evidence must
  // NOT be found, and the build fails the day it appears. That is the guard
  // for the direction this repository actually keeps failing in — a document
  // saying a thing is unbuilt after it shipped, which tells a reader not to
  // look at live code.
  //
  // It has happened repeatedly and expensively. ROADMAP called a complete
  // Linux GPIO driver "a stub whose Pulse/Hold/Release all panic"; rtsp.go's
  // header said "No SETUP, no PLAY, no RTP" four hundred lines above code
  // doing all three; devices.md said live view and recording were "still not
  // built" after both shipped. The last one was read by an agent, believed
  // over the code, and rewritten onto the marketing page as fact.
  //
  // Each entry below guards a claim the docs make in several places at once,
  // so building the feature fails the build until every one is updated.
  //
  // Evidence patterns are deliberately implementation-shaped, not word-shaped:
  // an earlier attempt at the Modbus RTU entry matched the comment in
  // modbus/doc.go that EXPLAINS its absence, which would have failed the guard
  // on day one and taught everyone to disable it.
  {
    id: 'matter-driver',
    label: 'A Matter/CHIP driver — claimed unbuilt in ten documents',
    docStatus: 'planned',
    docRefs: [
      'README.md — "Matter, Modbus RTU, native Zigbee and Z-Wave radios"',
      'ROADMAP.md Phase 1',
      'site/docs/devices.md',
      'site/docs/faq.md — "No Matter and no robot driver"',
    ],
    evidence: [[
      { root: 'hub/internal/devices', pattern: 'package matter|chip-tool|matter-sdk|MatterDriver' },
      { file: 'hub/go.mod', pattern: 'matter|project-chip', flags: 'i' },
    ]],
  },
  {
    id: 'modbus-rtu-serial',
    label: 'Modbus RTU over a serial line — the driver is TCP only, deliberately',
    docStatus: 'planned',
    docRefs: [
      'README.md — the unbuilt list',
      'site/docs/devices.md — Modbus is TCP only',
    ],
    // A serial DEPENDENCY, not the letters "RTU": modbus/doc.go says "NOT
    // Modbus RTU or ASCII over a serial line", and a word-shaped pattern would
    // match the sentence disclaiming the feature.
    evidence: [[{ file: 'hub/go.mod', pattern: 'go\\.bug\\.st/serial|tarm/serial|serial-port' }]],
  },
  {
    id: 'robot-driver',
    label: 'A robot driver — robots are a device kind with no driver behind them',
    docStatus: 'planned',
    docRefs: [
      'ROADMAP.md Phase 5 — robot control beyond a static status row',
      'site/docs/devices.md',
      'site/index.html — the ledger marks robots not built',
    ],
    evidence: [[
      { root: 'hub/internal/devices', pattern: 'package robot|RobotDriver|robot\\.New\\(' },
    ]],
  },
  {
    id: 'google-oauth-signin',
    label: 'Google OAuth sign-in — a console screen exists, no backend does',
    docStatus: 'planned',
    docRefs: [
      'ROADMAP.md — console screens ahead of their backend',
    ],
    // Routes rather than the word: AuthCallback.tsx exists on the frontend and
    // auth.go has a comment calling OAuth deferred, so a text search finds
    // both and proves neither.
    evidence: [[
      { file: 'hub/internal/httpapi/server.go', pattern: '"(GET|POST) /v1/[^"]*oauth' },
    ]],
  },
  {
    id: 'keychain-credential-vault',
    label:
      'No OS-keychain integration exists, and none is planned — a container has no keychain, ' +
      'and the binary is CGO_ENABLED=0. Device secrets use ${env:}/${file:} instead',
    docStatus: 'planned',
    docRefs: [
      'ROADMAP.md — "withdrawn as specified, and the reason is the deployment"',
      'hub/README.md § Device secrets',
      // The security document is where a reader goes to learn the posture, and
      // it went stale the moment the plan changed — it still described the
      // keychain as the intended destination after the decision to drop it.
      // Quoted so reverting the text, or the decision, breaks the build.
      'docs/THREAT-MODEL.md § 6 — "That is withdrawn, on grounds of deployment rather than taste"',
    ],
    // Matched on CODE, not the word. The previous pattern was a bare
    // `keychain|keyring|…` over whole files, and it fired the moment a package
    // comment EXPLAINED why there is no keychain — a guard that reads prose,
    // which is the failure this repo has hit three times now in other tests.
    // An import path or a qualified call is a thing only real usage produces.
    evidence: [
      { root: 'hub/internal', pattern: '"github\\.com/[^"]*key(chain|ring)|keyring\\.[A-Z]|keychain\\.[A-Z]' },
      { root: 'controller/internal', pattern: '"github\\.com/[^"]*key(chain|ring)|keyring\\.[A-Z]|keychain\\.[A-Z]' },
      { root: 'src-tauri/src', pattern: 'keyring::|keychain::' },
    ],
  },
  {
    id: 'ble-peripheral-off-linux',
    // RE-SCOPED, because the old label ("any platform other than Linux/BlueZ")
    // had stopped being true: Windows/WinRT shipped when start_ble_linux.go
    // was renamed to start_gatts.go and its build tag widened. Nothing
    // noticed, because the evidence named start_stub.go — a file that has
    // never existed — and for a 'planned' claim a missing path is
    // indistinguishable from a genuine absence. checkItem now treats an
    // unmarked missing path as a broken manifest for exactly this reason.
    label: 'BLE GATT peripheral backing on darwin (Linux/BlueZ and Windows/WinRT both ship)',
    docStatus: 'planned',
    docRefs: [
      'controller/README.md — the BLE radio row',
      'ROADMAP.md Finishing Phase 0 — BLE radio validation',
      'site/docs/controllers.md — the BLE peripheral bullet',
    ],
    // Hardware validation is not regex-checkable — "has this run on a real
    // radio" is a human fact. The structural claim is: no darwin backing.
    //
    // It is blocked upstream rather than here. tinygo.org/x/bluetooth v0.15.0
    // ships gatts_linux.go and gatts_windows.go; every other platform gets
    // gatts_other.go, nine lines declaring a Characteristic type and no GATT
    // server at all, and gap_darwin.go has no Advertisement methods. macOS is
    // supported as a BLE central, not a peripheral. So a darwin backend needs
    // the library to grow one (or CoreBluetooth via cgo here).
    //
    // The evidence is therefore the build constraint: the day start_gatts.go
    // names darwin, a backend landed and the docs must catch up.
    evidence: [{ file: 'controller/internal/bleperiph/start_gatts.go', pattern: 'darwin' }],
  },

  // ── shipped — genuinely real today. Encoded so a regression (someone
  // rips the code out but the docs keep bragging) fails loudly, same as a
  // false "shipped" claim would.
  {
    id: 'ed25519-signed-commands',
    label: 'Ed25519-signed device commands',
    docStatus: 'shipped',
    docRefs: ['README.md § Safety — Ed25519 over canonical JSON (JCS, RFC 8785)'],
    evidence: [{ file: 'hub/internal/keys/keys.go', pattern: 'ed25519\\.Sign\\(' }],
  },
  {
    id: 'controller-key-pinning',
    label: 'Controller pins its paired gateway\'s public key',
    docStatus: 'shipped',
    docRefs: ['README.md dev table — controller row: "key pinning"', 'controller/internal/state/state.go'],
    evidence: [{ file: 'controller/internal/state/state.go', pattern: 'ErrKeyChangeRefused' }],
  },
  {
    id: 'claim-token-pairing',
    label: 'Claim-token controller pairing',
    docStatus: 'shipped',
    docRefs: ['README.md § Pair a controller'],
    evidence: [{ file: 'hub/internal/store/devices.go', pattern: 'claim_token_hash' }],
  },
  {
    id: 'append-only-audit-log',
    label: 'Append-only audit log',
    docStatus: 'shipped',
    docRefs: ['README.md § Safety — the audit log'],
    evidence: [{ file: 'hub/internal/store/admin.go', pattern: 'admin_audit_log' }],
  },
  {
    // The controller's own version of the retention gap. Queue.Compact was
    // written, tested, and called by nothing, so the durable event log grew
    // forever on the device with the least storage in the system.
    id: 'controller-queue-compaction',
    label: 'The controller reclaims its durable event log — at startup, and once enough entries are acked',
    docStatus: 'shipped',
    docRefs: ['proto/events.md § Delivery'],
    evidence: [
      { file: 'controller/internal/events/queue.go', pattern: 'func \\(q \\*Queue\\) CompactIfNeeded' },
      // Wired, not merely offered: the drain path calls it, and Open reclaims
      // the previous run.
      { file: 'controller/internal/transport/runner.go', pattern: 'CompactIfNeeded' },
      { file: 'controller/internal/events/queue.go', pattern: 'q\\.compactLocked\\(\\)' },
    ],
  },
  {
    // "Nothing is retried" holds within a run, and the scheduler calls Fire
    // again on the next occurrence. The only thing between an unknown outcome
    // and a second actuation is LastFiredAt being stamped, because the cooldown
    // is gated on it — a coupling that looks like an oddity and is the design.
    id: 'indeterminate-starts-the-cooldown',
    label: 'An indeterminate actuation starts the cooldown, so an unconfirmed action is not repeated on the next tick',
    docStatus: 'shipped',
    docRefs: ['hub/internal/automations/automations.go — "retrying an unknown physical outcome is how a gate gets opened twice"'],
    evidence: [
      { file: 'hub/internal/automations/automations_test.go', pattern: 'TestAnIndeterminateActuationStartsTheCooldown' },
      { file: 'hub/internal/automations/engine.go', pattern: 'case OutcomeFailed, OutcomeIndeterminate:' },
    ],
  },
  {
    // Discovery decodes ONE bridge format. Listing a second known bridge as
    // "silent" told an operator to debug a bridge that was working fine.
    id: 'bridge-discovery-scope-honest',
    label: 'Discovery decodes zigbee2mqtt only, and reports other known bridges as unreadable rather than silent',
    docStatus: 'shipped',
    docRefs: ['site/docs/devices.md — "Discovery reads zigbee2mqtt only"'],
    evidence: [
      { file: 'hub/internal/devices/mqtt/discover.go', pattern: 'parseableBridges' },
      { file: 'hub/internal/devices/mqtt/discover.go', pattern: 'BridgesUnreadable' },
      { file: 'hub/internal/devices/mqtt/discover_test.go', pattern: 'TestTheThreeAnswersADiscoveryPassCanGive' },
    ],
  },
  {
    // The one wiring in the GPIO driver no CI machine can exercise: the
    // setCloexec call sits behind an ioctl that needs a real gpiochip. The
    // function is proven by a hardware-free test; the CALL was not.
    id: 'gpio-line-fd-cloexec-wired',
    label: 'The GPIO line fd is marked close-on-exec at its request site, and a failure closes the line',
    docStatus: 'shipped',
    docRefs: ['controller/internal/relay/gpio.go — "the only cleanup path that cannot be skipped"'],
    evidence: [
      { file: 'controller/internal/relay/gpio_wiring_test.go', pattern: 'TestEveryLineFdIsMarkedCloseOnExec' },
      { file: 'controller/internal/relay/gpio_linux.go', pattern: 'setCloexec\\(l\\.fd\\)' },
      { file: 'controller/internal/relay/gpio_linux_test.go', pattern: 'TestSetCloexecReallySetsTheFlag' },
    ],
  },
  {
    // A REAL DEFECT, not an unguarded truth. Store's doc promised an
    // unconditional rollback on a failed persist; the snapshot was shallow, so
    // the one field mutated through a pointer — the pinned gateway key — was
    // the one thing it did not restore.
    id: 'state-rollback-is-deep',
    label: 'A failed state persist rolls back every field, including the pinned key mutated through a pointer',
    docStatus: 'shipped',
    docRefs: ['controller/internal/state/state.go — "the in-memory state is rolled back"'],
    evidence: [
      { file: 'controller/internal/state/pinning_test.go', pattern: 'TestAFailedPersistRollsBackEveryField' },
      { file: 'controller/internal/state/state.go', pattern: 'prevPairing' },
    ],
  },
  {
    // The store fails closed and its own tests prove it. Nothing proved the
    // WIRING: that the command path acts on the error rather than logging it.
    // A nonce that is not on disk is a command that replays after a power cut.
    id: 'unrecordable-nonce-never-actuates',
    label: 'A command whose nonce cannot be durably recorded is denied and the relay never moves',
    docStatus: 'shipped',
    docRefs: ['controller/internal/noncestore/noncestore.go — "cannot be durably recorded is treated as unusable"'],
    evidence: [
      { file: 'controller/internal/command/command_vectors_test.go', pattern: 'TestACommandWhoseNonceCannotBePersistedNeverActuates' },
      { file: 'controller/internal/command/command.go', pattern: 'ctx\\.Nonces\\.MarkIfUnseen\\(' },
      // The atomic form specifically. Mark() alone still exists and is still
      // correct, but verification must use the check-and-record: across two lock
      // acquisitions two verifications of one envelope both pass and both actuate.
      { file: 'controller/internal/noncestore/noncestore.go', pattern: 'func \\(s \\*Store\\) MarkIfUnseen' },
    ],
  },
  {
    // The highest-stakes structural claim in the repo: whoever holds the pinned
    // gateway key can sign a command that opens the gate, so the set of paths
    // that can WRITE it is the whole trust model.
    id: 'gateway-key-pinning-doors',
    label: 'Exactly two code paths can write the controller\'s pinned gateway key, and re-pairing with a different key is refused',
    docStatus: 'shipped',
    docRefs: ['controller/internal/pairing/pairing.go — "the ONLY moment a gateway key is accepted"'],
    evidence: [
      { file: 'controller/internal/state/pinning_test.go', pattern: 'TestOnlyTwoDoorsWriteThePinnedGatewayKey' },
      { file: 'controller/internal/state/pinning_test.go', pattern: 'TestRePairingWithADifferentKeyIsRefused' },
      { file: 'controller/internal/state/state.go', pattern: 'ErrKeyChangeRefused' },
    ],
  },
  {
    // The TOTP secret is the entire second factor: anything that reads it can
    // mint valid codes indefinitely, and there is nothing a user would notice
    // being rotated. twofactor.go bounds its blast radius with three shape
    // claims; nothing held them.
    id: 'totp-secret-blast-radius',
    label: 'Exactly one query reads the TOTP secret, and the status projection structurally cannot carry it',
    docStatus: 'shipped',
    docRefs: ['hub/internal/store/twofactor.go — "the only query in the codebase that selects user_totp.secret"'],
    evidence: [
      { file: 'hub/internal/store/totp_secret_test.go', pattern: 'TestOnlyOneQuerySelectsTheTOTPSecret' },
      { file: 'hub/internal/store/totp_secret_test.go', pattern: 'TestTheStatusProjectionCannotCarryTheSecret' },
      // The shape itself: the projection has no secret field.
      { file: 'hub/internal/store/twofactor.go', pattern: 'type TOTPStatus struct' },
    ],
  },
  {
    // "structurally read-only" rested on an allowlist whose central assertion —
    // that every capability in it offers only TierRead verbs — nothing checked.
    // The comment named a test for it that did not exist.
    id: 'modbus-read-only-verified',
    label: 'The Modbus driver verifies its read-only claim against the catalogue at config time, rather than trusting an allowlist',
    docStatus: 'shipped',
    docRefs: ['hub/internal/devices/modbus/config.go — "makes this driver structurally read-only"'],
    evidence: [
      { file: 'hub/internal/devices/capability.go', pattern: 'func VerbsOf' },
      { file: 'hub/internal/devices/modbus/config.go', pattern: 'devices\\.VerbsOf\\(c\\)' },
      { file: 'hub/internal/devices/modbus/driver_test.go', pattern: 'func TestReadOnlyCaps' },
    ],
  },
  {
    // server.go claims EXHAUSTIVELY that four routes are the only ones an API
    // token can reach. The existing token tests probe a hand-listed sample, so
    // a NEW tokenScoped route would be invisible to all of them.
    id: 'api-token-surface-pinned',
    label: 'The set of API-token-reachable routes is pinned, and a read scope can never guard a mutation',
    docStatus: 'shipped',
    docRefs: ['hub/internal/httpapi/server.go — "are the ONLY ones an API token can reach"'],
    evidence: [
      { file: 'hub/internal/httpapi/tokenroutes_test.go', pattern: 'TestOnlyTheDeclaredRoutesAreReachableByAnAPIToken' },
      { file: 'hub/internal/httpapi/tokenroutes_test.go', pattern: 'TestAReadScopeNeverGuardsAMutation' },
    ],
  },
  {
    // The automations package doc's safety story is an IMPORT-BOUNDARY claim,
    // and imports rot silently: the package would still compile, its tests
    // would still pass, and the sentence would simply be false.
    id: 'rule-engine-boundaries-held',
    label: 'The unattended rule engine structurally cannot reach the store, serve HTTP, or widen its audit seam',
    docStatus: 'shipped',
    docRefs: ['hub/internal/automations/automations.go — "structurally cannot write to an audit table itself"'],
    evidence: [
      { file: 'hub/internal/automations/boundaries_test.go', pattern: 'TestTheRuleEngineCannotReachTheStoreOrServeHTTP' },
      { file: 'hub/internal/automations/boundaries_test.go', pattern: 'TestTheNarrowSeamsStayNarrow' },
      // The boundary itself: no store import in the package's own sources.
      { file: 'hub/internal/automations/automations.go', patternAbsent: 'hub/internal/store' },
    ],
  },
  {
    // §1.4's not_implemented, at the layer that exists today. The Port itself is
    // still unbuilt; this is its reply half, and it has a caller on all four
    // rails — a seam with no consumer would have been the sixth "built and
    // unreachable" in this repo.
    id: 'chat-says-what-it-cannot-do',
    label: 'A chat message naming a verb chat cannot serve is answered plainly, not with a gate menu',
    docStatus: 'shipped',
    docRefs: ['docs/CHAT-COMMANDS.md § 1.4 — "The reply half of `not_implemented` now exists"'],
    evidence: [
      { file: 'hub/internal/channels/unsupported.go', pattern: 'func UnsupportedVerb' },
      // Wired on every rail, not merely defined.
      { file: 'hub/internal/httpapi/channels_whatsapp.go', pattern: 'UnsupportedVerb' },
      { file: 'hub/internal/httpapi/channels_telegram.go', pattern: 'UnsupportedVerb' },
      { file: 'hub/internal/httpapi/channels_slack.go', pattern: 'UnsupportedVerb' },
      { file: 'hub/internal/httpapi/channels_discord.go', pattern: 'UnsupportedVerb' },
    ],
  },
  {
    // docs/CHAT-COMMANDS.md §2.2 lists four defects in the chat targeting path
    // and now annotates each FIXED. This pins the safety-relevant one so the
    // annotation cannot become a lie: an ambiguous message must actuate
    // NOTHING. First-match-wins was a fail-open on ambiguity in the one path
    // that opens gates.
    id: 'chat-ambiguity-fail-closed',
    label: 'An ambiguous chat message opens nothing and asks, rather than acting on the first name that matched',
    docStatus: 'shipped',
    docRefs: ['docs/CHAT-COMMANDS.md § 2.2 (a) — "FIXED"'],
    evidence: [
      { file: 'hub/internal/channels/whatsapp.go', pattern: 'func FindMentionedGate' },
      { file: 'hub/internal/channels/whatsapp.go', pattern: 'PushAmbiguousGateMenu' },
      // The cap and the notice, so a truncated picker cannot go back to lying.
      { file: 'hub/internal/channels/channels.go', pattern: 'PickerCapacity = ' },
      { file: 'hub/internal/channels/reply.go', pattern: 'func TruncationNotice' },
    ],
  },
  {
    // Added after docs/CHAT-COMMANDS.md was found quoting `TextGateVerb` with
    // two branches and the open-path guard as a two-command test, when both
    // carry `hold` — the most permissive verb on the rail, since it leaves a
    // gate standing open until the controller's hold_max. A security document
    // whose job is bounding what a chat message can do to a gate was
    // describing a narrower surface than the code had, and its own §2.2(d)
    // note contradicted it two hundred lines later. Quoted spans, so a revert
    // fails the build rather than waiting for the next audit.
    id: 'chat-rail-carries-hold',
    label: 'The chat rail can resolve `hold`, and the open-path choke point accepts open/hold/close',
    docStatus: 'shipped',
    docRefs: [
      'docs/CHAT-COMMANDS.md § 1.1 — "is the one to notice"',
      'docs/CHAT-COMMANDS.md § 1.3 — "the three the choke point accepts"',
    ],
    evidence: [
      { file: 'hub/internal/channels/verb.go', pattern: 'return VerbHold, true' },
      { file: 'hub/internal/store/openpath.go', pattern: 'func opensTheWay' },
    ],
  },
  {
    // ROADMAP called the GPIO relay driver "a `-tags gpio` stub whose
    // Pulse/Hold/Release all panic by design" for long enough that it was
    // repeatedly cited as unbuilt work. There is no panic anywhere in the
    // package: it is a complete Linux GPIO character-device (uAPI v2) driver.
    // What is genuinely open is hardware validation, which the file's own
    // header states. Guarded because "unbuilt" is the direction that stops
    // people looking.
    id: 'gpio-relay-driver-written',
    label: 'The GPIO relay driver is implemented (uAPI v2 line handles, pulse state machine) — NOT that it has ever driven a real relay',
    docStatus: 'shipped',
    docRefs: ['ROADMAP.md — "STATUS: NOT VALIDATED ON HARDWARE"'],
    evidence: [
      { file: 'controller/internal/relay/gpio.go', pattern: 'func \\(g \\*GPIO\\) Pulse' },
      { file: 'controller/internal/relay/gpio.go', pattern: 'STATUS: NOT VALIDATED ON HARDWARE' },
      { file: 'controller/internal/relay/gpio_linux.go', pattern: 'func openLines' },
    ],
  },
  {
    // The safety rule under the whole tier ladder. Worth a claim because its
    // enforcement was procedural (a test) while its own doc comment said it was
    // structural ("the registry refuses to build") — now it actually is.
    id: 'verb-inverse-rule-enforced',
    label: 'Stopping is never riskier than starting — a hazardous verb without a safe inverse panics at package init',
    docStatus: 'shipped',
    docRefs: ['docs/CHAT-COMMANDS.md — "stopping is never riskier than starting"'],
    evidence: [
      { file: 'hub/internal/devices/capability.go', pattern: 'func checkInversesIn' },
      { file: 'hub/internal/devices/capability.go', pattern: 'func init\\(\\)' },
      { file: 'hub/internal/devices/capability.go', pattern: 'panic\\("devices: capability catalogue violates' },
    ],
  },
  {
    // Energy retention. PruneSamples was written, carefully guarded and never
    // called by anything — the fourth "built and unreachable" found in this
    // codebase — so a hub polling a meter every 60s grew its samples table
    // forever on the Pi this product targets.
    id: 'energy-sample-retention',
    label: 'Raw energy samples pruned on a retention window, keeping deltas and a per-channel anchor sample',
    docStatus: 'shipped',
    docRefs: ['site/docs/devices.md § Energy — Retention'],
    evidence: [
      { file: 'hub/internal/energy/poller.go', pattern: 'WithSampleRetention' },
      // Wired into the cycle, not merely offered as an option.
      { file: 'hub/internal/energy/poller.go', pattern: 'p\\.st\\.PruneSamples' },
      { file: 'hub/internal/energy/store.go', pattern: 'DefaultSampleRetention' },
      { file: 'hub/cmd/hub/main.go', pattern: 'AQL_ENERGY_SAMPLE_RETENTION' },
    ],
  },
  {
    // The same defect as phone-link-ceremony, four rails over: Telegram,
    // Slack, Discord and DMTAP all resolve members through channel_identities,
    // whose only writer (LinkChannelIdentity) had test callers and no others.
    id: 'channel-link-ceremony',
    label: 'Telegram/Slack/Discord identity linking by console-minted code, redeemed from the account itself',
    docStatus: 'shipped',
    docRefs: [
      'docs/PHONE-LINKING.md § 4 — "the channel-identity sibling is 0020"',
      'README.md § A rail only answers people it recognises',
      'site/docs/channels.md — the twelve-character code and why it is longer',
    ],
    evidence: [
      { file: 'hub/internal/store/channellink.go', pattern: 'RedeemChannelLinkCode' },
      { file: 'hub/internal/store/migrations/0020_channel_link_codes.sql', pattern: 'CREATE TABLE channel_link_codes' },
      { file: 'hub/internal/httpapi/channellink.go', pattern: 'handleChannelLinkStart' },
      // Wired into all three identity rails, not just defined.
      { file: 'hub/internal/httpapi/channels_telegram.go', pattern: 'tryChannelLink' },
      { file: 'hub/internal/httpapi/channels_slack.go', pattern: 'tryChannelLink' },
      { file: 'hub/internal/httpapi/channels_discord.go', pattern: 'tryChannelLink' },
    ],
  },
  {
    // The ceremony that makes a verified phone possible at all. Worth a claim
    // because its absence was invisible: every chat rail was built, tested and
    // documented as shipped, and inert on any real deployment, because the
    // column they all filter on had no production writer.
    id: 'phone-link-ceremony',
    label: 'Phone verification by console-minted link code, redeemed from the number itself over WhatsApp',
    docStatus: 'shipped',
    docRefs: [
      'docs/PHONE-LINKING.md § 4. What has to be built',
      'README.md § A rail only answers people it recognises',
      'site/docs/channels.md — "A member has to link each account before that rail answers them"',
    ],
    evidence: [
      { file: 'hub/internal/store/phonelink.go', pattern: 'RedeemPhoneLinkCode' },
      { file: 'hub/internal/store/migrations/0018_phone_link_codes.sql', pattern: 'CREATE TABLE phone_link_codes' },
      { file: 'hub/internal/httpapi/phones.go', pattern: 'handlePhoneLinkStart' },
      // The wiring into the rail, which is the half whose absence was the bug.
      { file: 'hub/internal/httpapi/channels_whatsapp.go', pattern: 'tryPhoneLink' },
    ],
  },
  {
    // Added when the receiving half was built (migration 0019). Worth a claim
    // precisely because the failure it fixes was invisible to every existing
    // check: the controller's side was complete, signed, durable and tested,
    // and the hub verified each event and then dropped it. Nothing was
    // "missing" in a way a route-parity or build check could see.
    id: 'controller-events-persisted',
    label: 'Controller-originated events persisted on the hub, deduped on event_id, ' +
      'with access kinds appended to the hash-chained audit log',
    docStatus: 'shipped',
    docRefs: ['proto/events.md § Delivery — "On receipt"'],
    evidence: [
      { file: 'hub/internal/store/controllerevents.go', pattern: 'RecordControllerEvent' },
      { file: 'hub/internal/store/migrations/0019_controller_events.sql', pattern: 'event_id\\s+TEXT PRIMARY KEY' },
      // The wiring, which is the half that was absent: a handler that calls it.
      { file: 'hub/internal/httpapi/devices.go', pattern: 'handleControllerEvent' },
      // And retrievable: the migration stores each envelope verbatim so a
      // signature stays re-checkable, which is only true if the bytes can be
      // read back out.
      { file: 'hub/internal/httpapi/devices.go', pattern: 'handleDeviceEvents' },
    ],
  },
  {
    id: 'rate-limits',
    label: 'The four configurable rate limits',
    docStatus: 'shipped',
    docRefs: ['README.md § Safety — rate limits'],
    evidence: [
      { file: 'hub/internal/store/ratelimit.go', pattern: 'RATE_OPEN_COOLDOWN_S' },
      { file: 'hub/internal/store/ratelimit.go', pattern: 'RATE_OPENS_PER_HOUR' },
      { file: 'hub/internal/store/ratelimit.go', pattern: 'RATE_ACCOUNT_OPENS_PER_HOUR' },
      { file: 'hub/internal/store/ratelimit.go', pattern: 'RATE_CHAT_MSGS_PER_MIN' },
    ],
  },
  {
    id: 'per-location-daily-quotas',
    label: 'Per-location daily quotas (owner/admin exempt)',
    docStatus: 'shipped',
    docRefs: ['README.md § Safety — quotas'],
    evidence: [{ file: 'hub/internal/store/locations.go', pattern: 'LocationQuotas' }],
  },
  {
    id: 'one-off-visitor-grants',
    label: 'One-off dated temporary access grants (phone-bound, POST/GET /v1/grants)',
    docStatus: 'shipped',
    docRefs: ['README.md § Features — temporary access'],
    evidence: [
      { file: 'hub/internal/store/grants.go', pattern: 'phone_e164' },
      { file: 'hub/internal/httpapi/server.go', pattern: '"POST /v1/grants"' },
    ],
  },
  {
    id: 'whatsapp-channel',
    label: 'WhatsApp channel',
    docStatus: 'shipped',
    docRefs: ['README.md § What the chat rails actually cost you'],
    evidence: [{ file: 'hub/internal/channels/whatsapp.go', pattern: 'func \\(WhatsApp\\) Kind\\(\\)' }],
  },
  {
    id: 'slack-channel',
    label: 'Slack channel (Events API)',
    docStatus: 'shipped',
    docRefs: ['README.md § the rail table — the Slack row'],
    evidence: [{ file: 'hub/internal/channels/slack.go', pattern: 'func \\(Slack\\) Kind\\(\\)' }],
  },
  {
    id: 'telegram-channel',
    label: 'Telegram channel',
    docStatus: 'shipped',
    docRefs: ['README.md § What the chat rails actually cost you — the Telegram row'],
    evidence: [{ file: 'hub/internal/channels/telegram.go', pattern: 'func \\(Telegram\\) Kind\\(\\)' }],
  },
  {
    id: 'offline-grant-lan-cors',
    label: 'A browser tab can present an offline grant over the LAN (controller allows the paired hub console origin)',
    docStatus: 'shipped',
    docRefs: [
      'site/docs/emergency-access.md § Where the app half stands — the per-build table',
      "README.md § the console row",
    ],
    // The wiring AND the narrowness. A controller that answered "*" would also
    // satisfy a pattern looking only for a CORS header, so the evidence names
    // the origin-derivation the policy depends on.
    evidence: [
      { file: 'controller/internal/lanserver/cors.go', pattern: 'func OriginFromWSURL' },
      { file: 'controller/internal/agent/agent.go', pattern: 'lanserver\\.OriginFromWSURL' },
    ],
  },
  {
    id: 'telegram-polling',
    label: 'Telegram long polling (getUpdates, outbound, zero ingress) — WIRED into the server, not merely implemented',
    docStatus: 'shipped',
    docRefs: [
      'site/docs/channels.md § Telegram — Opt-in long polling',
      'site/docs/reachability.md — the Telegram long polling row',
    ],
    // The evidence is the WIRING, not the poller. channels/telegram_polling.go
    // and httpapi/channels_telegram_polling.go were both complete and tested
    // for a long time while nothing constructed one, so a pattern matching the
    // implementation would have reported this claim as shipped throughout the
    // entire period an operator could not switch it on.
    evidence: [
      { file: 'hub/internal/httpapi/server.go', pattern: 'NewTelegramPoller\\(ch\\.TelegramEngine\\)' },
      { file: 'hub/internal/channels/channels.go', pattern: 'AQL_TELEGRAM_ENGINE' },
    ],
  },
  {
    id: 'slack-socket-mode',
    label: 'Slack Socket Mode (outbound WSS, zero ingress)',
    docStatus: 'shipped',
    docRefs: ['README.md § What the chat rails actually cost you — the Slack row', 'hub/internal/channels/socketmode.go'],
    evidence: [{ file: 'hub/internal/channels/socketmode.go', pattern: 'type SocketMode struct' }],
  },
  {
    id: 'go-gateway-product-core',
    // The id keeps its old spelling on purpose: it is referenced from commit
    // messages and changing it would silently orphan them. The hub is a hub.
    label: 'The Go hub runs the product core (not just a skeleton/spec)',
    docStatus: 'shipped',
    docRefs: [
      'README.md § Run it — "one binary, one SQLite"',
    ],
    evidence: [
      { file: 'hub/internal/httpapi/server.go', pattern: 'func \\(s \\*Server\\) Router\\(\\)' },
      { file: 'hub/cmd/hub/main.go' },
    ],
  },

  // ── 2026-07-20 hardening wave: the docs UNDER-claimed these (opposite
  // failure mode from the nine above) until this pass. Encoded here so a
  // future regression — code ripped out, docs still bragging — fails loudly,
  // the same way a false "shipped" claim would.
  {
    id: 'audit-hash-chain',
    label: 'Tamper-evident hash chain for access_logs/admin_audit_log + append-only DB triggers, verifiable via GET /v1/admin/audit/verify or `gateway verify-audit` against a cold backup',
    docStatus: 'shipped',
    docRefs: [
      'hub/README.md — "Tamper-evident audit log"',
      'site/docs/security.md — "Tamper-evident audit log"',
      'site/docs/self-host.md — "Checking the audit log hasn\'t been tampered with"',
      'site/docs/admin.md — "The audit trail" (three views)',
      'site/docs/api.md — audit section',
    ],
    // NOTE: this only proves the mechanism exists, not that it's a
    // prevention control — the honest ceiling (a fully re-hashed tamper
    // verifies clean) is load-bearing prose, not something a regex can
    // check; see hub/internal/store/audithash_test.go's
    // TestHashChainTamperRecomputingDownstreamIsUndetected.
    evidence: [
      { file: 'hub/internal/store/audithash.go', pattern: 'func \\(s \\*Store\\) VerifyAccessLogHashChain' },
      { file: 'hub/internal/store/migrations/0007_audit_hash_chain.sql' },
      { file: 'hub/internal/httpapi/server.go', pattern: '"GET /v1/admin/audit/verify"' },
      { file: 'hub/cmd/hub/main.go', pattern: 'verify-audit' },
    ],
  },
  {
    id: 'login-brute-force-rate-limiting',
    label: 'Per-IP (hard) + per-account (soft, failures-only, fixed non-compounding window) brute-force throttles on login/register/refresh/admin-claim, fail-closed on a counter-store error',
    docStatus: 'shipped',
    docRefs: [
      'hub/README.md — "Auth & session security"',
      'site/docs/security.md — "Login & session security"',
      'site/docs/self-host.md — Configuration (RATE_LOGIN_IP_PER_5MIN etc.)',
      'site/docs/api.md — Authentication section',
    ],
    evidence: [
      { file: 'hub/internal/store/authratelimit.go', pattern: 'RATE_LOGIN_IP_PER_5MIN' },
      { file: 'hub/internal/store/authratelimit.go', pattern: 'RATE_LOGIN_ACCOUNT_PER_5MIN' },
      { file: 'hub/internal/httpapi/auth.go', pattern: 'authIPGate' },
    ],
  },
  {
    // Added after a doc bug that no check could have caught: README,
    // getting-started and self-host all listed password reset as
    // unimplemented, for a feature that ships. The checker handles that
    // direction fine — 'shipped' with no evidence fails — but only for claims
    // it knows about, and this one was simply absent. A claim nobody wrote
    // down is a claim nothing verifies, and the "not built" list rots toward
    // pessimism because nobody re-reads a list of things that do not exist.
    id: 'password-recovery',
    label: 'Account recovery — forgot-password, reset-password and update-password are served',
    docStatus: 'shipped',
    docRefs: [
      'README.md — password reset is NOT listed among the unimplemented gaps',
      'site/docs/self-host.md — honest-gaps note no longer claims there is no password-reset route',
      'site/docs/getting-started.md — not-implemented list excludes it',
    ],
    evidence: [
      { file: 'hub/internal/httpapi/server.go', pattern: '"POST /v1/auth/forgot-password"' },
      { file: 'hub/internal/httpapi/server.go', pattern: '"POST /v1/auth/reset-password"' },
      { file: 'hub/internal/httpapi/server.go', pattern: '"POST /v1/auth/update-password"' },
    ],
  },
  {
    // Identity here is a LOCAL username. Email was removed rather than
    // deferred, so this claim guards the removal staying removed: a
    // reintroduced email column or verify route would fail it.
    id: 'no-email-identity',
    label: 'No email identity and no email verification — users are identified by a local username',
    docStatus: 'planned',
    docRefs: [
      'hub/internal/store/migrations/0001_baseline.sql — users.username, and why it is not an address',
      'README.md — "There is no email anywhere, and that is a decision rather than a gap"',
    ],
    evidence: [
      { file: 'hub/internal/store/migrations/0001_baseline.sql', pattern: 'email\\s+TEXT NOT NULL UNIQUE' },
      { file: 'hub/internal/httpapi/server.go', pattern: 'verify-email' },
    ],
  },
  {
    id: 'logout-all',
    label: '"Log out everywhere" — POST /v1/auth/logout-all revokes every refresh-token family for the calling user',
    docStatus: 'shipped',
    docRefs: [
      'hub/README.md — "Auth & session security"',
      'site/docs/security.md — "Login & session security"',
      'site/docs/api.md — Authentication section',
    ],
    evidence: [
      { file: 'hub/internal/httpapi/server.go', pattern: '"POST /v1/auth/logout-all"' },
      { file: 'hub/internal/store/users.go', pattern: 'func \\(s \\*Store\\) RevokeAllRefreshTokensForUser' },
    ],
  },
  {
    id: 'live-session-revocation-all-requests',
    label: 'requireAuth re-reads the live user row on every authenticated request (not just admin routes) — a disabled user is cut off on their next request, not at token TTL expiry',
    docStatus: 'shipped',
    docRefs: [
      'hub/README.md — "Auth & session security"',
      'site/docs/security.md — "Login & session security"',
    ],
    evidence: [
      { file: 'hub/internal/httpapi/server.go', pattern: 'func \\(s \\*Server\\) requireAuth' },
      { file: 'hub/internal/httpapi/server.go', pattern: 'u\\.Status != "active"' },
    ],
  },
  {
    id: 'public-bind-refusal',
    label: 'Gateway refuses to start when -listen resolves to a non-loopback address unless -behind-proxy/AQL_BEHIND_PROXY is set',
    docStatus: 'shipped',
    docRefs: [
      'hub/README.md — "Deployment & TLS"',
      'site/docs/self-host.md — "Reachability"',
    ],
    evidence: [
      { file: 'hub/cmd/hub/main.go', pattern: 'func checkListenAddr' },
      { file: 'hub/cmd/hub/main.go', pattern: 'AQL_BEHIND_PROXY' },
      { file: 'hub/Dockerfile', pattern: 'AQL_BEHIND_PROXY=1' },
    ],
  },
];
