/**
 * Whether the hub is answering, as observed rather than asked.
 *
 * Nothing here polls. Every request the console makes already tells us the
 * answer, so this is fed by apiFetch as a side effect of ordinary traffic: a
 * completed round trip marks the hub reachable, a transport failure marks it
 * unreachable. A dedicated health poll would add load, be wrong between polls,
 * and still not know what the request the user just made would have done.
 *
 * The state is deliberately coarse. It answers one question — should the
 * console offer offline emergency access — and that question does not need to
 * know which endpoint failed or how long ago.
 *
 * # Why `unknown` is a state
 *
 * Before the first request there is no evidence either way, and treating that
 * as "unreachable" would show an emergency banner on every cold start until
 * the first fetch resolved. Treating it as "reachable" would be a claim
 * nothing supports. So it is neither, and consumers must handle three cases.
 */

export type HubReachability = 'unknown' | 'reachable' | 'unreachable';

let state: HubReachability = 'unknown';
const listeners = new Set<(s: HubReachability) => void>();

export function getHubReachability(): HubReachability {
  return state;
}

/**
 * Record what a request observed.
 *
 * Called from apiFetch. Idempotent: re-reporting the current state notifies
 * nobody, so a screen polling every few seconds does not re-render the app on
 * every tick.
 */
export function reportHubReachability(next: 'reachable' | 'unreachable'): void {
  if (state === next) return;
  state = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      // A broken listener must not stop the others, and must not turn an
      // observation about the network into an exception inside apiFetch.
    }
  }
}

export function subscribeHubReachability(fn: (s: HubReachability) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tests only: return to the pre-first-request state. */
export function resetHubReachability(): void {
  state = 'unknown';
  listeners.clear();
}
