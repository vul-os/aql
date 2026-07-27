// Aql's Overview — the hub's front page, recovered from the pre-fold console
// (`src/routes/+page.svelte` at commit bf99a4d) and merged with the real,
// gateway-backed dashboard that replaced it.
//
// Three kinds of thing share this screen on purpose: what your gateway
// reports (opens today, access points, recent activity, locations), what the
// device engine reports (live device tiles, chipped "Engine"), and what the
// built-in demo dataset still stands in for (power draw, alerts, the event
// log, and fleet tiles for kinds no driver on this hub serves). Each is
// marked where it sits — <DemoChip /> on the fixture panels, <EngineChip />
// on engine-backed ones, nothing on the gateway's own. See
// src/components/demo/DemoMarks.tsx.
//
// Deliberately NOT ported from the Svelte original: its "Live signal" wave,
// which re-randomised on a 1s interval. A chart that moves is a chart that
// claims to be measuring something; there is no telemetry pipeline. The same
// reasoning killed the fake camera REC dot — don't bring either back.
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { AccessPointAction } from '@/components/access/AccessPointAction';
import { CreateAccessPointModal } from '@/components/access/CreateAccessPointModal';
import { DemoChip, EngineChip, InertNote, StateDot } from '@/components/demo/DemoMarks';
import {
  availabilityState,
  engineFleet,
  engineNotice,
  kindLabel,
  summaryLine,
  type EngineFleet,
} from '@/components/demo/engineState';
import { useAuth } from '@/lib/auth';
import {
  api,
  type AccessPointDetail,
  type AccountSummary,
  type LocationRow,
} from '@/lib/api';
import { DEMO_POWER_DRAW_KW, demoDevices, events as demoEvents } from '@/lib/demoData';
import { fromUnix } from '@/lib/time';
import { cn } from '@/lib/cn';

