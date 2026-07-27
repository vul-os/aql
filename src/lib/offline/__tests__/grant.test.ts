// Grant validation, the app-side mirror of the controller's checks, and
// grant selection.
//
// The base fixture is the real `grant-redeem-valid` object from
// proto/vectors/grants.json — a genuinely hub-signed grant — so the refusal
// cases below are mutations of something that would otherwise be accepted,
// not of a plausible-looking invention.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOCK_SKEW_SECONDS,
  evaluate,
  inAnyWindow,
  isAlwaysOpenWindow,
  isExpired,
  needsRefresh,
  parseGrant,
  parseStoredGrant,
  secondsUntilExpiry,
  selectGrantForAccessPoint,
  type Grant,
} from '../grant';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(here, '../../../../proto/vectors');

const corpus = JSON.parse(
  readFileSync(path.join(vectorsDir, 'grants.json'), 'utf-8'),
) as { vectors: Array<{ name: string; grant?: { object: Grant }; check?: { now: number; device_id: string } }> };

const validVector = corpus.vectors.find((v) => v.name === 'grant-redeem-valid')!;
const VALID: Grant = validVector.grant!.object;
const NOW = validVector.check!.now; // 1789030800, inside the grant's validity
const DEVICE = validVector.check!.device_id;
const APP_PUBKEY = VALID.app_pubkey;

function mutate(patch: Partial<Grant>): Grant {
  return { ...VALID, ...patch };
}

describe('parseGrant', () => {
  it('accepts the conformance corpus grant unchanged', () => {
    const r = parseGrant(VALID);
    expect(r.ok).toBe(true);
  });

  it('accepts every grant object in the corpus (including the deny vectors)', () => {
    // The deny vectors are structurally valid grants that fail a *semantic*
    // check at the controller — parseGrant must not reject them structurally,
    // or the app would report the wrong reason.
    for (const v of corpus.vectors) {
      if (!v.grant) continue;
      const r = parseGrant(v.grant.object);
      // grant-badsig deliberately carries a signature from the wrong key —
      // still 64 bytes, so still structurally valid.
      expect(r.ok, v.name).toBe(true);
    }
  });

  const rejections: Array<[string, unknown, RegExp]> = [
    ['not an object', 'nope', /not a JSON object/],
    ['an array', [], /not a JSON object/],
    ['null', null, /not a JSON object/],
    ['a future wire version', mutate({ v: 1 }), /unsupported version/],
    ['the wrong typ', mutate({ typ: 'grant.open' as unknown as 'grant' }), /wrong type/],
    ['no grant_id', mutate({ grant_id: '' }), /missing grant_id/],
    ['no member', mutate({ member: '' }), /missing member/],
    ['a short app_pubkey', mutate({ app_pubkey: 'AAAA' }), /32-byte ed25519/],
    ['a non-base64url app_pubkey', mutate({ app_pubkey: 'not a key!!' }), /32-byte ed25519/],
    ['no devices', mutate({ devices: [] }), /missing devices/],
    ['no access points', mutate({ access_points: [] }), /missing access_points/],
    ['no windows', mutate({ windows: [] }), /missing windows/],
    ['a malformed window day', mutate({ windows: [{ days: 'funday', from: '00:00', to: '24:00' }] }), /window days/],
    ['a malformed window time', mutate({ windows: [{ days: 'mon-sun', from: '8am', to: '24:00' }] }), /window time/],
    ['an out-of-range window time', mutate({ windows: [{ days: 'mon-sun', from: '25:00', to: '26:00' }] }), /window time/],
    ['a backwards day range', mutate({ windows: [{ days: 'fri-mon', from: '00:00', to: '24:00' }] }), /window days/],
    ['a non-integer iat', mutate({ iat: 1.5 }), /missing iat\/exp/],
    ['exp before iat', mutate({ exp: VALID.iat - 1 }), /exp is not after iat/],
    ['a truncated sig', mutate({ sig: 'AAAA' }), /malformed sig/],
    ['no sig at all', mutate({ sig: '' }), /malformed sig/],
  ];

  for (const [label, input, reason] of rejections) {
    it(`refuses ${label}`, () => {
      const r = parseGrant(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    });
  }
});

describe('parseStoredGrant — a blob read back off the device', () => {
  it('accepts what was written', () => {
    expect(parseStoredGrant(JSON.stringify(VALID)).ok).toBe(true);
  });

  it('refuses a truncated blob instead of throwing', () => {
    const r = parseStoredGrant(JSON.stringify(VALID).slice(0, 120));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not valid JSON/);
  });

  it('refuses an empty blob', () => {
    expect(parseStoredGrant('').ok).toBe(false);
  });

  it('refuses a blob that is valid JSON but not a grant', () => {
    const r = parseStoredGrant('{"hello":"world"}');
    expect(r.ok).toBe(false);
  });
});

