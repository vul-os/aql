// Per-item honesty marks.
//
// Aql is one product: devices, automations, energy and physical access live
// on the same screens. Some of what those screens show is real — access
// points, members, grants and audit all talk to your hub and genuinely
// move hardware. The rest comes from a built-in demo dataset
// (src/lib/demoData.ts), because Aql's device engine is ROADMAP Phase 1 and
// isn't built.
//
// The rule that follows from that: truth is marked PER ITEM, at the point of
// use — a chip on the panel, a chip on the row, a note under the control.
// Not a page-level banner. A banner over a mixed screen either lies about the
// real half or gets tuned out; a chip on the exact figure that is fixture
// data cannot do either.
//
// Companion rule for controls: anything with no engine behind it is rendered
// disabled and carries an <InertNote /> naming the ROADMAP phase that would
// make it work. Nothing here is wired to an endpoint that does not exist.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { DeviceState } from '@/lib/demoData';

/**
 * The demo marker. Put it on the panel header, the table row, or beside the
 * figure itself — whatever is the smallest thing that is actually fixture
 * data.
 */
export function DemoChip({
  className,
  label = 'Demo data',
  title = 'Fixture data from the built-in demo dataset — not a live reading, and nothing is being sent to hardware.',
}: {
  className?: string;
  label?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 shrink-0 rounded-full border border-gold/35 bg-gold/10 px-2 py-0.5',
        'text-[9px] uppercase tracking-[0.16em] text-gold whitespace-nowrap',
        className,
      )}
    >
      <span className="h-1 w-1 rounded-full bg-gold" aria-hidden />
      {label}
    </span>
  );
}

/**
 * The counterpart for hub-backed items sitting in the same list. Used
 * only where real and demo rows are adjacent and the reader needs the
 * contrast — never as decoration on an all-real screen.
 */
export function LiveChip({
  className,
  label = 'Hub',
  title = 'Served by your hub — a real device, real commands, real audit trail.',
}: {
  className?: string;
  label?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 shrink-0 rounded-full border border-moss/35 bg-moss/10 px-2 py-0.5',
        'text-[9px] uppercase tracking-[0.16em] text-moss whitespace-nowrap',
        className,
      )}
    >
      <span className="h-1 w-1 rounded-full bg-moss" aria-hidden />
      {label}
    </span>
  );
}

/** A short "why this does nothing / where this came from" line. */
export function InertNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-ink/45 leading-relaxed', className)}>{children}</p>;
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
    <span
      className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATE_DOT[state], className)}
      aria-hidden
    />
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
 * colour-blind-safe 3-way categorical split).
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
