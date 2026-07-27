// DEMO DATASET — not live, not fetched, not persisted.
//
// Ported verbatim (shapes and values) from Aql's pre-fold SvelteKit console
// (`src/lib/data.ts` at commit bf99a4d). Nothing in this file talks to a
// gateway, a controller, or a socket — every value below was typed by a human.
//
// A device engine now EXISTS (gateway/internal/devices, exposed at
// /v1/engine/*), and the console renders whatever it reports as live, chipped
// "Engine". That did not make this file live. It stays for two reasons and
// both are marked at the point of use:
//
//   1. A hub with no device config has no engine at all (`engine: false`) —
//      the default. These rows show the shape of a populated fleet next to
//      that, chipped "Demo data".
//   2. Nothing here beyond the device list has an engine behind it: the event
//      log, the automation rules, the circuits and the energy series have no
//      endpoint at all (rule engine = ROADMAP Phase 3, meter ingestion =
//      Phase 4).
//
// This is ONE kind of data in the portal, not a separate section of it. Aql's
// screens (Overview, Devices, Automations, Energy) mix it with real,
// gateway-backed access data, so every panel, row and figure that reads from
// here MUST carry a per-item demo marker at the point of use — see
// <DemoChip /> and <InertNote /> in src/components/demo/DemoMarks.tsx. Do not
// wire these shapes to endpoints that do not exist; the real engine will
// replace this module behind the same types.

/**
 * The shared status vocabulary for a device row, whatever its source.
 *
 * 'unknown' is never produced by this fixture — every row below has a state
 * someone typed. It exists for LIVE engine devices whose availability is the
 * empty string, i.e. devices.AvailUnknown: "the engine has not heard from this
 * device since it started". That is a third thing, not a synonym for 'off' and
 * emphatically not 'alert'; collapsing it would make a device that has never
 * reported look like one that is known down. See availabilityState() in
 * src/components/demo/engineState.ts.
 */
export type DeviceState = 'live' | 'warn' | 'alert' | 'off' | 'unknown';

export interface Device {
  id: string;
  name: string;
  kind: string;
  zone: string;
  state: DeviceState;
  read: string;
  detail: string;
  seen: string;
}

/**
 * All seven device kinds Aql models: Camera, Lighting, Robot, Climate,
 * Energy, Sensor and Access. Kept complete and byte-faithful to the pre-fold
 * dataset — see `demoDevices` below for the subset the portal actually
 * renders, and why.
 */
export const devices: Device[] = [
  { id: 'cam-gate',   name: 'Front Gate Camera', kind: 'Camera',    zone: 'Perimeter', state: 'live',  read: '1080p · 24fps',  detail: 'H.264 · motion zones armed', seen: 'now' },
  { id: 'cam-yard',   name: 'Yard Camera',       kind: 'Camera',    zone: 'Exterior',  state: 'live',  read: '1080p · 24fps',  detail: 'H.264 · night mode', seen: 'now' },
  { id: 'lights-grd', name: 'Garden Lights',     kind: 'Lighting',  zone: 'Exterior',  state: 'live',  read: '62% · warm',     detail: 'Zigbee group · 6 fixtures', seen: '2m' },
  { id: 'mower-m1',   name: 'Mower — Zana M1',   kind: 'Robot',     zone: 'Lawn',      state: 'warn',  read: 'charging · 81%', detail: 'docked · next cut 06:00', seen: '4m' },
  { id: 'thermostat', name: 'Thermostat',        kind: 'Climate',   zone: 'Interior',  state: 'live',  read: '21.5°C',         detail: 'heat · schedule active', seen: 'now' },
  { id: 'secbot-3',   name: 'Security Bot',      kind: 'Robot',     zone: 'Sector 3',  state: 'live',  read: 'patrol',         detail: 'route B · 74% battery', seen: 'now' },
  { id: 'cleanbot',   name: 'Cleaning Bot',      kind: 'Robot',     zone: 'Interior',  state: 'off',   read: 'docked',         detail: 'idle · next run 09:00', seen: '1h' },
  { id: 'solar',      name: 'Solar Array',       kind: 'Energy',    zone: 'Roof',      state: 'live',  read: '3.10 kW',        detail: '12 panels · MPPT nominal', seen: 'now' },
  { id: 'meter',      name: 'Energy Meter',      kind: 'Energy',    zone: 'Utility',   state: 'live',  read: '2.41 kW',        detail: 'grid import · 230V', seen: 'now' },
  { id: 'tank',       name: 'Water Tank',        kind: 'Sensor',    zone: 'Utility',   state: 'alert', read: 'level 12%',      detail: 'below threshold · pump off', seen: '6m' },
  { id: 'gate-lock',  name: 'Gate Lock',         kind: 'Access',    zone: 'Perimeter', state: 'live',  read: 'locked',         detail: 'last opened 12:04', seen: '2h' },
  { id: 'door-lock',  name: 'Front Door',        kind: 'Access',    zone: 'Interior',  state: 'live',  read: 'locked',         detail: 'auto-lock armed', seen: '3h' },
];

