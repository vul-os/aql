import { describe, expect, it } from 'vitest';
import {
  ApiError,
  HUB_UNREACHABLE_CODE,
  UNAVAILABLE_CODE,
  friendlyApiError,
  isConfirmRequired,
  isHubUnreachable,
  isIndeterminate,
  isUnavailable,
  isUnreachable,
  rateLimitInfo,
} from '../api';

// The console's error vocabulary: six narrowing helpers of identical shape,
// and the distinctions between them are the whole point.
//
// api.ts says as much — "they get named narrowing helpers here so no call site
// has to remember the status/code pair, and so the difference can be
// unit-tested". Two of them had no test at all: isUnavailable, which nineteen
// production call sites use to decide whether a screen shows "not available on
// this hub", and rateLimitInfo, which nine use to tell someone when to try
// again.
//
// # Why they are tested as a SET rather than one at a time
//
// Each is two comparisons against a code and a status. Six of them, written to
// the same template, is precisely the shape where a copy-paste leaves two
// helpers answering for the same code — and nothing at a call site would look
// wrong, because each helper still returns a boolean and each screen still
// renders something.
//
// The consequences are not symmetrical. api.ts spells out two of them:
//
//   - indeterminate must NEVER render as failed. "A person told an open failed
//     will press it again, and the open may already have happened." If
//     isUnreachable started answering true for indeterminate, the console would
//     say "nothing happened" about an action that may well have.
//   - hub-unreachable is not the hub's own `unreachable`. That one is a 502
//     the hub sends ABOUT a device, which proves the hub is up and talking —
//     the opposite condition. Offline emergency access keys off the first, so
//     confusing them either offers an offline grant when the hub is fine, or
//     fails to offer one when it is not.
//
// So the table below asserts every helper against every code: true for its own,
// false for all the others.

/** An ApiError as apiFetch builds one: status plus a JSON error body. */
function apiErr(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new ApiError(status, { error: code, ...extra });
}

type Case = { name: string; err: ApiError; expect: string | null };

const CASES: Case[] = [
  {
    name: 'route not implemented on this hub (the SPA fallback served HTML)',
    err: apiErr(200, UNAVAILABLE_CODE),
    expect: 'isUnavailable',
  },
  {
    name: 'confirm required above the hazardous-motion ceiling',
    err: apiErr(409, 'confirm_required'),
    expect: 'isConfirmRequired',
  },
  {
    name: 'driver could not establish whether the action happened',
    err: apiErr(502, 'indeterminate'),
    expect: 'isIndeterminate',
  },
  {
    name: 'the hub reached the device and it did not answer',
    err: apiErr(502, 'unreachable'),
    expect: 'isUnreachable',
  },
  {
    name: 'the request never reached a hub at all',
    err: apiErr(0, HUB_UNREACHABLE_CODE),
    expect: 'isHubUnreachable',
  },
  {
    name: 'an ordinary refusal',
    err: apiErr(403, 'forbidden'),
    expect: null,
  },
];

const HELPERS: Record<string, (e: unknown) => boolean> = {
  isUnavailable,
  isConfirmRequired,
  isIndeterminate,
  isUnreachable,
  isHubUnreachable,
};

describe('the error vocabulary is mutually exclusive', () => {
  // A floor. If a helper is added to api.ts and not here, this file would keep
  // passing while covering a smaller share of the vocabulary than it claims.
  it('covers every narrowing helper the module exports', () => {
    expect(Object.keys(HELPERS)).toHaveLength(5);
  });

  for (const c of CASES) {
    it(`${c.name} matches only ${c.expect ?? 'nothing'}`, () => {
      for (const [name, fn] of Object.entries(HELPERS)) {
        expect(fn(c.err), `${name}(${c.err.code})`).toBe(name === c.expect);
      }
    });
  }

  it('answers false for things that are not ApiErrors at all', () => {
    for (const notAnApiError of [null, undefined, 'unreachable', new Error('unreachable'), {}, 502]) {
      for (const [name, fn] of Object.entries(HELPERS)) {
        expect(fn(notAnApiError), `${name}(${String(notAnApiError)})`).toBe(false);
      }
    }
  });

  // The one that carries a safety claim rather than a cosmetic one.
  it('never lets an indeterminate result read as "nothing happened"', () => {
    const indeterminate = apiErr(502, 'indeterminate');
    expect(isIndeterminate(indeterminate)).toBe(true);
    expect(
      isUnreachable(indeterminate),
      'unreachable means the device was not contacted and nothing happened; saying that ' +
        'about an indeterminate result invites a second press of an open that may already ' +
        'have succeeded',
    ).toBe(false);
    expect(
      isHubUnreachable(indeterminate),
      'the hub answered 502, so it is plainly reachable',
    ).toBe(false);
  });
});

