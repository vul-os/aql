import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The audit Integrity tab says more than it can prove unless someone stops it.
 *
 * hub/internal/store/audithash.go is explicit that the hash chain is a
 * DETECTION control, not a prevention one: an attacker who edits the SQLite
 * file and then recomputes every hash forward through the end of the chain
 * rewrites history undetectably. What the chain defeats is tampering that does
 * not also do that work.
 *
 * A green "Intact" badge with none of that context reads as "this hub is
 * trustworthy", which is a far larger claim — and a console is exactly where
 * that misreading happens, because it is the only place a non-author of the
 * code ever sees the result. So the limits travel with the result.
 *
 * Same technique as phoneLinking.test.ts: source-level checks. They prove the
 * copy is still in the source, not that it renders.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function src(rel: string): string {
  return readFileSync(path.join(repo, rel), 'utf-8');
}

function flat(s: string): string {
  return s.replace(/\s+/g, ' ');
}

describe('the audit integrity tab does not overclaim', () => {
  const page = src('src/pages/app/admin/AdminAudit.tsx');

  it('calls the verify endpoint at all', () => {
    expect(page).toContain('api.adminAuditVerify(');
  });

  it('states that a passing chain is not proof nothing was deleted', () => {
    const f = flat(page).toLowerCase();
    expect(f).toContain('does not mean nothing was deleted');
  });

  it('states that a recomputing attacker is undetectable', () => {
    const f = flat(page).toLowerCase();
    expect(f).toMatch(/recomputed every hash|recomputing/);
    expect(f).toContain('detection control, not a');
  });

  it('shows how many rows were checked, not just a verdict', () => {
    // "OK over zero rows" and "OK over 40,000" are different statements. A tick
    // with no number invites the generous reading of both.
    expect(page).toContain('rows_checked');
    expect(flat(page).toLowerCase()).toContain('checked');
  });

  it('surfaces where a broken chain first breaks', () => {
    expect(page).toContain('broken_at');
    const f = flat(page).toLowerCase();
    expect(f).toContain('first break at row');
  });

  it('renders the signed envelope verbatim rather than re-composed fields', () => {
    // The envelope is the only thing a signature can be checked against;
    // re-serialising the parsed columns would not reproduce it.
    expect(page).toContain('{ev.envelope}');
  });

  it('does not present an empty event list as evidence of an idle device', () => {
    const f = flat(page).toLowerCase();
    expect(f).toContain('it is not a statement that the device has been idle');
  });

  it('keeps a not-found answer indistinguishable from not-permitted', () => {
    // The hub answers 404 for both on purpose, so a guessed device id confirms
    // nothing. Copy that explained them as different states would undo it.
    expect(page).toContain('device_not_found');
    expect(flat(page).toLowerCase()).toContain('deliberately indistinguishable');
  });
});