/** The one kind the portal does NOT fake: Access is served by the gateway. */
export const REAL_KIND = 'Access';

/**
 * What the device list actually renders from this file.
 *
 * The Access rows above are dropped: access points and their paired
 * controllers are real in this product — they come from the gateway, carry
 * signed commands and actually open a gate. Showing a fixture "Gate Lock"
 * next to a controller that genuinely works would be the one confusion this
 * dataset must never cause.
 */
export const demoDevices: Device[] = devices.filter((d) => d.kind !== REAL_KIND);

/** The six kinds this dataset stands in for, in a stable display order. */
export const DEMO_KINDS: string[] = [...new Set(demoDevices.map((d) => d.kind))];

export interface EventRow {
  t: string;
  tag: string;
  msg: string;
  sev: 'ok' | 'warn' | 'alert';
}

/** Fixture event log from the pre-fold console. Never appended to at runtime. */
export const events: EventRow[] = [
  { t: '14:22:07', tag: 'MOTION', msg: 'Front Gate Camera · person detected', sev: 'warn' },
  { t: '14:21:52', tag: 'ENERGY', msg: 'Solar Array crossed 3.0 kW', sev: 'ok' },
  { t: '14:20:31', tag: 'ROBOT',  msg: 'Mower returned to dock · battery 81%', sev: 'ok' },
  { t: '14:18:04', tag: 'ALERT',  msg: 'Water Tank level below threshold', sev: 'alert' },
  { t: '14:15:40', tag: 'AUTO',   msg: 'Rule "Dusk lights" armed', sev: 'ok' },
];

export interface Automation {
  name: string;
  when: string;
  then: string;
  enabled: boolean;
  runs: number;
  last: string;
}

export const automations: Automation[] = [
  { name: 'Dusk lights', when: 'sunset − 15m',              then: 'Garden Lights → 60% warm',      enabled: true,  runs: 214, last: 'today' },
  { name: 'Away arm',    when: 'everyone leaves',           then: 'Cameras + Security Bot patrol', enabled: true,  runs: 88,  last: '2d' },
  { name: 'Morning mow', when: 'weekday 06:00 · dry',       then: 'Mower → cut lawn',              enabled: true,  runs: 41,  last: 'today' },
  { name: 'Peak shave',  when: 'grid > 3kW & battery >50%', then: 'Draw from battery',             enabled: true,  runs: 132, last: 'today' },
  { name: 'Tank refill', when: 'water level < 20%',         then: 'Notify + open valve',           enabled: false, runs: 7,   last: '6m' },
  { name: 'Night lock',  when: '23:00',                     then: 'Lock all doors + gate',         enabled: true,  runs: 190, last: 'yesterday' },
];

export interface Circuit {
  name: string;
  kw: number;
  max: number;
}

export const circuits: Circuit[] = [
  { name: 'HVAC',       kw: 0.92, max: 2.0 },
  { name: 'Kitchen',    kw: 0.61, max: 3.0 },
  { name: 'Water pump', kw: 0.0,  max: 1.5 },
  { name: 'Lighting',   kw: 0.18, max: 0.8 },
  { name: 'EV charger', kw: 0.44, max: 7.2 },
  { name: 'Robots',     kw: 0.26, max: 1.0 },
];

/** Fixture headline figures the Overview readouts quote, in one place. */
export const DEMO_POWER_DRAW_KW = 2.41;
export const DEMO_SOLAR_KW = 3.1;

/** Build an SVG path from a 0..1 series across a viewbox. */
export function path(seriesValues: number[], w: number, h: number): string {
  const step = w / (seriesValues.length - 1);
  return seriesValues
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${((1 - v) * h).toFixed(1)}`)
    .join(' ');
}

/**
 * Deterministic seeded series — the same numbers on every render, so the
 * demo panels are stable for screenshots and never look like a live feed
 * that happens to be still.
 */
export function series(n: number, seed = 1, amp = 0.3, base = 0.5): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    out.push(Math.max(0.05, Math.min(0.95, base + Math.sin(i / 3.3) * amp * 0.6 + (r - 0.5) * amp)));
  }
  return out;
}

/** Full-scale of the energy chart's single shared axis, in kW. */
export const ENERGY_AXIS_MAX_KW = 4;
