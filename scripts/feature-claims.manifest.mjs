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
// hub/, backend/src/, controller/, proto/, src-tauri/ config — never
// src/ (the React portal's UI copy) or site/ (marketing). Scanning UI copy
// for evidence would be circular: it's the exact layer that lies. See the
// checker's header for what that means this tool cannot catch.

export const FEATURES = [
  // ── planned / not implemented — the nine (ten, by plain count) 2026-07-20
  // overclaims, now correctly marked in the docs. This check's job is to
  // make sure nobody re-overclaims them by accident, and to catch the day
  // any of them actually ships (evidence appears → docs must be updated).
  // ── geofence enforcement shipped 2026-07-27: hub/internal/store/
  // geofence.go + migration 0015, enforced inside the LogAccess choke point,
  // with POST/GET/DELETE /v1/accounts/{id}/geofences to manage the rules.
  //
  // ⚠ DOC DEBT, OPEN. This entry is flipped to 'shipped' because the CODE now
  // exists and this checker's job is to catch exactly that divergence. The
  // prose in README.md, ARCHITECTURE.md §8, site/index.html, site/docs/
  // security.md, site/docs/getting-started.md, site/docs/troubleshooting.md
  // and src/pages/docs/GeofenceSafety.tsx still says "designed, not built" and
  // is now WRONG — undersell rather than overclaim, but wrong. Those files
  // were outside the shipping change's file scope; someone must update them.
  //
  // When they are updated, the one thing that copy MUST keep saying is that
  // this is a convenience and not a security control: the position it tests is
  // client-supplied and unverified, so it stops mistakes, not attackers (see
  // hub/internal/store/geofence.go's package comment for the full claim).
  {
    id: 'geofencing',
    label: 'Geofencing (block opens outside a per-access-point/per-location radius)',
    docStatus: 'shipped',
    docRefs: [
      'hub/internal/store/geofence.go — package comment: what it buys, and what it explicitly does not',
      'hub/internal/store/migrations/0015_geofence.sql — the geofence_rules table',
      'hub/internal/store/openpath.go — the check inside LogAccess, after time windows, before the limit block',
      'STALE, needs updating: README.md, ARCHITECTURE.md §8, site/index.html, site/docs/security.md, site/docs/getting-started.md, site/docs/troubleshooting.md, src/pages/docs/GeofenceSafety.tsx',
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
      'README.md resilience note — "both the controller side and the gateway\'s issuance side are real and conformance-tested"',
      'site/docs/emergency-access.md — "Gateway-side issuance is now real"',
      'proto/grants.md "Implementation status" — "gateway side ... is also real and conformance-tested"',
      'hub/internal/channels/send.go — ban-risk warning names the app, not the gateway, as the missing half',
    ],
    // Deliberately narrow: "offline" alone appears constantly in this
    // codebase for unrelated things (the HTTPS long-poll device queue,
    // comments explaining this exact gap). Look for the specific route this
    // half of proto/grants.md would need to land on.
    evidence: [{ root: 'hub/internal', pattern: '"POST /v1/offline-grants"|handleOfflineGrantIssue', flags: 'i' }],
  },
  {
    id: 'offline-grant-app-client',
    label: 'App (Tauri) client that requests, stores and presents an offline LAN/BLE grant to a controller',
    docStatus: 'planned',
    docRefs: [
      'README.md resilience note — "not built yet is the app side (🔨)"',
      'site/docs/emergency-access.md — "What is still not built: the app"',
      'proto/grants.md "Implementation status" — "app client unbuilt"',
      'hub/internal/channels/send.go — "the app doesn\'t hold or present a grant yet"',
    ],
    // The app is src/ + src-tauri/ (React 19 + Tauri v2). src/ is
    // deliberately never used as an evidence root (see this file's header —
    // it's UI copy, the exact layer that lied nine times already), so this
    // checks the one implementation-code root the app actually has today:
    // the Rust shell in src-tauri/ (excluding target/, walked out by
    // WALK_EXCLUDES). A real grant-request/store/present flow would show up
    // here as new Rust or Tauri-command surface; today src-tauri/src/main.rs
    // is a 12-line gateway-picker shell with none of it.
    evidence: [{ root: 'src-tauri', pattern: 'offline.?grant|grant_id|presentGrant|requestOfflineGrant|mDNS|_lintel\\._tcp', flags: 'i' }],
  },
  {
    id: 'hardware-failsafe-gpio',
    label: 'A real GPIO relay driver exists behind `-tags gpio` (NOT that it has ever driven hardware — see the note below)',
    docStatus: 'shipped',
    docRefs: [
      'README.md — "A real Linux character-device driver now exists behind -tags gpio ... but it has never been run against a GPIO chip, a relay board or a gate"',
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
      'README.md dev table — "app/ ... Desktop, iOS, Android" is the TARGET, not what ships (`src/` + `src-tauri/` ships desktop only)',
    ],
    // A generated mobile target leaves `gen/apple` or `gen/android` behind
    // (`tauri ios init` / `tauri android init`); today gen/ only has the
    // desktop schemas.
    evidence: [[{ file: 'src-tauri/gen/apple' }, { file: 'src-tauri/gen/android' }]],
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
      'README.md — "still ahead on a few deferred surfaces: OTP verify, analytics, OAuth, meters"',
      'site/docs/self-host.md — "Still deferred ... analytics endpoints"',
    ],
    evidence: [{ root: 'hub/internal', pattern: '/v1/analytics|handleAnalytics', flags: 'i' }],
  },
  {
    id: '2fa',
    label: 'Two-factor authentication (TOTP), opt-in per user, with single-use recovery codes',
    docStatus: 'shipped',
    docRefs: [
      'ROADMAP.md — listed as done',
      'ARCHITECTURE.md — the residual is now "loses BOTH password and recovery codes"',
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
      { root: 'backend/src', pattern: 'text/csv|ExportCSV|\\.csv"', flags: 'i' },
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
  // is UI copy — see this file's header); the console's demo dataset lives
  // at src/lib/demoData.ts and is deliberately NOT evidence of anything.
  {
    id: 'device-engine-drivers',
    label: 'Device-engine code naming a device protocol exists (NOT that any protocol driver talks to a real device network)',
    docStatus: 'shipped',
    docRefs: [
      'README.md — "no Matter, MQTT, Zigbee, ONVIF, Modbus or Z-Wave driver talks to a real device network yet"',
      'ARCHITECTURE.md §8 — "The device engine — designed, not started"',
      'ROADMAP.md Phase 1 — "Nothing here exists in code"',
      'site/docs/devices.md — the per-kind status table: six kinds "Demo data only"',
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
    label: 'Energy-metering engine code exists (NOT that any meter is polled in a running hub — nothing constructs a poller in cmd/hub)',
    docStatus: 'shipped',
    docRefs: [
      'README.md — "Energy metering. No ingestion, no rollups, no source-mix accounting."',
      'ROADMAP.md Phase 4',
      'site/docs/devices.md § Energy — "Built: nothing"',
    ],
    evidence: [[
      { root: 'hub/internal', pattern: 'MeterReading|kWh|inverter|EnergyReading|solar', flags: 'i' },
      { root: 'controller/internal', pattern: 'MeterReading|kWh|inverter|EnergyReading|solar', flags: 'i' },
    ]],
  },
  {
    id: 'camera-pipeline',
    label: 'ONVIF discovery / stream-address resolution code exists (NOT live view, NOT recording — there is no RTSP client and no pixel ever moves)',
    docStatus: 'shipped',
    docRefs: [
      'README.md — "The camera pipeline. No live view, no recording, no ONVIF/RTSP code."',
      'ROADMAP.md Phase 5',
      'site/docs/devices.md § Security & bots — "Built: nothing"',
    ],
    evidence: [[
      { root: 'hub/internal', pattern: 'RTSP|rtsp://|ffmpeg|onvif', flags: 'i' },
      { root: 'controller/internal', pattern: 'RTSP|rtsp://|ffmpeg|onvif', flags: 'i' },
    ]],
  },
  {
    id: 'keychain-credential-vault',
    label: 'OS-keychain-backed credential vault for device/service secrets',
    docStatus: 'planned',
    docRefs: [
      'ROADMAP.md Phase 2 — "Not built: there is no keychain or keyring code anywhere in the repository today"',
      'site/docs/overview.md — the data directory holds the unencrypted signing key and JWT secret',
    ],
    evidence: [[
      { root: 'hub/internal', pattern: 'keychain|keyring|CredentialVault|SecretService', flags: 'i' },
      { root: 'controller/internal', pattern: 'keychain|keyring|CredentialVault|SecretService', flags: 'i' },
      { root: 'src-tauri/src', pattern: 'keychain|keyring|CredentialVault|SecretService', flags: 'i' },
    ]],
  },
  {
    id: 'ble-peripheral-off-linux',
    label: 'BLE GATT peripheral backing on any platform other than Linux/BlueZ',
    docStatus: 'planned',
    docRefs: [
      'README.md — "the GATT peripheral glue exists only for Linux/BlueZ behind -tags ble ... On every other platform the peripheral returns ErrUnsupported"',
      'ROADMAP.md Finishing Phase 0 — "every other platform returns ErrUnsupported"',
      'controller/internal/bleperiph/start_ble_linux.go — "//go:build ble && linux"',
    ],
    // Hardware validation itself is not regex-checkable — "has this ever run
    // on a real radio" is a human fact. What IS checkable is the narrower
    // structural claim the docs make: the only peripheral backing is Linux.
    // The catch-all stub (`//go:build !ble || (ble && !linux)`) returns
    // ErrUnsupported today; if a second backend lands, that stops being true
    // and this fires so the docs get corrected.
    evidence: [{ file: 'controller/internal/bleperiph/start_stub.go', patternAbsent: 'ErrUnsupported' }],
  },

  // ── shipped — genuinely real today. Encoded so a regression (someone
  // rips the code out but the docs keep bragging) fails loudly, same as a
  // false "shipped" claim would.
  {
    id: 'ed25519-signed-commands',
    label: 'Ed25519-signed device commands',
    docStatus: 'shipped',
    docRefs: ['README.md Wire contracts — "Ed25519 over canonical JSON (JCS, RFC 8785)"'],
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
    docRefs: ['README.md — "claim-token controller pairing"'],
    evidence: [{ file: 'hub/internal/store/devices.go', pattern: 'claim_token_hash' }],
  },
  {
    id: 'append-only-audit-log',
    label: 'Append-only audit log',
    docStatus: 'shipped',
    docRefs: ['README.md — "an append-only audit log"'],
    evidence: [{ file: 'hub/internal/store/admin.go', pattern: 'admin_audit_log' }],
  },
  {
    id: 'rate-limits',
    label: 'The four configurable rate limits',
    docStatus: 'shipped',
    docRefs: ['README.md — "all four rate limits"'],
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
    docRefs: ['README.md — "per-location daily quotas (owner/admin exempt)"'],
    evidence: [{ file: 'hub/internal/store/locations.go', pattern: 'LocationQuotas' }],
  },
  {
    id: 'one-off-visitor-grants',
    label: 'One-off dated temporary access grants (phone-bound, POST/GET /v1/grants)',
    docStatus: 'shipped',
    docRefs: ['README.md — "one-off dated temporary access grants ... (POST/GET /v1/grants, portal page)"'],
    evidence: [
      { file: 'hub/internal/store/grants.go', pattern: 'phone_e164' },
      { file: 'hub/internal/httpapi/server.go', pattern: '"POST /v1/grants"' },
    ],
  },
  {
    id: 'whatsapp-channel',
    label: 'WhatsApp channel',
    docStatus: 'shipped',
    docRefs: ['README.md — "the WhatsApp / Slack ... / Telegram channels"'],
    evidence: [{ file: 'hub/internal/channels/whatsapp.go', pattern: 'func \\(WhatsApp\\) Kind\\(\\)' }],
  },
  {
    id: 'slack-channel',
    label: 'Slack channel (Events API)',
    docStatus: 'shipped',
    docRefs: ['README.md — "Slack (Events API + Socket Mode)"'],
    evidence: [{ file: 'hub/internal/channels/slack.go', pattern: 'func \\(Slack\\) Kind\\(\\)' }],
  },
  {
    id: 'telegram-channel',
    label: 'Telegram channel',
    docStatus: 'shipped',
    docRefs: ['README.md — "the WhatsApp / Slack ... / Telegram channels"'],
    evidence: [{ file: 'hub/internal/channels/telegram.go', pattern: 'func \\(Telegram\\) Kind\\(\\)' }],
  },
  {
    id: 'slack-socket-mode',
    label: 'Slack Socket Mode (outbound WSS, zero ingress)',
    docStatus: 'shipped',
    docRefs: ['README.md — "Slack (Events API + Socket Mode)"', 'hub/internal/channels/socketmode.go'],
    evidence: [{ file: 'hub/internal/channels/socketmode.go', pattern: 'type SocketMode struct' }],
  },
  {
    id: 'go-gateway-product-core',
    label: 'The Go gateway runs the product core (not just a skeleton/spec)',
    docStatus: 'shipped',
    docRefs: [
      'README.md — "The Go gateway ... now runs the product core"',
      'README.md dev table — gateway row: "🟢 runs the product core"',
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
      'README.md — email verification described as removed, not missing',
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
