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
//
// No demo fixture here anymore — every row on this page is either real or
// honestly says why the list is short. No blanket banner either: a banner
// over a mixed list would be false about most of it. Per-row chips instead —
// see src/components/device/StatusMarks.tsx.
//
// The one page-level statement that IS made: when the engine is absent, or the
// hub is too old to serve it, or the request failed, the screen says which of
// those three happened. An empty list would be indistinguishable from a broken
// fetch, and there is no fixture left to silently show in its place.
//
// Controller discovery (below, in the right column) is a separate honesty
// problem: mDNS is unauthenticated by construction, so a browse result is an
// address to check, never a device to trust. See ControllerDiscoveryCard.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { ClaimableDevices, ReleaseDeviceButton } from '@/components/device/ClaimableDevices';
import { ControllerConfig } from '@/components/device/ControllerConfig';
import { ClockFreshness } from '@/components/device/ClockFreshness';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DevicePairing } from '@/components/illustrations/DevicePairing';
import {
  EngineChip,
  InertNote,
  LiveChip,
  StateDot,
  StateLabel,
} from '@/components/device/StatusMarks';
import { DriverHealth } from '@/components/device/DriverHealth';
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
} from '@/components/device/engineState';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import {
  ApiError,
  api,
  friendlyApiError,
  type AccessPointDetail,
  type DeviceCreateResponse,
  type DeviceRow,
  type DiscoveredController,
  type EngineDevice,
  type EngineReading,
  type LocationRow,
} from '@/lib/api';
import type { DeviceState } from '@/lib/deviceKinds';
import { fromUnix } from '@/lib/time';

/**
 * What to print beside a controller.
 *
 * Not derived from `status`, which is pairing state and said "online" for a
 * controller that had been unplugged for months. The only field that knows
 * whether a command could be delivered right now is `connected`.
 */
export function controllerLabel(d: { status: string; connected?: boolean; last_seen_at: number | null }): string {
  if (d.status === 'unpaired') return 'awaiting pair';
  if (d.connected === undefined) {
    // An older hub that does not report liveness. Say that, rather than
    // picking one of the two answers.
    return 'paired — this hub does not report whether it is connected';
  }
  if (d.connected) return 'connected';
  const seen = relativeTime(d.last_seen_at);
  return seen ? `not connected — last seen ${seen}` : 'not connected';
}

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
  | { source: 'engine'; kind: string; id: string; name: string; zone: string; state: DeviceState; read: string; engine: EngineDevice };

/** The chip that says where a row came from. Every row carries exactly one. */
function SourceChip({ source }: { source: Row['source'] }) {
  if (source === 'gateway') return <LiveChip />;
  return <EngineChip />;
}

/**
 * Map a controller onto the shared four-state vocabulary.
 *
 * `status` is PAIRING state and nothing else: it goes unpaired → active when a
 * claim is redeemed and is never written again. Nothing in the hub ever sets
 * `offline`, so keying liveness on it drew every controller that had ever
 * paired as live — including one unplugged for months — while the hub was
 * sending `connected` in the same payload and being ignored.
 *
 * `connected` is the live WebSocket. A controller that is paired but not
 * connected is `alert`, not `live`: a command sent to it will be QUEUED, and
 * an operator looking at a green row would believe the gate would open now.
 *
 * `connected` undefined means an older hub that does not report it. That is
 * `unknown`, never `live` — guessing live is the one wrong direction to guess
 * in, and it is exactly the guess that produced this bug.
 */
