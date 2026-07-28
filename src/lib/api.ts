import { KEYS, read as storageRead, remove as storageRemove, write as storageWrite } from './storageKeys';
// Lightweight API client for the Aql gateway.
// Handles base URL, bearer auth, JSON, and one-shot refresh-on-401.
//
// IMPORTANT — this targets the Go hub (hub/internal/httpapi), which is the
// product that actually ships: embedded into the hub binary as the portal,
// and reused by the Tauri desktop shell. See hub/README.md for the route map.
//
// Route shapes were originally inherited from a Cloudflare Workers backend
// that used to live in backend/. It was deleted — the Go hub is the only
// server — so anything naming it is history, not a file to open. What the hub
// serves is the contract; routeParity.test.ts pins this client to it.

import { gatewayFetch, getApiBaseUrl } from './hub';
import { reportHubReachability } from './hubReachability';

const ACCESS_KEY = KEYS.access;
const REFRESH_KEY = KEYS.refresh;

// The base URL is resolved per-request (not a build-time constant) so the
// desktop app can point at any gateway. Resolution order: the user's stored
// hub (KEYS.gatewayUrl), then VITE_API_BASE_URL, then localhost.
export { getApiBaseUrl } from './hub';

// Every route below lives under this prefix on the gateway (see
// hub/internal/httpapi/server.go's Router() — every mux.Handle(Func) call
// registers "METHOD /v1/..."). Centralized here — NOT repeated in each path
// string below — so a new endpoint can't be added without it; the
// alternative (baking /v1 into each path literal) is exactly the kind of
// per-call-site detail that's easy to forget and was part of how this
// portal drifted from the gateway in the first place. `getApiBaseUrl()`
// itself stays un-prefixed because a couple of gateway routes (/health, the
// controller-pairing endpoints) are intentionally NOT under /v1.
//
// hub/cmd/routegen and src/lib/__tests__/routeParity.test.ts both import
// this constant so the parity test can't drift from what apiFetch actually
// sends.
export const API_VERSION_PREFIX = '/v1';

export type ApiErrorBody = {
  error: string;
  detail?: string;
  /** Present on 429 responses (rate limit / quota); seconds until retry. */
  retry_after_s?: number;
};

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  /** Seconds until the request may be retried (429 only). */
  retryAfterS?: number;
  constructor(status: number, body: ApiErrorBody | any) {
    let code: string = 'error';
    let detail: string | undefined = undefined;

    if (typeof body === 'string') {
      code = body;
    } else if (body && typeof body === 'object') {
      // 1. Handle standard { error, detail } shape
      if (typeof body.error === 'string') {
        code = body.error;
        detail = typeof body.detail === 'string' ? body.detail : undefined;
      }
      // 2. Handle Hono/Zod error shape: { success: false, error: { issues: [...], name: 'ZodError' } }
      else if (body.error && typeof body.error === 'object' && Array.isArray(body.error.issues)) {
        code = 'validation_error';
        detail = body.error.issues[0]?.message;
      }
      // 3. Fallback for other objects
      else {
        code = body.error ? String(body.error) : 'error';
        detail = body.detail ? String(body.detail) : undefined;
      }
    }

    super(detail ? `${code}: ${detail}` : code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    if (body && typeof body === 'object' && typeof body.retry_after_s === 'number') {
      this.retryAfterS = body.retry_after_s;
    }
  }
}

/**
 * Sentinel ApiError code thrown by apiFetch when a 2xx response isn't JSON.
 * Every gateway endpoint below returns either JSON or 204 — a non-JSON 2xx
 * only happens when `path` doesn't match any registered gateway route: the
 * embedded portal's SPA fallback (hub/internal/portal) answers
 * everything unmatched with 200 + index.html rather than 404, so treating
 * "the request didn't throw" as success would silently render that HTML
 * page's bytes as if they were real API data. This is the guard against
 * that trap — every call site that hits a route the gateway genuinely
 * doesn't implement yet (see hub/README.md's porting map) should expect
 * this code and degrade to an explicit "not available" state, never an
 * infinite spinner or fabricated data.
 */
export const UNAVAILABLE_CODE = 'gateway_route_unavailable';

export function isUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.code === UNAVAILABLE_CODE;
}

/** Friendly, ready-to-render message for any error apiFetch can throw. */
export function friendlyApiError(err: unknown, fallback = 'Something went wrong.'): string {
  if (isUnavailable(err)) return "This isn't available on this hub yet.";
  if (err instanceof ApiError) return err.detail ?? err.code;
  if (err instanceof Error) return err.message;
  return fallback;
}

export type RateLimitDenial = {
  reason: 'rate_limited' | 'quota_exceeded';
  retryAfterS: number;
};

// ── device-engine error vocabulary ─────────────────────────────────────────
//
// hub/internal/httpapi/engine.go answers an actuation with one of a small
// set of codes, and two of them are NOT failures in the sense a toast implies.
// They get named narrowing helpers here so no call site has to remember the
// status/code pair, and so the difference can be unit-tested.

/**
 * 409 from POST /engine/execute: the verb sits above the confirm ceiling
 * (hazardous motion — blades, barriers under load) and the hub wants a second
 * deliberate act. This is a *step in the flow*, not an error: the correct UI is
 * a confirmation, then the same request again with `confirm: true`.
 */
export function isConfirmRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'confirm_required';
}

/**
 * 502 `indeterminate`: the driver could not establish whether the action
 * happened. Never render this as "failed" — a person told an open failed will
 * press it again, and the open may already have happened. See
 * devices.ErrIndeterminate.
 */
export function isIndeterminate(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'indeterminate';
}

/** 502 `unreachable`: the device could not be contacted; nothing happened. */
export function isUnreachable(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'unreachable';
}

/**
 * The code apiFetch raises when the request never reached a hub at all —
 * DNS failure, connection refused, Wi-Fi gone, the hub powered off.
 *
 * Status 0 because there was no HTTP response to take a status from. It is
 * deliberately NOT `unreachable`, which is the hub's own 502 about a DEVICE it
 * could not contact: that answer proves the hub is up and talking, which is
 * the opposite of this.
 */
export const HUB_UNREACHABLE_CODE = 'hub_unreachable';

/**
 * True when the request never reached the hub.
 *
 * Before this existed, a transport failure surfaced as a raw
 * `TypeError: Failed to fetch` — so every screen in the console rendered
 * "Failed to fetch" as its error message, which names a browser API rather
 * than telling a user their hub is off. It also meant nothing could
 * distinguish "your hub is unreachable" from "your hub said no", which is the
 * distinction offline emergency access exists to act on.
 */
export function isHubUnreachable(err: unknown): boolean {
  return err instanceof ApiError && err.code === HUB_UNREACHABLE_CODE;
}

/**
 * Narrow an unknown error to a 429 denial. Returns the denial reason and a
 * clean retry hint (seconds, ≥1) or null when the error is anything else.
 */
export function rateLimitInfo(err: unknown): RateLimitDenial | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  return {
    reason: err.code === 'quota_exceeded' ? 'quota_exceeded' : 'rate_limited',
    retryAfterS: Math.max(1, Math.ceil(err.retryAfterS ?? 30)),
  };
}

