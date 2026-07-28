import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One component, one name.
 *
 * This repo spent a while calling its Go backend three different things:
 * `gateway/` on disk, "the hub" in prose, and `LINTEL_*` in every environment
 * variable an operator has to type. One of those names belongs to a different
 * product (Ephor is the gateway) and one belongs to a repo that no longer
 * exists (lintel was folded in and deleted).
 *
 * A name is not cosmetic when an operator has to type it. `LINTEL_ENERGY_TZ`
 * configures a product that is not called that, and a directory called
 * `gateway/` sends a reader looking for something this repo does not contain.
 *
 * # What this test does NOT forbid
 *
 * The word "gateway" is still correct in three places, and this test is careful
 * to allow all three — a rename that broke any of them would be much worse than
 * the inconsistency it fixed:
 *
 *   1. WIRE IDENTIFIERS. `gateway_key`, `gateway_pubkey`, `gateway_ed`,
 *      `gateway_next`, `gateway_sync`, and the route `/v1/gateway/key`. These
 *      are the frozen protocol a real door controller implements, pinned by
 *      proto/vectors/*.json. Renaming one breaks hardware in the field.
 *   2. EPHOR. Ephor genuinely is a gateway, and this product delegates the chat
 *      rail to it.
 *   3. THIRD PARTIES. The WhatsApp Cloud API and similar are gateways owned by
 *      someone else.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/** Occurrences that are correct and must survive. */
const ALLOWED = [
  // 1. Wire identifiers — frozen, pinned by the vectors, implemented by hardware.
  /gateway_key/,
  /gateway_pubkey/,
  /gateway_ed/,
  /gateway_next/,
  /gateway_sync/,
  /\/v1\/gateway\/key/,
  /\/v1\/gateway-key/,
  /gatewayKey/, // the TS reader for the same field
  // 2 and 3. Other people's gateways.
  /[Ee]phor/,
  /Cloud API/,
];

/**
 * Names that still say "lintel" and MUST. Both are wire identifiers whose
 * rename would break the offline emergency path — the one path that is used
 * precisely when there is no network to push a fix over.
 *
 *   _lintel._tcp            the mDNS service the phone browses for and every
 *                           deployed controller advertises; normative in
 *                           proto/grants.md
 *   lintel.offline-access   the IndexedDB holding the app signing key and every
 *                           stored grant. An IndexedDB name cannot be migrated
 *                           on read — opening a new name orphans the old
 *                           database rather than moving it.
 */
const LEGACY_WIRE_NAMES = [/_lintel\._tcp/, /lintel\.offline-access/, /lintel-<first/];

function isAllowed(line: string): boolean {
  return ALLOWED.some((re) => re.test(line));
}

/**
 * Files under dir matching the pattern, asserted non-trivial.
 *
 * The floor is the whole point, and it took a tamper to find out this file
 * needed one. Every guard below is shaped "scan the tree, collect offenders,
 * assert the list is empty" — which passes perfectly when the scan returns
 * NOTHING. Making walk() return an empty array left four of the five tests
 * green, including the one that keeps the gateway→hub rename from regressing.
 *
 * A scan can silently stop finding files for ordinary reasons: this file moves
 * and `repo` resolves elsewhere, the extension list loses an entry, an exclude
 * grows. In every case the guards go quiet rather than red, which is the worst
 * direction for a guard to fail in.
 *
 * `min` is deliberately a floor rather than an exact count — it must not need
 * updating every time a file is added.
 */