export function controllerState(status: string, connected?: boolean): DeviceState {
  if (status === 'unpaired') return 'warn';
  if (connected === undefined) return 'unknown';
  return connected ? 'live' : 'alert';
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
      state: controllerState(d.status, d.connected),
      read: controllerLabel(d),
      device: d,
    }));
    // Engine devices are real, chipped "Engine" beside the hub's own rows,
    // using the same kind labels so the kind filters put a hub row and an
    // engine row of the same kind under the same button.
    // Access points are filtered out upstream by engineFleet — see
    // consoleShowsEngineDevice for why that lives at the fetch rather than here.
    // Without it a gate appears twice: once as an apRow and once as an engine row.
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
    return [...apRows, ...ctlRows, ...engineRows];
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

      {/* Renders nothing unless the engine reports devices nobody owns, which
          on a single-account hub is never — that hub sees its whole fleet
          without claiming anything. See ClaimableDevices. */}
      {/* Renders nothing unless a controller is actually drifting toward
          refusing offline grants — see ClockFreshness for why it must not be a
          permanent fixture. */}
      {currentAccount && <ClockFreshness accountId={currentAccount.id} />}

      {currentAccount && (
        <ClaimableDevices
          accountId={currentAccount.id}
          onClaimed={() => void engineFleet().then(setEngine)}
        />
      )}

      {/* Above the list, because a driver that is down explains a whole block
          of rows looking stale — and per-device state cannot say it. */}
      <div className="mb-5">
        <DriverHealth />
      </div>

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
          {engineCount > 0 && ` · ${engineCount} from the device engine`}
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
                  hub&rsquo;s device engine.
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
          {selected && (
            <DetailPanel
              row={selected}
              accountId={currentAccount?.id ?? null}
              onPairedRefresh={refresh}
            />
          )}

          {currentAccount && <ControllerDiscoveryCard accountId={currentAccount.id} />}

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

function DetailPanel({
  row,
  accountId,
  onPairedRefresh,
}: {
  row: Row;
  // Needed to release a device claim. Threaded in rather than read from a
  // context here, so the panel cannot render a release control for an account
  // the page is not actually showing.
  accountId: string | null;
  onPairedRefresh: () => void;
}) {
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
          <>
            <ControllerDetail row={row} onPairedRefresh={onPairedRefresh} />
            {/* Only for a controller that has actually paired: an unpaired one
                has no session to deliver a signed command over, and offering
                the form would queue changes for a device that may never
                arrive. */}
            {row.device.status !== 'unpaired' && <ControllerConfig deviceId={row.device.id} />}
          </>
        )}
        {row.source === 'engine' && <EngineDetail key={row.id} row={row} />}
        {row.source === 'engine' && accountId && (
          <ReleaseDeviceButton
            accountId={accountId}
            deviceKey={row.engine.key}
            deviceName={row.engine.name || row.engine.key}
            onReleased={onPairedRefresh}
          />
        )}
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
          // Two separate facts, kept separate. Collapsing them is what let a
          // paired-but-dead controller read as "online".
          { k: 'Pairing', v: device.status === 'unpaired' ? 'not paired' : 'paired' },
          { k: 'Connection', v: controllerLabel(device) },
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

// ── controller discovery (real: LAN mDNS browse) ─────────────────────────────
//
// hub/internal/httpapi/discovery.go / hub/internal/discovery/mdns.go. A browse
// is a POST, not a page-load fetch: it puts multicast on the operator's
// network and takes a couple of seconds, so it sits behind an explicit button
// rather than firing on mount or on every refresh.
//
// The one rule this component exists to protect: mDNS is unauthenticated by
// construction. Anything on the LAN can answer a browse, so a result here is
// an address to check, never a device to trust — there is no button that
// pairs what was found. Pairing still means creating a device in the card
// below and typing the claim token into the controller itself.

type DiscoverState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'found'; controllers: DiscoveredController[]; note: string }
  /** 503 discovery_unavailable: multicast couldn't be sent — a different fact
   *  from "no controllers answered", and the hub's `detail` says why. */
  | { status: 'unavailable'; detail: string }
  /** 403 — discovery is admin-only. Its own state, not a generic error: a
   *  member hitting this should be told why, not shown a broken page. */
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

