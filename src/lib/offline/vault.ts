// Where a bearer capability that opens a physical gate is kept, and what an
// attacker gets.
//
// ── THE DECISION ───────────────────────────────────────────────────────────
//
// Two things must survive an app restart with no network:
//
//   1. the app's Ed25519 private key — the thing that actually authorises,
//      because the grant names its public half and the controller's step 9
//      verifies the proof against it;
//   2. the signed grant — a public document. It carries no secret: member
//      id, device ids, access-point ids, validity window, hub signature.
//
// Both live in **IndexedDB** (`lintel.offline-access`), and the private key
// specifically is a **non-extractable WebCrypto CryptoKey**: generated with
// `extractable: false`, handed to IndexedDB as a live CryptoKey object (the
// structured-clone path browsers provide exactly for this), and never
// serialised. No code in this app — ours or injected — can read its bytes;
// `crypto.subtle.exportKey` on it throws. It can only be *used*, via
// `crypto.subtle.sign`, by code running in this origin.
//
// Why not the alternatives:
//   * localStorage — cannot hold a CryptoKey at all, so it would mean
//     storing raw key bytes as a string readable by any script on the
//     origin. That is the weakest option available and there is no reason to
//     take it. (The existing `lintel.*` localStorage keys are untouched by
//     this feature: the compat surface stays frozen.)
//   * The platform keystore (Keychain / Keystore / TPM), which
//     proto/grants.md names as the intended home — unreachable from the
//     webview. It needs a Tauri command on the Rust side, which is outside
//     this change's file scope. Called out in the report as the upgrade this
//     wants next; the seam is `AppKeyBackend` below, deliberately one
//     interface wide.
//
// ── THREAT MODEL, PLAINLY ──────────────────────────────────────────────────
//
// An attacker who has the device UNLOCKED and can run the app: opens every
// gate the stored grant lists, until it expires. This is not a storage bug;
// it is what a bearer capability on a phone means, and it is the same
// exposure as taking someone's keyring. The contract's own answer is the
// only one there is: short TTL (7 days, fixed), and `lockdown` latched on
// the controller as the sole sub-TTL lever. The app's contribution is to
// keep the window as small as it can — refresh early (needsRefresh), delete
// on sign-out, delete on expiry.
//
// An attacker who copies the app's data directory / a device backup /
// forensic image, without running the app: gets the grant JSON — which is
// public and useless alone — and an entry that references a key they cannot
// use. The private key is not in the IndexedDB value they copied; the
// browser engine keeps non-extractable key material in its own store.
//
// The honest limit: non-extractable is NOT hardware-backed. It defeats
// exfiltration by script (XSS, a malicious dependency, devtools, copy-paste)
// and casual file copying. It does not defeat an attacker with OS-level
// access to the engine's key store on a device they control — WebCrypto has
// no Secure Enclave / StrongBox binding and no biometric gate. Anyone who
// needs that must wait for the Rust-side keystore backend.
//
// An attacker on the network: gains nothing. Every LAN message is
// Ed25519-signed; the cnonce is single-use with 30 s validity; a captured
// exchange cannot be replayed (step 10) and a captured grant cannot be
// redeemed without the key (step 9).
//
// A malicious or compromised hub: can mint a grant for a member it should
// not, and this app would store and present it. That is the hub's authority
// by design — it is the signer the controller pins. Nothing app-side can
// check it; the app deliberately does not pretend to verify the hub
// signature against a key it fetched from the same hub.

import { parseStoredGrant, type Grant } from './grant';
import { b64u } from './jcs';

const DB_NAME = 'lintel.offline-access';
const DB_VERSION = 1;
const KEY_STORE = 'appkey';
const GRANT_STORE = 'grants';
const APP_KEY_ID = 'app-key-v1';

export type AppKey = {
  /** base64url raw ed25519 public key — the `app_pubkey` in the grant. */
  publicKeyB64u: string;
  /** Non-extractable. Usable for signing, never readable. */
  privateKey: CryptoKey;
  createdAt: number;
};

/** One access point, snapshotted while online so the UI works with no network. */
export type GrantAccessPoint = {
  id: string;
  name: string;
  kind: string;
  deviceId: string | null;
};

export type GrantRecord = {
  /** `${gatewayUrl}::${memberId}` — grants never cross hubs or members. */
  id: string;
  gatewayUrl: string;
  memberId: string;
  /** The hub's grant, as JSON text. Presented verbatim (see buildOpenBody). */
  grantRaw: string;
  /** app_pubkey of the key this grant is bound to (fast mismatch check). */
  appPubkey: string;
  /**
   * Display-only snapshot of the access points the grant covers, taken at
   * issuance. NOT an authorisation cache: nothing here decides whether a
   * gate opens (the controller does, from the signed grant alone), and the
   * whole record is deleted the moment the grant expires — so no fragment of
   * a hub-side decision outlives the grant's own validity.
   */
  accessPoints: GrantAccessPoint[];
  /** Last controller LAN address that worked, per device id. */
  addresses: Record<string, string>;
  fetchedAt: number;
};

