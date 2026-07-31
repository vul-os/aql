import { describe, expect, it } from 'vitest';
import {
  buildConditions,
  newConditionRow,
  toConditionRow,
  type ConditionRow,
  type WireCondition,
} from '@/lib/automationConditions';

/**
 * A rule must not change meaning by being opened and saved.
 *
 * A rule save is a FULL REPLACE — there is no partial PATCH on the wire, so the
 * editor loads every condition into a row and sends every row back. That makes
 * the row model a lossy channel by default: anything it cannot represent is
 * destroyed by a save that the operator experiences as a no-op.
 *
 * The hub grew state conditions (`{device_key, state}`) after this form was
 * written for numeric ones (`{device_key, metric, op, value}`). A row model
 * carrying only the numeric fields reads a state condition back as an empty
 * metric and writes it out as a numeric comparison — silently turning "while
 * the mower is docked" into "while the mower's <blank> is below 0", with
 * nothing on screen to show it happened. These tests exist to keep that shut.
 */

const roundTrip = (c: WireCondition): WireCondition[] => {
  const built = buildConditions([toConditionRow(c)]);
  if (!built.ok) throw new Error(`did not build: ${built.error}`);
  return built.conditions;
};

describe('condition round-trip', () => {
  it('preserves a state condition through load → save', () => {
    const wire: WireCondition = { device_key: 'test:mower-1', state: 'inactive' };
    expect(roundTrip(wire)).toEqual([wire]);
  });

  it('preserves an active state condition too', () => {
    const wire: WireCondition = { device_key: 'test:lamp-1', state: 'active' };
    expect(roundTrip(wire)).toEqual([wire]);
  });

  it('preserves a numeric condition through load → save', () => {
    const wire: WireCondition = { device_key: 'test:tank-1', metric: 'percent', op: 'at_least', value: 20 };
    expect(roundTrip(wire)).toEqual([wire]);
  });

  it('keeps a numeric condition whose value is zero', () => {
    // `value` is omitempty on the Go side, so 0 arrives as an ABSENT field.
    // Reading that back as "" and refusing to save would make a legitimate
    // rule unopenable.
    const built = buildConditions([toConditionRow({ device_key: 'd', metric: 'level', op: 'above', value: 0 })]);
    expect(built).toEqual({ ok: true, conditions: [{ device_key: 'd', metric: 'level', op: 'above', value: 0 }] });
  });

  it('never emits both shapes on one condition', () => {
    // The hub refuses a condition carrying a metric AND a state. If the editor
    // ever sent both, every state condition would fail to save.
    const rows = [toConditionRow({ device_key: 'd', state: 'active' })];
    const built = buildConditions(rows);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const c = built.conditions[0];
    expect(c.state).toBe('active');
    expect(c.metric).toBeUndefined();
    expect(c.op).toBeUndefined();
    expect(c.value).toBeUndefined();
  });

  it('preserves a mixed list in order', () => {
    const wire: WireCondition[] = [
      { device_key: 'a', state: 'active' },
      { device_key: 'b', metric: 'percent', op: 'below', value: 30 },
      { device_key: 'c', state: 'inactive' },
    ];
    const built = buildConditions(wire.map(toConditionRow));
    expect(built).toEqual({ ok: true, conditions: wire });
  });
});

describe('classification', () => {
  it('routes on the state field, not on an empty metric', () => {
    // A half-typed numeric row has no metric either. Classifying on "metric is
    // empty" would turn it into a state condition the author never asked for.
    expect(toConditionRow({ device_key: 'd', metric: '', op: 'below', value: 5 }).kind).toBe('numeric');
    expect(toConditionRow({ device_key: 'd', state: 'active' }).kind).toBe('state');
  });

  it('never puts the text "undefined" in the value box', () => {
    const row = toConditionRow({ device_key: 'd', state: 'active' });
    expect(row.value).toBe('');
    expect(row.metric).toBe('');
  });

  it('starts a new row as a numeric one', () => {
    expect(newConditionRow().kind).toBe('numeric');
  });
});

describe('refusals', () => {
  const row = (over: Partial<ConditionRow>): ConditionRow => ({ ...newConditionRow(), ...over });

  it('refuses a condition with no device, in either shape', () => {
    expect(buildConditions([row({ kind: 'state', state: 'active' })]).ok).toBe(false);
    expect(buildConditions([row({ kind: 'numeric', metric: 'percent', value: '5' })]).ok).toBe(false);
  });

  it('refuses a reading condition with no metric, and says how to fix it', () => {
    const built = buildConditions([row({ deviceKey: 'd', kind: 'numeric', value: '5' })]);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/is on \/ is off/);
  });

  it('refuses a reading condition whose value is not a number', () => {
    expect(buildConditions([row({ deviceKey: 'd', kind: 'numeric', metric: 'percent', value: 'abc' })]).ok).toBe(false);
  });

  it('does NOT require a metric or value for a state condition', () => {
    // The whole point: a state row is complete with only a device.
    expect(buildConditions([row({ deviceKey: 'd', kind: 'state', state: 'inactive' })])).toEqual({
      ok: true,
      conditions: [{ device_key: 'd', state: 'inactive' }],
    });
  });

  it('enforces the eight-condition cap', () => {
    const rows = Array.from({ length: 9 }, () => row({ deviceKey: 'd', kind: 'state', state: 'active' }));
    expect(buildConditions(rows).ok).toBe(false);
    expect(buildConditions(rows.slice(0, 8)).ok).toBe(true);
  });

  it('trims whitespace out of the device key and metric', () => {
    expect(buildConditions([row({ deviceKey: '  d  ', kind: 'state', state: 'active' })])).toEqual({
      ok: true,
      conditions: [{ device_key: 'd', state: 'active' }],
    });
    expect(buildConditions([row({ deviceKey: ' d ', kind: 'numeric', metric: ' percent ', value: '5' })])).toEqual({
      ok: true,
      conditions: [{ device_key: 'd', metric: 'percent', op: 'below', value: 5 }],
    });
  });
});
