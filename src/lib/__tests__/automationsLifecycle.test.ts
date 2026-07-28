import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The console side of the three automations gaps closed alongside this test:
 * delete, run-now and run history (both the account-wide feed and the
 * per-rule view). apiReachability.test.ts and routeParity.test.ts already
 * prove api.automationDelete/automationRunNow/automationRuns/
 * automationRuleRuns are real, wired methods that target real hub routes —
 * neither can see whether a SCREEN actually calls them, or whether the
 * screen that does honours what the hub's own doc comments demand of it:
 * a confirmation before an irreversible delete, a visible result for a
 * manual run whether it succeeds or fails, and a run history that never
 * lets an empty or truncated list pass as "this rule is fine".
 *
 * Same technique as phoneLinking.test.ts: source-level string and regex
 * checks, because this repo has no component test renderer and runs
 * `environment: 'node'`. This proves the behaviour is still IN THE SOURCE,
 * not that it renders or is reachable in a browser.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

function flat(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function automationsSrc(): string {
  return read('src/pages/app/Automations.tsx');
}
function runListSrc(): string {
  return read('src/components/automations/RunList.tsx');
}
function runHistorySrc(): string {
  return read('src/components/automations/RunHistory.tsx');
}

describe('Automations.tsx calls the four routes that had a client and no caller', () => {
  const src = automationsSrc();

  it('calls delete, run-now and the account-wide run feed', () => {
    expect(src).toContain('api.automationDelete(');
    expect(src).toContain('api.automationRunNow(');
    expect(src).toContain('api.automationRuns(');
  });

  it('opens a per-rule history view that calls the per-rule route', () => {
    expect(src).toContain('setHistoryRule(');
    expect(src).toContain('<RunHistory');
    expect(runHistorySrc()).toContain('api.automationRuleRuns(');
  });
});

describe('deleting a rule requires an explicit confirmation, like Webhooks.tsx and ApiTokens.tsx', () => {
  const src = automationsSrc();
  const start = src.indexOf('async function onDelete');
  const body = src.slice(start, src.indexOf('async function onRunNow'));

  it('the confirm() dialog exists and gates the delete call', () => {
    expect(start).toBeGreaterThan(-1);
    // `!confirm(` — the actual `if (!confirm(...)) return;` guard, not just
    // the substring "confirm(" which this function's own doc comment
    // ("the confirm()-then-request pattern...") would satisfy on its own.
    expect(body).toMatch(/!confirm\(/);
    expect(body.indexOf('!confirm(')).toBeLessThan(body.indexOf('api.automationDelete('));
  });

  it('the confirmation names the stakes — unattended hardware and no undo, not a generic "are you sure"', () => {
    const flatBody = flat(body).toLowerCase();
    expect(flatBody).toContain('hardware');
    expect(flatBody).toContain('no undo');
  });

  it('a failed delete is reported, not swallowed', () => {
    expect(body).toMatch(/catch\s*\(err\)/);
    expect(body).toContain('friendlyApiError(err');
  });
});

describe('a manual run always surfaces a result, success or refusal or failure', () => {
  const src = automationsSrc();
  const start = src.indexOf('async function onRunNow');
  const body = src.slice(start, src.indexOf('async function toggle'));

  it('renders the returned Run on success', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('setRunResults');
    expect(body).toMatch(/\{\s*run\s*\}/);
  });

  it('renders a message on a thrown failure rather than doing nothing visible', () => {
    expect(body).toMatch(/catch\s*\(err\)/);
    expect(body).toContain('friendlyApiError(err');
  });

  it('a successful run refreshes the rule row, since Fire() mutates rule state whether it fires or not', () => {
    expect(body).toMatch(/refreshRules\(\)/);
  });

  it('the row renders either the run or the error, never neither', () => {
    expect(src).toContain("'run' in result");
    expect(src).toContain('<RunRow run={result.run} />');
    expect(src).toContain('{result.error}');
  });
});

describe('run history distinguishes "fired but the action failed" from "did not fire"', () => {
  const src = runListSrc();

  it('gives executed, failed, indeterminate, refused and skipped their own copy', () => {
    expect(src).toMatch(/executed:\s*\{\s*label:\s*'Fired/);
    expect(src).toMatch(/failed:\s*\{\s*label:\s*'Fired[^']*action failed/);
    expect(src).toMatch(/indeterminate:\s*\{\s*label:\s*'Fired/);
    expect(src).toMatch(/refused:\s*\{\s*label:\s*'Did not fire/);
    expect(src).toMatch(/skipped:\s*\{\s*label:\s*'Did not fire/);
  });

  it('"failed" and "refused" are worded differently — one fired, the other did not', () => {
    const failedLabel = /failed:\s*\{\s*label:\s*'([^']+)'/.exec(src)?.[1];
    const refusedLabel = /refused:\s*\{\s*label:\s*'([^']+)'/.exec(src)?.[1];
    expect(failedLabel, 'no "failed" outcome label found in RunList.tsx').toBeTruthy();
    expect(refusedLabel, 'no "refused" outcome label found in RunList.tsx').toBeTruthy();
    expect(failedLabel).not.toEqual(refusedLabel);
    expect(failedLabel?.toLowerCase()).toContain('fired');
    expect(refusedLabel?.toLowerCase()).toContain('did not fire');
  });

  it('audited=false is only flagged for a run that could have written an audit row (never a skip)', () => {
    expect(src).toMatch(/run\.outcome !== 'skipped' && !run\.audited/);
  });
});

describe('an empty run history is never presented as "everything is fine"', () => {
  it('RunsPanel always renders the caller-supplied emptyMessage instead of a blank list', () => {
    const src = runListSrc();
    const body = src.slice(src.indexOf('export function RunsPanel'));
    expect(body).toMatch(/runs\.length === 0/);
    expect(body).toContain('{emptyMessage}');
  });

  it('RunHistory.tsx spells out that "never fired" is not "this rule is working"', () => {
    const flatSrc = flat(runHistorySrc());
    expect(flatSrc).toMatch(/never fired.*not the same statement as .this rule is working./i);
  });
});

describe("a truncated run list says so, using the hub's own cap rather than inventing one", () => {
  it('RunsPanel compares the result against the caller-supplied limit and warns rather than presenting a full list', () => {
    const src = runListSrc();
    expect(src).toMatch(/runs\.length >= limit/);
    expect(flat(src).toLowerCase()).toContain('may be earlier ones not shown');
  });

  it('RunHistory.tsx and Automations.tsx read the limit the HUB echoed back, not a local constant', () => {
    expect(runHistorySrc()).toMatch(/limit:\s*res\.limit/);
    expect(automationsSrc()).toMatch(/limit:\s*res\.limit/);
  });
});

describe('the guard cannot pass on a file that vanished', () => {
  it('Automations.tsx, RunList.tsx and RunHistory.tsx are all still present and substantial', () => {
    expect(automationsSrc().length).toBeGreaterThan(500);
    expect(runListSrc().length).toBeGreaterThan(500);
    expect(runHistorySrc().length).toBeGreaterThan(500);
  });
});
