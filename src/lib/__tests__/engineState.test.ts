// The honesty rules, as assertions.
//
// Everything tested here is a sentence the console shows a person about
// hardware they cannot see. Each case below corresponds to a way of being
// subtly wrong that is worse than saying nothing:
//
//   · a device that has never reported, drawn as one that is known down;
//   · an engine nobody configured, drawn as an empty list (or a failed fetch);
//   · an action whose outcome is unknown, reported as "failed" — after which
//     a person presses the button again and the gate opens twice.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import {
  availabilityLabel,
  availabilityState,
  controlsFor,
  describeExecuteError,
  engineNotice,
  executedMessage,
  kindLabel,
  readingValue,
  readingsErrorMessage,
  summaryLine,
} from '../../components/device/engineState';
import type { EngineDevice } from '../api';

function device(over: Partial<EngineDevice> = {}): EngineDevice {
  return {
    key: 'mock:a',
    driver: 'mock',
    kind: 'lighting',
    name: 'Lamp',
    zone: 'Interior',
    capabilities: ['light.switch'],
    availability: 'online',
    summary: 'on',
    last_seen: 1_700_000_000,
    ...over,
  };
}

describe('availability', () => {
  it('maps the engine vocabulary onto row states', () => {
    expect(availabilityState('online')).toBe('live');
    expect(availabilityState('degraded')).toBe('warn');
    expect(availabilityState('offline')).toBe('alert');
  });

  it('renders "" (never heard from) as unknown — NOT as offline or off', () => {
    // devices.AvailUnknown. A device that has never reported must not look
    // like one that is known down, and must not look like one deliberately
    // switched off either.
    expect(availabilityState('')).toBe('unknown');
    expect(availabilityState('')).not.toBe('alert');
    expect(availabilityState('')).not.toBe('off');
    expect(availabilityLabel('')).toContain('not heard from');
    expect(availabilityLabel('')).not.toContain('offline');
  });

  it('treats a value it does not recognise as unknown, never as live', () => {
    expect(availabilityState('something-new')).toBe('unknown');
    expect(availabilityLabel('something-new')).toContain('unknown');
  });

  it('falls back to availability for a device with no summary', () => {
    expect(summaryLine(device({ summary: '62% · warm' }))).toBe('62% · warm');
    expect(summaryLine(device({ summary: '', availability: '' }))).toBe('no reading yet');
    expect(summaryLine(device({ summary: '', availability: 'offline' }))).toBe('offline');
  });
});

describe('engineNotice', () => {
  it('says plainly that no engine is configured, and that this is not an error', () => {
    const notice = engineNotice({ status: 'absent', devices: [] });
    expect(notice).toBeTruthy();
    expect(notice).toContain('No device engine');
    expect(notice).toContain('not an error');
  });

  it('separates an unconfigured engine from a hub that cannot answer', () => {
    const absent = engineNotice({ status: 'absent', devices: [] });
    const unsupported = engineNotice({ status: 'unsupported', devices: [] });
    expect(unsupported).not.toBe(absent);
    expect(unsupported).toContain('device-engine API');
  });

  it('says a failed read is a failed read, not an empty fleet', () => {
    const notice = engineNotice({ status: 'error', devices: [], message: 'Network down.' });
    expect(notice).toContain('Network down.');
    expect(notice).toContain('not an empty fleet');
  });

  it('is silent when the engine is live and serving devices', () => {
    expect(engineNotice({ status: 'live', devices: [device()] })).toBeNull();
    // …but says so when it is live with nothing discovered, rather than
    // leaving a bare empty list on screen.
    expect(engineNotice({ status: 'live', devices: [] })).toContain('no devices yet');
  });
});

describe('controls', () => {
  it('offers only verbs the declared capabilities actually carry', () => {
    const dimmable = controlsFor(['light.dimmable']).map((c) => c.verb);
    expect(dimmable).toEqual(['on', 'off', 'set']);
    const setControl = controlsFor(['light.dimmable']).find((c) => c.verb === 'set');
    expect(setControl?.arg).toMatchObject({ name: 'level', min: 0, max: 100 });
  });

  it('gives a read-only device no buttons at all', () => {
    expect(controlsFor(['energy.meter'])).toEqual([]);
    expect(controlsFor(['sensor.read', 'camera.stream'])).toEqual([]);
  });

  it('de-duplicates a verb two capabilities both offer', () => {
    const verbs = controlsFor(['light.switch', 'light.dimmable']).map((c) => c.verb);
    expect(verbs).toEqual(['on', 'off', 'toggle', 'set']);
  });

  it('offers nothing for a capability it has never heard of', () => {
    expect(controlsFor(['something.new'])).toEqual([]);
  });
});

describe('execute outcomes', () => {
  it('treats confirm_required as a confirmation step, not an error', () => {
    const out = describeExecuteError(new ApiError(409, { error: 'confirm_required' }), 'Start');
    expect(out.kind).toBe('confirm');
    expect(out.message.toLowerCase()).toContain('confirm');
  });

  it('says "could not confirm" for an indeterminate result — never "failed"', () => {
    const out = describeExecuteError(new ApiError(502, { error: 'indeterminate' }), 'Open');
    expect(out.kind).toBe('indeterminate');
    expect(out.message).toContain('Could not confirm');
    expect(out.message.toLowerCase()).not.toContain('failed');
    // And it must not invite an immediate retry, which is the actual harm.
    expect(out.message).toContain('check the device');
  });

  it('says nothing was sent when the device was unreachable', () => {
    const out = describeExecuteError(new ApiError(502, { error: 'unreachable' }), 'Open');
    expect(out.kind).toBe('unreachable');
    expect(out.message).toContain('not sent');
  });

  it('reports a refusal as a refusal', () => {
    expect(describeExecuteError(new ApiError(403, { error: 'tier_refused' }), 'Start').kind).toBe(
      'refused',
    );
    expect(
      describeExecuteError(new ApiError(400, { error: 'invalid_request' }), 'Open').kind,
    ).toBe('refused');
  });

  it('falls back to a plain failure for anything unrecognised', () => {
    expect(describeExecuteError(new Error('socket closed'), 'Open').kind).toBe('failed');
  });

  it('names the tier the hub resolved on success', () => {
    expect(executedMessage('Start', 'hazardous-motion')).toContain('hazardous-motion');
    expect(executedMessage('On', '')).toContain('accepted');
  });
});

describe('rendering helpers', () => {
  it('prefers a reading’s text over its number', () => {
    expect(readingValue({ metric: 'state', text: 'docked', at: 1 })).toBe('docked');
    expect(readingValue({ metric: 'kw', value: 2.4056, at: 1 })).toBe('2.406');
    expect(readingValue({ metric: 'kw', at: 1 })).toBe('—');
  });

  it('does not dress "nothing to poll" up as a fault', () => {
    // httpdev answers `unsupported` for a device that declares no reads. That
    // is a device with nothing to report, not a broken one.
    const none = readingsErrorMessage(new ApiError(400, { error: 'unsupported' }));
    expect(none.fault).toBe(false);
    expect(none.message).toContain('no readings');

    expect(readingsErrorMessage(new ApiError(502, { error: 'unreachable' })).fault).toBe(true);
    expect(readingsErrorMessage(new Error('socket closed')).fault).toBe(true);
  });

  it('display-cases kinds so live and fixture rows share one filter', () => {
    expect(kindLabel('lighting')).toBe('Lighting');
    expect(kindLabel('robot')).toBe('Robot');
    expect(kindLabel('doohickey')).toBe('Doohickey');
  });
});
