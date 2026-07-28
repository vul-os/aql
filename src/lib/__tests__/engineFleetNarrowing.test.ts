// engineFleet's narrowing, which nothing was testing.
//
// engineState.test.ts asserts what each fleet STATE means. It does not touch
// the function that decides WHICH state a given answer becomes — so the
// mapping from an API response to a state was unguarded, and deleting a branch
// of it changed nothing that any test could see. That was found by tampering:
// removing the `not_engine_authority` branch entirely left the whole suite
// green.
//
// The distinctions below are the ones the console's honesty rests on. Every
// one of them is a different sentence shown to a person, and three of the four
// look identical on the wire if you only check for "did it throw".
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://hub.local:8787';
let behaviour: () => Promise<Response> = async () => json(200, { devices: [], engine: true });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

vi.mock('../hub', () => ({
  getApiBaseUrl: () => BASE,
  isTauri: () => false,
  gatewayFetch: async () => behaviour(),
}));

const { engineFleet } = await import('../../components/device/engineState');

beforeEach(() => {
  behaviour = async () => json(200, { devices: [], engine: true });
});

describe('engineFleet narrowing', () => {
  it('reports a live engine with its devices', async () => {
    behaviour = async () =>
      json(200, { engine: true, devices: [{ key: 'mock:lamp-1', kind: 'lighting' }] });
    const fleet = await engineFleet();
    expect(fleet.status).toBe('live');
    expect(fleet.devices).toHaveLength(1);
  });

  it('separates an unconfigured engine from an empty one', async () => {
    // `engine: false` is the DEFAULT for a hub with no device config. It must
    // not read as a live engine that happens to have found nothing, because
    // the two get different copy and only one of them is worth investigating.
    behaviour = async () => json(200, { engine: false, devices: [] });
    expect((await engineFleet()).status).toBe('absent');

    behaviour = async () => json(200, { engine: true, devices: [] });
    expect((await engineFleet()).status).toBe('live');
  });

  it('narrows a 403 not_engine_authority to forbidden, not to error', async () => {
    // The refusal a multi-account hub gives every member who is not the
    // instance admin. As `error` it would read as breakage and send someone
    // to check their network; as `forbidden` it names the reason and who to
    // ask. This is the branch the tamper proved was unguarded.
    behaviour = async () => json(403, { error: 'not_engine_authority' });
    const fleet = await engineFleet();
    expect(fleet.status).toBe('forbidden');
    expect(fleet.devices).toEqual([]);
  });

  it('still calls an ordinary refusal an error', async () => {
    // Only that one code is a refusal-with-a-reason. Anything else the hub
    // rejects is a genuine problem and must keep saying so.
    behaviour = async () => json(403, { error: 'something_else' });
    expect((await engineFleet()).status).toBe('error');
  });

  it('narrows a hub too old to serve /v1/engine to unsupported', async () => {
    // The SPA fallback: a 2xx that is not JSON, which is the embedded portal
    // answering a route the hub does not have.
    behaviour = async () => new Response('<!doctype html>', { status: 200 });
    expect((await engineFleet()).status).toBe('unsupported');
  });

  it('narrows a hub that is not answering at all to error, and keeps the reason', async () => {
    behaviour = async () => {
      throw new TypeError('Failed to fetch');
    };
    const fleet = await engineFleet();
    expect(fleet.status).toBe('error');
    if (fleet.status === 'error') {
      expect(fleet.message).toBeTruthy();
    }
  });

  it('treats an unreadable body as an error rather than an empty fleet', async () => {
    // A malformed answer is not "no devices". Rendering it as an empty list
    // would tell an operator their fleet had vanished.
    behaviour = async () => json(200, { engine: true, devices: 'not-an-array' });
    expect((await engineFleet()).status).toBe('error');
  });

  it('never throws — every outcome has to be renderable', async () => {
    behaviour = async () => {
      throw new Error('something nobody anticipated');
    };
    await expect(engineFleet()).resolves.toBeTruthy();
  });
});
