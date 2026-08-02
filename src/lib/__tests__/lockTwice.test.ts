import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Functions that take a lock, release it, and take it again.
//
// # Why this is a guard and not a one-off sweep
//
// A sweep for this shape found ten functions across the two Go modules and two
// LIVE defects in them, both on security-critical paths:
//
//   - grants.HandleProof read `used[cnonce]`, released the lock, verified, and
//     only then consumed — so eight concurrent posts of one proof redeemed a
//     single-use emergency grant eight times.
//   - Hub.ConsumePollChallenge did the same with a poll challenge, so eight
//     concurrent auths for one cnonce were all accepted, which is the replay
//     protection on the long-poll path not existing under load.
//
// Both were invisible to every other check here. Each side is internally
// consistent, the race detector sees no race — the accesses ARE synchronised —
// and the tests passed, because nothing tried two at once. What is wrong is the
// gap between the check and the act, and the only cheap way to find it is to
// look for the shape.
//
// # Why an allowlist rather than a ban
//
// Locking twice is often correct. Seven of the ten are: a timer callback that
// re-checks state under the lock before touching hardware, a closure that
// re-checks identity before deleting, two independent sections that happen to
// share a mutex. Banning the shape would force those to be rewritten worse.
//
// So each one is listed with what makes it safe. A new one fails this test
// until somebody works out which kind it is — which is the whole point, because
// both defects above were written by someone who had not.

const root = join(__dirname, '..', '..', '..');

/** file -> function -> why locking twice is safe there. */
const REVIEWED: Record<string, Record<string, string>> = {
  'controller/internal/relay/gpio.go': {
    'Pulse': 'the AfterFunc callback takes g.mu and re-checks g.state before touching the line',
  },
  'controller/internal/relay/relay.go': {
    'Pulse': 'the mock callback takes m.mu and re-checks "pulsing" before changing state',
  },
  'controller/internal/grants/grants.go': {
    'HandleProof':
      'FIXED: the consume is a compare-and-swap — whoever still finds the pending ' +
      'cnonce takes it, everyone else is cnonce_replay. The early read is only for ' +
      'reporting order and decides nothing',
  },
  'hub/internal/hub/hub.go': {
    'Register':
      'the second acquisition is the returned unregister closure, which re-checks ' +
      'conns[id] == c before deleting so a displaced connection cannot remove its ' +
      'replacement',
    'Dispatch':
      'the connection is read under the lock and used after it, which is safe ' +
      'because the send channel is NEVER closed (only done is) and the send is ' +
      'non-blocking with a default',
    'ConsumePollChallenge':
      'FIXED: the consume re-reads the challenge under the lock and refuses if ' +
      'another caller consumed it first; a challenge swept in between is ' +
      'cnonce_unknown, which is a different fact from replayed',
  },
  'hub/internal/automations/runner.go': {
    'Tick':
      'prev spans the whole rule evaluation, which does driver I/O, so it cannot ' +
      'be atomic — Tick refuses an overlapping call instead, which is the ' +
      'invariant it actually needs',
    'tickThreshold':
      'the edge read-decide-write is one acquisition now; the earlier read feeds ' +
      'only the unreadable-sensor report, which actuates nothing',
    'tickClip': 'read and write in ONE acquisition — test-and-set on clipBlind',
  },
  'hub/internal/devices/mqtt/client.go': {
    'pump': 'two independent sections: a lastRecv stamp, and a PUBACK lookup-and-delete that is itself atomic',
  },
};

function goFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) goFiles(p, out);
    else if (entry.endsWith('.go') && !entry.endsWith('_test.go')) out.push(p);
  }
  return out;
}

/** Every function body containing two or more Lock() calls on a mutex field. */
function lockTwice(): Array<{ file: string; fn: string }> {
  const found: Array<{ file: string; fn: string }> = [];
  for (const mod of ['hub/internal', 'controller/internal']) {
    for (const abs of goFiles(join(root, mod))) {
      const src = readFileSync(abs, 'utf8');
      // Top-level funcs: from `\nfunc ` to the closing brace in column 0.
      for (const m of src.matchAll(/\nfunc (?:\([^)]*\) )?(\w+)\([\s\S]*?\n\}/g)) {
        const locks = m[0].match(/\.(?:mu|Mu|lock|mtx)\w*\.Lock\(\)/g) ?? [];
        if (locks.length >= 2) found.push({ file: relative(root, abs), fn: m[1] });
      }
    }
  }
  return found;
}

describe('functions that take a lock more than once', () => {
  it('are all reviewed, with the reason recorded', () => {
    const found = lockTwice();

    // The floor. A regex that stops matching would report an empty list and
    // pass forever — the failure mode this repository has found in its own
    // guards more than once.
    expect(
      found.length,
      'no lock-twice functions found at all; the scan is broken, not the code',
    ).toBeGreaterThanOrEqual(8);

    const unreviewed = found
      .filter((f) => REVIEWED[f.file]?.[f.fn] === undefined)
      .map((f) => `${f.file}: ${f.fn}`)
      .sort();

    expect(
      unreviewed,
      `these take a lock, release it, and take it again. Work out which kind it is
before adding it here:

  SAFE — the second acquisition re-checks what the first read (compare-and-swap,
  test-and-set, or a callback verifying state before acting), or the two
  sections are independent.

  A DEFECT — something read under the first lock DECIDES something acted on
  after the second, with no re-check. That is what let a single-use grant be
  redeemed eight times and a poll challenge authenticate eight times, both
  found by this exact scan.`,
    ).toEqual([]);
  });

  it('has no stale entries', () => {
    // An entry for a function that no longer locks twice is an exemption doing
    // nothing, and the next reader would take it as evidence the code was
    // examined.
    const found = lockTwice();
    const live = new Set(found.map((f) => `${f.file}:${f.fn}`));
    const stale: string[] = [];
    for (const [file, fns] of Object.entries(REVIEWED)) {
      for (const fn of Object.keys(fns)) {
        if (!live.has(`${file}:${fn}`)) stale.push(`${file}: ${fn}`);
      }
    }
    expect(
      stale,
      'these no longer take a lock twice — remove them rather than leaving an ' +
        'exemption that covers nothing',
    ).toEqual([]);
  });
});
