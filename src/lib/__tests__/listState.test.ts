// "Loading…" forever, on three screens.
//
// Members, Grants and Access Points each held their rows as `T[] | null` and
// rendered `null` as a spinner. A failed fetch also leaves them `null`. So a
// dropped connection left all three spinning permanently — and an operator has
// no way to tell a screen that will never resolve from a hub that is merely
// slow. They wait.
//
// Two of the three had an error banner above the spinner, which made it worse
// rather than better: "Failed to load members" over "Loading…" is a screen
// arguing with itself. The third showed nothing at all.
//
// ListState makes the three answers unrepresentable as one another. There is no
// shared value between "failed" and "empty", so a screen cannot accidentally
// render one as the other.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listLoading, loadList, type ListState } from '@/components/ui/ListState';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf-8');

/** What ListStateCard decides to draw, which is the part that was wrong. */
function cardFor<T>(state: ListState<T>): 'loading' | 'failed' | 'empty' | 'rows' {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'failed') return 'failed';
  return state.items.length === 0 ? 'empty' : 'rows';
}

const describeErr = (_e: unknown, fallback: string) => fallback;

describe('loadList keeps a failure and an empty list apart', () => {
  it('narrows a rejected fetch to failed, never to empty', async () => {
    const state = await loadList<string>(
      async () => {
        throw new Error('socket closed');
      },
      'Could not load the list.',
      describeErr,
    );
    // THE bug: this used to be indistinguishable from a list with no rows,
    // because both were `null`.
    expect(cardFor(state)).toBe('failed');
    expect(cardFor(state)).not.toBe('empty');
    expect(cardFor(state)).not.toBe('loading');
  });

  it('narrows a genuinely empty answer to empty', async () => {
    const state = await loadList<string>(async () => [], 'nope', describeErr);
    expect(cardFor(state)).toBe('empty');
  });

  it('narrows rows to rows', async () => {
    const state = await loadList(async () => ['a', 'b'], 'nope', describeErr);
    expect(cardFor(state)).toBe('rows');
  });

  it('only the initial state is loading, so a failure can never re-enter it', async () => {
    expect(cardFor(listLoading)).toBe('loading');
    const failed = await loadList<string>(
      async () => {
        throw new Error('x');
      },
      'nope',
      describeErr,
    );
    // The permanent-spinner bug in one assertion: a resolved-and-failed fetch
    // must not be able to present as still in flight.
    expect(failed.status).not.toBe('loading');
  });

  it('carries a human sentence rather than leaving the caller to interpret null', async () => {
    const state = await loadList<string>(
      async () => {
        throw new Error('boom');
      },
      'Could not load the member list.',
      describeErr,
    );
    expect(state.status === 'failed' && state.message).toBe('Could not load the member list.');
  });
});

// The three screens must actually use it. A shared narrowing nothing calls is
// the "built but unreachable" shape this repo has shipped repeatedly, and here
// it would leave the original bug in place behind a tidy abstraction.
describe('the three screens that had this bug use ListState', () => {
  const screens = [
    'src/pages/app/Members.tsx',
    'src/pages/app/Grants.tsx',
    'src/pages/app/AccessPoints.tsx',
  ];

  it('each one loads through loadList and renders through ListStateCard', () => {
    for (const rel of screens) {
      const src = read(rel);
      expect(src, `${rel} does not load through loadList`).toContain('loadList(');
      expect(src, `${rel} does not render through ListStateCard`).toContain('<ListStateCard');
    }
  });

  it('none of them still renders a bare "Loading…" card for a null list', () => {
    for (const rel of screens) {
      const src = read(rel);
      // The exact shape that produced the permanent spinner: a null check whose
      // consequent is a loading card.
      expect(src, `${rel} still has a null-means-loading branch`).not.toMatch(
        /=== null \? \(\s*<Card>\s*<p[^>]*>Loading/,
      );
    }
  });

  it('none of them keeps a separate error banner that could disagree with the list', () => {
    // Two of the three showed "Failed to load…" ABOVE "Loading…". One place to
    // say what happened, so the screen cannot contradict itself.
    for (const rel of screens) {
      const src = read(rel);
      expect(src, `${rel} still has a page-level error banner`).not.toMatch(
        /\{error &&\s*\(\s*<Card className="mb-6 border-terracotta\/40">/,
      );
    }
  });
});
