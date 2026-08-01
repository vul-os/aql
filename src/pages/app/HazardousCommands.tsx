// Hazardous commands — the console half of T4 over chat.
//
// This screen is the second rail. A hazardous verb asked for over WhatsApp,
// Telegram or Slack does not run when the message arrives; it waits here, and
// approving it here is the only thing in the product that makes it run. That is
// deliberate and it is the whole security argument: someone holding a member's
// phone can send the message and cannot press this button, because pressing it
// needs a signed-in console session.
//
// Two panels, in the order an operator uses them:
//
//   1. AWAITING APPROVAL — what someone has asked for. Top, because it is time
//      bounded: an intent expires ten minutes after it was made, and an
//      operator who came here because their phone buzzed needs to see it first.
//
//   2. ARMED WINDOWS — what MAY be asked for. A window makes a verb eligible to
//      be requested; it grants nothing on its own.
//
// # Things this screen must not do, each learned from the hub's own comments
//
// It must not RECOMPUTE status from the timestamps. The hub derives
// active/expired/exhausted/disarmed and sends the answer; deriving it a second
// time here would be two answers to one question, and they would drift the
// first time a rule changed. Countdowns are shown as text alongside the hub's
// status, never as the source of it.
//
// It must not present approval as routine. Every other confirm() in this
// console guards a configuration change; this one spins a mower blade. The
// dialog names the device, the verb and who asked, because those are the three
// things that distinguish "yes, that was me" from "I did not send that".
//
// It must not hide a request nobody approved. An expired or rejected intent
// stays listed: a member saying "I asked and nothing happened" needs a row that
// says so, and an empty list would make that indistinguishable from a message
// that never arrived.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from './AppLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import {
  api,
  friendlyApiError,
  type EngineDevice,
  type StepUpIntentRow,
  type T4WindowRow,
} from '@/lib/api';
import { fromUnix } from '@/lib/time';

// The verbs a window may be armed for.
//
// These are the argless T4 verbs the hub's catalogue carries, and the hub
// refuses anything else with `verb_below_t4` or `unsupported_verb`. Listed as a
// fixed choice rather than free text so the common case does not depend on
// spelling — but the hub stays the authority, and its refusal is shown verbatim
// rather than pre-empted here.
const T4_VERBS: Array<{ value: string; label: string }> = [
  { value: 'start', label: 'start' },
  { value: 'resume', label: 'resume' },
];

const DURATIONS: Array<{ value: number; label: string }> = [
  { value: 15 * 60, label: '15 minutes' },
  { value: 30 * 60, label: '30 minutes' },
  { value: 60 * 60, label: '1 hour' },
  { value: 2 * 60 * 60, label: '2 hours' },
  { value: 4 * 60 * 60, label: '4 hours' },
];

