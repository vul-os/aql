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
export type DeviceState = "live" | "warn" | "alert" | "off" | "unknown";

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
export const REAL_KIND = "Access";

/**
 * The six kinds the device engine serves, in display order.
 *
 * "Serves" is not "has a driver of its own". Robot has no dedicated driver — it
 * is reachable through the generic HTTP and MQTT ones — and Camera's records
 * and plays back but has never met real hardware. The per-kind truth lives in
 * site/docs/devices.md and is not restated here, because a status that has to be
 * updated in two places gets updated in one.
 *
 * This comment asserted both of those absences for days after each stopped
 * being true, because the guard that catches exactly that walked only .md and
 * .html. It walks the console's copy now too.
 */
export const ENGINE_KINDS: readonly string[] = [
  "Camera",
  "Lighting",
  "Robot",
  "Climate",
  "Energy",
  "Sensor",
];

/** All seven, engine kinds first and access last. */
export const DEVICE_KINDS: readonly string[] = [...ENGINE_KINDS, REAL_KIND];

/**
 * Engine device kinds the console must NOT draw a row for.
 *
 * Access only, and for one reason: the hub already contributes a richer row for
 * every access point, sourced from the access-point API rather than the engine.
 * It carries the operation counts, the last-op time and a link through to the
 * screen where opening actually lives. The engine's row for the same gate
 * carries availability and nothing else.
 *
 * Both would otherwise be rendered, because the list is a concatenation, and a
 * gate would appear twice the moment an operator turns on `-device-drivers=access`.
 * docs/ACCESS-ON-THE-ENGINE.md §5 asked whether the console should merge the
 * screens and leaned toward "link, do not duplicate". The console had already
 * done that — this is the part that keeps it true once the engine can also see
 * a gate.
 *
 * This suppresses a ROW, not the device. `GET /v1/engine/devices` still returns
 * access points, which is where the unified fleet is genuinely useful: an API
 * consumer asking the engine what exists should be told about the gates.
 */
export const ENGINE_ROW_SUPPRESSED: readonly string[] = [REAL_KIND];

/**
 * Whether the console should skip an engine device with this kind label.
 *
 * Takes the display label (`kindLabel`'s output), not the wire kind, because
 * that is what the row already carries by the time this is asked.
 */
export function suppressEngineRow(kindLabel: string): boolean {
  return ENGINE_ROW_SUPPRESSED.includes(kindLabel);
}
