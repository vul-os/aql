import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Reclamation code that nothing calls, across both Go modules.
 *
 * Five components in this repo have been correct, tested and never invoked.
 * TWO of the five were reclaim paths:
 *
 *   - energy.PruneSamples — written, carefully guarded (it refuses while a
 *     rollup is pending), never called. The samples table grew forever.
 *   - events.Queue.Compact — written, with its own passing test, never called.
 *     The controller's durable log grew forever on the device in this system
 *     with the least storage.
 *
 * That is not a coincidence worth ignoring. Nobody misses reclamation until a
 * disk is full, months later, on a machine nobody is watching — so it is the
 * category least likely to be caught by anyone using the product, and the one
 * most worth a test. Both were found by a hand-run scan; this is that scan.
 *
 * It lives here rather than in either Go module because it spans both, the way
 * naming.test.ts spans the repo. Vitest is simply what runs a cross-module
 * source check in this codebase.
 *
 * NARROW ON PURPOSE. It matches function names by shape (Compact/Prune/Expire/
 * …), so it catches the category and not dead code generally — the per-module
 * guards do that. A reclaim function named something else entirely slips
 * through, which is the honest cost of a check this cheap.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

/** Each entry is a claim that production genuinely never calls it. */
const ALLOWED_UNCALLED: Record<string, string> = {
  ExpireDeviceClaim:
    'A test/dev hook that says so at its own declaration: it force-expires a pending ' +
    'claim so tests can time-travel, and no route exposes it. Exposing it would let a ' +
    'caller cancel someone else’s pairing, so staying unreachable is the point.',
};

const RECLAIM = /^func (?:\([^)]*\) )?((?:Compact|Prune|Expire|Cleanup|Vacuum|Trim|Purge|Evict|Reclaim|Sweep|Rotate)\w*)\(/gm;

function goFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'testdata' || entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) goFiles(p, out);
    else if (p.endsWith('.go') && !p.endsWith('_test.go')) out.push(p);
  }
  return out;
}

describe('every reclaim path has a production caller', () => {
  const files = [
    ...goFiles(path.join(repo, 'hub')),
    ...goFiles(path.join(repo, 'controller')),
  ];
  const bodies = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]));

  it('scanned both Go modules (a walk that found nothing would pass)', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.includes(`${path.sep}hub${path.sep}`))).toBe(true);
    expect(files.some((f) => f.includes(`${path.sep}controller${path.sep}`))).toBe(true);
  });

  it('finds reclaim functions at all', () => {
    let n = 0;
    for (const body of bodies.values()) n += [...body.matchAll(RECLAIM)].length;
    // If this hits zero the pattern has drifted from how the code is written,
    // and the test below would pass while checking nothing.
    expect(n).toBeGreaterThan(2);
  });

  it('has no reclaim path that only tests call', () => {
    const declared = new Map<string, string>();
    for (const [file, body] of bodies) {
      for (const m of body.matchAll(RECLAIM)) declared.set(m[1], file);
    }

    const orphans: string[] = [];
    for (const [name, declFile] of declared) {
      if (name in ALLOWED_UNCALLED) continue;
      const re = new RegExp(`\\.${name}\\(`);
      const called = [...bodies].some(([f, body]) => f !== declFile && re.test(body));
      if (called) continue;
      orphans.push(`  ${name}  (${path.relative(repo, declFile)})`);
    }

    expect(
      orphans.sort(),
      `these reclaim paths have no production caller:\n${orphans.join('\n')}\n\n` +
        `Both times this happened, the code was correct and the storage it was meant to ` +
        `bound grew without limit until someone went looking. Wire it to something that ` +
        `runs on its own — a poll cycle, a startup pass — rather than to a call site a ` +
        `future caller has to remember. If production genuinely never calls it, add it to ` +
        `ALLOWED_UNCALLED with a reason.`,
    ).toEqual([]);
  });

  it('has no stale allowlist entry', () => {
    const declared = new Set<string>();
    for (const body of bodies.values()) {
      for (const m of body.matchAll(RECLAIM)) declared.add(m[1]);
    }
    const stale = Object.keys(ALLOWED_UNCALLED).filter((n) => !declared.has(n));
    expect(stale, `ALLOWED_UNCALLED names functions that no longer exist: ${stale.join(', ')}`).toEqual(
      [],
    );
  });
});
