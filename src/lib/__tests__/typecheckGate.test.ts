import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The typecheck gate must type-check something.
//
// # What happened
//
// The root tsconfig.json is a solution file — `"files": []` and two references —
// so `tsc --noEmit` resolves to an empty program, finds no errors, and exits 0
// on any tree whatsoever. ci.yml worked this out at some point and switched to
// `npm run typecheck` (`tsc -b --noEmit`), leaving a comment that says "it did
// exactly that until it was caught".
//
// scripts/check.sh kept `npx tsc --noEmit`. So the lesson was applied to one of
// the two places that run this gate, and the local one — the one a person runs
// before every commit — went on reporting green while `npm run build` failed
// with six type errors in a console page that consequently could not be built at
// all. The stale bundle already sitting in the embed directory meant even the
// tagged binary still linked, which is how it stayed invisible.
//
// # Why a test rather than a comment
//
// Both invocations look correct. The difference is one flag, the failure is
// silent, and the correct form has already been reverted once. So this asserts
// the two runners agree, and asserts the REASON — that the root config is a
// solution file — so that whoever makes it a normal config sees why the rule
// exists instead of finding a flag they cannot justify.

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('the typecheck gate', () => {
  it('is only needed because the root config checks nothing by itself', () => {
    const cfg = JSON.parse(
      read('tsconfig.json').replace(/^\s*\/\/.*$/gm, ''),
    ) as { files?: unknown[]; include?: unknown[]; references?: unknown[] };

    // If this ever stops being true, `tsc --noEmit` becomes meaningful and the
    // rule below can be relaxed — deliberately, by whoever changed it.
    const checksNothingAlone =
      Array.isArray(cfg.files) && cfg.files.length === 0 && !cfg.include?.length;
    expect(
      checksNothingAlone,
      `tsconfig.json is no longer an empty solution file, so a bare \`tsc --noEmit\`
may now check real files. Re-derive the rule below before changing it.`,
    ).toBe(true);
    expect(cfg.references?.length ?? 0).toBeGreaterThan(0);
  });

  it('runs the same command in check.sh and in CI', () => {
    const check = read('scripts/check.sh');
    const ci = read('.github/workflows/ci.yml');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    expect(pkg.scripts.typecheck, 'the typecheck script must build the references').toContain('-b');

    // A bare `tsc --noEmit` anywhere in either runner is the bug itself. The
    // pattern deliberately allows `tsc -b --noEmit`.
    for (const [name, body] of [
      ['scripts/check.sh', check],
      ['.github/workflows/ci.yml', ci],
    ] as const) {
      const bare = body.match(/^[^#\n]*\btsc\s+(?!-b\b)[^\n]*--noEmit/gm) ?? [];
      expect(
        bare,
        `${name} invokes tsc without -b. The root tsconfig has "files": [], so that
form type-checks nothing and passes on a tree that cannot build.`,
      ).toEqual([]);
    }

    expect(check).toContain('npm run typecheck');
    expect(ci).toContain('npm run typecheck');
  });

  it('rejects the broken form and accepts the working one', () => {
    // The control. Without it a pattern that matches nothing would make the
    // check above pass on a file containing the exact bug.
    const bad = /^[^#\n]*\btsc\s+(?!-b\b)[^\n]*--noEmit/gm;
    expect('run "tsc" . npx tsc --noEmit'.match(bad)).not.toBeNull();
    expect('  - run: npx tsc --noEmit'.match(bad)).not.toBeNull();
    expect('run "tsc" . npm run typecheck'.match(bad)).toBeNull();
    expect('  - run: npx tsc -b --noEmit'.match(bad)).toBeNull();
    // A mention inside a comment is prose, not an invocation.
    expect('# a plain `tsc --noEmit` checks nothing'.match(bad)).toBeNull();
  });
});
