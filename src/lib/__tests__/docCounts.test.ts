import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Every count the documentation states, checked against the thing it counts.
 *
 * `check:claims` catches a feature documented as shipped with no code behind it,
 * and the reverse. It cannot catch a NUMBER, because a number is true when it is
 * written and false a week later with nobody having touched the sentence.
 *
 * That has happened here over and over, and every instance was found by hand:
 *
 *   - ARCHITECTURE said "7 migrations, 22 tables"; there were 19 and 42.
 *   - ROADMAP said "111 HTTP routes"; there were 109.
 *   - Later: ARCHITECTURE said "60 HTTP routes, 219 Go tests across 8 packages",
 *     which had drifted to 126, 1,056 and 17 — the tests off by a factor of five.
 *   - site/docs/self-host.md said 127 routes against 126. An off-by-one is worse
 *     than a large error, because nothing about it looks wrong.
 *   - docs/MULTI-HUB.md carried a NOTE correcting one of these, and the note went
 *     stale twice. It ended by advising the reader to re-derive rather than trust
 *     it, which is this file.
 *
 * # Why it fails when the sentence changes, not just when the number does
 *
 * Each claim is a regex with one capture group. A claim whose pattern no longer
 * matches FAILS rather than being skipped. A guard that quietly stops checking
 * when someone rewords a paragraph is worse than no guard, because the docs go on
 * looking guarded — and rewording is exactly what happens to these sentences.
 *
 * # What it does not do
 *
 * It does not check prose. "more than 1,000 tests" is a claim about a number that
 * this file cannot pin to an exact one, so it is checked as a floor. And it counts
 * test FUNCTIONS, not assertions or subtests — `go test` reports far more cases
 * than there are `func Test…`, so a doc saying "1,056 tests" is saying something
 * narrower than a reader might assume. Better a number that is defined and true.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

const read = (rel: string) => readFileSync(path.join(repo, rel), 'utf8');

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

