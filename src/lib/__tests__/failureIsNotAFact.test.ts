// A failed request must never render as a fact about the world.
//
// Three screens made the same mistake in three different registers, and each
// one told a person something confidently false:
//
//   · Overview swallowed a failed access-point fetch into an empty list, and
//     an empty list is what triggers the FIRST-TIME ONBOARDING screen. A
//     household with a working gate was told they had never set one up.
//   · AdminLayout tracked a failed admin check in a `failed` flag and then
//     ignored it, falling through to a page that states "403 ·
//     not_platform_admin" and "Your account doesn't have platform-admin
//     access". A dropped connection became a claim about the caller's
//     permissions — sending the instance's actual operator to ask themselves
//     for access.
//   · AdminAudit left the previous run's green "Intact" ticks mounted directly
//     beneath a fresh "could not verify" banner. Somebody re-verifying is
//     usually doing it because they suspect tampering, and a stale pass is the
//     worst possible answer to that question.
//
// These are behavioural tests over the DECISION each screen makes, not over
// its markup: the decision is the part that was wrong, and markup assertions
// rot without catching anything.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Overview's branch order, extracted exactly as the component evaluates it:
 * loading → failed → onboarding → dashboard.
 *
 * The bug was that `failed` did not exist, so a failure fell through to
 * `accessPoints.length === 0`.
 */
function overviewView(o: {
  dataLoaded: boolean;
  loadFailed: boolean;
  accessPointCount: number;
}): 'loading' | 'failed' | 'onboarding' | 'dashboard' {
  if (!o.dataLoaded) return 'loading';
  if (o.loadFailed) return 'failed';
  if (o.accessPointCount === 0) return 'onboarding';
  return 'dashboard';
}

/** AdminGate's branch order: loading → claimable → couldNotCheck → forbidden. */
function adminGateView(g: {
  state: { claimable: boolean } | null;
  failed: boolean;
}): 'loading' | 'claim' | 'couldNotCheck' | 'forbidden' {
  if (!g.state && !g.failed) return 'loading';
  if (g.state?.claimable) return 'claim';
  if (g.failed) return 'couldNotCheck';
  return 'forbidden';
}

describe('Overview: a failed load is not a new account', () => {
  it('does not offer first-time onboarding after a failed fetch', () => {
    // THE bug. An account with gates, whose fetch failed, looks identical to a
    // brand-new one on the only signal the old code had.
    expect(overviewView({ dataLoaded: true, loadFailed: true, accessPointCount: 0 })).toBe('failed');
  });

  it('still offers onboarding to an account that genuinely has no gates', () => {
    // The regression direction: the fix must not have broken first-run.
    expect(overviewView({ dataLoaded: true, loadFailed: false, accessPointCount: 0 })).toBe(
      'onboarding',
    );
  });

  it('shows the dashboard when there are gates', () => {
    expect(overviewView({ dataLoaded: true, loadFailed: false, accessPointCount: 3 })).toBe(
      'dashboard',
    );
  });

  it('prefers the failure over the dashboard even if some rows arrived', () => {
    // A partial load is still a load that failed. Rendering half a dashboard
    // as though it were whole is the same class of lie.
    expect(overviewView({ dataLoaded: true, loadFailed: true, accessPointCount: 2 })).toBe('failed');
  });
});

describe('AdminGate: a failed check is not a refusal', () => {
  it('does not claim the caller lacks permission when the check failed', () => {
    // THE bug: `failed` was tracked and discarded, so this returned forbidden.
    expect(adminGateView({ state: null, failed: true })).toBe('couldNotCheck');
  });

  it('still refuses a caller the hub actually answered about', () => {
    expect(adminGateView({ state: { claimable: false }, failed: false })).toBe('forbidden');
  });

  it('still offers the claim screen on a claimable instance', () => {
    expect(adminGateView({ state: { claimable: true }, failed: false })).toBe('claim');
  });

  it('waits rather than guessing while the check is in flight', () => {
    expect(adminGateView({ state: null, failed: false })).toBe('loading');
  });
});

/**
 * AdminAudit's verify handler, reduced to what it does to state. The bug was
 * that the catch branch never touched `result`.
 */
function verifyReducer(
  prev: { result: string | null; error: string | null },
  outcome: { ok: true; result: string } | { ok: false; error: string },
): { result: string | null; error: string | null } {
  if (outcome.ok) return { result: outcome.result, error: null };
  return { result: null, error: outcome.error };
}

describe('AdminAudit: a failed re-verify does not leave a stale pass on screen', () => {
  it('clears the previous Intact result when the re-verify fails', () => {
    const afterPass = verifyReducer({ result: null, error: null }, { ok: true, result: 'intact' });
    expect(afterPass.result).toBe('intact');

    const afterFailure = verifyReducer(afterPass, { ok: false, error: 'hub unreachable' });
    expect(afterFailure.result).toBeNull();
    expect(afterFailure.error).toBe('hub unreachable');
  });

  it('clears the previous error when a re-verify succeeds', () => {
    const afterFailure = verifyReducer({ result: null, error: null }, { ok: false, error: 'boom' });
    const afterPass = verifyReducer(afterFailure, { ok: true, result: 'intact' });
    expect(afterPass.error).toBeNull();
    expect(afterPass.result).toBe('intact');
  });
});

// The three reducers above model the components' branch order. A model that
// drifts from the code it models is worse than no test — it goes on passing
// while the real screen misleads people again.
//
// So this reads the actual sources and checks the branches are still there, in
// the order that matters. It is a weaker check than rendering the components,
// and it is chosen deliberately over the alternative, which is trusting three
// hand-copied reducers to stay honest.
describe('the models above still match the code they model', () => {
  const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf-8');

  it('Overview checks loadFailed BEFORE the empty-access-points branch', () => {
    const src = read('src/pages/app/Overview.tsx');
    const failedAt = src.indexOf('if (loadFailed)');
    const onboardingAt = src.indexOf('if (accessPoints.length === 0)');
    expect(failedAt, 'Overview has no loadFailed branch').toBeGreaterThan(-1);
    expect(onboardingAt).toBeGreaterThan(-1);
    expect(
      failedAt,
      'the onboarding branch runs first, so a failed load still offers first-time setup',
    ).toBeLessThan(onboardingAt);
    // And the access-point fetch must not swallow its own failure back into an
    // empty list, which is how this bug originally reached the branch at all.
    expect(src).not.toContain('accessPoints(currentAccount.id).catch');
  });

  it('AdminGate checks failed BEFORE rendering Forbidden', () => {
    const src = read('src/pages/app/admin/AdminLayout.tsx');
    const failedAt = src.indexOf('if (failed) return <CouldNotCheck />');
    const forbiddenAt = src.indexOf('return <Forbidden />');
    expect(failedAt, 'AdminGate does not branch on a failed check').toBeGreaterThan(-1);
    expect(failedAt).toBeLessThan(forbiddenAt);
  });

  it('AdminAudit clears the previous result in its catch', () => {
    const src = read('src/pages/app/admin/AdminAudit.tsx');
    const catchAt = src.indexOf("catch (err) {\n      // The previous run's result MUST go");
    expect(
      src.slice(src.indexOf('async function run()'), src.indexOf('async function run()') + 900),
    ).toContain('setResult(null)');
    expect(catchAt, 'the reason this clear exists is no longer written down').toBeGreaterThan(-1);
  });
});