function relativeTime(sec: number): string {
  const d = fromUnix(sec);
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))} h ago`;
  return d.toLocaleDateString();
}

function shortTime(sec: number): string {
  const d = fromUnix(sec);
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function trendDelta(today: number, yesterday: number): string {
  if (yesterday === 0) return today === 0 ? '—' : `+${today} new`;
  const diff = today - yesterday;
  if (diff === 0) return 'same as yesterday';
  return `${diff > 0 ? '+' : ''}${diff} vs yesterday`;
}

function greetForHour(h: number): string {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// /analytics/accounts/:id/summary isn't ported to the Go gateway yet (see
// gateway/README.md's porting map). An unrouted gateway path can come back
// as a non-JSON 200 (the portal's SPA fallback) instead of throwing, so
// validate the shape before trusting it — and never let its absence block
// the rest of the dashboard (locations, access points) from loading.
function isRealSummary(data: unknown): data is AccountSummary {
  if (!data || typeof data !== 'object') return false;
  return Array.isArray((data as Partial<AccountSummary>).recent_activity);
}

type QuotaWatchEntry = {
  id: string;
  name: string;
  opens: number;
  cap: number;
};

// Fixture-derived headline figures, computed once (never on an interval).
const DEMO_ALERTS = demoDevices.filter((d) => d.state === 'alert').length;
const DEMO_REPORTING = demoDevices.filter((d) => d.state !== 'off').length;

export default function Overview() {
  const { user, currentAccount } = useAuth();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [accessPoints, setAccessPoints] = useState<AccessPointDetail[]>([]);
  // The device engine, or the honest reason there isn't one. Never throws and
  // never blocks the dashboard — see engineFleet().
  const [engine, setEngine] = useState<EngineFleet | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateAp, setShowCreateAp] = useState(false);
  // Locations whose daily open quota is ≥80% consumed (admin-only heads-up).
  const [quotaWatch, setQuotaWatch] = useState<QuotaWatchEntry[]>([]);
  const isAdmin = currentAccount?.role === 'owner' || currentAccount?.role === 'admin';

  const refreshSummary = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const s = await api.accountSummary(currentAccount.id);
      if (isRealSummary(s)) setSummary(s);
    } catch {
      // silent — stays stale
    }
  }, [currentAccount]);

  const load = useCallback(async () => {
    if (!currentAccount) return;
    setDataLoaded(false);
    void engineFleet().then(setEngine);
    try {
      // Summary isn't available on every gateway (see isRealSummary above) —
      // its absence must never block locations/access points from loading,
      // otherwise a fully set-up account falls back to the onboarding screen.
      const [s, l, ap] = await Promise.all([
        api.accountSummary(currentAccount.id).catch(() => null),
        api.locationsList(currentAccount.id),
        api.accessPoints(currentAccount.id).catch(() => ({ access_points: [] })),
      ]);
      setSummary(isRealSummary(s) ? s : null);
      setLocations(l.locations);
      setAccessPoints(ap.access_points);
      // Non-blocking: check each location's daily quota consumption so admins
      // get a heads-up chip when a cap is ≥80% used. Failures are silent —
      // the chip is informational only.
      if (isAdmin) {
        void (async () => {
          const checks = await Promise.all(
            l.locations.slice(0, 8).map(async (loc) => {
              try {
                return { loc, s: await api.locationSummary(loc.id) };
              } catch {
                return null;
              }
            }),
          );
          const near: QuotaWatchEntry[] = [];
          for (const c of checks) {
            if (!c) continue;
            const cap = c.s.today.max_opens_per_location_per_day;
            if (cap !== null && cap > 0 && c.s.today.opens / cap >= 0.8) {
              near.push({ id: c.loc.id, name: c.loc.name, opens: c.s.today.opens, cap });
            }
          }
          setQuotaWatch(near);
        })();
      } else {
        setQuotaWatch([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setDataLoaded(true);
    }
  }, [currentAccount, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const greeting = greetForHour(new Date().getHours());
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  // Fleet arithmetic. "Reporting" counts only devices the engine says are
  // online: a device whose availability is unknown (never heard from since the
  // engine started) is in the total but not in the reporting count, because
  // nobody has heard from it.
  const engineDevices = engine?.devices ?? [];
  const engineReporting = engineDevices.filter(
    (d) => availabilityState(d.availability) === 'live',
  ).length;
  const fleetTotal = accessPoints.length + engineDevices.length + demoDevices.length;
  const fleetReporting = accessPoints.length + engineReporting + DEMO_REPORTING;
  const engineLine = engine ? engineNotice(engine) : null;

  // Wait for data before deciding which screen to show — avoids flash.
  if (!dataLoaded) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-ink/40 text-sm">
        Loading…
      </div>
    );
  }

  // No access points yet → show onboarding instead of an empty dashboard.
  if (accessPoints.length === 0) {
    return (
      <>
        <Onboarding
          greeting={greeting}
          firstName={firstName}
          locationName={locations[0]?.name ?? currentAccount?.name}
          onAddAccessPoint={() => setShowCreateAp(true)}
        />
        {showCreateAp && (
          <CreateAccessPointModal
            onClose={() => setShowCreateAp(false)}
            onCreated={() => {
              setShowCreateAp(false);
              load();
            }}
          />
        )}
      </>
    );
  }

  // Regular dashboard — user has at least one access point.
  return (
    <>
      {/* No min-height stretch here: Overview continues below with the fleet,
          event log and activity, so the quick-access row sizes to content. */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <h1 className="font-display-tight text-2xl sm:text-3xl lg:text-[36px] leading-tight tracking-[-0.02em] min-w-0">
            {greeting}, <span className="text-terracotta">{firstName}</span>.
          </h1>
          {summary && (
            <p className="text-xs sm:text-sm text-ink/55 shrink-0">
              {summary.opens_today > 0
                ? `${summary.opens_today.toLocaleString()} ${summary.opens_today === 1 ? 'open' : 'opens'} today`
                : 'Quiet today.'}
            </p>
          )}
        </header>

        {error && (
          <Card className="border-terracotta/40 p-4">
            <p className="text-sm text-terracotta-deep">{error}</p>
          </Card>
        )}

        {quotaWatch.length > 0 && (
          <div className="flex flex-wrap gap-2" role="status">
            {quotaWatch.map((q) => {
              const pct = Math.min(999, Math.round((q.opens / q.cap) * 100));
              const atCap = q.opens >= q.cap;
              return (
                <span
                  key={q.id}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-ink/75',
                    atCap
                      ? 'border-terracotta/40 bg-terracotta/10'
                      : 'border-gold/40 bg-gold/10',
                  )}
                >
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', atCap ? 'bg-terracotta' : 'bg-gold')}
                    aria-hidden
                  />
                  {q.name}
                  <span className="font-mono tabular-nums text-ink/85">
                    {q.opens.toLocaleString()}/{q.cap.toLocaleString()}
                  </span>
                  <span className="text-ink/50">
                    daily opens · {pct}%{atCap ? ' · cap reached' : ''}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* Readouts. Card 1 is your gateway's own count; cards 2–4 are the
            estate at large, which the demo dataset stands in for until the
            device engine lands — each says so on the card. */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <Card className="bg-ink text-paper p-4 sm:p-5">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-paper/55">Opens today</p>
            <p className="font-display text-3xl sm:text-4xl mt-1.5 sm:mt-2 leading-none tabular-nums">
              {summary ? summary.opens_today.toLocaleString() : '—'}
            </p>
            <p className="text-[10px] sm:text-xs text-paper/60 mt-1 sm:mt-1.5 truncate">
              {summary ? trendDelta(summary.opens_today, summary.opens_yesterday) : 'across your access points'}
            </p>
          </Card>

          <Card className="p-4 sm:p-5">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-ink/55">Devices</p>
            <p className="font-display text-3xl sm:text-4xl mt-1.5 sm:mt-2 leading-none tabular-nums">
              {fleetReporting}
              <span className="text-sm text-ink/40 ml-1.5">/ {fleetTotal}</span>
            </p>
            <p className="text-[10px] sm:text-xs text-ink/55 mt-1 sm:mt-1.5 leading-snug">
              {accessPoints.length} on your hub
              {engineDevices.length > 0 && ` · ${engineDevices.length} engine`} ·{' '}
              {demoDevices.length} demo
            </p>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-ink/55">Power draw</p>
              <DemoChip label="Demo" />
            </div>
            <p className="font-display text-3xl sm:text-4xl mt-1.5 sm:mt-2 leading-none tabular-nums">
              {DEMO_POWER_DRAW_KW.toFixed(2)}
              <span className="text-sm text-ink/40 ml-1.5">kW</span>
            </p>
            <p className="text-[10px] sm:text-xs text-ink/55 mt-1 sm:mt-1.5 truncate">
              fixed figure · no meter attached
            </p>
          </Card>

          <Card className={cn('p-4 sm:p-5', DEMO_ALERTS > 0 && 'border-terracotta/30')}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-ink/55">Alerts</p>
              <DemoChip label="Demo" />
            </div>
            <p
              className={cn(
                'font-display text-3xl sm:text-4xl mt-1.5 sm:mt-2 leading-none tabular-nums',
                DEMO_ALERTS > 0 && 'text-terracotta',
              )}
            >
              {DEMO_ALERTS}
              <span className="text-sm text-ink/40 ml-1.5">open</span>
            </p>
            <p className="text-[10px] sm:text-xs text-ink/55 mt-1 sm:mt-1.5 truncate">
              from fixture devices only
            </p>
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-ink/55">Quick access</p>
              <h2 className="font-display text-xl sm:text-2xl mt-1">Tap to open</h2>
            </div>
            <Link to="/app/access-points" className="text-sm text-ink/60 hover:text-ink shrink-0">
              Manage →
            </Link>
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {accessPoints.slice(0, 8).map((ap) => (
              <li key={ap.id}>
                <AccessPointAction ap={ap} onActivity={refreshSummary} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Fleet — the whole estate in one grid, exactly as the pre-fold console
          laid it out. Access tiles are your real access points; the rest are
          fixtures and carry a chip saying so. */}
      <section className="mt-10 sm:mt-14 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-ink/8">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Fleet</p>
              <p className="text-[11px] text-ink/45 mt-0.5">{fleetTotal} devices · 7 kinds</p>
            </div>
            <Link to="/app/devices" className="text-sm text-ink/60 hover:text-ink shrink-0">
              All devices →
            </Link>
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-ink/8">
            {accessPoints.slice(0, 3).map((ap) => (
              <li key={ap.id} className="bg-paper-cool p-4">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-moss shrink-0" aria-hidden />
                  <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45">Access</span>
                </div>
                <Link
                  to={`/app/access-points/${ap.id}`}
                  className="block mt-1.5 text-sm text-ink truncate hover:underline"
                >
                  {ap.name}
                </Link>
                <p className="mt-1.5 font-mono text-[11px] text-ink/55 truncate">
                  {ap.meter.last_op_at
                    ? `last op ${relativeTime(ap.meter.last_op_at)}`
                    : 'no ops yet'}
                </p>
              </li>
            ))}
            {engineDevices.slice(0, 6).map((d) => (
              <li key={d.key} className="bg-paper-cool p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <StateDot state={availabilityState(d.availability)} />
                    <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45 truncate">
                      {kindLabel(d.kind)}
                    </span>
                  </span>
                  <EngineChip label="Engine" />
                </div>
                <Link
                  to="/app/devices"
                  className="block mt-1.5 text-sm text-ink truncate hover:underline"
                >
                  {d.name}
                </Link>
                <p className="mt-1.5 font-mono text-[11px] text-ink/55 truncate">
                  {summaryLine(d)}
                </p>
              </li>
            ))}
            {demoDevices
              .slice(0, Math.max(0, 9 - Math.min(accessPoints.length, 3) - Math.min(engineDevices.length, 6)))
              .map((d) => (
              <li key={d.id} className={cn('bg-paper-cool p-4', d.state === 'off' && 'opacity-60')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <StateDot state={d.state} />
                    <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45 truncate">
                      {d.kind}
                    </span>
                  </span>
                  <DemoChip label="Demo" />
                </div>
                <p className="mt-1.5 text-sm text-ink truncate">{d.name}</p>
                <p className="mt-1.5 font-mono text-[11px] text-ink/55 truncate">{d.read}</p>
              </li>
            ))}
          </ul>
          <div className="px-5 sm:px-6 py-4 border-t border-ink/8 space-y-2">
            <InertNote>
              Access tiles are live — they open a real gate. Tiles chipped &ldquo;Engine&rdquo;
              are live too: real devices your hub&rsquo;s device engine reported. Tiles chipped
              &ldquo;Demo&rdquo; are fixture rows and read no hardware.
            </InertNote>
            {engineLine && <InertNote>{engineLine}</InertNote>}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-ink/8">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Event log</p>
            <DemoChip />
          </div>
          <ul className="divide-y divide-ink/8">
            {demoEvents.map((e) => (
              <li key={e.t} className="flex items-baseline gap-3 px-5 sm:px-6 py-3 text-[13px]">
                <span className="font-mono text-[11px] text-ink/45 shrink-0">{e.t}</span>
                <span
                  className={cn(
                    'text-[9px] uppercase tracking-[0.14em] w-14 shrink-0',
                    e.sev === 'alert'
                      ? 'text-terracotta'
                      : e.sev === 'warn'
                        ? 'text-gold'
                        : 'text-moss',
                  )}
                >
                  {e.tag}
                </span>
                <span className="text-ink/70 min-w-0 truncate">{e.msg}</span>
              </li>
            ))}
          </ul>
          <div className="px-5 sm:px-6 py-4 border-t border-ink/8">
            <InertNote>
              Five fixed lines that never change. Your real access log — every open, close and
              denial — is under{' '}
              <Link to="/app/analytics" className="underline hover:text-ink/70">
                Analytics
              </Link>
              .
            </InertNote>
          </div>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="px-5 sm:px-6 pt-5 pb-2 flex items-center justify-between">
            <h2 className="font-display text-xl sm:text-2xl">Recent activity</h2>
            <Link to="/app/analytics" className="text-sm text-ink/60 hover:text-ink">View all</Link>
          </div>
          {summary === null ? (
            <p className="px-5 sm:px-6 py-6 text-ink/55 text-sm">
              Recent activity isn&rsquo;t available on this hub yet.
            </p>
          ) : summary.recent_activity.length === 0 ? (
            <p className="px-5 sm:px-6 py-6 text-ink/55 text-sm">
              No activity yet — opens and closes will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {summary.recent_activity.slice(0, 6).map((a) => (
                <li key={a.id} className="flex px-5 sm:px-6 py-3 items-center gap-3 text-sm">
                  <span className="font-mono text-[11px] text-ink/55 w-12 shrink-0">
                    {shortTime(a.ts)}
                  </span>
                  <Verdict command={a.command} success={a.success} />
                  <span className="font-medium truncate">
                    {a.actor_email ?? <span className="text-ink/55">unknown</span>}
                  </span>
                  <span className="text-ink/65 flex-1 min-w-0 truncate hidden md:inline">
                    {a.access_point_name ?? a.location_name ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-xl sm:text-2xl">Locations</h2>
            <Link to="/app/settings" className="text-sm text-ink/60 hover:text-ink">Manage</Link>
          </div>
          <ul className="space-y-2.5">
            {locations.slice(0, 5).map((loc) => (
              <li
                key={loc.id}
                className="flex items-baseline justify-between border-b border-ink/8 pb-2.5 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{loc.name}</p>
                  <p className="text-[11px] text-ink/55 mt-0.5">
                    {loc.access_point_count} pt{loc.access_point_count === 1 ? '' : 's'}
                    {loc.last_opened_at ? ` · ${relativeTime(loc.last_opened_at)}` : ''}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45 shrink-0 ml-3">
                  {loc.type}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </>
  );
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

function Onboarding({
  greeting,
  firstName,
  locationName,
  onAddAccessPoint,
}: {
  greeting: string;
  firstName: string;
  locationName: string | undefined;
  onAddAccessPoint: () => void;
}) {
  return (
    <div className="max-w-2xl">
      <div className="mb-10">
        <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-3">
          <span className="h-1 w-1 rounded-full bg-terracotta" />
          Getting started
        </span>
        <h1 className="font-display-tight text-3xl sm:text-4xl lg:text-[40px] leading-[1.02] tracking-[-0.02em]">
          {greeting}, <span className="text-terracotta">{firstName}</span>.
        </h1>
        <p className="mt-3 text-[15px] text-ink/60 leading-relaxed">
          {locationName
            ? `${locationName} is ready. One more step before your first gate opens.`
            : 'Your account is ready. One more step before your first gate opens.'}
        </p>
      </div>

      {/* Stepper */}
      <div className="relative">
        {/* Connector line */}
        <div className="absolute left-[19px] top-10 bottom-10 w-px bg-ink/10" aria-hidden />

        <ol className="space-y-0">
          <Step
            n={1}
            status="done"
            title="Account & location"
            body="Your account is created and your location is confirmed with a verified address."
          />
          <Step
            n={2}
            status="active"
            title="Add your first access point"
            body="A gate, door, or barrier — the physical entry point you'll control from WhatsApp or the dashboard. Takes under a minute."
            cta={
              <button
                type="button"
                onClick={onAddAccessPoint}
                className="mt-4 inline-flex items-center h-11 px-6 rounded-full bg-terracotta text-paper text-sm font-medium hover:bg-terracotta-deep transition-colors"
              >
                Add access point →
              </button>
            }
          />
          <Step
            n={3}
            status="upcoming"
            title="Invite your team"
            body="Add members so they can open gates too — residents, staff, or visitors."
            cta={
              <Link
                to="/app/members"
                className="mt-3 inline-flex items-center h-9 px-4 rounded-full border border-ink/15 text-sm text-ink/50 hover:border-ink/35 hover:text-ink/70 transition-colors"
              >
                Go to Members →
              </Link>
            }
          />
        </ol>
      </div>
    </div>
  );
}

function Step({
  n,
  status,
  title,
  body,
  cta,
}: {
  n: number;
  status: 'done' | 'active' | 'upcoming';
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  const isDone = status === 'done';
  const isActive = status === 'active';

  return (
    <li className="flex gap-5 pb-8 last:pb-0">
      {/* Step indicator */}
      <div className="flex-none flex flex-col items-center">
        <div
          className={`relative z-10 flex items-center justify-center h-10 w-10 rounded-full text-sm font-semibold transition-colors ${
            isDone
              ? 'bg-moss text-paper'
              : isActive
                ? 'bg-ink text-paper'
                : 'bg-paper border-2 border-ink/15 text-ink/30'
          }`}
        >
          {isDone ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="Done">
              <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            n
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pt-1.5 pb-2">
        <p
          className={`font-display text-xl leading-tight ${
            isDone ? 'text-ink/50' : isActive ? 'text-ink' : 'text-ink/30'
          }`}
        >
          {title}
        </p>
        <p
          className={`mt-1.5 text-sm leading-relaxed ${
            isDone ? 'text-ink/40' : isActive ? 'text-ink/65' : 'text-ink/30'
          }`}
        >
          {body}
        </p>
        {cta && <div className={isActive ? '' : 'opacity-40 pointer-events-none'}>{cta}</div>}
      </div>
    </li>
  );
}

function Verdict({ command, success }: { command: string; success: boolean }) {
  let dot = 'bg-slate';
  let label: string = command;
  if (command === 'open' && success) { dot = 'bg-moss'; label = 'open'; }
  else if (command === 'close' && success) { dot = 'bg-ink'; label = 'close'; }
  else if (!success) { dot = 'bg-terracotta'; label = 'denied'; }
  return (
    <span className="inline-flex items-center gap-1.5 sm:gap-2 w-14 sm:w-20 text-[10px] sm:text-xs text-ink/70 uppercase tracking-wider shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
