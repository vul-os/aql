// Devices — ONE list, every kind Aql models.
//
// This is the point of a hub: cameras, lighting, robots, climate, energy,
// sensors and access all sit in the same table, in the same shape. What
// differs is where a row comes from, and that is stated on the row itself:
//
//   Hub (real)      — access points and the controllers paired to them. These
//                     talk to the Go hub, carry their own signing key and
//                     genuinely move hardware. Pairing works here, today.
//   Engine (real)   — whatever the hub's device engine reports over
//                     /v1/engine/devices: real devices found by whichever
//                     drivers the operator configured. Their controls send
//                     real verbs, and the hub decides what each one means.
//   Demo (fixture)  — src/lib/demoData.ts. Read no hardware, sent nowhere.
//                     Kept because a hub with no device config has no engine
//                     at all, and because these show the shape of a fleet.
//
// No blanket banner: a banner over a mixed list would be false about most of
// it. Per-row chips instead — see src/components/demo/DemoMarks.tsx.
//
// The one page-level statement that IS made: when the engine is absent, or the
// hub is too old to serve it, or the request failed, the screen says which of
// those three happened. An empty list would be indistinguishable from a broken
// fetch, and silently showing the fixture in its place would be a lie.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DevicePairing } from '@/components/illustrations/DevicePairing';
import {
  DemoChip,
  EngineChip,
  InertNote,
  LiveChip,
  StateDot,
  StateLabel,
} from '@/components/demo/DemoMarks';
import {
  availabilityLabel,
  availabilityState,
  controlsFor,
  describeExecuteError,
  engineFleet,
  engineNotice,
  executedMessage,
  kindLabel,
  readingValue,
  readingsErrorMessage,
  summaryLine,
  type EngineControl,
  type EngineFleet,
} from '@/components/demo/engineState';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import {
  ApiError,
  api,
  type AccessPointDetail,
  type DeviceCreateResponse,
  type DeviceRow,
  type EngineDevice,
  type EngineReading,
  type LocationRow,
} from '@/lib/api';
import { demoDevices, type Device as DemoDevice, type DeviceState } from '@/lib/demoData';
import { fromUnix } from '@/lib/time';

const STATUS_LABEL: Record<string, string> = {
  unpaired: 'awaiting pair',
  active: 'online',
  online: 'online',
  offline: 'offline',
};

