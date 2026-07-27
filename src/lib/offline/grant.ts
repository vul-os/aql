// The grant object as the app sees it: parsing, validation, and the
// app-side mirror of the checks the controller will run.
//
// NORMATIVE SOURCES — this file implements against them, it does not define
// anything:
//   proto/grants.md                      (the wire contract + 11-step order)
//   controller/internal/grants/grants.go (what actually verifies)
//   hub/internal/keys/grant.go       (what actually gets minted)
//
// WHY THE APP RE-CHECKS AT ALL. The controller is the authority; nothing
// here can make it open. The point of duplicating steps 4-7 locally is the
// fail-closed UX rule this feature is held to: never present something the
// controller will reject without telling the resident why FIRST. At a gate,
// in the dark, "denied: wrong_access_point" from the box is a much worse
// experience than "you don't hold a grant for this gate" from the app before
// it even tries.
//
// WHAT IS DELIBERATELY *NOT* CHECKED HERE:
//   * step 3 (grant.sig against the pinned gateway key) — the app has no
//     pinned gateway key and no way to get one over this contract set. A
//     forged grant fails at the controller, which is the only place the
//     check means anything. We do NOT pretend otherwise by "verifying"
//     against a key we ourselves fetched from the same hub that signed it.
//   * steps 1/2 (stale clock, lockdown) — controller-local state the app
//     cannot see by design ("that locality is the feature this whole path
//     exists for"). Surfaced only as a decoded denial reason.
//   * steps 10/11 (cnonce, proof ts) — belong to the live exchange
//     (redeem.ts), not to a stored grant.

import { unB64u } from './jcs';

/** ±90 s, wire.ClockSkewSeconds — applied to both validity bounds. */
export const CLOCK_SKEW_SECONDS = 90;
/** 30 s, wire.CnonceTTLSeconds — grant.challenge validity. */
export const CNONCE_TTL_SECONDS = 30;
/** 7 days, keys.DefaultGrantTTL — fixed, not caller-extendable. */
export const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Contract major version (wire.Version). */
export const WIRE_VERSION = 0;

export type GrantWindow = { days: string; from: string; to: string };

export type Grant = {
  v: number;
  typ: 'grant';
  grant_id: string;
  member: string;
  app_pubkey: string;
  devices: string[];
  access_points: string[];
  windows: GrantWindow[];
  iat: number;
  exp: number;
  sig: string;
};

export type ParseResult =
  | { ok: true; grant: Grant }
  | { ok: false; reason: string };

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every(isStr);
const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v);

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Strict structural validation of a grant, wherever it came from (the hub's
 * response, or a blob read back out of local storage that may have been
 * truncated, tampered with, or written by an older build).
 *
 * Fail-closed: anything that isn't exactly the proto/grants.md shape is
 * refused with a reason, never coerced into something presentable. A grant
 * this function rejects is one the app will not send.
 */
export function parseGrant(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'not a JSON object' };
  }
  const g = input as Record<string, unknown>;
  if (g.v !== WIRE_VERSION) return { ok: false, reason: `unsupported version ${String(g.v)}` };
  if (g.typ !== 'grant') return { ok: false, reason: `wrong type ${String(g.typ)}` };
  if (!isStr(g.grant_id)) return { ok: false, reason: 'missing grant_id' };
  if (!isStr(g.member)) return { ok: false, reason: 'missing member' };
  if (!isStr(g.app_pubkey)) return { ok: false, reason: 'missing app_pubkey' };
  // 32 raw bytes — anything else can never satisfy step 9 at the controller.
  const pub = unB64u(g.app_pubkey);
  if (!pub || pub.length !== 32) return { ok: false, reason: 'app_pubkey is not a 32-byte ed25519 key' };
  // An empty devices list is structurally valid JSON but can never be
  // redeemed anywhere (step 5 requires the controller's own device_id to be
  // in it), so it is refused rather than stored as dead weight.
  if (!isStrArray(g.devices)) return { ok: false, reason: 'missing devices' };
  if (!isStrArray(g.access_points)) return { ok: false, reason: 'missing access_points' };
  if (!Array.isArray(g.windows) || g.windows.length === 0) {
    return { ok: false, reason: 'missing windows' };
  }
  for (const w of g.windows) {
    if (typeof w !== 'object' || w === null) return { ok: false, reason: 'malformed window' };
    const win = w as Record<string, unknown>;
    if (!isStr(win.days) || !isStr(win.from) || !isStr(win.to)) {
      return { ok: false, reason: 'malformed window' };
    }
    if (parseDays(win.days) === null) return { ok: false, reason: `malformed window days "${win.days}"` };
    if (parseHM(win.from) === null || parseHM(win.to) === null) {
      return { ok: false, reason: 'malformed window time' };
    }
  }
  if (!isInt(g.iat) || !isInt(g.exp)) return { ok: false, reason: 'missing iat/exp' };
  if (g.exp <= g.iat) return { ok: false, reason: 'exp is not after iat' };
  const sig = isStr(g.sig) ? unB64u(g.sig) : null;
  if (!sig || sig.length !== 64) return { ok: false, reason: 'missing or malformed sig' };
  return { ok: true, grant: input as Grant };
}

