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
//
// ── MANY HUBS AT ONCE ──────────────────────────────────────────────────────
//
// Someone with a hub at home and access to a friend's office holds a grant
// from EACH, signed by each hub's own key, naming only that hub's gates. The
// two hubs never communicate; this store is the only place they coexist, and
// it is a list, not a slot.
//
// The rules that keeps it honest:
//
//   * A hub is identified by its **Ed25519 public key**, pinned at
//     enrolment — never by its URL. A home hub is one address on the LAN and
//     another from outside; treating those as two hubs is exactly how a
//     grant gets orphaned. `gatewayUrl` is demoted to a mutable address
//     hint. An address that answers with a different key than the one pinned
//     for it is REFUSED (HubKeyChangedError), never silently re-enrolled —
//     the app-side analogue of the controller's ErrKeyChangeRefused
//     (controller/internal/state/state.go).
//
//   * Retention is PER HUB. An expired or superseded record for hub A is
//     still deleted; nothing about hub A ever deletes hub B. Switching which
//     hub the admin console points at deletes nothing at all.
//
//   * Records are structurally isolated: every read resolves ONE record and
//     takes the grant, the app key binding and the addresses from that record
//     alone. There is no index keyed on an access-point id, because those ids
//     are hub-local. This is defence in depth and UI correctness, NOT the
//     security boundary — the boundary is the controller, which verifies
//     every grant against its own pinned hub key
//     (controller/internal/grants/grants.go, step 3) and answers `bad_sig` to
//     a foreign one. An app-side bug here is a denial, not an open gate.
//
//   * Fail closed on read. A record that cannot be parsed, or cannot be
//     attributed to a hub, is deleted AND reported — never silently kept and
//     never silently dropped.

import { parseStoredGrant, type Grant } from './grant';
import { b64u, unB64u } from './jcs';

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
  /** `${hubPubkey}::${memberId}` — grants never cross hubs or members. */
  id: string;
  /**
   * The hub's Ed25519 public key (base64url raw, 32 bytes), pinned at
   * enrolment. THIS is the hub's identity — the same value the controllers at
   * that hub pin, served by the hub at GET /v1/gateway/key. A record whose
   * hubPubkey is missing or malformed cannot be attributed to any hub and is
   * discarded rather than presented.
   */
  hubPubkey: string;
  /**
   * Mutable address hint: the URL this hub last answered on. NOT identity —
   * the same hub is a `.local` name on the LAN and something else from
   * outside, and changing it is routine. Only ever used to reach the hub, and
   * to notice that an address now answers with a different key.
   */
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

/**
 * Every row with the key it is actually stored under.
 *
 * Deletion must target the storage key, never an `id` field read out of a
 * value that may be exactly the thing that is corrupt — otherwise a record
 * whose `id` is missing or wrong can never be removed. Both requests are
 * issued before either is awaited: an idle IndexedDB transaction auto-commits.
 */
async function idbEntries<T>(store: string): Promise<Array<{ key: string; value: T }>> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const keysP = reqDone<IDBValidKey[]>(os.getAllKeys() as IDBRequest<IDBValidKey[]>);
    const valsP = reqDone<T[]>(os.getAll() as IDBRequest<T[]>);
    const keys = (await keysP) ?? [];
    const values = (await valsP) ?? [];
    await txDone(tx);
    return keys.map((k, i) => ({ key: String(k), value: values[i] }));
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

/**
 * A hub public key as the hub publishes it: raw Ed25519, base64url unpadded,
 * exactly 32 bytes. Anything else is not a hub identity, and a record wearing
 * one is unattributable rather than merely odd.
 */
export function isHubPubkey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) return false;
  const raw = unB64u(v);
  return raw !== null && raw.length === 32;
}

/**
 * Refusal to accept that an address is a hub it is not.
 *
 * The app-side counterpart of the controller's ErrKeyChangeRefused
 * (controller/internal/state/state.go): once a key is pinned for a hub, an
 * address answering with a different one is refused and surfaced, never
 * silently re-enrolled — auto-healing a key change is indistinguishable from
 * accepting a hub takeover.
 */
