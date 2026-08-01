import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ARCHITECTURE.md's repo-layout tree must name every tracked top-level
 * directory, and every directory it names must exist.
 *
 * # Why this direction matters, and it is the one nothing checked
 *
 * `jcs/` — the shared RFC 8785 canonicalizer, its own Go module, required by
 * BOTH hub and controller, and therefore the thing that decides what a
 * signature actually covers — was absent from that tree. Not marked unbuilt,
 * not marked planned: simply not there. Every check in this repository looks
 * doc→code (does the thing this doc names exist?), so a component nobody wrote
 * down is invisible to all of them.
 *
 * That is the same directional blindness the guards keep being caught by, in a
 * new place: source→doc is the direction where an omission lives, and an
 * omission is worse than a wrong label, because a wrong label at least tells a
 * reader the subject exists.
 *
 * # Why the tree, specifically
 *
 * ARCHITECTURE.md's status claims have needed five corrections this session and
 * three were in drawings. The tree is the one structure that is fully
 * mechanical — every line pairs a path with a 🟢/🔨 marker — so it is the part
 * that can be held rather than re-read.
 */

const root = resolve(__dirname, '../../..');

/**
 * Directories deliberately absent from the tree, with the reason.
 *
 * Build output only. Anything that is a component belongs in the tree, and
 * "it is small" is not a reason — jcs/ is four files and decides what a
 * signature covers.
 */
const NOT_IN_TREE: Record<string, string> = {
  node_modules: 'installed dependencies',
  dist: 'build output, gitignored',
  'test-results': 'Playwright output, gitignored',
};

/** Top-level directories git actually tracks. */
function trackedTopLevelDirs(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' })
    .toString('utf-8')
    .split('\0')
    .filter(Boolean);
  const dirs = new Set<string>();
  for (const p of out) {
    const slash = p.indexOf('/');
    if (slash > 0) dirs.add(p.slice(0, slash));
  }
  return [...dirs].sort();
}

/** Directory names the tree block mentions, however they are laid out. */
function treeNames(): { names: Set<string>; block: string } {
  const text = readFileSync(resolve(root, 'ARCHITECTURE.md'), 'utf-8');
  const start = text.indexOf('### Repo layout');
  expect(start, 'ARCHITECTURE.md has no "### Repo layout" section').toBeGreaterThan(-1);
  const open = text.indexOf('```', start);
  const close = text.indexOf('```', open + 3);
  const block = text.slice(open, close);
  const names = new Set<string>();
  // The leading dot is part of the name: without it this could not see
  // `.github/` and reported it missing after it had been added.
  for (const m of block.matchAll(/(\.?[A-Za-z0-9_-]+)\//g)) names.add(m[1]);
  return { names, block };
}

describe('the repo-layout tree', () => {
  it('names every tracked top-level directory', () => {
    const { names, block } = treeNames();

    // The guard on the guard: a parse that stopped finding entries would let
    // every directory through as "not required".
    expect(
      names.size,
      'parsed no directory names from the layout block — the pattern has drifted',
    ).toBeGreaterThan(8);
    expect(block).toMatch(/hub\//);

    const missing = trackedTopLevelDirs().filter(
      (d) => !names.has(d) && NOT_IN_TREE[d] === undefined,
    );
    expect(
      missing,
      `these tracked directories are not in ARCHITECTURE.md's repo layout. A component ` +
        `nobody wrote down is invisible to every doc→code check in this repository — ` +
        `jcs/, the canonicalizer both modules sign through, sat outside it. Add them, or ` +
        `add them to NOT_IN_TREE with a reason:\n  ` + missing.join('\n  '),
    ).toEqual([]);
  });

  it('names nothing that does not exist', () => {
    const { names } = treeNames();
    const phantom = [...names].filter((n) => {
      // Only top-level names are checkable here; a nested one (migrations/,
      // vectors/) lives under a parent this test does not resolve.
      const p = resolve(root, n);
      return !existsSync(p) && !existsSync(resolve(root, 'hub/internal/store', n));
    });
    // Nested and illustrative names are expected; what must not happen is a
    // TOP-LEVEL entry pointing at nothing.
    const topLevelPhantom = phantom.filter((n) =>
      readFileSync(resolve(root, 'ARCHITECTURE.md'), 'utf-8').includes(`── ${n}/`),
    );
    expect(
      topLevelPhantom,
      'the layout tree lists top-level directories that do not exist',
    ).toEqual([]);
  });

  it('marks every top-level entry it lists', () => {
    const { block } = treeNames();
    const unmarked: string[] = [];
    for (const line of block.split('\n')) {
      if (!/^[├└]── /.test(line.trim())) continue;
      // Only the pseudo-entry, whose NAME is parenthesised. The first version
      // of this skipped any line containing a bracket, which is nearly every
      // line — `docs/ # 🟢 deep engineering reference (threat model, ...)` — so
      // the assertion examined almost nothing and passed while a real entry
      // lost its marker. Found by tampering; reading it did not show it.
      if (/^[├└]── \(/.test(line.trim())) continue;
      if (!/🟢|🔨/.test(line)) unmarked.push(line.trim());
    }
    expect(
      unmarked,
      'these tree entries carry no status marker, so they claim nothing and cannot go stale ' +
        'in a way anything would notice:\n  ' + unmarked.join('\n  '),
    ).toEqual([]);
  });

  it('every 🟢 top-level entry has source in it', () => {
    const text = readFileSync(resolve(root, 'ARCHITECTURE.md'), 'utf-8');
    const empty: string[] = [];
    for (const m of text.matchAll(/^[├└]── (\.?[A-Za-z0-9_-]+)\/[^\n]*🟢/gm)) {
      const dir = resolve(root, m[1]);
      if (!statSync(dir).isDirectory() || readdirSync(dir).length === 0) empty.push(m[1]);
    }
    expect(empty, 'marked 🟢 but empty or absent').toEqual([]);
  });
});
