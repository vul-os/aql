import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Closed vocabularies the hub owns and the console restates.
 *
 * A pattern found three times in as many days, each time by accident: the
 * console keeps a second copy of a list that lives in Go, and nothing checks
 * it. The metric hints had drifted thirteen names behind the drivers. The
 * capability→controls table happened to be complete and nothing was keeping it
 * so. This file is the deliberate version — sweep the remaining ones and pin
 * them, rather than wait to stumble on the fourth.
 *
 * WHICH DRIFTS MATTER, because they are not the same:
 *
 *   - A value the console offers that the hub rejects is VISIBLE: the request
 *     is refused and somebody sees it.
 *   - A value the hub accepts that the console never offers is INVISIBLE, and
 *     it is worse. When the console renders a closed picker — a <select>, not a
 *     free field — an engine feature simply cannot be reached from the UI, with
 *     no error anywhere. CompareOp below is exactly that shape.
 *
 * Both directions are therefore checked. Where the console deliberately widens
 * a type with `| string` to tolerate a hub that is ahead of it, that is noted
 * rather than treated as a mismatch — but the KNOWN values must still agree.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

/**
 * The trigger_kind vocabulary a migrated database actually enforces.
 *
 * Scans every migration in apply order and keeps the last CHECK it finds, so a
 * rebuilt table supersedes the original declaration exactly as SQLite sees it.
 */
function effectiveTriggerKinds(): string[] {
  const dir = path.join(repo, 'hub/internal/store/migrations');
  const re = /trigger_kind TEXT NOT NULL CHECK \(trigger_kind IN \(([^)]+)\)\)/;
  let last: string[] | null = null;
  let declarations = 0;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.sql')) continue;
    const m = re.exec(readFileSync(path.join(dir, f), 'utf-8'));
    if (!m) continue;
    declarations++;
    last = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  }
  expect(declarations, 'no migration declares a trigger_kind CHECK').toBeGreaterThan(0);
  return last!;
}

/**
 * Source with comments removed.
 *
 * Not optional, and it took a tamper to notice: commenting an option OUT of a
 * rendered picker left its literal in the file, so a regex over raw source
 * still counted it as offered and the check passed on a picker that had lost an
 * entry. A guard that reads commented-out code as live code is a guard that
 * agrees with the bug.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i < 0 ? l : l.slice(0, i);
    })
    .join('\n');
}

/** Values of a Go `const X Type = "literal"` block, by declared type name. */
function goConstValues(rel: string, typeName: string): string[] {
  const src = read(rel);
  const re = new RegExp(`\\b[A-Za-z]+\\s+${typeName}\\s*=\\s*"([^"]+)"`, 'g');
  const out = [...src.matchAll(re)].map((m) => m[1]);
  expect(
    out.length,
    `no ${typeName} constants were parsed from ${rel}; the declaration moved and this ` +
      `check silently stopped covering anything`,
  ).toBeGreaterThan(1);
  return out.sort();
}

/** The literals of a single-line TS union: `type X = 'a' | 'b';` */
function tsUnion(rel: string, typeName: string): string[] {
  const src = read(rel);
  const m = new RegExp(`type ${typeName}\\s*=\\s*([^;]+);`).exec(src);
  expect(m, `type ${typeName} not found in ${rel}`).not.toBeNull();
  const out = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  expect(out.length, `type ${typeName} in ${rel} has no string literals`).toBeGreaterThan(1);
  return out.sort();
}

