import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Paths cited in SOURCE COMMENTS must exist, the same rule docCitations holds
 * over Markdown.
 *
 * # Why a second guard rather than a wider net in the first
 *
 * docCitations scans `.md` under the repo root, `docs/` and `proto/`. That is
 * every document — and no code. The gap was not theoretical: `devices/mock.go`
 * claimed the deleted demo dataset "still owns"
 * what the console displays, for as long as the console had
 * been reading live engine state, and three store and channel files cited
 * a routes module, a rate-limit module and an access-lookup module
 * as though they were in this repository. None of those three has ever existed
 * here — they are lintel's, and DESIGN-SYSTEM.md had already been through a
 * pass that prefixed 104 such paths with `lintel/`. The Go files were simply
 * not in that pass's scope, because nothing scanned them.
 *
 * A comment citing a file that is not there is worse than one citing nothing.
 * It reads as a pointer, so the reader greps, finds nothing, and cannot tell
 * whether the file was deleted, renamed, or never in this repository at all.
 *
 * # Why the pattern differs from docCitations'
 *
 * Prose cites in backticks; code comments usually do not — "the backend
 * (a path in parentheses) is a stub" carries no markup. So this matches a bare
 * path, which means it must be much stricter about what a path is: it requires
 * a leading directory that actually exists at the repo root, and an extension
 * ending at a token boundary.
 *
 * That boundary is not a detail. Written without it, the alternation matched
 * `grants.js` inside `grants.json` and `Signup.ts` inside `Signup.tsx`, and the
 * first run of this scan reported 41 dangling citations of which 28 were the
 * detector misreading its own matches. A detector whose pattern is wrong
 * produces exactly the confident, specific, false output it exists to prevent.
 *
 * # What this does NOT check
 *
 * That the surrounding sentence is TRUE. Every path in `mock.go` resolved while
 * the sentence containing one was false. This catches a pointer to nowhere,
 * which is the mechanical half; the claim itself is still on the reader.
 */

const root = resolve(__dirname, '../../..');

/** Directories not worth walking, and not ours. */
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'target',
  '.svelte-kit',
  'playwright-report',
  'test-results',
]);

const SOURCE = /\.(?:go|ts|tsx|mjs)$/;

/**
 * Other repositories in the Vulos suite, by prefix. Same list and same reason as
 * docCitations: these are deliberate references to work that lives elsewhere and
 * cannot be checked from here. `lintel/` is the predecessor this repository was
 * folded out of, and is the correct prefix for a path that was never here.
 */
const EXTERNAL_REPOS = [
  'ephor/',
  'kotva/',
  'lintel/',
  'substrate/',
  'flowstock/',
  'crates/',
  'coordinator/',
  'adapters/',
  'bindings/',
  'vectors/',
];

/**
 * Files whose comments name absent paths ON PURPOSE, because the absent path is
 * the subject rather than a pointer.
 *
 * Both entries are guards that carry example or historical paths as DATA. A
 * guard listing "the citation that is allowed to dangle" would be broken by a
 * rule that forbids naming a dangling citation anywhere, which is the shape of
 * a check eating its own tail.
 *
 * Keyed by file, so a stale path elsewhere cannot be laundered by one entry.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/__tests__/docCitations.test.ts':
    'the doc-citation guard itself: its HISTORICAL table and its worked example ' +
    'both name paths that are deliberately absent',
  'src/lib/__tests__/naming.test.ts':
    'the naming guard names the forbidden spelling it exists to reject',
  'scripts/feature-claims.manifest.mjs':
    'records where a deleted file used to live, in the past tense, as evidence ' +
    'about what was removed',
};

function sourceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (SOURCE.test(entry)) out.push(p.slice(root.length + 1));
    }
  })(root);
  return out;
}

/**
 * Top-level directories a citation may start with. Derived from the repository
 * rather than hard-coded, so a new top-level directory is covered the day it
 * appears instead of the day someone remembers this list.
 */
function topLevelDirs(): string[] {
  return readdirSync(root).filter(
    (e) => !SKIP.has(e) && !e.startsWith('.') && statSync(join(root, e)).isDirectory(),
  );
}

/**
 * A bare path citation: a real top-level directory, at least one separator, and
 * an extension that ENDS the token.
 *
 * The trailing `(?![A-Za-z0-9_])` is what stops `.ts` from matching inside
 * `.tsx` and `.js` inside `.json`. Longest extensions come first for the same
 * reason.
 */
function citationPattern(dirs: string[]): RegExp {
  return new RegExp(
    `(?:^|[\\s\`("'\\[])((?:${dirs.join('|')})\\/[A-Za-z0-9_./-]*` +
      `\\.(?:tsx|ts|go|sql|mjs|json|js|css|html|md|sh|yaml|yml|rs))(?![A-Za-z0-9_])`,
    'g',
  );
}

