#!/usr/bin/env node
// proto/vectors/verify.mjs — self-check for the lintel conformance vectors.
//
// For every vector it:
//   1. re-canonicalizes the wire object (minus sig) and byte-compares against
//      the stored "canonical" field;
//   2. re-signs the canonical bytes with the stated signer's test key and
//      byte-compares against "sig" (Ed25519 is deterministic, RFC 8032);
//   3. runs an independent implementation of the contract's verification rules
//      (commands.md / grants.md / events.md / pairing.md) and asserts the
//      outcome matches "expect" — and, for rejects, fails for the STATED reason.
//
// Exit code 0 = all vectors hold. Run: node proto/vectors/verify.mjs

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEYS,
  b64u,
  fromB64u,
  jcs,
  canonicalMinusSig,
  signRaw,
  verifyObject,
} from './lib.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

let checked = 0;
let failures = 0;
const fail = (name, msg) => {
  failures++;
  console.error(`FAIL ${name}: ${msg}`);
};

const load = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

/**
 * The contract terms this verifier enforces, read from the documents it
 * verifies.
 *
 * These were three literals — SKEW = 90, MAX_CMD_WINDOW = 60,
 * STALE_CLOCK_LIMIT = 1209600 — restating what generate.mjs writes into every
 * document's `spec_constants` block. Two independent copies of a number, where
 * one of them belongs to the tool whose entire job is to be the independent
 * check.
 *
 * The drift is only half self-catching. Change a limit in generate.mjs and
 * regenerate, and the boundary vectors flip their expectation, so *some* case
 * fails — but it fails as "expected accept, got expired" on a vector that is
 * perfectly correct, pointing at the wrong thing entirely. Cases away from the
 * boundary go on passing while the verifier enforces a contract nobody wrote.
 *
 * Reading the block instead makes the verifier enforce the document's own
 * stated terms, and a missing or incomplete block is fatal rather than
 * defaulted — a default would let the vectors stop publishing their terms while
 * everything stayed green.
 */
const CONSTANTS = (() => {
  const doc = load('commands.json');
  const c = doc.spec_constants;
  const required = ['skew_seconds', 'max_cmd_window_seconds', 'stale_clock_limit_seconds'];
  if (!c || typeof c !== 'object') {
    console.error('FAIL spec_constants: commands.json has no spec_constants block; the verifier has no contract to enforce');
    process.exit(1);
  }
  const missing = required.filter((k) => !Number.isInteger(c[k]));
  if (missing.length) {
    console.error(`FAIL spec_constants: commands.json spec_constants is missing or non-integer for ${missing.join(', ')}`);
    process.exit(1);
  }
  return c;
})();

const SKEW = CONSTANTS.skew_seconds;
const MAX_CMD_WINDOW = CONSTANTS.max_cmd_window_seconds;
const STALE_CLOCK_LIMIT = CONSTANTS.stale_clock_limit_seconds;

// commands.md §Verification step 5.
const LOCKDOWN_ALLOWED = ['lift', 'ping', 'config', 'repair', 'revoke'];

// Every Ed25519 contract document repeats the block. If two disagree, "the
// vectors say" is not a well-formed statement and this verifier is enforcing
// whichever file it happened to read first, so refuse rather than pick.
//
// The set is derived rather than listed, so a document added later is checked
// without anyone remembering to add it here. Two are legitimately exempt and
// both would otherwise read as failures: keys.json is key material with no
// contract terms, and webhooks.json is an HMAC profile to which none of skew,
// command window, cnonce TTL or stale-clock apply — generate.mjs deliberately
// gives it its own `profile` block instead of the shared header.
{
  const documents = ['pairing.json', 'commands.json', 'grants.json', 'events.json', 'acks.json', 'reports.json'];
  let compared = 0;
  for (const f of documents) {
    const c = load(f).spec_constants;
    if (!c) {
      fail('spec_constants', `${f} carries no spec_constants block, so it publishes no contract terms to check`);
      continue;
    }
    compared++;
    for (const [k, want] of Object.entries(CONSTANTS)) {
      if (c[k] !== want) {
        fail('spec_constants', `${f} says ${k}=${c[k]}, commands.json says ${want} — the documents contradict each other`);
      }
    }
  }
  // Without this the loop is silent when every document lacks the block, and
  // silent again if `documents` loses its entries.
  if (compared < documents.length) {
    fail('spec_constants', `compared ${compared} of ${documents.length} contract documents`);
  }
  checked += compared;
}

