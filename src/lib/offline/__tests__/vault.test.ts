// The offline vault, with the multi-hub case as the headline.
//
// The bug this suite was written for: `pruneRecords` used to take a single
// record to keep and delete everything else, so someone holding emergency
// access for their own hub AND a friend's office lost one the moment the
// console switched to the other — and only found out standing at a gate
// during an outage, which is the one situation the feature exists for.
//
// The grants below are the real `grant-redeem-valid` object from
// proto/vectors/grants.json with only iat/exp/grant_id/access_points varied,
// so every record here is one the app would genuinely accept.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeIndexedDB } from './fake-idb';
import type { Grant } from '../grant';
import {
  HubKeyChangedError,
  assertHubKeyUnchanged,
  deleteGrantRecord,
  forgetEverything,
  forgetHub,
  isHubPubkey,
  loadAllGrantRecords,
  loadGrantRecord,
  pinnedHubKeyForUrl,
  pruneRecords,
  recordId,
  saveGrantRecord,
  type GrantRecord,
} from '../vault';

const idb = installFakeIndexedDB();

const DB = 'lintel.offline-access';
const STORE = 'grants';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(here, '../../../../proto/vectors');
const corpus = JSON.parse(readFileSync(path.join(vectorsDir, 'grants.json'), 'utf-8')) as {
  vectors: Array<{ name: string; grant?: { object: Grant } }>;
};
const VALID: Grant = corpus.vectors.find((v) => v.name === 'grant-redeem-valid')!.grant!.object;
const NOW = 1789030800;

// Two different hubs, each with its own Ed25519 identity. Any 32 raw bytes
// base64url-encoded is a structurally valid hub key; these stand in for the
// keys the two hubs serve at GET /v1/gateway/key.
const HOME_HUB = 'A'.repeat(43);
const OFFICE_HUB = 'B'.repeat(43);
const HOME_URL = 'http://aql-home.local:8787';
const OFFICE_URL = 'https://office.example';

function grantJson(patch: Partial<Grant>): string {
  return JSON.stringify({ ...VALID, iat: NOW - 60, exp: NOW + 86_400, ...patch });
}

function record(over: Partial<GrantRecord> & { hubPubkey: string; memberId: string }): GrantRecord {
  return {
    id: recordId(over.hubPubkey, over.memberId),
    gatewayUrl: HOME_URL,
    grantRaw: grantJson({}),
    appPubkey: VALID.app_pubkey,
    accessPoints: [],
    addresses: {},
    fetchedAt: NOW,
    ...over,
  } as GrantRecord;
}

const homeRecord = () =>
  record({
    hubPubkey: HOME_HUB,
    memberId: 'member-home',
    gatewayUrl: HOME_URL,
    grantRaw: grantJson({ grant_id: 'g-home', access_points: ['ap-front-gate'] }),
  });

const officeRecord = () =>
  record({
    hubPubkey: OFFICE_HUB,
    memberId: 'member-office',
    gatewayUrl: OFFICE_URL,
    grantRaw: grantJson({ grant_id: 'g-office', access_points: ['ap-kirk-street'] }),
  });

const storedKeys = () => idb.keys(DB, STORE).sort();

beforeEach(() => idb.reset());