export type UnsupportedReason =
  | 'no_indexeddb'
  | 'no_webcrypto'
  | 'no_ed25519'
  | 'no_keystore';

export type Support =
  | { ok: true }
  | { ok: false; reason: UnsupportedReason; message: string };

/** The unsupported half of Support — the only half that carries a message. */
export type Unsupported = Extract<Support, { ok: false }>;

const UNSUPPORTED_TEXT: Record<UnsupportedReason, string> = {
  no_indexeddb: 'This browser has no IndexedDB, so nothing can be kept for offline use.',
  no_webcrypto: 'This browser has no Web Crypto, so this device cannot hold an emergency key.',
  no_ed25519:
    'This browser\'s Web Crypto has no Ed25519 support, which the offline grant contract requires.',
  no_keystore:
    'This browser refused to store a non-extractable key. Emergency access will not be set up rather than fall back to storing key material where scripts can read it.',
};

function unsupported(reason: UnsupportedReason): Unsupported {
  return { ok: false, reason, message: UNSUPPORTED_TEXT[reason] };
}

/**
 * Can this build hold an emergency key at all? Fail-closed: anything
 * uncertain is reported as unsupported, and the UI says so, rather than
 * silently degrading to a weaker store.
 */
export async function checkSupport(): Promise<Support> {
  if (typeof indexedDB === 'undefined') return unsupported('no_indexeddb');
  if (typeof crypto === 'undefined' || !crypto.subtle) return unsupported('no_webcrypto');
  try {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    if (!kp?.privateKey) return unsupported('no_ed25519');
  } catch {
    return unsupported('no_ed25519');
  }
  return { ok: true };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(GRANT_STORE)) db.createObjectStore(GRANT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readonly');
    const out = await reqDone<T>(tx.objectStore(store).get(key) as IDBRequest<T>);
    await txDone(tx);
    return out;
  } finally {
    db.close();
  }
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await txDone(tx);
  } finally {
    db.close();
  }
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  } finally {
    db.close();
  }
}

async function idbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readonly');
    const out = await reqDone<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>);
    await txDone(tx);
    return out ?? [];
  } finally {
    db.close();
  }
}

// ── app key ────────────────────────────────────────────────────────────────

type StoredKey = { publicKeyB64u: string; privateKey: CryptoKey; createdAt: number };

