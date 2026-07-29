// A write whose outcome nobody observed must not be reported as an outcome.
//
// AdminAccounts flipped an account's status optimistically and reverted on ANY
// error. A refusal is safe to revert — the hub answered, and its answer was no.
// A transport failure is not: the PATCH may have reached the hub and committed
// before the response was lost, so reverting asserted "still active" about an
// account that may now be suspended.
//
// Suspension decides whether a household's opens are denied. Guessing that
// wrong in the reassuring direction is the wrong way to guess, and it is the
// same mistake the gate buttons made with `undelivered`.
//
// The other half: adminErrorMessage fell through to `err.code`, so an operator
// could be shown a bare `cannot_revoke_last_admin` — a string written for a
// switch statement, not for a person. And `isHubUnreachable` was exported and
// called by nothing at all, which is why none of this was distinguishable.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, HUB_UNREACHABLE_CODE } from '@/lib/api';
import { adminErrorMessage } from '@/pages/app/admin/shared';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf-8');

/**
 * applyStatus's decision, extracted: what happens to the row, and whether the
 * console admits it does not know.
 */
function statusOutcome(err: unknown): { revert: boolean; unknown: boolean } {
  const transport = err instanceof ApiError && err.code === HUB_UNREACHABLE_CODE;
  return { revert: !transport, unknown: transport };
}

describe('an unreachable hub leaves a write unresolved rather than reverted', () => {
  it('does not revert the row when the hub was never reached', () => {
    // THE bug. Reverting here asserts a negative nobody observed.
    const out = statusOutcome(new ApiError(0, HUB_UNREACHABLE_CODE));
    expect(out.revert).toBe(false);
    expect(out.unknown).toBe(true);
  });

  it('does revert on a refusal, because the hub answered', () => {
    // A 403 is knowledge: the account is definitely unchanged. Treating this
    // as unknown would be the opposite error — hedging about something the hub
    // told us plainly.
    const out = statusOutcome(new ApiError(403, { error: 'not_platform_admin' }));
    expect(out.revert).toBe(true);
    expect(out.unknown).toBe(false);
  });

  it('reverts on an ordinary failure too', () => {
    expect(statusOutcome(new ApiError(500, { error: 'internal' })).revert).toBe(true);
    expect(statusOutcome(new Error('something odd')).revert).toBe(true);
  });
});

describe('adminErrorMessage says something a person can act on', () => {
  it('names an unreachable hub as a failed request, not a refusal', () => {
    const msg = adminErrorMessage(new ApiError(0, HUB_UNREACHABLE_CODE));
    expect(msg).toContain('Could not reach the hub');
    // The distinction that matters: an operator must not read this as the hub
    // having said no.
    expect(msg).toContain('not a refusal');
  });

  it('never shows a bare error code as though it were prose', () => {
    // A code with no copy is a gap in the map. Say that, and show the code as
    // evidence rather than as the explanation.
    const msg = adminErrorMessage(new ApiError(400, { error: 'some_unmapped_code' }));
    expect(msg).not.toBe('some_unmapped_code');
    expect(msg).toContain('no explanation in this console yet');
    expect(msg).toContain('some_unmapped_code');
  });

  it('still prefers real copy where it exists', () => {
    expect(adminErrorMessage(new ApiError(400, { error: 'cannot_disable_self' }))).toBe(
      "You can't disable your own user.",
    );
  });
});

describe('the code actually does this', () => {
  it('AdminAccounts branches on isHubUnreachable before reverting', () => {
    const src = read('src/pages/app/admin/AdminAccounts.tsx');
    const branchAt = src.indexOf('if (isHubUnreachable(err))');
    expect(branchAt, 'AdminAccounts reverts on every error again').toBeGreaterThan(-1);
    // And it must SURFACE the doubt: a flag nobody reads is the same defect
    // wearing a different shape.
    expect(src).toContain('setStatusUnknown(true)');
    expect(src, 'the unknown state is tracked but never rendered').toContain('{statusUnknown && (');
  });

  it('isHubUnreachable is no longer exported and unused', () => {
    // It sat in api.ts called by nothing, which is why an unreachable hub was
    // indistinguishable from a refusal everywhere in the admin console.
    const callers = ['src/pages/app/admin/shared.tsx', 'src/pages/app/admin/AdminAccounts.tsx'];
    for (const rel of callers) {
      expect(read(rel), `${rel} does not use isHubUnreachable`).toContain('isHubUnreachable');
    }
  });
});