function ControllerDiscoveryCard({ accountId }: { accountId: string }) {
  const [state, setState] = useState<DiscoverState>({ status: 'idle' });

  async function scan() {
    setState({ status: 'scanning' });
    try {
      const res = await api.discoverControllers(accountId);
      setState({ status: 'found', controllers: res.controllers, note: res.note });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setState({ status: 'forbidden' });
      } else if (err instanceof ApiError && err.status === 503 && err.code === 'discovery_unavailable') {
        setState({
          status: 'unavailable',
          detail: err.detail ?? "Multicast couldn't be sent on this hub.",
        });
      } else {
        setState({ status: 'error', message: friendlyApiError(err, 'Could not browse the network.') });
      }
    }
  }

  return (
    <Card tone="cream">
      <p className="text-[11px] uppercase tracking-[0.22em] text-ink/55">Find controllers</p>
      <h3 className="font-display text-2xl mt-2">Scan the network</h3>
      <p className="text-ink/65 text-sm mt-3 leading-relaxed">
        Browses the LAN for controllers advertising themselves over mDNS — a couple of seconds of
        multicast traffic, nothing more, and nothing sent automatically. mDNS has no
        authentication: anything on this network can answer a browse, so what comes back is
        addresses to check, not devices to trust. There is no one-click add here — pairing still
        means creating a device below and typing its claim token into the controller itself.
      </p>

      <button
        type="button"
        onClick={() => void scan()}
        disabled={state.status === 'scanning'}
        className="mt-4 h-9 px-4 rounded-full text-sm border border-ink/15 text-ink/75 hover:border-ink/35 hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.status === 'scanning' ? 'Scanning…' : 'Scan the network for controllers'}
      </button>

      {state.status === 'forbidden' && (
        <p className="mt-4 text-sm text-terracotta-deep leading-relaxed">
          This account doesn&rsquo;t allow you to browse the network — discovery is admin-only,
          because the result is a map of what&rsquo;s on it. Ask an owner or admin to run it.
        </p>
      )}

      {state.status === 'unavailable' && (
        <p className="mt-4 text-sm text-terracotta-deep leading-relaxed">
          Multicast couldn&rsquo;t be sent from this hub: {state.detail} That is a different
          answer from &ldquo;no controllers are here&rdquo; — it means this host or network can&rsquo;t
          carry the query, not that nothing would have answered it.
        </p>
      )}

      {state.status === 'error' && (
        <p className="mt-4 text-sm text-terracotta-deep leading-relaxed">{state.message}</p>
      )}

      {state.status === 'found' && (
        <div className="mt-4">
          {/* Said on every response, including a full one — this is the
              sentence that explains why there is no button beside a row that
              just says "add". */}
          <p className="text-xs text-ink/55 leading-relaxed">{state.note}</p>

          {state.controllers.length === 0 ? (
            <p className="mt-3 text-sm text-ink/65">
              Nothing answered. That can mean there are no controllers on this network, or that
              one hasn&rsquo;t finished booting — mDNS is best-effort, so a second scan sometimes
              finds what the first missed.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {state.controllers.map((c) => {
                // A real controller always advertises its device id in the TXT
                // record. An empty one is not a quieter version of normal — it
                // is the one signal this list has that something answering
                // isn't what it looks like.
                const suspect = c.device_id === '';
                return (
                  <li
                    key={`${c.instance}-${c.addr}`}
                    className={cn(
                      'rounded-xl border px-3 py-2.5',
                      suspect ? 'border-terracotta/40 bg-terracotta/5' : 'border-ink/10',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium truncate">{c.instance || '(unnamed)'}</span>
                      <span className="font-mono text-xs text-ink/55 shrink-0">{c.addr}</span>
                    </div>
                    <p
                      className={cn(
                        'mt-1 text-xs font-mono truncate',
                        suspect ? 'text-terracotta-deep' : 'text-ink/55',
                      )}
                    >
                      {suspect ? 'no device id advertised' : c.device_id}
                    </p>
                    {suspect && (
                      <p className="mt-1.5 text-xs text-terracotta-deep leading-relaxed">
                        A real controller always advertises a device id. Treat this responder as
                        unverified — do not assume it is one of yours.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
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
