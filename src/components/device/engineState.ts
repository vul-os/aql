// How the console presents the device engine — and, just as importantly, how
// it presents the engine's ABSENCE.
//
// This lives beside DemoMarks.tsx on purpose: it is the same job. DemoMarks
// answers "is this row real?"; this module answers "is this hub's engine real,
// and what does each of its answers actually mean?". Both are honesty logic,
// and both are the sort of thing that quietly rots into a lie if it is spread
// across three screens.
//
// Three distinctions this module exists to protect:
//
//   1. `engine: false` is the DEFAULT, not a failure. A hub with no device
//      config has no engine and honestly has no devices. That is a different
//      sentence from "the fetch failed" and a different sentence again from
//      "this hub is too old to serve /v1/engine" — engineFleet() keeps all
//      four apart so a screen can say which one happened.
//   2. Availability "" is devices.AvailUnknown: not heard from since the
//      engine started. NOT offline. It renders as unknown.
//   3. An indeterminate execute is not a failure. "Could not confirm" is the
//      only honest copy; a person told an open failed presses it again.
//
// It is pure and dependency-light (no React) so the rules above can be
// unit-tested — see src/lib/__tests__/engineState.test.ts.

import {
  api,
  isConfirmRequired,
  isIndeterminate,
  isUnavailable,
  isUnreachable,
  ApiError,
  friendlyApiError,
  type EngineAvailability,
  type EngineDevice,
  type EngineReading,
} from '@/lib/api';
import type { DeviceState } from '@/lib/deviceKinds';
import { suppressEngineRow } from '@/lib/deviceKinds';

// ── the engine's four possible answers ──────────────────────────────────────

export type EngineFleet =
  /** The hub has an engine and it reported this fleet (possibly empty). */
  | { status: 'live'; devices: EngineDevice[] }
  /** `engine: false` — no device engine is configured. The default. */
  | { status: 'absent'; devices: [] }
  /** The hub predates /v1/engine (SPA-fallback answered, not JSON). */
  | { status: 'unsupported'; devices: [] }
  /**
   * The hub refused: this caller holds no authority over the engine.
   *
   * Its own state rather than an `error`, for the same reason `absent` is not
   * an empty `live`. The engine is hub-wide and has no way to say which
   * account a device belongs to, so on a hub serving several accounts only the
   * instance admin may drive it. That is a deliberate answer with a reason a
   * person can act on — "ask your instance admin" — and rendering it as a
   * failed request would send them to check their network instead.
   */
  | { status: 'forbidden'; devices: [] }
  /** The request genuinely failed. Distinct from "no devices". */
  | { status: 'error'; devices: []; message: string };

/**
 * Whether the console should treat an engine device as its own to show.
 *
 * False for access points, which the hub already reports through the
 * access-point API with more detail — operation counts, last-op time, and a link
 * to the screen where opening lives. The engine reports them too, correctly, and
 * `GET /v1/engine/devices` still returns them: this is a CONSOLE decision, not a
 * claim that the engine should not know about gates.
 *
 * # Why this is at the fetch and not at each screen
 *
 * Because it was at each screen for one commit, and that was already wrong in
 * two of the three places. Devices.tsx filtered. Overview.tsx did not, and
 * counted every gate twice in the headline fleet total. RuleEditor.tsx did not,
 * and would have offered gates in an automation's device picker — the last place
 * a gate should appear. Three consumers, one filter remembered.
 *
 * A screen that genuinely wants access devices from the engine should call the
 * API directly and say why, which is a visible act rather than a forgotten one.
 */
export function consoleShowsEngineDevice(d: { kind: string }): boolean {
  return !suppressEngineRow(kindLabel(d.kind));
}

/**
 * Fetch the engine fleet, narrowing every outcome. Never throws: an absent
 * engine and a broken one both have to be *rendered*, and a screen that has to
 * try/catch to tell them apart usually ends up rendering neither.
 */
export async function engineFleet(): Promise<EngineFleet> {
  try {
    const res = await api.engineDevices();
    if (!res || typeof res !== 'object' || !Array.isArray(res.devices)) {
      return { status: 'error', devices: [], message: 'The hub sent an answer this console could not read.' };
    }
    if (!res.engine) return { status: 'absent', devices: [] };
    return { status: 'live', devices: res.devices.filter(consoleShowsEngineDevice) };
  } catch (err) {
    if (isUnavailable(err)) return { status: 'unsupported', devices: [] };
    if (err instanceof ApiError && err.code === 'not_engine_authority') {
      return { status: 'forbidden', devices: [] };
    }
    return { status: 'error', devices: [], message: friendlyApiError(err, 'Could not reach the device engine.') };
  }
}

