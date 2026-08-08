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

  /**
   * Every Go MODULE must also appear in the subsystem table.
   *
   * The layout tree and that table are two lists of the same thing for two
   * audiences, and fixing one taught nothing about the other: jcs/ was missing
   * from BOTH, and adding it to the tree left the table still silent about the
   * module every signature passes through.
   *
   * Modules are the right unit here because they are enumerable — a go.mod is
   * an unambiguous fact — and because a module is the largest thing that can
   * hide. A package inside hub/ is reached by reading hub/; a sibling module is
   * reached only by knowing it is there.
   */
  it('names every Go module in the subsystem table', () => {
    const modules = readdirSync(root)
      .filter((e) => !e.startsWith('.') && e !== 'node_modules')
      .filter((e) => statSync(resolve(root, e)).isDirectory())
      .filter((e) => existsSync(resolve(root, e, 'go.mod')));

    expect(modules.length, 'found no Go modules — the walk has drifted').toBeGreaterThan(2);

    const text = readFileSync(resolve(root, 'ARCHITECTURE.md'), 'utf-8');
    const rows = [...text.matchAll(/^\| \*\*([^*]+)\*\*/gm)].map((m) => m[1]);
    expect(rows.length, 'parsed no subsystem rows').toBeGreaterThan(5);

    const missing = modules.filter(
      (m) => !rows.some((r) => r.split(/[ /(]/).includes(m)),
    );
    expect(
      missing,
      `these Go modules are absent from ARCHITECTURE.md's subsystem table. A sibling ` +
        `module is reached only by knowing it is there:\n  ` + missing.join('\n  '),
    ).toEqual([]);
  });

  /**
   * Every NOT_IN_TREE entry must be build output, checked against git rather
   * than against its own prose.
   *
   * Without this the list is a silent escape hatch: adding `jcs` to it hides
   * the module again and nothing fails — undoing, with one line, the fix that
   * put it in the tree. Verified by tampering, and it is the same self-
   * referential shape as noPhoneHome's root list, where iterating the constant
   * to check the constant meant deleting an entry deleted its own check.
   *
   * `git check-ignore` is the independent fact. The comment on NOT_IN_TREE says
   * build output only; this is that sentence made mechanical, so an exemption
   * for a real component fails on what git knows rather than on what the entry
   * claims about itself.
   */
  it('exempts only build output', () => {
    const entries = Object.keys(NOT_IN_TREE);
    expect(entries.length, 'NOT_IN_TREE is empty — this check has nothing to hold').toBeGreaterThan(1);
    // Trailing slash, so the question is asked about a DIRECTORY.
    //
    // Every entry here names a directory, and .gitignore spells them as
    // directory patterns (`/test-results/`). `git check-ignore test-results`
    // — no slash — can only match such a pattern when the directory happens
    // to exist on disk, so this passed locally, where a Playwright run had
    // left one behind, and failed in CI, where nothing had created it yet.
    // The test was reporting "test-results is tracked by git" about a
    // directory that did not exist and is not tracked anywhere.
    const tracked = entries.filter((d) => {
      try {
        execFileSync('git', ['check-ignore', '-q', `${d}/`], { cwd: root });
        return false;
      } catch {
        return true;
      }
    });
    expect(
      tracked,
      'these NOT_IN_TREE entries are tracked by git, so they are components rather ' +
        'than build output and belong in the layout tree — an exemption is not a ' +
        'place to put something you did not want to document:\n  ' + tracked.join('\n  '),
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

describe('every build constraint is compiled by some gate', () => {
  /**
   * A file behind a build tag the local machine does not satisfy is invisible.
   * Not "untested" — invisible: nothing typechecks it, so a plain type error
   * lives there indefinitely while every gate prints ok.
   *
   * It happened twice, one module apart. `go test -tags ble` ran 296 tests on
   * darwin and so did no tag at all, because the only file behind that tag is
   * `ble && (linux || windows)`. And `!unix` in hub/internal/recording never
   * compiles on a Mac, since darwin IS unix. A type error appended to either
   * passed the whole suite.
   *
   * check.sh now cross-vets for the platforms those files belong to. This test
   * is the part that does not rot: it fails when a NEW constraint appears, so
   * the person adding one has to say which gate compiles it rather than
   * discovering months later that nothing does.
   */
  const COVERED_BY: Record<string, string> = {
    // tag → the gate that compiles files under it
    'gpio': 'controller: go test -tags gpio (darwin)',
    'gpio && linux': 'controller: go vet (linux, -tags gpio)',
    'gpio && !linux': 'controller: go test -tags gpio (darwin)',
    '!gpio': 'controller: go test (no tags)',
    'ble && (linux || windows)': 'controller: go vet (linux/windows, -tags ble)',
    '!ble || (ble && !linux && !windows)': 'controller: go test, and -tags ble on darwin',
    'portal': 'hub: go test -tags portal',
    '!portal': 'hub: go test (no tags)',
    'unix': 'hub: go test (darwin is unix)',
    '!unix': 'hub: go vet (windows)',
  };

  it('no build constraint exists that no gate compiles', () => {
    const out = execFileSync(
      'grep',
      ['-rh', '--include=*.go', '^//go:build', 'hub', 'controller', 'e2e', 'jcs'],
      { cwd: root, encoding: 'utf8' },
    );
    const found = new Set(
      out
        .split('\n')
        .filter(Boolean)
        .map((l) => l.replace(/^\/\/go:build\s*/, '').trim()),
    );

    const unknown = [...found].filter((c) => !(c in COVERED_BY)).sort();
    expect(
      unknown,
      'these build constraints are new — add the gate in scripts/check.sh that ' +
        'compiles them, then list it in COVERED_BY. A file no gate compiles is ' +
        'not merely untested: nothing typechecks it at all.',
    ).toEqual([]);

    // And the reverse, so the map does not accumulate entries for tags that no
    // longer exist and quietly stop describing this repo.
    const stale = Object.keys(COVERED_BY).filter((c) => !found.has(c)).sort();
    expect(stale, 'COVERED_BY lists constraints that no file uses any more').toEqual([]);

    expect(found.size, 'no build constraints parsed — the grep has drifted').toBeGreaterThan(8);
  });
});
