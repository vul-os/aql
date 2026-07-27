import { readFileSync, readdirSync } from 'node:fs';
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
    for (const file of walk(repo, /\.(ts|tsx|mjs|js|go|json|ya?ml|toml)$/)) {
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

  it('no LINTEL_ environment variable is read or documented outside the compatibility layer', () => {
    const offenders: string[] = [];
    for (const file of walk(repo, /\.(ts|tsx|mjs|js|go|ya?ml)$|^Dockerfile$|^Makefile$/)) {
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
    for (const file of walk(path.join(repo, 'proto'), /\.(json|md)$/)) {
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
