// Energy — Aql's metering screen.
//
// One panel here can be real: if the hub's device engine has a device with the
// energy.meter capability, its readings are shown at the top, chipped
// "Engine". Everything below that — the 24h curve, the source mix, the
// circuits, the headline stats — is still the built-in demo dataset, because
// there is no metering *pipeline*: no historical rollups, no source-mix
// accounting, no per-circuit ingestion (ROADMAP Phase 4). Each of those panels
// carries its own demo chip and its own note.
//
// The curve is seeded, not animated — a chart that ticks is a chart claiming
// to measure something.

import { useEffect, useId, useMemo, useState } from 'react';
import { PageHeader } from './AppLayout';
import { Card, StatBlock } from '@/components/ui/Card';
import { ENERGY_AXIS_MAX_KW, circuits, path, series } from '@/lib/demoData';
import { DemoChip, EngineChip, InertNote, Meter, StateDot } from '@/components/demo/DemoMarks';
import {
  availabilityState,
  engineFleet,
  engineNotice,
  readingValue,
  summaryLine,
  type EngineFleet,
} from '@/components/demo/engineState';
import { api, friendlyApiError, type EngineDevice, type EngineReading } from '@/lib/api';

// 48 half-hour samples = the last 24 hours. Seeded, so the same curve renders
// on every load — a demo panel that never pretends to tick.
const POINTS = 48;
const VB_W = 640;
const VB_H = 200;

const drawSeries = series(POINTS, 7, 0.4, 0.5);
const solarSeries = series(POINTS, 3, 0.5, 0.42);

const kw = (v: number) => v * ENERGY_AXIS_MAX_KW;
/** Sample index -> hours before now. */
const hoursAgo = (i: number) => ((POINTS - 1 - i) * 24) / (POINTS - 1);

const SOURCES = [
  { name: 'Solar', kw: 3.1, pct: 56 },
  { name: 'Grid', kw: 1.8, pct: 33 },
  { name: 'Battery', kw: 0.61, pct: 11 },
];

export default function EnergyPage() {
  return (
    <>
      <PageHeader
        kicker="Metering"
        title="Energy"
        description="Draw, generation and per-circuit load for the whole site. Live meters your device engine reports are at the top; everything below them is fixture data until meter ingestion lands."
      />

      <LiveMeters />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <DemoStat label="Now drawing" value="2.41" unit="kW" />
        <DemoStat label="Solar output" value="3.10" unit="kW" />
        <DemoStat label="Today" value="18.4" unit="kWh" />
        <DemoStat label="Est. cost" value="R42" unit="today" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Card className="lg:col-span-8 p-0 overflow-hidden">
          <PowerChart />
        </Card>

        <Card className="lg:col-span-4 p-0 overflow-hidden flex flex-col">
          <PanelHead title="Source mix" />
          <div className="p-6 flex-1 flex flex-col gap-5">
            {SOURCES.map((s) => (
              <div key={s.name}>
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <span className="text-sm text-ink">{s.name}</span>
                  <span className="font-mono text-xs text-ink/60 tabular-nums">
                    {s.kw.toFixed(2)} kW · {s.pct}%
                  </span>
                </div>
                <Meter fraction={s.pct / 100} />
              </div>
            ))}
            <div className="mt-auto flex items-center justify-between pt-4 border-t border-ink/8">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Net export</span>
              <span className="font-mono text-sm text-moss tabular-nums">+0.69 kW</span>
            </div>
            <InertNote>
              A fixed split, not an accounting of live meters. Source-mix accounting is ROADMAP
              Phase 4.
            </InertNote>
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <PanelHead title="Circuits" trailing={`${circuits.length} listed`} />
        <div className="p-6 flex flex-col gap-4">
          {circuits.map((c) => (
            <div
              key={c.name}
              className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-4 sm:gap-5"
            >
              <span className="text-sm text-ink/75 truncate">{c.name}</span>
              <Meter fraction={c.kw / c.max} idle={c.kw === 0} />
              <span className="font-mono text-xs text-ink/60 tabular-nums text-right">
                {c.kw.toFixed(2)} kW
              </span>
            </div>
          ))}
        </div>
        <div className="px-6 pb-6">
          <InertNote>
            Circuit-level metering needs real meter/inverter ingestion — ROADMAP Phase 4. These
            bars are fixed values, not readings.
          </InertNote>
        </div>
      </Card>
    </>
  );
}

// ── live meters (real: device-engine-backed) ────────────────────────────────

