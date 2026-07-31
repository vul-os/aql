import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every refusal a gate can send has words for the person standing at it.
 *
 * # The gap this closes
 *
 * `DENIAL_TEXT` carried the comment "every reason the 11-step order can produce
 * is here" and nothing checked it. It stopped being true the moment the
 * verification core gained step 3a: a revoked grant — the one refusal that is
 * deliberate rather than accidental, and the one a person must NOT read as
 * "try again" — rendered as the fallback, `The controller refused: revoked.`
 *
 * # Where the expected set comes from
 *
 * The Go that actually produces these strings: `deny(wire.ReasonX)` in the
 * verification core, plus the two transports, which refuse malformed frames
 * before the core is reached. Not from commands.md's cmd.ack vocabulary, which
 * OVERLAPS but is not the same set — `window_too_long` and `replay` are
 * envelope checks on commands and no redemption can produce them.
 *
 * Reading the source rather than restating it is the point: a list maintained
 * here would drift exactly as the comment did.
 */

const root = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

/** Reason constant name → wire value, from the Go that defines them. */
function wireReasons(): Map<string, string> {
  const src = read('controller/internal/wire/wire.go');
  const out = new Map<string, string>();
  for (const m of src.matchAll(/Reason([A-Za-z]+)\s*=\s*"([^"]+)"/g)) out.set(m[1], m[2]);
  expect(out.size, 'no Reason constants parsed — wire.go moved').toBeGreaterThan(10);
  return out;
}

/** Every detail string a redemption can be refused with. */
function refusalDetails(): Set<string> {
  const reasons = wireReasons();
  const details = new Set<string>();

  // The verification core: `deny(wire.ReasonX)`.
  const core = read('controller/internal/grants/grants.go');
  for (const m of core.matchAll(/deny\(wire\.Reason([A-Za-z]+)\)/g)) {
    const value = reasons.get(m[1]);
    expect(value, `grants.go denies with wire.Reason${m[1]}, which wire.go does not define`).toBeDefined();
    details.add(value!);
  }
  expect(details.size, 'no deny() calls parsed — the verification core moved').toBeGreaterThan(8);

  // The transports, which refuse malformed frames before the core runs. These
  // reach a person exactly as the core's do.
  for (const file of [
    'controller/internal/lanserver/lanserver.go',
    'controller/internal/blesession/session.go',
  ]) {
    const src = read(file);
    for (const m of src.matchAll(/Detail:\s*wire\.Reason([A-Za-z]+)/g)) {
      const value = reasons.get(m[1]);
      if (value) details.add(value);
    }
    for (const m of src.matchAll(/Detail:\s*"([a-z_]+)"/g)) details.add(m[1]);
  }
  return details;
}

/** The keys DENIAL_TEXT declares. */
function denialTextKeys(): Set<string> {
  const src = read('src/lib/offline/redeem.ts');
  const start = src.indexOf('const DENIAL_TEXT');
  expect(start, 'DENIAL_TEXT is no longer declared').toBeGreaterThan(-1);
  const end = src.indexOf('\n};', start);
  expect(end, 'DENIAL_TEXT is unterminated').toBeGreaterThan(start);
  const body = src
    .slice(start, end)
    // Comments inside the map would otherwise contribute words that look like
    // keys — the same prose-matching failure the automation-shape guard hit.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') ? '' : l))
    .join('\n');
  return new Set([...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));
}

describe('grant denial vocabulary', () => {
  it('every refusal a gate can send has words for the person at it', () => {
    const expected = refusalDetails();
    const have = denialTextKeys();
    const missing = [...expected].filter((d) => !have.has(d)).sort();

    expect(
      missing,
      'a gate can refuse with these and the app has no words for them, so a person is ' +
        'shown a raw protocol token. `revoked` in particular must not read as "try again" — ' +
        'it is the one refusal somebody chose.',
    ).toEqual([]);
  });

  it('DENIAL_TEXT has no entries for refusals a redemption cannot produce', () => {
    // The other direction, and a weaker claim on purpose: an entry for a reason
    // nothing sends is dead text, not a bug someone hits. It is worth knowing
    // because it is how the comment drifted — a map maintained against
    // commands.md rather than against what a redemption actually returns.
    const expected = refusalDetails();
    const stale = [...denialTextKeys()].filter((k) => !expected.has(k)).sort();
    expect(
      stale,
      'DENIAL_TEXT explains refusals no redemption can produce — either the core stopped ' +
        'sending them, or they were copied from the command vocabulary',
    ).toEqual([]);
  });
});
