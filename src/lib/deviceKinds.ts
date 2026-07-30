// Aql's seven device kinds, as a product fact.
//
// These used to be derived from a twelve-row demo fixture: the landing page
// computed its kind list by de-duplicating the `kind` field of some invented
// devices. That coupling was justified at the time as anti-drift — the console
// rendered the same fixture, so the marketing list could not disagree with the
// product. The console stopped rendering it, which left the fixture alive for
// no reason other than to produce six strings, and left the drift argument
// false while still written down.
//
// So the kinds are declared here, and pinned to the engine's own catalogue by
// src/lib/__tests__/deviceKinds.test.ts, which reads the Kind constants out of
// hub/internal/devices/model.go. That is a real anti-drift check rather than a
// restatement of one: the authority is the thing that actually routes verbs.

/**
 * The status vocabulary for a device row.
 *
 * 'unknown' is a THIRD state, not a synonym for 'off' and emphatically not
 * 'alert'. It means the engine has not heard from this device since it started
 * (devices.AvailUnknown — the empty string on the wire). Collapsing it into
 * 'off' would make a device that has never reported look like one that is
 * known down, which is the opposite of what an operator needs to see.
 * See availabilityState() in src/components/device/engineState.ts.
 */
export type DeviceState = 'live' | 'warn' | 'alert' | 'off' | 'unknown';

/**
 * The kind that does not go through the device engine.
 *
 * Access is the most complete kind in the product and the only one with its
 * own stack: a versioned wire contract, a controller that verifies an Ed25519
 * signature against a key it pinned itself, and an audit row written in the
 * same transaction as the decision. Gates now APPEAR in the engine's fleet
 * through the read-only `access` driver, but OPENING one stays on that stack
 * permanently (docs/ACCESS-ON-THE-ENGINE.md §3.1), which is why access is still
 * deliberately not one of ENGINE_KINDS: this list is about what the engine
 * drives, not what it can show.
 */
export const REAL_KIND = 'Access';

/**
 * The six kinds the device engine serves, in display order.
 *
 * "Serves" is not "has a driver for". Robot has no driver at all; Camera has
 * one that discovers and reads but receives no video. The per-kind truth lives
 * in site/docs/devices.md and is not restated here, because a status that has
 * to be updated in two places gets updated in one.
 */
export const ENGINE_KINDS: readonly string[] = [
  'Camera',
  'Lighting',
  'Robot',
  'Climate',
  'Energy',
  'Sensor',
];

/** All seven, engine kinds first and access last. */
export const DEVICE_KINDS: readonly string[] = [...ENGINE_KINDS, REAL_KIND];
