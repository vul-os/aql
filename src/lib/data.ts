// Shared mock dataset for the Aql console (browser/demo mode).
// The real device engine will replace this behind the same shapes.

export type DeviceState = 'live' | 'warn' | 'alert' | 'off';

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

export const devices: Device[] = [
  { id: 'cam-gate',   name: 'Front Gate Camera', kind: 'Camera',   zone: 'Perimeter', state: 'live',  read: '1080p · 24fps', detail: 'H.264 · motion zones armed', seen: 'now' },
  { id: 'cam-yard',   name: 'Yard Camera',       kind: 'Camera',   zone: 'Exterior',  state: 'live',  read: '1080p · 24fps', detail: 'H.264 · night mode', seen: 'now' },
  { id: 'lights-grd', name: 'Garden Lights',     kind: 'Lighting',  zone: 'Exterior',  state: 'live',  read: '62% · warm',    detail: 'Zigbee group · 6 fixtures', seen: '2m' },
  { id: 'mower-m1',   name: 'Mower — Zana M1',   kind: 'Robot',     zone: 'Lawn',      state: 'warn',  read: 'charging · 81%', detail: 'docked · next cut 06:00', seen: '4m' },
  { id: 'thermostat', name: 'Thermostat',        kind: 'Climate',   zone: 'Interior',  state: 'live',  read: '21.5°C',        detail: 'heat · schedule active', seen: 'now' },
  { id: 'secbot-3',   name: 'Security Bot',      kind: 'Robot',     zone: 'Sector 3',  state: 'live',  read: 'patrol',        detail: 'route B · 74% battery', seen: 'now' },
  { id: 'cleanbot',   name: 'Cleaning Bot',      kind: 'Robot',     zone: 'Interior',  state: 'off',   read: 'docked',        detail: 'idle · next run 09:00', seen: '1h' },
  { id: 'solar',      name: 'Solar Array',       kind: 'Energy',    zone: 'Roof',      state: 'live',  read: '3.10 kW',       detail: '12 panels · MPPT nominal', seen: 'now' },
  { id: 'meter',      name: 'Energy Meter',      kind: 'Energy',    zone: 'Utility',   state: 'live',  read: '2.41 kW',       detail: 'grid import · 230V', seen: 'now' },
  { id: 'tank',       name: 'Water Tank',        kind: 'Sensor',    zone: 'Utility',   state: 'alert', read: 'level 12%',     detail: 'below threshold · pump off', seen: '6m' },
  { id: 'gate-lock',  name: 'Gate Lock',         kind: 'Access',    zone: 'Perimeter', state: 'live',  read: 'locked',        detail: 'last opened 12:04', seen: '2h' },
  { id: 'door-lock',  name: 'Front Door',        kind: 'Access',    zone: 'Interior',  state: 'live',  read: 'locked',        detail: 'auto-lock armed', seen: '3h' },
];

export interface EventRow { t: string; tag: string; msg: string; sev: 'ok' | 'warn' | 'alert'; }

export const events: EventRow[] = [
  { t: '14:22:07', tag: 'MOTION', msg: 'Front Gate Camera · person detected', sev: 'warn' },
  { t: '14:21:52', tag: 'ENERGY', msg: 'Solar Array crossed 3.0 kW', sev: 'ok' },
  { t: '14:20:31', tag: 'ROBOT',  msg: 'Mower returned to dock · battery 81%', sev: 'ok' },
  { t: '14:18:04', tag: 'ALERT',  msg: 'Water Tank level below threshold', sev: 'alert' },
  { t: '14:15:40', tag: 'AUTO',   msg: 'Rule "Dusk lights" armed', sev: 'ok' },
  { t: '14:09:12', tag: 'ACCESS', msg: 'Front Door locked automatically', sev: 'ok' },
  { t: '14:02:55', tag: 'ROBOT',  msg: 'Security Bot started patrol route B', sev: 'ok' },
];

export interface Automation {
  name: string; when: string; then: string; enabled: boolean; runs: number; last: string;
}

export const automations: Automation[] = [
  { name: 'Dusk lights',        when: 'sunset − 15m',            then: 'Garden Lights → 60% warm', enabled: true,  runs: 214, last: 'today' },
  { name: 'Away arm',           when: 'everyone leaves',         then: 'Cameras + Security Bot patrol', enabled: true,  runs: 88,  last: '2d' },
  { name: 'Morning mow',        when: 'weekday 06:00 · dry',     then: 'Mower → cut lawn', enabled: true,  runs: 41,  last: 'today' },
  { name: 'Peak shave',         when: 'grid > 3kW & battery >50%', then: 'Draw from battery', enabled: true,  runs: 132, last: 'today' },
  { name: 'Tank refill',        when: 'water level < 20%',       then: 'Notify + open valve', enabled: false, runs: 7,   last: '6m' },
  { name: 'Night lock',         when: '23:00',                   then: 'Lock all doors + gate', enabled: true,  runs: 190, last: 'yesterday' },
];

export interface Circuit { name: string; kw: number; max: number; }
export const circuits: Circuit[] = [
  { name: 'HVAC',        kw: 0.92, max: 2.0 },
  { name: 'Kitchen',     kw: 0.61, max: 3.0 },
  { name: 'Water pump',  kw: 0.00, max: 1.5 },
  { name: 'Lighting',    kw: 0.18, max: 0.8 },
  { name: 'EV charger',  kw: 0.44, max: 7.2 },
  { name: 'Robots',      kw: 0.26, max: 1.0 },
];

/** Build an SVG path from a 0..1 series across a viewbox. */
export function path(series: number[], w: number, h: number): string {
  const step = w / (series.length - 1);
  return series
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${((1 - v) * h).toFixed(1)}`)
    .join(' ');
}

/** Deterministic-ish seeded series so screenshots are stable-ish. */
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
