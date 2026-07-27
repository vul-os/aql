// The app-side emergency-access service: request a grant while online,
// keep it, and present it at a gate with nothing else running.
//
// This file is the only place that joins the three halves — the hub client
// (api.ts), the vault (vault.ts) and the wire layer (grant.ts / redeem.ts) —
// so the page stays a view and the rules live somewhere testable.

import { ApiError, api, type AccessPointDetail } from '../api';
import { getApiBaseUrl, isTauri } from '../gateway';
import {
  evaluate,
  isExpired,
  needsRefresh,
  parseGrant,
  secondsUntilExpiry,
  type Grant,
  type Verdict,
} from './grant';
import { DEFAULT_LAN_PORT, redeemOverLan, type RedeemOutcome } from './redeem';
import {
  checkSupport,
  ensureAppKey,
  loadAppKey,
  loadGrantRecord,
  pruneRecords,
  rememberAddress,
  saveGrantRecord,
  signerFor,
  deleteGrantRecord,
  forgetEverything,
  recordId,
  type AppKey,
  type GrantAccessPoint,
  type GrantRecord,
  type Support,
} from './vault';

export type OfflineState = {
  support: Support;
  key: AppKey | null;
  record: GrantRecord | null;
  grant: Grant | null;
  /** Something was wrong with what was stored, and it was discarded. */
  problem: string | null;
};

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Read everything this feature knows, and prune anything stale on the way
 * through. Never throws: at a gate, an exception is a blank screen.
 */
export async function loadState(memberId: string): Promise<OfflineState> {
  const gatewayUrl = getApiBaseUrl();
  const support = await checkSupport();
  if (!support.ok) {
    return { support, key: null, record: null, grant: null, problem: null };
  }
  const now = nowSec();
  await pruneRecords({ gatewayUrl, memberId }, now);
  const key = await loadAppKey();
  const loaded = await loadGrantRecord(gatewayUrl, memberId, now);
  if (loaded.record === null) {
    return { support, key, record: null, grant: null, problem: loaded.problem };
  }
  return { support, key, record: loaded.record, grant: loaded.grant, problem: null };
}

export type EnrollOutcome =
  | { ok: true; record: GrantRecord; grant: Grant }
  | { ok: false; message: string };

/**
 * Ask the hub for a grant covering `accessPoints`, and store it.
 *
 * Requires connectivity — that is the whole shape of this feature: the
 * authorisation decision is made online, once, by the hub running the same
 * gates a live open would, and what survives offline is only the signed
 * result of that decision, bounded by its own exp.
 */
export async function requestGrant(
  memberId: string,
  accessPoints: AccessPointDetail[],
): Promise<EnrollOutcome> {
  if (accessPoints.length === 0) return { ok: false, message: 'Pick at least one gate.' };

  const keyRes = await ensureAppKey();
  if (!keyRes.ok) return { ok: false, message: keyRes.support.message };
  const key = keyRes.key;

  let raw: unknown;
  try {
    raw = await api.offlineGrantIssue({
      app_pubkey: key.publicKeyB64u,
      access_point_ids: accessPoints.map((a) => a.id),
    });
  } catch (err) {
    return { ok: false, message: issuanceError(err, accessPoints) };
  }

  const parsed = parseGrant(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `The hub returned a grant this app cannot use (${parsed.reason}). Nothing was stored.`,
    };
  }
  // The hub binds the grant to the key we sent. If what came back names a
  // different key, it can never be redeemed from this device — refuse it
  // now rather than discover that at a gate.
  if (parsed.grant.app_pubkey !== key.publicKeyB64u) {
    return {
      ok: false,
      message: 'The hub bound the grant to a different key than this device holds. Nothing was stored.',
    };
  }

  const gatewayUrl = getApiBaseUrl();
  const previous = await loadGrantRecord(gatewayUrl, memberId, nowSec());
  const record: GrantRecord = {
    id: recordId(gatewayUrl, memberId),
    gatewayUrl,
    memberId,
    grantRaw: JSON.stringify(raw),
    appPubkey: key.publicKeyB64u,
    accessPoints: accessPoints.map(toSnapshot),
    // Keep known-good controller addresses across a refresh — they are the
    // only discovery this app has (see the mDNS note in the page).
    addresses: previous.record?.addresses ?? {},
    fetchedAt: nowSec(),
  };
  try {
    await saveGrantRecord(record);
  } catch {
    return {
      ok: false,
      message: 'The grant could not be stored on this device, so it was not kept.',
    };
  }
  return { ok: true, record, grant: parsed.grant };
}

function toSnapshot(a: AccessPointDetail): GrantAccessPoint {
  return { id: a.id, name: a.name, kind: a.kind, deviceId: a.device_id };
}

function issuanceError(err: unknown, accessPoints: AccessPointDetail[]): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error
      ? `Could not reach the hub: ${err.message}`
      : 'Could not reach the hub.';
  }
  const names = accessPoints.map((a) => a.name).join(', ');
  switch (err.code) {
    case 'user_disabled':
      return 'Your account is disabled, so the hub will not issue an offline grant.';
    case 'account_suspended':
      return 'This account is suspended, so the hub will not issue an offline grant.';
    case 'access_point_not_found':
      return `You do not have access to at least one of the gates you picked (${names}). The hub issues all of them or none — deselect the one you no longer have.`;
    case 'access_point_has_no_device':
      return 'At least one gate you picked has no controller paired, so a grant for it could never open anything.';
    case 'invalid_app_pubkey':
      return 'The hub rejected this device\'s key.';
    case 'invalid_grant':
      return 'The hub rejected the request as malformed.';
    default:
      return err.detail ?? err.code;
  }
}