// --- structural checks on any {signer, object, canonical} entry --------------

const B64U_RE = /^[A-Za-z0-9_-]+$/;

function checkEntry(name, entry) {
  const { object, canonical, signer, unsigned } = entry;
  const expected = unsigned ? jcs(object) : canonicalMinusSig(object);
  if (canonical !== expected) {
    fail(name, 'stored canonical does not match re-canonicalized object');
    return;
  }
  if (unsigned) return;
  if (typeof object.sig !== 'string' || !B64U_RE.test(object.sig) || object.sig.length !== 86) {
    fail(name, 'sig is not 86-char unpadded base64url (64 bytes)');
    return;
  }
  if (signer) {
    const resigned = b64u(signRaw(KEYS[signer].priv, Buffer.from(canonical, 'utf8')));
    if (resigned !== object.sig) {
      fail(name, `re-signing with '${signer}' key does not reproduce sig (Ed25519 is deterministic)`);
    }
  }
}

// --- independent contract evaluators (fail-closed, first failure wins) -------

const rej = (reason) => ({ ok: false, reason });
const acc = () => ({ ok: true });

function evalCommand(env, check, nonceStore) {
  // commands.md "Verification" order
  if (!verifyObject(env, KEYS.gateway.pub)) return rej('badsig');
  if (env.device_id !== check.device_id) return rej('wrong_device');
  if (['open', 'hold', 'close'].includes(env.cmd)) {
    if (!env.access_point || !check.access_points.includes(env.access_point))
      return rej('wrong_access_point');
  }
  if (!(Number.isInteger(env.iat) && Number.isInteger(env.exp)) || env.iat > env.exp || env.exp - env.iat > MAX_CMD_WINDOW)
    return rej('window_too_long');
  if (check.now < env.iat - SKEW) return rej('not_yet_valid');
  if (check.now > env.exp + SKEW) return rej('expired');
  if (nonceStore.has(env.nonce)) return rej('replay');
  nonceStore.add(env.nonce);
  // commands.md §Verification step 5. This is a FOURTH copy of the matrix —
  // contract, controller, hub verifier, and here — and it was the one that got
  // missed when `revoke` was added: a three-way guard covered the other three.
  // Kept as a named constant so the guard can read it.
  if (check.lockdown && !LOCKDOWN_ALLOWED.includes(env.cmd)) return rej('lockdown');
  return acc();
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const hm = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

function inWindow(windows, ts) {
  const d = new Date(ts * 1000); // controller tz = UTC in these vectors
  const dayIdx = (d.getUTCDay() + 6) % 7; // mon=0 … sun=6
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  for (const w of windows) {
    const [a, b] = w.days.split('-');
    const ai = DAY_ORDER.indexOf(a);
    const bi = DAY_ORDER.indexOf(b ?? a);
    if (ai < 0 || bi < 0 || dayIdx < ai || dayIdx > bi) continue;
    const to = w.to === '24:00' ? 1440 : hm(w.to);
    if (minutes >= hm(w.from) && minutes < to) return true;
  }
  return false;
}

function evalGrantRedemption({ check, grant, open, challenge, proof }, usedCnonces) {
  // grants.md "Verification order"
  if (check.now - check.last_gateway_sync > STALE_CLOCK_LIMIT) return rej('stale_clock');
  if (check.lockdown) return rej('lockdown');
  if (!verifyObject(grant, KEYS.gateway.pub)) return rej('badsig');
  // Step 3a — the cached deny-list (docs/GRANT-REVOCATION.md). After the
  // signature, because an id read from unverified bytes is not an id; before
  // the validity window, because a dead grant needs no further evaluation.
  // A vector with no `revoked` list denies nothing, which is the same
  // "absence is never denial" rule the controller implements.
  if ((check.revoked ?? []).some((e) => e.grant_id === grant.grant_id &&
      (!e.exp || e.exp >= check.now)))
    return rej('revoked');
  if (check.now < grant.iat - SKEW) return rej('not_yet_valid');
  if (check.now > grant.exp + SKEW) return rej('expired');
  if (!grant.devices.includes(check.device_id)) return rej('wrong_device');
  const ap = open.access_point;
  if (!grant.access_points.includes(ap) || proof.access_point !== ap)
    return rej('wrong_access_point');
  if (!inWindow(grant.windows, check.now)) return rej('window');
  if (proof.grant_id !== grant.grant_id) return rej('wrong_grant');
  if (!verifyObject(proof, fromB64u(grant.app_pubkey))) return rej('badsig');
  if (proof.cnonce !== challenge.cnonce) return rej('cnonce_unknown');
  if (check.now > challenge.exp) return rej('cnonce_expired');
  if (usedCnonces.has(proof.cnonce)) return rej('cnonce_replay');
  if (Math.abs(proof.ts - check.now) > SKEW)
    return rej(proof.ts < check.now ? 'expired' : 'not_yet_valid');
  usedCnonces.add(proof.cnonce);
  return acc();
}

function evalControllerSigned(obj, pub) {
  return verifyObject(obj, pub) ? acc() : rej('badsig');
}

function evalWsAuth(obj, check) {
  // pairing.md "WebSocket auth", in the normative order.
  //
  // The typ/v and device_id checks were both absent here for a long time, and
  // this file is the INDEPENDENT verifier — the one whose whole job is to
  // disagree with the implementations rather than inherit their gaps. It
  // agreed with them instead: three verifiers of one fail-closed check, and
  // only the hub's production VerifyAuth compared the signed device_id to the
  // device being authenticated.
  if (obj.typ !== 'ws.auth' || obj.v !== 0) return rej('badsig');
  if (!verifyObject(obj, KEYS.controller.pub)) return rej('badsig');
  // After the signature, deliberately: refusing on device_id first would
  // answer "is this a device you know" to anyone who can send bytes.
  if (obj.device_id !== check.device_id) return rej('wrong_device');
  if (obj.cnonce !== check.challenge.cnonce) return rej('cnonce_unknown');
  if (check.now > check.challenge.exp) return rej('cnonce_expired');
  if (Math.abs(obj.ts - check.now) > SKEW)
    return rej(obj.ts < check.now ? 'expired' : 'not_yet_valid');
  return acc();
}

// --- outcome assertion -------------------------------------------------------

function assertOutcome(name, expected, reason, actual) {
  checked++;
  if (expected === 'accept') {
    if (!actual.ok) fail(name, `expected accept, got reject(${actual.reason})`);
  } else {
    if (actual.ok) fail(name, `expected reject(${reason}), got accept`);
    else if (actual.reason !== reason)
      fail(name, `expected reject reason '${reason}', got '${actual.reason}'`);
  }
}

// --- keys.json consistency ---------------------------------------------------

{
  const doc = load('keys.json');
  for (const [name, k] of Object.entries(doc.keys)) {
    const derived = KEYS[name];
    checked++;
    if (!derived) fail(`keys.${name}`, 'unknown key');
    else if (
      k.private_seed_hex !== derived.seedHex ||
      k.public_key_hex !== derived.pubHex ||
      k.public_key_b64u !== derived.pubB64u
    )
      fail(`keys.${name}`, 'seed/public key mismatch vs lib.mjs constants');
  }
}

// --- pairing.json ------------------------------------------------------------

for (const v of load('pairing.json').vectors) {
  checkEntry(v.name, v);
  if (v.object.typ === 'ws.auth') {
    assertOutcome(v.name, v.expect, v.reason, evalWsAuth(v.object, v.check));
  } else {
    // unsigned structural vectors: canonical check above is the assertion
    checked++;
    if (v.expect !== 'accept') fail(v.name, 'unsigned vector must be accept');
  }
}

// --- commands.json -----------------------------------------------------------

for (const v of load('commands.json').vectors) {
  const nonceStore = new Set();
  const steps = v.steps ?? [v];
  for (const [i, s] of steps.entries()) {
    const n = v.steps ? `${v.name}[${i}]` : v.name;
    checkEntry(n, s);
    assertOutcome(n, s.expect, s.reason, evalCommand(s.object, v.check, nonceStore));
  }
}

// --- grants.json -------------------------------------------------------------

for (const v of load('grants.json').vectors) {
  checkEntry(`${v.name}.grant`, v.grant);
  checkEntry(`${v.name}.open`, v.transcript.open);
  const usedCnonces = new Set();
  const base = {
    check: v.check,
    grant: v.grant.object,
    open: v.transcript.open.object,
    challenge: v.transcript.challenge,
  };
  if (v.steps) {
    for (const [i, s] of v.steps.entries()) {
      const n = `${v.name}[${i}]`;
      checkEntry(`${n}.proof`, s.proof);
      assertOutcome(n, s.expect, s.reason, evalGrantRedemption({ ...base, proof: s.proof.object }, usedCnonces));
    }
  } else {
    checkEntry(`${v.name}.proof`, v.transcript.proof);
    assertOutcome(v.name, v.expect, v.reason, evalGrantRedemption({ ...base, proof: v.transcript.proof.object }, usedCnonces));
  }
}

// --- events.json / acks.json -------------------------------------------------

for (const f of ['events.json', 'acks.json']) {
  for (const v of load(f).vectors) {
    checkEntry(v.name, v);
    assertOutcome(v.name, v.expect, v.reason, evalControllerSigned(v.object, KEYS.controller.pub));
  }
}

// --- reports.json ------------------------------------------------------------
//
// ctl.report gets its OWN evaluator rather than reusing evalControllerSigned,
// which checks the signature and nothing else.
//
// That is deliberate, and evalWsAuth's comment above is why: its typ/v and
// device_id checks were absent here for a long time, so this file — whose whole
// job is to disagree with the implementations rather than inherit their gaps —
// agreed with them instead. A message type added today starts with the checks
// that one had to learn.
function evalReport(obj, check) {
  if (obj.typ !== 'ctl.report' || obj.v !== 0) return rej('badsig');
  if (!verifyObject(obj, KEYS.controller.pub)) return rej('badsig');
  // After the signature, deliberately: refusing on device_id first would answer
  // "is this a device you know" to anyone who can send bytes.
  if (obj.device_id !== check.device_id) return rej('wrong_device');
  return acc();
}

for (const v of load('reports.json').vectors) {
  checkEntry(v.name, v);
  assertOutcome(v.name, v.expect, v.reason, evalReport(v.object, v.check));
}

// --- webhooks.json -----------------------------------------------------------
//
// The outbound profile is not Ed25519-over-JCS and shares no code with
// anything above; it is HMAC-SHA256 over "timestamp.body". Recomputed here
// from `secret` + `headers` so that the stored signature cannot drift from the
// stated rule, and so that a receiver implementer has a self-checking corpus.
//
// The Go side reads the SAME file
// (hub/internal/httpapi/webhookvectors_test.go), which is what ties the
// published format to the hub's constants.

{
  const doc = load('webhooks.json');
  if (!Array.isArray(doc.vectors) || doc.vectors.length < 6) {
    fail('webhooks', `expected >=6 vectors, loaded ${doc.vectors?.length ?? 0}`);
  }
  let ran = 0;
  for (const v of doc.vectors ?? []) {
    checked++;
    ran++;
    const ts = v.headers['X-Aql-Timestamp'];
    const preimage = `${ts}.${v.body}`;
    if (v.preimage !== preimage) {
      fail(`webhooks/${v.name}`, `stored preimage is not <timestamp>.<body>\n  got: ${v.preimage}\n want: ${preimage}`);
      continue;
    }
    const sig = createHmac('sha256', v.secret).update(preimage, 'utf8').digest('hex');
    if (sig !== v.signature_hex) {
      fail(`webhooks/${v.name}`, `HMAC-SHA256 over the preimage does not reproduce signature_hex`);
      continue;
    }
    if (v.headers['X-Aql-Signature-256'] !== v.signature_hex) {
      fail(`webhooks/${v.name}`, 'the signature header does not carry signature_hex');
    }
    if (v.headers['X-Aql-Event'] !== v.event) {
      fail(`webhooks/${v.name}`, 'the event header does not carry `event`');
    }
    if (!/^[0-9a-f]{64}$/.test(v.signature_hex)) {
      fail(`webhooks/${v.name}`, 'signature is not 64 lowercase hex characters');
    }
  }
  if (ran !== (doc.vectors?.length ?? 0)) {
    fail('webhooks', `ran ${ran} of ${doc.vectors?.length ?? 0} vectors`);
  }
  // The profile block is what an implementer reads first; an empty one would
  // make the file look complete while documenting nothing.
  for (const k of ['algorithm', 'preimage', 'signature_header', 'timestamp_header', 'event_header']) {
    checked++;
    if (!doc.profile?.[k]) fail('webhooks.profile', `missing ${k}`);
  }
  // At least two vectors must share a body and differ only in
  // timestamp/secret, or the corpus does not actually demonstrate that either
  // of those is inside the signature — which is the whole replay story.
  checked++;
  const all = doc.vectors ?? [];
  const sameBody = all.length > 0 ? all.filter((v) => v.body === all[0].body) : [];
  if (sameBody.length < 3) {
    fail('webhooks', `only ${sameBody.length} vectors share a body; the corpus cannot show that the timestamp and the secret are both signed`);
  } else if (new Set(sameBody.map((v) => v.signature_hex)).size !== sameBody.length) {
    fail('webhooks', 'vectors sharing a body produced a repeated signature; the timestamp/secret are not covered');
  }
}

// --- proto/jcs-cases.json ----------------------------------------------------
//
// Layer 0, and the reason this file can say anything about the OTHER
// implementations. Everything above proves lib.mjs agrees with vectors lib.mjs
// generated — which it would even if lib.mjs canonicalised wrongly, as long as
// it did so consistently. These cases are hand-derived from RFC 8785 and are
// read by the Go implementation (jcs/cases_test.go) and the app's TypeScript
// one (src/lib/offline/__tests__/jcs.test.ts) from the same file.
//
// Inputs are raw JSON TEXT; this implementation canonicalises VALUES, so the
// text is parsed first. That parse is part of what is being checked — see the
// 2^53+1 case, where JSON.parse is the thing that loses.

{
  const doc = JSON.parse(readFileSync(join(DIR, '..', 'jcs-cases.json'), 'utf8'));
  // Fail loudly rather than silently checking nothing. A gate that passes by
  // iterating an empty array is the specific failure this suite has shipped
  // before.
  if (!Array.isArray(doc.cases) || doc.cases.length < 14) {
    fail('jcs-cases', `expected >=14 cases, loaded ${doc.cases?.length ?? 0}`);
  }
  if (!Array.isArray(doc.refused) || doc.refused.length < 2) {
    fail('jcs-cases', `expected >=2 refusal cases, loaded ${doc.refused?.length ?? 0}`);
  }
  let ran = 0;
  for (const c of doc.cases ?? []) {
    checked++;
    ran++;
    let got;
    try {
      got = jcs(JSON.parse(c.input));
    } catch (e) {
      fail(`jcs-cases/${c.name}`, `threw on a case that must canonicalise: ${e.message}`);
      continue;
    }
    if (got !== c.canonical) {
      fail(`jcs-cases/${c.name}`, `canonical form differs from the shared expectation\n  got: ${got}\n want: ${c.canonical}`);
    }
  }
  // The refusals are a Go-profile deviation, not an RFC rule. This
  // implementation is expected to ACCEPT them, and `js_canonical` pins exactly
  // what it produces — so that a change on either side of the divergence is a
  // failing test rather than a surprise at a gate.
  for (const c of doc.refused ?? []) {
    checked++;
    ran++;
    if (typeof c.js_canonical !== 'string') {
      fail(`jcs-cases/refused/${c.name}`, 'no js_canonical: the JS behaviour on a Go-refused input must be pinned, not left implicit');
      continue;
    }
    let got;
    try {
      got = jcs(JSON.parse(c.input));
    } catch (e) {
      fail(`jcs-cases/refused/${c.name}`, `threw; js_canonical says it should produce ${c.js_canonical} (${e.message})`);
      continue;
    }
    if (got !== c.js_canonical) {
      fail(`jcs-cases/refused/${c.name}`, `the pinned JS divergence moved\n  got: ${got}\n want: ${c.js_canonical}`);
    }
  }
  const expected = (doc.cases?.length ?? 0) + (doc.refused?.length ?? 0);
  if (ran !== expected) fail('jcs-cases', `ran ${ran} of ${expected} entries`);
}

// --- summary -----------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} failure(s) out of ${checked} checks.`);
  process.exit(1);
}
console.log(
  `OK — ${checked} checks passed across pairing/commands/grants/events/acks/reports/webhooks ` +
    `vectors and the shared canonicalisation cases (proto/jcs-cases.json).`
);
