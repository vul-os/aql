// The redemption exchange, app side.
//
// Two things are proven here:
//
//  1. CONFORMANCE — buildProof, driven with the same inputs as
//     proto/vectors/grants.json's `grant-redeem-valid`, reproduces that
//     vector's canonical bytes AND its signature exactly. Ed25519 is
//     deterministic, so an exact signature match means this app signs the
//     same bytes the corpus does, which is the thing the controller's step 9
//     verifies. (The signing key is the corpus's own public test seed, read
//     out of proto/vectors/lib.mjs — TEST KEY ONLY, never a real one.)
//
//  2. FAIL-CLOSED BEHAVIOUR — every refusal path returns without a single
//     request leaving the device, and every controller denial is decoded
//     into something a person at a gate can act on.
//
// What these tests CANNOT prove: that a real controller opens a real gate.
// There is no controller here — the transport is a stub. The exchange is
// verified against the conformance corpus, not against hardware.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenBody, buildProof, describeDenial, redeemOverLan } from '../redeem';
import { b64u, unB64u, utf8 } from '../jcs';
import type { Grant } from '../grant';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(here, '../../../../proto/vectors');

const corpus = JSON.parse(readFileSync(path.join(vectorsDir, 'grants.json'), 'utf-8')) as {
  vectors: Array<{
    name: string;
    check?: { now: number; device_id: string };
    grant?: { object: Grant };
    transcript?: {
      open?: { object: Record<string, unknown>; canonical: string };
      challenge?: { v: number; typ: string; cnonce: string; iat: number; exp: number };
      proof?: { object: { sig: string; ts: number }; canonical: string };
    };
  }>;
};

const V = corpus.vectors.find((v) => v.name === 'grant-redeem-valid')!;
const GRANT = V.grant!.object;
const CHALLENGE = V.transcript!.challenge!;
const PROOF = V.transcript!.proof!;
const DEVICE = V.check!.device_id;
const NOW = V.check!.now;

/**
 * The corpus's app signing key, read from proto/vectors/lib.mjs's published
 * SEEDS table (public, deterministic, documented as TEST KEYS ONLY). Read
 * rather than copied so this test cannot drift from the corpus, and so no
 * key material is duplicated into the app tree.
 */
function corpusAppSigner(): (msg: Uint8Array) => Promise<string> {
  const lib = readFileSync(path.join(vectorsDir, 'lib.mjs'), 'utf-8');
  const seedHex = /app:\s*'([0-9a-f]{64})'/.exec(lib)?.[1];
  if (!seedHex) throw new Error('could not read the corpus app seed from lib.mjs');
  const seed = Uint8Array.from(seedHex.match(/../g)!.map((h) => parseInt(h, 16)));
  // RFC 8410 PKCS#8 prefix for an Ed25519 private key — the same wrapping
  // proto/vectors/lib.mjs uses to hand a raw seed to node:crypto.
  const prefix = Uint8Array.from(
    '302e020100300506032b657004220420'.match(/../g)!.map((h) => parseInt(h, 16)),
  );
  const pkcs8 = new Uint8Array(prefix.length + seed.length);
  pkcs8.set(prefix);
  pkcs8.set(seed, prefix.length);
  const keyPromise = crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  return async (msg: Uint8Array) => {
    const key = await keyPromise;
    return b64u(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, buf(msg))));
  };
}

// TS 5.7 types Uint8Array as Uint8Array<ArrayBufferLike>, which no longer
// satisfies BufferSource (SharedArrayBuffer is in the union). Re-viewing over
// a plain ArrayBuffer is the narrowing fix; it copies nothing meaningful here.
const buf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

const sign = corpusAppSigner();

describe('conformance against proto/vectors/grants.json', () => {
  it('the corpus app key is the one the grant binds', async () => {
    // Sanity: signing with this key is what grant.app_pubkey names, so the
    // signature comparison below is meaningful.
    const pub = unB64u(GRANT.app_pubkey)!;
    const key = await crypto.subtle.importKey('raw', buf(pub), { name: 'Ed25519' }, false, ['verify']);
    const sig = unB64u(await sign(utf8(PROOF.canonical)))!;
    expect(
      await crypto.subtle.verify({ name: 'Ed25519' }, key, buf(sig), buf(utf8(PROOF.canonical))),
    ).toBe(true);
  });

  it('buildProof reproduces the vector canonical bytes and signature exactly', async () => {
    const { proof, canonical } = await buildProof(
      {
        grantId: GRANT.grant_id,
        cnonce: CHALLENGE.cnonce,
        accessPoint: 'main',
        ts: PROOF.object.ts,
      },
      sign,
    );
    expect(canonical).toBe(PROOF.canonical);
    expect(proof.sig).toBe(PROOF.object.sig);
  });

  it('buildOpenBody produces bytes that canonicalise to the vector open', async () => {
    const body = buildOpenBody(JSON.stringify(GRANT), 'main');
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const { canonicalMinusSig } = await import('../jcs');
    expect(canonicalMinusSig(parsed)).toBe(V.transcript!.open!.canonical);
  });

  it('passes an unknown grant member through untouched (never re-serialised from types)', () => {
    // A hub that adds a member to the signed grant must not have it dropped:
    // the signature covers it, so dropping it means `badsig` at the gate.
    const raw = JSON.stringify({ ...GRANT, future_field: 'covered by the hub signature' });
    const body = buildOpenBody(raw, 'main');
    expect(JSON.parse(body).grant.future_field).toBe('covered by the hub signature');
  });
});

