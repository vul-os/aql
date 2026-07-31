// Offline redemption, app side: the grant.open → grant.challenge →
// grant.proof → grant.result exchange of proto/grants.md, over the LAN
// transport (plain HTTP, POST /grant/open then POST /grant/proof).
//
// The message layer is transport-agnostic in the contract, and it is kept
// that way here: buildOpenBody/buildProof know nothing about HTTP, so a BLE
// transport (framing per proto/grants.md §BLE GATT) could drive the exact
// same functions the day this app can reach a radio. It cannot today — see
// the BLE note in EmergencyAccess.tsx, which says so in the UI rather than
// implying otherwise.
//
// TRANSPORT REALITY (measured, not assumed): the controller's LAN listener
// (controller/internal/lanserver) sets no CORS headers, because it is not a
// browser API — it answers Ed25519-signed messages. So a page running in an
// ordinary browser tab cannot complete this exchange: the preflight/origin
// check fails before the controller ever sees the bytes. Inside the Tauri
// shell, gatewayFetch routes through @tauri-apps/plugin-http (native reqwest,
// not subject to CORS, and the app's capability already allows http://**),
// which is why this works there and only there.

import { gatewayFetch } from '../hub';
import { jcs, utf8 } from './jcs';
import {
  CLOCK_SKEW_SECONDS,
  WIRE_VERSION,
  evaluate,
  type Grant,
  type Verdict,
} from './grant';

/** Matches lanserver.MaxBody / the BLE 8 KiB frame cap. */
export const MAX_BODY_BYTES = 8 * 1024;

/** The controller's default LAN listener port (`-lan :8737`). */
export const DEFAULT_LAN_PORT = 8737;

export type Challenge = {
  v: number;
  typ: 'grant.challenge';
  cnonce: string;
  iat: number;
  exp: number;
};

export type Proof = {
  v: number;
  typ: 'grant.proof';
  grant_id: string;
  cnonce: string;
  access_point: string;
  ts: number;
  sig: string;
};

export type SignFn = (message: Uint8Array) => Promise<string>;

export type RedeemOutcome =
  /** The controller opened the gate. */
  | { kind: 'opened' }
  /** The controller said no. `detail` is its cmd.ack reason, verbatim. */
  | { kind: 'denied'; detail: string; message: string }
  /** The app refused before sending anything. Nothing reached the gate. */
  | { kind: 'refused'; code: string; message: string }
  /** Never got a well-formed answer (unreachable, timeout, garbage). */
  | { kind: 'transport'; message: string };

/**
 * Every reason a GRANT REDEMPTION can be refused with, rendered for a person
 * standing at a gate.
 *
 * The vocabulary is `grant.result.detail` (proto/grants.md, mirrored in
 * controller/internal/wire), which overlaps but is not identical with the
 * cmd.ack details in commands.md: `window_too_long` and `replay` are envelope
 * checks on COMMANDS and no redemption can produce them, so they are
 * deliberately absent rather than missing.
 *
 * This comment used to claim "every reason the 11-step order can produce is
 * here" with nothing checking it, and it stopped being true the moment step 3a
 * added `revoked` — the refusal that matters most, shown as a raw token.
 * `denialVocabulary.test.ts` now reads the verification core and the two
 * transports and fails when a reason has no text.
 *
 * An unknown code is still shown raw rather than smoothed into a generic
 * "something went wrong", because a reason we don't recognise is information,
 * not noise — the guard makes that a fallback for future hubs, not for us.
 */
const DENIAL_TEXT: Record<string, string> = {
  stale_clock:
    'The controller has been offline too long (more than 14 days without a hub clock sync) and refuses all offline opens until it syncs again.',
  lockdown: 'This controller is in lockdown. It is refusing everyone, including you, until an operator lifts it.',
  badsig: 'The controller rejected a signature — either the grant was not signed by the hub key it pins, or the proof was not signed by the key the grant names.',
  not_yet_valid: 'The controller considers this not valid yet — most likely a clock disagreement.',
  expired: 'The controller considers this expired.',
  wrong_device: 'This grant does not list the controller at this gate.',
  wrong_access_point: 'This grant does not cover the gate you asked for.',
  window: 'Now is outside the hours this grant allows, in the controller\'s timezone.',
  wrong_grant: 'The proof did not match the grant that was presented.',
  cnonce_unknown: 'The controller did not recognise the challenge — it may have restarted mid-exchange. Try again.',
  cnonce_expired: 'The challenge expired before the proof arrived (30 seconds). Try again.',
  cnonce_replay: 'That challenge was already used. Challenges are single-use. Try again.',
  frame_too_large: 'The message was too large for the controller to accept.',
  // Not "expired" and not a mistake: someone withdrew this access deliberately.
  // Saying so plainly is the point — a person told "the controller refused:
  // revoked" will try again, and a person told this will not.
  revoked:
    'This grant was revoked. Someone with access to your hub withdrew it, and the gate is refusing it on purpose — trying again will not help.',
};