function remaining(unix: number): string {
  const secs = unix - Math.floor(Date.now() / 1000);
  if (secs <= 0) return 'expired';
  if (secs < 60) return `${secs}s left`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min left`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

/** Plain-language outcome. '' means the decision has not actuated anything. */
function outcomeText(i: StepUpIntentRow): string | null {
  switch (i.outcome) {
    case 'sent':
      return 'The device took the command.';
    case 'failed':
      return `The device refused it${i.outcome_detail ? ` — ${i.outcome_detail}` : ''}.`;
    case 'refused':
      return `Nothing was sent${i.outcome_detail ? ` — ${i.outcome_detail}` : ''}.`;
    default:
      return null;
  }
}

export default function HazardousCommands() {
  const { accountId } = useAuth();
  const [intents, setIntents] = useState<StepUpIntentRow[]>([]);
  const [windows, setWindows] = useState<T4WindowRow[]>([]);
  const [devices, setDevices] = useState<EngineDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const [deviceKey, setDeviceKey] = useState('');
  const [verb, setVerb] = useState(T4_VERBS[0].value);
  const [durationS, setDurationS] = useState(DURATIONS[1].value);
  const [maxUses, setMaxUses] = useState('');
  const [notes, setNotes] = useState('');
  const [armErr, setArmErr] = useState('');

  const load = useCallback(async () => {
    if (!accountId) return;
    setErr('');
    try {
      const [i, w] = await Promise.all([
        api.stepUpIntents(accountId),
        api.t4Windows(accountId),
      ]);
      setIntents(i.stepup_intents ?? []);
      setWindows(w.t4_windows ?? []);
    } catch (e) {
      setErr(friendlyApiError(e));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The device list is loaded separately and its failure is not fatal: an
  // operator can still see and decide pending requests on a hub whose engine is
  // unreachable, and that is exactly when they most need to.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.engineDevices();
        if (!cancelled) setDevices(res.devices ?? []);
      } catch {
        if (!cancelled) setDevices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function decide(intent: StepUpIntentRow, approve: boolean) {
    if (!accountId) return;
    const who = intent.device_key;
    if (
      approve &&
      !window.confirm(
        `Run "${intent.verb}" on ${who}?\n\n` +
          `Asked for over ${intent.source}. This is a hazardous command and ` +
          `approving it here is what makes it run.`,
      )
    ) {
      return;
    }
    setBusy(intent.id);
    setErr('');
    try {
      await api.stepUpDecide(accountId, intent.id, approve);
    } catch (e) {
      setErr(friendlyApiError(e));
    } finally {
      setBusy('');
      await load();
    }
  }

  async function arm(e: FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    setArmErr('');
    setBusy('arm');
    try {
      const body: Parameters<typeof api.t4WindowArm>[1] = {
        device_key: deviceKey.trim(),
        verb,
        duration_s: durationS,
      };
      const n = Number(maxUses);
      if (maxUses.trim() !== '' && Number.isFinite(n) && n > 0) body.max_uses = n;
      if (notes.trim() !== '') body.notes = notes.trim();
      await api.t4WindowArm(accountId, body);
      setNotes('');
      setMaxUses('');
      await load();
    } catch (e2) {
      setArmErr(friendlyApiError(e2));
    } finally {
      setBusy('');
    }
  }

  async function disarm(w: T4WindowRow) {
    if (!accountId) return;
    setBusy(w.id);
    setErr('');
    try {
      await api.t4WindowDisarm(accountId, w.id);
    } catch (e) {
      setErr(friendlyApiError(e));
    } finally {
      setBusy('');
      await load();
    }
  }

  const pending = intents.filter((i) => i.status === 'pending');
  const decided = intents.filter((i) => i.status !== 'pending');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hazardous commands"
        subtitle="Approve, or refuse, the commands that can injure — asked for over chat, decided here."
      />

      <Card>
        <p className="text-sm text-muted">
          A hazardous command sent over chat does not run when the message arrives. It waits
          on this page, and approving it here is what makes it run. That is on purpose:
          approving needs a signed-in console session, so someone holding a member&rsquo;s
          phone can ask and cannot approve.
        </p>
      </Card>

      {err ? (
        <Card>
          <p className="text-sm text-danger">{err}</p>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-base font-semibold">Awaiting approval</h2>
        {loading ? (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nothing is waiting. A request appears here within seconds of someone sending it,
            and expires ten minutes later if nobody decides.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((i) => (
              <li key={i.id} className="rounded border border-subtle p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {i.verb} — {i.device_key}
                  </span>
                  <span className="text-xs text-muted">{remaining(i.expires_at)}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Asked for over {i.source} at {fromUnix(i.created_at)}.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => void decide(i, true)} disabled={busy === i.id}>
                    Approve and run
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void decide(i, false)}
                    disabled={busy === i.id}
                  >
                    Refuse
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {decided.length > 0 ? (
        <Card>
          <h2 className="text-base font-semibold">Recent requests</h2>
          <p className="mt-1 text-sm text-muted">
            Kept so a request that was refused, or that expired before anyone saw it, is
            visible rather than simply absent.
          </p>
          <ul className="mt-3 space-y-2">
            {decided.map((i) => {
              const outcome = outcomeText(i);
              return (
                <li key={i.id} className="rounded border border-subtle p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {i.verb} — {i.device_key}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted">
                      {i.status}
                    </span>
                  </div>
                  <p className="mt-1 text-muted">
                    Asked over {i.source} at {fromUnix(i.created_at)}.
                    {outcome ? ` ${outcome}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-base font-semibold">Armed windows</h2>
        <p className="mt-1 text-sm text-muted">
          A window makes one verb on one device eligible to be <em>asked for</em> over chat,
          for a while. It does not grant anything: a request still needs an operator, a
          confirmation in the chat, and an approval above.
        </p>

        <form onSubmit={(e) => void arm(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-muted">Device</span>
            {devices.length > 0 ? (
              <select
                className="mt-1 w-full rounded border border-subtle bg-transparent p-2"
                value={deviceKey}
                onChange={(e) => setDeviceKey(e.target.value)}
                required
              >
                <option value="">Choose a device…</option>
                {devices.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name} ({d.key})
                  </option>
                ))}
              </select>
            ) : (
              // No engine, or it could not be reached. A text field rather than
              // an empty dropdown: an operator who knows the key must not be
              // blocked by a list that failed to load.
              <input
                className="mt-1 w-full rounded border border-subtle bg-transparent p-2"
                value={deviceKey}
                onChange={(e) => setDeviceKey(e.target.value)}
                placeholder="driver:device-id"
                required
              />
            )}
          </label>

          <label className="text-sm">
            <span className="block text-muted">Verb</span>
            <select
              className="mt-1 w-full rounded border border-subtle bg-transparent p-2"
              value={verb}
              onChange={(e) => setVerb(e.target.value)}
            >
              {T4_VERBS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-muted">For how long</span>
            <select
              className="mt-1 w-full rounded border border-subtle bg-transparent p-2"
              value={durationS}
              onChange={(e) => setDurationS(Number(e.target.value))}
            >
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-muted">Limit to how many uses (optional)</span>
            <input
              className="mt-1 w-full rounded border border-subtle bg-transparent p-2"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              inputMode="numeric"
              placeholder="no limit"
            />
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="block text-muted">Why (shown beside the window)</span>
            <input
              className="mt-1 w-full rounded border border-subtle bg-transparent p-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="mowing the top field"
            />
          </label>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy === 'arm'}>
              Arm this window
            </Button>
            {armErr ? <p className="mt-2 text-sm text-danger">{armErr}</p> : null}
          </div>
        </form>

        {windows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing is armed.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {windows.map((w) => (
              <li key={w.id} className="rounded border border-subtle p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {w.verb} — {w.device_key}
                  </span>
                  {/* The hub's derived status, shown as sent. */}
                  <span className="text-xs uppercase tracking-wide text-muted">{w.status}</span>
                </div>
                <p className="mt-1 text-muted">
                  {w.status === 'active' ? `${remaining(w.ends_at)}. ` : ''}
                  Used {w.uses_count}
                  {w.max_uses === null ? ' times (no limit)' : ` of ${w.max_uses}`}.
                  {w.notes ? ` ${w.notes}` : ''}
                </p>
                {w.status === 'active' ? (
                  <div className="mt-2">
                    <Button
                      variant="secondary"
                      onClick={() => void disarm(w)}
                      disabled={busy === w.id}
                    >
                      Close now
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