/**
 * One sentence a screen can print verbatim for a non-live engine, and null
 * when the engine is live (in which case the rows speak for themselves).
 *
 * Every one of these says what IS true. None of them is an empty list left to
 * be mistaken for a broken fetch, and none of them quietly substitutes the
 * fixture for the thing that was asked for.
 */
export function engineNotice(fleet: EngineFleet): string | null {
  switch (fleet.status) {
    case 'absent':
      return 'No device engine is configured on this hub, so it reports no devices of its own. That is the default for a hub with no device config — not an error, and not a failed load.';
    case 'unsupported':
      return "This hub doesn't serve the device-engine API yet — it's running a build from before /v1/engine existed. Upgrade the hub to see live devices here.";
    case 'forbidden':
      return 'This hub serves more than one account, and its device engine has no way to tell which account a device belongs to — so only the instance admin can see or drive it. Nothing is wrong with the engine; ask whoever runs this hub.';
    case 'error':
      return `The device engine could not be read: ${fleet.message} This is a failed request, not an empty fleet — devices may well be running.`;
    case 'live':
      return fleet.devices.length === 0
        ? 'The device engine is running but has discovered no devices yet.'
        : null;
  }
}

// ── availability ────────────────────────────────────────────────────────────

/**
 * Map the engine's availability onto the shared row-status vocabulary.
 *
 * "" (devices.AvailUnknown) → 'unknown', never 'off' and never 'alert'. So is
 * any value this console doesn't recognise: guessing 'live' for an unknown
 * string would be the one wrong direction to guess in.
 */
export function availabilityState(availability: EngineAvailability): DeviceState {
  switch (availability) {
    case 'online':
      return 'live';
    case 'degraded':
      return 'warn';
    case 'offline':
      return 'alert';
    default:
      return 'unknown';
  }
}

/** Plain words for the same thing, for a detail row or a screen-reader label. */
export function availabilityLabel(availability: EngineAvailability): string {
  switch (availability) {
    case 'online':
      return 'online';
    case 'degraded':
      return 'degraded — reachable, not fully working';
    case 'offline':
      return 'offline';
    case '':
      return 'unknown — not heard from since the engine started';
    default:
      return `unknown ("${availability}")`;
  }
}

/** Display-cased kind, so engine rows share the fixture's kind filters. */
export function kindLabel(kind: string): string {
  const known: Record<string, string> = {
    camera: 'Camera',
    lighting: 'Lighting',
    robot: 'Robot',
    climate: 'Climate',
    energy: 'Energy',
    sensor: 'Sensor',
    access: 'Access',
  };
  return known[kind] ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Device');
}

/** The row's one-line reading: the driver's summary, else its availability. */
export function summaryLine(d: EngineDevice): string {
  const s = d.summary.trim();
  if (s) return s;
  return availabilityState(d.availability) === 'unknown' ? 'no reading yet' : d.availability;
}

/**
 * Why a read came back empty-handed, in words.
 *
 * A device that declares no read requests answers `unsupported`, and printing
 * that code at a person is both alarming and uninformative — it is not a
 * fault, it is a device that simply has nothing to poll.
 */
export function readingsErrorMessage(err: unknown): { message: string; fault: boolean } {
  if (err instanceof ApiError) {
    if (err.code === 'unsupported') {
      return { message: 'This device has no readings to poll.', fault: false };
    }
    if (err.code === 'unreachable') {
      return { message: "The device couldn't be reached, so there is nothing to show.", fault: true };
    }
    if (err.code === 'indeterminate') {
      return { message: 'The hub could not establish a reading from this device.', fault: true };
    }
  }
  return { message: friendlyApiError(err, 'Could not read this device.'), fault: true };
}

/** Render one reading. `text` wins when set — the gateway sends one or other. */
export function readingValue(r: EngineReading): string {
  if (typeof r.text === 'string' && r.text !== '') return r.text;
  if (typeof r.value === 'number') return String(Number(r.value.toFixed(3)));
  return '—';
}

// ── controls ────────────────────────────────────────────────────────────────

/**
 * Which buttons to draw for a device, derived from the capabilities it
 * declares.
 *
 * This is a PRESENTATION table and nothing else. It does not carry tiers, does
 * not decide what a verb means, and cannot widen anything: the hub re-resolves
 * every verb against devices/capability.go and refuses what this table gets
 * wrong. Tiers are deliberately not mirrored here — the confirmation step is
 * driven by the hub's 409 `confirm_required`, so a tier change in the
 * catalogue takes effect without this file knowing about it. The failure mode
 * of a stale row here is an offered button that the hub refuses, which is
 * visible; the failure mode of a mirrored tier is a hazardous verb fired
 * without a confirm, which is not.
 */
export type EngineControl = {
  verb: string;
  label: string;
  /** The single numeric argument the verb takes, when it takes one. */
  arg?: { name: string; min: number; max: number; step: number; initial: number; unit: string };
};

