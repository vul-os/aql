// Per-rule run history — the hub has kept every run since the engine
// shipped (hub/internal/automations/store.go's automation_runs table, served
// by handleAutomationRuns in hub/internal/httpapi/automations.go) and
// nothing in this console rendered a single row of it. A rule that has
// never fired and a rule that fires and fails every time looked identical on
// Automations.tsx: both are just a row with a toggle and a last-outcome
// string. This is the missing detail view.
//
// Admin-only, same gate as the rule list itself (automations.go's own
// comment explains why: a run history is closer to the audit trail than to
// a device reading). Opening this from Automations.tsx only happens once
// that list is already live, which already proved the viewer is an admin —
// but the fetch here still narrows every outcome rather than assuming that
// stays true for the life of the modal.

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import {
  ApiError,
  api,
  friendlyApiError,
  isUnavailable,
  type AutomationRule,
  type AutomationRun,
} from '@/lib/api';
import { RunsPanel } from './RunList';

type HistoryState =
  | { status: 'loading' }
  | { status: 'live'; runs: AutomationRun[]; limit: number }
  | { status: 'forbidden' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export default function RunHistory({
  accountId,
  rule,
  onClose,
}: {
  accountId: string;
  rule: AutomationRule;
  onClose: () => void;
}) {
  const [limit, setLimit] = useState(100);
  const [state, setState] = useState<HistoryState>({ status: 'loading' });

  const load = useCallback(
    async (n: number) => {
      setState({ status: 'loading' });
      try {
        const res = await api.automationRuleRuns(accountId, rule.id, n);
        setState({ status: 'live', runs: res.runs, limit: res.limit });
      } catch (err) {
        if (isUnavailable(err)) {
          setState({ status: 'unsupported' });
        } else if (err instanceof ApiError && err.status === 403) {
          setState({ status: 'forbidden' });
        } else {
          setState({ status: 'error', message: friendlyApiError(err, 'Could not load run history.') });
        }
      }
    },
    [accountId, rule.id],
  );

  useEffect(() => {
    void load(limit);
    // Deliberately depends only on the identity of the rule/account, not on
    // `limit` — `loadMore` below drives every later fetch directly, so this
    // effect firing again on its own would race a load the person asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, rule.id]);

  function loadMore() {
    const next = limit + 100;
    setLimit(next);
    void load(next);
  }

  return (
    <Modal open onClose={onClose} className="sm:max-w-xl">
      <h2 className="font-display text-2xl mb-1">Run history</h2>
      <p className="text-sm text-ink/60 mb-5">
        &ldquo;{rule.name}&rdquo; — what the engine actually did each time it evaluated this rule,
        most recent first. A run row is written for every fire attempt, including a refused or
        failed one; a disabled rule, a cooldown still in effect, or an unmet condition write no
        row at all, because nothing came close to actuating.
      </p>

      {state.status === 'loading' && <p className="text-sm text-ink/55">Loading…</p>}
      {state.status === 'forbidden' && (
        <p className="text-sm text-terracotta-deep">
          Run history is admin-only, same as the rule list itself.
        </p>
      )}
      {state.status === 'unsupported' && (
        <p className="text-sm text-ink/65">
          This hub doesn&rsquo;t serve per-rule run history yet — it&rsquo;s running a build from
          before that route existed.
        </p>
      )}
      {state.status === 'error' && <p className="text-sm text-terracotta-deep">{state.message}</p>}
      {state.status === 'live' && (
        <div className="rounded-xl border border-ink/10 overflow-hidden">
          <RunsPanel
            runs={state.runs}
            limit={state.limit}
            emptyMessage={
              rule.last_fired_at
                ? 'No runs in this window, though the rule has fired before — try "Load more".'
                : 'No runs recorded. This rule has never fired — that is not the same statement as "this rule is working": check that the scheduler is running and that the trigger can actually occur.'
            }
            onLoadMore={loadMore}
          />
        </div>
      )}

      <div className="flex justify-end pt-5">
        <button
          type="button"
          onClick={onClose}
          className="h-10 px-4 rounded-full text-sm text-ink/65 hover:text-ink"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
