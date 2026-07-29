// A dead controller must not read as a live one.
//
// The fleet screen decided a controller's state from `status`, which is PAIRING
// state: it goes `unpaired` → `active` when a claim is redeemed and is never
// written again. Nothing in the hub ever sets `offline` — grep for it and the
// only hits are the console's own dead branch. So every controller that had
// ever paired drew green, forever, including one unplugged for months, and
// STATUS_LABEL printed the literal word "online" beside it.
//
// The hub was sending the truth all along. `hub.Connected(d.ID)` — the live
// WebSocket — ships in the same payload as `status`, and the console did not
// even declare the field.
//
// An operator looking at a list of gates they cannot see, deciding whether
// someone can get in, is the exact person this misleads.
import { describe, expect, it } from 'vitest';
import { controllerState, controllerLabel } from '@/pages/app/Devices';

describe('controller liveness comes from the live field', () => {
  it('draws a paired-but-disconnected controller as alert, not live', () => {
    // The bug, in one assertion. `status: 'active'` is what the hub writes at
    // pairing and never revisits.
    expect(controllerState('active', false)).toBe('alert');
    expect(controllerState('active', true)).toBe('live');
  });

  it('never reads liveness out of the pairing status', () => {
    // Whatever `status` says, `connected` decides. If these two ever disagree
    // it is because a controller paired and then went away, which is the
    // common case rather than an edge one.
    for (const status of ['active', 'online', 'offline', 'something-new']) {
      expect(controllerState(status, false)).toBe('alert');
      expect(controllerState(status, true)).toBe('live');
    }
  });

  it('treats a hub that does not report connectedness as unknown, never live', () => {
    // An older hub omits the field. Guessing "live" is the one wrong direction
    // to guess in — it is precisely the guess that produced this bug.
    expect(controllerState('active', undefined)).toBe('unknown');
    expect(controllerLabel({ status: 'active', connected: undefined, last_seen_at: null }))
      .toContain('does not report');
  });

  it('still shows an unpaired controller as awaiting pairing', () => {
    // The one case where `status` genuinely is the answer, so the fix must not
    // have flattened it.
    expect(controllerState('unpaired', undefined)).toBe('warn');
    expect(controllerState('unpaired', false)).toBe('warn');
    expect(controllerLabel({ status: 'unpaired', connected: false, last_seen_at: null }))
      .toContain('awaiting pair');
  });

  it('never prints the word "online" for a controller that is not connected', () => {
    // STATUS_LABEL mapped `active` → "online". A person reads that word as
    // "it is there right now", which is exactly what it did not mean.
    const label = controllerLabel({ status: 'active', connected: false, last_seen_at: 1_700_000_000 });
    expect(label).not.toContain('online');
    expect(label).toContain('not connected');
    // And it says WHEN, so an operator can tell a controller that dropped a
    // minute ago from one that has been gone a month.
    expect(label).toContain('last seen');
  });

  it('says connected only when it is', () => {
    expect(controllerLabel({ status: 'active', connected: true, last_seen_at: null })).toBe('connected');
  });
});
