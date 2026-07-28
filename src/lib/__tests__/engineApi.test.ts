// The device-engine client, tested at the wire.
//
// These four routes are the first thing in this console that can actuate a
// device that isn't a gate, so the things asserted here are the things that
// would be dangerous to get wrong silently:
//
//   · the exact path and method (the route-parity test guards drift against
//     the gateway's registered patterns; this guards what is actually sent,
//     including that a device key with its `driver:id` colon survives),
//   · that `confirm` is never sent true unless the caller asked for it,
//   · that a 409 confirm_required and a 502 indeterminate are recognisable as
//     the distinct, non-failure things they are,
//   · and that `engine: false` narrows to "not configured" rather than to an
//     empty fleet or an error.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://hub.local:8787';

type Recorded = { url: string; method: string; body: unknown; headers: Headers };
const calls: Recorded[] = [];
let next: Response[] = [];

vi.mock('../hub', () => ({
  getApiBaseUrl: () => BASE,
  isTauri: () => false,
  gatewayFetch: async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers as HeadersInit | undefined),
    });
    return next.shift() ?? new Response('no stub queued', { status: 500 });
  },
}));

// api.ts reads bearer tokens from localStorage on every request; the node test
// environment has none.
if (!('localStorage' in globalThis)) {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } as Storage;
}

const { api, ApiError, isConfirmRequired, isIndeterminate, isUnreachable } = await import('../api');
const { engineFleet } = await import('../../components/device/engineState');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** What an unrouted path answers on a hub that predates /v1/engine: the
 *  embedded portal's SPA fallback — 200, but HTML. */
function spaFallback(): Response {
  return new Response('<!doctype html><title>Aql</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

beforeEach(() => {
  calls.length = 0;
  next = [];
});

describe('device-engine client', () => {
  it('GETs /v1/engine/devices and returns the fleet verbatim', async () => {
    next = [
      json(200, {
        engine: true,
        devices: [
          {
            key: 'mqtt:lamp-1',
            driver: 'mqtt',
            kind: 'lighting',
            name: 'Garden Lights',
            zone: 'Exterior',
            capabilities: ['light.dimmable'],
            availability: '',
            summary: '',
            last_seen: 1_700_000_000,
          },
        ],
      }),
    ];

    const res = await api.engineDevices();

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${BASE}/v1/engine/devices`);
    expect(res.engine).toBe(true);
    // Availability is passed through untouched — "" must reach the UI as "",
    // not be normalised to "offline" on the way.
    expect(res.devices[0].availability).toBe('');
  });

  it('URL-encodes the driver:id key when reading', async () => {
    next = [json(200, { readings: [{ metric: 'kw', value: 2.4, at: 1 }] })];

    const res = await api.engineReadings('mqtt:lamp-1');

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${BASE}/v1/engine/devices/mqtt%3Alamp-1/readings`);
    expect(res.readings).toHaveLength(1);
  });

  it('POSTs execute with confirm:false unless the caller asked otherwise', async () => {
    next = [json(200, { ok: true, tier: 'reversible' })];

    await api.engineExecute('mqtt:lamp-1', { verb: 'on' });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${BASE}/v1/engine/devices/mqtt%3Alamp-1/execute`);
    // No speculative confirm: the hub's 409 is what drives the confirmation
    // step, and a client that pre-confirms defeats the whole mechanism.
    expect(calls[0].body).toEqual({ verb: 'on', args: {}, confirm: false });
  });

  it('sends the verb argument and an explicit confirm when asked', async () => {
    next = [json(200, { ok: true, tier: 'hazardous-motion' })];

    await api.engineExecute('mock:mower', { verb: 'start', args: { level: 60 }, confirm: true });

    expect(calls[0].body).toEqual({ verb: 'start', args: { level: 60 }, confirm: true });
  });

  it('GETs /v1/engine/health', async () => {
    next = [json(200, { engine: true, drivers: { mqtt: { ok: true, detail: '', since: 1 } } })];

    const res = await api.engineHealth();

    expect(calls[0].url).toBe(`${BASE}/v1/engine/health`);
    expect(res.drivers.mqtt.ok).toBe(true);
  });

  it('surfaces 409 confirm_required as a confirmable refusal, not a generic error', async () => {
    next = [json(409, { error: 'confirm_required' })];

    const err = await api.engineExecute('mock:mower', { verb: 'start' }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(409);
    expect(isConfirmRequired(err)).toBe(true);
    expect(isIndeterminate(err)).toBe(false);
  });

  it('distinguishes indeterminate from unreachable', async () => {
    next = [json(502, { error: 'indeterminate' }), json(502, { error: 'unreachable' })];

    const a = await api.engineExecute('mock:gate', { verb: 'open' }).catch((e) => e);
    const b = await api.engineExecute('mock:gate', { verb: 'open' }).catch((e) => e);

    expect(isIndeterminate(a)).toBe(true);
    expect(isUnreachable(a)).toBe(false);
    expect(isUnreachable(b)).toBe(true);
    expect(isIndeterminate(b)).toBe(false);
  });
});

describe('engineFleet narrowing', () => {
  it('reports engine:false as "not configured" — not as an empty fleet', async () => {
    next = [json(200, { engine: false, devices: [] })];

    const fleet = await engineFleet();

    expect(fleet.status).toBe('absent');
    expect(fleet.devices).toEqual([]);
  });

  it('reports a populated engine as live', async () => {
    next = [
      json(200, {
        engine: true,
        devices: [{ key: 'mock:a', driver: 'mock', kind: 'sensor', name: 'Tank', zone: '', capabilities: ['sensor.read'], availability: 'online', summary: '12%', last_seen: 1 }],
      }),
    ];

    const fleet = await engineFleet();

    expect(fleet.status).toBe('live');
    expect(fleet.devices).toHaveLength(1);
  });

  it('reports a hub that predates the route as unsupported, never as absent', async () => {
    next = [spaFallback()];

    const fleet = await engineFleet();

    // The distinction matters: "no engine configured" is the operator's own
    // choice; "this hub can't answer" is a hub that needs upgrading.
    expect(fleet.status).toBe('unsupported');
  });

  it('reports a failed request as an error, never as an empty fleet', async () => {
    next = [json(500, { error: 'boom' })];

    const fleet = await engineFleet();

    expect(fleet.status).toBe('error');
    expect(fleet.devices).toEqual([]);
  });

  it('never throws — an absent engine is a state to render, not an exception', async () => {
    next = [new Response('kaboom', { status: 503 })];
    await expect(engineFleet()).resolves.toBeTruthy();
  });
});
