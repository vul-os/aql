import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { CreateAccessPointModal } from '@/components/access/CreateAccessPointModal';
import { ListStateCard, listLoading, loadList, type ListState } from '@/components/ui/ListState';
import {
  ApiError,
  api,
  friendlyApiError,
  type AccessPointDetail,
  type MaintenanceCreateInput,
  type MaintenanceEvent,
} from '@/lib/api';
import { fromUnix } from '@/lib/time';

const statusStyles: Record<string, string> = {
  active: 'bg-moss/15 text-moss',
  online: 'bg-moss/15 text-moss',
  offline: 'bg-terracotta/15 text-terracotta-deep',
  pending: 'bg-gold/20 text-ink/80',
};

function relTime(sec: number | null): string {
  const ts = fromUnix(sec);
  if (!ts) return '—';
  const ms = Date.now() - ts.getTime();
  if (ms < 0) return ts.toLocaleString();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d} d ago`;
  return ts.toLocaleDateString();
}

export default function AccessPointsPage() {
  const { currentAccount } = useAuth();
  const [state, setState] = useState<ListState<AccessPointDetail>>(listLoading);
  const [openMaintenanceFor, setOpenMaintenanceFor] = useState<AccessPointDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentAccount) return;
    // See components/ui/ListState: a failed fetch used to leave `points` null,
    // which this screen renders as "Loading access points…" — forever.
    setState(
      await loadList(
        async () => (await api.accessPoints(currentAccount.id)).access_points,
        'Could not load access points.',
        friendlyApiError,
      ),
    );
  }, [currentAccount]);
  const points = state.status === 'ready' ? state.items : null;

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        kicker="Hardware"
        title="Access points"
        description="Each access point is one physical opening — gate, door, or barrier — wired through one device. Service history is logged by hand and scheduled by date."
        actions={
          <Button variant="ink" onClick={() => setShowCreate(true)}>
            Add access point
          </Button>
        }
      />

      {state.status !== 'ready' || points === null || points.length === 0 ? (
        <ListStateCard
          state={state}
          loadingMessage="Loading access points…"
          emptyMessage="No access points yet. Add one and pair a device to start tracking opens."
          onRetry={() => void refresh()}
        />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {points.map((ap) => (
            <li key={ap.id}>
              <AccessPointCard
                ap={ap}
                onLogMaintenance={() => setOpenMaintenanceFor(ap)}
              />
            </li>
          ))}
        </ul>
      )}

      {openMaintenanceFor && (
        <MaintenanceModal
          ap={openMaintenanceFor}
          onClose={() => setOpenMaintenanceFor(null)}
          onSaved={() => {
            setOpenMaintenanceFor(null);
            refresh();
          }}
        />
      )}

      {showCreate && (
        <CreateAccessPointModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function AccessPointCard({
  ap,
  onLogMaintenance,
}: {
  ap: AccessPointDetail;
  onLogMaintenance: () => void;
}) {
  const due = ap.maintenance.due_now;
  return (
    <Card className="p-0 overflow-hidden hover:border-ink/30 transition-colors">
      {/* Card body is one big link to the detail page; the maintenance row
          below sits outside the link so its own button doesn't steal the click. */}
      <Link to={`/app/access-points/${ap.id}`} className="block p-6">
        <div className="flex items-start justify-between mb-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
              statusStyles[ap.status] ?? 'bg-ink/5 text-ink/60'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {ap.status}
          </span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-ink/50">{ap.kind}</span>
        </div>
        <p className="font-display text-2xl">{ap.name}</p>
        <p className="text-sm text-ink/60 mt-1">
          {ap.device_id ? `device ${ap.device_id.slice(0, 8)}…` : 'unpaired'}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          <Stat label="opens" value={ap.meter.total_opens.toLocaleString()} />
          <Stat label="closes" value={ap.meter.total_closes.toLocaleString()} />
          <Stat label="last op" value={relTime(ap.meter.last_op_at)} />
        </div>
      </Link>

      <div className="px-6 pb-6 pt-1 border-t border-ink/10 -mt-1">
        <div className="flex items-center justify-between mb-2 pt-4">
          <span className="text-[11px] uppercase tracking-[0.18em] text-ink/55">Maintenance</span>
          {due ? (
            <span className="text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-terracotta/15 text-terracotta-deep">
              due
            </span>
          ) : ap.maintenance.next_due_at !== null ? (
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45">on track</span>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45">no schedule</span>
          )}
        </div>

        {/* Date-based. The progress bar here was driven by pct_used, a
            movement figure the hub never measured and now reports as null, so
            it rendered as 0% on every card that had a schedule at all. */}
        {ap.maintenance.next_due_at !== null && (
          <p className="text-xs text-ink/60 mt-2">
            {due
              ? `Service was due ${relTime(ap.maintenance.next_due_at)}`
              : `Next service ${relTime(ap.maintenance.next_due_at)}`}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-ink/55">
          <span>last serviced {relTime(ap.maintenance.last_serviced_at)}</span>
          <button
            onClick={onLogMaintenance}
            className="underline underline-offset-4 decoration-terracotta hover:text-ink"
          >
            Log service
          </button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-lg leading-none">{value}</p>
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink/50 mt-1">{label}</p>
    </div>
  );
}

function MaintenanceModal({
  ap,
  onClose,
  onSaved,
}: {
  ap: AccessPointDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<MaintenanceCreateInput['kind']>('service');
  const [technician, setTechnician] = useState('');
  const [notes, setNotes] = useState('');
  const [costRand, setCostRand] = useState('');
  const [nextDueDays, setNextDueDays] = useState('180');
  const [history, setHistory] = useState<MaintenanceEvent[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .maintenanceList(ap.id)
      .then((r) => {
        if (!cancelled) setHistory(r.events);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ap.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const body: MaintenanceCreateInput = {
        kind,
        technician_name: technician.trim() || undefined,
        notes: notes.trim() || undefined,
        cost_zar_cents: costRand.trim() ? Math.round(Number(costRand) * 100) : undefined,
        next_due_in_days:
          kind === 'inspection' ? undefined : nextDueDays.trim() ? Number(nextDueDays) : undefined,
      };
      await api.maintenanceCreate(ap.id, body);
      onSaved();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'not_account_admin'
            ? 'Only account admins can log maintenance.'
            : err.detail ?? err.code
          : err instanceof Error
            ? err.message
            : 'Failed to log maintenance.';
      setErrorMsg(msg);
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="sm:max-w-2xl">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display text-2xl">Log maintenance</h2>
        <span className="text-[11px] uppercase tracking-[0.18em] text-ink/50">{ap.name}</span>
      </div>
      <p className="text-sm text-ink/60 mb-6">
        {ap.meter.total_opens.toLocaleString()} opens · {ap.meter.total_closes.toLocaleString()} closes.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-ink/85 mb-2">Kind</legend>
          <div className="grid grid-cols-4 gap-2">
            {(['inspection', 'service', 'repair', 'replacement'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-10 rounded-xl border text-xs capitalize transition-colors ${
                  kind === k
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-paper-cool text-ink border-ink/15 hover:border-ink/35'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Technician"
            value={technician}
            onChange={setTechnician}
            placeholder="e.g. Themba M."
          />
          <Field
            label="Cost (ZAR)"
            value={costRand}
            onChange={setCostRand}
            placeholder="0.00"
            type="number"
          />
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink/85">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-xl bg-paper-cool border border-ink/15 px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
            placeholder="What was done, parts replaced, observed wear, etc."
          />
        </label>

        {/* Date-based only. The hub refuses a movement threshold: nothing
            measures how far a gate leaf travels, so one would never be reached
            and the reminder would never fire. */}
        {kind !== 'inspection' && (
          <Field
            label="Next service after (days)"
            value={nextDueDays}
            onChange={setNextDueDays}
            type="number"
            hint="calendar"
          />
        )}

        {errorMsg && <p className="text-sm text-terracotta-deep">{errorMsg}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
          >
            Cancel
          </button>
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save event'}
          </Button>
        </div>
      </form>

      {history && history.length > 0 && (
        <div className="mt-8 pt-6 border-t border-ink/10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/55 mb-3">History</p>
          <ul className="space-y-2 max-h-48 overflow-auto pr-2">
            {history.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between text-sm border-b border-ink/5 pb-2"
              >
                <div>
                  <p className="font-medium capitalize">{ev.kind}</p>
                  <p className="text-xs text-ink/55">
                    {fromUnix(ev.performed_at)?.toLocaleDateString() ?? '—'}
                    {ev.technician_name ? ` · ${ev.technician_name}` : ''}
                  </p>
                </div>
                <div className="text-right text-xs text-ink/55">
                  {ev.cost_zar_cents !== null && (
                    <p>R {(ev.cost_zar_cents / 100).toFixed(2)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink/85">{label}</span>
        {hint && <span className="text-xs text-ink/50">{hint}</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full h-11 rounded-xl bg-paper-cool border border-ink/15 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-ink"
      />
    </label>
  );
}
