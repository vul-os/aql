// The offline service, from the point of view of the person the multi-hub
// design is for: someone with a hub at home who also has access to a friend's
// office, each hub issuing its own grant signed by its own key.
//
// The headline case is the one that used to fail: switch the admin console
// between the two hubs and BOTH grants must survive. Before the fix, the load
// that follows a switch deleted the hub you just left — discovered at a gate,
// during an outage.
import type { GrantRecord } from '../vault';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeIndexedDB } from './fake-idb';
import type { Grant } from '../grant';

const idb = installFakeIndexedDB();

// The console's current hub. `applyGatewayUrl` reloads the app on a switch;
// here we just move the pointer and load again, which is the same thing.
let currentBaseUrl = 'http://aql-home.local:8787';
const hubKeyResponses = new Map<string, unknown>();

vi.mock('../../hub', () => ({
  getApiBaseUrl: () => currentBaseUrl,
  isTauri: () => false,
  gatewayFetch: async (input: string) => {
    const url = String(input);
    for (const [base, body] of hubKeyResponses) {
      if (url === `${base}/v1/gateway/key`) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  },
}));

const {
  forgetGrant,
  loadState,
  presentAtGate,
  requestGrant,
  allGateStatuses,
  freshness,
  probeController,
} = await import('../service');
const { recordId, saveGrantRecord } = await import('../vault');

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(here, '../../../../proto/vectors');
const corpus = JSON.parse(readFileSync(path.join(vectorsDir, 'grants.json'), 'utf-8')) as {
  vectors: Array<{ name: string; grant?: { object: Grant } }>;
};
const VALID: Grant = corpus.vectors.find((v) => v.name === 'grant-redeem-valid')!.grant!.object;

const HOME_HUB = 'A'.repeat(43);
const OFFICE_HUB = 'B'.repeat(43);
const HOME_URL = 'http://aql-home.local:8787';
const OFFICE_URL = 'https://office.example';

const now = () => Math.floor(Date.now() / 1000);

function grantJson(patch: Partial<Grant>): string {
  const t = now();
  return JSON.stringify({ ...VALID, iat: t - 60, exp: t + 86_400, ...patch });
}

function rec(hubPubkey: string, memberId: string, gatewayUrl: string, over: Partial<GrantRecord> = {}): GrantRecord {
  return {
    id: recordId(hubPubkey, memberId),
    hubPubkey,
    gatewayUrl,
    memberId,
    grantRaw: grantJson({ grant_id: `g-${memberId}` }),
    appPubkey: VALID.app_pubkey,
    accessPoints: [{ id: `ap-${memberId}`, name: 'Gate', kind: 'gate', deviceId: 'dev-1' }],
    addresses: {},
    fetchedAt: now(),
    ...over,
  };
}

beforeEach(() => {
  idb.reset();
  hubKeyResponses.clear();
  currentBaseUrl = HOME_URL;
});

describe('switching the console between two hubs', () => {
  it('keeps home AND office emergency access across the switch', async () => {
    await saveGrantRecord(rec(HOME_HUB, 'member-home', HOME_URL));
    await saveGrantRecord(rec(OFFICE_HUB, 'member-office', OFFICE_URL));

    // Signed in at home.
    currentBaseUrl = HOME_URL;
    const atHome = await loadState('member-home');
    expect(atHome.held).toHaveLength(2);
    expect(atHome.current?.record.hubPubkey).toBe(HOME_HUB);
    expect(atHome.problems).toEqual([]);

    // "Connect to a different hub" → the office.
    currentBaseUrl = OFFICE_URL;
    const atOffice = await loadState('member-office');
    expect(atOffice.held).toHaveLength(2);
    expect(atOffice.current?.record.hubPubkey).toBe(OFFICE_HUB);

    // And back home — the home grant is still there, which is the whole point.
    currentBaseUrl = HOME_URL;
    const backHome = await loadState('member-home');
    expect(backHome.held).toHaveLength(2);
    expect(backHome.current?.record.memberId).toBe('member-home');
    expect(backHome.held.map((h) => h.record.hubPubkey).sort()).toEqual(
      [HOME_HUB, OFFICE_HUB].sort(),
    );
  });

  it('a hub the console is not pointed at is still held, just not current', async () => {
    await saveGrantRecord(rec(OFFICE_HUB, 'member-office', OFFICE_URL));
    currentBaseUrl = HOME_URL;

    const state = await loadState('member-home');

    expect(state.current).toBeNull();
    expect(state.held).toHaveLength(1);
    expect(state.held[0].record.hubPubkey).toBe(OFFICE_HUB);
  });

  it('forgetting one hub leaves the other', async () => {
    await saveGrantRecord(rec(HOME_HUB, 'member-home', HOME_URL));
    await saveGrantRecord(rec(OFFICE_HUB, 'member-office', OFFICE_URL));

    await forgetGrant(OFFICE_HUB);

    const state = await loadState('member-home');
    expect(state.held.map((h) => h.record.hubPubkey)).toEqual([HOME_HUB]);
  });

  it('gate statuses carry the hub they came out of, never a bare access-point id', async () => {
    await saveGrantRecord(
      rec(HOME_HUB, 'member-home', HOME_URL, {
        grantRaw: grantJson({ grant_id: 'g-home', access_points: ['ap-member-home'] }),
      }),
    );
    await saveGrantRecord(
      rec(OFFICE_HUB, 'member-office', OFFICE_URL, {
        grantRaw: grantJson({ grant_id: 'g-office', access_points: ['ap-member-office'] }),
      }),
    );

    const state = await loadState('member-home');
    const gates = allGateStatuses(state.held, VALID.app_pubkey, now());

    expect(gates).toHaveLength(2);
    expect(new Set(gates.map((g) => g.hubPubkey))).toEqual(new Set([HOME_HUB, OFFICE_HUB]));
  });
});

describe('hub identity is the pinned key', () => {
  it('refuses to enrol when the address answers with a different key than pinned', async () => {
    await saveGrantRecord(rec(HOME_HUB, 'member-home', HOME_URL));
    // The address now answers as some other hub.
    hubKeyResponses.set(HOME_URL, { alg: 'ed25519', public_key: OFFICE_HUB });
    currentBaseUrl = HOME_URL;

    const out = await requestGrant('member-home', [
      { id: 'ap-1', name: 'Gate', kind: 'gate', device_id: 'dev-1' } as never,
    ]);

    expect(out.ok).toBe(false);
    expect((out as { code?: string }).code).toBe('hub_key_changed');
    expect((out as { message: string }).message).toMatch(/not the one you enrolled with/);
    // Nothing was healed, re-enrolled or deleted.
    const state = await loadState('member-home');
    expect(state.held).toHaveLength(1);
    expect(state.held[0].record.hubPubkey).toBe(HOME_HUB);
  });

  it('refuses to enrol against an address that will not say which hub it is', async () => {
    currentBaseUrl = 'https://silent.example';
    const out = await requestGrant('member-home', [
      { id: 'ap-1', name: 'Gate', kind: 'gate', device_id: 'dev-1' } as never,
    ]);
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toMatch(/HTTP 404/);
  });
});

describe('structural isolation when presenting', () => {
  it('refuses a grant presented with another hub\'s record, without sending anything', async () => {
    const home = rec(HOME_HUB, 'member-home', HOME_URL);
    const officeGrant = JSON.parse(grantJson({ grant_id: 'g-office' })) as Grant;
    let sent = 0;

    const outcome = await presentAtGate({
      record: home,
      grant: officeGrant, // belongs to a different record
      key: { publicKeyB64u: VALID.app_pubkey, privateKey: {} as CryptoKey, createdAt: 0 },
      accessPointId: 'ap-member-home',
      address: 'lintel-de71ce00.local:8737',
      fetchImpl: (async () => {
        sent += 1;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(outcome.kind).toBe('refused');
    expect((outcome as { code: string }).code).toBe('record_mismatch');
    expect(sent).toBe(0);
  });
});

describe('freshness is never dressed up as validity', () => {
  it('says both things when the hub has not been reachable since half-life', async () => {
    const t = now();
    const stale = rec(HOME_HUB, 'member-home', HOME_URL, {
      grantRaw: grantJson({ iat: t - 86_400, exp: t + 60 }),
      fetchedAt: t - 86_400,
    });
    await saveGrantRecord(stale);
    const state = await loadState('member-home');

    const f = freshness(state.held[0], t);

    expect(f.unconfirmed).toBe(true);
    expect(f.message).toMatch(/Not confirmed/);
    expect(f.message).toMatch(/unless the hub has withdrawn it/);
    expect(f.message).not.toMatch(/\bValid\b/);
  });
});

// ── probeController ────────────────────────────────────────────────────────
//
// The liveness check the emergency path leans on. Its whole value is being
// cheap and side-effect-free, so what is worth testing is not "does it return
// true" but WHAT IT SENDS: a GET, to a route the controller does not serve,
// never a POST that would mint a challenge or open a gate.

describe('probeController', () => {
  function recordingFetch(res: Partial<Response> | Error) {
    const calls: Array<{ url: string; method: string }> = [];
    const impl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if (res instanceof Error) throw res;
      return res as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('asks with a GET and never a method that changes controller state', async () => {
    const { impl, calls } = recordingFetch({ status: 405 } as Response);
    await probeController('10.0.0.9', { fetchImpl: impl });

    expect(calls).toHaveLength(1);
    // A POST here would mint a single-use challenge on every check, or —
    // against /grant/proof — open the gate. Neither belongs in a question
    // about whether anyone is listening.
    expect(calls[0].method).toBe('GET');
    // Normalised the same way a real redemption normalises it, default port
    // and all. Probing a different address than the one we would redeem
    // against would answer a question nobody asked.
    expect(calls[0].url).toBe('http://10.0.0.9:8737/grant/open');
  });

  it('reads a 405 as present, because that is what an unrouted GET returns', async () => {
    const { impl } = recordingFetch({ status: 405 } as Response);
    expect(await probeController('10.0.0.9', { fetchImpl: impl })).toBe(true);
  });

  it('reads a server error as absent', async () => {
    const { impl } = recordingFetch({ status: 502 } as Response);
    expect(await probeController('10.0.0.9', { fetchImpl: impl })).toBe(false);
  });

  it('reports absent rather than throwing when nothing answers', async () => {
    const { impl } = recordingFetch(new TypeError('Failed to fetch'));
    // This runs while someone is at a gate; a rejected promise here would
    // take out whatever screen asked.
    await expect(probeController('10.0.0.9', { fetchImpl: impl })).resolves.toBe(false);
  });

  it('refuses an unusable address without sending anything', async () => {
    const { impl, calls } = recordingFetch({ status: 200 } as Response);
    expect(await probeController('https://gate.example', { fetchImpl: impl })).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
