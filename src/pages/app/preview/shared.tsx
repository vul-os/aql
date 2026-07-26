import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import type { DeviceState } from './demoData';

/**
 * The honesty banner. Every screen under /app/preview renders this above the
 * fold, before any number a reader could mistake for a live reading.
 *
 * The rest of this portal (dashboard, access points, devices, members, audit)
 * talks to a real gateway. These three screens do not — they render a
 * hard-coded dataset, and there is no device engine to render anything else
 * from yet. Nothing here is negotiable copy: if the banner goes, so must the
 * screens.
 */
export function DemoBanner({ what }: { what: string }) {
  return (
    <Card
      tone="cream"
      className="mb-6 sm:mb-8 border-gold/40 flex flex-col sm:flex-row sm:items-start gap-4"
    >
      <span
        className="shrink-0 inline-flex items-center gap-2 h-7 px-3 rounded-full bg-gold/15 border border-gold/30 text-gold text-[10px] uppercase tracking-[0.16em] self-start"
        role="status"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
        Demo preview
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink/80 leading-relaxed">
          <span className="font-medium text-ink">Nothing on this screen is live.</span> {what} is
          drawn from a built-in demo dataset — no hardware is being read, no command is being
          sent, and nothing you change here is saved.
        </p>
        <p className="mt-2 text-sm text-ink/60 leading-relaxed">
          Aql&rsquo;s device engine (discovery, driver adapters, telemetry) is ROADMAP Phase 1 and
          isn&rsquo;t built. The access-control screens in the sidebar{' '}
          <span className="text-ink/80">are</span> real — they talk to your gateway. This section
          is a design preview of what lands when the engine does.
        </p>
      </div>
    </Card>
  );
}

/** A short "why this control does nothing" line, for disabled demo affordances. */
export function InertNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-ink/45 leading-relaxed">{children}</p>;
}

const STATE_DOT: Record<DeviceState, string> = {
  live: 'bg-moss',
  warn: 'bg-gold',
  alert: 'bg-terracotta',
  off: 'bg-ink/25',
};

const STATE_LABEL: Record<DeviceState, string> = {
  live: 'reporting',
  warn: 'attention',
  alert: 'alert',
  off: 'off',
};

/**
 * Status is a coloured dot + a word — never colour alone (the dot repeats what
 * the label already says, so it survives colour-blindness and greyscale print).
 */
export function StateDot({ state, className }: { state: DeviceState; className?: string }) {
  return (
    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATE_DOT[state], className)} aria-hidden />
  );
}

export function StateLabel({ state }: { state: DeviceState }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink/70">
      <StateDot state={state} />
      {STATE_LABEL[state]}
    </span>
  );
}

/**
 * Single-hue magnitude bar. Colour carries no identity here — the row is
 * already named and its value directly labelled — so one accent is used for
 * every bar rather than a categorical palette (the warm token set has no
 * colour-blind-safe 3-way categorical split; see the report).
 */
export function Meter({
  fraction,
  idle = false,
  className,
}: {
  fraction: number;
  idle?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <div className={cn('h-1.5 rounded-full bg-ink/8 overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full', idle ? 'bg-ink/20' : 'bg-terracotta')}
        style={{ width: `${Math.max(idle ? 0 : 2, pct)}%` }}
      />
    </div>
  );
}
