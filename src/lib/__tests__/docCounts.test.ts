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

/**
 * The driver names the docs advertise, against the names the binary accepts.
 *
 * Not a count, but the same failure: a list written once and true at the time.
 * `access` landed as a fifth driver and three operator-facing documents went on
 * naming four — including hub/README.md's flag table, which is where somebody
 * actually looks to find out what they may pass.
 *
 * The binary's accept-list is `knownDeviceDrivers()` in cmd/hub/main.go, built
 * from the deviceDriverX constants. Those constants are the source of truth for
 * what -device-drivers takes; everything else is a restatement.
 */
describe('the drivers the docs advertise are the drivers the binary accepts', () => {
  const drivers = (): string[] => {
    const src = read('hub/cmd/hub/main.go');
    const names = [...src.matchAll(/deviceDriver[A-Z]\w*\s*=\s*"([a-z]+)"/g)].map((m) => m[1]);
    // Without this a regex that stopped matching would agree with any doc.
    expect(names.length, 'no deviceDriver constants were parsed from main.go').toBeGreaterThan(3);
    return names.sort();
  };

  it.each([
    { file: 'hub/README.md', pattern: /comma-separated device drivers to construct \(([^)]+)\)/ },
    { file: 'site/docs/architecture.md', pattern: /Registry behind a driver seam; ([^|]+)\|/ },
  ])('$file names them all', ({ file, pattern }) => {
    const text = read(file);
    const m = pattern.exec(text);
    expect(m, `${file} no longer contains a driver list matching ${pattern}`).not.toBeNull();
    const listed = [...(m as RegExpExecArray)[1].matchAll(/`([a-z]+)`/g)].map((x) => x[1]).sort();
    expect(listed, `${file} advertises a different set of drivers than the binary accepts`).toEqual(
      drivers(),
    );
  });
});

/**
 * Every setting the hub reads from the environment, against the operator docs.
 *
 * The same failure as the driver list, one layer down. A setting with a `-flag`
 * is hard to miss — it prints in `-help` and it is in the flag table. A setting
 * that is environment-only is invisible unless somebody writes it down, and
 * three of them were documented in cmd/hub/main.go's header comment and nowhere
 * an operator would look.
 *
 * AQL_ENERGY_TZ is why this is worth a test rather than a one-time fix. It
 * anchors the hour/day/month rollup buckets, and left unset a "day" of energy
 * runs midnight-to-midnight UTC. For anyone not on UTC every daily and monthly
 * total is split at the wrong hour — and the numbers look plausible, so nothing
 * about the output says to go looking for a setting.
 */
describe('every environment setting the hub reads is written down', () => {
  /**
   * Variables deliberately not in the operator docs, each with the reason.
   * An entry here is a claim that an operator has no business setting it.
   */
  const NOT_OPERATOR_FACING: Record<string, string> = {
    AQL_ENV: 'A deployment marker the binary reports about itself ("self-hosted"). Nothing behaves differently.',
    AQL_FMP4_FIXTURE_DIR: 'A test hook: where the fMP4 conformance fixtures are written. Read only by tests.',
    AQL_GPIO_TEST_CHIP: 'A test hook: opt into touching a real GPIO chip, read-only. Skips without it.',
  };

  it('names every AQL_* variable read by the hub, or says why not', () => {
    const src = read('hub/cmd/hub/main.go');
    const readByCode = [
      ...src.matchAll(/env(?:Duration|Bool|Int)?Or\(\s*"((?:AQL|VULOS)_[A-Z0-9_]+)"/g),
    ].map((m) => m[1]);
    // A regex that stopped matching would agree with any documentation.
    expect(readByCode.length, 'no env lookups were parsed from main.go').toBeGreaterThan(5);

    const docs = read('hub/README.md');
    const undocumented = [...new Set(readByCode)]
      .filter((v) => !docs.includes(v))
      .filter((v) => !(v in NOT_OPERATOR_FACING));

    expect(
      undocumented,
      'these settings are read from the environment and appear nowhere in hub/README.md. ' +
        'An environment-only setting is invisible: it does not print in -help and it is not ' +
        'in the flag table, so it exists only for whoever reads main.go. Document it, or add ' +
        'it to NOT_OPERATOR_FACING with the reason it is not one.',
    ).toEqual([]);
  });

  it('keeps the exception list honest — every entry is actually read', () => {
    // An exception for a variable nothing reads is a stale excuse, and it would
    // hide the day that name comes back meaning something else.
    //
    // ONE in-process walk over the Go sources, not one `grep -r` per name.
    // The previous version shelled out per entry and took 7.1s against vitest's
    // 5s budget — a timeout, which reports "Test timed out" rather than naming
    // the defect, and is the same shape already fixed once in naming.test.ts.
    // It got there because an earlier edit of mine removed a fast path that had
    // been short-circuiting before the grep ran.
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith('.go')) sources.push(readFileSync(p, 'utf8'));
      }
    };
    walk(path.join(repo, 'hub'));
    walk(path.join(repo, 'controller'));
    // A walk that read nothing would excuse every entry.
    expect(sources.length, 'no Go sources were read; this check is looking at nothing').toBeGreaterThan(100);
    const haystack = sources.join('\n');

    for (const name of Object.keys(NOT_OPERATOR_FACING)) {
      expect(
        haystack.includes(name),
        `${name} is excused from the operator docs, but nothing under hub/ or controller/ ` +
          `reads it. Either the variable was renamed and this entry is a leftover, or the ` +
          `exception was never true. Delete it — a stale excuse hides the day that name ` +
          `comes back meaning something else.`,
      ).toBe(true);
    }
  });
});