describe('rateLimitInfo', () => {
  it('is null for anything that is not a 429', () => {
    for (const err of [
      apiErr(403, 'forbidden'),
      apiErr(500, 'internal'),
      apiErr(0, HUB_UNREACHABLE_CODE),
      new Error('nope'),
      null,
    ]) {
      expect(rateLimitInfo(err)).toBeNull();
    }
  });

  it('separates a quota from a rate limit, because the advice differs', () => {
    // "Too fast, wait a moment" and "you have used your allowance" are
    // different sentences to a member standing at a gate, and only the code
    // distinguishes them — both are 429.
    expect(rateLimitInfo(apiErr(429, 'quota_exceeded', { retry_after_s: 60 }))).toEqual({
      reason: 'quota_exceeded',
      retryAfterS: 60,
    });
    expect(rateLimitInfo(apiErr(429, 'rate_limited', { retry_after_s: 5 }))).toEqual({
      reason: 'rate_limited',
      retryAfterS: 5,
    });
    // CORRECTED. This previously asserted that an unfamiliar 429 is "treated
    // as a rate limit, the recoverable reading being the safe default" — which
    // wrote the bug down as intent. Nine of the open path's eleven denial
    // reasons arrive as 429, and only two are throttles; the other seven were
    // being rendered "Too many opens — try again in ~Xs". A 429 this function
    // does not recognise is now declined so the caller can say something true.
    expect(rateLimitInfo(apiErr(429, 'something_new'))).toBeNull();
    expect(rateLimitInfo(apiErr(429, 'outside_geofence'))).toBeNull();
    expect(rateLimitInfo(apiErr(429, 'outside_time_window'))).toBeNull();
  });

  it('never advises a retry of zero or a fraction of a second', () => {
    // A "try again in 0s" is an invitation to hammer the endpoint that just
    // asked for a pause, and the floor of 1 is what stops it.
    for (const [given, want] of [
      [0, 1],
      [-5, 1],
      [0.2, 1],
      [1.1, 2],
      [29.4, 30],
    ] as const) {
      expect(rateLimitInfo(apiErr(429, 'rate_limited', { retry_after_s: given }))?.retryAfterS).toBe(
        want,
      );
    }
  });

  it('falls back to 30s when the hub sent no hint', () => {
    // Not 0, and not "immediately": with no guidance the console has to pick
    // something, and it must be a real wait.
    expect(rateLimitInfo(apiErr(429, 'rate_limited'))?.retryAfterS).toBe(30);
  });
});

describe('friendlyApiError', () => {
  it('renders the unavailable case as a product sentence, not a code', () => {
    expect(friendlyApiError(apiErr(200, UNAVAILABLE_CODE))).toBe(
      "This isn't available on this hub yet.",
    );
  });

  it('prefers the hub detail over the bare code', () => {
    expect(friendlyApiError(new ApiError(403, { error: 'forbidden', detail: 'Not your gate.' }))).toBe(
      'Not your gate.',
    );
    expect(friendlyApiError(apiErr(403, 'forbidden'))).toBe('forbidden');
  });

  it('falls back rather than rendering an object', () => {
    expect(friendlyApiError({}, 'Something went wrong.')).toBe('Something went wrong.');
    expect(friendlyApiError(new Error('boom'))).toBe('boom');
  });
});