describe('evaluate — the checks the app runs before it presents anything', () => {
  const base = { grant: VALID, accessPointId: 'main', nowSec: NOW, appPubkey: APP_PUBKEY, deviceId: DEVICE };

  it('passes the happy path the corpus accepts', () => {
    expect(evaluate(base)).toEqual({ status: 'ok' });
  });

  it('refuses when this device holds no key', () => {
    const v = evaluate({ ...base, appPubkey: null });
    expect(v).toMatchObject({ status: 'refuse', code: 'no_app_key' });
  });

  it('refuses when the grant is bound to another key (controller would say badsig)', () => {
    const v = evaluate({ ...base, appPubkey: 'x'.repeat(43) });
    expect(v).toMatchObject({ status: 'refuse', code: 'key_mismatch' });
  });

  it('refuses an expired grant at exp, without spending the controller\'s 90s skew', () => {
    expect(evaluate({ ...base, nowSec: VALID.exp })).toEqual({ status: 'ok' });
    expect(evaluate({ ...base, nowSec: VALID.exp + 1 })).toMatchObject({
      status: 'refuse',
      code: 'expired',
    });
    // The controller would still accept here (exp + 90); we do not.
    expect(evaluate({ ...base, nowSec: VALID.exp + CLOCK_SKEW_SECONDS })).toMatchObject({
      status: 'refuse',
      code: 'expired',
    });
  });

  it('refuses a not-yet-valid grant, allowing the same skew the controller does', () => {
    expect(evaluate({ ...base, nowSec: VALID.iat - CLOCK_SKEW_SECONDS })).toEqual({ status: 'ok' });
    expect(evaluate({ ...base, nowSec: VALID.iat - CLOCK_SKEW_SECONDS - 1 })).toMatchObject({
      status: 'refuse',
      code: 'not_yet_valid',
    });
  });

  it('refuses a gate the grant does not cover', () => {
    expect(evaluate({ ...base, accessPointId: 'service-hatch' })).toMatchObject({
      status: 'refuse',
      code: 'wrong_access_point',
    });
  });

  it('refuses a controller the grant does not list', () => {
    expect(evaluate({ ...base, deviceId: 'de71ce00-0000-4000-8000-000000000009' })).toMatchObject({
      status: 'refuse',
      code: 'wrong_device',
    });
  });

  it('does not refuse when the controller is unknown — the controller checks itself', () => {
    expect(evaluate({ ...base, deviceId: null })).toEqual({ status: 'ok' });
  });

  it('reports the controller\'s first-failure order: key, then validity, then gate', () => {
    const wrongEverything = evaluate({
      grant: mutate({ exp: NOW - 1 }),
      accessPointId: 'nope',
      nowSec: NOW,
      appPubkey: 'y'.repeat(43),
      deviceId: 'other',
    });
    expect(wrongEverything).toMatchObject({ code: 'key_mismatch' });
  });

  it('warns (never hard-refuses) on a window miss, because the timezone is the controller\'s', () => {
    // 2026-07-27 is a Monday; 12:00 UTC is outside an 18:00-22:00 window.
    const monNoon = Math.floor(Date.UTC(2026, 6, 27, 12, 0, 0) / 1000);
    const evening = mutate({
      windows: [{ days: 'mon-sun', from: '18:00', to: '22:00' }],
      iat: monNoon - 3600,
      exp: monNoon + 3600,
    });
    const v = evaluate({ ...base, grant: evening, nowSec: monNoon });
    expect(v).toMatchObject({ status: 'warn', code: 'window' });
  });
});

