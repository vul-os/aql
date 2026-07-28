import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The third direction: error CODES.
 *
 * requestShape checks the keys we send. responseShape checks the fields we
 * read. Neither looks at the vocabulary in between — the short strings the hub
 * puts in `{"error": "..."}` and the console branches on to choose a message.
 *
 * A stale code fails quietly and in the worst possible place. The branch simply
 * never matches, so the user gets the raw code or a generic fallback at exactly
 * the moment something has gone wrong and a specific explanation mattered most.
 * Nothing throws, nothing logs, and no other test in this repo notices.
 *
 * It had already happened three times over when this file was written, all from
 * the same email→username rename:
 *   - `email_taken`          the hub says `username_taken`
 *   - `invite_email_mismatch` the hub says `invite_username_mismatch`
 *   - `invite_phone_required` the hub has NEVER emitted this one at all
 *
 * The first two were renames left behind. The third is different and worth
 * naming separately: a branch for a code no handler produces is dead on the day
 * it is written, and it reads like a handled case forever after.
 *
 * WHAT THIS DOES NOT PROVE:
 *   - It matches code NAMES against the union of every code the hub can emit,
 *     not against the specific endpoint being called. A code emitted anywhere
 *     satisfies a branch anywhere.
 *   - It cannot check that the MESSAGE beside a code is accurate.
 *   - It only sees codes written as string literals.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/**
 * Codes the console branches on that the hub does not emit, legitimately.
 *
 * Should normally be EMPTY. A dead branch is not usually a thing to exempt — it
 * is a thing to delete, because it claims to handle a case that cannot occur.
 */
const NOT_A_HUB_CODE = new Map<string, string>([
  // The SPA-fallback sentinel, minted client-side in api.ts when the portal
  // answers a route the gateway does not serve. Never sent by the hub, by
  // definition — it exists precisely because nothing was.
  ['gateway_route_unavailable', 'client-side sentinel — see UNAVAILABLE_CODE in api.ts'],
  // Minted client-side when the request never reached a hub at all: DNS
  // failure, connection refused, the hub powered off. The hub cannot emit it
  // for the same reason it cannot emit anything — it was not there. Note this
  // is NOT the hub's 502 `unreachable`, which is the hub reporting a DEVICE it
  // could not contact and therefore proof the hub itself is up.
  ['hub_unreachable', 'client-side sentinel — see HUB_UNREACHABLE_CODE in api.ts'],
]);

/**
 * Codes the APP itself mints, which are legitimate to branch on and are not the
 * hub's to emit.
 *
 * `src/lib/offline/` raises its own errors — a stored hub key that no longer
 * matches, a grant window the device believes has closed — and a screen must be
 * able to branch on those. They look identical to hub codes and come from a
 * different authority entirely, which is the distinction this file exists to
 * police in the other direction.
 *
 * They are collected from source rather than listed by hand, so adding one
 * cannot silently widen what this test accepts: it has to actually exist in the
 * app's own code.
 */
function appMintedCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of tsFilesUnder(path.join(repo, 'src/lib'))) {
    const src = readFileSync(file, 'utf-8');
    // `readonly code = 'x'` on an app error class, and `code: 'x'` in a
    // returned result object.
    for (const m of src.matchAll(/\breadonly\s+code\s*=\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
      codes.add(m[1]);
    }
    for (const m of src.matchAll(/\bcode:\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
      codes.add(m[1]);
    }
  }
  return codes;
}

/** Every error code any hub handler can put in an `error` field. */
function goEmittedCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of goFilesUnder(path.join(repo, 'hub/internal'))) {
    const src = readFileSync(file, 'utf-8');
    // writeErr(w, status, "code") and writeErrDetail(w, status, "code", ...)
    for (const m of src.matchAll(/writeErr(?:Detail)?\([^,]+,[^,]+,\s*"([a-z][a-z0-9_]*)"/g)) {
      codes.add(m[1]);
    }
    // Sentinel errors whose text IS the wire code (store.ErrInvite… etc).
    for (const m of src.matchAll(/errors\.New\("([a-z][a-z0-9_]*)"\)/g)) codes.add(m[1]);
    // Refusal-reason constants: the automations engine's vocabulary is the
    // API's vocabulary, passed through verbatim by writeRuleErr.
    for (const m of src.matchAll(/Reason[A-Za-z]*\s*=\s*"([a-z][a-z0-9_]*)"/g)) codes.add(m[1]);
    // The DenialReasons() list itself, which is written as bare strings.
    const denials = /func DenialReasons\(\) \[\]string \{[\s\S]*?\n\}/.exec(src);
    if (denials) {
      for (const m of denials[0].matchAll(/"([a-z][a-z0-9_]*)"/g)) codes.add(m[1]);
    }
    // A code written into a map literal, e.g. {"error": "..."}.
    for (const m of src.matchAll(/"error":\s*"([a-z][a-z0-9_]*)"/g)) codes.add(m[1]);
    // DENIAL REASONS. access_logs.error carries its own vocabulary —
    // rate_limited, quota_exceeded, outside_time_window and the rest — and the
    // admin views branch on those exactly the way other screens branch on an
    // HTTP error code. They come back in a log ROW rather than an error body,
    // but they drift the same way and go stale just as silently, so they belong
    // in the same corpus. channels.DenialReasons() is the canonical registry.
    for (const m of src.matchAll(/Reason:\s*"([a-z][a-z0-9_]*)"/g)) codes.add(m[1]);
  }
  return codes;
}

function goFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // dist/ is a build artifact — a stale compiled bundle in there would
      // otherwise supply codes that no longer exist in source.
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      out.push(...goFilesUnder(full));
    } else if (entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
      out.push(full);
    }
  }
  return out;
}

/** Codes the console compares against, with the file and line that does it. */
function tsBranchedCodes(): Map<string, string> {
  const branched = new Map<string, string>();
  for (const file of tsFilesUnder(path.join(repo, 'src'))) {
    const src = readFileSync(file, 'utf-8');
    src.split('\n').forEach((line, i) => {
      // `err.code === 'x'`, `out.error === 'x'`.
      //
      // `typeof body === 'string'` is deliberately excluded: it matched the
      // bare-`code` pattern and reported `string` and `object` as error codes,
      // which is the false-positive direction that teaches people to add
      // exemptions for things that were never codes at all.
      if (/\btypeof\b/.test(line)) return;
      for (const m of line.matchAll(
        /(?:\.code|\berror)\s*===\s*['"]([a-z][a-z0-9_]*)['"]/g,
      )) {
        branched.set(m[1], `${path.relative(repo, file)}:${i + 1}`);
      }
      // A comparison against a NAMED CONSTANT is invisible to the literal scan
      // above, so `err.code === SOME_CODE` slips through entirely. That is not
      // hypothetical — it is how a screen worked around this test rather than
      // resolving what it flagged, which is the failure mode a drift alarm has
      // to be hardest against: the workaround is easier than the fix and leaves
      // no trace. Resolve single-file constants and check them too.
      for (const m of line.matchAll(/(?:\.code|\berror)\s*===\s*([A-Z][A-Z0-9_]*)\b/g)) {
        const decl = new RegExp(
          `\\b${m[1]}\\b[^=]*=\\s*['"\`]([a-z][a-z0-9_]*)['"\`]`,
        ).exec(src);
        if (decl) branched.set(decl[1], `${path.relative(repo, file)}:${i + 1}`);
      }
    });
  }
  return branched;
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...tsFilesUnder(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('error code parity', () => {
  it('every error code the console branches on is one the hub can emit', () => {
    const emitted = goEmittedCodes();
    const app = appMintedCodes();
    const branched = tsBranchedCodes();

    const dead: string[] = [];
    for (const [code, where] of branched) {
      if (emitted.has(code)) continue;
      // Minted by the app itself — see appMintedCodes.
      if (app.has(code)) continue;
      if (NOT_A_HUB_CODE.has(code)) continue;
      dead.push(`  ✗ ${code}  (${where} — no hub handler emits this code)`);
    }

    expect(
      dead.length,
      `${dead.length} branch(es) handle an error code the hub never sends:\n\n` +
        dead.join('\n') +
        `\n\nA branch like this never matches, so the user sees the raw code or a ` +
        `generic fallback at exactly the moment a specific explanation mattered. ` +
        `Nothing throws and nothing logs. Either fix the code to match the hub, or ` +
        `DELETE the branch — a dead branch reads like a handled case forever.\n`,
    ).toBe(0);
  });

  it('both corpora are real, so a silent zero-match scan cannot pass this file', () => {
    const emitted = goEmittedCodes();
    expect(emitted.size).toBeGreaterThan(40);
    // Codes that must exist for the extraction to be believable.
    expect(emitted.has('invalid_credentials')).toBe(true);
    expect(emitted.has('forbidden')).toBe(true);

    const branched = tsBranchedCodes();
    expect(branched.size).toBeGreaterThan(5);
  });

  it('every exemption carries a reason', () => {
    for (const [code, reason] of NOT_A_HUB_CODE) {
      expect(reason.length, `${code} is exempted with no reason`).toBeGreaterThan(10);
    }
  });
});
