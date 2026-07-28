// "Your hub is off" is a different fact from "your hub said no", and until
// apiFetch drew that line nothing in the console could tell them apart.
//
// A rejected fetch used to escape as a raw `TypeError: Failed to fetch`, which
// every screen then rendered verbatim as its error message — naming a browser
// API to a user whose actual problem was a power cut. It also meant offline
// emergency access, whose entire trigger is "the hub is unreachable", had no
// signal to trigger on.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://hub.local:8787';

let behaviour: () => Promise<Response> = async () => new Response('{}', { status: 200 });

vi.mock('../hub', () => ({
  getApiBaseUrl: () => BASE,
  isTauri: () => false,
  gatewayFetch: async () => behaviour(),
}));

const { apiFetch, ApiError, isHubUnreachable, isUnreachable, HUB_UNREACHABLE_CODE } =
  await import('../api');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  behaviour = async () => jsonResponse(200, {});
});

describe('a request that never reaches a hub', () => {
  it('is an ApiError with a code, not a raw TypeError', async () => {
    behaviour = async () => {
      throw new TypeError('Failed to fetch');
    };

    const err = await apiFetch('/accounts').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isHubUnreachable(err)).toBe(true);
    expect((err as InstanceType<typeof ApiError>).code).toBe(HUB_UNREACHABLE_CODE);
    // Status 0: there was no response to take a status from. Anything else
    // would be inventing an answer the hub never gave.
    expect((err as InstanceType<typeof ApiError>).status).toBe(0);
  });

  it('is distinct from the hub reporting a DEVICE it could not reach', async () => {
    // 502 `unreachable` proves the hub is up and talking — the opposite fact.
    // Collapsing the two would have the console offer offline emergency
    // access because one gate controller was unplugged.
    behaviour = async () => jsonResponse(502, { error: 'unreachable' });

    const err = await apiFetch('/access-points/ap_1/open', { method: 'POST' }).catch((e) => e);
    expect(isUnreachable(err)).toBe(true);
    expect(isHubUnreachable(err)).toBe(false);
  });

  it('does not claim the hub is down when the caller aborted', async () => {
    // A cancelled request — a user navigating away, a component unmounting,
    // a caller's own timeout — says nothing about whether the hub is up.
    // Reporting it as unreachable would flash an emergency banner every time
    // someone changed screens quickly.
    behaviour = async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    };

    const err = await apiFetch('/accounts').catch((e) => e);
    expect(isHubUnreachable(err)).toBe(false);
    expect((err as Error).name).toBe('AbortError');
  });

  it('leaves ordinary refusals alone', async () => {
    behaviour = async () => jsonResponse(403, { error: 'not_account_admin' });

    const err = await apiFetch('/accounts/a/members/u', { method: 'DELETE' }).catch((e) => e);
    expect(isHubUnreachable(err)).toBe(false);
    expect((err as InstanceType<typeof ApiError>).code).toBe('not_account_admin');
  });
});
