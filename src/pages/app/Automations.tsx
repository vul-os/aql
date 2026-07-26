// Automations — Aql's when → do screen.
//
// There is no rule engine yet (ROADMAP Phase 3), so every rule on this page
// comes from the built-in demo dataset and is marked as such per panel. The
// "New rule" control is disabled rather than hidden: the shape of the feature
// is real and planned, the engine behind it is not. Nothing here is wired to
// an endpoint.
//
// The access-control module has its own real automation surface — time
// windows and temporary grants under Access control → Temp access — which
// does run on the gateway. This page does not pretend to be that.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './AppLayout';
import { Card, StatBlock } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { automations } from '@/lib/demoData';
import { DemoChip, InertNote } from '@/components/demo/DemoMarks';

/** A readout that is entirely fixture data — the chip sits on the number. */
function DemoStat({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint: string;
}) {
  return (
    <Card>
      <DemoChip className="absolute top-4 right-4" label="Demo" />
      <StatBlock
        label={label}
        value={
          <span className="numeral">
            {value}
            {unit && <span className="ml-1.5 text-sm text-ink/45 font-sans">{unit}</span>}
          </span>
        }
        hint={hint}
      />
    </Card>
  );
}

export default function AutomationsPage() {
  const [rules, setRules] = useState(() => automations.map((a) => ({ ...a })));
  const active = rules.filter((r) => r.enabled).length;

  function toggle(i: number) {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, enabled: !r.enabled } : r)));
  }

  return (
    <>
      <PageHeader
        kicker="Rules"
        title="Automations"
        description="When something happens, do something. One rule list across every device kind Aql speaks to."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <DemoStat label="Rules" value={String(rules.length)} hint="fixture list" />
        <DemoStat label="Enabled" value={String(active)} hint="fixture list" />
        <DemoStat label="Runs today" value="37" hint="fixed number" />
        <DemoStat label="Last trigger" value="2" unit="min ago" hint="fixed number" />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-ink/8">
          <span className="inline-flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              Automation rules
            </span>
            <DemoChip />
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="No rule engine yet — rules can't be created."
          >
            New rule
          </Button>
        </div>

        <ul>
          {rules.map((r, i) => (
            <li
              key={r.name}
              className={cn(
                'flex flex-wrap sm:flex-nowrap items-start gap-4 px-6 py-5 border-b border-ink/8 last:border-b-0',
                !r.enabled && 'opacity-60',
              )}
            >
              <button
                type="button"
                role="switch"
                aria-checked={r.enabled}
                aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name} (demo rule — not saved)`}
                onClick={() => toggle(i)}
                className={cn(
                  'mt-1 shrink-0 relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                  r.enabled ? 'bg-ink' : 'bg-ink/20',
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
                    {r.when}
                  </span>
                  <span className="text-terracotta" aria-hidden>
                    &rarr;
                  </span>
                  <span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-terracotta mr-1.5">
                      do
                    </span>
                    {r.then}
                  </span>
                </div>
              </div>

              <div className="flex sm:flex-col items-baseline sm:items-end gap-2 sm:gap-0.5 shrink-0">
                <span className="font-display numeral text-base text-ink/80">{r.runs}</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40">runs</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40 sm:mt-1">
                  {r.last}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="px-6 py-5 border-t border-ink/8">
          <InertNote>
            The toggles move because they&rsquo;re useful to look at — but they only change this
            page in this tab. Nothing is saved, no rule ever fires, and the run counts are fixed
            numbers. A real when&nbsp;&rarr;&nbsp;do engine is ROADMAP Phase 3.
          </InertNote>
          <InertNote className="mt-2">
            The one scheduling that <span className="text-ink/70">does</span> run today is
            access-side:{' '}
            <Link to="/app/grants" className="underline hover:text-ink/70">
              Temp access
            </Link>{' '}
            issues real time-boxed grants your hub enforces.
          </InertNote>
        </div>
      </Card>
    </>
  );
}