const CAP_CONTROLS: Record<string, EngineControl[]> = {
  'access.barrier': [
    { verb: 'open', label: 'Open' },
    { verb: 'close', label: 'Close' },
    { verb: 'hold', label: 'Hold', arg: { name: 'seconds', min: 1, max: 600, step: 1, initial: 30, unit: 's' } },
  ],
  'access.lock': [
    { verb: 'unlock', label: 'Unlock' },
    { verb: 'lock', label: 'Lock' },
  ],
  'light.switch': [
    { verb: 'on', label: 'On' },
    { verb: 'off', label: 'Off' },
    { verb: 'toggle', label: 'Toggle' },
  ],
  'light.dimmable': [
    { verb: 'on', label: 'On' },
    { verb: 'off', label: 'Off' },
    { verb: 'set', label: 'Set level', arg: { name: 'level', min: 0, max: 100, step: 1, initial: 60, unit: '%' } },
  ],
  'climate.setpoint': [
    { verb: 'set', label: 'Set target', arg: { name: 'celsius', min: 5, max: 35, step: 0.5, initial: 21, unit: '°C' } },
  ],
  'robot.job': [
    { verb: 'start', label: 'Start' },
    { verb: 'stop', label: 'Stop' },
    { verb: 'pause', label: 'Pause' },
    { verb: 'resume', label: 'Resume' },
    { verb: 'dock', label: 'Dock' },
  ],
  'robot.blade-job': [
    { verb: 'start', label: 'Start' },
    { verb: 'stop', label: 'Stop' },
    { verb: 'pause', label: 'Pause' },
    { verb: 'resume', label: 'Resume' },
    { verb: 'dock', label: 'Dock' },
  ],
  'security.posture': [
    { verb: 'arm', label: 'Arm' },
    { verb: 'disarm', label: 'Disarm' },
  ],
  // energy.meter, sensor.read, camera.stream and access.status offer
  // read/status only. A read-only device gets no buttons rather than disabled
  // ones — there is nothing to enable later.
  //
  // access.status is the deliberate one: a gate appears in the fleet so the
  // console can show it beside a lamp, but opening it stays on the signed
  // Ed25519 path (docs/ACCESS-ON-THE-ENGINE.md §3.1). An Open button here would
  // sit in front of a route that refuses by design.
};

/** Controls for a device, de-duplicated by verb, in capability order. */
export function controlsFor(capabilities: string[]): EngineControl[] {
  const out: EngineControl[] = [];
  const seen = new Set<string>();
  for (const cap of capabilities) {
    for (const c of CAP_CONTROLS[cap] ?? []) {
      if (seen.has(c.verb)) continue;
      seen.add(c.verb);
      out.push(c);
    }
  }
  return out;
}

// ── execute outcomes ────────────────────────────────────────────────────────

export type ExecuteOutcome =
  /** Not a failure — ask, then resend with confirm: true. */
  | { kind: 'confirm'; message: string }
  /** The hub could not establish whether it happened. Say exactly that. */
  | { kind: 'indeterminate'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string };

/**
 * Turn a rejected engineExecute into something a person can act on.
 *
 * The two rules that matter, both from engine.go's own reasoning:
 *   · confirm_required is a step, never an error toast.
 *   · indeterminate is "could not confirm", never "failed" — retrying an open
 *     you were wrongly told had failed opens the gate twice.
 */
export function describeExecuteError(err: unknown, label: string): ExecuteOutcome {
  if (isConfirmRequired(err)) {
    return {
      kind: 'confirm',
      message: `“${label}” can move something that could injure someone. Confirm to send it.`,
    };
  }
  if (isIndeterminate(err)) {
    return {
      kind: 'indeterminate',
      message: `Could not confirm “${label}”. The hub reached the device but couldn't establish whether it happened — check the device itself before sending it again.`,
    };
  }
  if (isUnreachable(err)) {
    return { kind: 'unreachable', message: `The device couldn't be reached, so “${label}” was not sent.` };
  }
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'tier_refused':
        return { kind: 'refused', message: `“${label}” is not actuable from this console.` };
      case 'unsupported':
      case 'invalid_request':
        return { kind: 'refused', message: `The hub refused “${label}” — this device doesn't offer it.` };
      case 'no_device_engine':
        return { kind: 'failed', message: 'This hub has no device engine configured.' };
      case 'not_engine_authority':
        return {
          kind: 'refused',
          message: `“${label}” was refused: on a hub serving several accounts, only the instance admin can drive devices. Nothing was sent.`,
        };
    }
  }
  return { kind: 'failed', message: friendlyApiError(err, `“${label}” did not go through.`) };
}

/** The confirming sentence for a successful execute. */
export function executedMessage(label: string, tier: string): string {
  return tier ? `Sent “${label}” — the hub accepted it (${tier}).` : `Sent “${label}” — the hub accepted it.`;
}