describe('two hubs at once', () => {
  it('keeps BOTH hubs when the console switches from home to the office', async () => {
    await saveGrantRecord(homeRecord());
    await saveGrantRecord(officeRecord());
    expect(storedKeys()).toHaveLength(2);

    // The user switches the console to the office hub. Every load prunes.
    const report = await pruneRecords(NOW);

    expect(report.dropped).toEqual([]);
    expect(storedKeys()).toEqual([
      recordId(HOME_HUB, 'member-home'),
      recordId(OFFICE_HUB, 'member-office'),
    ].sort());

    // And back to home, twice for good measure — still both.
    await pruneRecords(NOW);
    await pruneRecords(NOW);
    expect(storedKeys()).toHaveLength(2);
  });

  it('reads both hubs back, each self-describing', async () => {
    await saveGrantRecord(homeRecord());
    await saveGrantRecord(officeRecord());

    const { held, problems } = await loadAllGrantRecords(NOW);

    expect(problems).toEqual([]);
    expect(held.map((h) => h.record.hubPubkey).sort()).toEqual([HOME_HUB, OFFICE_HUB].sort());
    // Each entry carries its own member id — the app is signed in to at most
    // one hub's console and does not know its member id at the other.
    const office = held.find((h) => h.record.hubPubkey === OFFICE_HUB)!;
    expect(office.record.memberId).toBe('member-office');
    expect(office.grant.access_points).toEqual(['ap-kirk-street']);
  });

  it('a hub is its key, not its URL: the same hub on a new address stays one record', async () => {
    await saveGrantRecord(homeRecord());
    // Same hub, reached from outside the LAN this time.
    await saveGrantRecord({ ...homeRecord(), gatewayUrl: 'https://home.example', fetchedAt: NOW + 5 });

    expect(storedKeys()).toEqual([recordId(HOME_HUB, 'member-home')]);
    const { held } = await loadAllGrantRecords(NOW);
    expect(held).toHaveLength(1);
    expect(held[0].record.gatewayUrl).toBe('https://home.example');
  });
});

describe('retention is per hub', () => {
  it('prunes an expired grant for home without touching the office', async () => {
    await saveGrantRecord({
      ...homeRecord(),
      grantRaw: grantJson({ grant_id: 'g-home', iat: NOW - 200, exp: NOW - 1 }),
    });
    await saveGrantRecord(officeRecord());

    const report = await pruneRecords(NOW);

    expect(report.dropped.map((d) => d.reason)).toEqual(['expired']);
    expect(storedKeys()).toEqual([recordId(OFFICE_HUB, 'member-office')]);
  });

  it('prunes a superseded record inside one hub only', async () => {
    // Re-enrolled at the office as a different member; the older one goes.
    await saveGrantRecord({ ...officeRecord(), memberId: 'old-me', id: recordId(OFFICE_HUB, 'old-me'), fetchedAt: NOW - 900 });
    await saveGrantRecord(officeRecord());
    await saveGrantRecord(homeRecord());

    const report = await pruneRecords(NOW);

    expect(report.dropped.map((d) => d.reason)).toEqual(['superseded']);
    expect(report.dropped[0].id).toBe(recordId(OFFICE_HUB, 'old-me'));
    expect(storedKeys()).toEqual(
      [recordId(HOME_HUB, 'member-home'), recordId(OFFICE_HUB, 'member-office')].sort(),
    );
  });

  it('deleting one hub-member leaves the other hub alone', async () => {
    await saveGrantRecord(homeRecord());
    await saveGrantRecord(officeRecord());

    await deleteGrantRecord(OFFICE_HUB, 'member-office');

    expect(storedKeys()).toEqual([recordId(HOME_HUB, 'member-home')]);
  });

  it('forgetHub drops every record for that hub and nothing else', async () => {
    await saveGrantRecord(homeRecord());
    await saveGrantRecord(officeRecord());
    await saveGrantRecord({ ...officeRecord(), memberId: 'other', id: recordId(OFFICE_HUB, 'other') });

    expect(await forgetHub(OFFICE_HUB)).toBe(2);
    expect(storedKeys()).toEqual([recordId(HOME_HUB, 'member-home')]);
  });

  it('forgetEverything is still all-hubs — the deliberate "not my device" action', async () => {
    await saveGrantRecord(homeRecord());
    await saveGrantRecord(officeRecord());
    await forgetEverything();
    expect(storedKeys()).toEqual([]);
  });
});

