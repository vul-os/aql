import { beforeEach, describe, expect, it, vi } from 'vitest';

// automationsState and energyState — the last two exported functions in
// src/components with no test.
//
// Both narrow a fetch into a small set of statuses, and liveState.ts opens by
// saying why that narrowing is the point: "A hub with no rule engine and a hub
// whose rule list failed to load are different sentences, and neither is 'there
// are no rules'." The API answers an unconfigured runtime with 503 and a NAMED
// code precisely so a console can tell them apart, and this is the only place
// that distinction is made.
//
// The properties worth holding are the ones where a plausible simplification
// destroys a distinction rather than breaking a build.

const automations = vi.fn();
const energySeries = vi.fn();
const energyMix = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api')>();
  return { ...real, api: { automations, energySeries, energyMix } };
});

const { ApiError, UNAVAILABLE_CODE } = await import('@/lib/api');
const { automationsState, energyState } = await import('../device/liveState');

function apiErr(status: number, code: string) {
  return new ApiError(status, { error: code });
}

beforeEach(() => {
  automations.mockReset();
  energySeries.mockReset();
  energyMix.mockReset();
});

describe('automationsState', () => {
  it('reports a configured-but-idle scheduler as LIVE, not absent', () => {
    // liveState.ts calls this "the one that is easy to miss": rules can be
    // written with the scheduler off, and they are stored, listed and editable
    // and will not fire. A list that silently never runs looks exactly like a
    // list that works, and only this flag can say otherwise.
    automations.mockResolvedValue({ rules: [{ id: 'r1' }], scheduler_running: false, max_action_tier: 'read' });
    return automationsState('acct').then((s) => {
      expect(s.status).toBe('live');
      expect(s.status === 'live' && s.schedulerRunning).toBe(false);
      expect(s.rules).toHaveLength(1);
    });
  });

  it('takes the action-tier ceiling from the hub rather than assuming one', async () => {
    // A copy of the ceiling in the console is a copy that can disagree with the
    // thing actually enforcing it.
    automations.mockResolvedValue({ rules: [], scheduler_running: true, max_action_tier: 'physical-access' });
    const s = await automationsState('acct');
    expect(s.status === 'live' && s.maxActionTier).toBe('physical-access');

    automations.mockResolvedValue({ rules: [], scheduler_running: true });
    const s2 = await automationsState('acct');
    expect(s2.status === 'live' && s2.maxActionTier, 'a hub that did not say must not be given a made-up ceiling').toBe('');
  });

  it('separates absent, forbidden, unsupported and error', async () => {
    const cases: { err: unknown; want: string }[] = [
      // The hub answered "no such runtime here". The DEFAULT for a hub with no
      // rule engine, and not a failure.
      { err: apiErr(503, 'automations_not_configured'), want: 'absent' },
      // Automations reads are admin-only, so an ordinary member hits this on a
      // perfectly healthy hub. Rendering it as an error tells them their hub is
      // broken.
      { err: apiErr(403, 'forbidden'), want: 'forbidden' },
      // The hub predates the route and the SPA fallback answered with HTML.
      { err: apiErr(200, UNAVAILABLE_CODE), want: 'unsupported' },
      // A genuine failure — the one case where "we do not know" is honest.
      { err: apiErr(500, 'internal'), want: 'error' },
      { err: new TypeError('network down'), want: 'error' },
    ];
    for (const c of cases) {
      automations.mockRejectedValue(c.err);
      const s = await automationsState('acct');
      expect(s.status, String(c.err)).toBe(c.want);
      expect(s.rules, 'a non-live state must not carry rules').toEqual([]);
    }
  });

  it('does not accept the OTHER runtime 503 as its own absence', async () => {
    // The two runtimes are independently configurable and a hub can genuinely
    // have one without the other, which is why the code is passed in rather
    // than matched loosely. A hub with a meter but no rule engine answering
    // energy_not_configured here would otherwise read as "no automations
    // configured" — a confident, wrong sentence about a different subsystem.
    automations.mockRejectedValue(apiErr(503, 'energy_not_configured'));
    const s = await automationsState('acct');
    expect(s.status).toBe('error');
  });

  it('treats an unreadable body as an error rather than an empty list', async () => {
    for (const body of [null, {}, { rules: 'not-an-array' }, { rules: null }]) {
      automations.mockResolvedValue(body);
      const s = await automationsState('acct');
      expect(s.status, JSON.stringify(body)).toBe('error');
    }
  });
});

describe('energyState', () => {
  it('keeps a working series when the source mix fails on its own', async () => {
    // The mix is a SEPARATE request. A working series with no breakdown is a
    // partial answer worth showing; discarding it because the second call
    // failed would be worse than showing it without.
    energySeries.mockResolvedValue({ buckets: [{ kwh: 1 }] });
    energyMix.mockRejectedValue(apiErr(500, 'internal'));
    const s = await energyState('acct');
    expect(s.status).toBe('live');
    expect(s.status === 'live' && s.mix).toBeNull();
    expect(s.status === 'live' && s.series.buckets).toHaveLength(1);
  });

  it('carries the mix when both calls succeed', async () => {
    energySeries.mockResolvedValue({ buckets: [] });
    energyMix.mockResolvedValue({ sources: [] });
    const s = await energyState('acct');
    expect(s.status === 'live' && s.mix).not.toBeNull();
  });

  it('separates its own absence from the automations one', async () => {
    energySeries.mockRejectedValue(apiErr(503, 'energy_not_configured'));
    expect((await energyState('acct')).status).toBe('absent');

    energySeries.mockRejectedValue(apiErr(503, 'automations_not_configured'));
    expect(
      (await energyState('acct')).status,
      'an energy screen must not report the rule engine’s absence as its own',
    ).toBe('error');
  });

  it('narrows forbidden and unsupported the same way automations does', async () => {
    energySeries.mockRejectedValue(apiErr(403, 'forbidden'));
    expect((await energyState('acct')).status).toBe('forbidden');
    energySeries.mockRejectedValue(apiErr(200, UNAVAILABLE_CODE));
    expect((await energyState('acct')).status).toBe('unsupported');
  });

  it('treats an unreadable series as an error rather than an empty meter', async () => {
    // An empty-looking chart and a failed read are different facts about a
    // building's electricity, and only one of them means "nothing was used".
    for (const body of [null, {}, { buckets: 'nope' }]) {
      energySeries.mockResolvedValue(body);
      const s = await energyState('acct');
      expect(s.status, JSON.stringify(body)).toBe('error');
      expect(s.series).toBeNull();
    }
  });

  it('never leaves a non-live state carrying data', async () => {
    // The type says series and mix are null off the live path; this is the
    // runtime check, because a spread that forgot one would still compile.
    for (const err of [apiErr(503, 'energy_not_configured'), apiErr(403, 'x'), apiErr(500, 'x')]) {
      energySeries.mockRejectedValue(err);
      const s = await energyState('acct');
      expect(s.series).toBeNull();
      expect(s.mix).toBeNull();
    }
  });
});
