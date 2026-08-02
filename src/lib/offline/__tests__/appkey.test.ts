import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeIndexedDB } from './fake-idb';
import { destroyAppKey, ensureAppKey, loadAppKey, signerFor } from '../vault';

// The app key is the root of trust for offline emergency access, and nothing
// tested it.
//
// vault.ts spends its header on one property: the private key is "a
// non-extractable WebCrypto CryptoKey — generated with `extractable: false`",
// so "`crypto.subtle.exportKey` on it throws. It can only be *used*". The
// unsupported path says the same thing in the other direction: a browser that
// refuses is told "Emergency access will not be set up rather than fall back to
// storing key material where scripts can read it."
//
// That property was enforced by one `false` argument, twice, with no assertion
// anywhere. Flipping either to `true` compiles, passes every test in this
// repository, and turns a key that cannot leave the device into one any script
// on the page can read and copy — after which that phone's offline grants can
// be forged indefinitely, offline, where no revocation reaches.
//
// Ed25519 in WebCrypto is real in Node 20+, so these drive the actual
// primitive rather than a mock of it.
//
// NOT covered here, checked by tampering it: checkSupport()'s probe, which
// generates a throwaway key purely to find out whether this browser does
// Ed25519 at all. Changing that probe to ECDSA passes every test below,
// because ensureAppKey generates its own key regardless. The consequence is a
// worse error on a browser that cannot do Ed25519 — a mysterious failure
// instead of the plain "this browser cannot" — which is a diagnostic
// regression rather than a security one. Covering it means stubbing
// crypto.subtle, and a stub is a poor witness for a test whose whole point is
// driving the real primitive.
const idb = installFakeIndexedDB();

beforeEach(async () => {
  idb.reset();
  await destroyAppKey().catch(() => {});
});

describe('the offline app key cannot leave the device', () => {
  it('is generated non-extractable', async () => {
    const res = await ensureAppKey();
    if (!res.ok) throw new Error(`ensureAppKey refused: ${JSON.stringify(res.support)}`);
    expect(res.key.privateKey.extractable).toBe(false);
  });

  it('refuses to be exported, which is the property that matters', async () => {
    // extractable:false is what the flag SAYS; this is what it DOES. Asserting
    // only the flag would pass against a key someone re-imported as
    // extractable somewhere else in the lifecycle.
    const res = await ensureAppKey();
    if (!res.ok) throw new Error('ensureAppKey refused');
    await expect(crypto.subtle.exportKey('pkcs8', res.key.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', res.key.privateKey)).rejects.toThrow();
  });

  it('survives a reload still non-extractable', async () => {
    // The key is stored as a live CryptoKey and read back. A round trip that
    // downgraded it — through a re-import, say — would be invisible to a test
    // that only checked the freshly generated one.
    const made = await ensureAppKey();
    if (!made.ok) throw new Error('ensureAppKey refused');
    const loaded = await loadAppKey();
    expect(loaded).not.toBeNull();
    expect(loaded!.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', loaded!.privateKey)).rejects.toThrow();
  });

  it('is still usable for signing, or non-extractable would be free', async () => {
    // The premise. A key that cannot sign is trivially unexportable, and a
    // test suite that only proved unexportability would pass on one.
    const res = await ensureAppKey();
    if (!res.ok) throw new Error('ensureAppKey refused');
    const sig = await signerFor(res.key)(new TextEncoder().encode('grant.proof'));
    expect(sig.length).toBeGreaterThan(0);
  });
});
