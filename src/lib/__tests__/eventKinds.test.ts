import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * proto/events.md's Kinds table says which events the reference controller
 * actually sends. This holds it against the source, in both directions.
 *
 * # The gap this closes
 *
 * The table listed nine kinds with no indication that five of them are emitted
 * by nothing — not the controller, not anything on the hub. `button` is
 * described as driving "intercom-lite: the hub notifies the resident's chat",
 * which reads as a feature. Someone building a hub against this document would
 * write that handler and never see it fire, with no way to distinguish a bug
 * from a quiet gate.
 *
 * That is the inverse of the usual drift here: not a shipped thing documented
 * as unbuilt, but an unbuilt thing documented as if it worked.
 *
 * # Why both directions
 *
 * The `sent` direction catches a kind that stopped being emitted. The
 * `reserved` direction is the one that will actually fire one day: when
 * somebody implements the visitor button, this fails and the table has to move
 * with the code — which is the only reliable way a status column stays true.
 */

const root = resolve(__dirname, '../../..');

/** kind → whether the table claims the controller sends it. */
function documentedKinds(): Map<string, boolean> {
  const md = readFileSync(resolve(root, 'proto/events.md'), 'utf8');
  const start = md.indexOf('| `kind` | `data` | Drives | Status |');
  expect(start, 'the Kinds table has changed shape').toBeGreaterThan(-1);
  const end = md.indexOf('\n\n', start);
  const out = new Map<string, boolean>();
  for (const line of md.slice(start, end).split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // The header row starts with `| \`kind\` |` too. Skipped by name rather
    // than by position, so reordering the table cannot silently drop a row.
    if (cells[1] === '`kind`') continue;
    const names = cells[1].match(/`([a-z_]+)`/g);
    if (!names) continue;
    const status = cells[cells.length - 2];
    const sent = /\*\*sent\*\*/.test(status);
    // A row that says neither is a row nobody has classified.
    expect(
      sent || /^reserved\b/.test(status),
      `the Kinds table row for ${cells[1]} has status "${status}", which is neither ` +
        `**sent** nor reserved — every kind must say which it is`,
    ).toBe(true);
    for (const n of names) out.set(n.replace(/`/g, ''), sent);
  }
  expect(out.size, 'no kinds parsed from the table').toBeGreaterThan(6);
  return out;
}

/** Every kind the reference controller can actually put on the wire. */
function emittedKinds(): Set<string> {
  const dir = resolve(root, 'controller/internal');
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = resolve(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.go') || entry.endsWith('_test.go')) continue;
      const src = readFileSync(full, 'utf8');
      // Both spellings. The agent calls `Recorder.Record("…")`; the command
      // processor has its own lowercase `record("…")` helper, and matching only
      // the capitalised one reported `closed` as never emitted — a false
      // finding that would have been "fixed" by demoting a kind that works.
      for (const m of src.matchAll(/\b[Rr]ecord\("([a-z_]+)"/g)) out.add(m[1]);
      // The reserved partition has its own recorder method rather than a kind
      // string, because it must never share a code path with evictable events.
      if (/RecordGrantRedeemed\(/.test(src)) out.add('grant_redeemed');
    }
  };
  walk(dir);
  expect(out.size, 'no event kinds found in the controller — the recorder API moved').toBeGreaterThan(3);
  return out;
}

describe('controller event kinds', () => {
  it('every kind the table calls "sent" is emitted by the controller', () => {
    const documented = documentedKinds();
    const emitted = emittedKinds();
    const missing = [...documented]
      .filter(([, sent]) => sent)
      .map(([kind]) => kind)
      .filter((kind) => !emitted.has(kind))
      .sort();
    expect(
      missing,
      'the contract says the controller sends these and nothing emits one — a hub author ' +
        'would build a handler that never fires',
    ).toEqual([]);
  });

  it('no kind the table calls reserved is already being emitted', () => {
    const documented = documentedKinds();
    const emitted = emittedKinds();
    const surprising = [...documented]
      .filter(([, sent]) => !sent)
      .map(([kind]) => kind)
      .filter((kind) => emitted.has(kind))
      .sort();
    expect(
      surprising,
      'the controller emits these and the contract calls them reserved — the table has to ' +
        'move with the code, which is what this direction is for',
    ).toEqual([]);
  });

  it('the controller emits no kind the contract has never heard of', () => {
    const documented = documentedKinds();
    const undocumented = [...emittedKinds()].filter((k) => !documented.has(k)).sort();
    expect(
      undocumented,
      'the controller emits kinds absent from proto/events.md — hubs store-and-ignore ' +
        'unknown kinds, so these land in the raw log and drive nothing',
    ).toEqual([]);
  });
});