describe('closed vocabularies match the hub', () => {
  // The dangerous one: RuleEditor renders these as a <select>, so an operator
  // can only choose what the array holds. An operator cannot write a rule using
  // an operator the engine supports but this list omits, and nothing tells them
  // why — the option is simply not there.
  it('comparison operators match automations/rule.go', () => {
    const go = goConstValues('hub/internal/automations/rule.go', 'CompareOp');
    expect(tsUnion('src/components/automations/RuleEditor.tsx', 'CompareOp')).toEqual(go);

    // And the rendered picker offers all of them. The type agreeing is not
    // enough: COMPARE_OPS is what a person can actually click.
    const src = readCode('src/components/automations/RuleEditor.tsx');
    const block = src.slice(src.indexOf('const COMPARE_OPS'));
    const offered = [...block.slice(0, block.indexOf('];')).matchAll(/value:\s*'([^']+)'/g)]
      .map((m) => m[1])
      .sort();
    expect(
      offered,
      'the operator picker does not offer every comparison the engine accepts, so a ' +
        'rule the hub would run cannot be written in the UI',
    ).toEqual(go);
  });

  it('automation trigger kinds match automations/rule.go and the schema', () => {
    const go = goConstValues('hub/internal/automations/rule.go', 'TriggerKind');

    // The console's union is closed and must match exactly. It used to end in
    // `| string`, which collapsed it to `string` and let the literals drift
    // from the engine without anything noticing.
    const ts = read('src/lib/api.ts');
    const m = /type AutomationTriggerKind\s*=\s*([^;]+);/.exec(ts);
    expect(m, 'AutomationTriggerKind not found').not.toBeNull();
    const declared = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(declared).toEqual(go);

    // The schema closes the same vocabulary with a CHECK. A kind the engine
    // accepts and the table refuses is a rule that validates and cannot be
    // saved.
    //
    // Read from the LAST migration that declares the constraint, not from a
    // named file. This test pointed at 0010 and broke the moment 0029 widened
    // the vocabulary by rebuilding the table — it was comparing the engine
    // against a constraint no database has had since. Migrations apply in
    // sorted order, so the final declaration is the effective one, and a
    // future widening needs no edit here.
    const allowed = effectiveTriggerKinds();
    expect(
      allowed,
      'the engine and the database disagree about which trigger kinds exist',
    ).toEqual(go);
  });

  /**
   * The lockdown matrix exists three times and all three must agree.
   *
   * `proto/commands.md` step 5 is the contract. `controller/internal/wire` is
   * what a real controller enforces. `hub/internal/keys` is a SECOND,
   * independent implementation of the controller-side check, written so the
   * shared conformance vectors are verified by something other than the code
   * under test — which is only worth having if the two implementations are
   * actually kept in step, and nothing was checking that.
   *
   * The divergence this catches is not hypothetical. `revoke` was added to the
   * matrix because refusing it under lockdown forced an operator to LIFT the
   * freeze — opening every gate — to install a targeted revocation. Adding it
   * to one copy and not the other would leave the hub believing a command the
   * controller refuses, or the reverse, with the vector suite still green
   * because each side agrees with itself.
   */
  it('the lockdown matrix agrees across the contract, the controller and the hub', () => {
    const mapKeys = (src: string, name: string): string[] => {
      const at = src.indexOf(`${name} = map[string]bool{`);
      expect(at, `${name} is no longer declared`).toBeGreaterThan(-1);
      const open = src.indexOf('{', at);
      const close = src.indexOf('}', open);
      expect(close, `${name} is unterminated`).toBeGreaterThan(open);
      return [...src.slice(open, close).matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1]).sort();
    };

    const controller = mapKeys(read('controller/internal/wire/wire.go'), 'LockdownAllowed');
    const hub = mapKeys(read('hub/internal/keys/envelope.go'), 'lockdownAllowed');

    expect(controller.length, 'the matrix parsed empty').toBeGreaterThan(3);
    expect(
      hub,
      'the hub and the controller disagree about which commands survive a lockdown — ' +
        'the hub verifier is a second implementation of the same contract and the vector ' +
        'suite cannot see the difference, because each side agrees with itself',
    ).toEqual(controller);

    // And the contract itself. Step 5 names the set in prose; a matrix that
    // drifts from the document is a controller doing something nobody wrote
    // down.
    const commands = read('proto/commands.md');
    const step5 = /During `lockdown`, only ([^.]*?) are\s+accepted/s.exec(commands);
    expect(step5, 'proto/commands.md no longer states the lockdown matrix in step 5').not.toBeNull();
    const documented = [...step5![1].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
    expect(
      documented,
      'proto/commands.md step 5 lists a different set from the code that enforces it',
    ).toEqual(controller);
  });

  it('access-point kinds match the handler and the schema', () => {
    // The handler's allowlist is the authority the API enforces.
    const handler = read('hub/internal/httpapi/access.go');
    const m = /var apKinds = map\[string\]bool\{([^}]+)\}/.exec(handler);
    expect(m, 'apKinds allowlist not found').not.toBeNull();
    const go = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    expect(go.length).toBeGreaterThan(2);

    const sql = read('hub/internal/store/migrations/0001_baseline.sql');
    const check = /kind\s+TEXT NOT NULL CHECK \(kind IN \(([^)]+)\)\)/.exec(sql);
    expect(check, 'the access-point kind CHECK constraint was not found').not.toBeNull();
    const allowed = [...check![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(
      allowed,
      'the handler accepts an access-point kind the database refuses, or the reverse',
    ).toEqual(go);

    // api.ts inlines the same union on accessPointCreate's body.
    const ts = read('src/lib/api.ts');
    const inline = /kind:\s*((?:'[a-z]+'\s*\|\s*)+'[a-z]+');/.exec(ts);
    expect(inline, 'the access-point kind union was not found in api.ts').not.toBeNull();
    const declared = [...inline![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(
      declared,
      'the console offers an access-point kind the hub refuses, or omits one it accepts',
    ).toEqual(go);
  });

  it('API token scopes match store/tokens.go', () => {
    const go = goConstValues('hub/internal/store/tokens.go', 'APITokenScope');
    expect(
      tsUnion('src/lib/api.ts', 'ApiTokenScope'),
      'a scope the hub issues that the console cannot request is a permission nobody ' +
        'can grant from the UI',
    ).toEqual(go);
  });

  // The parsers above are regexes over source. A regex that stops matching
  // makes every assertion pass against an empty set, which is the failure mode
  // this repo has hit more than once — so each helper asserts it found
  // something, and this asserts the files themselves are real.
  it('reads real files, so a rename cannot make this suite vacuous', () => {
    for (const f of [
      'hub/internal/automations/rule.go',
      'hub/internal/httpapi/access.go',
      'hub/internal/store/tokens.go',
      'hub/internal/store/migrations/0001_baseline.sql',
      'hub/internal/store/migrations/0010_automations.sql',
      'src/components/automations/RuleEditor.tsx',
      'src/lib/api.ts',
    ]) {
      expect(read(f).length, `${f} is empty or missing`).toBeGreaterThan(200);
    }
  });
});
