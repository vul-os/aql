import { describe, expect, it } from 'vitest';
import { shapeFor } from '../../pages/app/energyChart';

// "An hour nobody measured reads as null, never zero, and the chart draws it
// as a gap — an outage and a house using nothing are different facts."
// (README.md, the energy row.)
//
// The hub half of that promise is guarded by TestEmptyPeriodIsNotZero and
// TestPartialHourIsAFloorNotATotal. The console half was inline JSX with no
// test at all, which is where the promise would actually break: `b.kwh ?? 0`
// is a one-character fix for a type error and turns every outage into a
// confident zero.
describe('the energy chart never draws an unmeasured hour as a number', () => {
  it('a null reading is a gap, whatever the axis', () => {
    expect(shapeFor(null, 10, 100)).toEqual({ kind: 'gap' });
    expect(shapeFor(null, 0, 100)).toEqual({ kind: 'gap' });
    // Not merely "not a bar of height 0" — not a bar at all. A zero-height
    // bar and a gap look different on screen but read the same to a reviewer
    // scanning the code, so the type makes them different things.
    expect(shapeFor(null, 10, 100).kind).not.toBe('bar');
  });

  it('a measured ZERO is a bar, because it is a measurement', () => {
    // The distinction the whole rule exists for. A house that genuinely used
    // nothing is a fact; collapsing it into the same mark as "not measured"
    // is the confusion being prevented, in the other direction.
    const s = shapeFor(0, 10, 100);
    expect(s.kind).toBe('bar');
    expect(s).toEqual({ kind: 'bar', height: 1, kwh: 0 });
  });

  it('scales a real reading, with a floor so a tiny one stays visible', () => {
    expect(shapeFor(10, 10, 100)).toEqual({ kind: 'bar', height: 100, kwh: 10 });
    expect(shapeFor(5, 10, 100)).toEqual({ kind: 'bar', height: 50, kwh: 5 });
    // 0.0001 kWh is 0.001 viewBox units — invisible without the floor, and an
    // invisible bar is indistinguishable from the gap that means something
    // else entirely.
    expect(shapeFor(0.0001, 10, 100)).toEqual({ kind: 'bar', height: 1, kwh: 0.0001 });
  });

  it('survives an axis of zero rather than rendering NaN', () => {
    // A NaN height renders as nothing, silently — so a broken axis would look
    // exactly like an outage, which is the one confusion this chart must not
    // create. Guard the axis, not the reading.
    expect(shapeFor(4, 0, 100)).toEqual({ kind: 'bar', height: 1, kwh: 4 });
    expect(shapeFor(4, -1, 100)).toEqual({ kind: 'bar', height: 1, kwh: 4 });
    expect(Number.isNaN((shapeFor(4, 0, 100) as { height: number }).height)).toBe(false);
  });
});
