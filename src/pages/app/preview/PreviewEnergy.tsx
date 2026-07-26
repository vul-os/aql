import { useId, useMemo, useState } from 'react';
import { PageHeader } from '../AppLayout';
import { Card, StatBlock } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { ENERGY_AXIS_MAX_KW, circuits, path, series } from './demoData';
import { DemoBanner, InertNote, Meter } from './shared';

// 48 half-hour samples = the last 24 hours. Seeded, so the same curve renders
// on every load — a preview that never pretends to tick.
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

export default function PreviewEnergyPage() {
  return (
    <>
      <PageHeader
        kicker="Preview · demo data"
        title="Energy"
        description="The shape of the metering screen. The curve, the source split and the circuit list are all fixtures."
      />

      <DemoBanner what="Every figure on this page" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <Card>
          <StatBlock label="Now drawing" value={<Numeral value="2.41" unit="kW" />} />
        </Card>
        <Card>
          <StatBlock label="Solar output" value={<Numeral value="3.10" unit="kW" />} />
        </Card>
        <Card>
          <StatBlock label="Today" value={<Numeral value="18.4" unit="kWh" />} />
        </Card>
        <Card>
          <StatBlock label="Est. cost" value={<Numeral value="R42" unit="today" />} />
        </Card>
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
        <PanelHead title="Circuits" trailing={`${circuits.length} monitored`} />
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

function Numeral({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="numeral">
      {value}
      <span className="ml-1.5 text-sm text-ink/45 font-sans">{unit}</span>
    </span>
  );
}

function PanelHead({ title, trailing }: { title: string; trailing?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-ink/8">
      <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">{title}</span>
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
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
          Power · last 24 h
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

      <div className={cn('px-6 pb-6')}>
        <InertNote>
          A seeded curve, not a meter. Real ingestion and historical rollups are ROADMAP Phase 4.
        </InertNote>
      </div>
    </>
  );
}
