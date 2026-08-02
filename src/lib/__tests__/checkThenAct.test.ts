import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Check-then-act, in both forms this codebase has: over a mutex, and over the
// database.
//
// The two are the same defect wearing different clothes. Something is read,
// something is decided from it, and the act happens after the guarantee was
// released — a mutex unlocked, or a statement completed with no transaction
// around the pair. Between them these have cost a single-use grant its
// single-use, a poll challenge its replay protection, and the tamper-evident
// audit log six opens for one gate movement.
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

// The database half: a Store method that reads before it writes, with no
// transaction holding the pair together.
//
// ORDER IS THE WHOLE SIGNAL, and getting that wrong nearly accused working code.
// RedeemConfirmation reads and writes without a transaction and is exactly
// right: it does a conditional UPDATE first and checks RowsAffected, which is a
// compare-and-swap in SQL. Flagging "reads and writes" caught it; flagging
// "reads BEFORE it writes" does not, and cut the candidates from nine to five.
const STORE_REVIEWED: Record<string, string> = {
  RecordControllerEvent:
    'FIXED: the INSERT is the claim now — the PRIMARY KEY picks one winner and ' +
    'only the winner appends the audit row. It used to append first, which gave ' +
    'six access_logs rows for one gate movement under concurrent redelivery',
  CreateAccessPointFull:
    'the read VALIDATES ownership (is this device at this location) rather than ' +
    'claiming anything. Racing a device relocation binds an access point to a ' +
    'device that has just moved — narrow, admin-versus-admin, and bounded',
  MaintenanceCreate: 'the read only checks the access point exists; nothing is claimed',
  MintChannelLinkCode:
    'a live-code cap, so two concurrent mints can both pass it and a user ends up ' +
    'one or two over their own limit. Each code is still independently verified ' +
    'and single-use, so the cap is an abuse limit rather than a security boundary — ' +
    'recorded rather than fixed, because a transaction or partial unique index is ' +
    'more machinery than the consequence warrants',
  MintPhoneLinkCode: 'same cap, same reasoning as MintChannelLinkCode',
};

function storeReadBeforeWrite(): string[] {
  const dir = join(root, 'hub', 'internal', 'store');
  const found: string[] = [];
  for (const abs of goFiles(dir)) {
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/\nfunc \(s \*Store\) (\w+)\([\s\S]*?\n\}/g)) {
      const body = m[0];
      if (/BeginTx|\.Begin\(/.test(body)) continue;
      const read = body.search(/QueryRowContext|QueryContext/);
      const write = body.search(/ExecContext/);
      if (read >= 0 && write >= 0 && read < write) found.push(m[1]);
    }
  }
  return [...new Set(found)].sort();
}

describe('store methods that read before they write', () => {
  it('are all reviewed, with the reason recorded', () => {
    const found = storeReadBeforeWrite();
    expect(found.length, 'no read-before-write methods found; the scan is broken').toBeGreaterThanOrEqual(4);

    const unreviewed = found.filter((fn) => STORE_REVIEWED[fn] === undefined);
    expect(
      unreviewed,
      `these read a row and then write, with nothing holding the pair together. Decide
which kind it is:

  A CLAIM on something single-use — an invite, a token, a code, a challenge —
  must be a conditional UPDATE checked by RowsAffected, or an INSERT whose
  uniqueness constraint picks the winner. RedeemConfirmation is the example to
  copy.

  A VALIDATION read, or a cap whose worst case is bounded, can stay — say so
  here, with what the worst case actually is.`,
    ).toEqual([]);
  });

  it('has no stale entries', () => {
    const live = new Set(storeReadBeforeWrite());
    const stale = Object.keys(STORE_REVIEWED).filter((fn) => !live.has(fn));
    expect(stale, 'these no longer read before writing — remove them').toEqual([]);
  });
});
