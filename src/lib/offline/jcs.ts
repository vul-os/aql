// JCS (RFC 8785) canonicalization — the app-side half of the signing
// discipline every signature in proto/ uses: sign over `JCS(message minus
// sig)`, never over raw byte concatenation.
//
// This is a deliberate re-implementation of the same subset the other two
// implementations agree on: jcs/jcs.go (Go — the hub signs and the controller
// verifies with it) and proto/vectors/lib.mjs (the vector generator). It
// cannot be folded into the Go one, which is the point: it is a genuine
// language boundary, unlike the three Go copies that were folded because they
// were the same language and had already drifted apart.
//
// It is NOT trusted on the strength of resemblance.
// src/lib/offline/__tests__/jcs.test.ts byte-compares this function's output
// against every `canonical` string in proto/vectors/, and against the
// hand-derived edge cases in proto/jcs-cases.json — the same two corpora the
// Go side is held to. If this drifts, those tests fail. See
// proto/JCS-PROFILE.md, including the one number case where this
// implementation deliberately accepts what Go refuses.
//
// Subset notes (identical to proto/vectors/README.md's):
//  * Object keys sorted by UTF-16 code unit — what Array#sort() does for
//    strings, which is RFC 8785 §3.2.3 verbatim.
//  * No insignificant whitespace.
//  * Numbers via ECMAScript Number-to-string (JSON.stringify) — RFC 8785
//    §3.2.2.3. Non-finite numbers are rejected rather than emitted as null.
//  * Strings via JSON.stringify, whose escaping matches §3.2.2.2.
//  * `undefined` members and functions are rejected, not silently dropped:
//    silently dropping a member would change what gets signed.

export function jcs(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS: non-finite number');
    return JSON.stringify(value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // UTF-16 code unit order
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(obj[k])}`).join(',')}}`;
  }
  throw new Error(`JCS: unsupported type ${t}`);
}

/** Canonical bytes of a wire object with its top-level `sig` removed. */
export function canonicalMinusSig(obj: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== 'sig') rest[k] = v;
  }
  return jcs(rest);
}

/** UTF-8 bytes of a canonical string — what actually gets signed/verified. */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ── base64url (unpadded) — the wire form of every binary value ─────────────
//
// Mirrors wire.B64u / wire.UnB64u (controller/internal/wire/wire.go).

export function b64u(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode unpadded base64url. Returns null on anything that isn't valid. */
export function unB64u(s: string): Uint8Array | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