describe('inAnyWindow — mirror of controller/internal/grants.InAnyWindow (UTC)', () => {
  const at = (y: number, m: number, d: number, hh: number, mm: number) =>
    Math.floor(Date.UTC(y, m, d, hh, mm, 0) / 1000);

  const monday = (hh: number, mm: number) => at(2026, 6, 27, hh, mm); // Mon 27 Jul 2026
  const saturday = (hh: number, mm: number) => at(2026, 6, 25, hh, mm); // Sat 25 Jul 2026

  it('accepts the v0 always-open window at any moment', () => {
    const w = [{ days: 'mon-sun', from: '00:00', to: '24:00' }];
    expect(inAnyWindow(w, monday(0, 0))).toBe(true);
    expect(inAnyWindow(w, saturday(23, 59))).toBe(true);
    expect(isAlwaysOpenWindow(w)).toBe(true);
  });

  it('treats `to` as exclusive and 24:00 as end of day', () => {
    const w = [{ days: 'mon-sun', from: '08:00', to: '17:00' }];
    expect(inAnyWindow(w, monday(8, 0))).toBe(true);
    expect(inAnyWindow(w, monday(16, 59))).toBe(true);
    expect(inAnyWindow(w, monday(17, 0))).toBe(false);
    expect(inAnyWindow([{ days: 'mon-sun', from: '23:00', to: '24:00' }], monday(23, 59))).toBe(true);
  });

  it('honours inclusive day ranges in week order', () => {
    const w = [{ days: 'mon-fri', from: '00:00', to: '24:00' }];
    expect(inAnyWindow(w, monday(9, 0))).toBe(true);
    expect(inAnyWindow(w, saturday(9, 0))).toBe(false);
    expect(inAnyWindow([{ days: 'sat', from: '00:00', to: '24:00' }], saturday(9, 0))).toBe(true);
  });

  it('accepts when any one window matches', () => {
    const w = [
      { days: 'mon-fri', from: '08:00', to: '09:00' },
      { days: 'mon-fri', from: '17:00', to: '18:00' },
    ];
    expect(inAnyWindow(w, monday(17, 30))).toBe(true);
    expect(inAnyWindow(w, monday(12, 0))).toBe(false);
  });

  it('ignores malformed windows rather than crashing on them', () => {
    expect(inAnyWindow([{ days: 'nope', from: '00:00', to: '24:00' }], monday(9, 0))).toBe(false);
    expect(inAnyWindow([{ days: 'mon-sun', from: 'xx:xx', to: '24:00' }], monday(9, 0))).toBe(false);
  });
});

describe('expiry and refresh', () => {
  it('counts down to exp', () => {
    expect(secondsUntilExpiry(VALID, VALID.exp - 60)).toBe(60);
    expect(isExpired(VALID, VALID.exp)).toBe(false);
    expect(isExpired(VALID, VALID.exp + 1)).toBe(true);
  });

  it('calls a refresh due at half-life, so revocation converges faster than the TTL', () => {
    const life = VALID.exp - VALID.iat;
    expect(needsRefresh(VALID, VALID.iat + life / 2 - 1)).toBe(false);
    expect(needsRefresh(VALID, VALID.iat + life / 2)).toBe(true);
    expect(needsRefresh(VALID, VALID.exp + 10)).toBe(true);
  });
});

describe('selectGrantForAccessPoint', () => {
  const early = mutate({ grant_id: 'a', exp: NOW + 100 });
  const late = mutate({ grant_id: 'b', exp: NOW + 5000 });
  const other = mutate({ grant_id: 'c', access_points: ['service'], exp: NOW + 9000 });
  const dead = mutate({ grant_id: 'd', exp: NOW - 1 });

  it('returns null when nothing covers the gate', () => {
    expect(selectGrantForAccessPoint([other], 'main', NOW)).toBeNull();
    expect(selectGrantForAccessPoint([], 'main', NOW)).toBeNull();
  });

  it('ignores expired grants entirely', () => {
    expect(selectGrantForAccessPoint([dead], 'main', NOW)).toBeNull();
  });

  it('prefers the longest-lived grant that covers the gate', () => {
    expect(selectGrantForAccessPoint([early, late, other, dead], 'main', NOW)?.grant_id).toBe('b');
  });
});
