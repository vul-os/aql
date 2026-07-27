// Energy — Aql's metering screen.
//
// Wired to the hub's read-only metering API (gateway/internal/energy, via
// energyState() in src/components/demo/liveState.ts, which calls
// GET /v1/accounts/{id}/energy/series and .../mix). This used to be a
// seeded fixture chart; it is not anymore. Everything below either comes
// from that API or says in plain words why it can't be shown — there is no
// silent fallback to a demo number.
//
// What's real on this screen:
//   - the live-meter readings panel at the top (device-engine instant
//     readings — unchanged, see LiveMeters below)
//   - the hourly consumption chart, drawn from EnergySeriesResponse.buckets
//   - the headline totals, computed by seriesTotals()
//   - the source mix, drawn as PROPORTIONAL bars only when
//     mixIsProportional() says the numbers are trustworthy enough to become
//     a percentage — otherwise it's a caveat and a plain list of kWh
//
// What's deliberately left out rather than faked:
//   - a per-circuit breakdown. The metering API has no sub-circuit
//     accounting (energy/mix reports source totals — grid/solar/battery —
//     not per-circuit), so there is nothing honest to draw here. Dropped
//     entirely rather than kept as a demo panel with a chip on it: a fixture
//     circuit list sitting next to a real energy chart is exactly the
//     "which of these is real" confusion this rewrite exists to remove.
//   - a live solar/grid TIME SERIES. /energy/mix reports source totals for
//     the whole window, not a per-hour split, so the chart is one series
//     (total draw), not the old two-line draw-vs-solar chart.
//
// The rule everything below defers to: `bucket.kwh === null` means nobody
// measured that period, which is a different fact from "measured zero
// electricity", and the two must never look the same on screen — a gap,
// not a bar of height zero.

