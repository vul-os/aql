// Automation run history — the record of what a rule's engine actually did,
// as opposed to what it is configured to do. Shared between the account-wide
// activity feed and the per-rule history modal on Automations.tsx, because
// both render the same Run shape (hub/internal/httpapi/automations.go's
// runJSON) and the outcome vocabulary should read identically wherever it
// shows up.
//
// Outcome is a closed set on the hub (automations.Outcome), and the
// distinction that actually matters here — the one a silent history would
// hide — is "fired" vs "did not fire", and within "fired", whether the
// action actually happened:
//
//   executed      — fired, and the driver confirmed it happened.
//   failed        — fired, and the driver said it did NOT happen. This is
//                   the case an empty-looking automation is actually hiding.
//   indeterminate — fired, and the driver could not say either way.
//   refused       — did not fire. Policy said no before anything actuated
//                   (tier ceiling, an unresolvable target, an invalid rule).
//   skipped       — did not fire, and nothing is wrong: disabled, cooldown,
//                   or a condition that did not hold. The engine working as
//                   configured, not a failure.
//
// Nothing here re-derives any of that from the reason string — `outcome` and
// `reason` are both rendered exactly as the hub sent them, same spirit as
// RuleEditor's REFUSAL_CONTEXT never rewording a refusal.

import { cn } from '@/lib/cn';
import { fromUnix } from '@/lib/time';
import type { AutomationRun } from '@/lib/api';

type OutcomeMeta = { label: string; tone: string };

const OUTCOME_META: Record<string, OutcomeMeta> = {
  executed: { label: 'Fired · executed', tone: 'bg-moss/15 text-moss' },
  failed: { label: 'Fired · action failed', tone: 'bg-terracotta/15 text-terracotta-deep' },
  indeterminate: { label: 'Fired · outcome unknown', tone: 'bg-gold/30 text-ink' },
  refused: { label: 'Did not fire · refused', tone: 'bg-ink/8 text-ink/70' },
  skipped: { label: 'Did not fire · skipped', tone: 'bg-ink/5 text-ink/45' },
};

const CAUSE_LABEL: Record<string, string> = {
  schedule: 'schedule',
  threshold: 'threshold',
  event: 'event',
  manual: 'run now',
};

function outcomeMeta(outcome: string): OutcomeMeta {
  return (
    OUTCOME_META[outcome] ?? {
      // A hub newer than this build could add an outcome this console has
      // never heard of — say so rather than rendering an unstyled blank.
      label: outcome ? `Unrecognised outcome ("${outcome}")` : 'unknown outcome',
      tone: 'bg-ink/5 text-ink/65',
    }
  );
}

/** One run's detail. A plain `<div>` on purpose — callers own the list
 *  item, the padding and the border, so this can be dropped into a `<li>`
 *  in a history list or straight into a standalone panel for a single
 *  manual run without ever nesting a list item inside another. */
export function RunRow({ run, showRuleName = false }: { run: AutomationRun; showRuleName?: boolean }) {
  const meta = outcomeMeta(run.outcome);
  const when = fromUnix(run.started_at)?.toLocaleString() ?? '—';
  const target = run.device_key || 'unnamed target';
  // `audited` is only meaningful for a run that reached settle()'s audit
  // write — a skip never attempts one, so false there is expected, not a
  // gap. See automations/engine.go's settle().
  const auditGap = run.outcome !== 'skipped' && !run.audited;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]',
            meta.tone,
          )}
        >
          {meta.label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45">
          {CAUSE_LABEL[run.cause] ?? (run.cause || 'unknown cause')}
        </span>
        {showRuleName && <span className="text-xs text-ink/70 truncate">{run.rule_name || 'unnamed rule'}</span>}
        <span className="ml-auto text-xs text-ink/45 shrink-0">{when}</span>
      </div>
      <p className="mt-1.5 text-sm text-ink/75 font-mono">
        {run.verb || 'no verb recorded'} &rarr; {target}
        {run.target_count > 1 ? ` (${run.target_count} devices)` : ''}
        {run.tier ? ` · tier ${run.tier}` : ''}
      </p>
      {run.reason && <p className="mt-1 text-xs font-mono text-ink/55">{run.reason}</p>}
      {auditGap && (
        <p className="mt-1 text-[11px] text-terracotta-deep">
          Not recorded in the audit trail — the audit write failed when this ran.
        </p>
      )}
    </div>
  );
}

/**
 * A run list plus the one honesty note a capped result needs.
 *
 * `limit` must be the hub's own echo of what it capped this response at
 * (AutomationRunsResponse's `limit` field) — never a number this console
 * assumes. When the run count lands exactly on that cap there may be
 * earlier runs this response simply didn't include, and presenting that
 * list as complete would be exactly the failure mode this panel exists to
 * avoid.
 *
 * An empty list always renders `emptyMessage` rather than nothing, because
 * "no runs recorded" and "this rule has never fired" and "this rule is
 * working" are three different statements and a blank panel collapses them
 * into one. Callers choose the wording; this component only refuses to stay
 * silent.
 */
export function RunsPanel({
  runs,
  limit,
  showRuleName = false,
  emptyMessage,
  onLoadMore,
}: {
  runs: AutomationRun[];
  limit: number;
  showRuleName?: boolean;
  emptyMessage: string;
  onLoadMore?: () => void;
}) {
  if (runs.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink/60">{emptyMessage}</p>;
  }
  const truncated = limit > 0 && runs.length >= limit;
  return (
    <>
      <ul>
        {runs.map((r) => (
          <li key={r.id} className="px-4 py-3 border-b border-ink/8 last:border-b-0">
            <RunRow run={r} showRuleName={showRuleName} />
          </li>
        ))}
      </ul>
      {truncated && (
        <div className="px-4 py-3 border-t border-ink/8 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink/50">
            Showing the {limit} most recent run{limit === 1 ? '' : 's'} the hub returned — there
            may be earlier ones not shown here.
          </p>
          {onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              className="text-xs underline underline-offset-4 text-ink/65 hover:text-ink"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </>
  );
}
