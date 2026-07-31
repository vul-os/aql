import { describe, expect, it } from 'vitest';
import { actionLine } from '@/pages/app/Automations';

// How a rule's action reads in the list.
//
// This is where the alert action's first defect lived. The client type declared
// `verb: string` as required, so the renderer read it first — and an alert
// carries no verb, because it drives nothing. Every alert rule the hub returned
// rendered as "undefined unnamed target".
//
// The type is now honest (`verb?`), which makes the compiler catch the same
// mistake next time; this holds the ORDER, which the compiler cannot: notify has
// to be checked before the verb, not after.
describe('automation action line', () => {
  it('reads an alert as an alert, never as a verb', () => {
    const got = actionLine({ notify: { message: 'the water tank is below 20%' } });
    expect(got).toContain('alert');
    expect(got).toContain('the water tank is below 20%');
    // The failure this replaces.
    expect(got).not.toContain('undefined');
    expect(got).not.toContain('unnamed target');
  });

  it('still reads a device action', () => {
    expect(actionLine({ device_key: 'mock:lamp-1', verb: 'on' })).toBe('on mock:lamp-1');
  });

  it('still reads a zone action', () => {
    expect(actionLine({ zone: 'Exterior', verb: 'off' })).toBe('off Exterior');
  });

  // A malformed rule — no verb and no notify — must read as missing rather than
  // as the word "undefined", which tells a reader nothing about what is wrong.
  it('names a missing verb instead of printing undefined', () => {
    const got = actionLine({ device_key: 'mock:lamp-1' });
    expect(got).not.toContain('undefined');
    expect(got).toContain('no verb');
  });
});