// ── the exchange ───────────────────────────────────────────────────────────

type StubCall = { url: string; body: string };

function stubController(
  answers: Array<unknown>,
  calls: StubCall[] = [],
): { fetchImpl: typeof fetch; calls: StubCall[] } {
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    const answer = answers[i++];
    if (answer instanceof Error) throw answer;
    return {
      ok: true,
      status: 200,
      text: async () => (typeof answer === 'string' ? answer : JSON.stringify(answer)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseOpts = {
  baseUrl: 'http://lintel-de71ce00.local:8737',
  grantRaw: JSON.stringify(GRANT),
  grant: GRANT,
  accessPointId: 'main',
  appPubkey: GRANT.app_pubkey,
  deviceId: DEVICE,
  sign,
  now: () => NOW,
};

describe('redeemOverLan — the happy path', () => {
  it('sends grant.open then a signed grant.proof, and reports the open', async () => {
    const { fetchImpl, calls } = stubController([
      CHALLENGE,
      { v: 0, typ: 'grant.result', result: 'opened' },
    ]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toEqual({ kind: 'opened' });

    expect(calls[0].url).toBe('http://lintel-de71ce00.local:8737/grant/open');
    const open = JSON.parse(calls[0].body);
    expect(open.typ).toBe('grant.open');
    expect(open.access_point).toBe('main');
    expect(open.grant.sig).toBe(GRANT.sig);

    expect(calls[1].url).toBe('http://lintel-de71ce00.local:8737/grant/proof');
    const proof = JSON.parse(calls[1].body);
    expect(proof).toMatchObject({
      v: 0,
      typ: 'grant.proof',
      grant_id: GRANT.grant_id,
      cnonce: CHALLENGE.cnonce,
      access_point: 'main',
    });
    expect(typeof proof.sig).toBe('string');
  });

  it('anchors proof.ts on the controller\'s clock, not this device\'s', async () => {
    // A phone whose clock is a year out must still be able to open the gate:
    // step 11 is judged against the controller's `now`, and the freshness
    // guarantee is the single-use 30 s cnonce, not this timestamp.
    const { fetchImpl, calls } = stubController([
      CHALLENGE,
      { v: 0, typ: 'grant.result', result: 'opened' },
    ]);
    const out = await redeemOverLan({
      ...baseOpts,
      fetchImpl,
      now: () => NOW - 365 * 24 * 3600,
    });
    expect(out).toEqual({ kind: 'opened' });
    const proof = JSON.parse(calls[1].body);
    expect(Math.abs(proof.ts - CHALLENGE.iat)).toBeLessThanOrEqual(2);
  });

  it('trims a trailing slash off the controller address', async () => {
    const { fetchImpl, calls } = stubController([
      CHALLENGE,
      { v: 0, typ: 'grant.result', result: 'opened' },
    ]);
    await redeemOverLan({ ...baseOpts, baseUrl: 'http://10.0.0.5:8737/', fetchImpl });
    expect(calls[0].url).toBe('http://10.0.0.5:8737/grant/open');
  });
});

describe('redeemOverLan — refusals never touch the network', () => {
  const expectNoCall = async (opts: Partial<Parameters<typeof redeemOverLan>[0]>, code: string) => {
    const { fetchImpl, calls } = stubController([CHALLENGE]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl, ...opts });
    expect(out).toMatchObject({ kind: 'refused', code });
    expect(calls).toHaveLength(0);
    return out;
  };

  it('refuses an expired grant', async () => {
    await expectNoCall({ now: () => GRANT.exp + 1 }, 'expired');
  });

  it('refuses a grant that does not cover this gate', async () => {
    await expectNoCall({ accessPointId: 'service-hatch' }, 'wrong_access_point');
  });

  it('refuses a controller the grant does not list', async () => {
    await expectNoCall({ deviceId: 'de71ce00-0000-4000-8000-00000000dead' }, 'wrong_device');
  });

  it('refuses when this install\'s key is not the one the grant binds', async () => {
    await expectNoCall({ appPubkey: b64u(new Uint8Array(32)) }, 'key_mismatch');
  });

  it('refuses when there is no key at all', async () => {
    await expectNoCall({ appPubkey: null }, 'no_app_key');
  });

  it('refuses a window miss unless the resident explicitly accepted the risk', async () => {
    const monNoon = Math.floor(Date.UTC(2026, 6, 27, 12, 0, 0) / 1000);
    const evening: Grant = {
      ...GRANT,
      windows: [{ days: 'mon-sun', from: '18:00', to: '22:00' }],
      iat: monNoon - 3600,
      exp: monNoon + 3600,
    };
    await expectNoCall({ grant: evening, now: () => monNoon }, 'window');

    // …and goes ahead when it was accepted, because the controller judges
    // windows in its own timezone and may well allow it.
    const { fetchImpl, calls } = stubController([
      CHALLENGE,
      { v: 0, typ: 'grant.result', result: 'opened' },
    ]);
    const out = await redeemOverLan({
      ...baseOpts,
      grant: evening,
      grantRaw: JSON.stringify(evening),
      now: () => monNoon,
      acceptWarning: true,
      fetchImpl,
    });
    expect(out).toEqual({ kind: 'opened' });
    expect(calls).toHaveLength(2);
  });

  it('refuses a grant too large for the controller to accept', async () => {
    const fat: Grant = { ...GRANT, access_points: ['main', ...Array(600).fill('x'.repeat(16)) ] };
    await expectNoCall({ grant: fat, grantRaw: JSON.stringify(fat) }, 'frame_too_large');
  });

  it('refuses when the device cannot sign, after the challenge', async () => {
    const { fetchImpl, calls } = stubController([CHALLENGE]);
    const out = await redeemOverLan({
      ...baseOpts,
      fetchImpl,
      sign: async () => {
        throw new Error('key unavailable');
      },
    });
    expect(out).toMatchObject({ kind: 'refused', code: 'sign_failed' });
    expect(calls).toHaveLength(1); // the proof was never sent
  });
});

describe('redeemOverLan — what the controller says back', () => {
  it('decodes every denial in the cmd.ack vocabulary', async () => {
    const reasons = [
      'stale_clock',
      'lockdown',
      'badsig',
      'expired',
      'not_yet_valid',
      'wrong_device',
      'wrong_access_point',
      'window',
      'wrong_grant',
      'cnonce_unknown',
      'cnonce_expired',
      'cnonce_replay',
      'frame_too_large',
    ];
    for (const detail of reasons) {
      const { fetchImpl } = stubController([
        CHALLENGE,
        { v: 0, typ: 'grant.result', result: 'denied', detail },
      ]);
      const out = await redeemOverLan({ ...baseOpts, fetchImpl });
      expect(out).toMatchObject({ kind: 'denied', detail });
      if (out.kind === 'denied') {
        expect(out.message.length).toBeGreaterThan(10);
        expect(out.message).not.toContain('undefined');
      }
    }
  });

  it('shows an unknown reason verbatim rather than hiding it', () => {
    expect(describeDenial('some_future_reason')).toContain('some_future_reason');
  });

  it('names a clock disagreement when the controller says expired and the clocks differ', async () => {
    const { fetchImpl } = stubController([
      CHALLENGE,
      { v: 0, typ: 'grant.result', result: 'denied', detail: 'expired' },
    ]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl, now: () => CHALLENGE.iat - 4000 });
    expect(out.kind).toBe('denied');
    if (out.kind === 'denied') expect(out.message).toMatch(/clock is \d+s away/);
  });

  it('surfaces a denial returned in place of a challenge', async () => {
    const { fetchImpl } = stubController([
      { v: 0, typ: 'grant.result', result: 'denied', detail: 'frame_too_large' },
    ]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'denied', detail: 'frame_too_large' });
  });
});

describe('redeemOverLan — transport failures are reported, never mistaken for success', () => {
  it('reports an unreachable controller', async () => {
    const { fetchImpl } = stubController([new Error('connection refused')]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'transport' });
    if (out.kind === 'transport') expect(out.message).toContain('connection refused');
  });

  it('reports a non-JSON answer (a captive portal, a wrong port)', async () => {
    const { fetchImpl } = stubController(['<html>hotel wifi</html>']);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'transport' });
  });

  it('rejects a challenge that is not a grant.challenge', async () => {
    const { fetchImpl } = stubController([{ v: 0, typ: 'something.else', cnonce: 'x' }]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'transport' });
  });

  it('rejects a challenge with no cnonce', async () => {
    const { fetchImpl } = stubController([{ v: 0, typ: 'grant.challenge', iat: NOW, exp: NOW + 30 }]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'transport' });
  });

  it('reports a lost connection mid-exchange without claiming the gate opened', async () => {
    const { fetchImpl } = stubController([CHALLENGE, new Error('socket hang up')]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'transport' });
  });

  it('rejects a result that is not a grant.result', async () => {
    const { fetchImpl } = stubController([CHALLENGE, { ok: true }]);
    const out = await redeemOverLan({ ...baseOpts, fetchImpl });
    expect(out).toMatchObject({ kind: 'transport' });
  });

  it('times out rather than hanging at the gate', async () => {
    vi.useRealTimers();
    const fetchImpl = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const out = await redeemOverLan({ ...baseOpts, fetchImpl, timeoutMs: 20 });
    expect(out).toMatchObject({ kind: 'transport' });
  });
});