export function describeDenial(detail: string): string {
  return DENIAL_TEXT[detail] ?? `The controller refused: ${detail}.`;
}

/**
 * Build the grant.open body by splicing the grant's stored JSON text in
 * verbatim rather than re-serialising a parsed copy.
 *
 * JCS makes byte-preservation unnecessary in principle (the controller
 * re-canonicalises before verifying, so key order and whitespace cannot
 * matter). It matters in practice for one case: a field this app's types
 * don't know about. A future hub could add a member to the signed grant;
 * anything that rebuilds the object from a typed struct would silently drop
 * it and produce `badsig` at the gate. Passing the bytes through cannot.
 */
export function buildOpenBody(grantRaw: string, accessPoint: string): string {
  return `{"v":${WIRE_VERSION},"typ":"grant.open","grant":${grantRaw},"access_point":${JSON.stringify(
    accessPoint,
  )}}`;
}

/**
 * Build and sign a grant.proof over `JCS(proof minus sig)` — the same
 * discipline as every other signature in these contracts.
 *
 * Conformance: __tests__/redeem.test.ts reproduces proto/vectors/grants.json's
 * `grant-redeem-valid` proof with this function and byte-compares both the
 * canonical string AND the resulting signature (Ed25519 is deterministic, so
 * an exact match is meaningful).
 */
export async function buildProof(
  fields: { grantId: string; cnonce: string; accessPoint: string; ts: number },
  sign: SignFn,
): Promise<{ proof: Proof; canonical: string }> {
  const unsigned = {
    v: WIRE_VERSION,
    typ: 'grant.proof' as const,
    grant_id: fields.grantId,
    cnonce: fields.cnonce,
    access_point: fields.accessPoint,
    ts: fields.ts,
  };
  const canonical = jcs(unsigned);
  const sig = await sign(utf8(canonical));
  return { proof: { ...unsigned, sig }, canonical };
}

function parseChallenge(value: unknown): Challenge | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (c.v !== WIRE_VERSION || c.typ !== 'grant.challenge') return null;
  if (typeof c.cnonce !== 'string' || c.cnonce.length === 0) return null;
  if (!Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp)) return null;
  return c as Challenge;
}

/** A grant.result the controller can return in place of a challenge. */
function parseResult(value: unknown): { result: string; detail: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (r.typ !== 'grant.result' || typeof r.result !== 'string') return null;
  return { result: r.result, detail: typeof r.detail === 'string' ? r.detail : '' };
}

export type RedeemOptions = {
  /** Controller LAN base URL, e.g. "http://lintel-de71ce00.local:8737". */
  baseUrl: string;
  /** The grant's stored JSON text, byte-for-byte as the hub returned it. */
  grantRaw: string;
  /** The same grant, parsed (already validated by parseGrant). */
  grant: Grant;
  accessPointId: string;
  /** This install's app pubkey — must equal grant.app_pubkey (step 9). */
  appPubkey: string | null;
  /** The controller's device_id when the hub told us; else null. */
  deviceId?: string | null;
  sign: SignFn;
  /** Unix seconds. Injectable for tests. */
  now?: () => number;
  /** Injectable for tests; defaults to the Tauri-aware gatewayFetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * Set only after the resident has been shown a `warn` verdict and chose to
   * go ahead anyway. Never set it by default: a warning the caller silently
   * accepts is a warning the resident never saw.
   */
  acceptWarning?: boolean;
};

/**
 * Run the full LAN exchange, fail-closed at every step.
 *
 * The local pre-check runs first and can end this without a single byte
 * leaving the device — that is the point: an expired grant, a grant for
 * another gate, or a grant bound to a key this install no longer has are
 * refusals the resident is told about instead of watching a gate not move.
 */
