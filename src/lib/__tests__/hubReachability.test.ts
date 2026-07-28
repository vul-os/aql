// The observation that decides whether an emergency banner appears.
//
// AppLayout used to carry two nudge banners that "could never succeed and
// would have nagged on every page load forever". They were deleted. The
// emergency banner is the replacement, and the only thing standing between it
// and the same fate is that every condition it fires on is something this
// module actually observed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://hub.local:8787';
let behaviour: () => Promise<Response> = async () =>
  new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

vi.mock('../hub', () => ({
  getApiBaseUrl: () => BASE,
  isTauri: () => false,
  gatewayFetch: async () => behaviour(),
}));

const { apiFetch } = await import('../api');
const {
  getHubReachability,
  reportHubReachability,
  resetHubReachability,
  subscribeHubReachability,
} = await import('../hubReachability');

beforeEach(() => {
  resetHubReachability();
  behaviour = async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});

describe('hub reachability', () => {
  it('starts unknown, because a cold start is not evidence of anything', () => {
    // 'unreachable' here would raise an emergency banner on every app launch
    // before the first request resolved; 'reachable' would be a claim nothing
    // supports yet.
    expect(getHubReachability()).toBe('unknown');
  });

  it('is learned from ordinary traffic rather than a poll', async () => {
    await apiFetch('/accounts');
    expect(getHubReachability()).toBe('reachable');

    behaviour = async () => {
      throw new TypeError('Failed to fetch');
    };
    await apiFetch('/accounts').catch(() => {});
    expect(getHubReachability()).toBe('unreachable');
  });

  it('counts any answer as reachable, including a refusal', async () => {
    // A 500 proves the hub is there, which is the only thing being observed.
    // Treating an error status as "hub down" would offer offline access to
    // someone whose hub is up and talking.
    behaviour = async () =>
      new Response(JSON.stringify({ error: 'internal' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    await apiFetch('/accounts').catch(() => {});
    expect(getHubReachability()).toBe('reachable');
  });

  it('does not change state when the caller aborted', async () => {
    await apiFetch('/accounts');
    expect(getHubReachability()).toBe('reachable');

    behaviour = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    await apiFetch('/accounts').catch(() => {});
    // Navigating away mid-request must not look like the hub going down.
    expect(getHubReachability()).toBe('reachable');
  });

  it('notifies subscribers only on a real change', async () => {
    const seen: string[] = [];
    subscribeHubReachability((s) => seen.push(s));

    reportHubReachability('reachable');
    reportHubReachability('reachable');
    reportHubReachability('unreachable');
    reportHubReachability('unreachable');
    reportHubReachability('reachable');

    // Re-notifying on every request would re-render the whole app on each
    // poll of any screen that polls.
    expect(seen).toEqual(['reachable', 'unreachable', 'reachable']);
  });

  it('survives a listener that throws', () => {
    const seen: string[] = [];
    subscribeHubReachability(() => {
      throw new Error('boom');
    });
    subscribeHubReachability((s) => seen.push(s));

    // A broken consumer must not turn an observation about the network into
    // an exception thrown out of apiFetch, which would fail the request that
    // was merely reporting it.
    expect(() => reportHubReachability('unreachable')).not.toThrow();
    expect(seen).toEqual(['unreachable']);
  });

  it('stops notifying after unsubscribe', () => {
    const seen: string[] = [];
    const off = subscribeHubReachability((s) => seen.push(s));
    reportHubReachability('unreachable');
    off();
    reportHubReachability('reachable');
    expect(seen).toEqual(['unreachable']);
  });
});
