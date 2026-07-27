// Conformance layer 1, app side (proto/vectors/README.md): our JCS output
// over every signed object in the corpus must byte-compare equal to the
// `canonical` string the vectors carry — the same bar
// controller/internal/jcs is held to in Go.
//
// This is what makes src/lib/offline/jcs.ts trustworthy. It is a hand-written
// re-implementation of a canonicalisation rule; the only meaningful evidence
// that it agrees with the Go signer and verifier is byte equality against
// the corpus both of those are tested against. proto/vectors/ is read here
// and never written.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalMinusSig, jcs, b64u, unB64u } from '../jcs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(here, '../../../../proto/vectors');

type Signed = { object?: Record<string, unknown>; canonical?: string };
type Vector = {
  name: string;
  object?: Record<string, unknown>;
  canonical?: string;
  grant?: Signed;
  transcript?: { open?: Signed; proof?: Signed };
  steps?: Array<Signed & { proof?: Signed }>;
};

function load(file: string): { vectors: Vector[] } {
  return JSON.parse(readFileSync(path.join(vectorsDir, file), 'utf-8')) as { vectors: Vector[] };
}

describe('JCS canonicalisation matches the conformance corpus', () => {
  it('reproduces every `canonical` string in grants.json byte-for-byte', () => {
    const { vectors } = load('grants.json');
    let compared = 0;

    const check = (label: string, s: Signed | undefined) => {
      if (!s?.object || !s.canonical) return;
      expect(canonicalMinusSig(s.object), label).toBe(s.canonical);
      compared++;
    };

    for (const v of vectors) {
      check(`${v.name}/object`, { object: v.object, canonical: v.canonical });
      check(`${v.name}/grant`, v.grant);
      check(`${v.name}/open`, v.transcript?.open);
      check(`${v.name}/proof`, v.transcript?.proof);
      for (const st of v.steps ?? []) {
        check(`${v.name}/step`, st);
        check(`${v.name}/step-proof`, st.proof);
      }
    }
    // Sanity: the loop actually ran against real content.
    expect(vectors.length).toBe(14);
    expect(compared).toBeGreaterThanOrEqual(28);
  });

  it('reproduces the canonical strings in the other four vector files too', () => {
    let compared = 0;
    for (const file of ['pairing.json', 'commands.json', 'events.json', 'acks.json']) {
      for (const v of load(file).vectors) {
        if (v.object && v.canonical) {
          expect(canonicalMinusSig(v.object), `${file}/${v.name}`).toBe(v.canonical);
          compared++;
        }
        for (const st of v.steps ?? []) {
          if (st.object && st.canonical) {
            expect(canonicalMinusSig(st.object), `${file}/${v.name}/step`).toBe(st.canonical);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('JCS rules', () => {
  it('sorts object keys by UTF-16 code unit and drops whitespace', () => {
    expect(jcs({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
  });

  it('serialises nested structures depth-first', () => {
    expect(jcs({ w: [{ z: 1, a: 2 }] })).toBe('{"w":[{"a":2,"z":1}]}');
  });

  it('rejects non-finite numbers rather than emitting null', () => {
    expect(() => jcs({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => jcs({ x: Number.NaN })).toThrow(/non-finite/);
  });

  it('rejects undefined members instead of silently dropping them', () => {
    expect(() => jcs({ x: undefined })).toThrow(/unsupported type/);
  });

  it('removes only the top-level sig member', () => {
    expect(canonicalMinusSig({ a: { sig: 'inner' }, sig: 'outer' })).toBe('{"a":{"sig":"inner"}}');
  });
});

describe('base64url', () => {
  it('round-trips unpadded', () => {
    const bytes = new Uint8Array([251, 255, 190, 0, 1, 2]);
    const s = b64u(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(unB64u(s)!)).toEqual(Array.from(bytes));
  });

  it('decodes the corpus app_pubkey to 32 bytes', () => {
    const { vectors } = load('grants.json');
    const pub = vectors[0].grant?.object?.app_pubkey as string;
    expect(unB64u(pub)?.length).toBe(32);
  });

  it('refuses anything that is not base64url', () => {
    expect(unB64u('')).toBeNull();
    expect(unB64u('not base64!')).toBeNull();
    expect(unB64u('a+b/c=')).toBeNull(); // standard base64, not url-safe
  });
});