export const tokenStore = {
  get access(): string | null {
    return storageRead(ACCESS_KEY);
  },
  get refresh(): string | null {
    return storageRead(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    storageWrite(ACCESS_KEY, access);
    storageWrite(REFRESH_KEY, refresh);
  },
  clear() {
    storageRemove(ACCESS_KEY);
    storageRemove(REFRESH_KEY);
  },
};

type FetchInit = Omit<RequestInit, 'body'> & { body?: unknown };

let refreshing: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  const refresh = tokenStore.refresh;
  if (!refresh) return false;
  refreshing = (async () => {
    try {
      const res = await gatewayFetch(`${getApiBaseUrl()}${API_VERSION_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      const ct = res.headers.get('Content-Type') ?? '';
      if (!ct.includes('application/json')) {
        tokenStore.clear();
        return false;
      }
      const j = (await res.json().catch(() => null)) as RefreshResponse | null;
      if (!j?.tokens?.access_token || !j.tokens.refresh_token) {
        tokenStore.clear();
        return false;
      }
      tokenStore.set(j.tokens.access_token, j.tokens.refresh_token);
      return true;
    } catch {
      tokenStore.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function apiFetch<T>(path: string, init: FetchInit = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const url = path.startsWith('http') ? path : `${getApiBaseUrl()}${API_VERSION_PREFIX}${path}`;

  const doRequest = async (): Promise<Response> => {
    const h = new Headers(headers as HeadersInit | undefined);
    if (body !== undefined && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
    const access = tokenStore.access;
    if (access && !h.has('Authorization')) h.set('Authorization', `Bearer ${access}`);
    return await gatewayFetch(url, {
      ...rest,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  // A rejected fetch means nothing reached a hub — there is no response to
  // read a status from. Translating it here rather than at ~200 call sites is
  // what lets a screen tell "your hub is off" from "your hub said no", and
  // what stops "Failed to fetch" being shown to a user as an explanation.
  //
  // An abort is passed through untouched: a request the caller cancelled, or
  // one that hit its own timeout, says nothing about whether the hub is up.
  const attempt = async (): Promise<Response> => {
    try {
      const res = await doRequest();
      // A response of any status means the hub answered. Even a 500 proves it
      // is there, which is the only thing this observation is about.
      reportHubReachability('reachable');
      return res;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof Error && err.name === 'AbortError') throw err;
      reportHubReachability('unreachable');
      throw new ApiError(0, HUB_UNREACHABLE_CODE);
    }
  };

  let res = await attempt();
  if (res.status === 401 && tokenStore.refresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await attempt();
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('Content-Type') ?? '';
  const isJson = ct.includes('application/json');

  // SPA-fallback trap guard (see UNAVAILABLE_CODE's doc comment above): a
  // 2xx that isn't JSON is never a real answer from this API — it's the
  // embedded portal's catch-all. Fail loudly instead of returning HTML bytes
  // typed as T.
  if (res.ok && !isJson) {
    throw new ApiError(res.status, UNAVAILABLE_CODE);
  }

  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const err =
      isJson && payload && typeof payload === 'object' && 'error' in payload
        ? new ApiError(res.status, payload as ApiErrorBody)
        : new ApiError(res.status, typeof payload === 'string' ? payload : `http_${res.status}`);
    // Fall back to the Retry-After header when the body didn't carry the hint.
    if (err.retryAfterS === undefined) {
      const ra = res.headers.get('Retry-After');
      if (ra && /^\d+$/.test(ra)) err.retryAfterS = Number(ra);
    }
    throw err;
  }
  return payload as T;
}

// Typed surface ------------------------------------------------------------
//
// Gateway timestamps are Unix seconds (int64 / sql.NullInt64 on the Go
// side — see hub/internal/store), NOT ISO-8601 strings. The one
// exception is LocationLimits.usage.day_start, which the gateway explicitly
// formats via time.Format(time.RFC3339) — see handleLocationLimitsGet.
export type UnixSeconds = number;

// Tokens are nested under `tokens` (not flattened onto the response), per
// hub/internal/httpapi/auth.go's issueTokensCtx.
export type AuthTokens = {
  access_token: string;
  refresh_token: string;
};

export type LoginResponse = {
  user: { id: string; username: string; is_platform_admin: boolean };
  tokens: AuthTokens;
  token_type: 'Bearer';
};

export type RegisterResponse = {
  user: { id: string; username: string };
  account: { id: string; name: string };
  location: { id: string; name: string; slug: string | null };
  tokens: AuthTokens;
  token_type: 'Bearer';
};

export type RefreshResponse = {
  tokens: AuthTokens;
  token_type: 'Bearer';
};

// GET /v1/auth/me — the hub carries the user's display profile (display_name,
// avatar_url, avatar_source; see handleMe and profile.go) and nothing else
// from the richer shape the old Workers backend sent. There is still no
// Slack-identity or email data, because no /auth/me/slack route exists.
// Phone numbers ARE served now, but as their own resource — api.phonesList()
// — not folded into this response; see the phone-linking group below. Keep
// this type honest to what the hub actually returns.
//
// The profile fields are optional on the wire on purpose: handleMe treats the
// profile as best-effort, so a hub that cannot read the row still answers
// with a usable session rather than signing the user out over an avatar.
export type MeResponse = {
  user: {
    id: string;
    username: string;
    is_platform_admin: boolean;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_source?: 'user' | null;
  };
  accounts: Array<{
    id: string;
    name: string;
    role: string;
  }>;
};

// ── phone linking (docs/PHONE-LINKING.md) ───────────────────────────────────

/** One of the caller's own numbers (store.LinkedPhone). */
export type LinkedPhone = {
  id: string;
  phone_e164: string;
  /** Whether the ceremony has been completed for this row. An unverified
   *  number resolves no chat rail access — see channels.go's "Member access
   *  by verified phone" — so this is the one field a list of numbers cannot
   *  render as a footnote. */
  verified: boolean;
  is_primary: boolean;
  created_at: UnixSeconds;
};

/** The 201 body from POST /phones/me/link. */
export type PhoneLinkCode = {
  /** `LINK-XXXXXX` — namespaced so it can't be mistaken for a gate command by
   *  the chat parser, or vice versa. Shown once; the hub stores only a hash
   *  and cannot answer with the plaintext again. */
  code: string;
  phone_e164: string;
  expires_at: UnixSeconds;
  /** The exact sentence to show the user, composed hub-side so the wording
   *  can't drift from the channel that has to recognise it. Render this,
   *  never a client-composed paraphrase. */
  instruction: string;
};

// ── channel identity linking (hub/internal/httpapi/channellink.go) ────────
//
// The Telegram/Slack/Discord sibling of the phone-linking group above. Same
// shortage (channel_identities had no production writer either — see
// migrations/0020_channel_link_codes.sql), same shape of fix: mint a code
// here, spend it by sending it as a DM to the gate bot on that rail.
//
// The asymmetry that has to survive into the UI: a phone code names the
// number that may spend it, so the number carries a second factor the code
// doesn't have to. A channel code cannot name its target — nobody knows
// their own Telegram/Slack/Discord id in advance, and learning it is what
// the inbound message is for — so the code ALONE authorises the binding.
// Anyone who sees a channel code before it's used can send it from their own
// account and inherit this member's gate access. That is why the code is
// twice as long as the phone one (store.channelCodeLen) and why the console
// must show a sharing warning here that the phone screen has no reason to
// carry with the same weight.

/** channels.KindTelegram / KindSlack / KindDiscord — the only rails this
 *  ceremony offers. WhatsApp is deliberately absent: its identity is a
 *  VERIFIED PHONE NUMBER (profile_phone_numbers), handled by the phone-linking
 *  group above with its own, stronger ceremony — offering both here would
 *  open a second, weaker path to the same access. DMTAP is absent too,
 *  because httpapi.linkableChannels doesn't list it (it's a fail-closed
 *  scaffold; a linking ceremony would imply a rail that works). */
export type LinkableChannel = 'telegram' | 'slack' | 'discord';

/** One of the caller's own linked platform accounts (store.ChannelIdentity). */
export type LinkedChannelIdentity = {
  channel: LinkableChannel | (string & {});
  external_id: string;
  created_at: UnixSeconds;
};

/** The 201 body from POST /channels/me/link. */
export type ChannelLinkCode = {
  code: string;
  channel: LinkableChannel | (string & {});
  expires_at: UnixSeconds;
  /** The hub's own wording — composed in handleChannelLinkStart, not here, so
   *  it can't drift from what the rail actually recognises. It ALSO carries
   *  the sharing warning ("do not share it") that makes this code different
   *  from a phone code: render it verbatim, never a client-composed
   *  paraphrase, and never soften or drop the warning half of the sentence. */
  instruction: string;
};

export const api = {
  login: (body: { username: string; password: string }) =>
    apiFetch<LoginResponse>('/auth/login', { method: 'POST', body }),

  // account_type and invite_token are UI-only concerns the gateway's
  // registerReq (hub/internal/httpapi/auth.go) doesn't accept — and
  // because readJSON there calls json.Decoder.DisallowUnknownFields(),
  // sending them at all would 400 the whole request, not just get ignored.
  // phone_e164 is accepted by the parameter for call-site compatibility but
  // is similarly dropped: there is no /phones route on the gateway to attach
  // it to. Invite acceptance is a separate explicit api.inviteAccept() call
  // (see src/pages/Signup.tsx) — the gateway registers accounts+invites as
  // two independent steps, not one atomic register-and-join.
  register: (body: {
    username: string;
    password: string;
    display_name: string;
    phone_e164?: string;
    location_name?: string;
    country_code: string;
    account_type?: 'personal' | 'business';
    invite_token?: string;
  }) =>
    apiFetch<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: {
        username: body.username,
        password: body.password,
        display_name: body.display_name,
        location_name: body.location_name,
        country_code: body.country_code,
      },
    }),

  refresh: (refresh_token: string) =>
    apiFetch<RefreshResponse>('/auth/refresh', { method: 'POST', body: { refresh_token } }),

  logout: (refresh_token: string) =>
    apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST', body: { refresh_token } }),

  me: () => apiFetch<MeResponse>('/auth/me'),

  // Phone linking (hub/internal/httpapi/phones.go, docs/PHONE-LINKING.md).
  //
  // There is deliberately no phoneAdd() / slackUpdate() here, and no way to
  // hand the hub a phone number and have it come back verified in one call.
  // Linking was never a missing route — the hub has owned phone→member
  // mapping since migration 0002 — it was a missing CEREMONY: nothing proved
  // a number belongs to the person claiming it, and access resolution
  // requires verified_at IS NOT NULL. A self-service form that linked numbers
  // unverified granted nothing; one that linked them verified let anyone
  // claim a neighbour's number and receive their gate access (the exact bug
  // migration 0002's unique index scars over). Read PHONE-LINKING.md before
  // changing any of the three calls below.

  /**
   * Mint a short-lived link code for a number. Proves nothing about who
   * controls `phone_e164` — it can't, and doesn't need to: the code this
   * returns can only ever be spent BY that number, when it arrives over the
   * WhatsApp webhook (store.RedeemPhoneLinkCode). A code minted against
   * someone else's phone is useless to whoever minted it.
   *
   * Render `instruction` verbatim rather than composing the "send this code"
   * sentence client-side — it names the exact number to send from, and the
   * hub is the one authority for wording that has to match what the chat
   * rail actually recognises.
   *
   * Errors worth a specific message: invalid_phone (400, not E.164);
   * phone_verified_elsewhere (409 — the number is verified on another
   * profile; moving it is a support operation with a human in it, not
   * something this screen can resolve); too_many_link_codes (429 — the
   * per-user mint quota, deliberately not per-phone so an attacker can't
   * exhaust a victim's budget and lock them out of linking their own number).
   */
  phoneLinkStart: (phone_e164: string) =>
    apiFetch<PhoneLinkCode>('/phones/me/link', { method: 'POST', body: { phone_e164 } }),

  /**
   * The caller's own numbers, verified or not.
   *
   * Unverified rows are included on purpose (handlePhonesList's comment): a
   * number linked by accepting an invite is real and unverified, and hiding
   * it would leave the member with no way to understand why their chat
   * messages are ignored.
   */
  phonesList: () => apiFetch<{ phones: LinkedPhone[] }>('/phones/me/phones'),

  /**
   * Unlink one of the caller's own numbers — "the easy half, and it must not
   * be forgotten" per phones.go: a number you can add and never remove is
   * worse than one you cannot add.
   *
   * Ownership is enforced inside the DELETE on the hub, not by a prior read,
   * so another member's row is unreachable and answers 404 phone_not_found —
   * identical to an id that never existed at all. Never treat that 404 as
   * anything other than "already gone".
   */
  phoneUnlink: (id: string) =>
    apiFetch<void>(`/phones/me/phones/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Channel identity linking (hub/internal/httpapi/channellink.go). The
  // Telegram/Slack/Discord sibling of the phone-linking group above — read
  // the comment on LinkableChannel before offering a fourth option here.

  /**
   * Mint a short-lived code to send as a DM to the gate bot on `channel`.
   * Unlike phoneLinkStart, this proves nothing in advance about who will
   * send it — it can't, because the whole point of the message is to reveal
   * that sender's platform id. So the code alone is what binds the account,
   * which is why it must be treated as a live secret from the moment it's
   * shown (see ChannelLinkCode.instruction).
   *
   * Errors worth a specific message: unsupported_channel (400 — `channel`
   * isn't one of LinkableChannel); too_many_link_codes (429 — the per-user
   * mint quota).
   */
  channelLinkStart: (channel: LinkableChannel) =>
    apiFetch<ChannelLinkCode>('/channels/me/link', { method: 'POST', body: { channel } }),

  /** The caller's own linked platform accounts, across all rails. */
  channelIdentitiesList: () =>
    apiFetch<{ identities: LinkedChannelIdentity[] }>('/channels/me/identities'),

  /**
   * Unlink one of the caller's own channel identities.
   *
   * Ownership is enforced inside the DELETE on the hub (scoped by profile_id
   * in the query itself), so another member's row is unreachable and answers
   * 404 identity_not_found — identical to one that never existed. Treat that
   * 404 as "already gone", same as phoneUnlink's phone_not_found.
   */
  channelIdentityUnlink: (channel: LinkableChannel | (string & {}), externalId: string) =>
    apiFetch<void>(
      `/channels/me/identities/${encodeURIComponent(channel)}/${encodeURIComponent(externalId)}`,
      { method: 'DELETE' },
    ),

  // Served by the hub (hub/internal/httpapi/profile.go). avatar_url must be
  // https and is refused otherwise — the same rule the form's help text
  // states, kept by the server rather than only by the browser.
  profileUpdate: (body: { display_name?: string; avatar_url?: string | null }) =>
    apiFetch<{ profile: { id: string; display_name: string | null; avatar_url: string | null } }>(
      '/auth/me/profile',
      { method: 'PATCH', body },
    ),

  // All three ARE served (hub/internal/httpapi/authrecovery.go). This
  // comment previously said they were not, which stopped being true when
  // recovery landed.
  //
  // There is NO email in the ceremony, and there cannot be: the hub sends no
  // mail. Recovery identifies a person by username and the reset token reaches
  // them by whatever channel the install actually has — read authrecovery.go
  // before assuming a link arrives anywhere on its own. There is likewise no
  // "verify email" step, because there is no email address to verify.
  forgotPassword: (username: string) =>
    apiFetch<void>('/auth/forgot-password', { method: 'POST', body: { username } }),
  resetPassword: (token: string, new_password: string) =>
    apiFetch<void>('/auth/reset-password', { method: 'POST', body: { token, new_password } }),
  updatePassword: (current_password: string, new_password: string) =>
    apiFetch<void>('/auth/update-password', {
      method: 'POST',
      body: { current_password, new_password },
    }),

  accountUpdate: (accountId: string, body: { name?: string }) =>
    apiFetch<void>(`/accounts/${accountId}`, { method: 'PATCH', body }),

  accessPoints: (accountId?: string) => {
    const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    return apiFetch<{ access_points: AccessPointDetail[] }>(`/access-points${qs}`);
  },

  accessPoint: (id: string) => apiFetch<AccessPointDetail>(`/access-points/${id}`),

  accessPointCreate: (body: {
    location_id: string;
    name: string;
    kind: 'gate' | 'door' | 'barrier' | 'other';
    device_id?: string | null;
    lat?: number;
    long?: number;
  }) => apiFetch<AccessPointDetail>('/access-points', { method: 'POST', body }),

  // Served by the hub (hub/internal/httpapi/maintenance.go). Listing is open
  // to any member; logging is admin-only and refuses with "not_account_admin".
  //
  // next_due_movement_m is REFUSED with "movement_not_measured": nothing here
  // measures how far a gate leaf travels, so a distance threshold would never
  // be reached and the reminder would never fire. Schedule by date.
  maintenanceList: (id: string) =>
    apiFetch<{ events: MaintenanceEvent[] }>(`/access-points/${id}/maintenance`),
  maintenanceCreate: (id: string, body: MaintenanceCreateInput) =>
    apiFetch<MaintenanceEvent>(`/access-points/${id}/maintenance`, { method: 'POST', body }),

  grants: (q: { account_id?: string; phone_e164?: string; status?: 'active' | 'revoked' } = {}) => {
    const qs = new URLSearchParams();
    if (q.account_id) qs.set('account_id', q.account_id);
    if (q.phone_e164) qs.set('phone_e164', q.phone_e164);
    if (q.status) qs.set('status', q.status);
    const s = qs.toString();
    return apiFetch<{ grants: TemporaryAccessGrant[] }>(`/grants${s ? `?${s}` : ''}`);
  },

  grant: (id: string) => apiFetch<TemporaryAccessGrant>(`/grants/${id}`),

  grantCreate: (body: GrantCreateInput) =>
    apiFetch<TemporaryAccessGrant>('/grants', { method: 'POST', body }),

  grantRevoke: (id: string) =>
    apiFetch<TemporaryAccessGrant>(`/grants/${id}/revoke`, { method: 'POST' }),

  // Offline emergency access (proto/grants.md) — mints the signed,
  // offline-redeemable `typ:"grant"` object the app later proves directly to
  // a controller with no hub in the loop. NOT the same thing as the
  // /grants routes above (those are visitor temp-access records with an
  // entirely different shape and lifecycle).
  //
  // Issuance is all-or-nothing: the hub re-runs the exact membership /
  // account-suspended / user-disabled gates a live /open would, for EVERY
  // requested access point, and refuses the whole request rather than
  // silently narrowing the grant to a subset (see
  // hub/internal/httpapi/offline_grants.go). TTL is fixed at 7 days
  // hub-side and is not requestable. Error codes worth handling at the call
  // site: invalid_app_pubkey, invalid_grant, user_disabled (403),
  // account_suspended (403), access_point_not_found (404),
  // access_point_has_no_device (400).
  //
  // Typed as `unknown` deliberately: the response is a signed document whose
  // exact members are the hub's to define, and src/lib/offline/grant.ts
  // validates it structurally before anything is stored or presented.
  // Declaring a struct here would invite rebuilding the object from typed
  // fields and silently dropping a member the signature covers.
  offlineGrantIssue: (body: { app_pubkey: string; access_point_ids: string[] }) =>
    apiFetch<unknown>('/offline-grants', { method: 'POST', body }),

  // Locations — nested under /accounts/{id}/locations on the gateway, NOT
  // /locations/accounts/{id}/locations (the old Workers backend's shape).
  locationsList: (accountId: string) =>
    apiFetch<{ locations: LocationRow[] }>(`/accounts/${accountId}/locations`),

  locationCreate: (
    accountId: string,
    body: {
      type: 'house' | 'complex' | 'building' | 'other';
      name: string;
      slug?: string;
      parent_location_id?: string;
      address?: Record<string, unknown>;
      lat?: number;
      long?: number;
    },
  ) => apiFetch<{ id: string }>(`/accounts/${accountId}/locations`, { method: 'POST', body }),

  // Top-level: each location is its own account+location (no shared org).
  locationCreateNew: (body: {
    name: string;
    type?: 'house' | 'complex' | 'building' | 'other';
    country_code?: string;
    address?: Record<string, unknown>;
    lat?: number;
    long?: number;
  }) => apiFetch<{ id: string; account_id: string }>('/locations', { method: 'POST', body }),

  locationDelete: (id: string) =>
    apiFetch<{ deleted: string; account_dropped: boolean }>(
      `/locations/${id}`,
      { method: 'DELETE' },
    ),

  locationUpdate: (
    id: string,
    body: {
      name?: string;
      address?: Record<string, unknown>;
      lat?: number;
      long?: number;
      status?: string;
    },
  ) => apiFetch<void>(`/locations/${id}`, { method: 'PATCH', body }),

  // Abuse-protection quotas + today's usage (member-visible).
  locationLimits: (id: string) => apiFetch<LocationLimits>(`/locations/${id}/limits`),

  // Admin-only. null clears a cap (= unlimited); omitted fields are unchanged.
  locationLimitsUpdate: (id: string, body: LocationQuotaPatch) =>
    apiFetch<{ location_id: string; quotas: LocationQuotas }>(`/locations/${id}/limits`, {
      method: 'PATCH',
      body,
    }),

  // NOT IMPLEMENTED on the gateway (no /analytics route group ported yet).
  locationSummary: (id: string) =>
    apiFetch<LocationSummary>(`/analytics/locations/${id}/summary`),

  // Devices
  devicesList: (filter?: { location_id?: string; account_id?: string }) => {
    const params = new URLSearchParams();
    if (filter?.location_id) params.set('location_id', filter.location_id);
    if (filter?.account_id) params.set('account_id', filter.account_id);
    const qs = params.toString();
    return apiFetch<{ devices: DeviceRow[] }>(`/devices${qs ? `?${qs}` : ''}`);
  },

  deviceCreate: (body: { location_id: string; label?: string; claim_ttl_seconds?: number }) =>
    apiFetch<DeviceCreateResponse>('/devices', { method: 'POST', body }),

  // Device engine (hub/internal/httpapi/engine.go). Distinct from the
  // /devices routes above: those are the *controllers* paired to access points
  // (signed-command path, real today). These are the six other device kinds,
  // served by whatever drivers the hub operator configured.
  //
  // `engine: false` in the response is the DEFAULT — a hub with no device
  // config has no engine, which is not an error and not a failed fetch. Call
  // sites must say so rather than rendering an empty list. See
  // engineFleet() in src/components/device/engineState.ts, which narrows all
  // four outcomes (live / not configured / route absent / fetch failed).
  engineDevices: () => apiFetch<EngineDevicesResponse>('/engine/devices'),

  engineReadings: (key: string) =>
    apiFetch<EngineReadingsResponse>(`/engine/devices/${encodeURIComponent(key)}/readings`),

  // `confirm` is a deliberate second act, not a permission: the hub refuses a
  // hazardous-motion verb with 409 confirm_required until it is set, so the
  // honest flow is to send without it, catch that 409 (isConfirmRequired), ask
  // the person, and resend. Never send confirm: true speculatively.
  engineExecute: (key: string, body: { verb: string; args?: Record<string, number>; confirm?: boolean }) =>
    apiFetch<EngineExecuteResponse>(`/engine/devices/${encodeURIComponent(key)}/execute`, {
      method: 'POST',
      body: { verb: body.verb, args: body.args ?? {}, confirm: body.confirm ?? false },
    }),

  engineHealth: () => apiFetch<EngineHealthResponse>('/engine/health'),

  /**
   * Browse the LAN for controllers advertising themselves over mDNS.
   *
   * POST because it puts multicast on the network and takes seconds — the
   * wrong shape for something a browser might prefetch or retry. Admin-only:
   * the result is a map of what is on the network.
   *
   * Render `note` with the results, always. mDNS is unauthenticated by
   * construction, so a discovered controller is an address to check rather
   * than a device to trust, and a list of found devices is exactly where
   * someone reaches for a one-click "add".
   */
  discoverControllers: (accountId: string) =>
    apiFetch<{ controllers: DiscoveredController[]; note: string }>(
      `/accounts/${accountId}/discover/controllers`,
      { method: 'POST' },
    ),

  /**
   * The four KOTVA §26.3 fields per chat rail.
   *
   * Unauthenticated by design: the fields exist so someone can compare rails
   * BEFORE choosing one, and nothing in them is account-specific.
   *
   * Render `note` alongside the table, always. The four fields cannot express
   * the thing most likely to be misread — self-hosting removes the middleman
   * operator, not the platform. Meta reads every WhatsApp message whoever runs
   * the hub.
   */
  railDisclosures: () =>
    apiFetch<{ rails: RailDisclosure[]; note: string; spec: string }>('/rails/disclosure'),

  /**
   * Sign out of every session, everywhere.
   *
   * The hub has served this since sessions were built and nothing called it,
   * so a person who suspected their account was compromised had no way to cut
   * the other sessions off. That is a security control being unreachable, which
   * is worse than it being absent — the feature is documented as existing.
   */
  // `{ok: true}` and nothing else — handleLogoutAll writes exactly that. An
  // earlier version of this type also promised a `revoked` count the hub has
  // never sent, which would have rendered as "undefined sessions ended" for
  // whoever first tried to show it.
  logoutAll: () => apiFetch<{ ok: boolean }>('/auth/logout-all', {
    method: 'POST',
  }),

  /**
   * Verify the audit hash chain.
   *
   * site/docs and the Security page both describe this endpoint by name as the
   * way to check that no row was altered. Nothing called it, so the claim was
   * true about the hub and false about the product anyone could actually use.
   */
  adminAuditVerify: () => apiFetch<AuditVerifyResult>('/admin/audit/verify'),

  /**
   * The raw, controller-signed events this hub stored for one device
   * (hub/internal/httpapi/devices.go, proto/events.md).
   *
   * Distinct from the audit log, which is where the ACCESS-relevant ones are
   * rendered for everyone. This returns each event's envelope verbatim — the
   * exact bytes the controller signed — because a signature is only
   * re-checkable against those, and a stored signature nobody can retrieve is
   * decorative. Admin-only; a device the caller cannot see 404s rather than
   * 403s, so a guessed device id confirms nothing.
   */
  deviceEvents: (deviceId: string, limit?: number) =>
    apiFetch<{ events: ControllerEventRow[] }>(
      `/devices/${encodeURIComponent(deviceId)}/events` +
        (limit ? `?limit=${encodeURIComponent(String(limit))}` : ''),
    ),

  /** Every account this user belongs to. /auth/me carries a summary; this is
   *  the full list with the fields the switcher needs. */
  accountsList: () => apiFetch<{ accounts: AccountRow[] }>('/accounts'),

  accountCreate: (body: { name: string; country_code: string; location_name?: string }) =>
    apiFetch<AccountRow>('/accounts', { method: 'POST', body }),

  /** Fire one rule now. Safe for the same reason the scheduler is: RunNow goes
   *  through Fire, which re-resolves the action and re-checks it against the
   *  tier ceiling, so it cannot reach a verb the scheduler could not. */
  automationRunNow: (accountId: string, ruleId: string) =>
    apiFetch<AutomationRun>(
      `/accounts/${accountId}/automations/${encodeURIComponent(ruleId)}/run`,
      { method: 'POST' },
    ),

  /** One rule's run history, as opposed to the whole account's feed. */
  automationRuleRuns: (accountId: string, ruleId: string, limit?: number) =>
    apiFetch<AutomationRunsResponse>(
      `/accounts/${accountId}/automations/${encodeURIComponent(ruleId)}/runs` +
        (limit ? `?limit=${limit}` : ''),
    ),

  // ── surfaces the hub serves that the console had no client for ────────────
  //
  // All five below were built, tested and routed on the gateway, and api.ts
  // declared nothing for any of them — so no screen could reach a working
  // feature. routeParity cannot catch that shape: it checks that every call the
  // console makes targets a real route, never that a real route has a caller.
  // The gap only shows up by reading server.go against this file.

  // Scoped API tokens (hub/internal/httpapi/tokens.go). The secret is
  // returned EXACTLY ONCE, in the 201 — there is no read path that reveals it
  // again, by design. A caller that loses it revokes and mints another.
  apiTokens: (accountId: string) =>
    apiFetch<{ api_tokens: ApiTokenRow[] }>(`/accounts/${accountId}/api-tokens`),

  apiTokenCreate: (
    accountId: string,
    body: { name: string; scopes: ApiTokenScope[]; expires_in_days?: number; never_expires?: boolean },
  ) => apiFetch<ApiTokenCreated>(`/accounts/${accountId}/api-tokens`, { method: 'POST', body }),

  apiTokenRevoke: (accountId: string, tokenId: string) =>
    apiFetch<ApiTokenRow>(
      `/accounts/${accountId}/api-tokens/${encodeURIComponent(tokenId)}/revoke`,
      { method: 'POST' },
    ),

  // Two-factor (hub/internal/httpapi/twofactor.go). Enrolment is two
  // steps on purpose: enroll returns a secret and an otpauth URI, activate
  // proves the person can actually generate a code. A one-step enable would
  // lock out anyone whose authenticator clock is wrong.
  twoFactorStatus: () => apiFetch<TwoFactorStatus>('/auth/2fa'),

  twoFactorEnroll: () => apiFetch<TwoFactorEnrollment>('/auth/2fa/enroll', { method: 'POST' }),

  twoFactorEnrollCancel: () => apiFetch<void>('/auth/2fa/enroll', { method: 'DELETE' }),

  twoFactorActivate: (totp_code: string) =>
    apiFetch<TwoFactorActivated>('/auth/2fa/activate', { method: 'POST', body: { totp_code } }),

  twoFactorDisable: (body: { totp_code?: string; recovery_code?: string }) =>
    apiFetch<{ enrolled: boolean; active: boolean }>('/auth/2fa/disable', { method: 'POST', body }),

  // Outbound webhooks (hub/internal/httpapi/webhooks.go). Admin-only: a
  // webhook is a standing instruction to POST a signed record of every gate
  // opening to an address of the configurer's choosing.
  webhooks: (accountId: string) =>
    apiFetch<{ webhooks: WebhookRow[] }>(`/accounts/${accountId}/webhooks`),

  webhookCreate: (
    accountId: string,
    body: { name: string; url: string; events: string[]; allow_private?: boolean },
  ) => apiFetch<WebhookCreated>(`/accounts/${accountId}/webhooks`, { method: 'POST', body }),

  webhookDelete: (accountId: string, webhookId: string) =>
    apiFetch<void>(`/accounts/${accountId}/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    }),

  // Time-window rules (hub/internal/httpapi/timewindows.go) — when a given
  // member may open. Enforced inside the open path's choke point, not by the
  // automations engine.
  timeWindows: (accountId: string) =>
    apiFetch<{ time_windows: TimeWindowRule[] }>(`/accounts/${accountId}/time-windows`),

  timeWindowCreate: (
    accountId: string,
    body: {
      user_id: string;
      access_point_id?: string;
      location_id?: string;
      tz: string;
      windows: GrantWindow[];
      note?: string;
    },
  ) => apiFetch<TimeWindowRule>(`/accounts/${accountId}/time-windows`, { method: 'POST', body }),

  timeWindowDelete: (accountId: string, ruleId: string) =>
    apiFetch<void>(`/accounts/${accountId}/time-windows/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),

  // Geofence rules (hub/internal/httpapi/geofence.go).
  //
  // READ THAT FILE'S HEADER BEFORE BUILDING UI ON THIS. The position a fence
  // is tested against comes from the client and NOTHING verifies it. It is a
  // convenience and a mistake-preventer, not a security control, and no copy
  // this console renders may imply otherwise.
  geofences: (accountId: string) =>
    apiFetch<{ geofences: GeofenceRule[] }>(`/accounts/${accountId}/geofences`),

  geofenceCreate: (
    accountId: string,
    body: {
      access_point_id?: string;
      location_id?: string;
      lat?: number;
      long?: number;
      radius_m: number;
      slack_m?: number;
      on_missing_location?: 'deny' | 'allow' | string;
      note?: string;
    },
  ) => apiFetch<GeofenceRule>(`/accounts/${accountId}/geofences`, { method: 'POST', body }),

  geofenceDelete: (accountId: string, ruleId: string) =>
    apiFetch<void>(`/accounts/${accountId}/geofences/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),


  // Automations (hub/internal/httpapi/automations.go). Admin-only,
  // including reads: a rule states what the hardware does unattended, which is
  // closer to the audit trail than to a meter reading. A 503
  // automations_not_configured is the DEFAULT for a hub with no rule engine —
  // not an error, and not a failed fetch.
  automations: (accountId: string) =>
    apiFetch<AutomationsListResponse>(`/accounts/${accountId}/automations`),

  automationRuns: (accountId: string, limit?: number) =>
    apiFetch<AutomationRunsResponse>(
      `/accounts/${accountId}/automations/runs${limit ? `?limit=${limit}` : ''}`,
    ),

  /**
   * Create a rule.
   *
   * Every safety property lives in the ENGINE, not here — the tier ceiling, the
   * cooldown, the failure breaker. A rule whose action resolves above
   * `MaxActionTier` is refused on this path with the engine's own reason
   * string, and no request can raise that ceiling. Do not re-derive any of it
   * client-side; render what comes back.
   */
  automationCreate: (accountId: string, body: AutomationRuleInput) =>
    apiFetch<AutomationRule>(`/accounts/${accountId}/automations`, { method: 'POST', body }),

  /**
   * Replace a rule. A full replace, not a patch — a rule is a small object read
   * as a whole, and a partial update of a trigger or an action is how you end
   * up with a coherent-looking rule nobody meant to write.
   */
  automationUpdate: (accountId: string, ruleId: string, body: AutomationRuleInput) =>
    apiFetch<AutomationRule>(
      `/accounts/${accountId}/automations/${encodeURIComponent(ruleId)}`,
      { method: 'PUT', body },
    ),

  automationSetEnabled: (accountId: string, ruleId: string, enabled: boolean) =>
    apiFetch<AutomationRule>(
      `/accounts/${accountId}/automations/${encodeURIComponent(ruleId)}/enabled`,
      { method: 'POST', body: { enabled } },
    ),

  automationDelete: (accountId: string, ruleId: string) =>
    apiFetch<void>(`/accounts/${accountId}/automations/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),

  // Energy (hub/internal/httpapi/energy.go). Read-only by design: samples
  // come from a poller reading real meters, and an endpoint that injects them
  // would be a way to forge a bill.
  energyChannels: (accountId: string) =>
    apiFetch<{ channels: EnergyChannel[]; tz: string }>(
      `/accounts/${accountId}/energy/channels`,
    ),

  energySeries: (accountId: string, q: { grain?: string; from?: number; to?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.grain) p.set('grain', q.grain);
    if (q.from !== undefined) p.set('from', String(q.from));
    if (q.to !== undefined) p.set('to', String(q.to));
    const qs = p.toString();
    return apiFetch<EnergySeriesResponse>(
      `/accounts/${accountId}/energy/series${qs ? `?${qs}` : ''}`,
    );
  },

  energyMix: (accountId: string, q: { from?: number; to?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.from !== undefined) p.set('from', String(q.from));
    if (q.to !== undefined) p.set('to', String(q.to));
    const qs = p.toString();
    return apiFetch<EnergyMixResponse>(
      `/accounts/${accountId}/energy/mix${qs ? `?${qs}` : ''}`,
    );
  },

  // Members
  accountMembers: (accountId: string) =>
    apiFetch<{ members: AccountMemberRow[] }>(`/accounts/${accountId}/members`),

  // Revokes a membership. The hub keeps the row (status 'revoked') so the
  // roster still shows who was here and a later invite reactivates them —
  // but every gate reads `status = 'active'`, so their console access, their
  // API tokens and their phone's ability to open a gate all stop at once.
  //
  // Errors worth handling: 409 last_owner (would leave the account with no
  // administrator), 403 owner_removal_requires_owner (admins cannot evict
  // owners).
  memberRemove: (accountId: string, userId: string) =>
    apiFetch<void>(`/accounts/${accountId}/members/${userId}`, { method: 'DELETE' }),

  inviteCreate: (accountId: string, body: { username: string; role?: 'owner' | 'admin' | 'member' | 'viewer'; phone_e164: string }) =>
    apiFetch<{ id: string; username_sent: boolean; whatsapp_sent: boolean }>(
      `/accounts/${accountId}/invites`,
      { method: 'POST', body },
    ),

  inviteAccept: (token: string, phone_e164?: string) =>
    apiFetch<{ account_id: string; role: string }>(
      `/accounts/invites/${encodeURIComponent(token)}/accept`,
      { method: 'POST', body: { phone_e164 } },
    ),

  // Access ops
  accessOpen: (id: string, body: { lat?: number; long?: number; source?: 'web' | 'whatsapp' | 'telegram' | 'slack' | 'api' } = {}) =>
    apiFetch<{ ok: boolean; command: 'open'; delivery: string }>(`/access-points/${id}/open`, {
      method: 'POST',
      body: { source: 'web', ...body },
    }),

  accessClose: (id: string, body: { lat?: number; long?: number; source?: 'web' | 'whatsapp' | 'telegram' | 'slack' | 'api' } = {}) =>
    apiFetch<{ ok: boolean; command: 'close'; delivery: string }>(`/access-points/${id}/close`, {
      method: 'POST',
      body: { source: 'web', ...body },
    }),

  // NOT IMPLEMENTED on the gateway (no /analytics route group ported yet).
  accountSummary: (accountId: string) =>
    apiFetch<AccountSummary>(`/analytics/accounts/${accountId}/summary`),
  accountInsights: (accountId: string) =>
    apiFetch<AccountInsights>(`/analytics/accounts/${accountId}/insights`),

  // Instance admin (gateway operator) — everything under /admin is gated by
  // users.is_platform_admin except the one-time claim endpoints.
  adminClaimState: () => apiFetch<AdminClaimState>('/admin/claim'),

  adminClaim: (token: string) =>
    apiFetch<{ ok: boolean; user_id: string; is_platform_admin: boolean }>('/admin/claim', {
      method: 'POST',
      body: { token },
    }),

  adminOverview: () => apiFetch<AdminOverview>('/admin/overview'),

  adminAccounts: (q: AdminListQuery = {}) =>
    apiFetch<AdminAccountsResponse>(`/admin/accounts${adminListQs(q)}`),

  adminAccount: (id: string) => apiFetch<AdminAccountDetail>(`/admin/accounts/${id}`),

  adminAccountSetStatus: (id: string, status: 'active' | 'suspended') =>
    apiFetch<{ account: AdminAccountDetail['account'] }>(`/admin/accounts/${id}`, {
      method: 'PATCH',
      body: { status },
    }),

  adminUsers: (q: AdminListQuery = {}) =>
    apiFetch<AdminUsersResponse>(`/admin/users${adminListQs(q)}`),

  adminUserSetStatus: (id: string, status: 'active' | 'disabled') =>
    apiFetch<{ user: AdminUserSummary }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: { status },
    }),

  adminUserSetPlatformAdmin: (id: string, grant: boolean) =>
    apiFetch<{ user: AdminUserSummary }>(`/admin/users/${id}/platform-admin`, {
      method: 'POST',
      body: { grant },
    }),

  adminLimits: () => apiFetch<AdminLimitsResponse>('/admin/limits'),

  // Partial patch; null clears an override (falls back to env/default).
  adminLimitsUpdate: (patch: AdminLimitsPatch) =>
    apiFetch<AdminLimitsResponse>('/admin/limits', { method: 'PATCH', body: patch }),

  adminAudit: (q: { limit?: number; offset?: number; kind?: AdminAuditKind } = {}) => {
    const qs = new URLSearchParams();
    if (q.limit !== undefined) qs.set('limit', String(q.limit));
    if (q.offset !== undefined) qs.set('offset', String(q.offset));
    if (q.kind) qs.set('kind', q.kind);
    const s = qs.toString();
    return apiFetch<AdminAuditResponse>(`/admin/audit${s ? `?${s}` : ''}`);
  },

  adminAuditActions: (q: { limit?: number; offset?: number } = {}) =>
    apiFetch<AdminAuditActionsResponse>(`/admin/audit/actions${adminListQs(q)}`),
};

function adminListQs(q: AdminListQuery): string {
  const qs = new URLSearchParams();
  if (q.query) qs.set('query', q.query);
  if (q.limit !== undefined) qs.set('limit', String(q.limit));
  if (q.offset !== undefined) qs.set('offset', String(q.offset));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export type LocationRow = {
  id: string;
  parent_location_id: string | null;
  type: 'house' | 'complex' | 'building' | 'other';
  name: string;
  slug: string | null;
  status: string;
  address: { city?: string; [k: string]: unknown } | null;
  access_point_count: number;
  member_count: number;
  last_opened_at: UnixSeconds | null;
};

export type LocationQuotas = {
  max_opens_per_member_per_day: number | null;
  max_opens_per_location_per_day: number | null;
};

export type LocationQuotaPatch = {
  max_opens_per_member_per_day?: number | null;
  max_opens_per_location_per_day?: number | null;
};

export type LocationLimits = {
  location_id: string;
  quotas: LocationQuotas;
  usage: {
    // Formatted server-side via time.RFC3339 (handleLocationLimitsGet) — an
    // actual ISO string, unlike the UnixSeconds fields elsewhere in this file.
    day_start: string;
    location_opens_today: number;
    my_opens_today: number;
    members: Array<{
      user_id: string | null;
      username: string | null;
      opens_today: number;
    }>;
  };
};

export type LocationSummary = {
  location_id: string;
  opens: number;
  closes: number;
  total: number;
  today: {
    day_start: string;
    opens: number;
    max_opens_per_member_per_day: number | null;
    max_opens_per_location_per_day: number | null;
  };
};

export type DeviceRow = {
  id: string;
  location_id: string;
  label: string | null;
  status: 'unpaired' | 'active' | 'offline' | string;
  paired_at: UnixSeconds | null;
  last_seen_at: UnixSeconds | null;
  claim_expires_at: UnixSeconds | null;
  created_at: UnixSeconds;
};

export type DeviceCreateResponse = {
  id: string;
  location_id: string;
  label: string | null;
  status: string;
  claim_token: string;
  claim_expires_at: UnixSeconds;
};

// ── device engine ───────────────────────────────────────────────────────────

/**
 * What the engine currently believes about a device, reported VERBATIM by the
 * gateway (engineDeviceJSON in engine.go deliberately does not normalise it).
 *
 * The empty string is load-bearing: it is devices.AvailUnknown — "the engine
 * has not heard from this device since it started". That is NOT offline, and
 * rendering the two the same makes a device that has never reported look like
 * one that is known down. Typed as a union with a `string` escape so a value a
 * newer gateway adds doesn't fail to parse — unrecognised values are rendered
 * as unknown, never as online.
 */
export type EngineAvailability = '' | 'online' | 'offline' | 'degraded' | (string & {});

/** One of devices.Kind (model.go). Lower-case on the wire. */
export type EngineKind =
  | 'camera'
  | 'lighting'
  | 'robot'
  | 'climate'
  | 'energy'
  | 'sensor'
  | 'access'
  | (string & {});

export type EngineDevice = {
  /** Globally unique `driver:deviceID`. The id every engine route speaks. */
  key: string;
  driver: string;
  kind: EngineKind;
  name: string;
  zone: string;
  /** Catalogue capability ids (devices/capability.go), e.g. "light.dimmable". */
  capabilities: string[];
  availability: EngineAvailability;
  /** Short human-readable state for a list row. Presentational; never parsed. */
  summary: string;
  last_seen: UnixSeconds;
};

export type EngineDevicesResponse = {
  devices: EngineDevice[];
  /** false = no device engine is configured on this hub. Default, not an error. */
  engine: boolean;
};

/** `value` and `text` are mutually exclusive — the gateway sends exactly one. */
export type EngineReading = {
  metric: string;
  at: UnixSeconds;
  value?: number;
  text?: string;
};

export type EngineReadingsResponse = { readings: EngineReading[] };

export type EngineExecuteResponse = {
  ok: boolean;
  /** The tier the hub resolved the verb at, e.g. "reversible". */
  tier: string;
};

export type EngineHealthResponse = {
  engine: boolean;
  drivers: Record<string, { ok: boolean; detail: string; since: UnixSeconds }>;
};

export type AccountMemberRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: string;
  username: string;
  display_name: string | null;
  /**
   * Live temporary grants this member handed out. Removing them does NOT
   * revoke these — a grant is matched on the visitor's phone and never looks
   * at who issued it — so this is what the removal confirmation warns about.
   */
  active_grants_issued: number;
};

export type AccountSummary = {
  account_id: string;
  opens_today: number;
  opens_yesterday: number;
  location_count: number;
  member_count: number;
  recent_activity: Array<{
    id: string;
    ts: UnixSeconds;
    command: string;
    success: boolean;
    source: string | null;
    access_point_name: string | null;
    location_name: string | null;
    actor_username: string | null;
  }>;
};

export type AccountInsights = {
  account_id: string;
  days: Array<{ day: string; opens: number; denied: number }>;
  breakdown: Array<{
    access_point_id: string;
    access_point_name: string | null;
    location_name: string | null;
    opens: number;
  }>;
  totals: {
    opens_7d: number;
    denied_7d: number;
    closes_7d: number;
    opens_prev_7d: number;
  };
  members: {
    member_count: number;
    active_members_7d: number;
  };
};

export type TemporaryAccessGrant = {
  id: string;
  account_id: string;
  granted_by_user_id: string | null;
  phone_e164: string;
  visitor_name: string | null;
  starts_at: UnixSeconds;
  ends_at: UnixSeconds;
  max_uses: number | null;
  uses_count: number;
  status: 'active' | 'revoked';
  effective_status: 'pending' | 'active' | 'expired' | 'exhausted' | 'revoked';
  revoked_at: UnixSeconds | null;
  notes: string | null;
  last_used_at: UnixSeconds | null;
  access_point_ids: string[];
  created_at: UnixSeconds;
};

export type GrantCreateInput = {
  phone_e164: string;
  visitor_name?: string;
  starts_at?: string;
  ends_at: string;
  max_uses?: number;
  access_point_ids: string[];
  notes?: string;
};

export type AccessPointDetail = {
  id: string;
  location_id: string;
  name: string;
  kind: string;
  device_id: string | null;
  status: string;
  meter: {
    movement_m: number;
    total_opens: number;
    total_closes: number;
    last_op_at: UnixSeconds | null;
  };
  maintenance: {
    last_serviced_at: UnixSeconds | null;
    last_service_movement_m: number | null;
    next_due_movement_m: number | null;
    next_due_at: UnixSeconds | null;
    due_now: boolean;
    movement_remaining_m: number | null;
    pct_used: number | null;
  };
};

export type MaintenanceEvent = {
  id: string;
  access_point_id: string;
  kind: 'inspection' | 'service' | 'repair' | 'replacement';
  performed_at: UnixSeconds;
  performed_by: string | null;
  technician_name: string | null;
  notes: string | null;
  parts: unknown;
  cost_zar_cents: number | null;
  movement_m_at_event: number | null;
  next_due_movement_m: number | null;
  next_due_at: UnixSeconds | null;
  created_at: UnixSeconds;
};

// ── Instance admin (gateway operator) ───────────────────────────────────────

export type AdminListQuery = { query?: string; limit?: number; offset?: number };

export type AdminClaimState = {
  /** true once any platform admin exists (or a claim was ever redeemed). */
  claimed: boolean;
  /** true when ADMIN_CLAIM_TOKEN is configured and the claim is still open. */
  claimable: boolean;
};

export type AdminOverview = {
  totals: {
    users: number;
    accounts: number;
    locations: number;
    devices: number;
    access_points: number;
  };
  opens: { today: number; last_7d: number };
  denials_today: {
    total: number;
    rate_limited: number;
    quota_exceeded: number;
    account_suspended: number;
    other: number;
  };
  recent_signups: Array<{
    id: string;
    username: string;
    display_name: string | null;
    status: string;
    is_platform_admin: boolean;
    created_at: UnixSeconds;
  }>;
};

export type AdminAccountRow = {
  id: string;
  name: string;
  status: 'active' | 'suspended' | string;
  country_code: string;
  created_at: UnixSeconds;
  member_count: number;
  location_count: number;
  opens_7d: number;
};

export type AdminAccountsResponse = {
  accounts: AdminAccountRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminAccessLogEntry = {
  id: string;
  ts: UnixSeconds;
  command: string | null;
  source: string | null;
  success: boolean;
  error: string | null;
  account_id: string | null;
  account_name: string | null;
  location_id: string | null;
  location_name: string | null;
  access_point_id: string | null;
  access_point_name: string | null;
  user_id: string | null;
  user_username: string | null;
};

export type AdminAccountDetail = {
  account: {
    id: string;
    name: string;
    status: 'active' | 'suspended' | string;
    country_code: string;
    created_at: UnixSeconds;
  };
  members: Array<{
    user_id: string;
    username: string;
    display_name: string | null;
    role: string;
    status: string;
  }>;
  locations: Array<{
    id: string;
    name: string;
    type: string;
    slug: string | null;
    status: string;
  }>;
  recent_access_logs: AdminAccessLogEntry[];
};

export type AdminUserRow = {
  id: string;
  username: string;
  status: 'active' | 'disabled' | string;
  is_platform_admin: boolean;
  created_at: UnixSeconds;
  display_name: string | null;
  accounts: Array<{ account_id: string; name: string; role: string }>;
  last_access_at: UnixSeconds | null;
};

export type AdminUsersResponse = {
  users: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
};

/** Shape returned by user-mutating admin endpoints. */
export type AdminUserSummary = {
  id: string;
  username: string;
  status: string;
  is_platform_admin: boolean;
};

export type AdminLimitField =
  | 'open_cooldown_s'
  | 'opens_per_hour'
  | 'chat_msgs_per_min'
  | 'account_opens_per_hour';

export type AdminLimitValues = Record<AdminLimitField, number>;

export type AdminLimitsResponse = {
  defaults: AdminLimitValues;
  env: AdminLimitValues;
  overrides: Record<AdminLimitField, number | null>;
  effective: AdminLimitValues;
};

// Setting opens_per_hour / account_opens_per_hour to 0 is an instance-wide
// kill switch — the backend rejects it (400 kill_switch_confirmation_required)
// unless confirm_kill_switch: true accompanies the patch.
export type AdminLimitsPatch = Partial<Record<AdminLimitField, number | null>> & {
  confirm_kill_switch?: boolean;
};

export type AdminAuditKind =
  | 'all'
  | 'denied'
  | 'success'
  | 'open'
  | 'close'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'account_suspended';

export type AdminAuditResponse = {
  entries: AdminAccessLogEntry[];
  total: number;
  limit: number;
  offset: number;
  kind: AdminAuditKind;
};

export type AdminAuditActionRow = {
  id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  allowed: boolean;
  detail: unknown;
  created_at: UnixSeconds;
};

export type AdminAuditActionsResponse = {
  actions: AdminAuditActionRow[];
  total: number;
  limit: number;
  offset: number;
};

export type MaintenanceCreateInput = {
  kind: 'inspection' | 'service' | 'repair' | 'replacement';
  performed_at?: string;
  technician_name?: string;
  notes?: string;
  parts?: Array<{ name: string; qty?: number; cost_zar_cents?: number }>;
  cost_zar_cents?: number;
  // next_due_at and next_due_in_days are two ways to say the same thing and
  // the hub refuses both together rather than picking one. There is
  // deliberately no next_due_movement_m — see maintenanceList's comment.
  next_due_at?: string;
  next_due_in_days?: number;
};

// ── automations ─────────────────────────────────────────────────────────────
//
// hub/internal/httpapi/automations.go. The layer that matters is the
// ENGINE's, not this one: every safety property — the tier ceiling, the
// cooldown, the failure breaker — lives in hub/internal/automations and is
// enforced identically for the scheduler. The console reads results and shows
// refusals; it does not re-derive any of it.

/** Trigger kinds the hub understands. A closed set; an unknown one is a hub
 *  newer than this console, not a rule to guess at. */
export type AutomationTriggerKind = 'schedule' | 'threshold' | 'event' | string;

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    kind: AutomationTriggerKind;
    schedule?: { minute_of_day: number; days: number; tz?: string };
    threshold?: { device_key: string; metric: string; op: string; value: number };
    event?: { device_key: string; name: string };
  };
  conditions: Array<{ device_key: string; metric: string; op: string; value: number }>;
  action: {
    device_key?: string;
    zone?: string;
    verb: string;
    args?: Record<string, number>;
  };
  min_interval_seconds: number;
  created_at: UnixSeconds;
  updated_at: UnixSeconds;

  /** The action's resolved safety tier, and the ceiling it was checked
   *  against. BOTH are sent, because one without the other is not
   *  interpretable — and hard-coding the ceiling in this console is exactly
   *  how the two would drift. Never re-derive it here. */
  action_tier: string;
  max_action_tier: string;

  created_by: string;
  created_by_snapshot: string;

  last_outcome: string;
  last_fired_at: UnixSeconds;
  last_occurrence_at: UnixSeconds;
  consecutive_failures: number;

  /** Present only when the failure breaker tripped, and then always with the
   *  reason. A rule that went quiet without one leaves an admin nothing to
   *  act on. */
  disabled_at?: UnixSeconds;
  disabled_reason?: string;
};

export type AutomationRun = {
  id: string;
  rule_id: string;
  rule_name: string;
  cause: string;
  occurrence_at: UnixSeconds;
  outcome: string;
  reason: string;
  device_key: string;
  verb: string;
  tier: string;
  target_count: number;
  /** Whether the run reached the access audit trail. Without this, an
   *  unaudited run is indistinguishable from a missing audit entry. */
  audited: boolean;
  started_at: UnixSeconds;
  finished_at: UnixSeconds;
};

export type AutomationsListResponse = {
  rules: AutomationRule[];
  max_action_tier: string;
  /** Whether anything will actually FIRE these rules. Rules can be written
   *  with the scheduler off, and a list that silently never runs looks
   *  identical to one that works — so this must be rendered, not ignored. */
  scheduler_running: boolean;
};

export type AutomationRunsResponse = { runs: AutomationRun[]; limit: number };

// ── energy ──────────────────────────────────────────────────────────────────
//
// hub/internal/httpapi/energy.go. The engine goes to real trouble never to
// state a number it cannot support, and the honesty fields below are how that
// survives the wire. A renderer that drops them turns a half-measured window
// into a confident figure.

export type EnergyChannel = {
  device_key: string;
  metric: string;
  kind: string;
  source: string;
  flow: string;
  label: string;
  scale: number;
  counter_max: number;
  max_kw: number;
  interval_seconds: number;
  gap_tolerance_seconds: number;
  enabled: boolean;
  created_at: UnixSeconds;
  updated_at: UnixSeconds;
};

export type EnergyBucket = {
  device_key: string;
  metric: string;
  grain: string;
  tz: string;
  start: UnixSeconds;
  end: UnixSeconds;

  /** NULLABLE, and the null is load-bearing: an hour nobody measured and an
   *  hour that used no electricity are different facts. Rendering null as 0
   *  draws a confident low bar over an outage. */
  kwh: number | null;
  /** How much of kwh was interpolated across a gap. kwh minus this is the
   *  measured floor. */
  estimated_kwh: number;
  coverage_seconds: number;
  expected_seconds: number;

  sample_count: number;
  delta_count: number;
  reset_count: number;
  /** The single field a renderer may branch on: complete | partial |
   *  estimated | empty. */
  quality: string;
  min_kw: number | null;
  max_kw: number | null;
  mean_kw: number | null;
};

export type EnergySeriesResponse = {
  buckets: EnergyBucket[];
  grain: string;
  from: UnixSeconds;
  to: UnixSeconds;
  tz: string;
  /** Rollups the background worker still owes. Non-zero means the tail of the
   *  series may still move — the difference between "usage dropped" and "not
   *  summed yet". */
  pending_rollups: number;
};

export type EnergyMixResponse = {
  from: UnixSeconds;
  to: UnixSeconds;
  tz: string;
  totals: Array<{
    source: string;
    flow: string;
    kwh: number;
    estimated_kwh: number;
    coverage_seconds: number;
    expected_seconds: number;
    reset_count: number;
    channels: number;
  }>;
  supply_kwh: number;
  sink_kwh: number;
  net_consumption_kwh: number;
  unattributed_kwh: number;
  sub_meter_kwh: number;

  /** The two flags to check BEFORE drawing a pie chart. complete=false means
   *  some channel did not cover the window, so the slices do not add up to the
   *  truth; attributed=false means there is not enough source information to
   *  say where the energy came from. */
  complete: boolean;
  attributed: boolean;
  estimated_kwh: number;
  coverage_seconds: number;
  expected_seconds: number;
  reset_count: number;
  channels: number;
};

// ── scoped API tokens ───────────────────────────────────────────────────────

/** The closed scope set (store.APITokenScopes). An unknown scope is a hard
 *  400, never a silent drop — a caller who asked for a capability this build
 *  does not implement must not walk away believing they got it. */
export type ApiTokenScope = 'access:read' | 'access:open';

export type ApiTokenRow = {
  id: string;
  account_id: string;
  user_id: string;
  username: string;
  name: string;
  scopes: ApiTokenScope[];
  never_expires: boolean;
  created_at: UnixSeconds;
  expires_at: UnixSeconds | null;
  revoked_at: UnixSeconds | null;
};

/** The 201 body. `token` is present HERE AND NOWHERE ELSE — there is no read
 *  path that returns it again. A UI that does not show it immediately has
 *  thrown it away. */
export type ApiTokenCreated = ApiTokenRow & { token: string; token_note?: string };

// ── two-factor ──────────────────────────────────────────────────────────────

export type TwoFactorStatus = {
  enrolled: boolean;
  active: boolean;
  pending: boolean;
  algorithm?: string;
  digits?: number;
  period_seconds?: number;
  activated_at?: UnixSeconds;
  created_at?: UnixSeconds;
  recovery_codes_remaining?: number;
};

/** Enrolment step one. Both the secret and the recovery codes are shown ONCE.
 *  The flags say so explicitly rather than leaving it to a comment nobody
 *  reads. */
export type TwoFactorEnrollment = {
  secret: string;
  otpauth_uri: string;
  algorithm: string;
  digits: number;
  period_seconds: number;
  secret_shown_once: boolean;
};

export type TwoFactorActivated = {
  active: boolean;
  recovery_codes: string[];
  recovery_codes_shown_once: boolean;
};

// ── outbound webhooks ───────────────────────────────────────────────────────

export type WebhookRow = {
  id: string;
  name: string;
  url: string;
  events: string[];
  allow_private: boolean;
  enabled: boolean;
  created_at: UnixSeconds;
  /** Present only when the dispatcher retired the endpoint, and then always
   *  with the reason — an endpoint that went quiet without one leaves an
   *  operator nothing to act on. */
  disabled_at?: UnixSeconds;
  disabled_reason?: string;
};

/** The 201 body. `secret` appears once and can never be retrieved again. */
export type WebhookCreated = WebhookRow & { secret: string; secret_note?: string };

// ── time-window and geofence rules ──────────────────────────────────────────

/** One weekly window: `days` is a compact weekday string, `from`/`to` are
 *  local wall-clock times. Shared with offline grants (keys.GrantWindow), so
 *  an online window and a window inside a grant mean the same thing. */
export type GrantWindow = { days: string; from: string; to: string };

export type TimeWindowRule = {
  id: string;
  account_id: string;
  user_id: string;
  access_point_id: string | null;
  location_id: string | null;
  tz: string;
  windows: GrantWindow[];
  note: string;
  created_at: UnixSeconds;
};

export type GeofenceRule = {
  id: string;
  account_id: string;
  access_point_id: string | null;
  location_id: string | null;
  lat: number | null;
  long: number | null;
  radius_m: number;
  slack_m: number;
  /** What happens when the client sends no position at all. The hub's default
   *  is to deny; a UI offering "allow" must be explicit that it widens who
   *  gets in. */
  on_missing_location: string;
};

/**
 * Result of the audit-chain verification endpoint.
 *
 * Per-TABLE, not one flat count: access_logs and admin_audit_log are separate
 * hash chains and either can break independently. A UI that collapses them into
 * a single ok/not-ok loses which trail was altered, which is the first thing
 * anyone investigating needs.
 *
 * A break says the chain WAS altered. It does not say by whom, and it is not a
 * preventive control — an attacker who edits a row and recomputes every hash
 * after it can still rewrite history. site/docs says so; no copy here may
 * imply more.
 */
/** One controller-signed event as stored by the hub (migration 0019). */
export type ControllerEventRow = {
  event_id: string;
  kind: string;
  ts: UnixSeconds;
  data: Record<string, unknown>;
  sig: string;
  /** The exact signed bytes, kept verbatim so the signature stays verifiable. */
  envelope: string;
};

export type AuditVerifyResult = {
  ok: boolean;
  chains: Array<{
    table: string;
    rows_checked: number;
    ok: boolean;
    broken_at?: { index: number; row_id: string; reason: string };
  }>;
};

export type AccountRow = {
  id: string;
  name: string;
  country_code: string;
  role?: string;
  created_at: UnixSeconds;
};

/** One rail's KOTVA §26.3 declaration. */
export type RailDisclosure = {
  rail: string;
  platform: string;
  /** Field 2. `webhook` needs a reachable HTTPS endpoint; the rest do not. */
  inbound_transport: 'hardware-local' | 'outbound-persistent' | 'webhook' | 'listener' | string;
  inbound: RailDirection;
  outbound: RailDirection;
  self_hostable: boolean;
  self_host_note: string;
  /** Derived by the hub from inbound_transport — never re-derive it here, or
   *  the console can disagree with the declaration it is rendering. */
  runs_behind_cgnat: boolean;
  can_initiate: boolean;
};

export type RailDirection = {
  /** Field 1. `inbound-triggered` means this rail cannot cold-contact anyone. */
  initiation: 'freely-initiating' | 'inbound-triggered' | string;
  /** Field 3, per DIRECTION — WhatsApp differs each way. */
  price: 'metered' | 'flat' | 'free' | string;
  /** Field 4: who sees plaintext. Never "nobody" on any of these rails. */
  exposure: string;
  note?: string;
};

/** A controller that answered an mDNS browse. Not paired, and not trusted. */
export type DiscoveredController = {
  instance: string;
  /** From the TXT record — which controller answered. Empty is a reason to be
   *  suspicious: a real controller always advertises one. */
  device_id: string;
  /** host:port for its LAN grant listener. */
  addr: string;
  proto: string;
  /** TXT keys this hub did not recognise, carried through so a newer
   *  controller's extra metadata is visible rather than dropped. */
  extra?: Record<string, string>;
};

/**
 * What the hub accepts when creating or replacing a rule.
 *
 * Deliberately NOT `AutomationRule` — a caller does not send the resolved
 * `action_tier`, the run history, or the breaker state. Those are the engine's
 * to determine, and a request that appeared to set them would be a request that
 * appeared to move the safety ceiling.
 */
export type AutomationRuleInput = {
  name: string;
  enabled: boolean;
  trigger: AutomationRule['trigger'];
  conditions: AutomationRule['conditions'];
  action: AutomationRule['action'];
  min_interval_seconds: number;
};
