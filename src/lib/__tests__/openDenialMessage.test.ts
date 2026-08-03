import { describe, expect, it } from 'vitest';
import { ApiError, OPEN_DENIAL_REASONS, friendlyApiError, openDenialMessage } from '../api';

// Why a gate did not open, said honestly — the console half of a fix the chat
// rails already had.
//
// # The defect this closes
//
// The open path denies for eleven reasons and nine of them leave the hub as a
// 429; only account_suspended and user_disabled are 403. rateLimitInfo mapped
// every one of those nine onto `rate_limited`, and RateLimitNotice renders that
// as "Too many opens — try again in ~Xs" with a live countdown. So:
//
//   · a schedule lockout said "Too many opens — try again in ~70601s", a
//     nineteen-hour countdown attached to the wrong cause;
//   · a geofence refusal said "Too many opens — try again in ~1s", which is the
//     one instruction that cannot work, because waiting does not move you.
//
// hub/internal/channels/reply.go fixed exactly this on the rails, and its
// comment is the record: "This branch used to be `default: // rate_limited`,
// and three separate features shipped through it ... The minutes were right and
// the cause was a lie." The console kept the bug for the same three features,
// which is what a fix applied to one surface and not its sibling looks like.
//
// # Why the list is asserted rather than the sentences
//
// reply.go pairs its message switch with DenialReasons() so a test can assert
// every reason has a case — "the only thing that stops a fourth feature quietly
// reusing someone else's copy". This is that guard for the console.

describe('openDenialMessage', () => {
  it('has a sentence for every reason the open path can produce', () => {
    for (const reason of OPEN_DENIAL_REASONS) {
      const msg = openDenialMessage(reason, 120);
      expect(msg, `${reason} has no message, so a resident sees a bare code`).toBeTruthy();
      expect(msg, `${reason} renders as a code rather than a sentence`).not.toBe(reason);
    }
  });

  it('covers the hub’s full vocabulary — eleven reasons, not a subset', () => {
    // A floor. Trimming this list would make the test above pass over fewer
    // reasons while still reporting green, which is how the original bug
    // survived: the code handled two and the other nine went to a default.
    expect(OPEN_DENIAL_REASONS).toHaveLength(11);
    for (const required of [
      'outside_time_window',
      'outside_geofence',
      'geofence_location_required',
      'time_window_invalid',
    ]) {
      expect(OPEN_DENIAL_REASONS).toContain(required);
    }
  });

  it('says "too many opens" for exactly one reason', () => {
    // The whole defect in one assertion. Seven reasons used to produce this
    // sentence; only the throttle may.
    const throttled = OPEN_DENIAL_REASONS.filter((r) =>
      (openDenialMessage(r, 120) ?? '').toLowerCase().includes('too many'),
    );
    expect(throttled).toEqual(['rate_limited']);
  });

  it('never tells someone outside the fence to wait', () => {
    // Waiting does not move you. Any duration here is advice that cannot work.
    const msg = openDenialMessage('outside_geofence', 3600) ?? '';
    expect(msg).toMatch(/near it|at the gate/i);
    expect(msg, 'a geofence refusal must carry no countdown').not.toMatch(/\bmin\b|\bh\b|\bsecond/i);
  });

  it('does give the schedule a countdown, because that one really does reopen', () => {
    // The distinction: a time window is the single denial where "come back
    // later" is true, and the hub computes when.
    expect(openDenialMessage('outside_time_window', 600)).toMatch(/10 min/);
    expect(openDenialMessage('outside_time_window', 7200)).toMatch(/\d+ h/);
    // With no hint it must not invent one.
    expect(openDenialMessage('outside_time_window', 0)).not.toMatch(/\bin ~/);
  });

  it('names a setup fault as a setup fault', () => {
    // An unevaluable rule is not the resident's doing, and telling them to
    // retry is what makes them keep trying.
    for (const r of ['time_window_invalid', 'time_window_unavailable', 'geofence_invalid', 'geofence_unavailable']) {
      expect(openDenialMessage(r, 60), r).toMatch(/setup problem|contact your admin/i);
    }
  });

  it('returns null for a reason it does not know', () => {
    // Not a message. An unrecognised reason must not borrow another's copy —
    // that is the failure this function exists to undo, so the fallback has to
    // be an absence rather than a guess.
    expect(openDenialMessage('something_a_newer_hub_sent', 60)).toBeNull();
    expect(openDenialMessage('', 60)).toBeNull();
  });
});

describe('friendlyApiError reaches the denial vocabulary', () => {
  it('renders a geofence refusal as a sentence rather than a code', () => {
    // The three access screens fall through to friendlyApiError now that
    // rateLimitInfo declines a non-throttle 429. Without this wiring they would
    // print "outside_geofence" at a resident.
    const err = new ApiError(429, { error: 'outside_geofence' });
    expect(friendlyApiError(err)).toMatch(/near it|at the gate/i);
    expect(friendlyApiError(err)).not.toBe('outside_geofence');
  });

  it('carries the hub’s retry hint into the schedule message', () => {
    const err = new ApiError(429, { error: 'outside_time_window', retry_after_s: 1800 });
    expect(friendlyApiError(err)).toMatch(/30 min/);
  });

  it('leaves an ordinary error alone', () => {
    expect(friendlyApiError(new ApiError(403, { error: 'forbidden', detail: 'Not your gate.' }))).toBe(
      'Not your gate.',
    );
  });
});