export class HubKeyChangedError extends Error {
  readonly code = 'hub_key_changed';
  readonly gatewayUrl: string;
  readonly pinned: string;
  readonly offered: string;
  constructor(gatewayUrl: string, pinned: string, offered: string) {
    super(
      'The hub at this address is not the one you enrolled with: it answered with a different key. Nothing was changed.',
    );
    this.name = 'HubKeyChangedError';
    this.gatewayUrl = gatewayUrl;
    this.pinned = pinned;
    this.offered = offered;
  }
}

export function recordId(hubPubkey: string, memberId: string): string {
  return `${hubPubkey}::${memberId}`;
}

/** Why a stored record was discarded — every one of these is shown, never silent. */
export type DropReason =
  | 'unattributable'
  | 'malformed'
  | 'expired'
  | 'superseded';

export type DroppedRecord = { id: string; reason: DropReason; message: string };

const DROP_TEXT: Record<DropReason, string> = {
  unattributable:
    'A stored grant could not be attributed to a hub (it predates hub-key pinning, or was written by another build) and has been discarded. Set up emergency access again while online.',
  malformed: 'A stored grant was malformed and has been discarded.',
  expired: 'A stored grant expired and has been discarded.',
  superseded: 'An older grant for the same hub was replaced and has been discarded.',
};

function dropped(id: string, reason: DropReason, detail?: string): DroppedRecord {
  const base = DROP_TEXT[reason];
  return { id, reason, message: detail ? base.replace('malformed', `malformed (${detail})`) : base };
}

/**
 * Read one stored record and check that it is internally consistent, without
 * touching storage.
 *
 * Structural isolation lives here: a record is only usable if it names the hub
 * it is filed under. A blob whose `id` disagrees with its own
 * `(hubPubkey, memberId)` is not a record for some other hub — it is a record
 * that cannot be attributed at all, and is refused.
 */
function inspect(
  rec: GrantRecord | undefined,
  nowSec: number,
): { ok: true; record: GrantRecord; grant: Grant } | { ok: false; reason: DropReason; detail?: string } {
  if (!rec || typeof rec.id !== 'string') return { ok: false, reason: 'unattributable' };
  if (!isHubPubkey(rec.hubPubkey) || typeof rec.memberId !== 'string' || !rec.memberId) {
    return { ok: false, reason: 'unattributable' };
  }
  if (rec.id !== recordId(rec.hubPubkey, rec.memberId)) {
    return { ok: false, reason: 'unattributable' };
  }
  if (typeof rec.grantRaw !== 'string') return { ok: false, reason: 'malformed' };
  const parsed = parseStoredGrant(rec.grantRaw);
  if (!parsed.ok) return { ok: false, reason: 'malformed', detail: parsed.reason };
  // Expiry is a deletion, not a display state: a grant past its exp
  // authorises nothing anywhere, and keeping it (with its snapshot of who
  // could open what) would be exactly the "cached authorisation outliving
  // the grant" this feature must not do.
  if (nowSec > parsed.grant.exp) return { ok: false, reason: 'expired' };
  return { ok: true, record: rec, grant: parsed.grant };
}

/**
 * The record for this hub + member, with its grant parsed and validated.
 *
 * A record whose blob no longer parses (truncated write, tampering, an older
 * build's shape) is DELETED and reported, not repaired and not presented:
 * see `problem` in the return value, which the UI shows.
 */
export async function loadGrantRecord(
  hubPubkey: string,
  memberId: string,
  nowSec: number,
): Promise<{ record: GrantRecord; grant: Grant } | { record: null; problem: string | null }> {
  let rec: GrantRecord | undefined;
  try {
    rec = await idbGet<GrantRecord>(GRANT_STORE, recordId(hubPubkey, memberId));
  } catch {
    return { record: null, problem: 'Local storage for offline access could not be opened.' };
  }
  if (!rec) return { record: null, problem: null };
  const seen = inspect(rec, nowSec);
  if (!seen.ok) {
    await deleteGrantRecord(hubPubkey, memberId);
    return { record: null, problem: dropped(rec.id ?? '', seen.reason, seen.detail).message };
  }
  return { record: seen.record, grant: seen.grant };
}