function walkAtLeast(dir: string, match: RegExp, min: number, what: string): string[] {
  const files = walk(dir, match);
  expect(
    files.length,
    `scanning ${what} found only ${files.length} files. Every check below reports ` +
      `"no offenders" on an empty scan, so this guard would go quiet rather than ` +
      `fail — verify the walk root and the extension pattern.`,
  ).toBeGreaterThanOrEqual(min);
  return files;
}

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, match, out);
    } else if (match.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the backend has one name', () => {
  it('no source or config file refers to a gateway/ directory or cmd/gateway binary', () => {
    const offenders: string[] = [];
    // Extension-keyed walking missed the Makefile, which kept pointing at
    // gateway/internal/portal/dist long after the rename — so `make portal`
    // copied the console into a directory that no longer existed. Build files
    // have no extension at all, which is exactly why they get skipped.
    // .rs included: src-tauri/ is a real part of this repo and its comments
    // pointed at src/lib/gateway.ts for several commits after that file was
    // renamed. The Rust CI job passes either way — fmt, check and clippy do not
    // read comments — so nothing would ever have said so.
    for (const file of walkAtLeast(
      repo,
      /\.(ts|tsx|mjs|js|go|rs|json|ya?ml|toml)$|^Makefile$|^Dockerfile$/,
      200,
      'the repo for gateway/ references',
    )) {
      const rel = path.relative(repo, file);
      // This file names the thing it forbids.
      if (rel.endsWith('naming.test.ts')) continue;
      const src = readFileSync(file, 'utf-8');
      src.split('\n').forEach((line, i) => {
        if (!/gateway\/(internal|cmd)|cmd\/gateway|working-directory: gateway|context: gateway/.test(line)) return;
        if (isAllowed(line)) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    expect(
      offenders,
      `these still point at the old gateway/ layout:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  // Every file and root named in the claims manifest must exist.
  //
  // check-feature-claims.mjs enforces this at run time now, but only when it
  // runs. This is the cheap version that fails in the ordinary unit suite, and
  // it exists because the failure it catches is invisible: a 'planned' claim
  // whose evidence path is mistyped reports "planned, no evidence (correct)"
  // forever. One did — it asserted Linux was the only BLE peripheral backing,
  // and stayed green for the whole period Windows support shipped.
  it('every path the feature-claims manifest names actually exists', () => {
    // Scanned as SOURCE rather than imported. The manifest is a .mjs with no
    // type declaration, so importing it fails `tsc -b` — and this file already
    // reads Go and config files as text for the same kind of check.
    //
    // Evidence items are flat object literals ({ file: '…', pattern: '…' }),
    // so matching brace-delimited blocks with no nesting is sufficient and
    // keeps the expectMissing marker attached to the item it belongs to.
    const src = readFileSync(path.join(repo, 'scripts/feature-claims.manifest.mjs'), 'utf-8');
    const blocks = src.match(/\{[^{}]*\}/g) ?? [];
    expect(blocks.length, 'no evidence blocks were parsed out of the manifest').toBeGreaterThan(10);

    const missing: string[] = [];
    let checked = 0;
    for (const b of blocks) {
      // A path whose ABSENCE is the signal (a generated directory) is allowed
      // to be absent — see checkItem in check-feature-claims.mjs.
      if (/expectMissing/.test(b)) continue;
      const m = /\b(?:file|root):\s*'([^']+)'/.exec(b);
      if (!m) continue;
      checked += 1;
      if (!existsSync(path.join(repo, m[1]))) missing.push(m[1]);
    }
    expect(checked, 'no file/root evidence paths were found to check').toBeGreaterThan(10);
    expect(
      missing,
      'the claims manifest points at paths that do not exist, so those claims check ' +
        'nothing:\n' + missing.join('\n'),
    ).toEqual([]);
  });

  // The Workers backend in backend/ was deleted by decision — the Go hub is
  // the only server. Sixteen files went on citing backend/src/routes/*.ts as
  // "the behavioral spec", present tense, long after there was anything to
  // open. That is worse than a stale comment: it tells a reader that the
  // authority for a route lives somewhere else, so a disagreement between the
  // hub and the console reads as "check the spec" rather than "decide". There
  // is no spec. What the hub serves is the contract.
  it('no source file cites the deleted backend/ directory as a path', () => {
    const offenders: string[] = [];
    for (const file of walkAtLeast(repo, /\.(ts|tsx|mjs|js|go|rs)$/, 200, 'the repo for backend/ citations')) {
      const rel = path.relative(repo, file);
      if (rel.endsWith('naming.test.ts')) continue; // names what it forbids
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (!/\bbackend\/(src|dist|node_modules)/.test(line)) return;
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        });
    }
    expect(
      offenders,
      `these cite backend/, which was deleted — the path resolves to nothing and ` +
        `the reader is sent looking for an authority that does not exist:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('no LINTEL_ environment variable is read or documented outside the compatibility layer', () => {
    const offenders: string[] = [];
    for (const file of walkAtLeast(
      repo,
      /\.(ts|tsx|mjs|js|go|ya?ml)$|^Dockerfile$|^Makefile$/,
      200,
      'the repo for LINTEL_ env vars',
    )) {
      const rel = path.relative(repo, file);
      // env.go IMPLEMENTS the fallback and env_test.go proves it works. Those
      // are the only two places the old prefix may appear in code — every
      // other reader must go through lookupEnv.
      if (rel === 'hub/cmd/hub/env.go' || rel === 'hub/cmd/hub/env_test.go') continue;
      if (rel.endsWith('naming.test.ts')) continue;
      const src = readFileSync(file, 'utf-8');
      src.split('\n').forEach((line, i) => {
        if (!/LINTEL_/.test(line)) return;
        if (LEGACY_WIRE_NAMES.some((re) => re.test(line))) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    expect(
      offenders,
      `these still name a LINTEL_ variable. The fallback in hub/cmd/hub/env.go ` +
        `keeps them WORKING, but an operator should never be told to type one:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('the wire identifiers are still present, so this test cannot pass by deleting them', () => {
    // The failure mode a naming rule invites: someone "fixes" the last
    // offenders by renaming a protocol field, the vectors break, and by then
    // the change is three commits back. Assert the protected names are alive.
    // Scanned across proto/ rather than asserted per-file: the first version
    // of this named grants.json and keys.json specifically and guessed the
    // wrong fields, which made the guard pass on nothing.
    const found = new Set<string>();
    for (const file of walkAtLeast(path.join(repo, 'proto'), /\.(json|md)$/, 5, 'proto/')) {
      for (const m of readFileSync(file, 'utf-8').matchAll(/gateway_[a-z_]+/g)) {
        found.add(m[0]);
      }
    }
    for (const wire of ['gateway_sync', 'gateway_pubkey', 'gateway_next', 'gateway_key', 'gateway_ed']) {
      expect(
        found.has(wire),
        `${wire} is gone from proto/. If that was a rename, it broke the wire ` +
          `format a deployed controller implements — the vectors and the ` +
          `hardware both still expect the old name.`,
      ).toBe(true);
    }
  });
});
