// The app-side emergency-access service: request a grant while online,
// keep it, and present it at a gate with nothing else running.
//
// This file is the only place that joins the three halves — the hub client
// (api.ts), the vault (vault.ts) and the wire layer (grant.ts / redeem.ts) —
// so the page stays a view and the rules live somewhere testable.

import { ApiError, api, type AccessPointDetail } from '../api';
import { gatewayFetch, getApiBaseUrl, isTauri } from '../hub';
import {
  evaluate,
  isExpired,
  needsRefresh,
  parseGrant,
  parseStoredGrant,
  secondsUntilExpiry,
  type Grant,
  type Verdict,
} from './grant';
import { DEFAULT_LAN_PORT, redeemOverLan, type RedeemOutcome } from './redeem';
import {
  HubKeyChangedError,
  assertHubKeyUnchanged,
  checkSupport,
  ensureAppKey,
  isHubPubkey,
  loadAllGrantRecords,
  loadAppKey,
  loadGrantRecord,
  rememberAddress,
  saveGrantRecord,
  signerFor,
  forgetHub,
  forgetEverything,
  recordId,
  type AppKey,
  type GrantAccessPoint,
  type GrantRecord,
  type HeldGrant,
  type Support,
} from './vault';

export type { HeldGrant };

export type OfflineState = {
  support: Support;
  key: AppKey | null;
  /**
   * Every hub this device holds a usable grant from — home AND the friend's
   * office, side by side, newest fetch first. Each entry is self-describing
   * (its own pinned hub key, its own member id at that hub, its own gates);
   * nothing here is scoped to whichever hub the admin console happens to be
   * pointed at.
   */
  held: HeldGrant[];
  /**
   * The entry for the hub the console is currently pointed at, matched on the
   * stored address hint and member id, or null when the console's hub is one
   * this device holds no grant from. Never used to decide what to keep.
   */
  current: HeldGrant | null;
  /** What was discarded and why. Shown to the user — nothing is dropped silently. */
  problems: string[];
};

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Read everything this feature knows, and prune anything stale on the way
 * through. Never throws: at a gate, an exception is a blank screen.
 *
 * Reads EVERY hub's record, not just the console's. `memberId` is only used
 * to work out which of them the console is currently looking at — the app is
 * signed in to at most one hub's console and simply does not know its member
 * id at the others, which is why each record carries its own.
 */
export async function loadState(memberId: string): Promise<OfflineState> {
  const support = await checkSupport();
  if (!support.ok) {
    return { support, key: null, held: [], current: null, problems: [] };
  }
  const now = nowSec();
  const { held, problems } = await loadAllGrantRecords(now);
  const key = await loadAppKey();
  const gatewayUrl = getApiBaseUrl();
  const current =
    held.find((h) => h.record.gatewayUrl === gatewayUrl && h.record.memberId === memberId) ?? null;
  return { support, key, held, current, problems };
}

export type EnrollOutcome =
  | { ok: true; record: GrantRecord; grant: Grant }
  | { ok: false; message: string; code?: string };

/**
 * Ask an address which hub it is: GET /v1/gateway/key, the same Ed25519
 * public key the controllers at that hub pin
 * (hub/internal/keys.PublicKeyB64, served by handleGatewayKey).
 *
 * Trust-on-first-use, and it says so: a first fetch cannot be authenticated,
 * because the only thing available to authenticate it with is the hub itself.
 * What pinning buys is everything AFTER the first: the same hub is one record
 * whether reached over the LAN or from outside, and an address that starts
 * answering with a different key is refused instead of quietly re-enrolled.
 */
