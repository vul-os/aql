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
//
// The TypeScript copy is NOT foldable into the Go one — the three Go copies
// were folded into jcs/ because they were the same language, and this one
// cannot be. It is held instead by data: this file, plus the shared
// canonicalisation cases below. See proto/JCS-PROFILE.md.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalMinusSig, jcs, b64u, unB64u } from '../jcs';

const here = path.dirname(fileURLToPath(import.meta.url));
const protoDir = path.resolve(here, '../../../../proto');
const vectorsDir = path.join(protoDir, 'vectors');

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
    //
    // Exact, not a floor. `check` returns early for any vector missing an
    // object or a canonical string, so a corpus edit that drops either one
    // quietly removes a comparison — and the floor here was 28 against 55 real
    // comparisons, meaning half the corpus could stop being checked without
    // this failing. Exact counts make an added vector fail until the number is
    // raised, which is the point: bumping it is the moment someone confirms the
    // new vector is actually being compared.
    expect(vectors.length).toBe(18);
    expect(compared, 'a canonical comparison stopped happening').toBe(55);
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
    // Exact for the same reason as above: 50 real comparisons behind a floor of
    // 20 left 30 of them optional.
    expect(compared, 'a canonical comparison stopped happening').toBe(50);
  });
});

// Conformance layer 0 (proto/jcs-cases.json). The corpus above is the set of
// documents this product actually sends — envelopes of integers and short
// strings — so agreeing on it says nothing about the edges where two
// hand-written canonicalisers most plausibly disagree. These cases are those
// edges, derived from RFC 8785 by hand, and the SAME file is read by the Go
// implementation (jcs/cases_test.go) and the vector generator's
// (proto/vectors/verify.mjs). That is what makes "the app agrees with the
// gateway" a checked statement rather than a resemblance.
type JcsCases = {
  cases: Array<{ name: string; input: string; canonical: string }>;
  refused: Array<{ name: string; input: string; js_canonical?: string }>;
};

describe('JCS matches the shared canonicalisation cases', () => {
  const doc = JSON.parse(
    readFileSync(path.join(protoDir, 'jcs-cases.json'), 'utf-8'),
  ) as JcsCases;

  // The count guard comes first and is not a formality: a corpus-driven test
  // whose corpus failed to load reports PASS by checking nothing.
  it('loaded the shared corpus', () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(14);
    expect(doc.refused.length).toBeGreaterThanOrEqual(2);
  });

  it('reproduces every hand-derived canonical form', () => {
    let ran = 0;
    for (const c of doc.cases) {
      // The inputs are raw JSON TEXT; this implementation canonicalises
      // VALUES, so the parse is part of what is under test.
      expect(jcs(JSON.parse(c.input)), c.name).toBe(c.canonical);
      ran++;
    }
    expect(ran).toBe(doc.cases.length);
  });

  // The `refused` entries are the Go profile's documented deviation (no
  // general double formatting), NOT an RFC rule. TypeScript gets correct
  // ECMAScript number formatting from JSON.stringify and accepts them. That
  // divergence is pinned, so moving it fails a test instead of surfacing as a
  // signature that will not verify at a gate.
  it('pins exactly where it diverges from the Go profile', () => {
    let ran = 0;
    for (const c of doc.refused) {
      expect(c.js_canonical, `${c.name}: js_canonical must be pinned`).toBeTypeOf('string');
      expect(jcs(JSON.parse(c.input)), c.name).toBe(c.js_canonical);
      ran++;
    }
    expect(ran).toBe(doc.refused.length);
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
