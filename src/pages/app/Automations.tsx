// Automations — Aql's when → do screen.
//
// The rule engine is real (hub/internal/automations, served over HTTP by
// hub/internal/httpapi/automations.go) and this page reads it live: the
// rows below are rules stored on your hub, the toggle calls the hub's enable
// endpoint, and the tier figures are the hub's own numbers, not a copy kept
// here. What this page does NOT do, on purpose:
//
//   - Judge a rule before the hub does. The editor offers every verb without
//     filtering by tier, because the ceiling is a compile-time constant checked
//     twice in the engine and a second copy in this form is a copy that can
//     drift from the one actually enforcing it. A refusal comes back from the
//     hub, in the hub's own vocabulary, and is rendered rather than predicted.
//   - Decide anything about safety. The tier ceiling (`max_action_tier`) is a
//     compile-time constant in the engine; this page only ever prints the
//     number the hub sends alongside each rule's resolved `action_tier`. An
//     automation cannot open a gate because every access verb resolves above
//     that ceiling — that is enforced in hub/internal/automations, not
//     rendered here as a rule this console could get out of sync with.
//
// A hub with no rule engine, a hub whose rule engine is not configured, an
// admin-only read a member can't see, and a genuinely failed fetch are four
// different sentences — see src/components/device/liveState.ts, which narrows
// all of them so this page never has to guess which one happened.
//
// The access-control module has its own real automation surface — time
// windows and temporary grants under Access control → Temp access — which
// runs on the gateway independently of this engine. This page does not
// duplicate that.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './AppLayout';
import { Card, StatBlock } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { api, friendlyApiError, type AutomationRule, type AutomationRun } from '@/lib/api';
import {
  automationsState,
  automationsNotice,
  schedulerWarning,
  trippedRules,
  type AutomationsState,
} from '@/components/device/liveState';
import { InertNote } from '@/components/device/StatusMarks';
import { fromUnix } from '@/lib/time';
import RuleEditor from '@/components/automations/RuleEditor';
import RunHistory from '@/components/automations/RunHistory';
import { RunRow, RunsPanel } from '@/components/automations/RunList';
import { engineFleet, type EngineFleet } from '@/components/device/engineState';

/** The account-wide activity feed's own load state (api.automationRuns) — a
 *  narrower version of AutomationsState because there is nothing here for
 *  "absent"/"forbidden" to distinguish: this only ever loads once the rule
 *  list itself is already live, which already proved an engine exists and
 *  this viewer is an admin. */
type ActivityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'live'; runs: AutomationRun[]; limit: number }
  | { status: 'error'; message: string };

/** The outcome of one "Run now" click, kept per rule so triggering one rule
 *  never clobbers another's last result, and so leaving and returning to the
 *  page doesn't invent a fake "nothing happened" reading — it's simply gone,
 *  which is honest, rather than persisted as if it were part of the rule. */
type RunNowResult = { run: AutomationRun } | { error: string };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `minute_of_day` (0..1439) as a 24h clock reading. */
function timeOfDay(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The `days` bitmask, bit 0 = Sunday, as a short weekday list. */
function weekdays(days: number): string {
  const names = WEEKDAYS.filter((_, i) => (days & (1 << i)) !== 0);
  if (names.length === 0) return 'no days set';
  if (names.length === 7) return 'every day';
  return names.join(', ');
}

/** A human reading of a rule's trigger. */
function triggerLine(trigger: AutomationRule['trigger']): string {
  switch (trigger.kind) {
    case 'schedule': {
      const s = trigger.schedule;
      if (!s) return 'schedule (no detail sent)';
      return `${timeOfDay(s.minute_of_day)} on ${weekdays(s.days)}`;
    }
    case 'threshold': {
      const t = trigger.threshold;
      if (!t) return 'threshold (no detail sent)';
      return `${t.device_key} ${t.metric} ${t.op} ${t.value}`;
    }
    case 'event': {
      const e = trigger.event;
      if (!e) return 'event (no detail sent)';
      return `${e.device_key} → ${e.name}`;
    }
    default:
      // A trigger kind this console doesn't recognise means a hub newer than
      // this build — say so rather than rendering nothing.
      return `unrecognised trigger (“${trigger.kind}”)`;
  }
}

/** A human reading of a rule's action. Never implies the tier is editable. */
export function actionLine(action: AutomationRule['action']): string {
  // An alert drives nothing and carries no verb. Reading the verb first
  // rendered "undefined unnamed target" for every alert rule the hub returned.
  if (action.notify) {
    return `alert: “${action.notify.message}”`;
  }
  const target = action.device_key ?? action.zone ?? 'unnamed target';
  return `${action.verb ?? 'no verb'} ${target}`;
}

/** A readout derived from the live rule list, or an em dash when not live. */
function RuleStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <Card><StatBlock label={label} value={<span className="numeral">{value}</span>} hint={hint} /></Card>;
}