/** Parse a stored JSON string. Any failure is a refusal, never a throw. */
export function parseStoredGrant(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'stored grant is not valid JSON' };
  }
  return parseGrant(value);
}

// ── window evaluation (step 7) ─────────────────────────────────────────────
//
// Line-for-line mirror of controller/internal/grants.InAnyWindow, with ONE
// difference the app cannot close: the controller evaluates against its own
// configured timezone (v0 default UTC), which is not carried on any wire
// message. This function therefore evaluates in UTC — the documented default
// — and callers must treat a negative result as a WARNING ("the controller
// may refuse this"), never as a hard local refusal. Blocking a legitimate
// open at a gate during a blackout because of a timezone we had to guess
// would be the wrong failure.

function parseDays(s: string): [number, number] | null {
  const idx = (name: string) => DAYS.indexOf(name);
  const dash = s.indexOf('-');
  const lo = dash >= 0 ? idx(s.slice(0, dash)) : idx(s);
  const hi = dash >= 0 ? idx(s.slice(dash + 1)) : lo;
  if (lo < 0 || hi < lo) return null;
  return [lo, hi];
}

/** "HH:MM" → minutes since midnight; "24:00" = 1440. null when malformed. */
function parseHM(s: string): number | null {
  if (s.length !== 5 || s[2] !== ':') return null;
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(3, 5));
  if (h === 24 && m === 0) return 1440;
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Evaluated in UTC (the v0 default timezone) — see the note above. */
export function inAnyWindow(windows: GrantWindow[], nowSec: number): boolean {
  const t = new Date(nowSec * 1000);
  const day = (t.getUTCDay() + 6) % 7; // JS Sunday-first → contract mon..sun
  const minute = t.getUTCHours() * 60 + t.getUTCMinutes();
  for (const w of windows) {
    const range = parseDays(w.days);
    if (!range || day < range[0] || day > range[1]) continue;
    const from = parseHM(w.from);
    const to = parseHM(w.to);
    if (from === null || to === null) continue;
    if (minute >= from && minute < to) return true; // `to` exclusive
  }
  return false;
}

/** True when the windows cover every minute of every day (the v0 mint). */
export function isAlwaysOpenWindow(windows: GrantWindow[]): boolean {
  return windows.some((w) => w.days === 'mon-sun' && w.from === '00:00' && w.to === '24:00');
}

// ── presentation verdict ───────────────────────────────────────────────────

export type Verdict =
  /** Every check the app can run locally passes. */
  | { status: 'ok' }
  /**
   * The app could not settle this using inputs it trusts — this device's clock
   * (steps 4, 11) or a timezone it had to assume (step 7).
   *
   * These are the CONTROLLER's to judge, not ours. A phone whose clock is wrong
   * after a blackout is precisely the situation this feature exists for, so a
   * local clock check that hard-refused would strand exactly the case the
   * ts-anchoring is designed to rescue. The UI surfaces a warning; redeemOverLan
   * proceeds anyway and anchors the proof on the controller's own clock the
   * moment the challenge reveals it.
   */
  | { status: 'warn'; code: string; message: string }
  /**
   * Every check this device can trust passes; the clock- and
   * timezone-dependent ones were not run and are the controller's to judge.
   * Only ever returned when `trustLocalClock` is false.
   */
  | { status: 'deferred' }
  /**
   * Deterministic: wrong key, wrong gate, wrong controller. Nothing about it is
   * uncertain and there is no override, because presenting it could only ever
   * be rejected.
   */
  | { status: 'refuse'; code: string; message: string };

export type VerdictInput = {
  grant: Grant;
  accessPointId: string;
  nowSec: number;
  /** The app key this install actually holds (base64url raw ed25519). */
  appPubkey: string | null;
  /** The controller's device_id, when known (from the hub's access point). */
  deviceId?: string | null;
  /**
   * When false, the three checks that depend on inputs this device cannot
   * trust — its own clock (steps 4, 11) and an assumed timezone (step 7) — are
   * SKIPPED rather than judged, and `status: 'deferred'` is returned if
   * everything else passes.
   *
   * The UI leaves this true: a resident looking at their grants wants this
   * device's honest opinion, including "this looks expired".
   *
   * redeemOverLan sets it false. Its whole reason for existing is a phone
   * whose clock is wrong after a blackout, and a local clock check that
   * hard-refused would strand exactly the case the ts-anchoring is built to
   * rescue. It re-judges the deferred checks against the controller's own
   * clock the moment the challenge reveals it.
   */
  trustLocalClock?: boolean;
};