/** The key this install holds, or null if it has never made one. */
export async function loadAppKey(): Promise<AppKey | null> {
  try {
    const rec = await idbGet<StoredKey>(KEY_STORE, APP_KEY_ID);
    if (!rec?.privateKey || typeof rec.publicKeyB64u !== 'string') return null;
    // A key that came back extractable is not the key we wrote. Refuse it
    // rather than sign with something whose bytes a script could read.
    if (rec.privateKey.extractable) return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * Load or create this install's app key.
 *
 * The private key is generated non-extractable and stored as a live
 * CryptoKey. If the platform cannot persist it that way, this FAILS —
 * emergency access is simply unavailable — instead of falling back to raw
 * key bytes in storage. A weaker fallback nobody was told about is worse
 * than a feature that says it can't run here.
 */
export async function ensureAppKey(): Promise<{ ok: true; key: AppKey } | { ok: false; support: Unsupported }> {
  const existing = await loadAppKey();
  if (existing) return { ok: true, key: existing };

  const support = await checkSupport();
  if (!support.ok) return { ok: false, support };

  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
  } catch {
    return { ok: false, support: unsupported('no_ed25519') };
  }
  if (pair.privateKey.extractable) {
    // Defensive: a platform that ignores `extractable: false` is not one we
    // will keep gate-opening key material on.
    return { ok: false, support: unsupported('no_keystore') };
  }
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const key: StoredKey = {
    publicKeyB64u: b64u(rawPub),
    privateKey: pair.privateKey,
    createdAt: Math.floor(Date.now() / 1000),
  };
  try {
    await idbPut(KEY_STORE, APP_KEY_ID, key);
  } catch {
    return { ok: false, support: unsupported('no_keystore') };
  }
  // Read it back: storing a CryptoKey is the one step platforms differ on,
  // and a key we cannot read back is a key we cannot sign with tomorrow at
  // the gate. Better to find that out now, online, than there.
  const back = await loadAppKey();
  if (!back || back.publicKeyB64u !== key.publicKeyB64u) {
    return { ok: false, support: unsupported('no_keystore') };
  }
  return { ok: true, key: back };
}

/** Sign with the install's key. Throws if there is no key. */
export function signerFor(key: AppKey) {
  return async (message: Uint8Array): Promise<string> => {
    const sig = await crypto.subtle.sign(
      { name: 'Ed25519' },
      key.privateKey,
      message as unknown as BufferSource,
    );
    return b64u(new Uint8Array(sig));
  };
}

/** Destroy the key. Every grant bound to it becomes unredeemable. */
export async function destroyAppKey(): Promise<void> {
  try {
    await idbDelete(KEY_STORE, APP_KEY_ID);
  } catch {
    /* nothing we can do, and nothing that should throw at a call site */
  }
}

// ── grant records ──────────────────────────────────────────────────────────

export function recordId(gatewayUrl: string, memberId: string): string {
  return `${gatewayUrl}::${memberId}`;
}

/**
 * The record for this hub + member, with its grant parsed and validated.
 *
 * A record whose blob no longer parses (truncated write, tampering, an older
 * build's shape) is DELETED and reported, not repaired and not presented:
 * see `problem` in the return value, which the UI shows.
 */
export async function loadGrantRecord(
  gatewayUrl: string,
  memberId: string,
  nowSec: number,
): Promise<{ record: GrantRecord; grant: Grant } | { record: null; problem: string | null }> {
  let rec: GrantRecord | undefined;
  try {
    rec = await idbGet<GrantRecord>(GRANT_STORE, recordId(gatewayUrl, memberId));
  } catch {
    return { record: null, problem: 'Local storage for offline access could not be opened.' };
  }
  if (!rec) return { record: null, problem: null };
  if (typeof rec.grantRaw !== 'string') {
    await deleteGrantRecord(gatewayUrl, memberId);
    return { record: null, problem: 'The stored grant was malformed and has been discarded.' };
  }
  const parsed = parseStoredGrant(rec.grantRaw);
  if (!parsed.ok) {
    await deleteGrantRecord(gatewayUrl, memberId);
    return {
      record: null,
      problem: `The stored grant was malformed (${parsed.reason}) and has been discarded.`,
    };
  }
  // Expiry is a deletion, not a display state: a grant past its exp
  // authorises nothing anywhere, and keeping it (with its snapshot of who
  // could open what) would be exactly the "cached authorisation outliving
  // the grant" this feature must not do.
  if (nowSec > parsed.grant.exp) {
    await deleteGrantRecord(gatewayUrl, memberId);
    return { record: null, problem: 'Your offline grant expired and has been discarded.' };
  }
  return { record: rec, grant: parsed.grant };
}

export async function saveGrantRecord(rec: GrantRecord): Promise<void> {
  await idbPut(GRANT_STORE, rec.id, rec);
}

export async function deleteGrantRecord(gatewayUrl: string, memberId: string): Promise<void> {
  try {
    await idbDelete(GRANT_STORE, recordId(gatewayUrl, memberId));
  } catch {
    /* best effort */
  }
}

/** Remember the LAN address that worked for a controller. */
export async function rememberAddress(
  rec: GrantRecord,
  deviceId: string,
  address: string,
): Promise<void> {
  const next: GrantRecord = { ...rec, addresses: { ...rec.addresses, [deviceId]: address } };
  await saveGrantRecord(next);
}

/**
 * Drop every record that is expired or belongs to another hub/member.
 * Called on load: stale bearer material should not sit around because a
 * screen was never opened.
 */
export async function pruneRecords(
  keep: { gatewayUrl: string; memberId: string } | null,
  nowSec: number,
): Promise<void> {
  let all: GrantRecord[];
  try {
    all = await idbAll<GrantRecord>(GRANT_STORE);
  } catch {
    return;
  }
  const keepId = keep ? recordId(keep.gatewayUrl, keep.memberId) : null;
  for (const rec of all) {
    if (!rec?.id) continue;
    const parsed = typeof rec.grantRaw === 'string' ? parseStoredGrant(rec.grantRaw) : null;
    const expired = !parsed?.ok || nowSec > parsed.grant.exp;
    if (rec.id !== keepId || expired) {
      try {
        await idbDelete(GRANT_STORE, rec.id);
      } catch {
        /* best effort */
      }
    }
  }
}

/** Wipe everything this feature stores (sign-out, or the resident's choice). */
export async function forgetEverything(): Promise<void> {
  try {
    const all = await idbAll<GrantRecord>(GRANT_STORE);
    for (const rec of all) if (rec?.id) await idbDelete(GRANT_STORE, rec.id);
  } catch {
    /* best effort */
  }
  await destroyAppKey();
}