/**
 * Refresh if the grant is past half-life (or gone). This is the app-side of
 * proto/grants.md's "refreshes on every online launch, so revocation
 * converges within the TTL": each refresh re-runs the hub's authorisation
 * gates from scratch, so a member whose standing changed simply stops
 * getting new grants.
 *
 * Deliberately narrow: it renews ONLY the access points already enrolled. It
 * never widens a grant on its own, and a failure leaves the existing (still
 * valid) grant alone — losing working emergency access because the hub was
 * briefly unreachable would be the wrong failure.
 */
export async function refreshIfDue(
  memberId: string,
  state: OfflineState,
): Promise<EnrollOutcome | null> {
  if (!state.record || !state.grant) return null;
  if (!needsRefresh(state.grant, nowSec())) return null;
  const aps: AccessPointDetail[] = state.record.accessPoints.map(
    (a) =>
      ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        device_id: a.deviceId,
      }) as AccessPointDetail,
  );
  return requestGrant(memberId, aps);
}

export async function forgetGrant(memberId: string): Promise<void> {
  await deleteGrantRecord(getApiBaseUrl(), memberId);
}

/** Sign-out / "this is not my device any more": key and grants both go. */
export async function forgetAll(): Promise<void> {
  await forgetEverything();
}

// ── presenting at a gate ───────────────────────────────────────────────────

export type PresentOptions = {
  record: GrantRecord;
  grant: Grant;
  key: AppKey;
  accessPointId: string;
  /** Controller LAN address, e.g. "lintel-de71ce00.local:8737". */
  address: string;
  acceptWarning?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Present the grant over LAN. Returns the controller's answer, or the app's
 * own refusal when it can already tell the controller would say no.
 */
export async function presentAtGate(opts: PresentOptions): Promise<RedeemOutcome> {
  const ap = opts.record.accessPoints.find((a) => a.id === opts.accessPointId);
  const baseUrl = normalizeControllerAddress(opts.address);
  if (!baseUrl) {
    return {
      kind: 'refused',
      code: 'bad_address',
      message: 'That is not a usable controller address.',
    };
  }
  const outcome = await redeemOverLan({
    baseUrl,
    grantRaw: opts.record.grantRaw,
    grant: opts.grant,
    accessPointId: opts.accessPointId,
    appPubkey: opts.key.publicKeyB64u,
    deviceId: ap?.deviceId ?? null,
    sign: signerFor(opts.key),
    acceptWarning: opts.acceptWarning,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
  });
  // Remember an address that got as far as a real controller answer (opened
  // OR a decoded denial) — both prove something is listening there.
  if ((outcome.kind === 'opened' || outcome.kind === 'denied') && ap?.deviceId) {
    try {
      await rememberAddress(opts.record, ap.deviceId, baseUrl);
    } catch {
      /* remembering is a convenience, never a blocker */
    }
  }
  return outcome;
}

/**
 * Accept "host", "host:port" or a full http URL and produce a base URL.
 * https is rejected: the LAN listener is plain HTTP by contract (every
 * message is signed; the transport adds no trust), so an https address here
 * is a mistake worth naming rather than a silent failure at connect time.
 */
export function normalizeControllerAddress(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:') return null;
  if (!u.hostname) return null;
  const port = u.port || String(DEFAULT_LAN_PORT);
  return `http://${u.hostname}:${port}`;
}

/**
 * The only "discovery" this app can do. The controller advertises mDNS
 * `_lintel._tcp` with an A record for `lintel-<first 8 hex of device_id>
 * .local` — a name the OS resolver can usually resolve (Bonjour, Avahi,
 * Windows mDNS) even though the webview cannot browse mDNS itself. The port
 * is NOT resolvable that way (it lives in the SRV record), so the
 * controller's default is assumed. It is a guess, labelled as one in the UI.
 */
export function guessControllerAddress(deviceId: string | null): string {
  if (!deviceId) return '';
  const hex = deviceId.replace(/[^0-9a-fA-F]/g, '').slice(0, 8).toLowerCase();
  if (hex.length < 8) return '';
  return `http://lintel-${hex}.local:${DEFAULT_LAN_PORT}`;
}

// ── things the page needs to say honestly ──────────────────────────────────

/**
 * Whether the LAN handshake can even be attempted from this build.
 *
 * In an ordinary browser tab it cannot: the controller's listener answers
 * signed JSON and sets no CORS headers (and an https-served portal would hit
 * mixed content first), so the request dies in the browser before reaching
 * the gate. Inside Tauri, requests go through the native HTTP plugin, which
 * is not subject to either rule.
 */
export function lanTransportAvailable(): boolean {
  return isTauri();
}

export type GateStatus = {
  accessPoint: GrantAccessPoint;
  verdict: Verdict;
  address: string;
  /** True when `address` is a remembered, previously-working address. */
  addressKnown: boolean;
};

/** Per-gate presentation status for the UI, in one place. */
export function gateStatuses(
  record: GrantRecord,
  grant: Grant,
  appPubkey: string | null,
  now: number,
): GateStatus[] {
  return record.accessPoints.map((ap) => {
    const known = ap.deviceId ? record.addresses[ap.deviceId] : undefined;
    return {
      accessPoint: ap,
      verdict: evaluate({
        grant,
        accessPointId: ap.id,
        nowSec: now,
        appPubkey,
        deviceId: ap.deviceId,
      }),
      address: known ?? guessControllerAddress(ap.deviceId),
      addressKnown: Boolean(known),
    };
  });
}

export { isExpired, needsRefresh, secondsUntilExpiry };
