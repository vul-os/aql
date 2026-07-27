import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  automationsNotice,
  bucketCaveat,
  classifyRuntimeError,
  coverageRatio,
  energyNotice,
  mixCaveat,
  mixIsProportional,
  schedulerWarning,
  seriesTotals,
  trippedRules,
  type AutomationsState,
  type EnergyState,
} from '@/components/demo/liveState';
import type { AutomationRule, EnergyBucket, EnergyMixResponse } from '@/lib/api';

// These are the rules that decide what a person is TOLD when a runtime is not
// live. They are worth testing on their own precisely because every one of them
// is a sentence that could quietly become false — and a wrong sentence here
// reads as authoritative.

function bucket(over: Partial<EnergyBucket>): EnergyBucket {
  return {
    device_key: 'mqtt:meter-1',
    metric: 'kwh',
    grain: 'hour',
    tz: 'UTC',
    start: 0,
    end: 3600,
    kwh: 1,
    estimated_kwh: 0,
    coverage_seconds: 3600,
    expected_seconds: 3600,
    sample_count: 60,
    delta_count: 59,
    reset_count: 0,
    quality: 'complete',
    min_kw: null,
    max_kw: null,
    mean_kw: null,
    ...over,
  };
}

function rule(over: Partial<AutomationRule>): AutomationRule {
  return {
    id: 'r1',
    name: 'Dusk lights',
    enabled: true,
    trigger: { kind: 'schedule' },
    conditions: [],
    action: { verb: 'on', device_key: 'mock:lamp-1' },
    min_interval_seconds: 0,
    created_at: 0,
    updated_at: 0,
    action_tier: 'reversible',
    max_action_tier: 'consequential',
    created_by: 'u1',
    created_by_snapshot: 'pat',
    last_outcome: '',
    last_fired_at: 0,
    last_occurrence_at: 0,
    consecutive_failures: 0,
    ...over,
  };
}

describe('runtime error classification', () => {
  // The API answers an unconfigured runtime with a NAMED 503 rather than a 404
  // or an empty list, specifically so this distinction can be made. Losing it
  // here would waste the only part of the design that makes it visible.
  it('a named 503 is absence, not failure', () => {
    const err = new ApiError(503, { error: 'automations_not_configured' });
    expect(classifyRuntimeError(err, 'automations_not_configured').status).toBe('absent');
  });

  // The two runtimes are independently configurable: a hub can genuinely have
  // a meter and no rule engine. An energy screen must not read the rule
  // engine's absence as its own.
  it('another runtime’s absence code is not this runtime’s absence', () => {
    const err = new ApiError(503, { error: 'automations_not_configured' });
    expect(classifyRuntimeError(err, 'energy_not_configured').status).toBe('error');
  });

  // Automations reads are admin-only, so an ordinary member hits 403 on a
  // perfectly healthy hub. Calling that an error tells them their hub is broken.
  it('403 is a permission answer, not a broken hub', () => {
    const err = new ApiError(403, { error: 'forbidden' });
    expect(classifyRuntimeError(err, 'automations_not_configured').status).toBe('forbidden');
  });

  it('a genuine failure keeps a message', () => {
    const got = classifyRuntimeError(new Error('network down'), 'energy_not_configured');
    expect(got.status).toBe('error');
    expect(got.message).toBeTruthy();
  });
});

describe('notices say what is true', () => {
  it('every non-live status produces a sentence, and none of them says "no rules"', () => {
    for (const status of ['absent', 'forbidden', 'unsupported', 'error'] as const) {
      const state = { status, rules: [], message: 'x' } as AutomationsState;
      const notice = automationsNotice(state);
      expect(notice, `${status} produced no notice`).toBeTruthy();
      // The failure this guards: a screen that renders an empty list and lets
      // the reader assume there is nothing to see.
      expect(notice!.length).toBeGreaterThan(30);
    }
  });

  it('a live engine with rules needs no notice — the rows speak for themselves', () => {
    const state: AutomationsState = {
      status: 'live', rules: [rule({})], schedulerRunning: true, maxActionTier: 'consequential',
    };
    expect(automationsNotice(state)).toBeNull();
  });

  it('a live engine with NO rules still says so, rather than showing blank', () => {
    const state: AutomationsState = {
      status: 'live', rules: [], schedulerRunning: true, maxActionTier: 'consequential',
    };
    expect(automationsNotice(state)).toContain('no rules');
  });

  it('energy notices cover every non-live status too', () => {
    for (const status of ['absent', 'forbidden', 'unsupported', 'error'] as const) {
      const state = { status, series: null, mix: null, message: 'x' } as EnergyState;
      expect(energyNotice(state), `${status} produced no notice`).toBeTruthy();
    }
  });
});