import { useEffect, useId, useMemo, useState } from 'react';
import { PageHeader } from './AppLayout';
import { Card, StatBlock } from '@/components/ui/Card';
import { EngineChip, InertNote, Meter, StateDot } from '@/components/demo/DemoMarks';
import {
  availabilityState,
  engineFleet,
  engineNotice,
  readingValue,
  summaryLine,
  type EngineFleet,
} from '@/components/demo/engineState';
import {
  bucketCaveat,
  energyNotice,
  energyState,
  mixCaveat,
  mixIsProportional,
  seriesTotals,
  type EnergyState,
} from '@/components/demo/liveState';
import {
  api,
  friendlyApiError,
  type EnergyBucket,
  type EnergyMixResponse,
  type EngineDevice,
  type EngineReading,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';

const VB_W = 640;
const VB_H = 200;

export default function EnergyPage() {
  const { currentAccount } = useAuth();
  const [state, setState] = useState<EnergyState | null>(null);

  useEffect(() => {
    if (!currentAccount) return;
    let cancelled = false;
    void energyState(currentAccount.id, { grain: 'hour' }).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [currentAccount]);

  if (!currentAccount) {
    return (
      <>
        <PageHeader kicker="Metering" title="Energy" />
        <Card>
          <p className="text-ink/65 text-sm">No account loaded.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Metering"
        title="Energy"
        description="Consumption history and source mix for the whole site, read straight from your hub's metering engine."
      />

      <LiveMeters />

      {state === null ? (
        <Card>
          <p className="text-ink/55 text-sm">Loading…</p>
        </Card>
      ) : state.status !== 'live' ? (
        // An unmeasured hub and a broken fetch are different sentences —
        // energyNotice() says which one this is. No chart is drawn here:
        // an empty chart would be mistaken for a meter reading zero.
        <Card>
          <p className="text-ink/70 text-sm leading-relaxed">{energyNotice(state)}</p>
        </Card>
      ) : (
        <LiveEnergy state={state} />
      )}
    </>
  );
}

// ── live series + mix (real: the metering engine's own history) ────────────

function LiveEnergy({ state }: { state: Extract<EnergyState, { status: 'live' }> }) {
  const { series, mix } = state;
  const buckets = series.buckets;
  const totals = useMemo(() => seriesTotals(buckets), [buckets]);

  if (buckets.length === 0) {
    return (
      <Card className="mb-6">
        <p className="text-ink/70 text-sm leading-relaxed">{energyNotice(state)}</p>
      </Card>
    );
  }

  return (
    <>
      {series.pending_rollups > 0 && (
        <Card className="mb-6 py-4 border-gold/40">
          <p className="text-sm text-ink/75 leading-relaxed">
            The background worker still owes {series.pending_rollups}{' '}
            rollup{series.pending_rollups === 1 ? '' : 's'} — the most recent part of this chart
            may still move. That's "not summed yet," not "usage dropped."
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <StatCard
          label="Measured this window"
          value={totals.measuredKwh.toFixed(2)}
          unit="kWh"
          hint="the floor — what meters actually recorded"
        />
        <StatCard
          label="Total incl. estimated"
          value={totals.totalKwh.toFixed(2)}
          unit="kWh"
          hint={
            totals.estimatedKwh > 0
              ? `${totals.estimatedKwh.toFixed(2)} kWh of this was interpolated across a gap`
              : 'fully measured — nothing interpolated'
          }
        />
        <StatCard
          label="Bucket coverage"
          value={`${totals.measuredBuckets}/${totals.measuredBuckets + totals.unmeasuredBuckets}`}
          unit="measured"
          hint={
            totals.unmeasuredBuckets > 0
              ? `${totals.unmeasuredBuckets} period${totals.unmeasuredBuckets === 1 ? '' : 's'} with no reading at all`
              : 'every period in this window was measured'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Card className="lg:col-span-8 p-0 overflow-hidden">
          <EnergyChart buckets={buckets} grain={series.grain} />
        </Card>

        <Card className="lg:col-span-4 p-0 overflow-hidden flex flex-col">
          <SourceMix mix={mix} />
        </Card>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <Card>
      <StatBlock
        label={label}
        value={
          <span className="numeral">
            {value}
            <span className="ml-1.5 text-sm text-ink/45 font-sans">{unit}</span>
          </span>
        }
        hint={hint}
      />
    </Card>
  );
}

/**
 * One bar per bucket the hub returned, in the order it sent them.
 *
 * `bucket.kwh === null` renders as a gap — a dashed hairline the full
 * height of the chart — never a bar of height zero: an hour nobody
 * measured and an hour that used nothing are different facts, and drawing
 * them the same way hides an outage. A bucket the engine only trusts
 * partially (`bucketCaveat()` returns non-null) keeps its bar but draws it
 * lighter and dashed-edged, with the caveat as its tooltip, so the bars a
 * reader should actually trust are the visually loudest thing here.
 */
function EnergyChart({ buckets, grain }: { buckets: EnergyBucket[]; grain: string }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const ordered = useMemo(() => [...buckets].sort((a, b) => a.start - b.start), [buckets]);
  const n = ordered.length;

  // The axis ceiling comes from the data itself, headroomed by 20% so the
  // tallest bar doesn't touch the frame — never a fixture constant, which
  // would silently clip (or dwarf) whatever the hub actually measured.
  const axisMax = useMemo(() => {
    const max = ordered.reduce((m, b) => Math.max(m, b.kwh ?? 0), 0);
    return max > 0 ? max * 1.2 : 1;
  }, [ordered]);

  const step = VB_W / n;
  const barW = step * 0.6;
  const xFor = (i: number) => i * step + step / 2;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.floor(frac * n))));
  }

  const gridLines = [0.25, 0.5, 0.75].map((f) => ({ v: axisMax * f, y: (1 - f) * VB_H }));
  const hasGap = ordered.some((b) => b.kwh === null);
  const hoveredBucket = hover !== null ? ordered[hover] : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
          Consumption · {n} {grain} bucket{n === 1 ? '' : 's'}
        </span>
      </div>

      <div className="px-6 pt-5 pb-4">
        <div className="flex gap-3">
          {/* y axis — a chart without units is not a chart */}
          <div className="w-12 shrink-0 h-[200px] flex flex-col justify-between text-right font-mono text-[10px] text-ink/40 tabular-nums">
            <span>{axisMax.toFixed(1)} kWh</span>
            <span>{(axisMax / 2).toFixed(1)}</span>
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
              aria-label={`Hourly consumption for the last ${n} periods, read from your hub's metering engine. ${
                hasGap
                  ? 'Some periods have no reading at all and are shown as gaps, not zero bars.'
                  : 'Every period in this window was measured.'
              }`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--terracotta)" stopOpacity="0.9" />
                  <stop offset="1" stopColor="var(--terracotta)" stopOpacity="0.5" />
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

              {ordered.map((b, i) => {
                const x = xFor(i);
                const key = `${b.device_key}-${b.metric}-${b.start}`;

                if (b.kwh === null) {
                  return (
                    <line
                      key={key}
                      x1={x}
                      y1={0}
                      x2={x}
                      y2={VB_H}
                      stroke="var(--ink)"
                      strokeOpacity="0.25"
                      strokeWidth="1.5"
                      strokeDasharray="3 4"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{bucketCaveat(b) ?? 'nothing was measured in this period'}</title>
                    </line>
                  );
                }

                const h = Math.max(1, (b.kwh / axisMax) * VB_H);
                const caveat = bucketCaveat(b);
                return (
                  <rect
                    key={key}
                    x={x - barW / 2}
                    y={VB_H - h}
                    width={barW}
                    height={h}
                    rx={2}
                    fill={`url(#${gradientId})`}
                    opacity={caveat ? 0.5 : 1}
                    stroke={caveat ? 'var(--ink)' : 'none'}
                    strokeOpacity={caveat ? 0.35 : 0}
                    strokeDasharray={caveat ? '3 2' : undefined}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${b.kwh.toFixed(2)} kWh${caveat ? ` — ${caveat}` : ''}`}</title>
                  </rect>
                );
              })}

              {hover !== null && (
                <line
                  x1={xFor(hover)}
                  y1="0"
                  x2={xFor(hover)}
                  y2={VB_H}
                  stroke="var(--ink)"
                  strokeOpacity="0.3"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {hoveredBucket && hover !== null && (
              <div
                className="pointer-events-none absolute top-2 z-10 rounded-xl bg-ink text-paper px-3 py-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] text-xs whitespace-nowrap"
                style={{
                  left: `${(hover / n) * 100}%`,
                  transform: `translateX(${hover > n / 2 ? '-100%' : '0'})`,
                  marginLeft: hover > n / 2 ? -8 : 8,
                }}
              >
                <p className="text-[10px] uppercase tracking-[0.16em] opacity-60">
                  {new Date(hoveredBucket.start * 1000).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
                <p className="mt-1 font-mono tabular-nums">
                  {hoveredBucket.kwh === null ? 'not measured' : `${hoveredBucket.kwh.toFixed(2)} kWh`}
                </p>
                {bucketCaveat(hoveredBucket) && (
                  <p className="mt-1 max-w-[220px] whitespace-normal text-[11px] opacity-75">
                    {bucketCaveat(hoveredBucket)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The source breakdown. Drawn as proportional bars ONLY when
 * mixIsProportional() says the numbers add up to the truth. Otherwise this
 * renders mixCaveat() and lists the same figures as absolute kWh — never as
 * a percentage a reader could mistake for the whole picture.
 */
function SourceMix({ mix }: { mix: EnergyMixResponse | null }) {
  const proportional = mixIsProportional(mix);
  const caveat = mixCaveat(mix);
  const totals = mix?.totals ?? [];
  const sumKwh = totals.reduce((s, t) => s + t.kwh, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Source mix</span>
      </div>
      <div className="p-6 flex-1 flex flex-col gap-5">
        {totals.length === 0 ? (
          <p className="text-sm text-ink/60">
            {caveat ?? 'No source channels reported for this window.'}
          </p>
        ) : (
          totals.map((t) => {
            const pct = proportional && sumKwh > 0 ? (t.kwh / sumKwh) * 100 : null;
            return (
              <div key={`${t.source}-${t.flow}`}>
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <span className="text-sm text-ink capitalize">
                    {t.source} · {t.flow}
                  </span>
                  <span className="font-mono text-xs text-ink/60 tabular-nums">
                    {t.kwh.toFixed(2)} kWh{pct !== null ? ` · ${Math.round(pct)}%` : ''}
                  </span>
                </div>
                {/* A pie/bar only gets drawn proportionally when both
                    complete AND attributed hold — otherwise the numbers
                    above are the whole story, deliberately not a Meter. */}
                {proportional && <Meter fraction={(pct ?? 0) / 100} />}
              </div>
            );
          })
        )}
        {mix && (
          <div className="mt-auto flex items-center justify-between pt-4 border-t border-ink/8">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Net consumption</span>
            <span className="font-mono text-sm text-ink/85 tabular-nums">
              {mix.net_consumption_kwh.toFixed(2)} kWh
            </span>
          </div>
        )}
        {caveat && <InertNote>{caveat}</InertNote>}
      </div>
    </>
  );
}

// ── live meters (real: device-engine instant readings) ──────────────────────

/** Devices whose readings are genuinely metering: the energy.meter capability. */
const METER_CAPABILITY = 'energy.meter';

/**
 * The device-engine's instant meter readings. Distinct from the history
 * above: this is "what a meter reports right now" (engineFleet /
 * engineReadings), the series/mix above is "what the metering engine has
 * summed over time" (energyState). A hub can have one without the other.
 *
 * When the engine reports metering devices, their readings are shown as
 * they came back. When it doesn't, this says which of the four reasons
 * applies — an engine that isn't configured (the default), a hub too old to
 * serve it, a failed request, or an engine with no meters. It never
 * quietly falls through and lets the reader assume something was live.
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
                'Your device engine is running, but none of the devices it reports is a meter.'}
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
        <InertNote>Read from your hub just now — units are whatever the driver reported.</InertNote>
      </div>
    </Card>
  );
}

function isMeter(d: EngineDevice): boolean {
  return d.capabilities.includes(METER_CAPABILITY) || d.kind === 'energy';
}