/**
 * The app-side mirror of controller steps 4-7 plus the app-key binding that
 * decides step 9, in the same order the controller uses so the first failure
 * the resident is shown is the first failure the controller would report.
 *
 * Expiry is judged against `exp` itself, NOT `exp + 90`: the controller's
 * skew allowance exists to tolerate clock disagreement between two honest
 * parties, not to give the app 90 extra seconds of life to spend. Being
 * stricter than the verifier is always safe; being looser never is.
 */
export function evaluate(input: VerdictInput): Verdict {
  const { grant, accessPointId, nowSec, appPubkey, deviceId } = input;
  const trustClock = input.trustLocalClock !== false;

  // Step 9's precondition. A grant bound to some other keypair (restored
  // backup, reinstalled app, key regenerated) is unredeemable: the proof
  // would be signed by a key the grant doesn't name and the controller
  // answers `badsig`. This is the single most confusing denial to receive at
  // a gate, so it is caught first.
  if (!appPubkey) {
    return {
      status: 'refuse',
      code: 'no_app_key',
      message: 'This device has no emergency-access key. Set up emergency access again while online.',
    };
  }
  if (grant.app_pubkey !== appPubkey) {
    return {
      status: 'refuse',
      code: 'key_mismatch',
      message:
        'This grant was issued to a different key than this app now holds. The controller would reject it (badsig). Get a fresh grant while online.',
    };
  }
  // Step 4 — judged with this device's clock, so clock-dependent.
  if (trustClock && nowSec < grant.iat - CLOCK_SKEW_SECONDS) {
    return {
      status: 'refuse',
      code: 'not_yet_valid',
      message: 'This grant is not valid yet according to this device\'s clock.',
    };
  }
  if (nowSec > grant.exp) {
    return {
      status: 'refuse',
      code: 'expired',
      message: 'This grant has expired. Reconnect to your hub to get a new one.',
    };
  }
  // Step 5 — only when the hub told us which controller serves this access
  // point. Unknown device_id is not a refusal: the controller checks its own
  // id against the grant regardless, and guessing here could block a valid
  // open.
  if (deviceId && !grant.devices.includes(deviceId)) {
    return {
      status: 'refuse',
      code: 'wrong_device',
      message: 'This grant does not cover the controller at this gate.',
    };
  }
  // Step 6.
  if (!grant.access_points.includes(accessPointId)) {
    return {
      status: 'refuse',
      code: 'wrong_access_point',
      message: 'This grant does not cover this gate.',
    };
  }
  // Step 7 — clock- AND timezone-dependent (see inAnyWindow's note). A warn,
  // not a refusal: the controller judges windows in its own timezone, so a
  // UTC miss here is genuinely uncertain rather than wrong.
  if (!inAnyWindow(grant.windows, nowSec)) {
    return {
      status: 'warn',
      code: 'window',
      message:
        'Now is outside this grant\'s allowed hours in UTC. The controller judges this in its own timezone, so it may still open — or it may answer "window".',
    };
  }
  return { status: 'ok' };
}

// ── expiry / selection ─────────────────────────────────────────────────────

export function secondsUntilExpiry(grant: Grant, nowSec: number): number {
  return grant.exp - nowSec;
}

export function isExpired(grant: Grant, nowSec: number): boolean {
  return nowSec > grant.exp;
}

/**
 * Refresh policy. The contract's guarantee — "the app refreshes on every
 * online launch, so revocation converges within the TTL" — is only as real
 * as this: refresh whenever we can, and treat anything past half-life as
 * due. The upper bound on staleness stays the grant's own exp either way;
 * this only shortens it in practice.
 */
export function needsRefresh(grant: Grant, nowSec: number): boolean {
  if (isExpired(grant, nowSec)) return true;
  const life = grant.exp - grant.iat;
  return nowSec - grant.iat >= life / 2;
}

/**
 * Pick the grant to present for an access point: unexpired, covers the
 * access point, and among those the one that lasts longest. Returns null
 * when the resident holds nothing usable — which the caller must render as
 * an explicit "you hold no grant for this gate", never as a silent no-op.
 */
export function selectGrantForAccessPoint(
  grants: Grant[],
  accessPointId: string,
  nowSec: number,
): Grant | null {
  const usable = grants.filter(
    (g) => !isExpired(g, nowSec) && g.access_points.includes(accessPointId),
  );
  if (usable.length === 0) return null;
  return usable.reduce((best, g) => (g.exp > best.exp ? g : best));
}