// The warning with no other home. The fetch worked, the rules are real and
// editable, and they still do nothing — nothing else in the console can say it.
describe('scheduler warning', () => {
  it('warns when rules exist and nothing will fire them', () => {
    const state: AutomationsState = {
      status: 'live', rules: [rule({}), rule({ id: 'r2' })],
      schedulerRunning: false, maxActionTier: 'consequential',
    };
    const warn = schedulerWarning(state);
    expect(warn).toContain('not running');
    expect(warn).toContain('2 enabled rules');
  });

  it('is silent when the scheduler is running', () => {
    expect(schedulerWarning({
      status: 'live', rules: [rule({})], schedulerRunning: true, maxActionTier: 'c',
    })).toBeNull();
  });

  it('is silent when there is nothing to fire', () => {
    expect(schedulerWarning({
      status: 'live', rules: [], schedulerRunning: false, maxActionTier: 'c',
    })).toBeNull();
  });
});

describe('breaker-tripped rules are distinguishable from ones a person turned off', () => {
  it('only counts rules the breaker disabled', () => {
    const state: AutomationsState = {
      status: 'live',
      rules: [
        rule({ id: 'off-by-hand', enabled: false }),
        rule({ id: 'tripped', enabled: false, disabled_at: 1700000000, disabled_reason: '5 failures' }),
      ],
      schedulerRunning: true,
      maxActionTier: 'consequential',
    };
    const tripped = trippedRules(state);
    expect(tripped).toHaveLength(1);
    expect(tripped[0].id).toBe('tripped');
    expect(tripped[0].disabled_reason).toBeTruthy();
  });
});

describe('bucket honesty', () => {
  it('a complete bucket carries no caveat', () => {
    expect(bucketCaveat(bucket({ quality: 'complete' }))).toBeNull();
  });

  it('a partial bucket says how much was actually measured', () => {
    const caveat = bucketCaveat(bucket({
      quality: 'partial', coverage_seconds: 1800, expected_seconds: 3600,
    }));
    expect(caveat).toContain('50%');
  });

  it('an estimated bucket says it was interpolated', () => {
    expect(bucketCaveat(bucket({ quality: 'estimated' }))).toContain('interpolated');
  });

  it('an empty bucket says nothing was measured', () => {
    expect(bucketCaveat(bucket({ quality: 'empty', kwh: null }))).toContain('nothing was measured');
  });

  // A hub newer than this console must not have its unfamiliar label rendered
  // as trustworthy. That is the one wrong direction to guess in.
  it('an unrecognised quality is flagged, not assumed good', () => {
    const caveat = bucketCaveat(bucket({ quality: 'brand-new-label' }));
    expect(caveat).toContain('caution');
  });

  it('coverage is null rather than a fake 100% when the engine did not say', () => {
    expect(coverageRatio({ coverage_seconds: 0, expected_seconds: 0 })).toBeNull();
  });
});

describe('series totals never silently include a guess', () => {
  it('separates the measured floor from the interpolated part', () => {
    const t = seriesTotals([
      bucket({ kwh: 2, estimated_kwh: 0 }),
      bucket({ kwh: 3, estimated_kwh: 1, quality: 'partial' }),
    ]);
    expect(t.totalKwh).toBe(5);
    expect(t.estimatedKwh).toBe(1);
    // The number a reader can actually stand behind.
    expect(t.measuredKwh).toBe(4);
  });

  // The distinction the whole engine is built around: an hour nobody measured
  // is not an hour that used nothing.
  it('a null bucket is skipped, not counted as zero', () => {
    const t = seriesTotals([bucket({ kwh: 4 }), bucket({ kwh: null, quality: 'empty' })]);
    expect(t.totalKwh).toBe(4);
    expect(t.measuredBuckets).toBe(1);
    expect(t.unmeasuredBuckets).toBe(1);
  });
});

describe('a mix may only be drawn proportionally when both flags allow it', () => {
  const mix = (over: Partial<EnergyMixResponse>): EnergyMixResponse => ({
    from: 0, to: 3600, tz: 'UTC', totals: [],
    supply_kwh: 10, sink_kwh: 0, net_consumption_kwh: 10,
    unattributed_kwh: 0, sub_meter_kwh: 0,
    complete: true, attributed: true, estimated_kwh: 0,
    coverage_seconds: 3600, expected_seconds: 3600, reset_count: 0, channels: 1,
    ...over,
  });

  it('allows it only when complete AND attributed', () => {
    expect(mixIsProportional(mix({}))).toBe(true);
    expect(mixIsProportional(mix({ complete: false }))).toBe(false);
    expect(mixIsProportional(mix({ attributed: false }))).toBe(false);
    expect(mixIsProportional(null)).toBe(false);
  });

  it('explains an incomplete mix as a floor, not a total', () => {
    const caveat = mixCaveat(mix({ complete: false, coverage_seconds: 900, expected_seconds: 3600 }));
    expect(caveat).toContain('25%');
    expect(caveat).toContain('floor');
  });

  it('explains an unattributed mix as missing source information', () => {
    expect(mixCaveat(mix({ attributed: false }))).toContain('source information');
  });

  it('says nothing when the mix is fully trustworthy', () => {
    expect(mixCaveat(mix({}))).toBeNull();
  });

  // Attribution is checked BEFORE completeness on purpose: a mix that cannot
  // say where the energy came from has a bigger problem than partial coverage,
  // and reporting the smaller one first would bury it.
  it('reports the bigger problem first when both are wrong', () => {
    expect(mixCaveat(mix({ complete: false, attributed: false }))).toContain('source information');
  });
});