function outcomeLine(r: AutomationRule): string {
  if (!r.last_fired_at) return 'never fired';
  const when = fromUnix(r.last_fired_at)?.toLocaleString() ?? '—';
  const outcome = r.last_outcome || 'unknown outcome';
  return `${outcome} · ${when}`;
}

export default function AutomationsPage() {
  const { currentAccount } = useAuth();
  // null = closed; { rule: null } = creating; { rule } = editing that one.
  const [editing, setEditing] = useState<{ rule: AutomationRule | null } | null>(null);
  // The editor's device and metric pickers read the engine's fleet. Fetched
  // here rather than inside the editor so opening the form is instant — and so
  // an absent engine does not look like a broken editor.
  const [fleet, setFleet] = useState<EngineFleet | null>(null);
  useEffect(() => {
    void engineFleet().then(setFleet);
  }, []);
  const [state, setState] = useState<AutomationsState | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, RunNowResult>>({});
  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);
  const [activity, setActivity] = useState<ActivityState>({ status: 'idle' });
  const [activityLimit, setActivityLimit] = useState(50);

  useEffect(() => {
    if (!currentAccount) return;
    let cancelled = false;
    automationsState(currentAccount.id).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [currentAccount]);

  const loadActivity = useCallback(
    async (n: number) => {
      if (!currentAccount) return;
      setActivity({ status: 'loading' });
      try {
        const res = await api.automationRuns(currentAccount.id, n);
        setActivity({ status: 'live', runs: res.runs, limit: res.limit });
      } catch (err) {
        setActivity({
          status: 'error',
          message: friendlyApiError(err, 'Could not load recent automation activity.'),
        });
      }
    },
    [currentAccount],
  );

  useEffect(() => {
    // Fires once the engine is confirmed live, not on every render — a
    // "Load more" click drives every later fetch directly via activityLimit.
    if (state?.status === 'live') void loadActivity(activityLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.status, currentAccount, loadActivity]);

  async function refreshRules() {
    if (!currentAccount) return;
    const s = await automationsState(currentAccount.id);
    setState(s);
  }

  async function onDelete(rule: AutomationRule) {
    if (!currentAccount) return;
    // Matches the confirm()-then-request pattern Webhooks.tsx and
    // ApiTokens.tsx already use for their own destructive actions — this is
    // that same pattern, not a new one, for a delete that is arguably higher
    // stakes than either: this rule may be actuating real hardware
    // unattended right now.
    if (
      !confirm(
        `Delete "${rule.name}"? This automation can act on real hardware with nobody watching — deleting it stops that permanently. There is no undo; recovering it means writing the rule again from scratch.`,
      )
    ) {
      return;
    }
    setDeletingId(rule.id);
    try {
      await api.automationDelete(currentAccount.id, rule.id);
      setState((s) =>
        s && s.status === 'live' ? { ...s, rules: s.rules.filter((r) => r.id !== rule.id) } : s,
      );
      setRunResults((prev) => {
        if (!(rule.id in prev)) return prev;
        const next = { ...prev };
        delete next[rule.id];
        return next;
      });
      setHistoryRule((h) => (h?.id === rule.id ? null : h));
    } catch (err) {
      alert(friendlyApiError(err, 'Could not delete this rule.'));
    } finally {
      setDeletingId(null);
    }
  }

  async function onRunNow(rule: AutomationRule) {
    if (!currentAccount) return;
    setRunningId(rule.id);
    setRunResults((prev) => {
      const next = { ...prev };
      delete next[rule.id];
      return next;
    });
    try {
      // A refusal or a skip is NOT a thrown error here — RunNow goes through
      // the same Fire() the scheduler uses, so a cooldown, an unmet
      // condition or a tier refusal comes back as a 200 with the Run's own
      // outcome and reason (see automations.go's handleAutomationRunNow).
      // Only a rule that no longer exists, or a genuine internal failure,
      // throws. Either way the result is rendered, never swallowed.
      const run = await api.automationRunNow(currentAccount.id, rule.id);
      setRunResults((prev) => ({ ...prev, [rule.id]: { run } }));
      // A run mutates the RULE's own state too — last_fired_at, consecutive
      // failures, and possibly the failure breaker tripping it off — even
      // when the outcome was a refusal or a skip. Refetching the list is the
      // only way the row reflects that; appending the run result beside a
      // stale row would leave the failure count and last-outcome line lying.
      await refreshRules();
      void loadActivity(activityLimit);
    } catch (err) {
      setRunResults((prev) => ({
        ...prev,
        [rule.id]: { error: friendlyApiError(err, 'Could not run this rule.') },
      }));
    } finally {
      setRunningId(null);
    }
  }

  async function toggle(rule: AutomationRule) {
    if (!currentAccount || state?.status !== 'live') return;
    const next = !rule.enabled;
    setPending((p) => new Set(p).add(rule.id));
    // Optimistic, but reverted on failure — the row must never claim a state
    // the hub didn't confirm.
    setState((s) =>
      s && s.status === 'live'
        ? { ...s, rules: s.rules.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)) }
        : s,
    );
    try {
      const saved = await api.automationSetEnabled(currentAccount.id, rule.id, next);
      setState((s) =>
        s && s.status === 'live'
          ? { ...s, rules: s.rules.map((r) => (r.id === rule.id ? saved : r)) }
          : s,
      );
    } catch {
      setState((s) =>
        s && s.status === 'live'
          ? { ...s, rules: s.rules.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)) }
          : s,
      );
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(rule.id);
        return next;
      });
    }
  }

  if (!currentAccount) {
    return (
      <>
        <PageHeader kicker="Rules" title="Automations" />
        <Card>
          <p className="text-ink/65 text-sm">No account loaded.</p>
        </Card>
      </>
    );
  }

  const notice = state ? automationsNotice(state) : null;
  const warning = state ? schedulerWarning(state) : null;
  const tripped = state ? trippedRules(state) : [];
  const rules = state?.status === 'live' ? state.rules : [];
  const active = rules.filter((r) => r.enabled).length;

  return (
    <>
      <PageHeader
        kicker="Rules"
        title="Automations"
        description="When something happens, do something. One rule list across every device kind Aql speaks to."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <RuleStat label="Rules" value={state?.status === 'live' ? String(rules.length) : '—'} hint={state?.status === 'live' ? 'from the hub' : 'no live engine'} />
        <RuleStat label="Enabled" value={state?.status === 'live' ? String(active) : '—'} hint={state?.status === 'live' ? 'from the hub' : 'no live engine'} />
        <RuleStat label="Disabled by breaker" value={state?.status === 'live' ? String(tripped.length) : '—'} hint={state?.status === 'live' ? 'failure breaker' : 'no live engine'} />
        <RuleStat label="Scheduler" value={state?.status === 'live' ? (state.schedulerRunning ? 'running' : 'stopped') : '—'} hint={state?.status === 'live' ? 'fires rules' : 'no live engine'} />
      </div>

      {warning && (
        <Card className="mb-6 border-terracotta/40 bg-terracotta/5">
          <p className="text-sm font-medium text-terracotta-deep">{warning}</p>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
          <span className="inline-flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              Automation rules
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing({ rule: null })}
            disabled={state?.status !== 'live'}
            title={
              state?.status === 'live'
                ? 'Write a new when → do rule'
                : 'There is no rule engine on this hub to save a rule to.'
            }
          >
            New rule
          </Button>
        </div>

        {state === null ? (
          <div className="px-6 py-8">
            <p className="text-sm text-ink/55">Loading…</p>
          </div>
        ) : state.status !== 'live' || rules.length === 0 ? (
          <div className="px-6 py-8">
            <p className="text-sm text-ink/65">{notice}</p>
          </div>
        ) : (
          <ul>
            {rules.map((r) => {
              const trippedReason = (r.disabled_at ?? 0) > 0 ? r.disabled_reason : null;
              const busy = pending.has(r.id);
              const result = runResults[r.id];
              const running = runningId === r.id;
              const deleting = deletingId === r.id;
              return (
                <Fragment key={r.id}>
                <li
                  className={cn(
                    'flex flex-wrap sm:flex-nowrap items-start gap-4 px-6 py-5 border-b border-ink/8 last:border-b-0',
                    !r.enabled && 'opacity-60',
                  )}
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.enabled}
                    aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`}
                    disabled={busy}
                    onClick={() => toggle(r)}
                    className={cn(
                      'mt-1 shrink-0 relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                      r.enabled ? 'bg-ink' : 'bg-ink/20',
                      busy && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-[left]',
                        r.enabled ? 'left-[1.125rem]' : 'left-0.5',
                      )}
                      aria-hidden
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{r.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink/65">
                      <span>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45 mr-1.5">
                          when
                        </span>
                        {triggerLine(r.trigger)}
                      </span>
                      <span className="text-terracotta" aria-hidden>
                        &rarr;
                      </span>
                      <span>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-terracotta mr-1.5">
                          do
                        </span>
                        {actionLine(r.action)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink/45">
                      tier {r.action_tier || 'unknown'} · ceiling {state.maxActionTier || 'unknown'} (set by the hub, not editable here)
                    </p>
                    {trippedReason && (
                      <p className="mt-1.5 text-xs text-terracotta-deep">
                        Disabled by the failure breaker: {trippedReason}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0 text-right">
                    <div className="flex items-center gap-3">
                      {/* Edit loads the whole rule into the form and sends a
                          full replace. A rule is a small object read as a
                          whole, and a partial update of a trigger or an
                          action is how you end up with a coherent-looking
                          rule nobody meant to write. */}
                      <button
                        type="button"
                        onClick={() => setEditing({ rule: r })}
                        className="text-xs text-ink/55 underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryRule(r)}
                        className="text-xs text-ink/55 underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded"
                      >
                        History
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunNow(r)}
                        disabled={running}
                        title="Fire this rule right now. This goes through the same tier check, cooldown and condition check as the scheduler — it cannot do anything the scheduler couldn't."
                        className="text-xs text-ink/55 underline underline-offset-4 hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded"
                      >
                        {running ? 'Running…' : 'Run now'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(r)}
                        disabled={deleting}
                        className="text-xs text-terracotta-deep/80 underline underline-offset-4 decoration-terracotta hover:text-terracotta-deep disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded"
                      >
                        {deleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                    <span className="text-[11px] text-ink/55">{outcomeLine(r)}</span>
                    {r.consecutive_failures > 0 && (
                      <span className="text-[10px] uppercase tracking-[0.18em] text-terracotta">
                        {r.consecutive_failures} failure{r.consecutive_failures === 1 ? '' : 's'} in a row
                      </span>
                    )}
                  </div>
                </li>
                {result && (
                  <li className="px-6 py-3 border-b border-ink/8 last:border-b-0 bg-paper-cool/60">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-ink/45 mb-1.5">
                      Manual run result
                    </p>
                    {'run' in result ? (
                      <RunRow run={result.run} />
                    ) : (
                      <p className="text-sm text-terracotta-deep">{result.error}</p>
                    )}
                  </li>
                )}
                </Fragment>
              );
            })}
          </ul>
        )}

        <div className="px-6 py-5 border-t border-ink/8">
          <InertNote>
            The one scheduling that <span className="text-ink/70">does</span> run on every hub is
            access-side:{' '}
            <Link to="/app/grants" className="underline hover:text-ink/70">
              Temp access
            </Link>{' '}
            issues real time-boxed grants your hub enforces, independent of this rule engine.
          </InertNote>
        </div>
      </Card>

      {/* Account-wide run history (api.automationRuns), spanning every rule —
          as opposed to the per-rule view opened from a row's "History" link
          below, which reads api.automationRuleRuns for one rule only. Only
          shown once the rule list itself is live: a hub with no engine has
          no runs to have made, and that state is already said above. */}
      {state?.status === 'live' && (
        <Card className="mt-6 p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-ink/8">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              Recent activity
            </span>
          </div>
          {activity.status === 'loading' && (
            <p className="px-6 py-8 text-sm text-ink/55">Loading…</p>
          )}
          {activity.status === 'error' && (
            <p className="px-6 py-8 text-sm text-terracotta-deep">{activity.message}</p>
          )}
          {activity.status === 'live' && (
            <RunsPanel
              runs={activity.runs}
              limit={activity.limit}
              showRuleName
              emptyMessage={
                rules.length === 0
                  ? 'No rules exist yet, so there is nothing that could have run.'
                  : 'No runs recorded yet for any rule on this account — that is different from saying every rule is working; check the scheduler status above.'
              }
              onLoadMore={() => {
                const next = activityLimit + 50;
                setActivityLimit(next);
                void loadActivity(next);
              }}
            />
          )}
        </Card>
      )}

      {historyRule && currentAccount && (
        <RunHistory
          accountId={currentAccount.id}
          rule={historyRule}
          onClose={() => setHistoryRule(null)}
        />
      )}

      {editing && currentAccount && (
        <RuleEditor
          accountId={currentAccount.id}
          rule={editing.rule}
          // An absent engine yields an empty list, which is honest: the pickers
          // simply offer no suggestions and a device key can still be typed.
          devices={fleet?.status === 'live' ? fleet.devices : []}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            // Merge in place rather than refetching: the hub has just returned
            // the authoritative rule, including the tier IT resolved, and a
            // refetch would only risk showing something older.
            setState((prev) =>
              prev?.status === 'live'
                ? {
                    ...prev,
                    rules: prev.rules.some((r) => r.id === saved.id)
                      ? prev.rules.map((r) => (r.id === saved.id ? saved : r))
                      : [...prev.rules, saved],
                  }
                : prev,
            );
          }}
        />
      )}
    </>
  );
}
