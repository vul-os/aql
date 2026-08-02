// Audit: two trails and the integrity check over them.
//   Access log — instance-wide opens/closes/denials with kind filter chips.
//   Admin actions — the operator trail (claims, suspensions, grants, denied
//   /admin probes).
//   Integrity — verify the tamper-evident hash chain, and pull the raw
//   controller-signed events behind a device's audit rows.
//
// The Integrity tab exists because both halves were reachable only with curl.
// The audit tables have been hash-chained since migration 0007 precisely so
// that "has this been tampered with?" is a checkable question, and nothing in
// this console could ask it. Migration 0019 then stored each controller event's
// envelope verbatim so a signature stays re-verifiable, and nothing could
// retrieve one.

import { useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  friendlyApiError,
  type AdminAuditKind,
  type AuditVerifyResult,
  type ControllerEventRow,
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { ResultDot } from './AdminAccounts';
import {
  ErrorNote,
  LoadingRow,
  Pagination,
  Td,
  Th,
  fmtDateTime,
  useAdminLoad,
} from './shared';

const PAGE = 50;

const KINDS: Array<{ kind: AdminAuditKind; label: string }> = [
  { kind: 'all', label: 'All' },
  { kind: 'success', label: 'Success' },
  { kind: 'denied', label: 'Denied' },
  { kind: 'open', label: 'Opens' },
  { kind: 'close', label: 'Closes' },
  { kind: 'rate_limited', label: 'Rate limited' },
  { kind: 'quota_exceeded', label: 'Quota' },
  { kind: 'account_suspended', label: 'Suspended' },
];

export default function AdminAudit() {
  const [tab, setTab] = useState<'access' | 'actions' | 'integrity'>('access');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5">
        {(
          [
            { id: 'access', label: 'Access log' },
            { id: 'actions', label: 'Admin actions' },
            { id: 'integrity', label: 'Integrity' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'h-8 px-3.5 rounded-full text-xs transition-colors',
              tab === t.id
                ? 'bg-ink/90 text-paper'
                : 'text-ink/60 border border-ink/15 hover:border-ink/40 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'access' && <AccessLog />}
      {tab === 'actions' && <ActionLog />}
      {tab === 'integrity' && <Integrity />}
    </div>
  );
}

// ── Access log ──────────────────────────────────────────────────────────────

function AccessLog() {
  const [kind, setKind] = useState<AdminAuditKind>('all');
  const [offset, setOffset] = useState(0);

  const { data, error, loading } = useAdminLoad(
    () => api.adminAudit({ kind, limit: PAGE, offset }),
    [kind, offset],
  );

  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => {
              setKind(k.kind);
              setOffset(0);
            }}
            className={cn(
              'h-8 px-3 rounded-full text-xs transition-colors',
              kind === k.kind
                ? 'bg-ink text-paper'
                : 'text-ink/60 border border-ink/15 hover:border-ink/40 hover:text-ink',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        {error ? (
          <ErrorNote text={error} />
        ) : !data ? (
          <LoadingRow />
        ) : data.entries.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink/55">Nothing logged for this filter.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10">
                    <Th>Time</Th>
                    <Th>Result</Th>
                    <Th>Access point</Th>
                    <Th>Account</Th>
                    <Th>User</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id} className="border-b border-ink/8 last:border-0 hover:bg-paper-warm/40 transition-colors">
                      <Td className="font-mono text-xs text-ink/55 whitespace-nowrap">
                        {fmtDateTime(e.ts)}
                      </Td>
                      <Td>
                        <ResultDot success={e.success} command={e.command} error={e.error} />
                      </Td>
                      <Td className="text-ink/80">
                        <span className="truncate block max-w-[220px]">
                          {e.access_point_name ?? '—'}
                          {e.location_name && (
                            <span className="text-ink/45 text-xs"> · {e.location_name}</span>
                          )}
                        </span>
                      </Td>
                      <Td className="text-ink/70 text-xs">{e.account_name ?? '—'}</Td>
                      <Td className="font-mono text-xs text-ink/60">
                        <span className="truncate block max-w-[200px]">{e.user_username ?? '—'}</span>
                      </Td>
                      <Td className="font-mono text-[10px] uppercase text-ink/45">{e.source ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} limit={PAGE} offset={offset} onOffset={setOffset} busy={loading} />
          </>
        )}
      </Card>
    </>
  );
}

// ── Admin action log ────────────────────────────────────────────────────────

function ActionLog() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useAdminLoad(
    () => api.adminAuditActions({ limit: PAGE, offset }),
    [offset],
  );

  return (
    <Card className="p-0 overflow-hidden">
      {error ? (
        <ErrorNote text={error} />
      ) : !data ? (
        <LoadingRow />
      ) : data.actions.length === 0 ? (
        <p className="px-5 py-8 text-sm text-ink/55">No admin actions recorded yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10">
                  <Th>Time</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Allowed</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {data.actions.map((a) => (
                  <tr key={a.id} className="border-b border-ink/8 last:border-0 hover:bg-paper-warm/40 transition-colors">
                    <Td className="font-mono text-xs text-ink/55 whitespace-nowrap">
                      {fmtDateTime(a.created_at)}
                    </Td>
                    <Td className="font-mono text-xs text-ink/70">
                      <span className="truncate block max-w-[200px]">{a.actor_username ?? '—'}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-ink/85">{a.action}</span>
                    </Td>
                    <Td className="text-xs text-ink/60">
                      {a.target_kind ? (
                        <span className="font-mono">
                          {a.target_kind}
                          <span className="text-ink/35">/</span>
                          <span className="text-ink/45">{shortId(a.target_id)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider',
                          a.allowed ? 'text-moss' : 'text-terracotta-deep',
                        )}
                      >
                        <span
                          className={cn('h-1.5 w-1.5 rounded-full', a.allowed ? 'bg-moss' : 'bg-terracotta')}
                          aria-hidden
                        />
                        {a.allowed ? 'yes' : 'denied'}
                      </span>
                    </Td>
                    <Td className="font-mono text-[11px] text-ink/50">
                      <span className="truncate block max-w-[260px]">{fmtDetail(a.detail)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} limit={PAGE} offset={offset} onOffset={setOffset} busy={loading} />
        </>
      )}
    </Card>
  );
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function fmtDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return '—';
  try {
    const s = typeof detail === 'string' ? detail : JSON.stringify(detail);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return '—';
  }
}

// ── Integrity ───────────────────────────────────────────────────────────────

// What a passing chain does and does not establish, stated where someone
// reading the green result will see it.
//
// This wording is not decoration. hub/internal/store/audithash.go is explicit
// that the chain is a DETECTION control and not a prevention one: an attacker
// who edits the SQLite file and then recomputes every hash forward through the
// end of the chain rewrites history undetectably. What it defeats is tampering
// that does not also do that work. A green tick presented without this reads
// as "this hub is trustworthy", which is a much larger claim than the check
// supports — and the console is exactly where that misreading would happen.
// Written as whole phrases per line rather than reflowed to the margin: the
// guard in auditIntegrityCopy.test.ts reads this source, and a claim split
// across a concatenation boundary is a claim the guard cannot see.
const CHAIN_LIMITS = [
  'A passing chain means these rows are internally consistent with each other.',
  'It does not mean nothing was deleted,',
  'and it cannot detect an attacker who edited the database file',
  'and then recomputed every hash after their edit.',
  'It is a detection control, not a prevention one.',
].join(' ');

function Integrity() {
  return (
    <div className="flex flex-col gap-4">
      <ChainVerify />
      <DeviceEvents />
    </div>
  );
}

function ChainVerify() {
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setError(null);
    setRunning(true);
    try {
      setResult(await api.adminAuditVerify());
    } catch (err) {
      // The previous run's result MUST go. Without this, a re-verify that
      // fails renders its error banner directly above the last run's green
      // "Intact" ticks — and the person re-verifying is very often doing it
      // BECAUSE they suspect tampering. A stale pass presented beside a fresh
      // failure is the worst possible answer to that question.
      setResult(null);
      setError(friendlyApiError(err, 'Could not verify the audit chain.'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-2xl">Audit hash chain</h2>
      <p className="text-sm text-ink/65 mt-1">
        Recomputes every row&rsquo;s hash from its own stored content and checks it against the
        chain. {CHAIN_LIMITS}
      </p>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="mt-4 h-9 px-4 rounded-full bg-ink text-paper text-sm disabled:opacity-60"
      >
        {running ? 'Verifying…' : 'Verify now'}
      </button>

      {error && <ErrorNote text={error} />}

      {result && (
        <ul className="mt-5 divide-y divide-ink/10">
          {result.chains.map((c) => (
            <li key={c.table} className="py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-sm text-ink">{c.table}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]',
                  c.ok ? 'bg-moss/15 text-moss' : 'bg-terracotta-deep/15 text-terracotta-deep',
                )}
              >
                {c.ok ? 'Intact' : 'Broken'}
              </span>
              {/* The row count is part of the result, not a detail: "OK" over
                  zero rows and "OK" over 40,000 are different statements, and a
                  tick with no number invites the generous reading. */}
              <span className="text-sm text-ink/60">
                {c.rows_checked.toLocaleString()} row{c.rows_checked === 1 ? '' : 's'} checked
              </span>
              {/* The head, so this screen can be used the way the docs say:
                  write down (rows, head) somewhere this box does not control,
                  and a truncated history stops being invisible. */}
              <span className="w-full font-mono text-[11px] text-ink/45 break-all">
                head {c.head}
              </span>
              {c.broken_at && (
                <p className="w-full text-sm text-terracotta-deep mt-1" role="alert">
                  First break at row {c.broken_at.index} (id {c.broken_at.row_id}):{' '}
                  {c.broken_at.reason}
                </p>
              )}
            </li>
          ))}
          {/* Separate from the chains, because it answers a different question:
              not "was this edited" but "does it describe what happened". An
              orphan is an audit row with no signed controller event behind it. */}
          <li className="py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm text-ink">signed-event cross-check</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]',
                result.cross_check.ok
                  ? 'bg-moss/15 text-moss'
                  : 'bg-terracotta-deep/15 text-terracotta-deep',
              )}
            >
              {result.cross_check.ok ? 'Matched' : 'Unmatched'}
            </span>
            <span className="text-sm text-ink/60">
              {result.cross_check.ok
                ? 'every controller-sourced row has its signed event'
                : `${result.cross_check.orphaned_audit_rows.toLocaleString()} row(s) claim a controller origin with no signed event behind them`}
            </span>
          </li>
        </ul>
      )}
    </Card>
  );
}

// The raw signed events behind a device's audit rows.
//
// Looked up by device id rather than browsed, because that is how this gets
// used: an auditor already has a row in front of them and wants the bytes the
// controller actually signed. Rendering the envelope verbatim is the entire
// point — re-serialising the parsed fields would not reproduce what the
// signature covers.
function DeviceEvents() {
  const [deviceId, setDeviceId] = useState('');
  const [events, setEvents] = useState<ControllerEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(e: FormEvent) {
    e.preventDefault();
    const id = deviceId.trim();
    if (!id) return;
    setError(null);
    setLoading(true);
    try {
      const r = await api.deviceEvents(id, 50);
      setEvents(r.events);
    } catch (err) {
      setEvents(null);
      setError(
        err instanceof ApiError && err.code === 'device_not_found'
          ? 'No such device on this hub, or it belongs to an account you do not administer — the two are deliberately indistinguishable here.'
          : friendlyApiError(err, 'Could not load events for that device.'),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-2xl">Controller-signed events</h2>
      <p className="text-sm text-ink/65 mt-1">
        The raw events a controller delivered, with the exact bytes it signed. The
        access-relevant ones also appear in the access log above; this is where the signature
        itself can be checked against the device&rsquo;s enrolled key.
      </p>

      <form onSubmit={load} className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="block flex-1 max-w-[420px]">
          <span className="text-sm font-medium text-ink/85 block mb-1.5">Device id</span>
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="de71ce00-…"
            className="w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] font-mono focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !deviceId.trim()}
          className="h-11 px-4 rounded-full bg-ink text-paper text-sm disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Load events'}
        </button>
      </form>

      {error && <ErrorNote text={error} />}

      {events && events.length === 0 && (
        <p className="mt-5 text-sm text-ink/65">
          No events stored for that device. That means none were delivered and kept — it is not
          a statement that the device has been idle.
        </p>
      )}

      {events && events.length > 0 && (
        <ul className="mt-5 divide-y divide-ink/10">
          {events.map((ev) => (
            <li key={ev.event_id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{ev.kind}</span>
                <span className="text-sm text-ink/60">{fmtDateTime(ev.ts)}</span>
                <span className="font-mono text-xs text-ink/45">{ev.event_id}</span>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-paper-cool border border-ink/10 p-3 text-[11px] font-mono text-ink/75">
                {ev.envelope}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
