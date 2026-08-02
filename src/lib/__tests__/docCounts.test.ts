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
  // The LIVE table count, not the number of CREATE TABLE statements ever
  // written. Those were the same number until 0029, which widens a CHECK the
  // only way SQLite allows — build a replacement, copy, drop, rename — and so
  // is the first migration whose CREATE does not leave a table behind. Summing
  // CREATEs counted the scratch table and reported 52 for a schema with 51.
  // Replaying create/drop/rename in apply order is what the database does.
  //
  // Note on the DROP branch: with today's migrations it is not load-bearing.
  // 0029 drops `automation_rules` and immediately renames the replacement onto
  // that same name, and adding a name already in the set is a no-op — so
  // deleting the DROP handling leaves the count unchanged either way. It is here
  // for a drop that is NOT half of a rebuild, which nothing does yet. Said out
  // loud so nobody later "proves" this branch with a tamper that cannot move
  // the number and concludes the guard is watching more than it is.
  const live = new Set<string>();
  for (const f of [...migrations].sort()) {
    const sql = readFileSync(path.join(migrationDir, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][\w]*)/gi)) {
      live.add(m[1]);
    }
    for (const m of sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+([A-Za-z_][\w]*)/gi)) {
      live.delete(m[1]);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+([A-Za-z_][\w]*)\s+RENAME TO\s+([A-Za-z_][\w]*)/gi)) {
      live.delete(m[1]);
      live.add(m[2]);
    }
  }
  measured.tables = live.size;

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
  // ROADMAP states the migration and table counts TWICE — once in the Phase 0
  // header (guarded above) and once in the persistence bullet. Only the first
  // was checked, so the second sat at '32 migrations, 51 tables' while the
  // guarded one was correctly bumped to 33/58: a claim that looks identical to
  // a guarded one, outside the guard. Both are checked now.
  { file: 'ROADMAP.md', pattern: /shipped with the hub \((\d+) migrations/, key: 'migrations' },
  { file: 'ROADMAP.md', pattern: /migrations,\n?\s*(\d+) tables\), one file to back up/, key: 'tables' },

  { file: 'ARCHITECTURE.md', pattern: /\*\*Built\.\*\* ([\d,]+) HTTP routes/, key: 'routes' },
  { file: 'ARCHITECTURE.md', pattern: /([\d,]+) Go test functions green across/, key: 'hubTests' },
  { file: 'ARCHITECTURE.md', pattern: /green across ([\d,]+) packages/, key: 'hubPackages' },
  // Anchored on "The GPIO" since the row was reworded: it used to say the relay
  // and BLE "are **not**", a sentence that stopped mid-claim and read as "not
  // built" when both are written and neither is hardware-validated. This guard
  // caught the rewording rather than silently ceasing to check the count, which
  // is what the trailing anchor is for.
  { file: 'ARCHITECTURE.md', pattern: /\*\*Built\.\*\* ([\d,]+) Go test functions green\. The GPIO/, key: 'controllerTests' },
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
  // CONTRIBUTING's table of what to run. It was outside this check and said 183
  // hub tests against 1,411, and 45 controller tests against 151 — numbers from
  // early enough that a contributor comparing them to their own run would
  // conclude something was badly wrong with their checkout. Every other document
  // stating these counts was already held here; this one was simply never added.
  { file: 'CONTRIBUTING.md', pattern: /\| `go test \.\/\.\.\.` \| `hub\/` \| ([\d,]+) test functions \|/, key: 'hubTests' },
  { file: 'CONTRIBUTING.md', pattern: /\| `go test \.\/\.\.\.` \| `controller\/` \| ([\d,]+) test functions \|/, key: 'controllerTests' },
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
    // ARCHITECTURE.md states the SAME driver-seam fact as site/docs/architecture.md
    // and was not checked, so the two had drifted: it listed four of the five
    // drivers, omitting `access`. Two files saying one thing differently, with
    // only one of them guarded, is how that happens.
    { file: 'ARCHITECTURE.md', pattern: /Registry behind a driver seam; ([^;]+);/ },
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
 * The root README's driver table, which is a DIFFERENT claim from the lists above.
 *
 * Those enumerate what `-device-drivers` accepts. This one is scoped to PROTOCOL
 * drivers — what the hub speaks to reach real hardware — and legitimately omits
 * `access`, which speaks no protocol: accessdev presents gates to the fleet
 * read-only and refuses every verb, because a gate is actuated by the hub's
 * signed controller route and two actuation paths to a gate is strictly worse
 * than one.
 *
 * So this cannot assert the same set. What it can do is make the omission
 * DELIBERATE rather than incidental: every protocol driver must have a row, and
 * a new driver constant fails here until someone decides whether it belongs in
 * the table. The mapping is hand-written on purpose — it is the place that
 * decision gets recorded.
 */
describe('the root README driver table covers every protocol driver', () => {
  // Driver constant → the table row that stands for it.
  const ROWS: Record<string, RegExp> = {
    mqtt: /^\| MQTT \|/m,
    modbus: /^\| Modbus TCP \|/m,
    http: /^\| HTTP \/ webhook \|/m,
    camera: /^\| ONVIF \|/m,
  };
  // Not a protocol driver, and the reason is in this describe's comment.
  const NOT_A_PROTOCOL = new Set(['access']);

  it('has a row for each, and a decision recorded for each exclusion', () => {
    const src = read('hub/cmd/hub/main.go');
    const names = [...src.matchAll(/deviceDriver[A-Z]\w*\s*=\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(names.length, 'no deviceDriver constants were parsed').toBeGreaterThan(3);

    const readme = read('README.md');
    for (const name of names) {
      if (NOT_A_PROTOCOL.has(name)) continue;
      expect(
        ROWS[name],
        `the binary accepts driver "${name}" and this test has no row mapping for it — ` +
          'add one, or add it to NOT_A_PROTOCOL with a reason',
      ).toBeDefined();
      expect(readme, `README.md's driver table has no row for "${name}"`).toMatch(ROWS[name]);
    }
    // And no mapping may outlive its driver: a row for something the binary no
    // longer builds is an advertisement for a driver that does not exist.
    for (const mapped of Object.keys(ROWS)) {
      expect(names, `this test maps a row for "${mapped}", which the binary no longer accepts`)
        .toContain(mapped);
    }
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
