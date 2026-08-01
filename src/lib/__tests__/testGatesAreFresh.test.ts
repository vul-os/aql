import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every `go test` gate re-runs; none may serve a cached result.
 *
 * # Why this exists
 *
 * The hub and controller modules read the shared conformance corpus in
 * `proto/vectors/` from OUTSIDE their own module tree, and Go does not
 * invalidate a cached test result when that changes. Verified rather than
 * assumed: editing `grants.json` so a test MUST fail leaves
 * `go test ./internal/keys/` reporting `ok (cached)`, while `-count=1` on the
 * identical tree reports FAIL.
 *
 * That is not hypothetical here. The hub's INDEPENDENT grant verifier — the one
 * whose whole job is to disagree with the implementation when the
 * implementation is wrong — sat accepting a revoked grant for two commits while
 * `check.sh` reported 14 of 14 gates passing, because the corpus had gained a
 * vector and the cached result stood.
 *
 * # Why a test rather than a comment
 *
 * `-count=1` reads like noise. It costs seconds, it has no visible effect on a
 * green run, and the obvious tidy-up is to delete it. This makes that deletion
 * fail, which is the only reason the flag will still be there in six months.
 *
 * A gate that can report a stale PASS is worse than no gate, because it is
 * believed.
 */

const root = resolve(__dirname, '../../..');

/** Every line that invokes `go test`, with its source and line number. */
function goTestLines(): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const rel of ['scripts/check.sh', '.github/workflows/ci.yml']) {
    const path = resolve(root, rel);
    if (!existsSync(path)) continue;
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        // Command lines only. A comment mentioning `go test` is prose, and
        // matching it would force the flag into sentences describing the
        // problem — which is how a guard starts constraining its own docs.
        if (text.trim().startsWith('#')) return;
        // A YAML step NAME can be "go test" and is not a command. Matching it
        // demanded the flag inside a label, which was this test's first result.
        if (/^\s*-?\s*name:/.test(text)) return;
        if (!/\bgo test\b/.test(text)) return;
        out.push({ file: rel, line: i + 1, text: text.trim() });
      });
  }
  return out;
}

describe('go test gates', () => {
  it('every go test invocation re-runs instead of trusting the cache', () => {
    const lines = goTestLines();
    // A parser that found nothing would pass forever. Both files invoke it
    // several times each.
    expect(lines.length, 'no `go test` invocations found — did the gates move?').toBeGreaterThan(8);

    const cached = lines
      // `-list` and `-fuzz` runs enumerate or fuzz rather than assert, and a
      // cached result is not a thing either can return.
      .filter((l) => !/-list=|-fuzz\b/.test(l.text))
      .filter((l) => !/-count=1\b/.test(l.text))
      .map((l) => `${l.file}:${l.line}  ${l.text}`);

    expect(
      cached,
      'these can serve a cached PASS. The modules read proto/vectors/ from outside their ' +
        'own tree and Go does not invalidate on it — which is how a broken verifier sat ' +
        'green for two commits. Add -count=1.',
    ).toEqual([]);
  });
});

/**
 * Every guard that ENUMERATES a corpus must assert it found one.
 *
 * # The defect this catches, which is this repository's most common
 *
 * A guard that walks a directory and checks each hit is worthless the moment
 * the walk returns nothing: it reports PASS having examined zero things, and a
 * pass that examined zero things is indistinguishable from a pass that examined
 * everything. One bad character in a glob is enough. Four separate detectors
 * written in this session failed exactly this way, and each was caught only by
 * deliberately breaking its pattern and watching it stay green.
 *
 * So a coverage floor -- `expect(n).toBeGreaterThan(...)` on what the scan
 * actually found -- is not decoration on these tests. It is the part that makes
 * the rest of the assertions mean anything.
 *
 * # Why "enumerates" and not "reads a file"
 *
 * The first version of this check counted `readFileSync` as scanning and
 * reported five copy-guards as floorless. All five were fine: they read ONE
 * named file and assert on its contents, and if that file disappears the read
 * throws. A floor over a corpus of one is meaningless. Only enumeration --
 * readdirSync, a glob, execFileSync feeding a list -- creates the failure mode
 * above.
 *
 * # What this does NOT check
 *
 * That the floor is set sensibly. A floor of 1 on a corpus of 300 passes here
 * and catches almost nothing. Numbers are a judgement this cannot make; what it
 * can do is refuse the case of no floor at all.
 */
describe('guards that enumerate a corpus assert they found one', () => {
  const dir = resolve(__dirname);
  const ENUMERATES = /readdirSync|execFileSync|globSync|\bglob\(/;
  const HAS_FLOOR = /toBeGreaterThan(OrEqual)?\(|toHaveLength\(/;

  /** Guards that enumerate and legitimately cannot floor. Empty, and see above. */
  const NO_FLOOR_OK = new Set<string>();

  it('every enumerating guard has a coverage floor', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts'));
    const enumerating = files.filter((f) => ENUMERATES.test(readFileSync(resolve(dir, f), 'utf-8')));

    // The guard on this guard. If the pattern stops matching, this test starts
    // examining nothing — which is the very failure it exists to name.
    expect(
      enumerating.length,
      'no enumerating guards found — this check has become the thing it warns about',
    ).toBeGreaterThan(10);

    const floorless = enumerating.filter(
      (f) => !NO_FLOOR_OK.has(f) && !HAS_FLOOR.test(readFileSync(resolve(dir, f), 'utf-8')),
    );
    expect(
      floorless,
      'these guards walk a corpus and never assert they found one, so an empty ' +
        'walk would pass forever:\n  ' + floorless.join('\n  '),
    ).toEqual([]);
  });
});