export async function redeemOverLan(opts: RedeemOptions): Promise<RedeemOutcome> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const doFetch = opts.fetchImpl ?? gatewayFetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  // trustLocalClock: false — see the flag's doc comment. The deterministic
  // checks (key, gate, controller) still run and still refuse here; the
  // clock- and timezone-dependent ones are deferred to the controller, whose
  // clock the proof is anchored on below.
  const verdict: Verdict = evaluate({
    trustLocalClock: false,
    grant: opts.grant,
    accessPointId: opts.accessPointId,
    nowSec: now(),
    appPubkey: opts.appPubkey,
    deviceId: opts.deviceId ?? null,
  });
  // Only a DETERMINISTIC refusal stops us here — wrong key, wrong gate, wrong
  // controller. Nothing about those is uncertain, and presenting one could only
  // ever be rejected.
  //
  // A 'warn' does NOT stop us, and that is the whole point of this path. Warns
  // are the verdicts the app reached using inputs it cannot trust: this
  // device's clock and an assumed timezone. Hard-refusing on those would
  // strand exactly the case the ts-anchoring below exists to rescue — a phone
  // whose clock is a year out after a blackout, holding a perfectly valid
  // grant. The controller's own clock is authoritative and it re-judges every
  // one of these; the freshness guarantee is the single-use 30 s cnonce, not
  // this device's idea of the time.
  if (verdict.status === 'refuse') {
    return { kind: 'refused', code: verdict.code, message: verdict.message };
  }
  // A warn is uncertain, not wrong — the controller judges windows in its own
  // timezone. It still stops us unless the resident has explicitly accepted
  // the risk, so the default remains fail-closed.
  if (verdict.status === 'warn' && !opts.acceptWarning) {
    return { kind: 'refused', code: verdict.code, message: verdict.message };
  }

  const openBody = buildOpenBody(opts.grantRaw, opts.accessPointId);
  if (utf8(openBody).length > MAX_BODY_BYTES) {
    return {
      kind: 'refused',
      code: 'frame_too_large',
      message: 'This grant is too large for the controller to accept (over 8 KiB).',
    };
  }

  const base = opts.baseUrl.replace(/\/+$/, '');
  const post = async (path: string, body: string): Promise<unknown> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error('the controller answered with something that is not JSON');
      }
    } finally {
      clearTimeout(timer);
    }
  };

  let challengeBody: unknown;
  try {
    challengeBody = await post('/grant/open', openBody);
  } catch (err) {
    return {
      kind: 'transport',
      message: `Could not reach the controller at ${base}: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    };
  }

  // The LAN listener answers a malformed open with a grant.result, not a
  // challenge — surface its reason rather than "unexpected response".
  const earlyDenial = parseResult(challengeBody);
  if (earlyDenial) {
    return {
      kind: 'denied',
      detail: earlyDenial.detail,
      message: describeDenial(earlyDenial.detail),
    };
  }
  const challenge = parseChallenge(challengeBody);
  if (!challenge) {
    return { kind: 'transport', message: 'The controller did not return a valid challenge.' };
  }

  // proof.ts is derived from the CONTROLLER'S clock (challenge.iat), not
  // this device's, advanced by the real time we spend signing.
  //
  // Step 11 is |proof.ts − now| ≤ 90 against the controller's clock. Using
  // the phone's clock makes a phone whose time is wrong — a flat battery, a
  // long blackout, exactly the conditions this whole feature exists for —
  // unable to open a gate it is fully entitled to open. Anchoring on the
  // controller's own stated time costs nothing in security: freshness comes
  // from the single-use 30 s cnonce that the controller itself issued, which
  // ts cannot forge, extend or replay.
  const startedAt = Date.now();
  const localNow = now();
  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
  const ts = challenge.iat + elapsed();

  let proof: Proof;
  try {
    proof = (await buildProof(
      {
        grantId: opts.grant.grant_id,
        cnonce: challenge.cnonce,
        accessPoint: opts.accessPointId,
        ts,
      },
      opts.sign,
    )).proof;
  } catch (err) {
    return {
      kind: 'refused',
      code: 'sign_failed',
      message: `This device could not sign the proof: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    };
  }

  let resultBody: unknown;
  try {
    // Plain JSON, not canonical: the signature covers JCS(proof minus sig),
    // and the controller re-canonicalises the bytes it receives before
    // verifying (wire.VerifyRaw), so member order on the wire is irrelevant.
    resultBody = await post('/grant/proof', JSON.stringify(proof));
  } catch (err) {
    return {
      kind: 'transport',
      message: `Lost the controller mid-exchange: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    };
  }

  const result = parseResult(resultBody);
  if (!result) {
    return { kind: 'transport', message: 'The controller did not return a valid result.' };
  }
  if (result.result === 'opened') return { kind: 'opened' };

  let message = describeDenial(result.detail);
  // A clock disagreement big enough to matter is worth naming explicitly —
  // it is the one denial a resident can act on (fix the phone's clock).
  if (
    (result.detail === 'expired' || result.detail === 'not_yet_valid') &&
    Math.abs(localNow - challenge.iat) > CLOCK_SKEW_SECONDS
  ) {
    message += ` This device's clock is ${Math.abs(localNow - challenge.iat)}s away from the controller's.`;
  }
  return { kind: 'denied', detail: result.detail, message };
}