function relativeTime(sec: number | null): string {
  const d = fromUnix(sec);
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  if (ms < 0) {
    const s = Math.abs(ms) / 1000;
    if (s < 60) return `in ${Math.round(s)}s`;
    if (s < 3600) return `in ${Math.round(s / 60)} min`;
    return `in ${Math.round(s / 3600)} h`;
  }
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))} h ago`;
  return d.toLocaleDateString();
}

// ── the one row shape the table renders ──────────────────────────────────────

type Row =
  | { source: 'gateway'; kind: 'Access'; id: string; name: string; zone: string; state: DeviceState; read: string; ap: AccessPointDetail }
  | { source: 'gateway'; kind: 'Controller'; id: string; name: string; zone: string; state: DeviceState; read: string; device: DeviceRow }
  | { source: 'engine'; kind: string; id: string; name: string; zone: string; state: DeviceState; read: string; engine: EngineDevice }
  | { source: 'demo'; kind: string; id: string; name: string; zone: string; state: DeviceState; read: string; demo: DemoDevice };

/** The chip that says where a row came from. Every row carries exactly one. */
function SourceChip({ source }: { source: Row['source'] }) {
  if (source === 'gateway') return <LiveChip />;
  if (source === 'engine') return <EngineChip />;
  return <DemoChip />;
}

/** Map a paired-controller status onto the shared four-state vocabulary. */
function controllerState(status: string): DeviceState {
  if (status === 'active' || status === 'online') return 'live';
  if (status === 'unpaired') return 'warn';
  if (status === 'offline') return 'alert';
  return 'off';
}

export default function DevicesPage() {
  const { currentAccount } = useAuth();
  const [controllers, setControllers] = useState<DeviceRow[] | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPointDetail[]>([]);
  const [engine, setEngine] = useState<EngineFleet | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showClaim, setShowClaim] = useState<DeviceCreateResponse | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentAccount) return;
    // The engine is asked separately from the account-scoped calls below: it is
    // hub-wide, and its answer must land even when the account calls fail. It
    // never rejects — see engineFleet().
    void engineFleet().then(setEngine);
    try {
      // Access points are the more important half of this list, so a failure
      // on either call must not blank the other — hence the per-call catch.
      // engineFleet() never throws: an absent engine is a state to render, not
      // an exception, and it must not take the rest of the list down with it.
      const [d, l, ap] = await Promise.all([
        api.devicesList({ account_id: currentAccount.id }),
        api.locationsList(currentAccount.id),
        api.accessPoints(currentAccount.id).catch(() => ({ access_points: [] })),
      ]);
      setControllers(d.devices);
      setLocations(l.locations);
      setAccessPoints(ap.access_points);
      setError(null);
    } catch (err) {
      setControllers([]);
      setError(err instanceof Error ? err.message : 'Failed to load devices.');
    }
  }, [currentAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const locationName = useCallback(
    (id: string) => locations.find((l) => l.id === id)?.name ?? id.slice(0, 8),
    [locations],
  );

  const rows: Row[] = useMemo(() => {
    const apRows: Row[] = accessPoints.map((ap) => ({
      source: 'gateway',
      kind: 'Access',
      id: ap.id,
      name: ap.name,
      zone: locationName(ap.location_id),
      state: ap.device_id ? 'live' : 'warn',
      read: ap.meter.last_op_at ? `last op ${relativeTime(ap.meter.last_op_at)}` : 'no ops yet',
      ap,
    }));
    const ctlRows: Row[] = (controllers ?? []).map((d) => ({
      source: 'gateway',
      kind: 'Controller',
      id: d.id,
      name: d.label ?? `Controller ${d.id.slice(0, 8)}`,
      zone: locationName(d.location_id),
      state: controllerState(d.status),
      read: STATUS_LABEL[d.status] ?? d.status,
      device: d,
    }));
    // Engine devices are real. They sit between the hub's own rows and the
    // fixture, chipped "Engine", using the same kind labels so the kind filters
    // put a live lamp and a fixture lamp under the same button.
    const engineRows: Row[] = (engine?.devices ?? []).map((d) => ({
      source: 'engine',
      kind: kindLabel(d.kind),
      id: d.key,
      name: d.name,
      zone: d.zone || '—',
      state: availabilityState(d.availability),
      read: summaryLine(d),
      engine: d,
    }));
    const demoRows: Row[] = demoDevices.map((d) => ({
      source: 'demo',
      kind: d.kind,
      id: d.id,
      name: d.name,
      zone: d.zone,
      state: d.state,
      read: d.read,
      demo: d,
    }));
    return [...apRows, ...ctlRows, ...engineRows, ...demoRows];
  }, [accessPoints, controllers, engine, locationName]);

  const kinds = useMemo(() => ['All', ...new Set(rows.map((r) => r.kind))], [rows]);
  const visible = kindFilter === 'All' ? rows : rows.filter((r) => r.kind === kindFilter);
  const selected = rows.find((r) => r.id === selectedId) ?? visible[0] ?? null;
  const hubCount = rows.filter((r) => r.source === 'gateway').length;
  const engineCount = rows.filter((r) => r.source === 'engine').length;
  const notice = engine ? engineNotice(engine) : null;

  return (
    <>
      <PageHeader
        kicker="Fleet"
        title="Devices"
        description="Everything Aql knows about, in one list — access, cameras, lighting, robots, climate, energy and sensors, plus the controllers that drive your gates. Each row says where it comes from."
        actions={
          <Button variant="ink" disabled={locations.length === 0} onClick={() => setCreating(true)}>
            Pair new device
          </Button>
        }
      />

      {error && (
        <Card className="mb-6 border-terracotta/40">
          <p className="text-sm text-terracotta-deep">{error}</p>
        </Card>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            aria-pressed={kindFilter === k}
            className={cn(
              'h-8 px-3.5 rounded-full text-xs transition-colors border',
              kindFilter === k
                ? 'bg-ink text-paper border-ink'
                : 'border-ink/15 text-ink/65 hover:border-ink/35 hover:text-ink',
            )}
          >
            {k}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink/45">
          {hubCount} on your hub
          {engineCount > 0 && ` · ${engineCount} from the device engine`} ·{' '}
          {demoDevices.length} from the demo dataset
        </span>
      </div>

      {/* What the engine actually said. Only rendered when it is NOT simply
          serving devices — an empty list with no explanation is the failure
          mode this whole screen is trying to avoid. */}
      {notice && (
        <Card
          className={cn(
            'mb-5 py-4',
            engine?.status === 'error' ? 'border-terracotta/40' : 'border-ink/10',
          )}
        >
          <div className="flex items-start gap-3">
            <span className="mt-1.5 shrink-0">
              <StateDot state={engine?.status === 'error' ? 'alert' : 'unknown'} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Device engine</p>
              <p className="mt-1 text-sm text-ink/70 leading-relaxed">{notice}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <Card className="lg:col-span-8 p-0 overflow-hidden">
          {controllers === null ? (
            <div className="px-6 py-8 text-ink/55 text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Every device Aql can see. Rows marked &ldquo;Hub&rdquo; are real hardware on
                  your hub; rows marked &ldquo;Engine&rdquo; are real devices reported by your
                  hub&rsquo;s device engine; rows marked &ldquo;Demo data&rdquo; come from a
                  built-in fixture dataset and read no hardware.
                </caption>
                <thead className="bg-paper-warm/50">
                  <tr>
                    {/* The source marker rides in the Device cell, not in a
                        column of its own: a trailing column is the first thing
                        a narrow viewport scrolls out of sight, and this is the
                        one thing on the row that must never be missed. */}
                    {['Device', 'Kind', 'Where', 'Reading'].map((c, i) => (
                      <th
                        key={c}
                        scope="col"
                        className={cn(
                          'px-5 sm:px-6 py-3.5 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-normal',
                          i === 3 ? 'text-right' : 'text-left',
                        )}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const active = selected?.id === r.id;
                    return (
                      <tr
                        key={`${r.source}-${r.id}`}
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          'border-t border-ink/8 cursor-pointer transition-colors',
                          active ? 'bg-paper-warm/70' : 'hover:bg-paper-warm/30',
                          r.state === 'off' && 'text-ink/50',
                        )}
                      >
                        <td className="px-5 sm:px-6 py-3.5">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setSelectedId(r.id)}
                              aria-pressed={active}
                              className="inline-flex items-center gap-2.5 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                            >
                              <StateDot state={r.state} />
                              <span className={cn(active && 'font-medium')}>{r.name}</span>
                            </button>
                            <SourceChip source={r.source} />
                          </div>
                          {r.source === 'gateway' && r.kind === 'Controller' && (
                            <p className="text-[10px] text-ink/40 mt-0.5 font-mono">
                              {r.device.id.slice(0, 8)}
                            </p>
                          )}
                        </td>
                        <td className="px-5 sm:px-6 py-3.5 text-[11px] uppercase tracking-[0.16em] text-ink/50">
                          {r.kind}
                        </td>
                        <td className="px-5 sm:px-6 py-3.5 text-xs text-ink/55">
                          <span className="block max-w-[10rem] truncate">{r.zone}</span>
                        </td>
                        <td className="px-5 sm:px-6 py-3.5 text-right font-mono text-xs text-ink/70 whitespace-nowrap">
                          {r.read}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr className="border-t border-ink/8">
                      <td colSpan={4} className="px-6 py-8 text-ink/55 text-sm">
                        {locations.length === 0
                          ? 'Create a location first, then you can pair a device to it.'
                          : `Nothing of kind “${kindFilter}” yet.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="lg:col-span-4 flex flex-col gap-6">
          {selected && <DetailPanel row={selected} onPairedRefresh={refresh} />}

          <Card tone="cream">
            <p className="text-[11px] uppercase tracking-[0.22em] text-ink/55">Pair a new one</p>
            <h3 className="font-display text-2xl mt-2">It takes 60 seconds</h3>
            <p className="text-ink/65 text-sm mt-3 leading-relaxed">
              Create the device here, copy the claim token, then enter it on the controller within
              an hour to complete pairing. This is the real path — the controller verifies every
              command against its pinned key afterwards.
            </p>
            <DevicePairing className="w-full mt-4" />
          </Card>
        </div>
      </div>

      {creating && (
        <CreateDeviceModal
          locations={locations}
          onClose={() => setCreating(false)}
          onCreated={(res) => {
            setCreating(false);
            setShowClaim(res);
            refresh();
          }}
        />
      )}

      {showClaim && <ClaimTokenModal info={showClaim} onClose={() => setShowClaim(null)} />}
    </>
  );
}

// ── detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ row, onPairedRefresh }: { row: Row; onPairedRefresh: () => void }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">Device</span>
        <div className="flex items-center gap-2">
          <StateLabel state={row.state} />
          <SourceChip source={row.source} />
        </div>
      </div>

      <div className="p-6">
        <h2 className="font-display text-2xl">{row.name}</h2>
        <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink/50">
          {row.kind} · {row.zone}
        </p>

        {row.source === 'gateway' && row.kind === 'Access' && <AccessDetail row={row} />}
        {row.source === 'gateway' && row.kind === 'Controller' && (
          <ControllerDetail row={row} onPairedRefresh={onPairedRefresh} />
        )}
        {row.source === 'engine' && <EngineDetail key={row.id} row={row} />}
        {row.source === 'demo' && <DemoDetail row={row} />}
      </div>
    </Card>
  );
}

function Rows({
  items,
}: {
  // `wrap` is for values whose whole point is the sentence — availability's
  // "not heard from since the engine started" says nothing once truncated.
  items: Array<{ k: string; v: string; mono?: boolean; wrap?: boolean }>;
}) {
  return (
    <dl className="mt-5 rounded-2xl border border-ink/8 divide-y divide-ink/8 overflow-hidden">
      {items.map((row) => (
        <div key={row.k} className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/50 shrink-0">{row.k}</dt>
          <dd
            className={cn(
              'text-sm text-ink/70 text-right min-w-0',
              row.wrap ? 'leading-snug' : 'truncate',
              row.mono && 'font-mono text-xs',
            )}
          >
            {row.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AccessDetail({ row }: { row: Extract<Row, { kind: 'Access' }> }) {
  const { ap } = row;
  return (
    <>
      <Rows
        items={[
          { k: 'Type', v: ap.kind },
          { k: 'Total opens', v: ap.meter.total_opens.toLocaleString(), mono: true },
          { k: 'Movement', v: `${Math.round(ap.meter.movement_m)} m`, mono: true },
          {
            k: 'Controller',
            v: ap.device_id ? ap.device_id.slice(0, 8) : 'none paired',
            mono: true,
          },
        ]}
      />
      <div className="mt-5">
        <Link
          to={`/app/access-points/${ap.id}`}
          className="inline-flex items-center h-9 px-4 rounded-full bg-ink text-paper text-sm hover:bg-ink/90 transition-colors"
        >
          Open access point →
        </Link>
      </div>
      <InertNote className="mt-3">
        Opening, closing, maintenance and the audit trail all live on the access-point page — this
        one is real hardware on your hub.
      </InertNote>
    </>
  );
}

function ControllerDetail({
  row,
  onPairedRefresh,
}: {
  row: Extract<Row, { kind: 'Controller' }>;
  onPairedRefresh: () => void;
}) {
  const { device } = row;
  return (
    <>
      <Rows
        items={[
          { k: 'Status', v: STATUS_LABEL[device.status] ?? device.status },
          { k: 'Last seen', v: relativeTime(device.last_seen_at), mono: true },
          { k: 'Paired', v: relativeTime(device.paired_at), mono: true },
          { k: 'Device ID', v: device.id, mono: true },
        ]}
      />
      {device.status === 'unpaired' && device.claim_expires_at && (
        <p className="mt-3 text-xs text-gold">
          Claim token expires {relativeTime(device.claim_expires_at)} — enter it on the controller
          to finish pairing.
        </p>
      )}
      <div className="mt-5">
        <button
          type="button"
          onClick={onPairedRefresh}
          className="h-9 px-4 rounded-full text-sm border border-ink/15 text-ink/70 hover:border-ink/35 hover:text-ink transition-colors"
        >
          Refresh status
        </button>
      </div>
    </>
  );
}

// ── engine detail (real: device-engine-backed) ───────────────────────────────

/**
 * A live device: its readings, and the verbs it actually offers.
 *
 * Three things here are deliberate and should survive edits:
 *
 *   · Availability is rendered from what the hub sent, verbatim. "" is
 *     "not heard from since the engine started" and reads as unknown — a
 *     device that has never reported must not look like one that is down.
 *   · A 409 confirm_required is a CONFIRMATION STEP, not an error. The hub
 *     asks for a second deliberate act before anything with blades moves;
 *     surfacing that as a red toast would train people to ignore it.
 *   · An indeterminate result says "could not confirm". Never "failed":
 *     someone told an open failed will press the button again, and the gate
 *     may already be open.
 */
function EngineDetail({ row }: { row: Extract<Row, { source: 'engine' }> }) {
  const d = row.engine;
  const controls = useMemo(() => controlsFor(d.capabilities), [d.capabilities]);

  const [readings, setReadings] = useState<EngineReading[] | null>(null);
  const [readingsError, setReadingsError] = useState<{ message: string; fault: boolean } | null>(null);
  const [args, setArgs] = useState<Record<string, number>>(() =>
    Object.fromEntries(controls.filter((c) => c.arg).map((c) => [c.verb, c.arg!.initial])),
  );
  const [busyVerb, setBusyVerb] = useState<string | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState<{ control: EngineControl; message: string } | null>(null);
  const [outcome, setOutcome] = useState<
    { kind: 'ok' | 'indeterminate' | 'unreachable' | 'refused' | 'failed'; message: string } | null
  >(null);

  const loadReadings = useCallback(async () => {
    setReadingsError(null);
    try {
      const res = await api.engineReadings(d.key);
      setReadings(res.readings ?? []);
    } catch (err) {
      setReadings(null);
      setReadingsError(readingsErrorMessage(err));
    }
  }, [d.key]);

  useEffect(() => {
    setReadings(null);
    setOutcome(null);
    setAwaitingConfirm(null);
    void loadReadings();
  }, [loadReadings]);

  async function send(control: EngineControl, confirm: boolean) {
    setBusyVerb(control.verb);
    setOutcome(null);
    const argMap = control.arg ? { [control.arg.name]: args[control.verb] ?? control.arg.initial } : undefined;
    try {
      const res = await api.engineExecute(d.key, { verb: control.verb, args: argMap, confirm });
      setAwaitingConfirm(null);
      setOutcome({ kind: 'ok', message: executedMessage(control.label, res?.tier ?? '') });
      void loadReadings();
    } catch (err) {
      const described = describeExecuteError(err, control.label);
      if (described.kind === 'confirm') {
        // Not a failure — the hub is asking for a second deliberate act.
        setAwaitingConfirm({ control, message: described.message });
      } else {
        setAwaitingConfirm(null);
        setOutcome(described);
      }
    } finally {
      setBusyVerb(null);
    }
  }

  return (
    <>
      <div className="mt-5 rounded-2xl border border-ink/8 bg-paper-warm/40 px-5 py-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink/45">Readings</p>
        {readings === null && !readingsError && <p className="mt-2 text-sm text-ink/55">Reading…</p>}
        {readingsError && (
          <p
            className={cn(
              'mt-2 text-sm',
              readingsError.fault ? 'text-terracotta-deep' : 'text-ink/55',
            )}
          >
            {readingsError.message}
          </p>
        )}
        {readings !== null && readings.length === 0 && (
          <p className="mt-2 text-sm text-ink/55">
            The driver returned no readings for this device.
          </p>
        )}
        {readings !== null && readings.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {readings.map((r) => (
              <li key={`${r.metric}-${r.at}`} className="flex items-baseline justify-between gap-4">
                <span className="text-xs text-ink/55 truncate">{r.metric}</span>
                <span className="font-mono text-sm text-ink/85 tabular-nums shrink-0">
                  {readingValue(r)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Rows
        items={[
          { k: 'Status', v: d.summary || '—' },
          { k: 'Availability', v: availabilityLabel(d.availability), wrap: true },
          { k: 'Driver', v: d.driver, mono: true },
          { k: 'Last seen', v: relativeTime(d.last_seen), mono: true },
          { k: 'Key', v: d.key, mono: true },
        ]}
      />

      {controls.length > 0 ? (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 items-center">
            {controls.map((c) => (
              <span key={c.verb} className="inline-flex items-center gap-1.5">
                {c.arg && (
                  <label className="inline-flex items-center gap-1 text-xs text-ink/55">
                    <span className="sr-only">
                      {c.arg.name} for {c.label} on {d.name}
                    </span>
                    <input
                      type="number"
                      min={c.arg.min}
                      max={c.arg.max}
                      step={c.arg.step}
                      value={args[c.verb] ?? c.arg.initial}
                      onChange={(e) =>
                        setArgs((prev) => ({ ...prev, [c.verb]: Number(e.target.value) }))
                      }
                      className="h-9 w-16 rounded-full bg-paper-cool border border-ink/15 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ink"
                    />
                    {c.arg.unit}
                  </label>
                )}
                <button
                  type="button"
                  disabled={busyVerb !== null}
                  onClick={() => void send(c, false)}
                  className="h-9 px-4 rounded-full text-sm border border-ink/15 text-ink/75 hover:border-ink/35 hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busyVerb === c.verb ? 'Sending…' : c.label}
                </button>
              </span>
            ))}
          </div>

          {awaitingConfirm && (
            <div className="rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3" role="alertdialog" aria-label="Confirm this action">
              <p className="text-sm text-ink/80 leading-relaxed">{awaitingConfirm.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyVerb !== null}
                  onClick={() => void send(awaitingConfirm.control, true)}
                  className="h-9 px-4 rounded-full text-sm bg-ink text-paper hover:bg-ink/90 transition-colors disabled:opacity-50"
                >
                  {busyVerb ? 'Sending…' : `Yes — ${awaitingConfirm.control.label}`}
                </button>
                <button
                  type="button"
                  onClick={() => setAwaitingConfirm(null)}
                  className="h-9 px-4 rounded-full text-sm border border-ink/15 text-ink/65 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {outcome && (
            <p
              role="status"
              className={cn(
                'text-sm leading-relaxed',
                outcome.kind === 'ok'
                  ? 'text-moss'
                  : outcome.kind === 'indeterminate'
                    ? 'text-gold'
                    : 'text-terracotta-deep',
              )}
            >
              {outcome.message}
            </p>
          )}

          <InertNote>
            These send real verbs to a real device. Your hub decides what each one means and
            refuses anything the device doesn&rsquo;t offer — this console never widens that.
          </InertNote>
        </div>
      ) : (
        <InertNote className="mt-5">
          This device reports readings only — it declares no verbs that can be actuated, so there
          is nothing to press.
        </InertNote>
      )}
    </>
  );
}

function DemoDetail({ row }: { row: Extract<Row, { source: 'demo' }> }) {
  const { demo } = row;
  return (
    <>
      {/*
        The pre-fold Svelte screen rendered a fake camera viewport here — a
        blinking red REC dot, a "LIVE" caption and animated scanlines over an
        empty box. That reads as a working stream to anyone glancing at it, and
        there is no camera pipeline (ONVIF/RTSP is ROADMAP Phase 5). Replaced
        with a placeholder that says so. Do not reinstate it.
      */}
      {demo.kind === 'Camera' ? (
        <div className="mt-5 h-32 rounded-2xl border border-dashed border-ink/15 bg-paper-warm/40 grid place-items-center px-6 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/45">No stream</p>
            <p className="mt-2 text-sm text-ink/60 leading-relaxed">
              Camera live-view is ROADMAP Phase 5 — there is no video pipeline behind this panel.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 h-32 rounded-2xl border border-ink/8 bg-paper-warm/40 grid place-items-center px-6">
          <span className="font-display numeral text-4xl text-ink text-center leading-none">
            {demo.read}
          </span>
        </div>
      )}

      <Rows
        items={[
          { k: 'Status', v: demo.detail },
          { k: 'Last seen', v: demo.seen, mono: true },
          { k: 'Device ID', v: demo.id, mono: true },
        ]}
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {['Open', 'Automate', 'Logs'].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            title="A fixture row — there is no device behind this control."
            className="h-9 px-4 rounded-full text-sm border border-ink/15 text-ink/40 cursor-not-allowed"
          >
            {label}
          </button>
        ))}
      </div>
      <InertNote className="mt-3">
        A fixture row: nothing here was read from hardware, and these controls are disabled
        because there is no device behind them to send anything to. A real one of these appears
        in the list above chipped &ldquo;Engine&rdquo; once a driver on your hub reports it, and
        its controls do work.
      </InertNote>
    </>
  );
}

// ── pairing (real: gateway-backed) ───────────────────────────────────────────

function CreateDeviceModal({
  locations,
  onClose,
  onCreated,
}: {
  locations: LocationRow[];
  onClose: () => void;
  onCreated: (res: DeviceCreateResponse) => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!locationId) {
      setErrorMsg('Pick a location.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.deviceCreate({
        location_id: locationId,
        label: label.trim() || undefined,
      });
      onCreated(res);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'not_account_admin'
            ? 'Only account admins can pair devices.'
            : (err.detail ?? err.code)
          : err instanceof Error
            ? err.message
            : 'Could not create device.';
      setErrorMsg(msg);
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl mb-1">Pair a new device</h2>
      <p className="text-sm text-ink/60 mb-5">
        Pick the location it lives at and give it a label so it's easier to recognise.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink/85">Location</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink/85">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Main gate controller"
            className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>
        {errorMsg && <p className="text-sm text-terracotta-deep">{errorMsg}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
          >
            Cancel
          </button>
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create + get claim token'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClaimTokenModal({ info, onClose }: { info: DeviceCreateResponse; onClose: () => void }) {
  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-2xl mb-1">Claim token</h2>
      <p className="text-sm text-ink/60 mb-4">
        Enter this on the controller within the next hour to complete pairing.{' '}
        <span className="text-ink/85 font-medium">It won't be shown again.</span>
      </p>
      <div className="rounded-xl bg-ink text-paper p-4 font-mono text-sm break-all">
        {info.claim_token}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink/55">
        <span>Expires {fromUnix(info.claim_expires_at)?.toLocaleString() ?? '—'}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(info.claim_token)}
          className="px-3 py-1.5 rounded-full border border-ink/15 hover:border-ink"
        >
          Copy
        </button>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ink" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