/** Whether a line is a comment. Deliberately crude — see the test below. */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#');
}

describe('source-comment citations', () => {
  const dirs = topLevelDirs();
  const pattern = citationPattern(dirs);

  /** Dangling citations per file, using this guard's own scan rather than a
   * second copy of it. A separate counter written to answer the same question
   * gave the wrong answer twice — reusing the real path is the only way the
   * two cannot disagree. */
  function danglingByFile(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const file of sourceFiles()) {
      const text = readFileSync(resolve(root, file), 'utf-8');
      for (const line of text.split('\n')) {
        if (!isComment(line)) continue;
        for (const m of line.matchAll(pattern)) {
          const path = m[1];
          if (EXTERNAL_REPOS.some((p) => path.startsWith(p))) continue;
          if (existsSync(resolve(root, path))) continue;
          out.set(file, [...(out.get(file) ?? []), path]);
        }
      }
    }
    return out;
  }

  /**
   * An exemption must still be needed.
   *
   * ALLOWED skips a whole file, so an entry that outlives its dangling citation
   * silently widens what this guard permits — and the next real one in that file
   * is invisible. Tampering found the hole: adding a clean file to ALLOWED
   * changed nothing.
   *
   * The same shape as noPhoneHome's root list and repoLayout's NOT_IN_TREE, both
   * fixed this session: an exemption list that nothing validates is an escape
   * hatch, and the check has to come from outside the list.
   */
  it('every exemption is still needed', () => {
    const dangling = danglingByFile();
    const unnecessary = Object.keys(ALLOWED).filter((f) => !dangling.has(f));
    expect(
      unnecessary,
      'these files are exempted but have no dangling citation, so the entry only ' +
        'hides whatever appears there next — remove it:\n  ' + unnecessary.join('\n  '),
    ).toEqual([]);
  });

  it('every path a source comment cites exists', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const file of sourceFiles()) {
      if (ALLOWED[file] !== undefined) continue;
      const text = readFileSync(resolve(root, file), 'utf8');
      for (const line of text.split('\n')) {
        if (!isComment(line)) continue;
        for (const m of line.matchAll(pattern)) {
          const path = m[1];
          if (EXTERNAL_REPOS.some((p) => path.startsWith(p))) continue;
          checked++;
          if (!existsSync(resolve(root, path))) broken.push(`${file} cites ${path}`);
        }
      }
    }
    // The guard on the guard. A pattern that matched nothing — one bad
    // character in the alternation is enough — would pass this test forever
    // while checking not one citation.
    expect(checked, 'no source citations parsed — the pattern has drifted').toBeGreaterThan(120);
    expect(broken, `${broken.length} source comments point at files that do not exist`).toEqual([]);
  });

  /**
   * The scan must actually reach the packages that carry these comments.
   *
   * Counting citations alone would not catch a walker that stopped at the first
   * directory: `src/` alone contains enough to clear the floor above while
   * every Go file went unread, which is precisely where the defects were.
   */
  it('the scan reaches Go, TypeScript and script sources alike', () => {
    const files = sourceFiles();
    for (const [label, prefix] of [
      ['hub Go sources', 'hub/internal/'],
      ['controller Go sources', 'controller/internal/'],
      ['console TypeScript', 'src/'],
      ['scripts', 'scripts/'],
    ] as const) {
      expect(
        files.filter((f) => f.startsWith(prefix)).length,
        `${label} were not scanned at all`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The extension boundary, pinned directly.
   *
   * This is the bug the first version of this scan shipped with, and it is
   * invisible in a green run: a truncating pattern reports MORE findings, not
   * fewer, so it looks like a thorough check right up until someone tries to
   * act on one.
   */
  it('an extension must end the token', () => {
    const p = citationPattern(['src', 'proto']);
    const found = (s: string) => [...s.matchAll(p)].map((m) => m[1]);

    expect(found('see proto/vectors/grants.json for the corpus')).toEqual([
      'proto/vectors/grants.json',
    ]);
    expect(found('see src/pages/Signup.tsx for the form')).toEqual(['src/pages/Signup.tsx']);
    // And the plain cases still match.
    expect(found('see src/lib/api.ts')).toEqual(['src/lib/api.ts']);
  });

  /**
   * Prose must not be mistaken for a path. A citation needs a real top-level
   * directory and a separator, so ordinary sentences cannot match.
   */
  it('prose is not mistaken for a citation', () => {
    const p = citationPattern(['src', 'hub']);
    for (const line of [
      '// the hub is the server and the src is the console',
      '// a ratio of 3.5 to 1',
      '// see the README for hub/controller wiring',
    ]) {
      expect([...line.matchAll(p)].map((m) => m[1]), line).toEqual([]);
    }
  });
});