/** Devices whose readings are genuinely metering: the energy.meter capability. */
const METER_CAPABILITY = 'energy.meter';

/**
 * The only panel on this screen that can be real.
 *
 * When the engine reports metering devices, their readings are shown as they
 * came back. When it doesn't, this says which of the four reasons applies —
 * an engine that isn't configured (the default), a hub too old to serve it, a
 * failed request, or an engine with no meters. It never quietly falls through
 * to the fixture below and lets the reader assume it was live.
 */
function LiveMeters() {
  const [fleet, setFleet] = useState<EngineFleet | null>(null);
  const [readings, setReadings] = useState<Record<string, EngineReading[] | { error: string }>>({});

  useEffect(() => {
    let cancelled = false;
    void engineFleet().then(async (f) => {
      if (cancelled) return;
      setFleet(f);
      const meters = f.devices.filter(isMeter).slice(0, 8);
      for (const m of meters) {
        try {
          const res = await api.engineReadings(m.key);
          if (!cancelled) setReadings((prev) => ({ ...prev, [m.key]: res.readings ?? [] }));
        } catch (err) {
          if (!cancelled) {
            setReadings((prev) => ({
              ...prev,
              [m.key]: { error: friendlyApiError(err, 'Could not read this meter.') },
            }));
          }
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (fleet === null) return null;

  const meters = fleet.devices.filter(isMeter);
  const notice = engineNotice(fleet);

  if (meters.length === 0) {
    return (
      <Card className="mb-6 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 shrink-0">
            <StateDot state={fleet.status === 'error' ? 'alert' : 'unknown'} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Live meters</p>
            <p className="mt-1 text-sm text-ink/70 leading-relaxed">
              {notice ??
                'Your device engine is running, but none of the devices it reports is a meter.'}{' '}
              Everything below is fixture data.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
        <span className="inline-flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Live meters</span>
          <EngineChip />
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40">
          {meters.length} reporting to your hub
        </span>
      </div>
      <ul className="divide-y divide-ink/8">
        {meters.map((m) => {
          const r = readings[m.key];
          return (
            <li key={m.key} className="px-6 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <StateDot state={availabilityState(m.availability)} />
                  <span className="text-sm text-ink truncate">{m.name}</span>
                  {m.zone && (
                    <span className="text-[10px] uppercase tracking-[0.16em] text-ink/40 truncate">
                      {m.zone}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-ink/55 truncate">{summaryLine(m)}</span>
              </div>
              {r === undefined && <p className="mt-2 text-xs text-ink/45">Reading…</p>}
              {r && 'error' in r && <p className="mt-2 text-xs text-terracotta-deep">{r.error}</p>}
              {Array.isArray(r) && r.length === 0 && (
                <p className="mt-2 text-xs text-ink/45">The driver returned no readings.</p>
              )}
              {Array.isArray(r) && r.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  {r.map((reading) => (
                    <span
                      key={`${reading.metric}-${reading.at}`}
                      className="inline-flex items-baseline gap-2"
                    >
                      <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45">
                        {reading.metric}
                      </span>
                      <span className="font-mono text-sm text-ink/85 tabular-nums">
                        {readingValue(reading)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-6 py-4 border-t border-ink/8">
        <InertNote>
          Read from your hub just now — units are whatever the driver reported. The panels below
          are not: they are fixture data and say so.
        </InertNote>
      </div>
    </Card>
  );
}

function isMeter(d: EngineDevice): boolean {
  return d.capabilities.includes(METER_CAPABILITY) || d.kind === 'energy';
}

/** A readout that is entirely fixture data — the chip sits on the number. */
function DemoStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card>
      <DemoChip className="absolute top-4 right-4" label="Demo" />
      <StatBlock
        label={label}
        value={
          <span className="numeral">
            {value}
            <span className="ml-1.5 text-sm text-ink/45 font-sans">{unit}</span>
          </span>
        }
      />
    </Card>
  );
}

function PanelHead({ title, trailing }: { title: string; trailing?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
      <span className="inline-flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">{title}</span>
        <DemoChip />
      </span>
      {trailing && (
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{trailing}</span>
      )}
    </div>
  );
}

/**
 * Two series, one shared axis (both are kW — never two y-scales).
 *
 * Identity is carried by three things, not one: a legend, a direct end-of-line
 * label, and a stroke pattern (solid vs dashed). The colour pair is terracotta
 * + ink, which is the only pairing in this token set that clears
 * colour-blind separation in both themes; ink flips with `data-theme`
 * automatically, so dark mode is the same encoding rather than an inverted
 * guess.
 */
function PowerChart() {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const drawPath = useMemo(() => path(drawSeries, VB_W, VB_H), []);
  const solarPath = useMemo(() => path(solarSeries, VB_W, VB_H), []);

  const gridLines = [1, 2, 3].map((v) => ({ v, y: (1 - v / ENERGY_AXIS_MAX_KW) * VB_H }));

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(POINTS - 1, Math.round(frac * (POINTS - 1)))));
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
        <span className="inline-flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Power · last 24 h
          </span>
          <DemoChip />
        </span>
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.16em] text-ink/50">
          <span className="inline-flex items-center gap-2">
            <svg width="16" height="6" aria-hidden className="overflow-visible">
              <line x1="0" y1="3" x2="16" y2="3" stroke="var(--terracotta)" strokeWidth="2" />
            </svg>
            Draw
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width="16" height="6" aria-hidden className="overflow-visible">
              <line
                x1="0"
                y1="3"
                x2="16"
                y2="3"
                stroke="var(--ink)"
                strokeOpacity="0.55"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            </svg>
            Solar
          </span>
        </div>
      </div>

      <div className="px-6 pt-5 pb-4">
        <div className="flex gap-3">
          {/* y axis — a chart without units is not a chart */}
          <div className="w-10 shrink-0 h-[200px] flex flex-col justify-between text-right font-mono text-[10px] text-ink/40 tabular-nums">
            <span>{ENERGY_AXIS_MAX_KW.toFixed(0)} kW</span>
            <span>{(ENERGY_AXIS_MAX_KW / 2).toFixed(0)}</span>
            <span>0</span>
          </div>

          <div
            className="relative flex-1 min-w-0"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              className="block w-full h-[200px]"
              role="img"
              aria-label={`Demo power curve over the last 24 hours. Draw peaks near ${kw(Math.max(...drawSeries)).toFixed(1)} kilowatts; solar peaks near ${kw(Math.max(...solarSeries)).toFixed(1)} kilowatts. Fixture data, not a live reading.`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--terracotta)" stopOpacity="0.20" />
                  <stop offset="1" stopColor="var(--terracotta)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {gridLines.map((g) => (
                <line
                  key={g.v}
                  x1="0"
                  y1={g.y}
                  x2={VB_W}
                  y2={g.y}
                  stroke="var(--ink)"
                  strokeOpacity="0.07"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              <path d={`${drawPath} L${VB_W} ${VB_H} L0 ${VB_H} Z`} fill={`url(#${gradientId})`} />
              <path
                d={solarPath}
                fill="none"
                stroke="var(--ink)"
                strokeOpacity="0.55"
                strokeWidth="2"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={drawPath}
                fill="none"
                stroke="var(--terracotta)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />

              {hover !== null && (
                <line
                  x1={(hover * VB_W) / (POINTS - 1)}
                  y1="0"
                  x2={(hover * VB_W) / (POINTS - 1)}
                  y2={VB_H}
                  stroke="var(--ink)"
                  strokeOpacity="0.3"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {hover !== null && (
              <div
                className="pointer-events-none absolute top-2 z-10 rounded-xl bg-ink text-paper px-3 py-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] text-xs whitespace-nowrap"
                style={{
                  left: `${(hover / (POINTS - 1)) * 100}%`,
                  transform: `translateX(${hover > POINTS / 2 ? '-100%' : '0'})`,
                  marginLeft: hover > POINTS / 2 ? -8 : 8,
                }}
              >
                <p className="text-[10px] uppercase tracking-[0.16em] opacity-60">
                  {hoursAgo(hover) < 0.5 ? 'now' : `${hoursAgo(hover).toFixed(1)} h ago`}
                </p>
                <p className="mt-1 font-mono tabular-nums">
                  Draw {kw(drawSeries[hover]).toFixed(2)} kW
                </p>
                <p className="font-mono tabular-nums opacity-75">
                  Solar {kw(solarSeries[hover]).toFixed(2)} kW
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="ml-[3.25rem] mt-2 flex justify-between font-mono text-[10px] text-ink/40">
          {['−24 h', '−18 h', '−12 h', '−6 h', 'now'].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6">
        <InertNote>
          A seeded curve, not a meter. Real ingestion and historical rollups are ROADMAP Phase 4.
        </InertNote>
      </div>
    </>
  );
}