/** One hub's held grant. */
export type HeldGrant = { record: GrantRecord; grant: Grant };

/**
 * Every hub's usable grant, newest first, with everything unusable deleted
 * and reported.
 *
 * This is the multi-hub read: home and the friend's office come back side by
 * side, each self-describing (its own hub key, its own member id, its own
 * gates). Nothing here consults another record, and no record's state can
 * remove another's.
 */
export async function loadAllGrantRecords(
  nowSec: number,
): Promise<{ held: HeldGrant[]; problems: string[] }> {
  const report = await pruneRecords(nowSec);
  const problems = report.dropped.map((d) => d.message);
  if (report.unreadable) {
    return { held: [], problems: ['Local storage for offline access could not be opened.'] };
  }
  let all: GrantRecord[];
  try {
    all = await idbAll<GrantRecord>(GRANT_STORE);
  } catch {
    return { held: [], problems: ['Local storage for offline access could not be opened.'] };
  }
  const held: HeldGrant[] = [];
  for (const rec of all) {
    const seen = inspect(rec, nowSec);
    // pruneRecords just removed everything inspect() would reject, so a
    // failure here is a concurrent write. Skip it; the next load reports it.
    if (seen.ok) held.push({ record: seen.record, grant: seen.grant });
  }
  held.sort((a, b) => (b.record.fetchedAt ?? 0) - (a.record.fetchedAt ?? 0));
  return { held, problems: [...new Set(problems)] };
}

export async function saveGrantRecord(rec: GrantRecord): Promise<void> {
  if (!isHubPubkey(rec.hubPubkey)) {
    // Refuse to write something that could never be attributed back to a hub,
    // rather than store it and discover it at a gate.
    throw new Error('offline vault: refusing to store a record with no pinned hub key');
  }
  if (rec.id !== recordId(rec.hubPubkey, rec.memberId)) {
    throw new Error('offline vault: refusing to store a record filed under another hub');
  }
  await idbPut(GRANT_STORE, rec.id, rec);
}

export async function deleteGrantRecord(hubPubkey: string, memberId: string): Promise<void> {
  try {
    await idbDelete(GRANT_STORE, recordId(hubPubkey, memberId));
  } catch {
    /* best effort */
  }
}

/**
 * The key pinned for `gatewayUrl`, or null if no record has ever used that
 * address. Several records may share an address (different members at one
 * hub); they must agree, and a disagreement is itself a refusal.
 */
export async function pinnedHubKeyForUrl(gatewayUrl: string): Promise<string | null> {
  let all: GrantRecord[];
  try {
    all = await idbAll<GrantRecord>(GRANT_STORE);
  } catch {
    return null;
  }
  let pinned: string | null = null;
  for (const rec of all) {
    if (!rec || rec.gatewayUrl !== gatewayUrl || !isHubPubkey(rec.hubPubkey)) continue;
    if (pinned === null) pinned = rec.hubPubkey;
    else if (pinned !== rec.hubPubkey) throw new HubKeyChangedError(gatewayUrl, pinned, rec.hubPubkey);
  }
  return pinned;
}

/**
 * Fail closed on a hub identity change: an address that used to be hub X and
 * now answers as hub Y is refused, and nothing is written.
 *
 * Throws HubKeyChangedError. Deliberately not a boolean — the caller must not
 * be able to ignore it by forgetting to check.
 */