describe('fail closed on read', () => {
  it('discards a record that cannot be attributed to a hub, and reports it', async () => {
    // The pre-multi-hub shape: keyed by URL, with no pinned hub key.
    idb.seed(DB, STORE, `${HOME_URL}::member-home`, {
      id: `${HOME_URL}::member-home`,
      gatewayUrl: HOME_URL,
      memberId: 'member-home',
      grantRaw: grantJson({}),
      appPubkey: VALID.app_pubkey,
      accessPoints: [],
      addresses: {},
      fetchedAt: NOW,
    });
    await saveGrantRecord(officeRecord());

    const { held, problems } = await loadAllGrantRecords(NOW);

    expect(storedKeys()).toEqual([recordId(OFFICE_HUB, 'member-office')]);
    expect(held).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/could not be attributed to a hub/);
  });

  it('discards a record filed under a hub it does not name', async () => {
    // Storage key says home; the record inside says office.
    idb.seed(DB, STORE, recordId(HOME_HUB, 'member-home'), officeRecord());

    const report = await pruneRecords(NOW);

    expect(report.dropped.map((d) => d.reason)).toEqual(['unattributable']);
    expect(storedKeys()).toEqual([]);
  });

  it('discards a malformed grant and names the reason', async () => {
    await saveGrantRecord({ ...homeRecord(), grantRaw: '{"v":0,"typ":"grant"' });
    await saveGrantRecord(officeRecord());

    const { problems } = await loadAllGrantRecords(NOW);

    expect(problems.join(' ')).toMatch(/malformed \(stored grant is not valid JSON\)/);
    expect(storedKeys()).toEqual([recordId(OFFICE_HUB, 'member-office')]);
  });

  it('loadGrantRecord deletes and reports an expired record rather than showing it', async () => {
    await saveGrantRecord({
      ...homeRecord(),
      grantRaw: grantJson({ iat: NOW - 200, exp: NOW - 1 }),
    });

    const loaded = await loadGrantRecord(HOME_HUB, 'member-home', NOW);

    expect(loaded.record).toBeNull();
    expect((loaded as { problem: string }).problem).toMatch(/expired/);
    expect(storedKeys()).toEqual([]);
  });

  it('refuses to store a record with no pinned hub key', async () => {
    await expect(
      saveGrantRecord({ ...homeRecord(), hubPubkey: 'not-a-key' } as GrantRecord),
    ).rejects.toThrow(/no pinned hub key/);
    expect(storedKeys()).toEqual([]);
  });

  it('refuses to store a record filed under another hub', async () => {
    await expect(
      saveGrantRecord({ ...homeRecord(), id: recordId(OFFICE_HUB, 'member-home') }),
    ).rejects.toThrow(/filed under another hub/);
    expect(storedKeys()).toEqual([]);
  });
});

describe('hub key pinning', () => {
  it('accepts an address that still answers with the key pinned for it', async () => {
    await saveGrantRecord(homeRecord());
    expect(await pinnedHubKeyForUrl(HOME_URL)).toBe(HOME_HUB);
    await expect(assertHubKeyUnchanged(HOME_URL, HOME_HUB)).resolves.toBeUndefined();
  });

  it('refuses an address that now answers with a different key', async () => {
    await saveGrantRecord(homeRecord());
    await expect(assertHubKeyUnchanged(HOME_URL, OFFICE_HUB)).rejects.toBeInstanceOf(
      HubKeyChangedError,
    );
    // Nothing was re-enrolled, healed, or deleted.
    expect(storedKeys()).toEqual([recordId(HOME_HUB, 'member-home')]);
  });

  it('refuses an offered key that is not a 32-byte ed25519 key', async () => {
    await expect(assertHubKeyUnchanged(HOME_URL, 'nope')).rejects.toBeInstanceOf(
      HubKeyChangedError,
    );
  });

  it('an unknown address is trust-on-first-use, not a refusal', async () => {
    expect(await pinnedHubKeyForUrl('https://brand-new.example')).toBeNull();
    await expect(assertHubKeyUnchanged('https://brand-new.example', OFFICE_HUB)).resolves.toBeUndefined();
  });

  it('isHubPubkey holds the shape the hub actually publishes', () => {
    expect(isHubPubkey(HOME_HUB)).toBe(true);
    expect(isHubPubkey('')).toBe(false);
    expect(isHubPubkey('A'.repeat(42))).toBe(false); // 31 bytes
    expect(isHubPubkey(undefined)).toBe(false);
  });
});