function testFunctions(module: string): number {
  const files = walk(path.join(repo, module), (p) => p.endsWith('_test.go'));
  let n = 0;
  for (const f of files) n += (readFileSync(f, 'utf8').match(/^func Test[A-Za-z0-9_]*\(/gm) ?? []).length;
  return n;
}

/** Measured once: several of these shell out or read the whole tree. */
const measured: Record<string, number> = {};

beforeAll(() => {
  const migrationDir = path.join(repo, 'hub/internal/store/migrations');
  const migrations = readdirSync(migrationDir).filter((f) => f.endsWith('.sql'));
  measured.migrations = migrations.length;
  measured.tables = migrations.reduce(
    (n, f) => n + (readFileSync(path.join(migrationDir, f), 'utf8').match(/CREATE TABLE/gi) ?? []).length,
    0,
  );

  // The same AST-based source of truth routeParity uses. Not a regex over
  // server.go: a commented-out registration would count.
  measured.routes = (
    JSON.parse(
      execFileSync('go', ['run', './cmd/routegen'], {
        cwd: path.join(repo, 'hub'),
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      }),
    ) as unknown[]
  ).length;

  const goList = (mod: string) =>
    execFileSync('go', ['list', './...'], { cwd: path.join(repo, mod), encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean).length;
  measured.hubPackages = goList('hub');
  measured.controllerPackages = goList('controller');

  measured.hubTests = testFunctions('hub');
  measured.controllerTests = testFunctions('controller');

  const vectorDir = path.join(repo, 'proto/vectors');
  measured.vectors = readdirSync(vectorDir)
    .filter((f) => f.endsWith('.json'))
    .reduce((n, f) => {
      const d = JSON.parse(readFileSync(path.join(vectorDir, f), 'utf8'));
      // Array-shaped corpora only. keys.json holds five NAMED key fixtures the
      // other vectors are signed with — shared material, not cases that pass or
      // fail — and counting them as vectors overstates the corpus by five.
      const list = d.vectors ?? d.cases ?? d.tests ?? (Array.isArray(d) ? d : []);
      return n + (Array.isArray(list) ? list.length : 0);
    }, 0);

  // The verifier's own tally, taken from the verifier rather than recomputed —
  // a second implementation of the count would only prove the two agree.
  const verify = execFileSync('node', ['verify.mjs'], {
    cwd: vectorDir,
    encoding: 'utf8',
  });
  measured.vectorChecks = Number(/OK — (\d+) checks passed/.exec(verify)?.[1]);
});

/** file → the exact claims it makes. One capture group each, and it must be a number. */
const CLAIMS: Array<{ file: string; pattern: RegExp; key: string }> = [
  { file: 'README.md', pattern: /(\d+) migrations/, key: 'migrations' },
  { file: 'README.md', pattern: /(\d+) tables/, key: 'tables' },

  { file: 'ROADMAP.md', pattern: /\*\*(\d+) HTTP routes over/, key: 'routes' },
  { file: 'ROADMAP.md', pattern: /HTTP routes over (\d+)\n?migrations/, key: 'migrations' },
  { file: 'ROADMAP.md', pattern: /across (\d+) packages/, key: 'hubPackages' },

  { file: 'ARCHITECTURE.md', pattern: /\*\*Built\.\*\* ([\d,]+) HTTP routes/, key: 'routes' },
  { file: 'ARCHITECTURE.md', pattern: /([\d,]+) Go test functions green across/, key: 'hubTests' },
  { file: 'ARCHITECTURE.md', pattern: /green across ([\d,]+) packages/, key: 'hubPackages' },
  { file: 'ARCHITECTURE.md', pattern: /\*\*Built\.\*\* ([\d,]+) Go test functions green\. GPIO/, key: 'controllerTests' },
  { file: 'ARCHITECTURE.md', pattern: /\*\*Built\.\*\* ([\d,]+) conformance vectors/, key: 'vectors' },
  { file: 'ARCHITECTURE.md', pattern: /conformance vectors, ([\d,]+) checks/, key: 'vectorChecks' },
  { file: 'ARCHITECTURE.md', pattern: /Backed by \*\*([\d,]+) conformance vectors\*\*/, key: 'vectors' },
  { file: 'ARCHITECTURE.md', pattern: /\*\*([\d,]+) checks\*\*, because multi-step/, key: 'vectorChecks' },
  { file: 'ARCHITECTURE.md', pattern: /baseline \((\d+) migrations/, key: 'migrations' },
  { file: 'ARCHITECTURE.md', pattern: /migrations, (\d+) tables\)/, key: 'tables' },

  { file: 'site/docs/architecture.md', pattern: /\*\*Shipped\*\* — ([\d,]+) routes/, key: 'routes' },
  { file: 'site/docs/architecture.md', pattern: /routes, ([\d,]+) test functions green/, key: 'hubTests' },
  { file: 'site/docs/architecture.md', pattern: /\*\*Shipped\*\* — ([\d,]+) test functions green; GPIO/, key: 'controllerTests' },
  { file: 'site/docs/architecture.md', pattern: /\*\*Shipped\*\* — ([\d,]+) vectors/, key: 'vectors' },
  { file: 'site/docs/architecture.md', pattern: /vectors, ([\d,]+) checks/, key: 'vectorChecks' },

  { file: 'site/docs/faq.md', pattern: /The hub is ([\d,]+) HTTP routes/, key: 'routes' },
  { file: 'site/docs/faq.md', pattern: /HTTP routes and ([\d,]+) Go test functions/, key: 'hubTests' },
  { file: 'site/docs/faq.md', pattern: /the controller agent is ([\d,]+)\s*\n?more/, key: 'controllerTests' },
  { file: 'site/docs/faq.md', pattern: /have ([\d,]+) conformance vectors/, key: 'vectors' },
  { file: 'site/docs/faq.md', pattern: /conformance vectors \(([\d,]+) checks\)/, key: 'vectorChecks' },

  { file: 'site/docs/self-host.md', pattern: /— ([\d,]+) HTTP routes registered in/, key: 'routes' },
  { file: 'site/docs/self-host.md', pattern: /Go test functions across (\d+)\n?>?\s*packages/, key: 'hubPackages' },
];

describe('every count the docs state matches the thing it counts', () => {
  it.each(CLAIMS)('$file — $key', ({ file, pattern, key }) => {
    const text = read(file);
    const m = pattern.exec(text);
    // Not `if (!m) return`. A claim that stopped matching is a claim that
    // stopped being checked, and the sentence around these numbers gets
    // reworded far more often than the numbers get corrected.
    expect(
      m,
      `${file} no longer contains a phrase matching ${pattern}. Either the claim was ` +
        `removed — then delete it from CLAIMS — or it was reworded, and this guard has ` +
        `silently stopped checking it. Do not delete the entry to make this pass.`,
    ).not.toBeNull();
    expect(Number((m as RegExpExecArray)[1].replace(/,/g, '')), `${file} states the wrong ${key}`).toBe(
      measured[key],
    );
  });

  it('the measurements themselves ran', () => {
    // A guard whose measurements were all zero would agree with a document that
    // said zero, and with a `go` binary that was not on PATH.
    for (const [key, value] of Object.entries(measured)) {
      expect(value, `${key} measured as ${value}; the measurement did not run`).toBeGreaterThan(0);
    }
    expect(measured.hubTests).toBeGreaterThan(500);
    expect(measured.routes).toBeGreaterThan(50);
  });
});