async function fetchHubPubkey(
  baseUrl: string,
): Promise<{ ok: true; hubPubkey: string } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await gatewayFetch(`${baseUrl}/v1/gateway/key`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    return {
      ok: false,
      message: `Could not ask the hub which hub it is: ${err instanceof Error ? err.message : 'no answer'}.`,
    };
  }
  if (!res.ok) {
    return { ok: false, message: `The hub answered HTTP ${res.status} when asked for its key.` };
  }
  const body = (await res.json().catch(() => null)) as {
    alg?: unknown;
    public_key?: unknown;
  } | null;
  if (!body || body.alg !== 'ed25519' || !isHubPubkey(body.public_key)) {
    return {
      ok: false,
      message: 'That address did not return a usable Ed25519 hub key, so it cannot be pinned.',
    };
  }
  return { ok: true, hubPubkey: body.public_key };
}

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

  // Establish WHICH hub this is before asking it for anything, so a grant is
  // never minted only to be refused, and so a changed key is caught here
  // rather than after a record has been written.
  const gatewayUrl = getApiBaseUrl();
  const hubKey = await fetchHubPubkey(gatewayUrl);
  if (!hubKey.ok) return { ok: false, message: hubKey.message };
  try {
    await assertHubKeyUnchanged(gatewayUrl, hubKey.hubPubkey);
  } catch (err) {
    if (err instanceof HubKeyChangedError) {
      return { ok: false, message: err.message, code: err.code };
    }
    return { ok: false, message: 'The stored hub pinning could not be checked, so nothing was changed.' };
  }

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

  const previous = await loadGrantRecord(hubKey.hubPubkey, memberId, nowSec());
  const record: GrantRecord = {
    id: recordId(hubKey.hubPubkey, memberId),
    hubPubkey: hubKey.hubPubkey,
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
 *
 * Only ever the CURRENT hub's grant: refreshing needs that hub's session, and
 * this app holds at most one. Every other hub's record is left exactly as it
 * is until the console is pointed back at it.
 */
export async function refreshIfDue(
  memberId: string,
  state: OfflineState,
): Promise<EnrollOutcome | null> {
  const current = state.current;
  if (!current) return null;
  if (!needsRefresh(current.grant, nowSec())) return null;
  const aps: AccessPointDetail[] = current.record.accessPoints.map(
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

/**
 * Drop ONE hub's emergency access — identified by its pinned key, not its
 * address, so "forget the office" cannot reach the home hub's record even if
 * both were once on the same URL.
 */
export async function forgetGrant(hubPubkey: string): Promise<void> {
  await forgetHub(hubPubkey);
}

/**
 * "This is not my device any more": every hub's grant and the app key.
 *
 * Deliberately all-hubs, and deliberately NOT the ordinary sign-out path —
 * signing out of one hub's console must not destroy emergency access at a
 * hub the person never signed out of. Use forgetGrant for that.
 */
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
  // Structural isolation (multi-hub §2.5 rule 1): everything presented is
  // taken out of ONE record — the bytes that go on the wire, the access
  // points, the addresses and the key binding. The parsed grant is re-derived
  // from that record's own blob rather than trusted from the caller, so a
  // caller that paired one hub's record with another hub's grant judges the
  // wrong document locally and is refused here.
  //
  // This is defence in depth, not the boundary: the controller verifies every
  // grant against its own pinned hub key and answers `bad_sig` to a foreign
  // one (controller/internal/grants/grants.go, step 3). What this buys is an
  // honest refusal on this device instead of a confusing denial at the gate.
  const own = parseStoredGrant(opts.record.grantRaw);
  if (!own.ok || own.grant.grant_id !== opts.grant.grant_id) {
    return {
      kind: 'refused',
      code: 'record_mismatch',
      message:
        'That grant does not belong to the hub record it was presented with. Nothing was sent.',
    };
  }
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
    grant: own.grant,
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
 * Three cases, and the middle one is new:
 *
 *  - **Desktop shell.** Always. Requests go through Tauri's native HTTP
 *    plugin, which is subject to neither CORS nor mixed content.
 *  - **A browser tab on an http console.** Yes, since the controller began
 *    answering with a CORS header naming the console of the hub it is paired
 *    to (controller/internal/lanserver/cors.go). Before that the browser
 *    refused to let the page read the challenge and the handshake died before
 *    reaching the gate.
 *  - **A browser tab on an https console.** No, and no header can change it:
 *    the controller speaks plain http on the LAN, so the request is blocked
 *    as mixed content before CORS is ever consulted. Presenting from an
 *    https-served console needs the desktop shell.
 *
 * This reports what can be ATTEMPTED, not what will succeed. A controller
 * paired to a different address than the one this console is served from will
 * refuse the origin, and the attempt fails at the network layer — which the
 * redemption path reports as a transport failure rather than a denial, because
 * "the gate said no" and "we never reached the gate" are different facts.
 */
export function lanTransportAvailable(): boolean {
  if (isTauri()) return true;
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'http:';
}

export type GateStatus = {
  /**
   * The hub this gate belongs to — its pinned key. Access-point ids are
   * hub-local (randomly generated, so collision is improbable — but
   * improbable is not a boundary), so every UI map over gates must be keyed
   * on the composite `(hubPubkey, accessPoint.id)`, never on the id alone.
   */
  hubPubkey: string;
  accessPoint: GrantAccessPoint;
  verdict: Verdict;
  address: string;
  /** True when `address` is a remembered, previously-working address. */
  addressKnown: boolean;
};

/**
 * Per-gate presentation status for the UI, in one place.
 *
 * A gate's hub is never inferred: it is the record the gate was read out of.
 * No step here consults another record.
 */
export function gateStatuses(
  record: GrantRecord,
  grant: Grant,
  appPubkey: string | null,
  now: number,
): GateStatus[] {
  return record.accessPoints.map((ap) => {
    const known = ap.deviceId ? record.addresses[ap.deviceId] : undefined;
    return {
      hubPubkey: record.hubPubkey,
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

/**
 * The unified gate list across every hub — home and the friend's office in
 * one list, because the moment this is used is the worst possible moment to
 * make someone answer "which hub is this gate on?" first.
 *
 * Provenance is carried, not inferred: each entry keeps the `hubPubkey` of the
 * record it came out of, so the UI can group under a hub heading and key its
 * maps on the composite without any global index over hub-local ids.
 */
export function allGateStatuses(
  held: HeldGrant[],
  appPubkey: string | null,
  now: number,
): GateStatus[] {
  return held.flatMap((h) => gateStatuses(h.record, h.grant, appPubkey, now));
}

export type Freshness = {
  /** Unix seconds when this hub last confirmed the grant. */
  confirmedAt: number;
  ageSec: number;
  /**
   * True when this device has NOT been able to ask the hub since the grant
   * was past half-life. The grant is still cryptographically valid until its
   * exp — but the app does not know whether the hub has withdrawn it, and
   * must say both.
   */
  unconfirmed: boolean;
  /**
   * Wording that never renders staleness as validity. There is no green
   * "Valid" here on purpose: nothing this device can do offline re-verifies a
   * stored grant against the hub's current view of the holder.
   */
  message: string;
};

/**
 * What may honestly be said about one hub's grant right now.
 *
 * The two facts are different and both must be shown: the grant is valid
 * until `exp` (this device can check that), and the hub may have withdrawn it
 * since `fetchedAt` (this device cannot check that at all while offline).
 */
export function freshness(held: HeldGrant, now: number): Freshness {
  const confirmedAt = held.record.fetchedAt ?? 0;
  const ageSec = Math.max(0, now - confirmedAt);
  const unconfirmed = needsRefresh(held.grant, now);
  const until = new Date(held.grant.exp * 1000).toISOString().slice(0, 10);
  return {
    confirmedAt,
    ageSec,
    unconfirmed,
    message: unconfirmed
      ? `Not confirmed with this hub since ${new Date(confirmedAt * 1000)
          .toISOString()
          .slice(0, 10)}. It will still open these gates until ${until} unless the hub has withdrawn it — this device has not been able to ask. Connect when you can.`
      : `Confirmed with this hub on ${new Date(confirmedAt * 1000)
          .toISOString()
          .slice(0, 10)}. Opens these gates until ${until}.`,
  };
}

export { isExpired, needsRefresh, secondsUntilExpiry };
