import { useState } from 'react';
import { PageHeader } from '../AppLayout';
import { Card, StatBlock } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { automations } from './demoData';
import { DemoBanner, InertNote } from './shared';

export default function PreviewAutomationsPage() {
  const [rules, setRules] = useState(() => automations.map((a) => ({ ...a })));
  const active = rules.filter((r) => r.enabled).length;

  function toggle(i: number) {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, enabled: !r.enabled } : r)));
  }

  return (
    <>
      <PageHeader
        kicker="Preview · demo data"
        title="Automations"
        description="How when → do rules will read once there's a rule engine to run them. These six are fixtures."
      />

      <DemoBanner what="This rule list, and every count above it," />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <Card>
          <StatBlock
            label="Rules"
            value={<span className="numeral">{rules.length}</span>}
            hint="demo list"
          />
        </Card>
        <Card>
          <StatBlock
            label="Enabled"
            value={<span className="numeral">{active}</span>}
            hint="demo list"
          />
        </Card>
        <Card>
          <StatBlock
            label="Runs today"
            value={<span className="numeral">37</span>}
            hint="fixture"
          />
        </Card>
        <Card>
          <StatBlock
            label="Last trigger"
            value={
              <span className="numeral">
                2<span className="ml-1.5 text-sm text-ink/45 font-sans">min ago</span>
              </span>
            }
            hint="fixture"
          />
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-ink/8">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Automation rules
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
                aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name} (preview only)`}
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

        <div className="px-6 py-5">
          <InertNote>
            The toggles move because they&rsquo;re useful to look at — but they only change this
            page in this tab. Nothing is saved, no rule ever fires, and the run counts are fixed
            numbers. A real when&nbsp;&rarr;&nbsp;do engine is ROADMAP Phase 3.
          </InertNote>
        </div>
      </Card>
    </>
  );
}