export async function assertHubKeyUnchanged(gatewayUrl: string, offered: string): Promise<void> {
  if (!isHubPubkey(offered)) {
    throw new HubKeyChangedError(gatewayUrl, '', typeof offered === 'string' ? offered : '');
  }
  const pinned = await pinnedHubKeyForUrl(gatewayUrl);
  if (pinned !== null && pinned !== offered) {
    throw new HubKeyChangedError(gatewayUrl, pinned, offered);
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

export type PruneReport = {
  /** Everything deleted, with the reason — the UI shows these. */
  dropped: DroppedRecord[];
  /** The store could not be read at all; nothing was deleted. */
  unreadable: boolean;
};

/**
 * Drop stale bearer material. Called on load, because a grant should not sit
 * around past its life just because a screen was never opened.
 *
 * PER HUB, NOT GLOBAL. This function used to take a single record to keep and
 * delete everything else, which meant switching the admin console from the
 * home hub to a friend's office destroyed the home hub's emergency access —
 * discovered at a gate, during an outage, which is the one moment this
 * feature exists for. Nothing here evicts a record on account of another hub.
 *
 * What is still deleted, and only ever within its own hub:
 *   * unattributable — no pinned hub key, or filed under a key it does not
 *     name. It cannot be presented safely and cannot be repaired.
 *   * malformed — the blob no longer parses (truncated write, tampering, an
 *     older build's shape).
 *   * expired — expiry is a deletion, not a display state.
 *   * superseded — an older record for the SAME hub (a re-enrolment as a
 *     different member there). The newest fetch wins; hub B is untouched.
 */
export async function pruneRecords(nowSec: number): Promise<PruneReport> {
  let entries: Array<{ key: string; value: GrantRecord }>;
  try {
    entries = await idbEntries<GrantRecord>(GRANT_STORE);
  } catch {
    return { dropped: [], unreadable: true };
  }

  const dropList: DroppedRecord[] = [];
  const survivors: Array<{ key: string; value: GrantRecord }> = [];
  for (const entry of entries) {
    const seen = inspect(entry.value, nowSec);
    // A row whose storage key disagrees with the record it holds is not a
    // record for another hub — it is one that cannot be attributed at all.
    if (seen.ok && entry.key === seen.record.id) survivors.push(entry);
    else dropList.push(dropped(entry.key, seen.ok ? 'unattributable' : seen.reason, seen.ok ? undefined : seen.detail));
  }

  // Supersession is judged inside one hub only: group by the pinned key, keep
  // the newest fetch, drop the rest. A hub with one record — the normal case
  // — never enters this branch, and no hub's group can ever reach another's.
  const byHub = new Map<string, Array<{ key: string; value: GrantRecord }>>();
  for (const entry of survivors) {
    const group = byHub.get(entry.value.hubPubkey);
    if (group) group.push(entry);
    else byHub.set(entry.value.hubPubkey, [entry]);
  }
  for (const group of byHub.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) => (b.value.fetchedAt ?? 0) - (a.value.fetchedAt ?? 0) || a.key.localeCompare(b.key),
    );
    for (const stale of group.slice(1)) dropList.push(dropped(stale.key, 'superseded'));
  }

  for (const d of dropList) {
    try {
      await idbDelete(GRANT_STORE, d.id);
    } catch {
      /* best effort */
    }
  }
  return { dropped: dropList, unreadable: false };
}

/**
 * Forget one hub — every record filed under that pinned key, whatever member
 * it names. The deliberate scope for "I no longer have access to that site":
 * it must not touch any other hub's emergency access.
 */
export async function forgetHub(hubPubkey: string): Promise<number> {
  let entries: Array<{ key: string; value: GrantRecord }>;
  try {
    entries = await idbEntries<GrantRecord>(GRANT_STORE);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (entry.value?.hubPubkey !== hubPubkey) continue;
    try {
      await idbDelete(GRANT_STORE, entry.key);
      removed += 1;
    } catch {
      /* best effort */
    }
  }
  return removed;
}

/**
 * Wipe everything this feature stores, for EVERY hub, plus the app key.
 *
 * "This is not my device any more" — the one deliberate all-hubs action.
 * Ordinary sign-out from one hub's console must use forgetHub instead: it
 * would otherwise destroy emergency access at hubs the person never signed
 * out of.
 */
export async function forgetEverything(): Promise<void> {
  try {
    // By storage key, not by the `id` inside the value: a corrupt record must
    // still be removable by "this is not my device any more".
    const entries = await idbEntries<GrantRecord>(GRANT_STORE);
    for (const entry of entries) await idbDelete(GRANT_STORE, entry.key);
  } catch {
    /* best effort */
  }
  await destroyAppKey();
}
